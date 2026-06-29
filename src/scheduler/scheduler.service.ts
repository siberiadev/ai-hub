import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ConversationService } from '../conversation/conversation.service';
import { NOTIFIER, type Notifier } from '../notify/notifier';
import { computeLifecycle } from './cron.util';
import { ScheduledTask } from './entities/scheduled-task.entity';

/**
 * Фоновый воркер планировщика: раз в `SCHEDULER_TICK_SEC` секунд берёт задачи, у которых
 * подошло время (`status='active'`, `next_run_at <= now`), и прогоняет их промпты через Claude
 * (свежая сессия), доставляя результат владельцу в Telegram (NOTIFIER).
 *
 * Паттерн setInterval + guard повторяет WhoopSyncService. Двойной запуск исключается атомарным
 * claim (`UPDATE ... SET running=true WHERE id=:id AND running=false`).
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SchedulerService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @InjectRepository(ScheduledTask)
    private readonly tasks: Repository<ScheduledTask>,
  ) {}

  onModuleInit(): void {
    const sec = Number(this.config.get<string>('SCHEDULER_TICK_SEC', '60'));
    this.timer = setInterval(() => void this.tick(), sec * 1000);
    this.timer.unref?.();
    this.log.log(`scheduler worker started (interval ${sec}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // не наслаивать тики
    this.ticking = true;
    try {
      await this.processDue();
    } catch (err) {
      this.log.error(`tick: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Найти и выполнить задачи, у которых наступил next_run_at. */
  async processDue(): Promise<void> {
    const batch = Number(this.config.get<string>('SCHEDULER_BATCH', '5'));
    const due = await this.tasks.find({
      where: {
        status: 'active',
        running: false,
        nextRunAt: LessThanOrEqual(new Date()),
      },
      order: { nextRunAt: 'ASC' },
      take: batch,
    });
    // Последовательно: пул процессов Claude ограничен (CLAUDE_MAX_PROCS).
    for (const task of due) {
      if (await this.claim(task.id)) {
        await this.runTask(task);
      }
    }
  }

  /** Атомарный лок: вернёт true, если строка перешла running false→true именно нами. */
  private async claim(id: string): Promise<boolean> {
    const res = await this.tasks
      .createQueryBuilder()
      .update(ScheduledTask)
      .set({ running: true })
      .where('id = :id AND running = false', { id })
      .execute();
    return res.affected === 1;
  }

  /** Выполнить промпт задачи, доставить результат и пересчитать жизненный цикл. */
  async runTask(task: ScheduledTask): Promise<void> {
    const now = new Date();
    try {
      const result = await this.conversation.runOnce(task.prompt);
      const text = result.text?.trim() || '(пустой ответ)';
      await this.notifier.notifyOwner(`📌 ${task.title}\n\n${text}`);
      await this.release(task, now, 'ok', null);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 500);
      this.log.warn(`задача ${task.id} (${task.title}) ошибка: ${message}`);
      await this.notifier
        .notifyOwner(`⚠️ Задача «${task.title}» упала: ${message}`)
        .catch(() => undefined);
      await this.release(task, now, 'error', message);
    }
  }

  /** Зафиксировать прогон: счётчик, исход, следующий запуск/завершение, снять лок. */
  private async release(
    task: ScheduledTask,
    ranAt: Date,
    lastStatus: 'ok' | 'error',
    lastError: string | null,
  ): Promise<void> {
    const runCount = task.runCount + 1;
    const life = computeLifecycle({ ...task, runCount }, ranAt);
    await this.tasks.update(task.id, {
      runCount,
      lastRunAt: ranAt,
      lastStatus,
      lastError,
      status: life.status,
      nextRunAt: life.nextRunAt,
      running: false,
    });
  }
}
