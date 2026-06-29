import type { BankSource } from '../finance.types';

export interface CategoryBreakdown {
  category: string;
  spendHkd: number;
  n: number;
}

export interface ImportResult {
  status: 'imported' | 'duplicate' | 'failed';
  bank: string;
  source: BankSource | null;
  periodStart: string | null;
  periodEnd: string | null;
  statementDate: string | null;
  /** Сколько новых строк вставлено. */
  inserted: number;
  /** Сколько пропущено как дубликаты (overlap периодов). */
  skipped: number;
  totalInHkd: number;
  totalOutHkd: number;
  byCategory: CategoryBreakdown[];
  uncategorizedCount: number;
  /** SC: funding-операции Alipay (исключены из расходов). */
  alipayFundingCount: number;
  alipayFundingHkd: number;
  reconciled: boolean;
  issues: string[];
  error?: string;
}

const fmtHkd = (n: number): string =>
  `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HKD`;

const period = (r: ImportResult): string => {
  if (r.periodStart && r.periodEnd) return `${r.periodStart} … ${r.periodEnd}`;
  if (r.statementDate) return `на ${r.statementDate}`;
  return '—';
};

/** Текст-сводка для Telegram после импорта выписки. */
export function formatImportSummary(r: ImportResult): string {
  if (r.status === 'failed') {
    return `❌ Не удалось разобрать выписку (${r.bank}).\n${r.error ?? ''}`.trim();
  }
  if (r.status === 'duplicate') {
    return (
      `♻️ Эта выписка уже импортирована.\n` +
      `🏦 ${r.bank} · ${period(r)}\n` +
      `Транзакций: ${r.inserted}`
    );
  }

  const lines: string[] = [];
  lines.push(`✅ Импортировано: ${r.bank}`);
  lines.push(`📅 ${period(r)}`);
  lines.push(
    `➕ новых: ${r.inserted}` +
      (r.skipped ? ` · ♻️ дублей пропущено: ${r.skipped}` : ''),
  );
  lines.push(`💰 доход: ${fmtHkd(r.totalInHkd)}`);
  lines.push(`💸 расход: ${fmtHkd(r.totalOutHkd)}`);

  if (r.byCategory.length) {
    lines.push('');
    lines.push('🧾 по категориям:');
    for (const c of r.byCategory.slice(0, 12)) {
      lines.push(`  • ${c.category}: ${fmtHkd(c.spendHkd)} (${c.n})`);
    }
  }
  if (r.alipayFundingCount) {
    lines.push('');
    lines.push(
      `🔁 Alipay-пополнения: ${r.alipayFundingCount} на ${fmtHkd(r.alipayFundingHkd)} ` +
        `(исключены из расходов — детализация в выписке Alipay)`,
    );
  }
  if (r.uncategorizedCount) {
    lines.push(`❓ без категории: ${r.uncategorizedCount}`);
  }
  if (!r.reconciled) {
    lines.push('');
    lines.push('⚠️ Баланс не сошёлся:');
    for (const i of r.issues.slice(0, 3)) lines.push(`  ${i}`);
  }
  return lines.join('\n');
}
