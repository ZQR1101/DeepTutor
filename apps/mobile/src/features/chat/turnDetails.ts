export type StepState =
  | 'running'
  | 'returned'
  | 'ended'
  | 'complete'
  | 'failed'
  | 'cancelled';
export type TurnStep = {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
};

export type RagSource = {
  id: string;
  document: string;
  knowledgeBase: string;
  excerpt: string;
  page?: number | string;
  urls: string[];
};

export type TurnDetails = {
  steps: readonly TurnStep[];
  sources: readonly RagSource[];
};

export const emptyTurnDetails: TurnDetails = { steps: [], sources: [] };

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, length = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

const stages: Record<string, string> = {
  exploring: '查找解题线索',
  responding: '组织回答',
  planning: '整理思路',
  reasoning: '分析问题',
  writing: '撰写回答',
  rephrasing: '整理研究问题',
  decomposing: '划分子问题',
  researching: '查找资料',
  reporting: '整理研究结果',
};
const tools: Record<string, string> = {
  rag: '检索知识库',
  read_source: '阅读来源',
  web_search: '搜索网页',
  web_fetch: '读取网页',
  paper_search: '查找论文',
  code_execution: '运行代码',
  exec: '运行工具',
  reason: '分析问题',
  brainstorm: '探索解题方式',
  ask_user: '请求补充信息',
};

function ragSource(input: unknown): RagSource | undefined {
  const row = object(input);
  if (!row || row.type !== 'rag') return;
  const origin = text(row.source);
  const file =
    text(row.file_name) ||
    text(row.document_key) ||
    (/[./\\]/.test(origin) ? origin.split(/[/\\]/).pop() ?? '' : '');
  const document = text(row.title) || file;
  const knowledgeRef = text(row.kb_name);
  const qualified = knowledgeRef.indexOf(':kb:');
  const knowledgeBase =
    qualified < 0 ? knowledgeRef : knowledgeRef.slice(qualified + 4);
  const excerpt = text(row.evidence_text, 6_000) || text(row.content, 6_000);
  const urls = [
    ...new Set(
      [row.url, row.preview_url, row.visual_asset_url]
        .map(url => text(url, 4_000))
        .filter(Boolean),
    ),
  ];
  // RAG can report only the query and KB. This is not a document or excerpt.
  if (!document && !excerpt && !urls.length) return;
  const page =
    typeof row.page === 'number' && Number.isInteger(row.page) && row.page > 0
      ? row.page
      : text(row.page, 40) || undefined;
  const chunk = text(row.chunk_id);
  const provenance =
    text(row.document_key) || text(row.file_name) || origin || document;
  const id = chunk
    ? JSON.stringify([knowledgeRef, 'chunk', provenance, chunk])
    : urls[0]
    ? JSON.stringify([knowledgeRef, 'url', urls[0]])
    : JSON.stringify([knowledgeRef, document, page, excerpt]);
  return {
    id,
    document,
    knowledgeBase,
    excerpt,
    page,
    urls,
  };
}

function addStep(details: TurnDetails, step: TurnStep): TurnDetails {
  const index = details.steps.findIndex(existing => existing.id === step.id);
  if (index < 0)
    return { ...details, steps: [...details.steps.slice(-149), step] };
  const current = details.steps[index];
  // A tool result may follow the explicit success/failure status. Preserve
  // that outcome while attaching any result text the server subsequently sent.
  const preserve =
    ['ended', 'complete', 'failed', 'cancelled'].includes(current.state) &&
    (step.state === 'running' || step.state === 'returned');
  const state = preserve ? current.state : step.state;
  const detail =
    preserve && current.state === 'failed'
      ? current.detail || step.detail
      : step.detail || current.detail;
  if (
    state === current.state &&
    detail === current.detail &&
    step.label === current.label
  )
    return details;
  const steps = [...details.steps];
  steps[index] = { ...step, state, detail };
  return { ...details, steps };
}

