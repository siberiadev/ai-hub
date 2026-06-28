import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScoreState } from '../whoop.types';

/** Сон WHOOP (v2: id — UUID; несёт cycle_id и флаг nap). */
@Entity('whoop_sleep')
@Index(['whoopUserId', 'start'])
export class WhoopSleep {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'bigint' })
  whoopUserId: string;

  /** Цикл, к которому относится сон (int64) — в TS строка. */
  @Column({ type: 'bigint', nullable: true })
  cycleId: string | null;

  @Column({ type: 'int', nullable: true })
  v1Id: number | null;

  @Column({ type: 'boolean', default: false })
  nap: boolean;

  @Column({ type: 'timestamptz' })
  start: Date;

  @Column({ type: 'timestamptz', nullable: true })
  end: Date | null;

  @Column({ type: 'varchar', nullable: true })
  timezoneOffset: string | null;

  @Column({ type: 'varchar' })
  scoreState: ScoreState;

  // --- score ---
  @Column({ type: 'double precision', nullable: true })
  respiratoryRate: number | null;

  @Column({ type: 'int', nullable: true })
  sleepPerformancePercentage: number | null;

  @Column({ type: 'int', nullable: true })
  sleepConsistencyPercentage: number | null;

  @Column({ type: 'double precision', nullable: true })
  sleepEfficiencyPercentage: number | null;

  // --- score.stage_summary (мс по стадиям + счётчики) ---
  @Column({ type: 'int', nullable: true })
  totalInBedTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  totalAwakeTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  totalNoDataTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  totalLightSleepTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  totalSlowWaveSleepTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  totalRemSleepTimeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  sleepCycleCount: number | null;

  @Column({ type: 'int', nullable: true })
  disturbanceCount: number | null;

  // --- score.sleep_needed ---
  @Column({ type: 'int', nullable: true })
  baselineMilli: number | null;

  @Column({ type: 'int', nullable: true })
  needFromSleepDebtMilli: number | null;

  @Column({ type: 'int', nullable: true })
  needFromRecentStrainMilli: number | null;

  @Column({ type: 'int', nullable: true })
  needFromRecentNapMilli: number | null;

  // --- метаданные WHOOP + наши ---
  @Column({ type: 'timestamptz', nullable: true })
  whoopCreatedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  whoopUpdatedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: unknown;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
