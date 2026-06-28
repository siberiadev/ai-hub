import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhoopAccount } from '../entities/whoop-account.entity';
import { WhoopCycle } from '../entities/whoop-cycle.entity';
import { WhoopRecovery } from '../entities/whoop-recovery.entity';
import { WhoopSleep } from '../entities/whoop-sleep.entity';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import { WhoopWorkout } from '../entities/whoop-workout.entity';
import { sinceToIso, WhoopBackfill } from '../sync/whoop-backfill';

export interface WhoopStatus {
  account: {
    connected: boolean;
    whoopUserId: string;
    expiresAt: Date;
    scopes: string | null;
  } | null;
  events: { pending: number; failed: number; processed: number };
  rows: { workout: number; sleep: number; recovery: number; cycle: number };
  lastProcessedAt: Date | null;
}

/** Результат попытки запустить бэкфилл (fire-and-forget). */
export interface BackfillStart {
  started: boolean;
  since: string;
  alreadyRunning?: boolean;
}

/** Операционные операции над данными WHOOP: статус пайплайна, возврат failed-событий, бэкфилл. */
@Injectable()
export class WhoopAdminService {
  private readonly log = new Logger(WhoopAdminService.name);
  /** In-memory guard: приложение — один процесс, второй бэкфилл параллельно не нужен. */
  private backfillRunning = false;

  constructor(
    @InjectRepository(WhoopAccount)
    private readonly accounts: Repository<WhoopAccount>,
    @InjectRepository(WhoopWebhookEvent)
    private readonly events: Repository<WhoopWebhookEvent>,
    @InjectRepository(WhoopWorkout)
    private readonly workouts: Repository<WhoopWorkout>,
    @InjectRepository(WhoopSleep)
    private readonly sleeps: Repository<WhoopSleep>,
    @InjectRepository(WhoopRecovery)
    private readonly recoveries: Repository<WhoopRecovery>,
    @InjectRepository(WhoopCycle)
    private readonly cycles: Repository<WhoopCycle>,
    private readonly backfill: WhoopBackfill,
  ) {}

  /**
   * Запускает историческую загрузку в фоне (не ждём завершения — оно долгое).
   * Повторный вызов во время работы → `alreadyRunning`. `since` — `YYYY-MM-DD`/ISO; пусто → вся история.
   */
  startBackfill(since?: string): BackfillStart {
    const iso = sinceToIso(since);
    if (this.backfillRunning) {
      return { started: false, since: iso, alreadyRunning: true };
    }
    this.backfillRunning = true;
    this.backfill
      .run(iso)
      .then(() => this.log.log(`backfill завершён (since=${iso})`))
      .catch((err) =>
        this.log.error(`backfill упал: ${(err as Error).message}`),
      )
      .finally(() => {
        this.backfillRunning = false;
      });
    return { started: true, since: iso };
  }

  async status(): Promise<WhoopStatus> {
    const [account] = await this.accounts.find({
      order: { connectedAt: 'DESC' },
      take: 1,
    });
    const [pending, failed, processed] = await Promise.all([
      this.events.count({ where: { status: 'pending' } }),
      this.events.count({ where: { status: 'failed' } }),
      this.events.count({ where: { status: 'processed' } }),
    ]);
    const [workout, sleep, recovery, cycle] = await Promise.all([
      this.workouts.count(),
      this.sleeps.count(),
      this.recoveries.count(),
      this.cycles.count(),
    ]);
    const [last] = await this.events.find({
      where: { status: 'processed' },
      order: { processedAt: 'DESC' },
      take: 1,
    });

    return {
      account: account
        ? {
            connected: true,
            whoopUserId: account.whoopUserId,
            expiresAt: account.expiresAt,
            scopes: account.scopes,
          }
        : null,
      events: { pending, failed, processed },
      rows: { workout, sleep, recovery, cycle },
      lastProcessedAt: last?.processedAt ?? null,
    };
  }

  /** Возвращает все failed-события в очередь (status='pending', attempts=0). Число затронутых. */
  async requeueFailed(): Promise<number> {
    const res = await this.events.update(
      { status: 'failed' },
      { status: 'pending', attempts: 0, error: null },
    );
    return res.affected ?? 0;
  }
}
