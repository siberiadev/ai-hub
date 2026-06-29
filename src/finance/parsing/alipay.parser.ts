import type { ParsedStatement, ParsedTxn } from './parsed.types';
import { extractPages, groupLines, type PdfPage } from './pdf-words';

/* Порт etl/extract_alipay.py. pdfplumber фильтрует серый водяной знак по цвету и
 * size>12; у pdfjs цвета нет, но размер есть — реальный текст ≤8pt, водяной знак
 * "Confidential" ~12.7pt, поэтому фильтруем по size.
 *
 * Каждая транзакция — блок строк (от даты до следующей даты). Колонки по x0:
 *   дата/время <110 | номер 110–245 | тип 245–312 | мерчант 312–452 | сумма ≥452.
 */

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
const DATE_RE = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;
const AMT_RE = /(-?)\s*([A-Z]{3})\s*([\d,]+\.\d{2})/;
const WATERMARK_SIZE = 11; // дропаем всё крупнее (водяной знак)

interface Block {
  date?: string;
  time?: string;
  numberParts: string[];
  typeParts: string[];
  merchantParts: string[];
  amountText: string;
}

function emptyBlock(): Block {
  return { numberParts: [], typeParts: [], merchantParts: [], amountText: '' };
}

function flush(b: Block, out: ParsedTxn[]): void {
  if (!b.date) return;
  const am = AMT_RE.exec(b.amountText);
  if (!am) return; // строка без суммы — не транзакция
  // у настоящей транзакции есть длинный номер ордера (≈30+ цифр); строки сводки/
  // заголовков его не имеют — отсекаем их
  const txnNo = b.numberParts.join('').replace(/\D/g, '');
  if (txnNo.length < 20) return;
  const sign = am[1] === '-' ? -1 : 1;
  const amount =
    Math.round(sign * parseFloat(am[3].replace(/,/g, '')) * 100) / 100;
  const merchant = b.merchantParts.join(' ').replace(/\s+/g, ' ').trim();
  out.push({
    source: 'alipay',
    accountNo: null,
    txnDate: b.date,
    txnTime: b.time ?? null,
    descriptionRaw: merchant,
    amount,
    currency: am[2],
    txnNo,
  });
}

export async function parseAlipay(data: Uint8Array): Promise<ParsedStatement> {
  return parseAlipayPages(await extractPages(data));
}

export function parseAlipayPages(pages: PdfPage[]): ParsedStatement {
  const txns: ParsedTxn[] = [];
  let block = emptyBlock();
  let started = false;

  for (const page of pages) {
    const words = page.words.filter((w) => w.size <= WATERMARK_SIZE);
    for (const line of groupLines(words)) {
      const lineTxt = line.map((w) => w.text).join(' ');
      // строка-заголовок таблицы (повторяется на каждой странице) — пропускаем
      if (
        /Transaction (Date|Number|Type|Amount)|Recipient \/ Merchant/.test(
          lineTxt,
        )
      ) {
        continue;
      }
      for (const w of line) {
        const t = w.text.trim();
        if (!t) continue;
        // дата в колонке даты → начало нового блока
        if (w.x0 < 110 && DATE_RE.test(t)) {
          if (started) flush(block, txns);
          block = emptyBlock();
          started = true;
          const m = DATE_RE.exec(t)!;
          block.date = `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          continue;
        }
        if (!started) continue;
        if (w.x0 < 110 && TIME_RE.test(t)) {
          block.time = t;
        } else if (w.x0 >= 110 && w.x0 < 245) {
          block.numberParts.push(t);
        } else if (w.x0 >= 245 && w.x0 < 312) {
          block.typeParts.push(t);
        } else if (w.x0 >= 312 && w.x0 < 452) {
          block.merchantParts.push(t);
        } else if (w.x0 >= 452) {
          block.amountText = block.amountText ? `${block.amountText} ${t}` : t;
        }
      }
    }
    // транзакция не пересекает границу страницы — закрываем блок на конце страницы
    if (started) {
      flush(block, txns);
      block = emptyBlock();
      started = false;
    }
  }

  const dates = txns
    .map((t) => t.txnDate!)
    .filter(Boolean)
    .sort();
  return {
    source: 'alipay',
    bank: 'Alipay HK',
    accountNo: null,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    statementDate: null,
    txns,
    reconciled: true,
    issues: [],
  };
}
