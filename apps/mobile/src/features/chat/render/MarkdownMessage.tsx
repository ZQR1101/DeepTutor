import {
  Fragment,
  memo,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SvgXml } from 'react-native-svg';
import { radius, spacing, useTheme } from '../../../theme/useTheme';
import { codeSegments } from './codeHighlight';
import { parseMarkdown, type MarkdownNode } from './markdown';

type SourceLink = (url: string) => (() => void) | undefined;
type Theme = ReturnType<typeof useTheme>;

export const CopyText = memo(function CopyTextControl({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);
  const theme = useTheme();
  async function copy() {
    try {
      setStatus((await Clipboard.setStringAsync(value)) ? 'copied' : 'failed');
    } catch {
      setStatus('failed');
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={copy}
      style={styles.copy}
    >
      <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>
        {status === 'copied'
          ? '已复制'
          : status === 'failed'
          ? '复制失败，重试'
          : label}
      </Text>
    </Pressable>
  );
});

const Formula = memo(function FormulaView({
  tex,
  display,
}: {
  tex: string;
  display: boolean;
}) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  // MathJax and its font data need not initialize for plain-text conversations.
  const graphic = (require('./mathSvg') as typeof import('./mathSvg')).mathSvg(
    tex,
    display,
  );
  const maxWidth = display ? 2_400 : Math.max(1, width - 56);
  const height = graphic
    ? Math.min(
        display ? 140 : 48,
        Math.max(15, graphic.height),
        maxWidth / graphic.ratio,
      )
    : 0;
  if (!graphic || height < 8)
    return (
      <Text selectable style={{ color: theme.muted }}>
        {tex}
      </Text>
    );
  const size = { width: height * graphic.ratio, height };
  const image = (
    <View accessible accessibilityLabel={tex} style={size}>
      <SvgXml
        xml={graphic.xml}
        color={theme.text}
        width={size.width}
        height={size.height}
      />
    </View>
  );
  return display ? (
    <ScrollView
      horizontal
      style={styles.displayMath}
      contentContainerStyle={styles.displayMathBody}
    >
      {image}
    </ScrollView>
  ) : (
    image
  );
});

function codeColor(scope: string | undefined, theme: Theme): string {
  switch (scope) {
    case 'keyword':
    case 'literal':
    case 'built_in':
      return theme.primary;
    case 'string':
    case 'regexp':
      return theme.codeString;
    case 'comment':
      return theme.muted;
    case 'number':
    case 'title':
    case 'attr':
      return theme.codeAccent;
    default:
      return theme.text;
  }
}

