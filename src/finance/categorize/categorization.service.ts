import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceCategory } from '../entities/finance-category.entity';
import { FinanceCategoryRule } from '../entities/finance-category-rule.entity';
import type { Direction, RuleType, TxnClass } from '../finance.types';
import type { ParsedTxn } from '../parsing/parsed.types';
import { UNCATEGORIZED } from './category-rules.seed';
import { normMerchant } from './merchant-normalize';

export interface CategoryResult {
  txnClass: TxnClass;
  direction: Direction;
  isInternal: boolean;
  isAlipayFunding: boolean;
  /** Нормализованное имя мерчанта (для expense/override), иначе null. */
  merchantNorm: string | null;
  /** Отображаемое имя (исходное описание), иначе null. */
  merchantDisplay: string | null;
  /** Категория мерчанта, иначе null. */
  merchantCategoryId: number | null;
}

interface CompiledRule {
  re: RegExp;
  categoryId: number | null;
  txnClass: TxnClass | null;
}

interface Rules {
  override: CompiledRule[];
  income: CompiledRule[];
  transfer: CompiledRule[];
  category: CompiledRule[];
  uncategorizedId: number;
}

/**
 * Категоризация транзакций. Порт classify() + cat_for() + reclassify-override из
 * load.py/reclassify.sql. Правила читаются из таблиц БД (засеяны миграцией), чтобы
 * пользователь мог их расширять без правки кода.
 */
@Injectable()
export class CategorizationService {
  private cache?: Rules;

  constructor(
    @InjectRepository(FinanceCategory)
    private readonly categories: Repository<FinanceCategory>,
    @InjectRepository(FinanceCategoryRule)
    private readonly rules: Repository<FinanceCategoryRule>,
  ) {}

  /** Сбросить кэш правил (после ручного изменения fin_category_rule). */
  invalidate(): void {
    this.cache = undefined;
  }

  private async load(): Promise<Rules> {
    if (this.cache) return this.cache;
    const cats = await this.categories.find();
    const byId = new Map(cats.map((c) => [c.id, c]));
    void byId;
    const uncategorizedId =
      cats.find((c) => c.name === UNCATEGORIZED)?.id ?? cats[0]?.id ?? 0;

    const all = await this.rules.find({
      where: { enabled: true },
      order: { priority: 'ASC' },
    });
    const pick = (type: RuleType): CompiledRule[] =>
      all
        .filter((r) => r.ruleType === type)
        .map((r) => ({
          re: new RegExp(r.pattern, 'i'),
          categoryId: r.categoryId,
          txnClass: r.txnClass,
        }));

    this.cache = {
      override: pick('override'),
      income: pick('income'),
      transfer: pick('transfer'),
      category: pick('category'),
      uncategorizedId,
    };
    return this.cache;
  }

  /** Категория расхода по CAT_RULES (первое совпадение), иначе Other/Uncategorized. */
  private categoryFor(D: string, rules: Rules): number {
    for (const r of rules.category) {
      if (r.re.test(D)) return r.categoryId ?? rules.uncategorizedId;
    }
    return rules.uncategorizedId;
  }

  async categorize(p: ParsedTxn): Promise<CategoryResult> {
    const rules = await this.load();
    const desc = p.descriptionRaw ?? '';
    const D = desc.toUpperCase();
    const amt = p.amount;
    const direction: Direction = amt > 0 ? 'credit' : 'debit';
    const expenseMerchant = () => ({
      merchantNorm: normMerchant(desc),
      merchantDisplay: desc.trim().slice(0, 120) || normMerchant(desc),
    });

    // 1. SC ALIPAYHK — финансирование кошелька Alipay (те же деньги), исключаем из расходов
    if (p.source === 'standard_chartered' && D.includes('ALIPAYHK')) {
      return {
        txnClass: 'alipay_funding',
        direction: 'debit',
        isInternal: true,
        isAlipayFunding: true,
        merchantNorm: null,
        merchantDisplay: null,
        merchantCategoryId: null,
      };
    }

    // 2. override (ручные правила: Olga→Family, Rent, Interactive Brokers, ...)
    for (const r of rules.override) {
      if (r.re.test(D)) {
        const cls = r.txnClass ?? 'expense';
        const isTransfer = cls === 'transfer_out' || cls === 'transfer_in';
        return {
          txnClass: cls,
          direction: cls === 'expense' ? 'debit' : direction,
          isInternal: isTransfer,
          isAlipayFunding: false,
          ...expenseMerchant(),
          merchantCategoryId: r.categoryId,
        };
      }
    }

    // 3. Alipay — все строки «Payment» (расход; возвраты нетят знаком)
    if (p.source === 'alipay') {
      return {
        txnClass: 'expense',
        direction,
        isInternal: false,
        isAlipayFunding: false,
        ...expenseMerchant(),
        merchantCategoryId: this.categoryFor(D, rules),
      };
    }

    // 4. income (зарплата/проценты/кэшбэк)
    for (const r of rules.income) {
      if (r.re.test(D)) {
        return {
          txnClass: r.txnClass ?? 'income_salary',
          direction: 'credit',
          isInternal: false,
          isAlipayFunding: false,
          merchantNorm: null,
          merchantDisplay: null,
          merchantCategoryId: null,
        };
      }
    }

    // 5. transfer (Wise/FPS/собственные счета/жена-как-перевод)
    for (const r of rules.transfer) {
      if (r.re.test(D)) {
        return {
          txnClass: amt > 0 ? 'transfer_in' : 'transfer_out',
          direction,
          isInternal: true,
          isAlipayFunding: false,
          merchantNorm: null,
          merchantDisplay: null,
          merchantCategoryId: null,
        };
      }
    }

    // 6. неизвестный приход → transfer_in (возврат/пополнение)
    if (amt > 0) {
      return {
        txnClass: 'transfer_in',
        direction: 'credit',
        isInternal: false,
        isAlipayFunding: false,
        merchantNorm: null,
        merchantDisplay: null,
        merchantCategoryId: null,
      };
    }

    // 7. расход с мерчантом и категорией по CAT_RULES
    return {
      txnClass: 'expense',
      direction: 'debit',
      isInternal: false,
      isAlipayFunding: false,
      ...expenseMerchant(),
      merchantCategoryId: this.categoryFor(D, rules),
    };
  }
}
