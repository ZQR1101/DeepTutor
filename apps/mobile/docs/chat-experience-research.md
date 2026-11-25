# 移动端聊天渲染与事件调研

## 富文本与滚动

- Web 的 `AssistantResponse` 按消息记忆渲染结果，流式时调整显示节奏，并把思考标签与普通正文拆开。富文本组件按需加载数学和 HTML 插件。移动端可复用这些边界，用原生视图分别承载正文、公式和代码，保留未闭合内容的文本回退。 [Web 答复组件](../../../web/components/common/AssistantResponse.tsx) · [Web 富文本组件](../../../web/components/common/RichMarkdownRenderer.tsx) · [思考标签解析](../../../web/lib/think-segments.ts)
- Web 仅在读者仍位于末端时跟随内容高度变化，并把打开过程或引用视为主动浏览。原生列表可保留这一行为，用列表虚拟化和消息行记忆隔离流式增量。 [Web 自动滚动](../../../web/hooks/useChatAutoScroll.ts)

## 过程记录与恢复

- 实时帧的身份由 `turn_id`、`session_id` 和 `seq` 决定。移动端传输先去重并按序分发，再由当前会话接收匹配的帧。进程重启后的活跃任务从序号零重放。若已经有已保存的答复正文，重放仍可以恢复过程，但原有正文去重规则继续生效。 [协议解析](../../../web/contracts/parse/turn-event.ts) · [共享传输](../../../web/features/chat/transport/TurnRuntimeClient.ts) · [移动端任务恢复](../src/features/chat/MobileChatRuntime.ts)
- `stage_start` 和 `stage_end` 标记服务端阶段。工具调用和返回分别使用 `tool_call` 和 `tool_result`。它们可按服务端的 `metadata.call_id` 归组，工具名称见 `tool_name`、`tool` 或调用帧的正文。返回帧证明工具返回了内容，明确成败见 `metadata.call_state`。`call_kind: rag_retrieval` 也会出现在知识库预检索事件中，即使没有独立的工具调用帧。任意进度文本与 `thinking` 帧均无需转换成百分比或面向学生的思考内容。 [事件生成](../../../deeptutor/runtime/stream_bus.py) · [Python 工具分发](../../../deeptutor/runtime/agentic/tool_dispatch.py) · [TS 工具分发](../../../packages/chat-engine/src/tools/dispatcher.ts) · [知识库预检索](../../../deeptutor/agents/loop/pipeline.py)
- 历史答复的过程预览会保留部分工具和终态帧，但通常省略阶段、进度和来源。按需请求 `GET /api/sessions/{session_id}/messages/{assistant_message_id}/events?after_seq=0&limit=500`，检查响应及事件的会话与任务归属，按递增的 `next_seq` 继续读取。历史帧经 REST 返回，可缺少 WebSocket 的 `protocol_version`，旧消息也可能没有独立的任务记录。使用助手消息的服务端 ID，SQLite ID 为整数，PocketBase ID 为字符串。 [历史接口](../../../deeptutor/api/routers/sessions.py) · [SQLite 历史与预览](../../../deeptutor/services/session/sqlite_store.py) · [PocketBase 历史](../../../deeptutor/services/session/pocketbase_store.py) · [Web 展开加载](../../../web/features/chat/ChatStateAdapter.tsx)

## 知识库来源

- `sources` 帧的 `metadata.sources` 是本轮来源列表，知识库预检索和执行完毕都可能产生这类帧。RAG 条目常见字段为 `type: rag`、`kb_name`、`title`、`source`、`file_name`、`document_key`、`page`、`chunk_id` 和 `content`。有定位信息时可优先展示 `evidence_text`，有些结果只提供短摘录。只有 `query` 和 `kb_name` 时，来源仅能说明执行过检索。 [来源协议](../../../deeptutor/runtime/stream_bus.py) · [RAG 来源整形](../../../deeptutor/tools/builtin/__init__.py) · [LlamaIndex 摘录](../../../deeptutor/services/rag/pipelines/llamaindex/pipeline.py) · [Agent 来源结算](../../../deeptutor/agents/loop/agent_loop.py)
- 普通 RAG 的 `chunk_id` 属于检索索引，不能用来源数组的次序给答复中的 `[1]` 或 `[rag-1]` 配对。精确视觉查找会把同一个文档或图片 URL 写进工具返回的 Markdown 与结构化来源，可以在答复给出同一个链接时关联本轮来源卡片。深度研究中的 `CIT-…` 另有服务端编号契约。 [精确视觉检索](../../../deeptutor/services/rag/source_visuals.py) · [来源页结构](../../../deeptutor/services/rag/source_pages.py) · [深度研究引用](../../../deeptutor/agents/research/pipeline.py)