const CodeBlock = memo(function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const theme = useTheme();
  const segments = useMemo(
    () => codeSegments(code, language),
    [code, language],
  );
  return (
    <View
      style={[
        styles.codeBlock,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={[styles.codeHeader, { borderColor: theme.border }]}>
        <Text style={{ color: theme.muted }}>{language || '代码'}</Text>
        <CopyText value={code} label="复制代码" />
      </View>
      <ScrollView horizontal contentContainerStyle={styles.codeBody}>
        <Text selectable style={[styles.code, { color: theme.text }]}>
          {segments.map((segment, index) => (
            <Text
              key={index}
              style={{ color: codeColor(segment.scope, theme) }}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
});

function inline(
  nodes: readonly MarkdownNode[],
  theme: Theme,
  sourceLink?: SourceLink,
): ReactNode {
  return nodes.map(({ token, children }, index) => {
    switch (token.type) {
      case 'text':
        return <Fragment key={index}>{token.content}</Fragment>;
      case 'softbreak':
      case 'hardbreak':
        return <Fragment key={index}>{'\n'}</Fragment>;
      case 'math_inline':
      case 'math_display':
        return <Formula key={index} tex={token.content} display={false} />;
      case 'code_inline':
        return (
          <Text
            key={index}
            style={[styles.code, { backgroundColor: theme.secondary }]}
          >
            {token.content}
          </Text>
        );
      case 'image':
        return <Fragment key={index}>{token.content}</Fragment>;
      case 'link_open': {
        const reveal = sourceLink?.(String(token.attrGet('href') ?? ''));
        return (
          <Text
            key={index}
            accessibilityRole={reveal ? 'link' : undefined}
            onPress={reveal}
            style={
              reveal ? [styles.sourceLink, { color: theme.primary }] : undefined
            }
          >
            {inline(children, theme, sourceLink)}
          </Text>
        );
      }
      case 'strong_open':
        return (
          <Text key={index} style={styles.strong}>
            {inline(children, theme, sourceLink)}
          </Text>
        );
      case 'em_open':
        return (
          <Text key={index} style={styles.emphasis}>
            {inline(children, theme, sourceLink)}
          </Text>
        );
      case 's_open':
        return (
          <Text key={index} style={styles.strike}>
            {inline(children, theme, sourceLink)}
          </Text>
        );
      default:
        return (
          <Fragment key={index}>
            {children.length
              ? inline(children, theme, sourceLink)
              : token.content}
          </Fragment>
        );
    }
  });
}

function blocks(
  nodes: readonly MarkdownNode[],
  theme: Theme,
  sourceLink?: SourceLink,
): ReactNode {
  return nodes.map(({ token, children }, index) => {
    const key = token.type + ':' + (token.map?.[0] ?? index);
    switch (token.type) {
      case 'paragraph_open':
      case 'heading_open':
        return (
          <Text
            key={key}
            selectable
            accessibilityRole={
              token.type === 'heading_open' ? 'header' : undefined
            }
            style={[
              styles.prose,
              token.type === 'heading_open' && styles.heading,
              token.tag === 'h1' && styles.headingLarge,
              { color: theme.text },
            ]}
          >
            {inline(children, theme, sourceLink)}
          </Text>
        );
      case 'math_display':
        return <Formula key={key} tex={token.content} display />;
      case 'fence':
      case 'code_block':
        return (
          <CodeBlock
            key={key}
            code={token.content}
            language={token.info.trim().split(/\s+/)[0].toLowerCase()}
          />
        );
      case 'blockquote_open':
        return (
          <View key={key} style={[styles.quote, { borderColor: theme.border }]}>
            {blocks(children, theme, sourceLink)}
          </View>
        );
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const start = Number(token.attrGet('start') ?? 1);
        return (
          <View key={key} style={styles.list}>
            {children.map((item, position) => (
              <View key={position} style={styles.listRow}>
                <Text style={[styles.prose, { color: theme.muted }]}>
                  {token.type === 'ordered_list_open'
                    ? start + position + '.'
                    : '•'}
                </Text>
                <View style={styles.listBody}>
                  {blocks(item.children, theme, sourceLink)}
                </View>
              </View>
            ))}
          </View>
        );
      }
      case 'table_open':
        return (
          <ScrollView
            key={key}
            horizontal
            style={[styles.table, { borderColor: theme.border }]}
          >
            <View>
              {children.flatMap(section =>
                section.children.map((row, position) => (
                  <View
                    key={section.token.tag + position}
                    style={styles.tableRow}
                  >
                    {row.children.map((cell, column) => (
                      <Text
                        key={column}
                        selectable
                        style={[
                          styles.cell,
                          { color: theme.text, borderColor: theme.border },
                          cell.token.tag === 'th' && [
                            styles.strong,
                            { backgroundColor: theme.secondary },
                          ],
                        ]}
                      >
                        {inline(cell.children, theme, sourceLink)}
                      </Text>
                    ))}
                  </View>
                )),
              )}
            </View>
          </ScrollView>
        );
      case 'hr':
        return (
          <View
            key={key}
            style={[styles.divider, { backgroundColor: theme.border }]}
          />
        );
      default:
        return (
          <Fragment key={key}>{blocks(children, theme, sourceLink)}</Fragment>
        );
    }
  });
}

export const MarkdownMessage = memo(function RichAnswer({
  text,
  streaming,
  sourceLink,
}: {
  text: string;
  streaming: boolean;
  sourceLink?: SourceLink;
}) {
  const theme = useTheme();
  const deferred = useDeferredValue(text);
  const shown = streaming ? deferred : text;
  const nodes = useMemo(
    () => parseMarkdown(shown, streaming),
    [shown, streaming],
  );
  return <View style={styles.blocks}>{blocks(nodes, theme, sourceLink)}</View>;
});

const styles = StyleSheet.create({
  blocks: { gap: spacing.sm },
  prose: { fontSize: 16, lineHeight: 26 },
  heading: { fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 3 },
  headingLarge: { fontSize: 21, lineHeight: 28 },
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  sourceLink: { textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: spacing.xs },
  list: { gap: 3 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  listBody: { flex: 1, gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  tableRow: { flexDirection: 'row' },
  cell: {
    width: 142,
    padding: spacing.sm,
    fontSize: 14,
    lineHeight: 21,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  codeBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  codeBody: { padding: spacing.md },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 20,
  },
  copy: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  displayMath: { alignSelf: 'stretch' },
  displayMathBody: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
});
