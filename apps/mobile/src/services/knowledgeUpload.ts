import { fetch as nativeFetch } from 'expo/fetch';

import { ApiError } from './apiClient';
import type { PickedFile, UploadPolicy } from './knowledgeApi';

/**
 * Multipart upload with real transfer progress.
 *
 * `fetch` cannot report upload progress, and a timer that fakes a percentage
 * would be a lie, so this uses `XMLHttpRequest`: React Native reports the bytes
 * the platform has actually written to the socket through `upload.onprogress`.
 *
 * A knowledge base upload is fire-and-forget on the server: the response names
 * a `task_id` and parsing continues there. Cancelling the request therefore
 * cancels *this* transfer, not the server's parsing run, and is reported that
 * way in the UI.
 *
 * Redirects are a data-egress risk, not a cosmetic one. React Native's XHR
 * follows them on both platforms: Android builds its OkHttp client with the
 * default `followRedirects = true`, and iOS'
 * `URLSession:task:willPerformHTTPRedirection:` always calls the completion
 * handler with the new request. A 307/308 therefore re-sends the multipart body
 * to whatever host the redirect names, and `xhr.status` still reports the final
 * 200. Two checks keep the file on the configured server:
 *
 * 1. Before any bytes move, a `HEAD` of the exact upload URL is issued with
 *    `redirect: 'manual'` through `expo/fetch`, whose native implementation
 *    disables following on both platforms. A redirect is refused here.
 * 2. After the transfer, `xhr.responseURL` — the final URL on both platforms —
 *    must still be the URL that was asked for; a redirected response is never
 *    parsed as a success.
 *
 * Check 1 cannot cover a redirect that a server only applies to POST, and
 * check 2 observes the redirect after the body was sent. That residual gap is
 * documented rather than hidden; both checks still refuse to treat the upload
 * as landed.
 */

export interface UploadResult {
  taskId: string;
  /** Names the server stored, relative to the base's `raw/` directory. */
  files: string[];
  message: string;
}

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Abort the transfer. The server keeps whatever bytes it already received. */
  abort(): void;
}

/** No progress for this long means the connection is dead, not slow. */
const STALL_TIMEOUT_MS = 60_000;

/** The redirect check is a round trip of its own, so it gets its own deadline. */
const PROBE_TIMEOUT_MS = 15_000;

export interface UploadRequest {
  origin: string;
  /** Server handle for the knowledge base. */
  ref: string;
  files: readonly PickedFile[];
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

function parseUploadResult(value: unknown): UploadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('invalid-response', '服务器未接受上传。');
  }
  const raw = value as Record<string, unknown>;
  const files = Array.isArray(raw.files)
    ? raw.files.filter((name): name is string => typeof name === 'string')
    : [];
  return {
    taskId: typeof raw.task_id === 'string' ? raw.task_id : '',
    files,
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

/**
 * The server's own explanation of a refusal, as a single short line.
 *
 * FastAPI puts it in `detail`; a proxy or a crash may answer with HTML instead,
 * in which case there is nothing worth showing and the caller falls back to a
 * status-based sentence.
 */
function refusalDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const raw = (parsed as Record<string, unknown>).detail;
    const text = typeof raw === 'string' ? raw : '';
    const line = text.replace(/\s+/g, ' ').trim();
    if (!line) return undefined;
    return line.length > 300 ? `${line.slice(0, 297)}…` : line;
  } catch {
    return undefined;
  }
}

/**
 * Whether a response came from the address that was asked for.
 *
 * `responseURL` is percent-encoded exactly as the request was, so the cheap
 * string comparison covers the normal case; parsing the two URLs keeps a
 * platform that normalises the path (an added trailing slash, for instance)
 * from being reported as a redirect to a different host.
 */
function isSameUploadUrl(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  try {
    const left = new URL(actual);
    const right = new URL(expected);
    return (
      left.protocol === right.protocol &&
      left.host === right.host &&
      left.pathname === right.pathname &&
      left.search === right.search
    );
  } catch {
    return false;
  }
}

