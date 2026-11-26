import { ApiClient } from './apiClient';
import {
  emptyTurnDetails,
  object,
  projectTurnEvent,
  type TurnDetails,
} from '../features/chat/turnDetails';

/**
 * Conversation history is owned by the DeepTutor server. These parsers read the
 * payloads `deeptutor/api/routers/sessions.py` already returns; nothing here
 * invents a second store, and every field the app acts on is validated so an
 * unexpected shape fails loudly instead of rendering a half-loaded transcript.
 */

/** Turn statuses the server actually persists (`turns.status`). */
export type TurnStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'idle';

export interface FailedTurnInfo {
  turnId: string;
  error: string;
  retryable: boolean;
}

export interface SessionMessage {
  /**
   * The store's row id. SQLite returns an integer rowid and PocketBase a record
   * string, so it is normalised to a string; an empty value means the payload
   * carried none and the caller must fall back to a positional key.
   */
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  turnId?: string;
  parentMessageId?: string;
  eventHistoryTurnId?: string;
  details?: TurnDetails;
  /** Present on a saved user row whose turn failed before any reply existed. */
  failedTurn: FailedTurnInfo | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage: string;
  pinned?: boolean;
  status: TurnStatus;
  /** The turn still holding the session, or "" when the session is free. */
  activeTurnId: string;
}

export interface SessionTurn {
  id: string;
  assistantMessageId?: string;
  status: TurnStatus;
  lastSeq: number;
  error: string;
  updatedAt: number;
  retryable: boolean;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
  activeTurns: SessionTurn[];
  /**
   * Knowledge bases the conversation was last answered from.
   *
   * The server keeps them in the session's `preferences` and a turn that omits
   * `knowledge_bases` inherits them, so the client reads this only to show the
   * current selection.
   */
  knowledgeBases: string[];
}

export interface SessionPage {
  sessions: SessionSummary[];
  /** A full page means the caller may ask for the next offset. */
  hasMore: boolean;
}

const TURN_STATUSES: readonly TurnStatus[] = [
  'queued',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
  'rejected',
  'idle',
];

const ACTIVE_STATUSES: readonly TurnStatus[] = [
  'queued',
  'running',
  'waiting_input',
];

export function isActiveTurnStatus(status: TurnStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${what}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Row ids arrive as a SQLite integer or a PocketBase record id. */
function rowId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function turnStatus(value: unknown): TurnStatus {
  return TURN_STATUSES.find(status => status === value) ?? 'idle';
}

function parseFailedTurn(value: unknown): FailedTurnInfo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const turnId = text(raw.turn_id);
  if (!turnId) return null;
  return {
    turnId,
    error: text(raw.error),
    retryable: raw.retryable === true,
  };
}

function parseMessage(value: unknown, sessionId: string): SessionMessage {
  const raw = record(value, 'a session message');
  const role = raw.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    throw new Error('Unknown message role');
  }
  const metadata = raw.metadata ? record(raw.metadata, 'message metadata') : {};
  const trace =
    raw.trace && typeof raw.trace === 'object'
      ? (raw.trace as Record<string, unknown>)
      : {};
  const turnId = text(metadata.turn_id) || text(trace.turn_id);
  const eventHistoryTurnId = role === 'assistant' ? text(trace.turn_id) : '';
  let details = emptyTurnDetails;
  if (role === 'assistant' && Array.isArray(raw.events)) {
    raw.events.forEach((input, index) => {
      const event = object(input);
      if (!event || (event.session_id && event.session_id !== sessionId) ||
          (turnId && event.turn_id && event.turn_id !== turnId)) return;
      details = projectTurnEvent(details, event, 'preview:' + index);
    });
  }
  const parentMessageId = rowId(raw.parent_message_id);
  return {
    id: rowId(raw.id),
    role,
    content: text(raw.content),
    createdAt: count(raw.created_at),
    failedTurn: parseFailedTurn(metadata.orphaned_failed_turn),
    ...(turnId ? { turnId } : {}),
    ...(parentMessageId ? { parentMessageId } : {}),
    ...(eventHistoryTurnId ? { eventHistoryTurnId } : {}),
    ...(details !== emptyTurnDetails ? { details } : {}),
  };
}

function parseSummary(value: unknown): SessionSummary {
  const raw = record(value, 'a session');
  const id = text(raw.session_id) || text(raw.id);
  if (!id) throw new Error('Session is missing an id');
  return {
    id,
    title: text(raw.title),
    createdAt: count(raw.created_at),
    updatedAt: count(raw.updated_at),
    messageCount: count(raw.message_count),
    lastMessage: text(raw.last_message),
    pinned: object(raw.preferences)?.pinned === true,
    status: turnStatus(raw.status),
    activeTurnId: text(raw.active_turn_id),
  };
}

