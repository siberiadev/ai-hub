import { Repository } from 'typeorm';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import { WhoopWebhookService } from './whoop-webhook.service';
import type { WhoopWebhookPayload } from './whoop-webhook.types';

function makeRepo(insertedRaw: unknown[]) {
  let captured: Record<string, unknown> | undefined;
  const execute = jest.fn(async () => ({ raw: insertedRaw }));
  const qb: Record<string, unknown> = {
    insert: () => qb,
    into: () => qb,
    values: (v: Record<string, unknown>) => {
      captured = v;
      return qb;
    },
    orIgnore: () => qb,
    execute,
  };
  return {
    repo: { createQueryBuilder: () => qb } as unknown as Repository<WhoopWebhookEvent>,
    captured: () => captured,
    execute,
  };
}

const payload: WhoopWebhookPayload = {
  user_id: 42,
  id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
  type: 'sleep.updated',
  trace_id: 'trace-1',
};

describe('WhoopWebhookService', () => {
  it('маппит payload в строку журнала (pending по умолчанию)', async () => {
    const { repo, captured } = makeRepo([{ id: '1' }]);
    await new WhoopWebhookService(repo).record(payload);

    expect(captured()).toEqual({
      traceId: 'trace-1',
      type: 'sleep.updated',
      whoopUserId: '42',
      resourceId: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
      raw: payload,
    });
  });

  it('дубль trace_id (ON CONFLICT DO NOTHING) не бросает', async () => {
    const { repo, execute } = makeRepo([]); // ничего не вставлено
    await expect(new WhoopWebhookService(repo).record(payload)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
