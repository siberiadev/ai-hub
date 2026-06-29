import type { BankSource } from '../finance.types';

/** Одно слово PDF с геометрией (порт pdfplumber extract_words). */
export interface PdfWord {
  text: string;
  /** Левый край (x, в points). */
  x0: number;
  /** Правый край (x0 + width). */
  x1: number;
  /** Расстояние от верха страницы (для группировки в строки). */
  top: number;
  /** Высота шрифта (для фильтра водяных знаков Alipay). */
  size: number;
}

/** Сырая распарсенная транзакция (до категоризации). */
export interface ParsedTxn {
  source: BankSource;
  accountNo: string | null;
  /** ISO date (YYYY-MM-DD) или null. */
  txnDate: string | null;
  settleDate?: string | null;
  /** HH:MM:SS (Alipay) или null. */
  txnTime?: string | null;
  descriptionRaw: string;
  /** Знаковая сумма в валюте `currency` (− = отток). */
  amount: number;
  currency: string;
  /** Иностранный оригинал (Mox FX). */
  originalAmount?: number | null;
  originalCurrency?: string | null;
  /** Running balance (SC). */
  balanceAfter?: number | null;
  /** Номер ордера (Alipay). */
  txnNo?: string | null;
}

/** Результат парсинга одной выписки. */
export interface ParsedStatement {
  source: BankSource;
  bank: string;
  accountNo: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  statementDate: string | null;
  txns: ParsedTxn[];
  /** Сошлась ли сверка (Mox summary / SC running balance). */
  reconciled: boolean;
  /** Предупреждения парсера / расхождения. */
  issues: string[];
}