/**
 * Refuse an upload endpoint that redirects before any of the file is sent.
 *
 * `expo/fetch` is the only transport in the app that can ask the native layer
 * not to follow a redirect (`redirect: 'manual'`), so it is used for this
 * header-only probe. The answer itself is irrelevant — 401, 405 and 200 all
 * mean "this is the server" — only a 3xx does not.
 */
async function assertUploadTargetIsDirect(
  url: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) {
    throw new ApiError('aborted', '上传已取消。');
  }
  const probe = new AbortController();
  const forwardAbort = () => probe.abort();
  signal?.addEventListener('abort', forwardAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    probe.abort();
  }, PROBE_TIMEOUT_MS);

  let status = 0;
  let redirected = false;
  try {
    const response = await nativeFetch(url, {
      method: 'HEAD',
      credentials: 'include',
      redirect: 'manual',
      signal: probe.signal,
    });
    status = response.status;
    redirected = response.redirected;
  } catch {
    if (signal?.aborted) {
      throw new ApiError('aborted', '上传已取消。');
    }
    if (timedOut) {
      throw new ApiError(
        'timeout',
        '服务器未及时确认上传地址，请重试。',
      );
    }
    throw new ApiError(
      'network',
      '无法检查上传地址，请检查网络。',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  if (redirected || (status >= 300 && status < 400)) {
    throw new ApiError(
      'redirect',
      '服务器会将上传重定向到其他地址，请输入最终地址。',
      status,
    );
  }
}

export function uploadKnowledgeFiles({
  origin,
  ref,
  files,
  onProgress,
  signal,
}: UploadRequest): UploadHandle {
  const url = `${origin}/api/knowledge-bases/${encodeURIComponent(ref)}/upload`;
  const form = new FormData();
  for (const file of files) {
    // React Native's FormData takes a `{uri, name, type}` descriptor and streams
    // the file from disk; the bytes never pass through JavaScript.
    form.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  }

  /** Aborts the redirect probe, so a cancel never leaves it running. */
  const probe = new AbortController();
  let xhr: XMLHttpRequest | null = null;
  let settled = false;
  let stall: ReturnType<typeof setTimeout> | undefined;
  let resolveResult: (value: UploadResult) => void = () => {};
  let rejectResult: (reason: ApiError) => void = () => {};

  const promise = new Promise<UploadResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const cleanup = () => {
    if (stall) {
      clearTimeout(stall);
      stall = undefined;
    }
    probe.abort();
    signal?.removeEventListener('abort', abortTransfer);
  };
  /**
   * Every outcome — including a stall, an HTTP error and a redirect — closes
   * the socket. A rejected promise that left the request writing bytes would
   * keep spending the learner's data, and a retry would race the old transfer
   * for the same file.
   */
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    const request = xhr;
    xhr = null;
    if (request) {
      try {
        // A finished request is a no-op here; a live one stops now. `onabort`
        // may fire, but `settled` is already true, so it cannot rewrite this.
        request.abort();
      } catch {
        // The platform may have torn the request down already.
      }
    }
    action();
  };
  const succeed = (value: UploadResult) => settle(() => resolveResult(value));
  const fail = (
    kind: ApiError['kind'],
    message: string,
    status?: number,
    detail?: string,
  ) =>
    settle(() => rejectResult(new ApiError(kind, message, status, detail)));
  const armStall = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(
      () =>
        fail(
          'timeout',
          '上传长时间没有进展，请检查网络后重试。',
        ),
      STALL_TIMEOUT_MS,
    );
  };
  const abortTransfer = () => fail('aborted', '上传已取消。');

  if (signal?.aborted) {
    fail('aborted', '上传已取消。');
    return { promise, abort: abortTransfer };
  }
  signal?.addEventListener('abort', abortTransfer);

  const start = async () => {
    await assertUploadTargetIsDirect(url, probe.signal);
    // A cancel during the check wins over starting the body.
    if (settled) return;

    const request = new XMLHttpRequest();
    xhr = request;
    request.open('POST', url, true);
    // The session is an HttpOnly cookie; the platform cookie jar supplies it.
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    // The platform sets the multipart boundary itself.
    request.timeout = 0;

    request.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      armStall();
      onProgress?.(event.loaded, event.total);
    };

    request.onload = () => {
      const status = request.status;
      // A redirect that was followed reports the *target's* status here, so
      // the final URL has to be checked before anything else is believed.
      if (request.responseURL && !isSameUploadUrl(request.responseURL, url)) {
        fail(
          'redirect',
          '上传被重定向到其他地址，未被接收。',
          status,
        );
        return;
      }
      if (status === 401) {
        fail('unauthorized', '请先登录。', 401);
        return;
      }
      if (status >= 300 && status < 400) {
        fail('redirect', '请输入 DeepTutor 服务器的最终地址。', status);
        return;
      }
      if (status < 200 || status >= 300) {
        fail(
          'http',
          `服务器返回 HTTP ${status}。`,
          status,
          refusalDetail(request.responseText),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(request.responseText) as unknown;
      } catch {
        fail('invalid-response', '服务器未接受上传。');
        return;
      }
      try {
        succeed(parseUploadResult(parsed));
      } catch (error) {
        if (error instanceof ApiError) fail(error.kind, error.message, error.status);
        else fail('invalid-response', '服务器未接受上传。');
      }
    };
    request.onerror = () =>
      fail('network', '无法连接服务器，请检查网络。');
    request.onabort = () => fail('aborted', '上传已取消。');
    request.ontimeout = () =>
      fail('timeout', '上传超时，请重试。');

    armStall();
    try {
      request.send(form);
    } catch {
      fail('network', '无法开始上传。');
    }
  };

  start().catch(error => {
    if (error instanceof ApiError) fail(error.kind, error.message, error.status);
    else fail('network', '无法开始上传。');
  });

  return { promise, abort: abortTransfer };
}

