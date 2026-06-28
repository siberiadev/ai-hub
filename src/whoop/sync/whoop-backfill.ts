import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhoopApiClient } from '../api/whoop-api.client';
import { WhoopCycle } from '../entities/whoop-cycle.entity';
import { WhoopRecovery } from '../entities/whoop-recovery.entity';
import { WhoopSleep } from '../entities/whoop-sleep.entity';
import { WhoopWorkout } from '../entities/whoop-workout.entity';
import { mapCycle, mapRecovery, mapSleep, mapWorkout } from './whoop-mappers';

/** Дефолт «вся история» — раньше любого членства WHOOP. */
export const BACKFILL_ALL_SINCE = '2000-01-01T00:00:00.000Z';

/** Нормализует дату начала бэкфилла в ISO; пусто/невалидно → вся история. */
export function sinceToIso(raw?: string): string {
  if (!raw) return BACKFILL_ALL_SINCE;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? BACKFILL_ALL_SINCE : d.toISOString();
}

/** Одноразовая историческая загрузка из WHOOP API (идемпотентна — upsert по PK). */
@Injectable()
export class WhoopBackfill {
  private readonly log = new Logger(WhoopBackfill.name);

  constructor(
    private readonly api: WhoopApiClient,
    @InjectRepository(WhoopWorkout)
    private readonly workouts: Repository<WhoopWorkout>,
    @InjectRepository(WhoopSleep)
    private readonly sleeps: Repository<WhoopSleep>,
    @InjectRepository(WhoopRecovery)
    private readonly recoveries: Repository<WhoopRecovery>,
    @InjectRepository(WhoopCycle)
    private readonly cycles: Repository<WhoopCycle>,
  ) {}

  async run(since: string = BACKFILL_ALL_SINCE): Promise<void> {
    const range = { start: since };
    this.log.log(`backfill начат (since=${since})`);

    const workouts = await this.api.listWorkouts(range);
    for (const w of workouts) await this.workouts.save(mapWorkout(w));
    this.log.log(`workouts: ${workouts.length}`);

    const sleeps = await this.api.listSleeps(range);
    for (const s of sleeps) await this.sleeps.save(mapSleep(s));
    this.log.log(`sleeps: ${sleeps.length}`);

    const cycles = await this.api.listCycles(range);
    for (const c of cycles) await this.cycles.save(mapCycle(c));
    this.log.log(`cycles: ${cycles.length}`);

    await this.backfillRecoveries(range, cycles);

    this.log.log('backfill готов');
  }

  /** Recovery: коллекция /v2/recovery; при недоступности — по циклам. */
  private async backfillRecoveries(
    range: { start: string },
    cycles: { id: number }[],
  ): Promise<void> {
    try {
      const recoveries = await this.api.listRecoveries(range);
      for (const r of recoveries) await this.recoveries.save(mapRecovery(r));
      this.log.log(`recoveries: ${recoveries.length}`);
    } catch (err) {
      this.log.warn(
        `/v2/recovery недоступен (${(err as Error).message}) — собираю по циклам`,
      );
      let n = 0;
      for (const c of cycles) {
        try {
          const r = await this.api.getRecoveryForCycle(String(c.id));
          await this.recoveries.save(mapRecovery(r));
          n++;
        } catch {
          // у цикла может не быть recovery — пропускаем
        }
      }
      this.log.log(`recoveries (по циклам): ${n}`);
    }
  }
}
