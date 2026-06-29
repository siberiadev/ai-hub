import type { ParsedStatement, ParsedTxn } from './parsed.types';
import { extractPages, groupLines, type PdfPage } from './pdf-words';

/* Порт etl/extract_sc.py. Мультивалютная consolidated-выписка: секции HKD/CNY/GBP,
 * у каждой свой running balance. Колонки по правому краю (x1):
 *   deposit 395≤x1<425 | withdrawal 460≤x1<500 | balance x1≥525.
 *   date x0<90 (MM/DD или DD Mon) | description 90≤x0<360.
 * Валидация — построчно: prev + (deposit − withdrawal) == напечатанный Balance. */

const NUM = /^[\d,]+\.\d{2}$/;
const DEFAULT_ACCOUNT = '407-8-136763-1';
const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

const toNum = (t: string): number => parseFloat(t.replace(/,/g, ''));
const daysInMonth = (y: number, m: number): number =>
  new Date(y, m, 0).getDate();
const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

interface YMD {
  y: number;
  m: number;
  d: number;
}

/** Год так, чтобы дата была ближе всего к дате выписки (обрабатывает Dec→Jan). */
function pickYear(mm: number, dd: number, end: YMD): string {
  let best: { dist: number; val: string } | null = null;
  const endMs = Date.UTC(end.y, end.m - 1, end.d);
  for (const y of [end.y, end.y - 1, end.y + 1]) {
    const d2 = Math.min(dd, daysInMonth(y, mm));
    const candMs = Date.UTC(y, mm - 1, d2);
    const dist = Math.abs((endMs - candMs) / 86400000);
    if (best === null || dist < best.dist) best = { dist, val: iso(y, mm, d2) };
  }
  return best!.val;
}

function parseDateCol(s: string, end: YMD): string | null {
  const md = /(\d{1,2})\/(\d{1,2})/.exec(s);
  if (md) return pickYear(parseInt(md[1], 10), parseInt(md[2], 10), end);
  const dm =
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.exec(s);
  if (dm) return pickYear(MONTHS[dm[2]], parseInt(dm[1], 10), end);
  return null;
}

/** Валюта секции, если строка — разделитель секции, иначе null. */
function sectionCurrency(txt: string): string | null {
  const t = txt.trim();
  if (t.length > 45) return null;
  if (/人民幣/.test(t) || /\bCNY\b/.test(t)) return 'CNY';
  if (/英磅|英鎊/.test(t) || /\bGBP\b/.test(t)) return 'GBP';
  if (/港元/.test(t) || /\bHKD\b/.test(t)) return 'HKD';
  return null;
}

function stmtDate(text: string): YMD {
  const a = /Statement Date[^\d]*(\d{4})\/(\d{2})\/(\d{2})/.exec(text);
  if (a) return { y: +a[1], m: +a[2], d: +a[3] };
  const b = new RegExp(
    `Statement Date[^\\d]*(\\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\\d{4})`,
  ).exec(text);
  if (b) return { y: +b[3], m: MONTHS[b[2]], d: +b[1] };
  throw new Error('SC: не найдена Statement Date');
}

type SCRow = ParsedTxn;

export async function parseSC(data: Uint8Array): Promise<ParsedStatement> {
  return parseSCPages(await extractPages(data));
}

export function parseSCPages(pages: PdfPage[]): ParsedStatement {
  const headText = pages[0]?.text ?? '';
  const end = stmtDate(headText);
  const acctM = /(\d{3}-\d-\d{6}-\d)/.exec(headText);
  const account = acctM ? acctM[1] : DEFAULT_ACCOUNT;

  const rows: SCRow[] = [];
  const issues: string[] = [];
  let curCcy: string | null = null;
  let cur: SCRow | null = null;
  const bal: Record<string, number> = {};
  let lastD: string | null = null;

  for (const page of pages.slice(1)) {
    for (const row of groupLines(page.words)) {
      const leftTxt = row
        .filter((w) => w.x0 < 90)
        .map((w) => w.text)
        .join(' ');
      const pdate = parseDateCol(leftTxt, end);
      const desc = row.filter((w) => w.x0 >= 90 && w.x0 < 360);
      const dep = row.find(
        (w) => NUM.test(w.text) && w.x1 >= 395 && w.x1 < 425,
      )?.text;
      const wd = row.find(
        (w) => NUM.test(w.text) && w.x1 >= 460 && w.x1 < 500,
      )?.text;
      const balv = row.find((w) => NUM.test(w.text) && w.x1 >= 525)?.text;
      const descTxt = desc
        .map((w) => w.text)
        .join(' ')
        .trim();

      if (pdate) lastD = pdate;

      // разделитель валютной секции
      if (!dep && !wd && !pdate) {
        const sc = sectionCurrency(descTxt);
        if (sc && !descTxt.toUpperCase().includes('BALANCE')) {
          if (sc !== curCcy) {
            curCcy = sc;
            lastD = null; // новая секция — новая хронология
          }
        }
      }

      // строка «остаток с прошлой выписки»
      if (descTxt.includes('BALANCE FROM PREVIOUS') && balv) {
        if (cur) {
          rows.push(cur);
          cur = null;
        }
        if (curCcy) bal[curCcy] = toNum(balv);
        continue;
      }
      // строка «закрытие» — валидируем
      if (descTxt.includes('CLOSING BALANCE') && balv) {
        if (cur) {
          rows.push(cur);
          cur = null;
        }
        const cc = sectionCurrency(descTxt) ?? curCcy;
        if (cc && cc in bal && Math.abs(bal[cc] - toNum(balv)) > 0.01) {
          issues.push(
            `SC: ${cc} closing ${bal[cc].toFixed(2)} != ${toNum(balv).toFixed(2)}`,
          );
        }
        continue;
      }

      if ((dep || wd) && balv) {
        // якорь транзакции (у настоящих строк всегда есть running balance)
        if (cur) rows.push(cur);
        const depv = dep ? toNum(dep) : 0;
        const wdv = wd ? toNum(wd) : 0;
        const signed = Math.round((depv - wdv) * 100) / 100;
        const rb = toNum(balv);
        if (curCcy && curCcy in bal) {
          bal[curCcy] = Math.round((bal[curCcy] + signed) * 100) / 100;
          if (Math.abs(bal[curCcy] - rb) > 0.01) {
            issues.push(
              `SC: ${curCcy} ${lastD}: расчёт ${bal[curCcy].toFixed(2)} != печать ${rb.toFixed(2)} | ${descTxt.slice(0, 30)}`,
            );
            bal[curCcy] = rb; // ресинк на печатный
          }
        }
        cur = {
          source: 'standard_chartered',
          accountNo: account,
          currency: curCcy ?? 'HKD',
          txnDate: lastD,
          descriptionRaw: descTxt,
          amount: signed,
          balanceAfter: rb,
        };
      } else if (cur && descTxt) {
        cur.descriptionRaw = `${cur.descriptionRaw} ${descTxt}`.trim();
      }
    }
  }
  if (cur) rows.push(cur);

  return {
    source: 'standard_chartered',
    bank: 'Standard Chartered',
    accountNo: account,
    periodStart: null,
    periodEnd: null,
    statementDate: iso(end.y, end.m, end.d),
    txns: rows,
    reconciled: issues.length === 0,
    issues,
  };
}
