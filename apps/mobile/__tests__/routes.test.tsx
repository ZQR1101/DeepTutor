import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { useEffect, useState } from 'react';
import { parse } from 'query-string';
import RootLayout from '../app/_layout';
import { redirectSystemPath } from '../app/+native-intent';
import ChatRoute from '../app/chat';
import SessionsRoute from '../app/sessions';
import IndexRoute from '../app/index';
import KnowledgeDetailRoute from '../app/knowledge/detail';
import KnowledgeListRoute from '../app/knowledge/index';
import LearningRoute from '../app/learning';
import LoginRoute from '../app/login';
import ServerRoute from '../app/server';
import SettingsRoute from '../app/settings';
import { useChatRuntime } from '../src/features/chat/useChatRuntime';
import { useServerSession } from '../src/features/server/useServerSession';

jest.mock('../src/features/server/useServerSession', () => ({
  useServerSession: jest.fn(),
}));
jest.mock('../src/features/chat/useChatRuntime', () => ({
  useChatRuntime: jest.fn(),
}));

const routes = {
  _layout: RootLayout,
  index: IndexRoute,
  server: ServerRoute,
  login: LoginRoute,
  chat: ChatRoute,
  sessions: SessionsRoute,
  settings: SettingsRoute,
  learning: LearningRoute,
  'knowledge/index': KnowledgeListRoute,
  'knowledge/detail': KnowledgeDetailRoute,
};

const origin = 'https://tutor.example.test';
const mockServer = jest.mocked(useServerSession);
const mockChat = jest.mocked(useChatRuntime);
const send = jest.fn((_text: string) => true);

test('native intents allow known routes and reject input the app does not use', () => {
  expect(redirectSystemPath({ path: 'deeptutor-mobile://chat' })).toBe('/chat');
  expect(redirectSystemPath({ path: 'deeptutor-mobile:///settings' })).toBe(
    '/settings',
  );
  expect(redirectSystemPath({ path: '/chat?extra=x' })).toBe('/');
  expect(redirectSystemPath({ path: 'https://elsewhere.example/chat' })).toBe(
    '/',
  );
  expect(redirectSystemPath({ path: '/unknown' })).toBe('/');
  expect(redirectSystemPath({ path: '/'.repeat(300) })).toBe('/');
  expect(redirectSystemPath({ path: '/chat?x=%E0%A4' })).toBe('/');
});

test('query-string still decodes valid and malformed parameters with the SDK-compatible patch', () => {
  expect(parse('word=hello%20world&word=ok&odd=%E0%A4')).toMatchObject({
    word: ['hello world', 'ok'],
    odd: expect.any(String),
  });
});

function mockSession(initial: 'connect' | 'login' | 'chat') {
  mockServer.mockImplementation(function useMockSession() {
    const [phase, setPhase] = useState(initial);
    return {
      phase,
      network: phase === 'connect' ? 'unknown' : 'online',
      origin: phase === 'connect' ? null : origin,
      busy: false,
      error: null,
      status: {
        enabled: true,
        authenticated: phase === 'chat',
        accountId: phase === 'chat' ? 'account-1' : '',
      },
      connect: async () => setPhase('login'),
      login: async () => setPhase('chat'),
      logout: async () => setPhase('login'),
      disconnect: async () => setPhase('connect'),
      refreshAuth: async () => phase === 'chat',
      invalidateAuth: () => setPhase('login'),
    };
  });
}

function chatRuntime() {
  const state = {
    connection: 'connected' as const,
    status: 'idle' as const,
    sessionId: null,
    sessionTitle: '',
    messages: [],
    history: 'ready' as const,
    waitingPrompt: null,
    canLeaveTurn: false,
    recovery: null,
    error: null,
    knowledgeBases: [] as string[],
    knowledgeBasesTouched: false,
  };
  return {
    ...state,
    getSnapshot: () => state,
    send,
    reply: async () => true,
    cancel: async () => {},
    retryConnection: () => {},
    retrySession: async () => false,
    reset: () => {},
    openSession: async () => false,
    dismissRecovery: () => {},
    setKnowledgeBases: () => {},
    toggleKnowledgeBase: () => {},
  } as unknown as ReturnType<typeof useChatRuntime>;
}

