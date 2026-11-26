import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { RuntimeConnectionState } from '@/features/chat/transport/TurnRuntimeClient';
import type {
  ChatStatus,
  HistoryState,
  RecoveryNotice,
} from '../features/chat/MobileChatRuntime';
import type { ChatExchange } from '../features/sessions/history';
import { ChatExchangeRow, type LoadMessageDetails } from '../features/chat/ChatExchangeRow';
import type { KnowledgeBaseSummary } from '../services/knowledgeApi';
import { Action, ErrorNotice } from '../components/FormControls';
import { Screen } from '../components/Screen';
import { KnowledgePicker, displayRef } from './knowledge/KnowledgePicker';
import { radius, spacing, textSize, useTheme } from '../theme/useTheme';

export type ChatScreenProps = {
  connection: RuntimeConnectionState;
  status: ChatStatus;
  sessionId: string | null;
  sessionTitle: string;
  messages: readonly ChatExchange[];
  activeMessageId?: string | null;
  loadMessageDetails?: LoadMessageDetails;
  history: HistoryState;
  waitingPrompt: string | null;
  canLeaveTurn: boolean;
  recovery: RecoveryNotice | null;
  error: string | null;
  /** Knowledge bases the next question is answered from. */
  knowledgeBases: readonly string[];
  knowledgeOptions: readonly KnowledgeBaseSummary[];
  knowledgeStatus: 'loading' | 'ready' | 'failed';
  knowledgeError: string | null;
  send: (text: string) => boolean;
  reply: (text: string) => Promise<boolean>;
  cancel: () => Promise<void>;
  retryConnection: () => void;
  retrySession: () => Promise<boolean>;
  reset: () => void;
  dismissRecovery: () => void;
  onToggleKnowledge: (ref: string) => void;
  onRefreshKnowledge: () => void;
  onManageKnowledge: () => void;
  onUploadFiles: () => void;
  onOpenSettings: () => void;
  onOpenSessions: () => void;
};

const connectionCopy: Record<RuntimeConnectionState, string> = {
  idle: '未连接',
  connecting: '正在连接…',
  connected: '已连接',
  recovering: '正在重新连接…',
  stopped: '未连接',
};

const icons = {
  history: 'M4 6h16M4 12h16M4 18h10',
  newChat: 'M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9m-2 10 1-4 6-6 3 3-6 6-4 1z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  add: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  send: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M7 7h10v10H7z',
  library: 'M4 5h5v14H4zM9 5h5v14H9zM15 6l3-1 3 13-3 1z',
  upload: 'M7 19H5V5h8l5 5v2m-5-7v5h5m-3 11v-7m-4 4 4-4 4 4',
};

function ChatIcon({ icon, color }: { icon: keyof typeof icons; color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Path d={icons[icon]} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconButton({ icon, label, disabled, expanded, primary, busy, onPress }: {
  icon: keyof typeof icons;
  label: string;
  disabled?: boolean;
  expanded?: boolean;
  primary?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = primary ? theme.onPrimary : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), expanded, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: primary ? theme.primary : theme.secondary,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={color} /> : <ChatIcon icon={icon} color={color} />}
    </Pressable>
  );
}

const exchangeKey = (item: ChatExchange) => item.id;

