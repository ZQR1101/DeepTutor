import { useCallback, useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppSession } from '../src/appSession';
import { useChatRuntimeContext } from '../src/chatSession';
import { useSessionList } from '../src/features/sessions/useSessionList';
import { SessionsScreen } from '../src/screens/SessionsScreen';
import { ApiClient } from '../src/services/apiClient';
import { SessionApi } from '../src/services/sessionApi';
import { useTheme } from '../src/theme/useTheme';

export default function SessionsRoute() {
  const router = useRouter();
  const session = useAppSession();
  const chat = useChatRuntimeContext();
  const theme = useTheme();

  const api = useMemo(
    () => (session.origin ? new SessionApi(new ApiClient(session.origin)) : null),
    [session.origin],
  );
  const list = useSessionList(api, undefined);
  const refreshList = list.refresh;
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const close = useCallback(() => router.dismissTo('/chat'), [router]);
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, { dx, dy, numberActiveTouches }) =>
      numberActiveTouches === 1 && dx < -16 && -dx > Math.abs(dy) * 1.5,
    onPanResponderRelease: (_, { dx, dy }) => {
      if (dx < -50 && -dx > Math.abs(dy)) close();
    },
  }), [close]);

  const open = useCallback(
    async (sessionId: string) => {
      if (!chat || busySessionId) return;
      if (chat.getSnapshot().sessionId === sessionId) {
        close();
        return;
      }
      setOpenError(null);
      setBusySessionId(sessionId);
      try {
        await chat.openSession(sessionId);
        // A blocked switch leaves the previous conversation in place; a load
        // failure still moves to the chat screen so its retry is reachable.
        if (chat.getSnapshot().sessionId === sessionId) {
          router.replace('/chat');
          return;
        }
        const snapshot = chat.getSnapshot();
        const gone = snapshot.recovery?.kind === 'unavailable';
        setOpenError(
          gone
            ? snapshot.recovery?.message ??
                '服务器上已没有此会话。'
            : snapshot.error ?? '无法打开服务器上的此会话。',
        );
        // A conversation the server no longer has must not linger in the index.
        if (gone) refreshList();
      } finally {
        setBusySessionId(null);
      }
    },
    [busySessionId, chat, close, refreshList, router],
  );

  const newChat = useCallback(() => {
    chat?.reset();
    router.replace('/chat');
  }, [chat, router]);

  if (session.phase !== 'chat' || !chat) return null;

  return (
    <View style={styles.overlay} {...swipe.panHandlers}>
      <View style={[styles.drawer, { borderEndColor: theme.border }]}>
        <SessionsScreen
          sessions={list.sessions}
          status={list.status}
          refreshing={list.refreshing}
          loadingMore={list.loadingMore}
          hasMore={list.hasMore}
          error={openError ?? list.error}
          currentSessionId={chat.sessionId}
          busySessionId={busySessionId}
          onOpen={open}
          onNewChat={newChat}
          onOpenLearning={() => router.replace('/learning')}
          onOpenKnowledge={() => router.replace('/knowledge')}
          onRefresh={list.refresh}
          onLoadMore={list.loadMore}
          onRetry={list.retry}
          onRename={list.rename}
          onDelete={list.remove}
          onSetPinned={list.setPinned}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="收起历史会话"
        onPress={close}
        style={styles.backdrop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  drawer: {
    width: '80%',
    maxWidth: 420,
    borderEndWidth: StyleSheet.hairlineWidth,
  },
});
