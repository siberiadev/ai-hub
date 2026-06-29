import type { PdfWord } from './parsed.types';

/* pdfjs-dist 6.x не поставляет типов для legacy/ESM-сборки, грузимой через dynamic
 * import() — на этой границе работаем с any осознанно. */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/**
 * pdfjs-dist 6.x — ESM-only. Грузим динамическим import() из CommonJS-сборки Nest.
 * Кэшируем модуль между вызовами.
 */
let pdfjsPromise: Promise<any> | undefined;
function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    // legacy-сборка работает в Node без воркера/canvas.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

/** Страница PDF: текст одной строкой + слова с геометрией (как pdfplumber). */
export interface PdfPage {
  /** Слитый текст всех слов (для заголовочных regex). */
  text: string;
  /** Слова в порядке выдачи pdfjs (с x0/x1/top/size). */
  words: PdfWord[];
  /** Высота страницы (points). */
  height: number;
}

/**
 * Извлекает страницы PDF со словами. Координаты совпадают с pdfplumber:
 * x0 = левый край (points), x1 = x0 + width, top = высота_страницы − baseline_y.
 * Группировку слов в строки выполняет вызывающий (по round(top)).
 */
export async function extractPages(data: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // тише в логах: отключаем предупреждения о шрифтах
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const height = viewport.height;
      const content = await page.getTextContent();
      const words: PdfWord[] = [];
      for (const item of content.items as any[]) {
        const str: string = item.str ?? '';
        if (!str) continue;
        const tr: number[] = item.transform;
        const x0 = tr[4];
        const top = height - tr[5];
        // высота шрифта ≈ |transform[3]| (масштаб по Y); fallback на item.height
        const size = Math.abs(tr[3]) || item.height || 0;
        words.push({ text: str, x0, x1: x0 + (item.width ?? 0), top, size });
      }
      pages.push({
        words,
        height,
        text: words.map((w) => w.text).join(' '),
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

/**
 * Группирует слова страницы в строки по round(top) (порт логики
 * `lines[round(w['top'])].append(w)` из extract_*.py). Возвращает строки,
 * отсортированные сверху вниз; слова внутри строки — слева направо.
 */
export function groupLines(words: PdfWord[]): PdfWord[][] {
  const buckets = new Map<number, PdfWord[]>();
  for (const w of words) {
    const key = Math.round(w.top);
    const arr = buckets.get(key);
    if (arr) arr.push(w);
    else buckets.set(key, [w]);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => buckets.get(k)!.sort((a, b) => a.x0 - b.x0));
}
