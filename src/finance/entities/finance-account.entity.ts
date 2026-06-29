import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { BankSource } from '../finance.types';

/** Источник данных (банк/кошелёк). Сидится миграцией. Порт `accounts` из schema.sql. */
@Entity('fin_account')
export class FinanceAccount {
  @PrimaryGeneratedColumn()
  id: number;

  /** 'mox' | 'standard_chartered' | 'alipay' */
  @Column({ type: 'varchar', unique: true })
  source: BankSource;

  @Column({ type: 'varchar' })
  bank: string;

  @Column({ type: 'varchar', nullable: true })
  accountNo: string | null;

  @Column({ type: 'varchar', default: 'HKD' })
  baseCurrency: string;

  @Column({ type: 'varchar', nullable: true })
  label: string | null;
}
