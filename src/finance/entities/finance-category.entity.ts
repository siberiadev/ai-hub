import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { CategoryKind } from '../finance.types';

/** Категория (расход/доход/перевод). Сидится миграцией. Порт `categories` из schema.sql. */
@Entity('fin_category')
export class FinanceCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  name: string;

  /** 'expense' | 'income' | 'transfer' */
  @Column({ type: 'varchar' })
  kind: CategoryKind;
}