/** Statuses where the user may compose the next question. */
function isComposingStatus(status: ChatStatus): boolean {
  return (
    status === 'idle' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

function progressCopy(status: ChatStatus): string | null {
  switch (status) {
    case 'submitting':
      return '正在发送…';
    case 'running':
      return 'DeepTutor 正在回复…';
    case 'cancelling':
      return '正在停止…';
    case 'recovering':
      return '正在检查服务器上的回复…';
    default:
      return null;
  }
}

export function ChatScreen({
  connection,
  status,
  sessionId,
  sessionTitle,
  messages,
  activeMessageId,
  loadMessageDetails,
  history,
  waitingPrompt,
  canLeaveTurn,
  recovery,
  error,
  knowledgeBases,
  knowledgeOptions,
  knowledgeStatus,
  knowledgeError,
  send,
  reply,
  cancel,
  retryConnection,
  retrySession,
  reset,
  dismissRecovery,
  onToggleKnowledge,
  onRefreshKnowledge,
  onManageKnowledge,
  onUploadFiles,
  onOpenSettings,
  onOpenSessions,
}: ChatScreenProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const list = useRef<FlatList<ChatExchange>>(null);
  const follow = useRef(true);
  const awaitingInput = status === 'waiting_for_input';
  // A turn parked on a question is still live, so the composer must accept the
  // reply — but starting a different chat would abandon it.
  const composing = isComposingStatus(status) || awaitingInput;
  const canStartNewChat = isComposingStatus(status);
  // The transcript has to be in hand before a question is appended to it: a
  // conversation still loading, or one that failed to load, would otherwise
  // answer with history the learner cannot see.
  const transcriptReady = history === 'idle' || history === 'ready';
  const canSubmit =
    composing &&
    connection === 'connected' &&
    transcriptReady &&
    !replying &&
    !!draft.trim();
  const progress = progressCopy(status);
  // The selection stores server refs; the header shows readable names.
  const knowledgeNames = knowledgeBases
    .map(
      ref =>
        knowledgeOptions.find(option => option.ref === ref)?.name ??
        displayRef(ref),
    )
    .join('、');

  const browse = useCallback(() => { follow.current = false; }, []);
  const followLatest = useCallback(() => {
    if (follow.current) list.current?.scrollToEnd({ animated: false });
  }, []);

  const settleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    follow.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y < 42;
  }, []);

  const renderExchange = useCallback(({ item }: ListRenderItemInfo<ChatExchange>) => (
    <ChatExchangeRow
      key={JSON.stringify([sessionId, item.id, item.assistantMessageId, item.eventHistoryTurnId])}
      item={item}
      active={item.id === activeMessageId}
      sessionId={sessionId}
      loadMessageDetails={loadMessageDetails}
      onBrowse={browse}
    />
  ), [activeMessageId, browse, loadMessageDetails, sessionId]);

  function newChat() {
    reset();
    follow.current = true;
    setDraft('');
    setActionError(null);
    setToolsOpen(false);
  }

  async function submit() {
    if (!canSubmit) return;
    setToolsOpen(false);
    setActionError(null);
    follow.current = true;
    if (!awaitingInput) {
      if (send(draft.trim())) setDraft('');
      return;
    }
    setReplying(true);
    try {
      if (await reply(draft.trim())) setDraft('');
    } catch {
      setActionError('发送回复失败，请重试。');
    } finally {
      setReplying(false);
    }
  }

  async function stop() {
    setActionError(null);
    try {
      await cancel();
    } catch {
      setActionError('停止回复失败，请重试。');
    }
  }

  return (
    <Screen>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.headerSide}>
          <IconButton icon="history" label="历史会话" onPress={() => {
            Keyboard.dismiss();
            onOpenSessions();
          }} />
        </View>
        <Text accessibilityRole="header" style={[styles.headerTitle, { color: theme.text }]}>聊天</Text>
        <View style={[styles.headerSide, styles.headerActions]}>
          <IconButton icon="settings" label="设置" onPress={onOpenSettings} />
          <IconButton icon="newChat" label="新建对话" disabled={!canStartNewChat && !canLeaveTurn} onPress={newChat} />
        </View>
      </View>
      <View style={styles.chatBody}>
        {sessionTitle || sessionId || connection !== 'connected' ? (
          <View style={styles.heading}>
            {sessionTitle ? (
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, { color: theme.text }]}
              >
                {sessionTitle}
              </Text>
            ) : null}
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.status, { color: theme.muted }]}
            >
              {connectionCopy[connection]}
              {sessionId ? ' · 已保存到服务器' : ''}
            </Text>
          </View>
        ) : null}

        {recovery ? (
          <View style={styles.bannerRow}>
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.banner,
                { color: theme.text, backgroundColor: theme.secondary },
              ]}
            >
              {recovery.message}
            </Text>
            <View style={styles.bannerActions}>
              {recovery.kind === 'unavailable' ? null : (
                <Action
                  title="关闭"
                  tone="secondary"
                  onPress={dismissRecovery}
                />
              )}
            </View>
          </View>
        ) : null}

        {history === 'loading' ? (
          <View style={styles.center} accessibilityLiveRegion="polite">
            <Text style={[styles.status, { color: theme.muted }]}>
              正在加载会话…
            </Text>
          </View>
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={exchangeKey}
            contentContainerStyle={styles.conversation}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={browse}
            onScrollEndDrag={settleScroll}
            onMomentumScrollBegin={browse}
            onMomentumScrollEnd={settleScroll}
            onContentSizeChange={followLatest}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            renderItem={renderExchange}
            ListEmptyComponent={
              history === 'failed' ? (
                <View style={styles.center}>
                  <Text style={[styles.status, { color: theme.muted }]}>
                    无法加载此会话。
                  </Text>
                  <Action
                    title="重试"
                    tone="secondary"
                    onPress={() => retrySession()}
                  />
                </View>
              ) : (
                <View style={styles.empty}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.emptyTitle, { color: theme.text }]}
                  >
                    今天想学什么？
                  </Text>
                </View>
              )
            }
          />
        )}

        <View
          style={[
            styles.composer,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <ErrorNotice message={actionError || error} />
          {connection === 'stopped' || connection === 'idle' || canLeaveTurn ? (
            <Action
              title="重新连接"
              tone="secondary"
              onPress={retryConnection}
            />
          ) : null}
          {awaitingInput ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.status, { color: theme.text }]}
            >
              {waitingPrompt || 'DeepTutor 正在等你回复。'}
            </Text>
          ) : null}
          {progress ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.status, { color: theme.muted }]}
            >
              {progress}
            </Text>
          ) : null}
          {status === 'cancelled' ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.status, { color: theme.muted }]}
            >
              已停止回复。
            </Text>
          ) : null}
          {toolsOpen ? (
            <View style={[styles.tools, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="选择知识库" style={styles.toolAction} onPress={() => {
                setToolsOpen(false);
                setPickerOpen(true);
              }}>
                <ChatIcon icon="library" color={theme.primary} />
                <Text style={[styles.toolLabel, { color: theme.text }]}>选择知识库</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="上传文件到知识库" style={styles.toolAction} onPress={() => {
                setToolsOpen(false);
                onUploadFiles();
              }}>
                <ChatIcon icon="upload" color={theme.primary} />
                <Text style={[styles.toolLabel, { color: theme.text }]}>上传文件到知识库</Text>
              </Pressable>
            </View>
          ) : null}
          {knowledgeNames ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`知识库 · ${knowledgeBases.length}`}
              onPress={() => {
                Keyboard.dismiss();
                setToolsOpen(false);
                setPickerOpen(true);
              }}
              style={[styles.knowledgeChip, { backgroundColor: theme.secondary }]}
            >
              <ChatIcon icon="library" color={theme.primary} />
              <Text numberOfLines={1} style={[styles.knowledgeName, { color: theme.text }]}>{knowledgeNames}</Text>
            </Pressable>
          ) : null}
          {awaitingInput ? (
            <Action title="停止任务" tone="secondary" disabled={replying} onPress={stop} />
          ) : null}
          <View style={[styles.inputShell, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <IconButton
              icon={toolsOpen ? 'close' : 'add'}
              label={toolsOpen ? '关闭对话工具' : '打开对话工具'}
              expanded={toolsOpen}
              onPress={() => {
                if (!toolsOpen) Keyboard.dismiss();
                setToolsOpen(!toolsOpen);
              }}
            />
            <TextInput
              accessibilityLabel={awaitingInput ? '回复' : '消息'}
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setToolsOpen(false)}
              editable={composing && !replying}
              placeholder={awaitingInput ? '输入回复' : '输入你的问题'}
              placeholderTextColor={theme.muted}
              selectionColor={theme.primary}
              keyboardAppearance={theme.dark ? 'dark' : 'light'}
              style={[styles.composerInput, { color: theme.text }]}
              multiline
            />
            {composing ? (
              <IconButton icon="send" label={awaitingInput ? '回复' : '发送'} primary disabled={!canSubmit && !replying} busy={replying} onPress={submit} />
            ) : (
              <IconButton icon="stop" label="停止" primary busy={status === 'cancelling'} onPress={stop} />
            )}
          </View>
        </View>

      </View>
      <KnowledgePicker
        visible={pickerOpen}
        bases={knowledgeOptions}
        selected={knowledgeBases}
        status={knowledgeStatus}
        error={knowledgeError}
        onToggle={onToggleKnowledge}
        onClose={() => setPickerOpen(false)}
        onRefresh={onRefreshKnowledge}
        onManage={() => {
          setPickerOpen(false);
          onManageKnowledge();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 2 },
  headerSide: { flex: 1, minWidth: 92 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  chatBody: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  iconButton: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  status: { fontSize: 13, lineHeight: 19 },
  bannerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  banner: {
    padding: spacing.md,
    borderRadius: radius.sm,
    fontSize: textSize.small,
    lineHeight: 20,
  },
  bannerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  conversation: { flexGrow: 1, padding: spacing.lg, gap: spacing.xl },
  empty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: textSize.heading, fontWeight: '700' },
  composer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tools: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.xs },
  toolAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 48 },
  toolLabel: { fontSize: textSize.body, fontWeight: '600', flexShrink: 1 },
  knowledgeChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md },
  knowledgeName: { flexShrink: 1, fontSize: textSize.small },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 22,
    padding: spacing.xs,
  },
  composerInput: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.sm, paddingVertical: 10, fontSize: 16, lineHeight: 23 },
});
