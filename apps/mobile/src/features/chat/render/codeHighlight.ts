import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

for (const [name, grammar] of Object.entries({
  bash,
  cpp,
  css,
  java,
  javascript,
  json,
  python,
  sql,
  typescript,
  xml,
})) {
  hljs.registerLanguage(name, grammar);
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
};
export type CodeSegment = { text: string; scope?: string };

export function codeSegments(code: string, language: string): CodeSegment[] {
  if (code.length > 12_000 || !hljs.getLanguage(language))
    return [{ text: code }];
  try {
    const markup = hljs.highlight(code, {
      language,
      ignoreIllegals: true,
    }).value;
    const scopes: (string | undefined)[] = [];
    const result: CodeSegment[] = [];
    // Interpret only the spans emitted by highlight.js. They are never passed
    // to a DOM or a WebView, and user characters came through escaped.
    for (const part of markup.split(/(<span class="[^"]*">|<\/span>)/)) {
      if (part.startsWith('<span '))
        scopes.push(part.match(/hljs-([\w-]+)/)?.[1]);
      else if (part === '</span>') scopes.pop();
      else if (part) {
        result.push({
          text: part.replace(
            /&(amp|lt|gt|quot|#x27);/g,
            (_, entity: string) => entities[entity],
          ),
          scope: scopes[scopes.length - 1],
        });
      }
    }
    return result;
  } catch {
    return [{ text: code }];
  }
}
