import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScoreState } from '../whoop.types';

/** Физиологический цикл WHOOP («день», int64 id). Вебхуков не имеет — синкается по cron (Фаза 5). */
@Entity('whoop_cycle')
@Index(['whoopUserId', 'start'])
export class WhoopCycle {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  whoopUserId: string;

  @Column({ type: 'timestamptz' })
  start: Date;

  /** null у текущего (незавершённого) цикла. */
  @Column({ type: 'timestamptz', nullable: true })
  end: Date | null;

  @Column({ type: 'varchar', nullable: true })
  timezoneOffset: string | null;

  @Column({ type: 'varchar' })
  scoreState: ScoreState;

  // --- score ---
  @Column({ type: 'double precision', nullable: true })
  strain: number | null;

  @Column({ type: 'double precision', nullable: true })
  kilojoule: number | null;

  @Column({ type: 'int', nullable: true })
  averageHeartRate: number | null;

  @Column({ type: 'int', nullable: true })
  maxHeartRate: number | null;

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
