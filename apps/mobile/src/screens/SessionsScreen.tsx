import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Action, ErrorNotice, Field } from '../components/FormControls';
import { Screen } from '../components/Screen';
import { radius, spacing, textSize, useTheme } from '../theme/useTheme';
import type { SessionSummary } from '../services/sessionApi';

export type SessionsScreenProps = {
  sessions: readonly SessionSummary[];
  status: 'loading' | 'ready' | 'failed';
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  currentSessionId: string | null;
  busySessionId: string | null;
  onOpen: (sessionId: string) => void;
  onNewChat: () => void;
  onOpenLearning: () => void;
  onOpenKnowledge: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  onSetPinned: (sessionId: string, pinned: boolean) => Promise<void>;
};

function titleOf(session: SessionSummary): string {
  const title = session.title.trim();
  if (title) return title;
  const preview = session.lastMessage.trim().replace(/\s+/g, ' ');
  return preview ? preview.slice(0, 60) : '未命名会话';
}

const menuWidth = 176;

const menuIcons = {
  pin: 'M16 3l5 5-4 2-3 3v4l-2 2-7-7 2-2h4l3-3 2-4zM8.5 15.5 3 21',
  rename: 'm14.5 5.5 4 4M4 20l1-5L16 4a2.8 2.8 0 0 1 4 4L9 19z',
  delete: 'M4 7h16m-10-3h4l1 3M6 7l1 13h10l1-13M10 10v6m4-6v6',
};

