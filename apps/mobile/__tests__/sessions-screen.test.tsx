import {
  act,
  cleanup,
  fireEvent,
  render as renderScreen,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  SessionsScreen,
  type SessionsScreenProps,
} from '../src/screens/SessionsScreen';
import type { SessionSummary } from '../src/services/sessionApi';

afterEach(cleanup);

function render(element: React.JSX.Element) {
  return renderScreen(element, {
    wrapper: ({ children }) => (
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}>
        {children}
      </SafeAreaProvider>
    ),
  });
}

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

function row(id: string, overrides: Partial<SessionSummary> = {}) {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: 1,
    updatedAt: 1_700_000_000,
    messageCount: 2,
    lastMessage: '',
    status: 'idle' as const,
    activeTurnId: '',
    ...overrides,
  };
}

function sessions(
  overrides: Partial<SessionsScreenProps> = {},
): SessionsScreenProps {
  return {
    sessions: [],
    status: 'ready',
    refreshing: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    currentSessionId: null,
    busySessionId: null,
    onOpen: jest.fn(),
    onNewChat: jest.fn(),
    onOpenLearning: jest.fn(),
    onOpenKnowledge: jest.fn(),
    onRefresh: jest.fn(),
    onLoadMore: jest.fn(),
    onRetry: jest.fn(),
    onRename: jest.fn(async () => {}),
    onDelete: jest.fn(async () => {}),
    onSetPinned: jest.fn(async () => {}),
    ...overrides,
  };
}

test('shows only the conversation names and still opens the selected row', () => {
  const onOpen = jest.fn();
  render(
    <SessionsScreen
      {...sessions({
        sessions: [row('a'), row('b', { activeTurnId: 'turn-1' })],
        onOpen,
      })}
    />,
  );
  expect(screen.getByText('Conversation a')).toBeTruthy();
  expect(screen.getByText('Conversation b')).toBeTruthy();
  expect(screen.queryByText(/条消息|进行中|\d+\/\d+/)).toBeNull();
  fireEvent.press(screen.getByText('Conversation a'));
  expect(onOpen).toHaveBeenCalledWith('a');
});

test('an empty index invites the first question', () => {
  render(<SessionsScreen {...sessions()} />);
  expect(screen.getByText('暂无历史会话')).toBeTruthy();
});

test('a failed index can be retried', () => {
  const onRetry = jest.fn();
  render(
    <SessionsScreen
      {...sessions({
        status: 'failed',
        error: '无法加载历史会话。',
        onRetry,
      })}
    />,
  );
  fireEvent.press(button('重试'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('a new chat is one press away', () => {
  const onNewChat = jest.fn();
  render(<SessionsScreen {...sessions({ onNewChat })} />);
  fireEvent.press(button('新建'));
  expect(onNewChat).toHaveBeenCalledTimes(1);
});

test('the long-press menu has three actions and dismisses on an outside tap', () => {
  render(<SessionsScreen {...sessions({ sessions: [row('a')] })} />);
  fireEvent(button('Conversation a'), 'longPress');
  expect(button('置顶')).toBeTruthy();
  expect(button('重命名')).toBeTruthy();
  expect(button('删除')).toBeTruthy();
  expect(screen.queryByLabelText('取消')).toBeNull();
  fireEvent.press(screen.getByTestId('session-menu-backdrop', { includeHiddenElements: true }));
  expect(screen.queryByLabelText('置顶')).toBeNull();
});

test('renaming sends the trimmed title the learner typed', async () => {
  const onRename = jest.fn(async () => {});
  render(<SessionsScreen {...sessions({ sessions: [row('a')], onRename })} />);

  expect(screen.queryByLabelText('重命名')).toBeNull();
  fireEvent(button('Conversation a'), 'longPress');
  fireEvent.press(button('重命名'));
  fireEvent.changeText(screen.getByLabelText('标题'), '  Halves  ');
  fireEvent.press(button('保存'));

  await waitFor(() => expect(onRename).toHaveBeenCalledWith('a', 'Halves'));
});

test('a failed rename keeps the dialog open and explains itself', async () => {
  const onRename = jest.fn(async () => {
    throw new Error('nope');
  });
  render(<SessionsScreen {...sessions({ sessions: [row('a')], onRename })} />);

  fireEvent(button('Conversation a'), 'longPress');
  fireEvent.press(button('重命名'));
  fireEvent.press(button('保存'));

  await waitFor(() =>
    expect(
      screen.getByText('重命名会话失败，请重试。'),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('标题')).toBeTruthy();
});

test('deleting asks before removing anything', async () => {
  const onDelete = jest.fn(async () => {});
  render(<SessionsScreen {...sessions({ sessions: [row('a')], onDelete })} />);
  expect(screen.queryByLabelText('删除')).toBeNull();
  fireEvent(button('Conversation a'), 'longPress');
  fireEvent.press(button('删除'));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.press(button('确认删除'));
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith('a'));
});

test('a rejected delete is reported without removing the row', async () => {
  const onDelete = jest.fn(async () => {
    throw new Error('nope');
  });
  render(<SessionsScreen {...sessions({ sessions: [row('a')], onDelete })} />);
  fireEvent(button('Conversation a'), 'longPress');
  fireEvent.press(button('删除'));
  fireEvent.press(button('确认删除'));
  expect(await screen.findByText('删除会话失败，请重试。')).toBeTruthy();
  fireEvent.press(button('取消'));
  expect(screen.getByText('Conversation a')).toBeTruthy();
});

test('pinned conversations are first and long press can pin or unpin', async () => {
  const onSetPinned = jest.fn(async () => {});
  render(<SessionsScreen {...sessions({
    sessions: [row('a'), row('b', { pinned: true })],
    onSetPinned,
  })} />);
  const conversationRows = screen.getAllByRole('button', { name: /^Conversation / });
  expect(conversationRows[0].props.accessibilityLabel).toBe('Conversation b');
  fireEvent(button('Conversation b'), 'longPress');
  await act(async () => {
    fireEvent.press(button('取消置顶'));
  });
  expect(onSetPinned).toHaveBeenCalledWith('b', false);
  expect(screen.queryByLabelText('取消置顶')).toBeNull();
  fireEvent(button('Conversation a'), 'longPress');
  await act(async () => {
    fireEvent.press(button('置顶'));
  });
  expect(onSetPinned).toHaveBeenCalledWith('a', true);
  expect(screen.queryByLabelText('置顶')).toBeNull();
});
