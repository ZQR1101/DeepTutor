import { Alert } from 'react-native';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import {
  SessionsScreen,
  type SessionsScreenProps,
} from '../src/screens/SessionsScreen';
import type { SessionSummary } from '../src/services/sessionApi';

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
    onRefresh: jest.fn(),
    onLoadMore: jest.fn(),
    onRetry: jest.fn(),
    onRename: jest.fn(async () => {}),
    onDelete: jest.fn(async () => {}),
    ...overrides,
  };
}

test('renders rows and flags the one with a running turn', () => {
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
  expect(screen.getByText('进行中')).toBeTruthy();
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

test('renaming sends the trimmed title the learner typed', async () => {
  const onRename = jest.fn(async () => {});
  render(<SessionsScreen {...sessions({ sessions: [row('a')], onRename })} />);

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

  fireEvent.press(button('重命名'));
  fireEvent.press(button('保存'));

  await waitFor(() =>
    expect(
      screen.getByText('重命名会话失败，请重试。'),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('标题')).toBeTruthy();
});

test('deleting asks before removing anything', () => {
  const onDelete = jest.fn(async () => {});
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    render(<SessionsScreen {...sessions({ sessions: [row('a')], onDelete })} />);
    fireEvent.press(button('删除'));
    expect(onDelete).not.toHaveBeenCalled();
    const choices = alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    choices.find(choice => choice.text === '删除')?.onPress?.();
    expect(onDelete).toHaveBeenCalledWith('a');
  } finally {
    alert.mockRestore();
  }
});

test('a rejected delete is reported without removing the row', async () => {
  const onDelete = jest.fn(async () => {
    throw new Error('nope');
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    render(<SessionsScreen {...sessions({ sessions: [row('a')], onDelete })} />);
    fireEvent.press(button('删除'));
    const choices = alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    choices.find(choice => choice.text === '删除')?.onPress?.();

    await waitFor(() =>
      expect(
        screen.getByText('删除会话失败，请重试。'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('Conversation a')).toBeTruthy();
  } finally {
    alert.mockRestore();
  }
});
