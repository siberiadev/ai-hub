import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BankSource, StatementStatus } from '../finance.types';
import { numericTransformer } from '../finance.types';

/**
 * Одна загруженная выписка (PDF). `fileHash` (sha256 байт) — уникален: повторная
 * загрузка того же файла отклоняется (идемпотентность на уровне документа).
 */
@Entity('fin_statement')
export class FinanceStatement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  source: BankSource;

  @Column({ type: 'varchar' })
  bank: string;

  @Column({ type: 'varchar', nullable: true })
  accountNo: string | null;

  /** sha256 содержимого файла — ключ идемпотентности. */
  @Column({ type: 'varchar', unique: true })
  fileHash: string;

  @Column({ type: 'varchar', nullable: true })
  fileName: string | null;

  @Column({ type: 'date', nullable: true })
  periodStart: string | null;

  @Column({ type: 'date', nullable: true })
  periodEnd: string | null;

  @Column({ type: 'date', nullable: true })
  statementDate: string | null;

  /** 'parsed' | 'failed' | 'partial' */
  @Column({ type: 'varchar' })
  status: StatementStatus;

  @Column({ type: 'int', default: 0 })
  txnCount: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalInHkd: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalOutHkd: number;

  /** Сошёлся ли баланс (Mox: opening+Σ=closing; SC: построчный running balance). */
  @Column({ type: 'boolean', default: false })
  reconciled: boolean;

  /** Предупреждения парсера / расхождения баланса. */
  @Column({ type: 'jsonb', nullable: true })
  issues: string[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
