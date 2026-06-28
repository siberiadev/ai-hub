import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WhoopApiClient } from '../api/whoop-api.client';
import { WhoopCycle } from '../entities/whoop-cycle.entity';
import { WhoopRecovery } from '../entities/whoop-recovery.entity';
import { WhoopSleep } from '../entities/whoop-sleep.entity';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import { WhoopWorkout } from '../entities/whoop-workout.entity';
import { WhoopNotConnectedError } from '../whoop.errors';
import { mapCycle, mapRecovery, mapSleep, mapWorkout } from './whoop-mappers';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

/**
 * Воркер синхронизации: периодически берёт pending-события из журнала, дотягивает ресурс из WHOOP
 * API и пишет в `whoop_*`. «Нет токена» не считается провалом — события ждут OAuth.
 */
@Injectable()
export class WhoopSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhoopSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private warnedNoToken = false;

  constructor(
    private readonly api: WhoopApiClient,
    private readonly config: ConfigService,
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
  ) {}

  onModuleInit(): void {
    const sec = Number(this.config.get<string>('WHOOP_SYNC_INTERVAL_SEC', '30'));
    this.timer = setInterval(() => void this.tick(), sec * 1000);
    this.timer.unref?.();
    this.log.log(`sync worker started (interval ${sec}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // не наслаивать тики
    this.running = true;
    try {
      await this.processPending();
    } catch (err) {
      this.log.error(`sync tick: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Обработать пачку pending-событий (status='pending', attempts<MAX). */
  async processPending(limit = BATCH): Promise<void> {
    const pending = await this.events.find({
      where: { status: 'pending', attempts: LessThan(MAX_ATTEMPTS) },
      order: { receivedAt: 'ASC' },
      take: limit,
    });
    for (const event of pending) {
      await this.processOne(event);
    }
  }

  /** Дотянуть и записать ресурс по одному событию; обновить статус события. */
  async processOne(event: WhoopWebhookEvent): Promise<void> {
    const id = event.resourceId;
    try {
      switch (event.type) {
        case 'workout.updated':
          await this.workouts.save(mapWorkout(await this.api.getWorkout(id)));
          break;
        case 'workout.deleted':
          await this.softDelete(this.workouts, { id });
          break;
        case 'sleep.updated':
          await this.sleeps.save(mapSleep(await this.api.getSleep(id)));
          break;
        case 'sleep.deleted':
          await this.softDelete(this.sleeps, { id });
          break;
        case 'recovery.updated': {
          // вебхук отдаёт sleep_id → сон даёт cycle_id → recovery по циклу
          const sleep = await this.api.getSleep(id);
          await this.sleeps.save(mapSleep(sleep));
          if (sleep.cycle_id != null) {
            const rec = await this.api.getRecoveryForCycle(String(sleep.cycle_id));
            await this.recoveries.save(mapRecovery(rec));
          }
          break;
        }
        case 'recovery.deleted':
          await this.softDelete(this.recoveries, { sleepId: id });
          break;
      }
      await this.events.update(event.id, {
        status: 'processed',
        processedAt: new Date(),
        error: null,
      });
    } catch (err) {
      if (err instanceof WhoopNotConnectedError) {
        if (!this.warnedNoToken) {
          this.log.warn('WHOOP не подключён — события ждут OAuth (pending).');
          this.warnedNoToken = true;
        }
        return; // не трогаем событие: дождётся подключения
      }
      const attempts = event.attempts + 1;
      const message = String((err as Error)?.message ?? err).slice(0, 500);
      await this.events.update(event.id, {
        attempts,
        error: message,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      });
      this.log.warn(`событие ${event.id} (${event.type}) ошибка #${attempts}: ${message}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async softDelete(
    repo: Repository<any>,
    criteria: Record<string, unknown>,
  ): Promise<void> {
    await repo.update(criteria, { deletedAt: new Date() });
  }
}