beforeEach(() => {
  send.mockClear();
  mockChat.mockClear();
  mockChat.mockReturnValue(chatRuntime());
});

test('a warm chat link reuses the existing runtime with Settings open', async () => {
  mockSession('chat');
  const initialChat = mockChat({ origin, account: 'account-1' });
  const mount = jest.fn();
  mockChat.mockImplementation(function useMountedChat() {
    useEffect(mount, []);
    return initialChat;
  });
  const { getPathname } = renderRouter(routes);
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  fireEvent.press(screen.getByRole('button', { name: '设置' }));
  await waitFor(() => expect(getPathname()).toBe('/settings'));
  testRouter.navigate(redirectSystemPath({ path: 'deeptutor-mobile://chat' }));
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  expect(mount).toHaveBeenCalledTimes(1);
});

test('closing history returns to the same chat with its draft intact', async () => {
  mockSession('chat');
  const { getPathname } = renderRouter(routes);
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  fireEvent.changeText(screen.getByPlaceholderText('输入你的问题'), '未发送的草稿');
  fireEvent.press(screen.getByRole('button', { name: '历史会话' }));
  await waitFor(() => expect(getPathname()).toBe('/sessions'));
  fireEvent.press(screen.getByRole('button', { name: '收起历史会话' }));
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  expect(screen.getByDisplayValue('未发送的草稿')).toBeTruthy();
});

test('the drawer opens blank learning records and back returns directly to the chat draft', async () => {
  mockSession('chat');
  const { getPathname } = renderRouter(routes);
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  fireEvent.changeText(screen.getByPlaceholderText('输入你的问题'), '复习计划');
  expect(screen.queryByLabelText('学习记录')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: '历史会话' }));
  await waitFor(() => expect(getPathname()).toBe('/sessions'));
  fireEvent.press(screen.getByRole('button', { name: '学习记录' }));
  await waitFor(() => expect(getPathname()).toBe('/learning'));
  expect(screen.queryByRole('button', { name: '收起历史会话' })).toBeNull();
  expect(screen.queryByPlaceholderText('输入你的问题')).toBeNull();
  expect(screen.getByRole('header', { name: '学习记录' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '返回聊天' }));
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  expect(screen.getByDisplayValue('复习计划')).toBeTruthy();
});

test('the drawer opens the knowledge management page', async () => {
  mockSession('chat');
  const { getPathname } = renderRouter(routes);
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  fireEvent.press(screen.getByRole('button', { name: '历史会话' }));
  await waitFor(() => expect(getPathname()).toBe('/sessions'));
  fireEvent.press(screen.getByRole('button', { name: '知识库管理' }));
  await waitFor(() => expect(getPathname()).toBe('/knowledge'));
  fireEvent.press(screen.getByRole('button', { name: '返回' }));
  await waitFor(() => expect(getPathname()).toBe('/chat'));
});

test('a protected deep link routes to server setup while disconnected', async () => {
  mockSession('connect');
  const { getPathname } = renderRouter(routes, { initialUrl: '/chat' });
  await waitFor(() => expect(getPathname()).toBe('/server'));
  expect(mockChat).not.toHaveBeenCalled();
});

test('connecting opens login, and signing out removes protected history', async () => {
  mockSession('connect');
  const { getPathname } = renderRouter(routes);
  await waitFor(() => expect(getPathname()).toBe('/server'));
  fireEvent.changeText(screen.getByLabelText('服务器地址'), origin);
  fireEvent.press(screen.getByRole('button', { name: '连接' }));
  await waitFor(() => expect(getPathname()).toBe('/login'));
  fireEvent.changeText(screen.getByLabelText('用户名'), 'learner');
  fireEvent.changeText(screen.getByLabelText('密码'), 'a-test-password');
  fireEvent.press(screen.getByRole('button', { name: '登录' }));
  await waitFor(() => expect(getPathname()).toBe('/chat'));
  fireEvent.press(screen.getByRole('button', { name: '设置' }));
  await waitFor(() => expect(getPathname()).toBe('/settings'));
  expect(testRouter.canGoBack()).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() => expect(getPathname()).toBe('/login'));
  expect(testRouter.canGoBack()).toBe(false);
});
