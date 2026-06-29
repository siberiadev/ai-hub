import type { ParsedStatement, ParsedTxn, PdfWord } from './parsed.types';
import { extractPages, groupLines, type PdfPage } from './pdf-words';

/* Порт etl/extract_mox.py. Колонки по x:
 *   activity date <120 | settlement 120–188 | description 150≤x0,x1<410 |
 *   corresponding-ccy 410≤x0,x1<492 | amount(HKD) right-aligned x1≥495.
 * Год берётся из периода выписки (даты в строках — только день+месяц). */

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
const NUM = /^[+-]?[\d,]+\.\d{2}$/;
const MON_FIND = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/;

const toNum = (t: string): number => parseFloat(t.replace(/,/g, ''));

const daysInMonth = (y: number, m: number): number =>
  new Date(y, m, 0).getDate();
const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Подбирает год так, чтобы дата попала в период выписки (или была к нему ближе
 * всего). Порт pick_year() — кандидаты: ps.year−1, ps.year, pe.year; невалидный
 * день усекается до конца месяца.
 */
function pickYear(
  d: number,
  mon: number,
  ps: { y: number; ms: number },
  pe: { y: number; ms: number },
): string {
  let best: { dist: number; val: string } | null = null;
  for (const y of [ps.y - 1, ps.y, pe.y]) {
    const dd = Math.min(d, daysInMonth(y, mon));
    const cand = y * 12 * 31 + mon * 31 + dd; // грубый порядковый для сравнения
    const candMs = Date.UTC(y, mon - 1, dd);
    const psMs = Date.UTC(ps.y, ps.ms, 1);
    const peMs = Date.UTC(pe.y, pe.ms, 28);
    let dist: number;
    if (candMs < psMs) dist = (psMs - candMs) / 86400000;
    else if (candMs > peMs + 3 * 86400000) dist = (candMs - peMs) / 86400000;
    else dist = 0;
    void cand;
    if (best === null || dist < best.dist)
      best = { dist, val: iso(y, mon, dd) };
  }
  return best!.val;
}

/** «11 Apr» → ISO с подбором года из периода выписки; null если нет дня+месяца. */
function parseDayMon(
  s: string,
  head: { ps: { y: number; ms: number }; pe: { y: number; ms: number } },
): string | null {
  const day = s.match(/\d{1,2}/);
  const mon = MON_FIND.exec(s);
  if (!day || !mon) return null;
  return pickYear(parseInt(day[0], 10), MONTHS[mon[1]], head.ps, head.pe);
}

interface MoxHeader {
  ps: { y: number; ms: number };
  pe: { y: number; ms: number };
  account: string | null;
  sumIn: number | null;
  sumOut: number | null;
  closing: number | null;
}

const MON_RE = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';

function parseDateStr(s: string): { y: number; ms: number } {
  const m = new RegExp(`(\\d{1,2})\\s+${MON_RE}\\s+(\\d{4})`).exec(s);
  if (!m) throw new Error(`Mox: не разобрана дата периода: "${s}"`);
  return { y: parseInt(m[3], 10), ms: MONTHS[m[2]] - 1 };
}

function parseHeader(text: string): MoxHeader {
  const pm = new RegExp(
    `Statement period[:\\s]*([0-9]{1,2} \\w{3} \\d{4})\\s*-\\s*([0-9]{1,2} \\w{3} \\d{4})`,
  ).exec(text);
  if (!pm) throw new Error('Mox: не найден Statement period');
  const ps = parseDateStr(pm[1]);
  const pe = parseDateStr(pm[2]);
  const am = /Account number[^\d]*([\d\- ]+\d)/.exec(text);
  const account = am ? am[1].replace(/\s/g, '') : null;
  const sm =
    /\+([\d,]+\.\d{2})\s*HKD\s*-([\d,]+\.\d{2})\s*HKD\s*([\d,]+\.\d{2})\s*HKD/.exec(
      text,
    );
  return {
    ps,
    pe,
    account,
    sumIn: sm ? toNum(sm[1]) : null,
    sumOut: sm ? -toNum(sm[2]) : null,
    closing: sm ? toNum(sm[3]) : null,
  };
}

interface MoxRow extends ParsedTxn {
  isOpening: boolean;
  isMarker: boolean;
}

export async function parseMox(data: Uint8Array): Promise<ParsedStatement> {
  return parseMoxPages(await extractPages(data));
}

