import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BankSource, Direction, TxnClass } from '../finance.types';
import { numericTransformer } from '../finance.types';

/**
 * Нормализованная транзакция — главный факт леджера. Порт `transactions` из
 * schema.sql + дедуп для инкрементального импорта из Telegram.
 *
 * `dedupeKey` уникален: sha256(source|account|currency|date|amount|описание|balance)
 * — пересекающиеся периоды (особенно SC consolidated) не задваиваются благодаря
 * `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`.
 */
@Entity('fin_transaction')
@Index(['source'])
@Index(['txnClass'])
@Index(['merchantId'])
export class FinanceTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Выписка-источник (null для ручных правок). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  statementId: string | null;

  @Column({ type: 'varchar' })
  source: BankSource;

  @Column({ type: 'varchar', nullable: true })
  accountNo: string | null;

  @Index()
  @Column({ type: 'date', nullable: true })
  txnDate: string | null;

  @Column({ type: 'time', nullable: true })
  txnTime: string | null;

  @Column({ type: 'date', nullable: true })
  settleDate: string | null;

  @Column({ type: 'varchar', default: 'HKD' })
  currency: string;

  /** Знаковая сумма в `currency` (− = отток). */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  /** Знаковая сумма, сконвертированная в HKD. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amountHkd: number;

  /** 'debit' | 'credit' */
  @Column({ type: 'varchar' })
  direction: Direction;

  @Column({ type: 'varchar' })
  txnClass: TxnClass;

  @Column({ type: 'text', nullable: true })
  descriptionRaw: string | null;

  @Column({ type: 'int', nullable: true })
  merchantId: number | null;

  /** Иностранный оригинал (Mox FX). */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  originalAmount: number | null;

  @Column({ type: 'varchar', nullable: true })
  originalCurrency: string | null;

  /** Running balance (SC). */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  balanceAfter: number | null;

  /** Номер ордера Alipay. */
  @Column({ type: 'varchar', nullable: true })
  txnNo: string | null;

  @Column({ type: 'boolean', default: false })
  isAlipayFunding: boolean;

  @Column({ type: 'boolean', default: false })
  isInternal: boolean;

  /** Ключ дедупликации строки. */
  @Column({ type: 'varchar', unique: true })
  dedupeKey: string;

  /** Сырые поля строки (forward-compat / отладка). */
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
