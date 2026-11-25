import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
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

function CompactAction({ title, label, disabled, onPress }: {
  title: string;
  label?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compactAction,
        { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
      ]}
    >
      <Text style={[styles.compactLabel, { color: theme.text }]}>{title}</Text>
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
  onOpenSettings,
  onOpenSessions,
}: ChatScreenProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
  }

  async function submit() {
    if (!canSubmit) return;
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
        <View style={styles.heading}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.title, { color: theme.text }]}
          >
            {sessionTitle || 'DeepTutor'}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.status, { color: theme.muted }]}
          >
            {connectionCopy[connection]}
            {sessionId ? ' · 已保存到服务器' : ''}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <CompactAction title="历史" label="历史会话" onPress={onOpenSessions} />
          <CompactAction title="新建" label="新建对话" disabled={!canStartNewChat && !canLeaveTurn} onPress={newChat} />
          <CompactAction title="设置" onPress={onOpenSettings} />
        </View>
      </View>

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
                <Text style={[styles.status, { color: theme.muted }]}>
                  提出一个问题，开始对话。
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
        <View style={[styles.inputShell, { borderColor: theme.inputBorder, backgroundColor: theme.background }]}>
          <TextInput
            accessibilityLabel={awaitingInput ? '回复' : '消息'}
            value={draft}
            onChangeText={setDraft}
            editable={composing && !replying}
            placeholder={awaitingInput ? '输入回复' : '输入你的问题'}
            placeholderTextColor={theme.muted}
            selectionColor={theme.primary}
            keyboardAppearance={theme.dark ? 'dark' : 'light'}
            style={[styles.composerInput, { color: theme.text }]}
            multiline
          />
          <View style={styles.composerRow}>
            <CompactAction
              title={knowledgeBases.length ? '知识库 · ' + knowledgeBases.length : '知识库'}
              onPress={() => setPickerOpen(true)}
            />
            {knowledgeNames ? (
              <Text numberOfLines={1} style={[styles.selectedKnowledge, { color: theme.muted }]}>
                {knowledgeNames}
              </Text>
            ) : <View style={styles.selectedKnowledge} />}
            {awaitingInput ? (
              <CompactAction title="停止任务" disabled={replying} onPress={stop} />
            ) : null}
            {composing ? (
              <Action
                title={awaitingInput ? '回复' : '发送'}
                disabled={!canSubmit && !replying}
                busy={replying}
                onPress={submit}
              />
            ) : (
              <Action
                title="停止"
                tone="secondary"
                busy={status === 'cancelling'}
                onPress={stop}
              />
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
    gap: spacing.md,
  },
  heading: { flex: 1, minWidth: 0, gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  compactAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  compactLabel: { fontSize: 14, fontWeight: '600' },
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
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: textSize.heading, fontWeight: '700' },
  composer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inputShell: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  composerInput: { minHeight: 48, maxHeight: 120, padding: spacing.sm, fontSize: 16, lineHeight: 23 },
  selectedKnowledge: { flex: 1, minWidth: 0, fontSize: 12 },
});
