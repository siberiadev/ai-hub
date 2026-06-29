import type { ValueTransformer } from 'typeorm';

/** Источник выписки. */
export type BankSource = 'mox' | 'standard_chartered' | 'alipay';

/** Направление движения денег (как в schema.sql). */
export type Direction = 'debit' | 'credit';

/**
 * Высокоуровневый тип потока — для аналитики доход/расход/перевод.
 * Порт `txn_class` из etl/schema.sql + load.py.
 */
export type TxnClass =
  | 'expense'
  | 'income_salary'
  | 'income_interest'
  | 'income_cashback'
  | 'transfer_in'
  | 'transfer_out'
  | 'alipay_funding'
  | 'fee'
  | 'refund';

export type CategoryKind = 'expense' | 'income' | 'transfer';

/**
 * Тип правила категоризации (порядок применения в categorization.service):
 * override (приоритетная ручная классификация, ставит и класс, и категорию) →
 * income → transfer → category (расходный мерчант по CAT_RULES).
 */
export type RuleType = 'override' | 'category' | 'income' | 'transfer';

export type StatementStatus = 'parsed' | 'failed' | 'partial';

/** DI-токен фасада импорта — инъектируется в TelegramService как @Optional(). */
export const FINANCE_IMPORT = Symbol('FINANCE_IMPORT');

/**
 * numeric(14,2) в Postgres драйвер `pg` отдаёт строкой. Превращаем в number
 * на чтении и обратно на запись, чтобы не таскать строки по коду.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : parseFloat(value),
};
