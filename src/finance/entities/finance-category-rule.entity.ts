import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { RuleType, TxnClass } from '../finance.types';

/**
 * Правило авто-категоризации: regex по описанию → категория/класс. Упорядочено
 * по `priority` (меньше — раньше, первое совпадение выигрывает). Порт CAT_RULES +
 * INCOME/TRANSFER keywords + reclassify.sql из load.py — вынесен в таблицу, чтобы
 * пользователь мог расширять без правки кода.
 */
@Entity('fin_category_rule')
export class FinanceCategoryRule {
  @PrimaryGeneratedColumn()
  id: number;

  /** Порядок применения (меньше — раньше). */
  @Column({ type: 'int' })
  priority: number;

  /** 'category' (расходный мерчант) | 'income' | 'transfer' */
  @Column({ type: 'varchar' })
  ruleType: RuleType;

  /** Regex (JS), матчится по UPPERCASE описания, флаг 'i'. */
  @Column({ type: 'text' })
  pattern: string;

  /** Для ruleType='category' — целевая категория. */
  @Column({ type: 'int', nullable: true })
  categoryId: number | null;

  /** Для ruleType='income'|'transfer' — присваиваемый txn_class. */
  @Column({ type: 'varchar', nullable: true })
  txnClass: TxnClass | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;
}
