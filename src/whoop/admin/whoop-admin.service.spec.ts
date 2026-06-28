import { Repository } from 'typeorm';
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

describe('WhoopAdminService', () => {
  it('requeueFailed возвращает failed→pending и число затронутых', async () => {
    const events = repo({ update: jest.fn(async () => ({ affected: 3 })) });
    const svc = new WhoopAdminService(
      repo(), events, repo(), repo(), repo(), repo(),
    );
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
    const svc = new WhoopAdminService(
      accounts,
      events,
      repo({ count: jest.fn(async () => 10) }),
      repo({ count: jest.fn(async () => 20) }),
      repo({ count: jest.fn(async () => 30) }),
      repo({ count: jest.fn(async () => 40) }),
    );

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
    const svc = new WhoopAdminService(
      repo({ find: jest.fn(async () => []) }),
      repo(), repo(), repo(), repo(), repo(),
    );
    const s = await svc.status();
    expect(s.account).toBeNull();
  });
});
