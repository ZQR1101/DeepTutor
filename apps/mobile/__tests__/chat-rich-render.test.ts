import {
  parseMarkdown,
  type MarkdownNode,
} from '../src/features/chat/render/markdown';
import { mathSvg } from '../src/features/chat/render/mathSvg';
import { codeSegments } from '../src/features/chat/render/codeHighlight';

function tokens(nodes: readonly MarkdownNode[]): string[] {
  return nodes.flatMap(node => [node.token.type, ...tokens(node.children)]);
}

const fence = String.fromCharCode(96).repeat(3);

test('renders CommonMark structures, tables, and both inline and display math', () => {
  const text = [
    '## 解题',
    '',
    '算式 $x+1$ 与 \\(y-1\\)。',
    '',
    '$$',
    '\\frac{1}{2}',
    '$$',
    '',
    '> 提示',
    '',
    '1. 列式',
    '',
    '| 项 | 值 |',
    '| --- | --- |',
    '| x | 2 |',
  ].join('\n');
  expect(tokens(parseMarkdown(text, false))).toEqual(
    expect.arrayContaining([
      'heading_open',
      'math_inline',
      'math_display',
      'blockquote_open',
      'ordered_list_open',
      'table_open',
    ]),
  );
});

test('streaming does not typeset unmatched delimiters or parse unfinished code as math', () => {
  expect(tokens(parseMarkdown('待续：\\(x + 1', true))).not.toContain(
    'math_inline',
  );
  expect(tokens(parseMarkdown('待续：\\(x + 1\\)', true))).toContain(
    'math_inline',
  );
  expect(tokens(parseMarkdown('价格是 $5 和 $10', true))).not.toContain(
    'math_inline',
  );
  expect(tokens(parseMarkdown(fence + 'python\nx = "$x$"', true))).toEqual([
    'fence',
  ]);
  expect(tokens(parseMarkdown('$$\na_n', true))).not.toContain('math_display');
});

test('HTML is never a renderable node, and highlighting round-trips source characters', () => {
  const payload = '<script>void(0)</script><img src="https://example.invalid">';
  const graph = tokens(parseMarkdown(payload, false));
  expect(graph.some(type => type.startsWith('html'))).toBe(false);
  const code = 'value = "<&>\'" # learner';
  const segments = codeSegments(code, 'python');
  expect(segments.some(segment => segment.scope === 'string')).toBe(true);
  expect(segments.map(segment => segment.text).join('')).toBe(code);
  expect(codeSegments(code, 'unknown-grammar')).toEqual([{ text: code }]);
});

test('math graphics are self-contained and unsupported commands fall back', () => {
  const svg = mathSvg('\\frac{a_1}{2}', true);
  expect(svg?.ratio).toBeGreaterThan(0);
  expect(svg?.xml).toContain('<path');
  expect(svg?.xml).not.toMatch(/href=|<script\b|<image\b/);
  expect(mathSvg('\\href{https://example.invalid}{x}', false)).toBeNull();
  expect(mathSvg('\\frac{', false)).toBeNull();
});

test('large answer retains all formula and code blocks', () => {
  const formulas = Array.from({ length: 80 }, (_, i) => '$x_' + i + '=2$').join(
    '\n\n',
  );
  const code = Array.from({ length: 1000 }, () => 'total += value\n').join('');
  const nodes = parseMarkdown(
    formulas + '\n\n' + fence + 'python\n' + code + fence,
    false,
  );
  expect(tokens(nodes).filter(type => type === 'math_inline')).toHaveLength(80);
  expect(nodes[nodes.length - 1].token.content).toBe(code);
  expect(codeSegments(code, 'python')).toEqual([{ text: code }]);
});
