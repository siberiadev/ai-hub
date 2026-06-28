import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Notifier } from '../../notify/notifier';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import { WhoopMonitorService } from './whoop-monitor.service';

const config = { get: (_k: string, d?: string) => d } as unknown as ConfigService;

function make(failedSeq: number[]) {
  let i = 0;
  const events = {
    count: jest.fn(async () => failedSeq[Math.min(i++, failedSeq.length - 1)]),
  } as unknown as Repository<WhoopWebhookEvent>;
  const notifier: Notifier = { notifyOwner: jest.fn(async () => {}) };
  const svc = new WhoopMonitorService(config, events, notifier);
  return { svc, notifier };
}

describe('WhoopMonitorService.checkFailures', () => {
  it('алертит при росте, молчит при том же числе, снова алертит при новом росте', async () => {
    const { svc, notifier } = make([2, 2, 5]);
    await svc.checkFailures(); // 2 > 0 → алерт
    await svc.checkFailures(); // 2 == 2 → тихо
    await svc.checkFailures(); // 5 > 2 → алерт
    expect(notifier.notifyOwner).toHaveBeenCalledTimes(2);
  });

  it('не алертит, когда failed = 0', async () => {
    const { svc, notifier } = make([0]);
    await svc.checkFailures();
    expect(notifier.notifyOwner).not.toHaveBeenCalled();
  });
});
