import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';

import { ChatScreen, type ChatScreenProps } from '../src/screens/ChatScreen';

// Each test mounts a full screen; without cleanup the next one would see the
// previous tree twice.
afterEach(cleanup);

/**
 * A container's accessible name is derived from its subtree, so a query by role
 * and name can resolve to the wrong element. Match the explicit label instead.
 */
function button(label: string) {
  const match = screen
    .getAllByRole('button')
    .find(node => node.props.accessibilityLabel === label);
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

function chat(overrides: Partial<ChatScreenProps> = {}): ChatScreenProps {
  return {
    connection: 'connected',
    status: 'idle',
    sessionId: null,
    sessionTitle: '',
    messages: [],
    history: 'ready',
    waitingPrompt: null,
    canLeaveTurn: false,
    recovery: null,
    error: null,
    knowledgeBases: [],
    knowledgeOptions: [],
    knowledgeStatus: 'ready',
    knowledgeError: null,
    send: jest.fn(() => true),
    reply: jest.fn(async () => true),
    cancel: jest.fn(async () => {}),
    retryConnection: jest.fn(),
    retrySession: jest.fn(async () => true),
    reset: jest.fn(),
    dismissRecovery: jest.fn(),
    onToggleKnowledge: jest.fn(),
    onRefreshKnowledge: jest.fn(),
    onManageKnowledge: jest.fn(),
    onUploadFiles: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenSessions: jest.fn(),
    ...overrides,
  };
}

test('the header names the open conversation and reaches the list', () => {
  const props = chat({ sessionTitle: 'Fractions', sessionId: 's1' });
  render(<ChatScreen {...props} />);

  expect(screen.getByText('Fractions')).toBeTruthy();
  expect(screen.getByText('已连接 · 已保存到服务器')).toBeTruthy();
  fireEvent.press(button('历史会话'));
  expect(props.onOpenSessions).toHaveBeenCalledTimes(1);
});

test('the composer tools provide separate paths for using a library and uploading files', () => {
  const props = chat();
  render(<ChatScreen {...props} />);

  expect(screen.queryByLabelText('上传文件到知识库')).toBeNull();
  fireEvent.press(button('打开对话工具'));
  fireEvent.press(button('上传文件到知识库'));
  expect(props.onUploadFiles).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('上传文件到知识库')).toBeNull();

  fireEvent.press(button('打开对话工具'));
  fireEvent.press(button('选择知识库'));
  expect(screen.getByText('下一次回答可以参考所选知识库的文档。')).toBeTruthy();
});

test('a running turn offers Stop instead of Send', () => {
  render(<ChatScreen {...chat({ status: 'running' })} />);
  expect(screen.getByText('DeepTutor 正在回复…')).toBeTruthy();
  expect(screen.queryAllByRole('button', { name: '发送' })).toHaveLength(0);
  expect(button('停止')).toBeTruthy();
});

test('a waiting turn asks for the reply the server needs', async () => {
  const reply = jest.fn(async () => true);
  render(
    <ChatScreen
      {...chat({
        status: 'waiting_for_input',
        waitingPrompt: 'Which subject?',
        reply,
      })}
    />,
  );
  expect(screen.getByText('Which subject?')).toBeTruthy();
  // The composer's field and its button are both labelled "回复", so the
  // placeholder is what identifies the input.
  fireEvent.changeText(screen.getByPlaceholderText('输入回复'), 'Math');
  // Submitting clears the draft after the reply resolves, so the press is
  // awaited rather than fired and forgotten.
  await act(async () => {
    fireEvent.press(button('回复'));
  });
  expect(reply).toHaveBeenCalledWith('Math');
});

test('a stopped response says so and accepts the next question', () => {
  render(<ChatScreen {...chat({ status: 'cancelled' })} />);
  expect(screen.getByText('已停止回复。')).toBeTruthy();
  expect(button('发送')).toBeTruthy();
});

test('the knowledge entry names the documents the next question will cite', () => {
  const physics = {
    ref: 'user:kb:physics',
    id: 'user:kb:physics',
    name: 'physics',
    description: '',
    status: 'ready',
    isDefault: false,
    documentCount: 2,
    imageCount: 0,
    chunkCount: 0,
    ragInitialized: true,
    needsReindex: false,
    provider: '',
    assigned: false,
    readOnly: false,
    available: true,
    progress: null,
    lastError: '',
    updatedAt: '',
  };
  const props = chat({
    knowledgeBases: ['user:kb:physics'],
    knowledgeOptions: [physics],
  });
  render(<ChatScreen {...props} />);

  expect(button('知识库 · 1')).toBeTruthy();
  expect(screen.getByText('physics')).toBeTruthy();

  fireEvent.press(button('知识库 · 1'));
  fireEvent.press(screen.getByLabelText('physics'));
  expect(props.onToggleKnowledge).toHaveBeenCalledWith('user:kb:physics');

  fireEvent.press(button('管理'));
  expect(props.onManageKnowledge).toHaveBeenCalledTimes(1);
});

test('a recovered run explains itself and can be dismissed', () => {
  const dismissRecovery = jest.fn();
  render(
    <ChatScreen
      {...chat({
        status: 'recovering',
        recovery: {
          kind: 'resumed',
          message: '已恢复正在进行的回复。',
        },
        dismissRecovery,
      })}
    />,
  );
  expect(
    screen.getByText('已恢复正在进行的回复。'),
  ).toBeTruthy();
  fireEvent.press(button('关闭'));
  expect(dismissRecovery).toHaveBeenCalledTimes(1);
});

test('a conversation the server lost offers a fresh start', () => {
  const reset = jest.fn();
  render(
    <ChatScreen
      {...chat({
        recovery: {
          kind: 'unavailable',
          message: '服务器上已没有此会话。',
        },
        reset,
      })}
    />,
  );
  fireEvent.press(button('新建对话'));
  expect(reset).toHaveBeenCalledTimes(1);
});

test('a failed transcript load can be retried', () => {
  const retrySession = jest.fn(async () => true);
  render(<ChatScreen {...chat({ history: 'failed', retrySession })} />);
  fireEvent.press(button('重试'));
  expect(retrySession).toHaveBeenCalledTimes(1);
});

test('a transcript that failed to load does not accept a question', () => {
  const send = jest.fn(() => true);
  render(
    <ChatScreen
      {...chat({
        history: 'failed',
        sessionId: 'session-1',
        send,
        error: '无法加载此会话。',
      })}
    />,
  );
  fireEvent.changeText(
    screen.getByPlaceholderText('输入你的问题'),
    'What about quarters?',
  );
  const submit = button('发送');
  expect(submit.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(submit);
  expect(send).not.toHaveBeenCalled();
});

test('a failed turn keeps its question and shows the failure', () => {
  render(
    <ChatScreen
      {...chat({
        messages: [
          {
            id: 'm1',
            question: 'Explain entropy',
            answer: '',
            failed: 'The provider timed out.',
            retryable: true,
          },
        ],
      })}
    />,
  );
  expect(screen.getByText('Explain entropy')).toBeTruthy();
  expect(screen.getByText('The provider timed out.')).toBeTruthy();
});
