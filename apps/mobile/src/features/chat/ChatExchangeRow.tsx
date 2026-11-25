import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ChatExchange } from '../sessions/history';
import type { SessionApi } from '../../services/sessionApi';
import { Action, ErrorNotice } from '../../components/FormControls';
import { radius, spacing, useTheme } from '../../theme/useTheme';
import { CopyText, MarkdownMessage } from './render/MarkdownMessage';
import { visibleAnswer } from './render/markdown';
import {
  emptyTurnDetails,
  uniqueSourceForUrl,
  type RagSource,
  type StepState,
  type TurnDetails,
} from './turnDetails';

const stepLabels: Record<StepState, string> = {
  running: '已开始',
  returned: '已返回',
  ended: '已结束',
  complete: '已完成',
  failed: '出错',
  cancelled: '已取消',
};

function sourceContext(source: RagSource): string {
  return [
    source.knowledgeBase && '知识库 · ' + source.knowledgeBase,
    source.page && '第 ' + source.page + ' 页',
  ]
    .filter(Boolean)
    .join(' · ');
}

function SourceCard({
  source,
  open,
  onPress,
}: {
  source: RagSource;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const context = sourceContext(source);
  return (
    <View style={[styles.source, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onPress}
      >
        <Text
          numberOfLines={open ? undefined : 2}
          style={[styles.title, { color: theme.text }]}
        >
          {source.document || '检索摘录'}
        </Text>
        {context ? (
          <Text style={[styles.small, { color: theme.muted }]}>{context}</Text>
        ) : null}
      </Pressable>
      {open ? (
        <Text selectable style={[styles.excerpt, { color: theme.text }]}>
          {source.excerpt || '服务器未返回原文摘录。'}
        </Text>
      ) : null}
    </View>
  );
}

export type LoadMessageDetails = SessionApi['getMessageDetails'];

export const ChatExchangeRow = memo(function ChatExchangeRow({
  item,
  active,
  sessionId,
  loadMessageDetails,
  onBrowse,
}: {
  item: ChatExchange;
  active: boolean;
  sessionId: string | null;
  loadMessageDetails?: LoadMessageDetails;
  onBrowse: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [openedSource, setOpenedSource] = useState<string>();
  const [linkedSourceId, setLinkedSourceId] = useState<string>();
  const [stored, setStored] = useState<TurnDetails>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const { assistantMessageId, eventHistoryTurnId } = item;
  const answer = useMemo(() => visibleAnswer(item.answer), [item.answer]);
  const canLoad = Boolean(
    !active &&
      loadMessageDetails &&
      sessionId &&
      assistantMessageId &&
      eventHistoryTurnId,
  );
  const preview = item.details ?? emptyTurnDetails;
  const details =
    stored && (stored.steps.length || stored.sources.length) ? stored : preview;

  useEffect(() => {
    if (
      !open ||
      active ||
      stored ||
      !sessionId ||
      !assistantMessageId ||
      !eventHistoryTurnId ||
      !loadMessageDetails
    )
      return;
    const request = new AbortController();
    loadMessageDetails(
      sessionId,
      assistantMessageId,
      eventHistoryTurnId,
      request.signal,
    ).then(
      result => {
        if (!request.signal.aborted) setStored(result);
      },
      () => {
        if (!request.signal.aborted) setLoadFailed(true);
      },
    );
    return () => request.abort();
  }, [
    active,
    assistantMessageId,
    attempt,
    eventHistoryTurnId,
    loadMessageDetails,
    open,
    sessionId,
    stored,
  ]);

  const sourceLink = useCallback(
    (url: string) => {
      const match = uniqueSourceForUrl(details.sources, url);
      return match
        ? () => {
            onBrowse();
            setLinkedSourceId(match.id);
          }
        : undefined;
    },
    [details.sources, onBrowse],
  );
  const linkedSource = details.sources.find(
    source => source.id === linkedSourceId,
  );
  const last = active ? details.steps[details.steps.length - 1] : undefined;
  const label = last
    ? last.label +
      ' · ' +
      (last.state === 'running' ? '进行中' : stepLabels[last.state])
    : details.sources.length
    ? '执行过程与参考来源 · ' + details.sources.length
    : '执行过程与来源';
  const hasDetails =
    details.steps.length > 0 || details.sources.length > 0 || canLoad;

  return (
    <View style={styles.exchange}>
      {item.question ? (
        <View style={styles.questionGroup}>
          <Text
            selectable
            style={[
              styles.question,
              { color: theme.text, backgroundColor: theme.secondary },
            ]}
          >
            {item.question}
          </Text>
          <CopyText value={item.question} label="复制提问" />
        </View>
      ) : null}
      {hasDetails ? (
        <View style={[styles.details, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ expanded: open }}
            onPress={() => {
              onBrowse();
              setOpen(!open);
              setLoadFailed(false);
            }}
            style={styles.disclosure}
          >
            <Text
              style={[
                styles.small,
                styles.disclosureLabel,
                { color: theme.muted },
              ]}
            >
              {label}
            </Text>
            <Text accessible={false} style={{ color: theme.muted }}>
              {open ? '⌃' : '⌄'}
            </Text>
          </Pressable>
          {open ? (
            <View style={styles.detailsBody}>
              {details.steps.map(step => (
                <View key={step.id} style={styles.step}>
                  <Text
                    style={[
                      styles.title,
                      {
                        color:
                          step.state === 'failed' ? theme.error : theme.text,
                      },
                    ]}
                  >
                    {step.label} · {stepLabels[step.state]}
                  </Text>
                  {step.detail ? (
                    <Text
                      selectable
                      style={[styles.small, { color: theme.muted }]}
                    >
                      {step.detail}
                    </Text>
                  ) : null}
                </View>
              ))}
              {details.sources.length ? (
                <>
                  <Text style={[styles.title, { color: theme.text }]}>
                    检索到的参考来源
                  </Text>
                  {details.sources.map(source => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      open={openedSource === source.id}
                      onPress={() =>
                        setOpenedSource(value =>
                          value === source.id ? undefined : source.id,
                        )
                      }
                    />
                  ))}
                </>
              ) : null}
              {loadFailed ? (
                <>
                  <ErrorNotice message="暂时无法加载完整记录。" />
                  <Action
                    title="重试"
                    tone="secondary"
                    onPress={() => {
                      setLoadFailed(false);
                      retry(value => value + 1);
                    }}
                  />
                </>
              ) : canLoad && !stored ? (
                <Text style={[styles.small, { color: theme.muted }]}>
                  正在加载记录…
                </Text>
              ) : !details.steps.length && !details.sources.length ? (
                <Text style={[styles.small, { color: theme.muted }]}>
                  这条回复没有可显示的过程或来源。
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {answer ? (
        <View style={styles.answer}>
          <MarkdownMessage
            text={answer}
            streaming={active}
            sourceLink={sourceLink}
          />
          {!active ? <CopyText value={answer} label="复制回答" /> : null}
        </View>
      ) : null}
      {item.failed ? <ErrorNotice message={item.failed} /> : null}
      {linkedSource ? (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={() => setLinkedSourceId(undefined)}
        >
          <View style={styles.backdrop}>
            <View
              style={[styles.sourceDialog, { backgroundColor: theme.surface }]}
            >
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.text }]}
              >
                {linkedSource.document || '检索摘录'}
              </Text>
              <Text style={[styles.small, { color: theme.muted }]}>
                {sourceContext(linkedSource)}
              </Text>
              <ScrollView>
                <Text
                  selectable
                  style={[styles.excerpt, { color: theme.text }]}
                >
                  {linkedSource.excerpt || '服务器未返回原文摘录。'}
                </Text>
              </ScrollView>
              <Action
                title="关闭"
                tone="secondary"
                onPress={() => setLinkedSourceId(undefined)}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  exchange: { gap: spacing.sm },
  questionGroup: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    maxWidth: '86%',
  },
  question: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    lineHeight: 24,
  },
  answer: { gap: spacing.xs, paddingHorizontal: spacing.xs },
  details: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  disclosureLabel: { flex: 1 },
  detailsBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  step: { gap: 2 },
  source: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 20 },
  excerpt: { paddingTop: spacing.sm, fontSize: 15, lineHeight: 23 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sourceDialog: {
    maxHeight: '78%',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