export function parseMoxPages(pages: PdfPage[]): ParsedStatement {
  const head = parseHeader(pages[0]?.text ?? '');
  const issues: string[] = [];

  const rows: MoxRow[] = [];
  let cur: MoxRow | null = null;

  for (const page of pages.slice(1)) {
    for (const row of groupLines(page.words)) {
      const act = row.filter((w) => w.x0 < 120);
      const stl = row.filter((w) => w.x0 >= 120 && w.x0 < 188);

      // HKD-сумма: NUM с x1≥495, берём с максимальным правым краем.
      let amtTok: string | null = null;
      let amtX1 = 0;
      for (const w of row) {
        if (NUM.test(w.text) && w.x1 >= 495 && w.x1 > amtX1) {
          amtTok = w.text;
          amtX1 = w.x1;
        }
      }
      const corr = row.filter((w) => w.x1 < 492 && w.x0 >= 410);
      const desc = row.filter((w) => w.x0 >= 150 && w.x1 < 410);
      const descTxt = desc
        .map((w) => w.text)
        .join(' ')
        .trim();

      if (!descTxt && !amtTok) continue;
      if (/Description|Activity|Settlement|Corresponding/.test(descTxt))
        continue;

      if (amtTok) {
        if (cur) rows.push(cur);
        // дата может быть одним айтемом «11 Apr» — берём день и месяц из строки
        const actJoin = act.map((w) => w.text).join(' ');
        const stlJoin = stl.map((w) => w.text).join(' ');
        const activityDate = parseDayMon(actJoin, head);
        const settleDate = parseDayMon(stlJoin, head);

        // corr-токен бывает склеенным: «-127.96 USD» или «-50,850 JPY» (без копеек).
        // Валюту берём независимо от суммы (как в Python: ocur ставится даже когда
        // числа с 2 знаками нет, напр. JPY/CNY).
        let occ: number | null = null;
        let ocur: string | null = null;
        if (corr.length) {
          const corrTxt = corr.map((w) => w.text).join(' ');
          const ccyM = /\b([A-Z]{3})\b/.exec(corrTxt);
          if (ccyM) ocur = ccyM[1];
          const numM = /(-?[\d,]+\.\d{2})/.exec(corrTxt);
          if (numM) occ = Math.abs(toNum(numM[1]));
        }
        cur = {
          source: 'mox',
          accountNo: head.account,
          txnDate: activityDate,
          settleDate,
          descriptionRaw: descTxt,
          amount: Math.round(toNum(amtTok) * 100) / 100,
          currency: 'HKD',
          originalAmount: occ,
          originalCurrency: ocur,
          isOpening: false,
          isMarker: false,
        };
      } else if (cur && descTxt) {
        cur.descriptionRaw = `${cur.descriptionRaw} ${descTxt}`.trim();
      }
    }
  }
  if (cur) rows.push(cur);

  // маркеры баланса по финальному (склеенному) описанию
  for (const t of rows) {
    const d = t.descriptionRaw;
    t.isOpening = d.includes('期初結餘') || /Opening balance/.test(d);
    t.isMarker =
      t.isOpening || d.includes('截數結餘') || /Closing balance/.test(d);
    if (t.isMarker) {
      t.descriptionRaw = d.split(/\s+(?:immediately|This statement)/)[0].trim();
    }
  }

  const real = rows.filter((t) => !t.isMarker);
  const opening = rows.find((t) => t.isOpening)?.amount ?? 0;
  const pos = real
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  const neg = real
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s + t.amount, 0);
  const calcClose = Math.round((opening + pos + neg) * 100) / 100;

  // Авторитетный оракул — closing balance (opening + Σ == closing). Итоги
  // «Total incoming/outgoing» в шапке Mox не равны наивной сумме строк из-за учёта
  // FX-наценки/возвратов, поэтому in/out не используются как признак ошибки.
  const balOk =
    head.closing !== null && Math.abs(calcClose - head.closing) < 0.05;
  if (!balOk)
    issues.push(
      `Mox: расчётный остаток ${calcClose.toFixed(2)} != closing ${head.closing ?? 0}`,
    );

  const txns: ParsedTxn[] = real.map((t) => ({
    source: t.source,
    accountNo: t.accountNo,
    txnDate: t.txnDate,
    settleDate: t.settleDate,
    descriptionRaw: t.descriptionRaw,
    amount: t.amount,
    currency: 'HKD',
    originalAmount: t.originalAmount,
    originalCurrency: t.originalCurrency,
  }));

  return {
    source: 'mox',
    bank: 'Mox Bank',
    accountNo: head.account,
    periodStart: iso(head.ps.y, head.ps.ms + 1, 1),
    periodEnd: iso(
      head.pe.y,
      head.pe.ms + 1,
      daysInMonth(head.pe.y, head.pe.ms + 1),
    ),
    statementDate: null,
    txns,
    reconciled: balOk,
    issues,
  };
}

// для тестов геометрии
export type { PdfWord };
