import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { WhoopApiClient } from '../api/whoop-api.client';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import { WhoopNotConnectedError } from '../whoop.errors';
import { WhoopSyncService } from './whoop-sync.service';

const config = { get: (_k: string, d?: string) => d } as unknown as ConfigService;

function repo() {
  return {
    save: jest.fn(async (x: unknown) => x),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

function event(over: Partial<WhoopWebhookEvent> = {}): WhoopWebhookEvent {
  return {
    id: '10',
    traceId: 'tr',
    type: 'workout.updated',
    whoopUserId: '42',
    resourceId: 'w1',
    status: 'pending',
    attempts: 0,
    error: null,
    raw: {},
    receivedAt: new Date(),
    processedAt: null,
    ...over,
  } as WhoopWebhookEvent;
}

describe('WhoopSyncService.processOne', () => {
  function make(api: Partial<WhoopApiClient>) {
    const events = repo();
    const workouts = repo();
    const sleeps = repo();
    const recoveries = repo();
    const cycles = repo();
    const svc = new WhoopSyncService(
      api as WhoopApiClient,
      config,
      events as unknown as Repository<WhoopWebhookEvent>,
      workouts as unknown as Repository<never>,
      sleeps as unknown as Repository<never>,
      recoveries as unknown as Repository<never>,
      cycles as unknown as Repository<never>,
    );
    return { svc, events, workouts, sleeps, recoveries, cycles };
  }

  it('workout.updated → save + статус processed', async () => {
    const dto = { id: 'w1', user_id: 42, start: '2024-01-01T00:00:00Z', score_state: 'SCORED' };
    const { svc, events, workouts } = make({ getWorkout: jest.fn(async () => dto) as never });
    await svc.processOne(event());

    expect(workouts.save).toHaveBeenCalledTimes(1);
    expect(events.update).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ status: 'processed' }),
    );
  });

  it('workout.deleted → soft-delete по id', async () => {
    const { svc, workouts } = make({});
    await svc.processOne(event({ type: 'workout.deleted' }));
    expect(workouts.update).toHaveBeenCalledWith(
      { id: 'w1' },
      expect.objectContaining({ deletedAt: expect.any(Date) }),
    );
  });

  it('recovery.updated → цепочка sleep → cycle → recovery', async () => {
    const sleepDto = { id: 'w1', user_id: 42, cycle_id: 999, start: '2024-01-01T00:00:00Z', score_state: 'SCORED' };
    const recDto = { cycle_id: 999, sleep_id: 'w1', user_id: 42, score_state: 'SCORED' };
    const getSleep = jest.fn(async () => sleepDto);
    const getRecoveryForCycle = jest.fn(async () => recDto);
    const { svc, sleeps, recoveries } = make({
      getSleep: getSleep as never,
      getRecoveryForCycle: getRecoveryForCycle as never,
    });

    await svc.processOne(event({ type: 'recovery.updated', resourceId: 'w1' }));

    expect(getSleep).toHaveBeenCalledWith('w1');
    expect(sleeps.save).toHaveBeenCalledTimes(1);
    expect(getRecoveryForCycle).toHaveBeenCalledWith('999');
    expect(recoveries.save).toHaveBeenCalledTimes(1);
  });

  it('«нет токена» → событие не трогаем (ждёт OAuth)', async () => {
    const { svc, events } = make({
      getWorkout: jest.fn(async () => {
        throw new WhoopNotConnectedError();
      }) as never,
    });
    await svc.processOne(event());
    expect(events.update).not.toHaveBeenCalled();
  });

  it('ошибка → attempts++ (pending), а на пределе → failed', async () => {
    const { svc, events } = make({
      getWorkout: jest.fn(async () => {
        throw new Error('boom');
      }) as never,
    });

    await svc.processOne(event({ attempts: 0 }));
    expect(events.update).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ attempts: 1, status: 'pending' }),
    );

    (events.update as jest.Mock).mockClear();
    await svc.processOne(event({ attempts: 4 })); // 4+1=5 → предел
    expect(events.update).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ attempts: 5, status: 'failed' }),
    );
  });
});
