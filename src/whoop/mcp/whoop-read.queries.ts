/** Построители SQL для MCP-тулы `read` (только SELECT). Чистые функции — легко тестируются. */

export const READ_TYPES = [
  'workout',
  'sleep',
  'recovery',
  'cycle',
  'summary',
  'trend',
] as const;
export type ReadType = (typeof READ_TYPES)[number];

export const TREND_BUCKETS = ['day', 'week', 'month'] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

export interface ReadArgs {
  type: ReadType;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SqlQuery {
  text: string;
  params: unknown[];
}

export function isReadType(x: unknown): x is ReadType {
  return typeof x === 'string' && (READ_TYPES as readonly string[]).includes(x);
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export function clampLimit(n?: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/** Список-тип → таблица, колонка времени, набор колонок (без raw jsonb). */
const SPEC: Record<
  Exclude<ReadType, 'summary' | 'trend'>,
  { table: string; time: string; cols: string[] }
> = {
  workout: {
    table: 'whoop_workout',
    time: 'start',
    cols: [
      'id',
      'start',
      '"end"',
      'sport_name',
      'strain',
      'average_heart_rate',
      'max_heart_rate',
      'kilojoule',
      'distance_meter',
      'score_state',
    ],
  },
  sleep: {
    table: 'whoop_sleep',
    time: 'start',
    cols: [
      'id',
      'start',
      '"end"',
      'nap',
      'sleep_performance_percentage',
      'sleep_efficiency_percentage',
      'respiratory_rate',
      'total_in_bed_time_milli',
      'total_rem_sleep_time_milli',
      'total_slow_wave_sleep_time_milli',
      'disturbance_count',
      'score_state',
    ],
  },
  recovery: {
    table: 'whoop_recovery',
    time: 'whoop_created_at',
    cols: [
      'sleep_id',
      'cycle_id',
      'recovery_score',
      'resting_heart_rate',
      'hrv_rmssd_milli',
      'spo2_percentage',
      'skin_temp_celsius',
      'score_state',
      'whoop_created_at',
    ],
  },
  cycle: {
    table: 'whoop_cycle',
    time: 'start',
    cols: [
      'id',
      'start',
      '"end"',
      'strain',
      'average_heart_rate',
      'max_heart_rate',
      'kilojoule',
      'score_state',
    ],
  },
};

/** Запрос-список для workout|sleep|recovery|cycle с фильтром по времени и лимитом. */
export function buildListQuery(
  type: Exclude<ReadType, 'summary' | 'trend'>,
  args: Omit<ReadArgs, 'type'> = {},
): SqlQuery {
  const spec = SPEC[type];
  const params: unknown[] = [];
  const where = ['deleted_at IS NULL'];
  if (args.from) {
    params.push(args.from);
    where.push(`${spec.time} >= $${params.length}`);
  }
  if (args.to) {
    params.push(args.to);
    where.push(`${spec.time} <= $${params.length}`);
  }
  params.push(clampLimit(args.limit));
  const text =
    `SELECT ${spec.cols.join(', ')} FROM ${spec.table} ` +
    `WHERE ${where.join(' AND ')} ` +
    `ORDER BY ${spec.time} DESC NULLS LAST LIMIT $${params.length}`;
  return { text, params };
}

/** Набор одно-строчных запросов для краткой сводки самочувствия. */
export function buildSummaryQueries(): Record<string, SqlQuery> {
  return {
    latest_recovery: {
      text:
        'SELECT recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, ' +
        'skin_temp_celsius, score_state, whoop_created_at FROM whoop_recovery ' +
        'WHERE deleted_at IS NULL ORDER BY whoop_created_at DESC NULLS LAST LIMIT 1',
      params: [],
    },
    last_sleep: {
      text:
        'SELECT id, start, "end", sleep_performance_percentage, sleep_efficiency_percentage, ' +
        'respiratory_rate, score_state FROM whoop_sleep ' +
        'WHERE deleted_at IS NULL ORDER BY start DESC NULLS LAST LIMIT 1',
      params: [],
    },
    latest_cycle: {
      text:
        'SELECT id, start, "end", strain, average_heart_rate, max_heart_rate, kilojoule, score_state ' +
        'FROM whoop_cycle WHERE deleted_at IS NULL ORDER BY start DESC NULLS LAST LIMIT 1',
      params: [],
    },
    avg_7d: {
      text:
        "SELECT avg(recovery_score) AS recovery_score, avg(hrv_rmssd_milli) AS hrv_rmssd_milli, " +
        "avg(resting_heart_rate) AS resting_heart_rate FROM whoop_recovery " +
        "WHERE deleted_at IS NULL AND whoop_created_at >= now() - interval '7 days'",
      params: [],
    },
  };
}

// --- режим тренда (серверная агрегация) ---

/** Whitelist метрик: имя → таблица/числовая колонка/колонка времени. В SQL берём только отсюда. */
const TREND_METRICS: Record<string, { table: string; col: string; time: string }> = {
  recovery_score: { table: 'whoop_recovery', col: 'recovery_score', time: 'whoop_created_at' },
  hrv_rmssd_milli: { table: 'whoop_recovery', col: 'hrv_rmssd_milli', time: 'whoop_created_at' },
  resting_heart_rate: { table: 'whoop_recovery', col: 'resting_heart_rate', time: 'whoop_created_at' },
  spo2_percentage: { table: 'whoop_recovery', col: 'spo2_percentage', time: 'whoop_created_at' },
  skin_temp_celsius: { table: 'whoop_recovery', col: 'skin_temp_celsius', time: 'whoop_created_at' },
  sleep_performance: { table: 'whoop_sleep', col: 'sleep_performance_percentage', time: 'start' },
  sleep_efficiency: { table: 'whoop_sleep', col: 'sleep_efficiency_percentage', time: 'start' },
  respiratory_rate: { table: 'whoop_sleep', col: 'respiratory_rate', time: 'start' },
  strain: { table: 'whoop_cycle', col: 'strain', time: 'start' },
  day_avg_heart_rate: { table: 'whoop_cycle', col: 'average_heart_rate', time: 'start' },
};

export const TREND_METRIC_NAMES = Object.keys(TREND_METRICS);

export function isTrendMetric(x: unknown): x is string {
  return (
    typeof x === 'string' &&
    Object.prototype.hasOwnProperty.call(TREND_METRICS, x)
  );
}

export function isTrendBucket(x: unknown): x is TrendBucket {
  return typeof x === 'string' && (TREND_BUCKETS as readonly string[]).includes(x);
}

export interface TrendArgs {
  metric: string;
  bucket?: string;
  from?: string;
  to?: string;
}

/** Бакетированная агрегация метрики (avg/min/max/n) по времени. Метрика — из whitelist. */
export function buildTrendQuery(args: TrendArgs): SqlQuery {
  const m = TREND_METRICS[args.metric];
  if (!m) throw new Error(`Неизвестная метрика тренда: ${args.metric}`);
  const bucket: TrendBucket = isTrendBucket(args.bucket) ? args.bucket : 'week';
  const params: unknown[] = [bucket]; // $1 = аргумент date_trunc (текст → безопасно)
  const where = ['deleted_at IS NULL', `${m.col} IS NOT NULL`];
  if (args.from) {
    params.push(args.from);
    where.push(`${m.time} >= $${params.length}`);
  }
  if (args.to) {
    params.push(args.to);
    where.push(`${m.time} <= $${params.length}`);
  }
  const text =
    `SELECT date_trunc($1, ${m.time}) AS bucket, ` +
    `round(avg(${m.col})::numeric, 2)::float8 AS avg, ` +
    `min(${m.col}) AS min, max(${m.col}) AS max, count(${m.col})::int AS n ` +
    `FROM ${m.table} WHERE ${where.join(' AND ')} ` +
    `GROUP BY 1 ORDER BY 1`;
  return { text, params };
}

const BUCKET_MS: Record<TrendBucket, number> = {
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000, // средний месяц (365.25/12 дней)
};

export interface TrendPoint {
  bucket: string | Date;
  avg: number;
}

/**
 * МНК-наклон `avg` по времени бакета, выраженный на 1 бакет (устойчив к пропускам). null при <2
 * валидных точках. x центрируется по первому бакету — иначе epoch-ms дают потерю точности.
 */
export function computeSlopePerBucket(
  points: TrendPoint[],
  bucket: TrendBucket,
): number | null {
  const xy = points
    .map((p) => ({ x: new Date(p.bucket).getTime(), y: p.avg }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = xy.length;
  if (n < 2) return null;
  const x0 = xy[0].x;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of xy) {
    const x = p.x - x0; // центрирование → численная устойчивость
    sx += x;
    sy += p.y;
    sxx += x * x;
    sxy += x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slopePerMs = (n * sxy - sx * sy) / denom;
  return Math.round(slopePerMs * BUCKET_MS[bucket] * 100) / 100;
}