export interface RejectedFile {
  name: string;
  reason: string;
  /** The picked copy, so the queue can release it without guessing. */
  uri: string;
}

export interface FileValidation {
  accepted: PickedFile[];
  rejected: RejectedFile[];
}

/** Strip any directory part a picker may have kept; the batch uploads flat. */
function baseName(name: string): string {
  const parts = name.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

/**
 * Client-side pre-flight against the server's own policy.
 *
 * This is a courtesy, not a security boundary: the server re-validates every
 * batch, and its answer wins.
 */
export function validatePickedFiles(
  files: readonly PickedFile[],
  policy: UploadPolicy | null,
): FileValidation {
  const allowed = new Set(policy?.extensions ?? []);
  // The upload route also accepts `.zip` as a container and validates its
  // members during extraction, but does not advertise it in the policy.
  allowed.add('.zip');
  const max = policy?.maxFileSizeBytes ?? 0;
  // With no policy in hand there is nothing to check against; the server's own
  // limit is the authority either way, so the pick is not blocked here.
  const checkExtension = policy !== null && !policy.allowAnyExtension;
  const accepted: PickedFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const name = baseName(file.name);
    if (!name || name === '.' || name === '..') {
      rejected.push({
        name: file.name,
        reason: '此文件没有可用的名称。',
        uri: file.uri,
      });
      continue;
    }
    // An unknown size is not an error: some providers report none, and the
    // server's own limit still applies.
    if (file.size !== undefined && file.size <= 0) {
      rejected.push({ name, reason: '此文件为空。', uri: file.uri });
      continue;
    }
    if (file.size !== undefined && max > 0 && file.size > max) {
      rejected.push({
        name,
        reason: `文件大小超过服务器的 ${formatBytes(max)} 限制。`,
        uri: file.uri,
      });
      continue;
    }
    const extension = extensionOf(name);
    if (checkExtension && !allowed.has(extension)) {
      rejected.push({
        name,
        reason: extension
          ? `此服务器不支持 ${extension} 文件。`
          : '文件需要使用服务器支持的扩展名。',
        uri: file.uri,
      });
      continue;
    }
    accepted.push({
      uri: file.uri,
      name,
      size: file.size,
      mimeType: file.mimeType || mimeTypeFor(extension),
    });
  }

  return { accepted, rejected };
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function mimeTypeFor(extension: string): string {
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