function SessionMenuItem({ label, icon, disabled, busy, onPress }: {
  label: string;
  icon: keyof typeof menuIcons;
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = icon === 'delete' ? theme.error : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: pressed ? theme.secondary : 'transparent' },
      ]}
    >
      {busy ? (
        <ActivityIndicator size={22} color={color} />
      ) : (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d={menuIcons[icon]} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
      <Text style={[styles.menuLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function SessionsScreen({
  sessions,
  status,
  refreshing,
  loadingMore,
  hasMore,
  error,
  currentSessionId,
  busySessionId,
  onOpen,
  onNewChat,
  onOpenLearning,
  onOpenKnowledge,
  onRefresh,
  onLoadMore,
  onRetry,
  onRename,
  onDelete,
  onSetPinned,
}: SessionsScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rowViews = useRef(new Map<string, View>());
  const overlay = useRef<View>(null);
  const [overlayFrame, setOverlayFrame] = useState<LayoutRectangle | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const [dialog, setDialog] = useState<
    | { kind: 'actions'; session: SessionSummary; anchor: LayoutRectangle | null }
    | { kind: 'rename' | 'delete'; session: SessionSummary }
    | null
  >(null);
  const [draft, setDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
    [sessions],
  );

  function openActions(session: SessionSummary) {
    setMenuHeight(0);
    const nextDialog = { kind: 'actions', session, anchor: null } as const;
    setDialog(nextDialog);
    const row = rowViews.current.get(session.id);
    row?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      setDialog(current => current === nextDialog
        ? { ...nextDialog, anchor: { x, y, width, height } }
        : current);
    });
  }

  function closeDialog() {
    if (saving) return;
    setActionError(null);
    setDialog(null);
  }

  async function runAction(action: () => Promise<void>, errorMessage: string) {
    if (saving) return;
    setSaving(true);
    try {
      await action();
      setDialog(null);
    } catch {
      setActionError(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  function saveRename() {
    const title = draft.trim();
    if (!dialog || !title) return;
    return runAction(() => onRename(dialog.session.id, title), '重命名会话失败，请重试。');
  }

  const selected = dialog?.session;
  const menuOpen = dialog?.kind === 'actions';
  const anchor = menuOpen ? dialog.anchor : null;
  let menuPosition;
  if (anchor && overlayFrame) {
    const margin = spacing.sm;
    const width = Math.min(menuWidth, overlayFrame.width - 2 * margin);
    const rowTop = anchor.y - overlayFrame.y;
    const rowRight = anchor.x + anchor.width - overlayFrame.x;
    const below = rowTop + anchor.height + spacing.xs;
    const bottom = overlayFrame.height - insets.bottom - margin;
    const top = below + menuHeight <= bottom ? below : rowTop - menuHeight - spacing.xs;
    menuPosition = {
      position: 'absolute' as const,
      width,
      left: Math.max(margin, Math.min(rowRight - width / 2, overlayFrame.width - width - margin)),
      top: Math.max(margin, Math.min(top, bottom - menuHeight)),
    };
  }
  const loading = status === 'loading';

  return (
    <Screen>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.heading}>
          <Image
            accessible
            accessibilityLabel="DeepTutor"
            accessibilityRole="header"
            source={require('../../assets/deeptutor-wordmark.png')}
            resizeMode="contain"
            style={styles.wordmark}
          />
          <Text style={[styles.hint, { color: theme.muted }]}>
            会话保存在你的 DeepTutor 服务器上。
          </Text>
        </View>
      </View>
      <View style={[styles.drawerLinks, { borderColor: theme.border }]}>
        {[
          { label: '学习记录', onPress: onOpenLearning, icon: 'M7 4h12v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm1 0v16M11 8h5m-5 4h5' },
          { label: '知识库管理', onPress: onOpenKnowledge, icon: 'M4 5h4v14H4zM8 5h4v14H8zM14 6l4-1 3 13-4 1z' },
        ].map(({ label, onPress, icon }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={({ pressed }) => [
              styles.drawerLink,
              { backgroundColor: pressed ? theme.secondary : 'transparent' },
            ]}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d={icon}
                fill="none"
                stroke={theme.text}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.entryLabel, { color: theme.text }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <View style={styles.noticeRow}>
          <ErrorNotice message={error} />
          {status === 'failed' ? (
            <Action title="重试" tone="secondary" onPress={onRetry} />
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.hint, { color: theme.muted }]}>
            正在加载会话…
          </Text>
        </View>
      ) : (
        <FlatList
          data={sortedSessions}
          keyExtractor={session => session.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primary}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !loadingMore) onLoadMore();
          }}
          ListEmptyComponent={
            status === 'failed' ? null : (
              <View style={styles.center}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  暂无历史会话
                </Text>
                <Text style={[styles.hint, { color: theme.muted }]}>
                  发送消息后，会话会出现在这里。
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={styles.footer}
                color={theme.primary}
              />
            ) : null
          }
          renderItem={({ item }) => {
            const current = item.id === currentSessionId;
            const title = titleOf(item);
            return (
              <Pressable
                ref={node => {
                  if (node) rowViews.current.set(item.id, node);
                  else rowViews.current.delete(item.id);
                }}
                collapsable={false}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ selected: current, disabled: Boolean(busySessionId), busy: busySessionId === item.id }}
                accessibilityActions={[{ name: 'longpress', label: '会话操作' }]}
                onAccessibilityAction={({ nativeEvent }) => {
                  if (nativeEvent.actionName === 'longpress' && !busySessionId) {
                    openActions(item);
                  }
                }}
                disabled={Boolean(busySessionId)}
                onPress={() => onOpen(item.id)}
                onLongPress={() => openActions(item)}
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed || busySessionId === item.id ? 0.6 : 1 },
                ]}
              >
                <Text numberOfLines={1} style={[styles.entryLabel, { color: current ? theme.primary : theme.text }]}>
                  {title}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <View style={styles.bottomBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建"
          onPress={onNewChat}
          style={({ pressed }) => [
            styles.newChat,
            { backgroundColor: theme.primary, opacity: pressed ? 0.76 : 1 },
          ]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M12 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-7m-8 1 1-4 6-6 3 3-6 6-4 1z"
              fill="none"
              stroke={theme.onPrimary}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={[styles.newChatLabel, { color: theme.onPrimary }]}>新建</Text>
        </Pressable>
      </View>

      <Modal
        visible={dialog !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDialog}
      >
        <View
          ref={overlay}
          collapsable={false}
          onLayout={() => overlay.current?.measureInWindow((x, y, width, height) => {
            if (width > 0 && height > 0) setOverlayFrame({ x, y, width, height });
          })}
          style={[styles.backdrop, menuOpen && styles.menuBackdrop]}
        >
          {menuOpen ? (
            <Pressable
              accessible={false}
              testID="session-menu-backdrop"
              disabled={saving}
              onPress={closeDialog}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={closeDialog}
            onLayout={menuOpen ? event => setMenuHeight(event.nativeEvent.layout.height) : undefined}
            style={[
              styles.dialog,
              menuOpen && styles.menuDialog,
              menuPosition,
              anchor && (!menuPosition || !menuHeight) && styles.measuringMenu,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            {dialog && !menuOpen ? (
              <Text accessibilityRole="header" style={[styles.emptyTitle, { color: theme.text }]}>
                {dialog.kind === 'rename' ? '重命名会话' : '删除此会话？'}
              </Text>
            ) : null}
            {menuOpen && selected ? (
              <View>
                <SessionMenuItem
                  icon="pin"
                  label={selected.pinned ? '取消置顶' : '置顶'}
                  disabled={saving}
                  busy={saving}
                  onPress={() => runAction(
                    () => onSetPinned(selected.id, !selected.pinned),
                    selected.pinned ? '取消置顶失败，请重试。' : '置顶失败，请重试。',
                  )}
                />
                <SessionMenuItem icon="rename" label="重命名" disabled={saving} onPress={() => {
                  setActionError(null);
                  setDraft(titleOf(selected));
                  setDialog({ kind: 'rename', session: selected });
                }} />
                <SessionMenuItem icon="delete" label="删除" disabled={saving} onPress={() => {
                  setActionError(null);
                  setDialog({ kind: 'delete', session: selected });
                }} />
              </View>
            ) : null}
            {dialog?.kind === 'rename' ? (
              <Field
                label="标题"
                value={draft}
                onChangeText={setDraft}
                autoFocus
                editable={!saving}
                maxLength={200}
                returnKeyType="done"
                onSubmitEditing={saveRename}
              />
            ) : null}
            {dialog?.kind === 'delete' && selected ? (
              <Text style={[styles.hint, { color: theme.muted }]}>
                {`服务器上的「${titleOf(selected)}」及其中的消息将被删除。`}
              </Text>
            ) : null}
            <ErrorNotice message={actionError} />
            {dialog && !menuOpen ? <View style={styles.dialogActions}>
              <Action title="取消" tone="secondary" disabled={saving} onPress={closeDialog} />
              {dialog?.kind === 'rename' ? (
                <Action title="保存" disabled={!draft.trim()} busy={saving} onPress={saveRename} />
              ) : null}
              {dialog?.kind === 'delete' && selected ? (
                <Action title="确认删除" busy={saving} onPress={() => runAction(
                  () => onDelete(selected.id),
                  '删除会话失败，请重试。',
                )} />
              ) : null}
            </View> : null}
          </View>
        </View>
      </Modal>
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
  heading: { flex: 1, gap: spacing.xs },
  wordmark: { width: '100%', maxWidth: 180, height: 38 },
  drawerLinks: { paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  drawerLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  entryLabel: { fontSize: textSize.small, fontWeight: '600' },
  hint: { fontSize: textSize.small, lineHeight: 20 },
  noticeRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: textSize.body, fontWeight: '700' },
  footer: { paddingVertical: spacing.lg },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  bottomBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  newChat: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 24,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  newChatLabel: { fontSize: textSize.body, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menuBackdrop: { backgroundColor: 'rgba(0,0,0,0.16)' },
  dialog: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  menuDialog: { width: '100%', maxWidth: menuWidth, alignSelf: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  measuringMenu: { opacity: 0 },
  menuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  menuLabel: { fontSize: textSize.body, fontWeight: '600', flexShrink: 1 },
});
