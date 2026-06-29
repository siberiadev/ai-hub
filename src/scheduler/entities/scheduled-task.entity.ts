import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Жизненный цикл задачи: active — в работе, paused — на паузе, completed — отработала. */
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed';

/** Исход последнего прогона. */
export type ScheduledTaskRunStatus = 'ok' | 'error';

/**
 * Запланированная задача-промпт. Тип определяется наличием `cron`:
 * - `cron IS NULL` → разовая: один запуск в `nextRunAt`, затем `status=completed`;
 * - `cron` задан → повторяющаяся: бесконечно, либо до `endAt`/`maxRuns` (что наступит раньше).
 *
 * Время хранится в UTC (timestamptz); `cron` считается в таймзоне `timezone`.
 */
@Entity('scheduled_task')
@Index(['status', 'nextRunAt'])
export class ScheduledTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  prompt: string;

  /** Cron-выражение (5 полей). null → разовая задача. */
  @Column({ type: 'varchar', nullable: true })
  cron: string | null;

  /** IANA-таймзона для расчёта next-run по cron. */
  @Column({ type: 'varchar', default: 'UTC' })
  timezone: string;

  /** Стоп-условие: не планировать запуски позже этой даты. */
  @Column({ type: 'timestamptz', nullable: true })
  endAt: Date | null;

  /** Стоп-условие: максимум срабатываний. */
  @Column({ type: 'int', nullable: true })
  maxRuns: number | null;

  @Column({ type: 'int', default: 0 })
  runCount: number;

  @Column({ type: 'varchar', default: 'active' })
  status: ScheduledTaskStatus;

  /** Когда выполнить ближайший раз (индекс выборки due-задач). */
  @Column({ type: 'timestamptz' })
  nextRunAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastStatus: ScheduledTaskRunStatus | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Лок от двойного запуска: claim переводит в true на время выполнения. */
  @Column({ type: 'boolean', default: false })
  running: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
