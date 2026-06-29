import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CategorizationService } from '../categorize/categorization.service';
import { SEED_FX_RATES } from '../categorize/category-rules.seed';
import { FinanceCategory } from '../entities/finance-category.entity';
import { FinanceMerchant } from '../entities/finance-merchant.entity';
import { FinanceStatement } from '../entities/finance-statement.entity';
import { FinanceTransaction } from '../entities/finance-transaction.entity';
import type { ParsedStatement, ParsedTxn } from '../parsing/parsed.types';
import { parseStatement } from '../parsing/parse-statement';
import type { CategoryBreakdown, ImportResult } from './finance-summary.util';

const FX: Record<string, number> = Object.fromEntries(
  SEED_FX_RATES.map((r) => [r.currency, r.toHkd]),
);

const sha256 = (s: string | Buffer): string =>
  createHash('sha256').update(s).digest('hex');

/** Нормализация описания для ключа дедупликации (схлопнуть пробелы, UPPERCASE). */
const normDesc = (s: string | null): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Оркестрация импорта выписки: parse → categorize → дедуп → запись → сводка.
 * Идемпотентность по sha256 файла; построчная дедупликация по dedupe_key
 * (INSERT ... ON CONFLICT DO NOTHING).
 */
@Injectable()
export class FinanceImportService {
  private readonly log = new Logger(FinanceImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FinanceStatement)
    private readonly statements: Repository<FinanceStatement>,
    @InjectRepository(FinanceTransaction)
    private readonly txns: Repository<FinanceTransaction>,
    @InjectRepository(FinanceMerchant)
    private readonly merchants: Repository<FinanceMerchant>,
    @InjectRepository(FinanceCategory)
    private readonly categories: Repository<FinanceCategory>,
    private readonly categorization: CategorizationService,
  ) {}

  async importPdf(buffer: Buffer, fileName: string): Promise<ImportResult> {
    const fileHash = sha256(buffer);

    // 1. идемпотентность по содержимому файла
    const existing = await this.statements.findOne({ where: { fileHash } });
    if (existing) {
      return {
        status: 'duplicate',
        bank: existing.bank,
        source: existing.source,
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        statementDate: existing.statementDate,
        inserted: existing.txnCount,
        skipped: 0,
        totalInHkd: existing.totalInHkd,
        totalOutHkd: existing.totalOutHkd,
        byCategory: [],
        uncategorizedCount: 0,
        alipayFundingCount: 0,
        alipayFundingHkd: 0,
        reconciled: existing.reconciled,
        issues: existing.issues ?? [],
      };
    }

    // 2. парсинг
    let parsed: ParsedStatement;
    try {
      parsed = await parseStatement(new Uint8Array(buffer));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.warn(`parse failed for ${fileName}: ${error}`);
      await this.statements.save(
        this.statements.create({
          source: 'mox', // неизвестно; помечаем failed
          bank: 'unknown',
          accountNo: null,
          fileHash,
          fileName,
          status: 'failed',
          issues: [error],
        }),
      );
      return {
        status: 'failed',
        bank: 'unknown',
        source: null,
        periodStart: null,
        periodEnd: null,
        statementDate: null,
        inserted: 0,
        skipped: 0,
        totalInHkd: 0,
        totalOutHkd: 0,
        byCategory: [],
        uncategorizedCount: 0,
        alipayFundingCount: 0,
        alipayFundingHkd: 0,
        reconciled: false,
        issues: [error],
        error,
      };
    }

    // 3. шапка выписки
    const statement = await this.statements.save(
      this.statements.create({
        source: parsed.source,
        bank: parsed.bank,
        accountNo: parsed.accountNo,
        fileHash,
        fileName,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        statementDate: parsed.statementDate,
        status: parsed.reconciled ? 'parsed' : 'partial',
        reconciled: parsed.reconciled,
        issues: parsed.issues.length ? parsed.issues : null,
      }),
    );

    // 4. категоризация + сборка строк
    const catName = await this.categoryNameMap();
    interface Built {
      row: Partial<FinanceTransaction>;
      categoryId: number | null;
    }
    const built: Built[] = [];
    const merchantWanted = new Map<
      string,
      { display: string; categoryId: number | null }
    >();

    // счётчик повторов «date|amount|desc» в пределах выписки — для строк без
    // естественного ключа (Mox: нет ни txn_no, ни running balance), чтобы реальные
    // одинаковые операции одного дня не схлопнулись в дедупе.
    const ordinal = new Map<string, number>();
    for (const p of parsed.txns) {
      const c = await this.categorization.categorize(p);
      const amountHkd = toHkd(p);
      const hasNaturalKey = p.txnNo != null || p.balanceAfter != null;
      let seq = 0;
      if (!hasNaturalKey) {
        const k = `${p.txnDate}|${round2(p.amount).toFixed(2)}|${normDesc(p.descriptionRaw)}`;
        seq = ordinal.get(k) ?? 0;
        ordinal.set(k, seq + 1);
      }
      if (c.merchantNorm && !merchantWanted.has(c.merchantNorm)) {
        merchantWanted.set(c.merchantNorm, {
          display: c.merchantDisplay ?? c.merchantNorm,
          categoryId: c.merchantCategoryId,
        });
      }
      built.push({
        categoryId: c.merchantCategoryId,
        row: {
          statementId: statement.id,
          source: p.source,
          accountNo: p.accountNo,
          txnDate: p.txnDate,
          txnTime: p.txnTime ?? null,
          settleDate: p.settleDate ?? null,
          currency: p.currency,
          amount: round2(p.amount),
          amountHkd,
          direction: c.direction,
          txnClass: c.txnClass,
          descriptionRaw: p.descriptionRaw,
          merchantNorm: c.merchantNorm, // временно, заменим на merchantId ниже
          originalAmount: p.originalAmount ?? null,
          originalCurrency: p.originalCurrency ?? null,
          balanceAfter: p.balanceAfter ?? null,
          txnNo: p.txnNo ?? null,
          isAlipayFunding: c.isAlipayFunding,
          isInternal: c.isInternal,
          dedupeKey: this.dedupeKey(p, amountHkd, seq),
        } as Partial<FinanceTransaction> & { merchantNorm?: string | null },
      });
    }

    // 5. upsert мерчантов → norm→id
    const merchantId = await this.upsertMerchants(merchantWanted);

    // 6. вставка с ON CONFLICT (dedupe_key) DO NOTHING, считаем реально вставленные
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < built.length; i += CHUNK) {
      const slice = built.slice(i, i + CHUNK);
      const values = slice.map((b) => {
        const r = b.row as Partial<FinanceTransaction> & {
          merchantNorm?: string | null;
        };
        const mid = r.merchantNorm
          ? (merchantId.get(r.merchantNorm) ?? null)
          : null;
        delete r.merchantNorm;
        return { ...r, merchantId: mid };
      });
      const res = await this.txns
        .createQueryBuilder()
        .insert()
        .into(FinanceTransaction)
        .values(values as QueryDeepPartialEntity<FinanceTransaction>[])
        .orIgnore() // ON CONFLICT (dedupe_key) DO NOTHING
        .returning('id')
        .execute();
      inserted += Array.isArray(res.raw) ? res.raw.length : 0;
    }
    const skipped = built.length - inserted;

    // 7. сводка по содержимому выписки
    const summary = this.summarize(built, catName);
    statement.txnCount = parsed.txns.length;
    statement.totalInHkd = summary.totalInHkd;
    statement.totalOutHkd = summary.totalOutHkd;
    await this.statements.save(statement);

    return {
      status: 'imported',
      bank: parsed.bank,
      source: parsed.source,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      statementDate: parsed.statementDate,
      inserted,
      skipped,
      reconciled: parsed.reconciled,
      issues: parsed.issues,
      ...summary,
    };
  }

  // --- helpers ---

  private dedupeKey(p: ParsedTxn, amountHkd: number, seq: number): string {
    // Естественные ключи: txn_no (Alipay) или running balance (SC) — стабильны и
    // различают строки между перекрывающимися выписками. Если их нет (Mox) — добавляем
    // порядковый номер повтора в пределах выписки (детерминирован по содержимому).
    const hasNaturalKey = p.txnNo != null || p.balanceAfter != null;
    return sha256(
      [
        p.source,
        p.accountNo ?? '',
        p.currency,
        p.txnDate ?? '',
        round2(p.amount).toFixed(2),
        amountHkd.toFixed(2),
        normDesc(p.descriptionRaw),
        p.balanceAfter != null ? p.balanceAfter.toFixed(2) : '',
        p.txnNo ?? '',
        hasNaturalKey ? '' : String(seq),
      ].join('|'),
    );
  }

  private async categoryNameMap(): Promise<Map<number, string>> {
    const cats = await this.categories.find();
    return new Map(cats.map((c) => [c.id, c.name]));
  }

  private async upsertMerchants(
    wanted: Map<string, { display: string; categoryId: number | null }>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!wanted.size) return out;
    const values = [...wanted.entries()].map(([normName, v]) => ({
      normName,
      display: v.display,
      categoryId: v.categoryId,
    }));
    await this.merchants
      .createQueryBuilder()
      .insert()
      .into(FinanceMerchant)
      .values(values)
      .orIgnore() // существующих не трогаем (категория уже могла быть уточнена вручную)
      .execute();
    const rows = await this.merchants
      .createQueryBuilder('m')
      .select(['m.id', 'm.normName'])
      .where('m.normName IN (:...names)', { names: [...wanted.keys()] })
      .getMany();
    for (const m of rows) out.set(m.normName, m.id);
    return out;
  }

  private summarize(
    built: { row: Partial<FinanceTransaction>; categoryId: number | null }[],
    catName: Map<number, string>,
  ): {
    totalInHkd: number;
    totalOutHkd: number;
    byCategory: CategoryBreakdown[];
    uncategorizedCount: number;
    alipayFundingCount: number;
    alipayFundingHkd: number;
  } {
    let totalInHkd = 0;
    let totalOutHkd = 0;
    let alipayFundingCount = 0;
    let alipayFundingHkd = 0;
    let uncategorizedCount = 0;
    const cat = new Map<string, { spend: number; n: number }>();

    for (const b of built) {
      const r = b.row;
      const hkd = r.amountHkd ?? 0;
      const cls = r.txnClass;
      if (
        cls === 'income_salary' ||
        cls === 'income_interest' ||
        cls === 'income_cashback'
      ) {
        totalInHkd += hkd;
      } else if (cls === 'alipay_funding') {
        alipayFundingCount += 1;
        alipayFundingHkd += -hkd;
      } else if (cls === 'expense') {
        const spend = -hkd; // положительная величина траты (возвраты нетят знаком)
        totalOutHkd += spend;
        const name = b.categoryId
          ? (catName.get(b.categoryId) ?? 'Other / Uncategorized')
          : 'Other / Uncategorized';
        const e = cat.get(name) ?? { spend: 0, n: 0 };
        e.spend += spend;
        e.n += 1;
        cat.set(name, e);
        if (name === 'Other / Uncategorized') uncategorizedCount += 1;
      }
    }

    const byCategory: CategoryBreakdown[] = [...cat.entries()]
      .map(([category, v]) => ({ category, spendHkd: round2(v.spend), n: v.n }))
      .sort((a, b) => b.spendHkd - a.spendHkd);

    return {
      totalInHkd: round2(totalInHkd),
      totalOutHkd: round2(totalOutHkd),
      byCategory,
      uncategorizedCount,
      alipayFundingCount,
      alipayFundingHkd: round2(alipayFundingHkd),
    };
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Конвертация суммы в HKD: mox/alipay уже в HKD; SC — по приблизительному курсу. */
function toHkd(p: ParsedTxn): number {
  if (p.currency === 'HKD') return round2(p.amount);
  const rate = FX[p.currency] ?? 1;
  return round2(p.amount * rate);
}
