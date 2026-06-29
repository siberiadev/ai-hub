import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ConversationService } from '../conversation/conversation.service';
import { ScheduledTask } from './entities/scheduled-task.entity';
import { SchedulerService } from './scheduler.service';

function makeTask(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1',
    title: 'Тест',
    prompt: 'скажи привет',
    cron: null,
    timezone: 'UTC',
    endAt: null,
    maxRuns: null,
    runCount: 0,
    status: 'active',
    nextRunAt: new Date('2026-06-29T00:00:00Z'),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    running: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('SchedulerService', () => {
  // Плоские jest.fn-объекты (как в whoop-sync.service.spec) — иначе unbound-method.
  let repo: {
    find: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let conversation: { runOnce: jest.Mock };
  let notifier: { notifyOwner: jest.Mock };
  let service: SchedulerService;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    conversation = { runOnce: jest.fn() };
    notifier = { notifyOwner: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: (_k: string, d?: string) => d,
    } as unknown as ConfigService;
    service = new SchedulerService(
      config,
      conversation as unknown as ConversationService,
      notifier,
      repo as unknown as Repository<ScheduledTask>,
    );
  });

  describe('runTask', () => {
    it('успех: доставляет результат и фиксирует ok; разовая → completed', async () => {
      conversation.runOnce.mockResolvedValue({
        text: 'Привет',
        isError: false,
      });
      const task = makeTask();

      await service.runTask(task);

      expect(conversation.runOnce).toHaveBeenCalledWith('скажи привет');
      expect(notifier.notifyOwner).toHaveBeenCalledWith(
        expect.stringContaining('Привет'),
      );
      expect(repo.update).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          runCount: 1,
          lastStatus: 'ok',
          status: 'completed',
          running: false,
        }),
      );
    });

    it('ошибка: уведомляет владельца и фиксирует error', async () => {
      conversation.runOnce.mockRejectedValue(new Error('claude упал'));
      const task = makeTask();

      await service.runTask(task);

      expect(notifier.notifyOwner).toHaveBeenCalledWith(
        expect.stringContaining('claude упал'),
      );
      expect(repo.update).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ lastStatus: 'error', running: false }),
      );
    });

    it('повторяющаяся задача остаётся active с новым nextRunAt', async () => {
      conversation.runOnce.mockResolvedValue({ text: 'ok', isError: false });
      const task = makeTask({ cron: '0 * * * *', runCount: 0 });

      await service.runTask(task);

      const call = repo.update.mock.calls[0] as [
        string,
        { status: string; runCount: number; nextRunAt: Date },
      ];
      const patch = call[1];
      expect(patch).toMatchObject({ status: 'active', runCount: 1 });
      expect(patch.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('processDue', () => {
    function mockClaim(affected: number): void {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
    }

    it('запускает задачу только при успешном claim', async () => {
      repo.find.mockResolvedValue([makeTask()]);
      conversation.runOnce.mockResolvedValue({ text: 'ok', isError: false });
      mockClaim(1);

      await service.processDue();

      expect(conversation.runOnce).toHaveBeenCalledTimes(1);
    });

    it('пропускает задачу, если claim не удался (перехватил другой воркер)', async () => {
      repo.find.mockResolvedValue([makeTask()]);
      mockClaim(0);

      await service.processDue();

      expect(conversation.runOnce).not.toHaveBeenCalled();
    });
  });
});
