import { WhoopBackfill } from '../sync/whoop-backfill';
import { WhoopAdminService } from './whoop-admin.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function repo(over: Record<string, unknown> = {}) {
  return {
    count: jest.fn(async () => 0),
    find: jest.fn(async () => []),
    update: jest.fn(async () => ({ affected: 0 })),
    ...over,
  } as any;
}

function backfillMock(run: jest.Mock = jest.fn(async () => undefined)) {
  return { run } as unknown as WhoopBackfill;
}

/** Собирает сервис с дефолтными репозиториями; переопределяем только нужное в тесте. */
function makeService(over: {
  accounts?: any;
  events?: any;
  workouts?: any;
  sleeps?: any;
  recoveries?: any;
  cycles?: any;
  backfill?: WhoopBackfill;
} = {}) {
  return new WhoopAdminService(
    over.accounts ?? repo(),
    over.events ?? repo(),
    over.workouts ?? repo(),
    over.sleeps ?? repo(),
    over.recoveries ?? repo(),
    over.cycles ?? repo(),
    over.backfill ?? backfillMock(),
  );
}

describe('WhoopAdminService', () => {
  it('requeueFailed возвращает failed→pending и число затронутых', async () => {
    const events = repo({ update: jest.fn(async () => ({ affected: 3 })) });
    const svc = makeService({ events });
    await expect(svc.requeueFailed()).resolves.toBe(3);
    expect(events.update).toHaveBeenCalledWith(
      { status: 'failed' },
      { status: 'pending', attempts: 0, error: null },
    );
  });

  it('status агрегирует аккаунт, события, строки и последний синк', async () => {
    const events = repo({
      count: jest.fn(async (o: any) =>
        ({ pending: 1, failed: 2, processed: 3 })[o.where.status as string],
      ),
      find: jest.fn(async (o: any) =>
        o.where?.status === 'processed'
          ? [{ processedAt: new Date('2024-01-01T00:00:00Z') }]
          : [],
      ),
    });
    const accounts = repo({
      find: jest.fn(async () => [
        { whoopUserId: '42', expiresAt: new Date('2024-02-01T00:00:00Z'), scopes: 'offline' },
      ]),
    });
    const svc = makeService({
      accounts,
      events,
      workouts: repo({ count: jest.fn(async () => 10) }),
      sleeps: repo({ count: jest.fn(async () => 20) }),
      recoveries: repo({ count: jest.fn(async () => 30) }),
      cycles: repo({ count: jest.fn(async () => 40) }),
    });

    const s = await svc.status();
    expect(s.account).toEqual({
      connected: true,
      whoopUserId: '42',
      expiresAt: new Date('2024-02-01T00:00:00Z'),
      scopes: 'offline',
    });
    expect(s.events).toEqual({ pending: 1, failed: 2, processed: 3 });
    expect(s.rows).toEqual({ workout: 10, sleep: 20, recovery: 30, cycle: 40 });
    expect(s.lastProcessedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('status → account null, если аккаунтов нет', async () => {
    const svc = makeService({ accounts: repo({ find: jest.fn(async () => []) }) });
    const s = await svc.status();
    expect(s.account).toBeNull();
  });

  it('startBackfill запускает run с нормализованным since и сообщает started', () => {
    const run = jest.fn(async () => undefined);
    const svc = makeService({ backfill: backfillMock(run) });

    const res = svc.startBackfill('2024-01-01');
    expect(res).toEqual({ started: true, since: '2024-01-01T00:00:00.000Z' });
    expect(run).toHaveBeenCalledWith('2024-01-01T00:00:00.000Z');
  });

  it('startBackfill второй раз во время работы → alreadyRunning, run не зовётся повторно', () => {
    // run «висит» (никогда не резолвится) → флаг backfillRunning остаётся выставленным.
    const run = jest.fn(() => new Promise<void>(() => {}));
    const svc = makeService({ backfill: backfillMock(run) });

    expect(svc.startBackfill().started).toBe(true);
    const second = svc.startBackfill();
    expect(second).toEqual({
      started: false,
      since: '2000-01-01T00:00:00.000Z',
      alreadyRunning: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
