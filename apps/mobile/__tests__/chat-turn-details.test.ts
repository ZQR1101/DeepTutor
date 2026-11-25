import { ApiClient } from '../src/services/apiClient';
import { SessionApi } from '../src/services/sessionApi';
import {
  emptyTurnDetails,
  projectTurnEvent,
  uniqueSourceForUrl,
} from '../src/features/chat/turnDetails';

test('uses server state and keeps reasoning and tool arguments out of the display', () => {
  const call = { call_id: 'c1', tool: 'rag', call_kind: 'rag_retrieval' };
  const events = [
    { type: 'thinking', content: 'private draft' },
    { type: 'stage_start', stage: 'exploring' },
    {
      type: 'tool_call',
      metadata: { ...call, args: { secret: 'private arg' } },
    },
    { type: 'tool_result', content: 'returned', metadata: call },
    {
      type: 'progress',
      metadata: {
        ...call,
        trace_kind: 'call_status',
        call_state: 'error',
        error: 'index unavailable',
      },
    },
    { type: 'stage_end', stage: 'exploring' },
  ];
  const before = events
    .slice(0, 4)
    .reduce((state, event) => projectTurnEvent(state, event), emptyTurnDetails);
  expect(before.steps.map(step => step.state)).toEqual(['running', 'returned']);
  const after = events
    .slice(4)
    .reduce((state, event) => projectTurnEvent(state, event), before);
  expect(after.steps).toEqual([
    { id: 'stage:exploring', label: '查找解题线索', state: 'ended' },
    {
      id: 'call:c1',
      label: '检索知识库',
      state: 'failed',
      detail: 'index unavailable',
    },
  ]);
  expect(JSON.stringify(after)).not.toContain('private');
});

test('deduplicates source frames, keeps evidence, and associates only exact unambiguous URLs', () => {
  const url = '/api/knowledge-bases/demo/source-page?id=chapter.pdf#page=5';
  const source = {
    type: 'rag',
    kb_name: 'demo',
    title: 'chapter.pdf',
    chunk_id: 'chunk',
    url,
    page: 5,
  };
  const before = projectTurnEvent(emptyTurnDetails, {
    type: 'sources',
    metadata: {
      sources: [
        { type: 'rag', kb_name: 'demo', query: 'query alone' },
        { ...source, content: 'short' },
      ],
    },
  });
  const after = projectTurnEvent(before, {
    type: 'sources',
    metadata: { sources: [{ ...source, evidence_text: 'the full evidence' }] },
  });
  expect(after.sources).toHaveLength(1);
  expect(after.sources[0]).toMatchObject({
    document: 'chapter.pdf',
    knowledgeBase: 'demo',
    excerpt: 'the full evidence',
    page: 5,
  });
  expect(uniqueSourceForUrl(after.sources, url)).toBe(after.sources[0]);
  expect(uniqueSourceForUrl(after.sources, '#page=5')).toBeUndefined();
  const ambiguous = projectTurnEvent(after, {
    type: 'sources',
    metadata: { sources: [{ ...source, chunk_id: 'different' }] },
  });
  expect(uniqueSourceForUrl(ambiguous.sources, url)).toBeUndefined();
});

test('an LLM round is not a tool call and a tool failure can supply its detail later', () => {
  const modelStep = projectTurnEvent(emptyTurnDetails, {
    type: 'progress',
    metadata: {
      trace_group: 'stage',
      trace_kind: 'call_status',
      call_kind: 'agent_loop_round',
      call_id: 'round-1',
      call_state: 'running',
    },
  });
  expect(modelStep).toBe(emptyTurnDetails);
  const failed = projectTurnEvent(modelStep, {
    type: 'progress',
    metadata: {
      trace_group: 'tool_call',
      trace_kind: 'call_status',
      call_id: 'call-1',
      tool: 'rag',
      call_state: 'error',
    },
  });
  const returned = projectTurnEvent(failed, {
    type: 'tool_result',
    metadata: { call_id: 'call-1', tool: 'rag' },
    content: '索引不可用',
  });
  expect(returned.steps).toEqual([
    {
      id: 'call:call-1',
      label: '检索知识库',
      state: 'failed',
      detail: '索引不可用',
    },
  ]);
});

test('history requests the selected assistant journal and validates history scope', async () => {
  const mock = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 's1',
        message_id: 42,
        turn_id: 't1',
        complete: false,
        next_seq: 2,
        events: [
          { type: 'stage_start', stage: 'exploring', seq: 2, turn_id: 't1' },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 's1',
        message_id: 42,
        turn_id: 't1',
        complete: true,
        events: [
          {
            type: 'tool_call',
            seq: 2,
            turn_id: 't1',
            metadata: { tool: 'rag' },
          },
          {
            type: 'tool_result',
            seq: 3,
            turn_id: 't2',
            metadata: { tool: 'rag' },
          },
          { type: 'stage_end', stage: 'exploring', seq: 4, turn_id: 't1' },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'other',
        message_id: 42,
        turn_id: 't1',
        complete: true,
        events: [],
      }),
    });
  const api = new SessionApi(new ApiClient('http://127.0.0.1:8001', mock));
  const signal = new AbortController().signal;
  const details = await api.getMessageDetails('s1', '42', 't1', signal);
  expect(details.steps).toHaveLength(1);
  expect(details.steps[0].state).toBe('ended');
  expect(mock.mock.calls.map(call => call[0])).toEqual([
    'http://127.0.0.1:8001/api/sessions/s1/messages/42/events?workspace_id=&after_seq=0&limit=200',
    'http://127.0.0.1:8001/api/sessions/s1/messages/42/events?workspace_id=&after_seq=2&limit=200',
  ]);
  await expect(
    api.getMessageDetails('s1', '42', 't1', signal),
  ).rejects.toMatchObject({
    kind: 'invalid-response',
  });
});
