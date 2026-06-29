import { computeLifecycle, computeNextRun, validateCron } from './cron.util';

describe('cron.util', () => {
  describe('validateCron', () => {
    it('пропускает валидное выражение', () => {
      expect(() => validateCron('0 8 * * *')).not.toThrow();
    });
    it('бросает на мусоре', () => {
      expect(() => validateCron('не cron')).toThrow(/cron-выражение/);
    });
  });

  describe('computeNextRun', () => {
    it('считает ближайший запуск с учётом таймзоны', () => {
      // 08:00 Europe/Berlin (летом UTC+2) == 06:00 UTC
      const from = new Date('2026-06-29T05:00:00Z');
      const next = computeNextRun('0 8 * * *', 'Europe/Berlin', from);
      expect(next.toISOString()).toBe('2026-06-29T06:00:00.000Z');
    });

    it('строго после from (переходит на следующий день)', () => {
      const from = new Date('2026-06-29T08:00:00Z');
      const next = computeNextRun('0 8 * * *', 'UTC', from);
      expect(next.toISOString()).toBe('2026-06-30T08:00:00.000Z');
    });
  });

  describe('computeLifecycle', () => {
    const base = {
      cron: null as string | null,
      timezone: 'UTC',
      endAt: null as Date | null,
      maxRuns: null as number | null,
      runCount: 1,
      nextRunAt: new Date('2026-06-29T00:00:00Z'),
    };

    it('разовая (cron=null) → completed', () => {
      expect(computeLifecycle(base).status).toBe('completed');
    });

    it('cron без ограничений → active со следующим запуском', () => {
      const now = new Date('2026-06-29T08:00:00Z');
      const life = computeLifecycle(
        { ...base, cron: '0 8 * * *', runCount: 1 },
        now,
      );
      expect(life.status).toBe('active');
      expect(life.nextRunAt.toISOString()).toBe('2026-06-30T08:00:00.000Z');
    });

    it('maxRuns достигнут → completed', () => {
      const life = computeLifecycle(
        { ...base, cron: '0 8 * * *', maxRuns: 2, runCount: 2 },
        new Date('2026-06-29T08:00:00Z'),
      );
      expect(life.status).toBe('completed');
    });

    it('maxRuns ещё не достигнут → active', () => {
      const life = computeLifecycle(
        { ...base, cron: '0 8 * * *', maxRuns: 3, runCount: 2 },
        new Date('2026-06-29T08:00:00Z'),
      );
      expect(life.status).toBe('active');
    });

    it('следующий запуск за endAt → completed', () => {
      const life = computeLifecycle(
        {
          ...base,
          cron: '0 8 * * *',
          endAt: new Date('2026-06-29T12:00:00Z'),
          runCount: 1,
        },
        new Date('2026-06-29T08:00:00Z'), // next = 2026-06-30 08:00 > endAt
      );
      expect(life.status).toBe('completed');
    });

    it('следующий запуск в пределах endAt → active', () => {
      const life = computeLifecycle(
        {
          ...base,
          cron: '0 * * * *', // ежечасно
          endAt: new Date('2026-06-29T12:00:00Z'),
          runCount: 1,
        },
        new Date('2026-06-29T08:00:00Z'), // next = 09:00 < endAt
      );
      expect(life.status).toBe('active');
      expect(life.nextRunAt.toISOString()).toBe('2026-06-29T09:00:00.000Z');
    });
  });
});
