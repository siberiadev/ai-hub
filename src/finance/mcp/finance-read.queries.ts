/* Билдеры SQL для read-only MCP-сервера finance. Порт аналитики из views.sql.
 * Расходная вселенная = txn_class='expense' (alipay_funding и переводы исключены,
 * чтобы не задваивать с Alipay). spend_hkd = -amount_hkd (положительная величина). */

export const READ_TYPES = [
  'summary',
  'monthly',
  'by_category',
  'category_month',
  'top_merchants',
  'transactions',
  'income',
] as const;
export type ReadType = (typeof READ_TYPES)[number];

export function isReadType(v: unknown): v is ReadType {
  return typeof v === 'string' && (READ_TYPES as readonly string[]).includes(v);
}

export interface ReadArgs {
  from?: string;
  to?: string;
  source?: string;
  category?: string;
  limit?: number;
}

interface Query {
  text: string;
  params: unknown[];
}

const JOINS = `
  FROM fin_transaction t
  LEFT JOIN fin_merchant m ON m.id = t.merchant_id
  LEFT JOIN fin_category c ON c.id = m.category_id`;

/** Строит WHERE-условия по from/to/source/category. */
function filters(
  a: ReadArgs,
  opts: { category?: boolean } = {},
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (a.from) {
    params.push(a.from);
    parts.push(`t.txn_date >= $${params.length}`);
  }
  if (a.to) {
    params.push(a.to);
    parts.push(`t.txn_date <= $${params.length}`);
  }
  if (a.source) {
    params.push(a.source);
    parts.push(`t.source = $${params.length}`);
  }
  if (opts.category && a.category) {
    params.push(a.category);
    parts.push(`c.name = $${params.length}`);
  }
  return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

const clampLimit = (n: number | undefined, def: number): number =>
  Math.min(Math.max(Math.trunc(n ?? def) || def, 1), 500);

const INCOME_CLASSES = `('income_salary','income_interest','income_cashback')`;

export function buildQuery(type: ReadType, a: ReadArgs): Query {
  const f = filters(a, { category: true });

  switch (type) {
    case 'monthly': {
      // income/expense/net по месяцам
      return {
        text: `
          WITH e AS (
            SELECT date_trunc('month', t.txn_date)::date AS month, sum(-t.amount_hkd) AS exp
            FROM fin_transaction t WHERE t.txn_class='expense'${filters(a).clause}
            GROUP BY 1),
          i AS (
            SELECT date_trunc('month', t.txn_date)::date AS month, sum(t.amount_hkd) AS inc
            FROM fin_transaction t WHERE t.txn_class IN ${INCOME_CLASSES}${filters(a).clause}
            GROUP BY 1)
          SELECT COALESCE(e.month, i.month) AS month,
                 round(COALESCE(i.inc,0),2) AS income_hkd,
                 round(COALESCE(e.exp,0),2) AS expense_hkd,
                 round(COALESCE(i.inc,0)-COALESCE(e.exp,0),2) AS net_hkd
          FROM e FULL JOIN i ON e.month = i.month
          ORDER BY 1`,
        // filters() applied twice with identical args → дублируем параметры
        params: [...filters(a).params, ...filters(a).params],
      };
    }
    case 'by_category':
      return {
        text: `
          SELECT COALESCE(c.name,'Other / Uncategorized') AS category,
                 count(*)::int AS n,
                 round(sum(-t.amount_hkd),2) AS spend_hkd,
                 round(100*sum(-t.amount_hkd)/NULLIF(sum(sum(-t.amount_hkd)) OVER (),0),1) AS pct
          ${JOINS}
          WHERE t.txn_class='expense'${f.clause}
          GROUP BY 1 ORDER BY 3 DESC`,
        params: f.params,
      };
    case 'category_month':
      return {
        text: `
          SELECT COALESCE(c.name,'Other / Uncategorized') AS category,
                 date_trunc('month', t.txn_date)::date AS month,
                 round(sum(-t.amount_hkd),2) AS spend_hkd
          ${JOINS}
          WHERE t.txn_class='expense'${f.clause}
          GROUP BY 1,2 ORDER BY 1,2`,
        params: f.params,
      };
    case 'top_merchants':
      return {
        text: `
          SELECT COALESCE(m.display, t.description_raw) AS merchant,
                 COALESCE(c.name,'Other / Uncategorized') AS category,
                 count(*)::int AS n,
                 round(sum(-t.amount_hkd),2) AS spend_hkd
          ${JOINS}
          WHERE t.txn_class='expense'${f.clause}
          GROUP BY 1,2 ORDER BY 4 DESC LIMIT ${clampLimit(a.limit, 25)}`,
        params: f.params,
      };
    case 'income':
      return {
        text: `
          SELECT t.txn_date, date_trunc('month', t.txn_date)::date AS month,
                 round(t.amount_hkd,2) AS amount_hkd, t.currency,
                 CASE WHEN t.txn_class='income_salary' AND t.currency='GBP' THEN 'Salary (GBP)'
                      WHEN t.txn_class='income_salary' THEN 'Salary'
                      WHEN t.txn_class='income_interest' THEN 'Interest'
                      WHEN t.txn_class='income_cashback' THEN 'Cashback'
                      ELSE 'Other income' END AS income_type,
                 t.description_raw
          FROM fin_transaction t
          WHERE t.txn_class IN ${INCOME_CLASSES}${filters(a).clause}
          ORDER BY t.txn_date DESC LIMIT ${clampLimit(a.limit, 50)}`,
        params: filters(a).params,
      };
    case 'transactions':
    default:
      return {
        text: `
          SELECT t.txn_date, t.source, round(t.amount_hkd,2) AS amount_hkd, t.currency,
                 t.txn_class, COALESCE(m.display, t.description_raw) AS merchant,
                 c.name AS category, t.description_raw, t.is_alipay_funding
          ${JOINS}
          WHERE 1=1${f.clause}
          ORDER BY t.txn_date DESC, t.id LIMIT ${clampLimit(a.limit, 50)}`,
        params: f.params,
      };
  }
}

/** Сводка: итоги и счётчики по источникам. */
export function buildSummaryQueries(a: ReadArgs): Record<string, Query> {
  const f = filters(a);
  return {
    totals: {
      text: `
        SELECT round(sum(CASE WHEN t.txn_class IN ${INCOME_CLASSES} THEN t.amount_hkd ELSE 0 END),2) AS income_hkd,
               round(sum(CASE WHEN t.txn_class='expense' THEN -t.amount_hkd ELSE 0 END),2) AS expense_hkd,
               min(t.txn_date) AS from_date, max(t.txn_date) AS to_date,
               count(*)::int AS rows
        FROM fin_transaction t WHERE 1=1${f.clause}`,
      params: f.params,
    },
    by_source: {
      text: `
        SELECT t.source, count(*)::int AS n,
               round(sum(CASE WHEN t.txn_class='expense' THEN -t.amount_hkd ELSE 0 END),2) AS expense_hkd
        FROM fin_transaction t WHERE 1=1${f.clause}
        GROUP BY 1 ORDER BY 1`,
      params: f.params,
    },
  };
}