/** Presentation-only projection. The transport owns event ordering and replay. */
export function projectTurnEvent(
  previous: TurnDetails,
  value: unknown,
  fallbackKey = '',
): TurnDetails {
  const event = object(value);
  if (!event) return previous;
  const meta = object(event.metadata) ?? {};
  const eventKey =
    typeof event.seq === 'number' ? String(event.seq) : fallbackKey;
  if (event.type === 'sources' && Array.isArray(meta.sources)) {
    const sources = new Map(
      previous.sources.map(source => [source.id, source]),
    );
    let changed = false;
    for (const input of meta.sources) {
      const next = ragSource(input);
      if (!next || (!sources.has(next.id) && sources.size >= 120)) continue;
      const before = sources.get(next.id);
      const updated = before
        ? {
            ...next,
            document: next.document || before.document,
            page: next.page ?? before.page,
            excerpt:
              next.excerpt.length > before.excerpt.length
                ? next.excerpt
                : before.excerpt,
            urls: [...new Set([...before.urls, ...next.urls])],
          }
        : next;
      if (
        !before ||
        updated.document !== before.document ||
        updated.page !== before.page ||
        updated.excerpt !== before.excerpt ||
        updated.urls.length !== before.urls.length
      ) {
        sources.set(next.id, updated);
        changed = true;
      }
    }
    return changed ? { ...previous, sources: [...sources.values()] } : previous;
  }
  const callId = text(meta.call_id) || text(meta.tool_call_id);
  const tool = text(meta.tool_name) || text(meta.tool);
  const retrieval = meta.call_kind === 'rag_retrieval' || tool === 'rag';
  const reportedState = meta.call_state ?? meta.status;
  const result = object(meta.tool_metadata);
  const failed =
    event.type === 'error' ||
    reportedState === 'error' ||
    reportedState === 'failed' ||
    (event.type === 'tool_result' &&
      (meta.success === false || result?.success === false));
  const stage = text(event.stage);
  const isStage =
    (event.type === 'stage_start' || event.type === 'stage_end') && !!stage;
  const toolProgress =
    meta.trace_kind === 'call_status' &&
    (retrieval || !!tool || meta.trace_group === 'tool_call');
  const isCall =
    event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    (['progress', 'observation', 'error'].includes(String(event.type)) &&
      toolProgress);
  if (!isCall && !isStage && event.type !== 'error') return previous;
  // Never surface reasoning/thinking events, deltas, or argument payloads.
  const label = retrieval
    ? '检索知识库'
    : isCall
    ? Object.hasOwn(tools, tool)
      ? tools[tool]
      : tool
      ? '调用工具 · ' + tool
      : '工具调用'
    : isStage
    ? Object.hasOwn(stages, stage)
      ? stages[stage]
      : text(meta.label) || stage
    : '任务出错';
  const id = isStage
    ? 'stage:' + (callId || stage)
    : isCall
    ? 'call:' + (callId || eventKey || label)
    : 'error:' + eventKey;
  const state = failed
    ? 'failed'
    : reportedState === 'cancelled' || reportedState === 'canceled'
    ? 'cancelled'
    : reportedState === 'complete' || reportedState === 'completed'
    ? 'complete'
    : event.type === 'stage_end'
    ? 'ended'
    : event.type === 'tool_result'
    ? 'returned'
    : 'running';
  const failedResult =
    state === 'returned' &&
    previous.steps.some(step => step.id === id && step.state === 'failed');
  const detail =
    failed || failedResult
      ? text(meta.error, 1_200) ||
        text(result?.error, 1_200) ||
        text(event.content, 1_200)
      : event.type === 'tool_result'
      ? text(result?.summary, 600) ||
        (!retrieval ? text(event.content, 600) : '')
      : undefined;
  return addStep(previous, { id, label, state, ...(detail ? { detail } : {}) });
}

export function uniqueSourceForUrl(
  sources: readonly RagSource[],
  url: string,
): RagSource | undefined {
  if (!url) return;
  const matches = sources.filter(source => source.urls.includes(url));
  return matches.length === 1 ? matches[0] : undefined;
}
