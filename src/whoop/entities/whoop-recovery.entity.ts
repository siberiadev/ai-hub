import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScoreState } from '../whoop.types';

/**
 * Восстановление WHOOP. Собственного id нет — ключ по `sleep_id` (1:1 со сном; вебхук v2 отдаёт
 * именно sleep_id). `score` присутствует только при `SCORED`.
 */
@Entity('whoop_recovery')
@Index(['whoopUserId'])
export class WhoopRecovery {
  @PrimaryColumn({ type: 'uuid' })
  sleepId: string;

  @Index()
  @Column({ type: 'bigint' })
  cycleId: string;

  @Column({ type: 'bigint' })
  whoopUserId: string;

  @Column({ type: 'varchar' })
  scoreState: ScoreState;

  // --- score ---
  @Column({ type: 'boolean', nullable: true })
  userCalibrating: boolean | null;

  @Column({ type: 'int', nullable: true })
  recoveryScore: number | null;

  @Column({ type: 'int', nullable: true })
  restingHeartRate: number | null;

  @Column({ type: 'double precision', nullable: true })
  hrvRmssdMilli: number | null;

  @Column({ type: 'double precision', nullable: true })
  spo2Percentage: number | null;

  @Column({ type: 'double precision', nullable: true })
  skinTempCelsius: number | null;

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
