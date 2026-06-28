import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScoreState } from '../whoop.types';

/** Тренировка/активность WHOOP (v2: id — UUID). Колонки snake_case задаёт SnakeNamingStrategy. */
@Entity('whoop_workout')
@Index(['whoopUserId', 'start'])
export class WhoopWorkout {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** WHOOP user id (int64) — в TS строка (bigint). */
  @Column({ type: 'bigint' })
  whoopUserId: string;

  /** Исходный v1 integer id (backward-compat). */
  @Column({ type: 'int', nullable: true })
  v1Id: number | null;

  @Column({ type: 'timestamptz' })
  start: Date;

  @Column({ type: 'timestamptz', nullable: true })
  end: Date | null;

  @Column({ type: 'varchar', nullable: true })
  timezoneOffset: string | null;

  @Column({ type: 'int', nullable: true })
  sportId: number | null;

  @Column({ type: 'varchar', nullable: true })
  sportName: string | null;

  @Column({ type: 'varchar' })
  scoreState: ScoreState;

  // --- score ---
  @Column({ type: 'double precision', nullable: true })
  strain: number | null;

  @Column({ type: 'int', nullable: true })
  averageHeartRate: number | null;

  @Column({ type: 'int', nullable: true })
  maxHeartRate: number | null;

  @Column({ type: 'double precision', nullable: true })
  kilojoule: number | null;

  @Column({ type: 'double precision', nullable: true })
  percentRecorded: number | null;

  @Column({ type: 'double precision', nullable: true })
  distanceMeter: number | null;

  @Column({ type: 'double precision', nullable: true })
  altitudeGainMeter: number | null;

  @Column({ type: 'double precision', nullable: true })
  altitudeChangeMeter: number | null;

  // --- score.zone_durations (мс в каждой пульсовой зоне) ---
  @Column({ type: 'int', nullable: true })
  zoneZeroMilli: number | null;

  @Column({ type: 'int', nullable: true })
  zoneOneMilli: number | null;

  @Column({ type: 'int', nullable: true })
  zoneTwoMilli: number | null;

  @Column({ type: 'int', nullable: true })
  zoneThreeMilli: number | null;

  @Column({ type: 'int', nullable: true })
  zoneFourMilli: number | null;

  @Column({ type: 'int', nullable: true })
  zoneFiveMilli: number | null;

  // --- метаданные WHOOP + наши ---
  @Column({ type: 'timestamptz', nullable: true })
  whoopCreatedAt: Date | null;

  /** WHOOP updated_at — для сравнения «свежее ли пришедшее» при апсерте (Фаза 5). */
  @Column({ type: 'timestamptz', nullable: true })
  whoopUpdatedAt: Date | null;

  /** Полный сырой ответ WHOOP (forward-compat). */
  @Column({ type: 'jsonb', nullable: true })
  raw: unknown;

  /** Soft-delete по событию workout.deleted. */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