function parseTurn(value: unknown): SessionTurn {
  const raw = record(value, 'a session turn');
  const id = text(raw.id) || text(raw.turn_id);
  if (!id) throw new Error('Turn is missing an id');
  const assistantMessageId = rowId(raw.assistant_message_id);
  return {
    id,
    ...(assistantMessageId ? { assistantMessageId } : {}),
    status: turnStatus(raw.status),
    lastSeq: count(raw.last_seq),
    error: text(raw.error),
    updatedAt: count(raw.updated_at),
    retryable: raw.retryable === true,
  };
}

function parsePage(value: unknown): SessionSummary[] {
  const raw = record(value, 'a session page');
  if (!Array.isArray(raw.sessions)) throw new Error('Session page has no rows');
  return raw.sessions.map(parseSummary);
}

function parseDetail(value: unknown): SessionDetail {
  const raw = record(value, 'a session');
  if (!Array.isArray(raw.messages))
    throw new Error('Session has no transcript');
  const summary = parseSummary(raw);
  const activeTurns = Array.isArray(raw.active_turns)
    ? raw.active_turns.map(parseTurn)
    : [];
  const preferences =
    raw.preferences && typeof raw.preferences === 'object'
      ? (raw.preferences as Record<string, unknown>)
      : {};
  const knowledgeBases = Array.isArray(preferences.knowledge_bases)
    ? preferences.knowledge_bases.filter(
        (ref): ref is string => typeof ref === 'string' && ref.trim().length > 0,
      )
    : [];
  return {
    ...summary,
    messages: raw.messages.map(message => parseMessage(message, summary.id)),
    activeTurns,
    knowledgeBases,
  };
}

function parseDeleted(value: unknown): void {
  const raw = record(value, 'a deletion acknowledgement');
  if (raw.deleted !== true)
    throw new Error('The server did not delete the session');
}

const MAX_PAGE = 200;

export type SessionListQuery = {
  limit: number;
  offset: number;
  /**
   * Empty string pins the built-in "general" workspace, matching what the chat
   * socket already sends as `dt_workspace=`.
   */
  workspaceId?: string;
};

export class SessionApi {
  constructor(private readonly client: ApiClient) {}

  async list(
    query: SessionListQuery,
    signal?: AbortSignal,
  ): Promise<SessionPage> {
    const limit = Math.min(Math.max(1, Math.trunc(query.limit)), MAX_PAGE);
    const offset = Math.max(0, Math.trunc(query.offset));
    const search = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (query.workspaceId !== undefined) {
      search.set('workspace_id', query.workspaceId);
    }
    const sessions = await this.client.json(
      `/api/sessions?${search.toString()}`,
      parsePage,
      { signal },
    );
    // The list endpoint reports no total, so a short page is the only signal
    // that the caller has reached the end of the index.
    return { sessions, hasMore: sessions.length >= limit };
  }

  get(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    return this.client.json(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      parseDetail,
      { signal },
    );
  }

  /** Read only the event journal for the selected, server-owned assistant row. */
  getMessageDetails = async (
    sessionId: string,
    messageId: string,
    turnId: string,
    signal: AbortSignal,
  ): Promise<TurnDetails> => {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/events` as const;
    let cursor = 0;
    let details = emptyTurnDetails;
    for (;;) {
      const page = await this.client.json(
        `${path}?workspace_id=&after_seq=${cursor}&limit=200`,
        value => {
          const raw = record(value, 'message events');
          if (raw.session_id !== sessionId || rowId(raw.message_id) !== messageId ||
              raw.turn_id !== turnId || !Array.isArray(raw.events)) {
            throw new Error('Message event journal identity mismatch');
          }
          return raw;
        },
        { signal },
      );
      (page.events as unknown[]).forEach((input, index) => {
        const event = object(input);
        if (!event || (event.session_id && event.session_id !== sessionId) ||
            (event.turn_id && event.turn_id !== turnId)) return;
        const seq = event.seq;
        if (typeof seq === 'number' && seq <= cursor) return;
        details = projectTurnEvent(details, event, cursor + ':' + index);
      });
      if (page.complete === true) return details;
      if (typeof page.next_seq !== 'number' || !Number.isSafeInteger(page.next_seq) || page.next_seq <= cursor) {
        throw new Error('无法继续读取这条消息的执行过程。');
      }
      cursor = page.next_seq;
    }
  };

  async rename(sessionId: string, title: string): Promise<string> {
    const value = await this.client.json(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      payload => {
        const raw = record(payload, 'a rename acknowledgement');
        const session = parseSummary(raw.session);
        return session.title;
      },
      { method: 'PATCH', body: { title } },
    );
    return value;
  }

  remove(sessionId: string): Promise<void> {
    return this.client.json(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      parseDeleted,
      { method: 'DELETE' },
    );
  }

  setPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    return this.client.json(
      `/api/sessions/${encodeURIComponent(sessionId)}/organization`,
      payload => {
        const raw = record(payload, 'a pin acknowledgement');
        const session = parseSummary(raw.session);
        if (session.id !== sessionId || session.pinned !== pinned) {
          throw new Error('The server did not save the requested pin state');
        }
        return pinned;
      },
      { method: 'PATCH', body: { pinned } },
    );
  }
}
