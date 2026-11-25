import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Action, ErrorNotice, Field } from '../../components/FormControls';
import { Screen } from '../../components/Screen';
import { documentState } from '../../features/knowledge/refs';
import type { KnowledgeBaseSummary } from '../../services/knowledgeApi';
import { radius, spacing, textSize, useTheme } from '../../theme/useTheme';
import { StateBadge } from './StateBadge';

export type KnowledgeListScreenProps = {
  bases: readonly KnowledgeBaseSummary[];
  status: 'loading' | 'ready' | 'failed';
  refreshing: boolean;
  error: string | null;
  creating: boolean;
  /** Resolves to the reason it failed, or `null` when the base was created. */
  onCreate: (name: string) => Promise<string | null>;
  onOpen: (ref: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onBack: () => void;
};

export function KnowledgeListScreen({
  bases,
  status,
  refreshing,
  error,
  creating,
  onCreate,
  onOpen,
  onRefresh,
  onRetry,
  onBack,
}: KnowledgeListScreenProps) {
  const theme = useTheme();
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const closeCreate = useCallback(() => {
    if (creating) return;
    setComposing(false);
    setName('');
    setCreateError(null);
  }, [creating]);

  const submit = useCallback(async () => {
    const value = name.trim();
    if (!value || creating) return;
    setCreateError(null);
    const failure = await onCreate(value);
    if (failure === null) {
      setComposing(false);
      setName('');
    } else {
      setCreateError(failure);
    }
  }, [creating, name, onCreate]);

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
            style={[styles.title, { color: theme.text }]}
          >
            知识库
          </Text>
          <Text style={[styles.hint, { color: theme.muted }]}>
            文件由服务器解析并建立索引。
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Action title="返回" tone="secondary" onPress={onBack} />
          <Action title="新建" onPress={() => setComposing(true)} />
        </View>
      </View>

      {error ? (
        <View style={styles.noticeRow}>
          <ErrorNotice message={error} />
          {status === 'failed' ? (
            <Action title="重试" tone="secondary" onPress={onRetry} />
          ) : null}
        </View>
      ) : null}

      {status === 'loading' ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.hint, { color: theme.muted }]}>
            正在加载知识库…
          </Text>
        </View>
      ) : (
        <FlatList
          data={bases}
          keyExtractor={base => base.ref}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            status === 'failed' ? null : (
              <View style={styles.center}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  暂无知识库
                </Text>
                <Text style={[styles.hint, { color: theme.muted }]}>
                  新建知识库后，上传你想用来提问的文档。
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const state = documentState(item);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => onOpen(item.ref)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.rowBody}>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowTitle, { color: theme.text }]}
                  >
                    {item.name}
                  </Text>
                  {item.description ? (
                    <Text
                      numberOfLines={2}
                      style={[styles.hint, { color: theme.muted }]}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                  <Text style={[styles.hint, { color: theme.muted }]}>
                    {item.documentCount} 份文档
                    {item.assigned ? ' · 与你共享' : ''}
                    {item.readOnly ? ' · 只读' : ''}
                  </Text>
                </View>
                <StateBadge state={state} />
              </Pressable>
            );
          }}
        />
      )}

      <Modal
        visible={composing}
        transparent
        animationType="fade"
        onRequestClose={closeCreate}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.sheetTitle, { color: theme.text }]}
            >
              新建知识库
            </Text>
            <Text style={[styles.hint, { color: theme.muted }]}>
              输入名称，创建后即可上传文档。
            </Text>
            <Field
              label="名称"
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="生物笔记"
              editable={!creating}
              onSubmitEditing={submit}
            />
            <ErrorNotice message={createError} />
            <View style={styles.sheetActions}>
              <Action
                title="取消"
                tone="secondary"
                disabled={creating}
                onPress={closeCreate}
              />
              <Action
                title="创建"
                busy={creating}
                disabled={!name.trim()}
                onPress={submit}
              />
            </View>
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
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  title: { fontSize: textSize.heading, fontWeight: '700' },
  hint: { fontSize: textSize.small, lineHeight: 20 },
  noticeRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: { fontSize: textSize.heading, fontWeight: '700' },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  rowBody: { flex: 1, gap: spacing.xs },
  rowTitle: { fontSize: textSize.body, fontWeight: '600' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: { fontSize: textSize.heading, fontWeight: '700' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
