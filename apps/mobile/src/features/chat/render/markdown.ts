import MarkdownIt from 'markdown-it';
import { mapMarkdownProse, normalizeMathMarkup } from '@/lib/latex-normalize';
import { parseModelThinkingSegments } from '@/lib/think-segments';

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  maxNesting: 20,
});
type Token = ReturnType<typeof markdown.parse>[number];
const MATH_LIMIT = 4_000;

function closingDelimiter(
  text: string,
  delimiter: string,
  start: number,
): number {
  const end = Math.min(text.length, start + MATH_LIMIT);
  for (let pos = start; pos < end; pos += 1) {
    if (text[pos] === '\\' && !text.startsWith(delimiter, pos)) {
      pos += 1;
      continue;
    }
    if (text.startsWith(delimiter, pos)) return pos;
  }
  return -1;
}

// Consume delimiters before the Markdown escape rule. A code span is consumed
// by markdown-it from its opening backtick, so these rules never see its body.
markdown.inline.ruler.before('escape', 'mobile_math', (state, silent) => {
  const at = state.pos;
  const source = state.src;
  const display = source.startsWith('$$', at) || source.startsWith('\\[', at);
  const escaped = source.startsWith('\\(', at) || source.startsWith('\\[', at);
  const open = display || escaped ? 2 : 1;
  if (!escaped && source[at] !== '$') return false;
  const close = escaped ? (display ? '\\]' : '\\)') : '$'.repeat(open);
  const end = closingDelimiter(source, close, at + open);
  const body = end < 0 ? '' : source.slice(at + open, end);
  if (
    !body.trim() ||
    body.includes('\n') ||
    (escaped && body.includes(display ? '\\[' : '\\(')) ||
    (!escaped &&
      !display &&
      (/^\s|\s$/.test(body) || /\d/.test(source[end + 1] ?? '')))
  ) {
    // Preserve the literal opener until a later event supplies its close.
    if (!silent) state.pending += source.slice(at, at + open);
    state.pos = at + open;
    return true;
  }
  if (!silent) {
    const token = state.push(display ? 'math_display' : 'math_inline', '', 0);
    token.content = body.trim();
  }
  state.pos = end + close.length;
  return true;
});

markdown.block.ruler.before(
  'fence',
  'mobile_math',
  (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const from = state.bMarks[start] + state.tShift[start];
    const line = state.src.slice(from, state.eMarks[start]);
    const close = line.startsWith('$$')
      ? '$$'
      : line.startsWith('\\[')
      ? '\\]'
      : '';
    if (!close) return false;
    let body = line.slice(2);
    let next = start;
    while (
      !body.trimEnd().endsWith(close) &&
      next + 1 < end &&
      body.length < MATH_LIMIT
    ) {
      next += 1;
      const candidate = state.src.slice(state.bMarks[next], state.eMarks[next]);
      const trimmed = candidate.trim();
      // An unfinished formula must not absorb later Markdown or a new opener.
      if (
        /^(?:\x60{3,}|~{3,}|#{1,6}(?:\s|$)|\\\[)/.test(trimmed) ||
        (trimmed.startsWith('$$') && trimmed !== '$$')
      )
        return false;
      body += '\n' + candidate;
    }
    if (body.length > MATH_LIMIT || !body.trimEnd().endsWith(close))
      return false;
    body = body.trimEnd().slice(0, -close.length).trim();
    if (!body || closingDelimiter(body, close, 0) >= 0) return false;
    if (!silent) {
      const token = state.push('math_display', '', 0);
      token.content = body;
      token.map = [start, next + 1];
      state.line = next + 1;
    }
    return true;
  },
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
);

export type MarkdownNode = {
  token: Token;
  children: MarkdownNode[];
};

function tree(tokens: readonly Token[]): MarkdownNode[] {
  const root: MarkdownNode[] = [];
  const stack = [root];
  for (const token of tokens) {
    if (token.nesting < 0) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const children = token.children ? tree(token.children) : [];
    stack[stack.length - 1].push({ token, children });
    if (token.nesting > 0) stack.push(children);
  }
  return root;
}

export function parseMarkdown(
  text: string,
  streaming: boolean,
): MarkdownNode[] {
  // Reuse Web's prose normalization once the answer settles. During streaming
  // only explicit, closed math spans are rendered, and fences can grow at EOF.
  return tree(markdown.parse(streaming ? text : normalizeMathMarkup(text), {}));
}

export function visibleAnswer(text: string): string {
  if (!/<\s*think(?:ing)?\b/i.test(text)) return text;
  let marker = '\u0000dt-inline-code:';
  while (text.includes(marker)) marker += ':';
  const inlineCode: string[] = [];
  const protectedText = mapMarkdownProse(text, prose =>
    prose.replace(
      /(^|[^\x60])(\x60+)((?:(?!\n[ \t]*\n)[\s\S])*?)\2(?!\x60)/g,
      (match, prefix: string, delimiter: string, body: string) => {
        if (!/<\s*\/?\s*think(?:ing)?\b/i.test(body)) return match;
        const index = inlineCode.push(delimiter + body + delimiter) - 1;
        return prefix + marker + index + '\u0000';
      },
    ),
  );
  const answer = parseModelThinkingSegments(protectedText)
    .filter(segment => segment.kind === 'text')
    .map(segment => segment.content)
    .join('');
  return answer.replace(
    new RegExp(marker + '(\\d+)\\u0000', 'g'),
    (_, index: string) => inlineCode[Number(index)],
  );
}
