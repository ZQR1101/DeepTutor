import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { TeX } from 'mathjax-full/js/input/tex';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration';
import { mathjax } from 'mathjax-full/js/mathjax';
import { SVG } from 'mathjax-full/js/output/svg';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document('', {
  InputJax: new TeX({
    packages: ['base', 'ams'],
    maxMacros: 256,
    maxBuffer: 4_000,
    formatError: (_input: unknown, error: unknown) => {
      throw error;
    },
  }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

export type MathGraphic = { xml: string; ratio: number; height: number };
const cache = new Map<string, MathGraphic | null>();

export function mathSvg(tex: string, display: boolean): MathGraphic | null {
  if (!tex.trim() || tex.length > 4_000) return null;
  const key = (display ? 'd:' : 'i:') + tex;
  if (cache.has(key)) return cache.get(key) ?? null;
  let figure: MathGraphic | null = null;
  try {
    const container = document.convert(tex, { display, em: 16, ex: 8 });
    const svg = adaptor.tags(container, 'svg')[0];
    const viewBox = adaptor
      .getAttribute(svg, 'viewBox')
      ?.split(/\s+/)
      .map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      const xml = adaptor.outerHTML(svg);
      // Only MathJax's geometric output goes to the native SVG renderer.
      // Do not permit links, images or SVG content with an external reference.
      if (
        !/<(?:a|image|foreignObject|script)\b|(?:href|src)\s*=/i.test(xml) &&
        xml.length < 240_000
      ) {
        figure = {
          xml,
          ratio: viewBox[2] / viewBox[3],
          height: viewBox[3] * 0.017,
        };
      }
    }
  } catch {
    // Incomplete, unsupported or invalid TeX remains legible as source.
  }
  if (cache.size >= 160) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, figure);
  return figure;
}
