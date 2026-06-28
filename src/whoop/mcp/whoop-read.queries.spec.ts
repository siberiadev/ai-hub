import {
  READ_TYPES,
  buildListQuery,
  buildSummaryQueries,
  buildTrendQuery,
  clampLimit,
  computeSlopePerBucket,
  isReadType,
  isTrendBucket,
  isTrendMetric,
} from './whoop-read.queries';

describe('whoop-read.queries', () => {
  it('isReadType распознаёт допустимые типы', () => {
    expect(isReadType('workout')).toBe(true);
    expect(isReadType('summary')).toBe(true);
    expect(isReadType('nope')).toBe(false);
    expect(isReadType(undefined)).toBe(false);
  });

  it('clampLimit: дефолт 20, диапазон [1..200]', () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(9999)).toBe(200);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(Number.NaN)).toBe(20);
  });

  it('workout: deleted_at IS NULL, сортировка, лимит-параметр', () => {
    const q = buildListQuery('workout', {});
    expect(q.text).toContain('FROM whoop_workout');
    expect(q.text).toContain('deleted_at IS NULL');
    expect(q.text).toContain('ORDER BY start DESC');
    expect(q.text).toMatch(/LIMIT \$1$/);
    expect(q.params).toEqual([20]);
  });

  it('from/to добавляют параметры по порядку', () => {
    const q = buildListQuery('cycle', {
      from: '2024-01-01',
      to: '2024-02-01',
      limit: 5,
    });
    expect(q.text).toContain('start >= $1');
    expect(q.text).toContain('start <= $2');
    expect(q.text).toMatch(/LIMIT \$3$/);
    expect(q.params).toEqual(['2024-01-01', '2024-02-01', 5]);
  });

  it('recovery использует whoop_created_at как колонку времени', () => {
    const q = buildListQuery('recovery', { from: '2024-01-01' });
    expect(q.text).toContain('FROM whoop_recovery');
    expect(q.text).toContain('whoop_created_at >= $1');
    expect(q.text).toContain('ORDER BY whoop_created_at DESC');
  });

  it('summary: набор именованных SELECT-запросов', () => {
    const qs = buildSummaryQueries();
    expect(Object.keys(qs)).toEqual([
      'latest_recovery',
      'last_sleep',
      'latest_cycle',
      'avg_7d',
    ]);
    for (const q of Object.values(qs)) {
      expect(q.text.toUpperCase()).toContain('SELECT');
      expect(q.text).toContain('deleted_at IS NULL');
    }
  });

  it('READ_TYPES включает trend', () => {
    expect(READ_TYPES).toContain('trend');
  });
});

describe('whoop-read.queries trend', () => {
  it('isTrendMetric / isTrendBucket', () => {
    expect(isTrendMetric('recovery_score')).toBe(true);
    expect(isTrendMetric('nope')).toBe(false);
    expect(isTrendBucket('week')).toBe(true);
    expect(isTrendBucket('year')).toBe(false);
  });

  it('buildTrendQuery (recovery, дефолтный bucket=week)', () => {
    const q = buildTrendQuery({ metric: 'recovery_score' });
    expect(q.params).toEqual(['week']);
    expect(q.text).toContain('date_trunc($1, whoop_created_at)');
    expect(q.text).toContain('FROM whoop_recovery');
    expect(q.text).toContain('avg(recovery_score)');
    expect(q.text).toContain('deleted_at IS NULL');
    expect(q.text).toContain('recovery_score IS NOT NULL');
    expect(q.text).toContain('GROUP BY 1 ORDER BY 1');
  });

  it('buildTrendQuery (sleep, bucket+from+to → параметры $2/$3)', () => {
    const q = buildTrendQuery({
      metric: 'sleep_performance',
      bucket: 'month',
      from: '2024-01-01',
      to: '2024-06-01',
    });
    expect(q.params).toEqual(['month', '2024-01-01', '2024-06-01']);
    expect(q.text).toContain('FROM whoop_sleep');
    expect(q.text).toContain('date_trunc($1, start)');
    expect(q.text).toContain('avg(sleep_performance_percentage)');
    expect(q.text).toContain('start >= $2');
    expect(q.text).toContain('start <= $3');
  });

  it('buildTrendQuery: неизвестный bucket → week; неизвестная метрика → throw', () => {
    const q = buildTrendQuery({ metric: 'strain', bucket: 'year' });
    expect(q.params[0]).toBe('week');
    expect(q.text).toContain('FROM whoop_cycle');
    expect(() => buildTrendQuery({ metric: 'nope' })).toThrow(/метрик/i);
  });

  it('computeSlopePerBucket: наклон/края/фильтрация', () => {
    const wk = (n: number) => new Date(Date.UTC(2024, 0, 1 + 7 * n)).toISOString();
    expect(
      computeSlopePerBucket(
        [
          { bucket: wk(0), avg: 10 },
          { bucket: wk(1), avg: 20 },
          { bucket: wk(2), avg: 30 },
        ],
        'week',
      ),
    ).toBe(10);
    expect(computeSlopePerBucket([{ bucket: wk(0), avg: 5 }], 'week')).toBeNull();
    expect(
      computeSlopePerBucket(
        [
          { bucket: wk(0), avg: 50 },
          { bucket: wk(1), avg: 50 },
        ],
        'week',
      ),
    ).toBe(0);
    // нечисловой avg отфильтрован → наклон по оставшимся точкам (10 → 30 за 2 недели = 10/нед)
    expect(
      computeSlopePerBucket(
        [
          { bucket: wk(0), avg: 10 },
          { bucket: wk(1), avg: Number.NaN },
          { bucket: wk(2), avg: 30 },
        ],
        'week',
      ),
    ).toBe(10);
  });
});
