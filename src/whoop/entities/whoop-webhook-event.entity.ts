import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { WebhookEventType, WebhookStatus } from '../whoop.types';

/**
 * Журнал входящих вебхуков WHOOP: одновременно аудит, дедуп (по `trace_id`) и очередь синка.
 * Контроллер пишет сюда `pending` и сразу отвечает 200 (Фаза 4); воркер разбирает (Фаза 5).
 */
@Entity('whoop_webhook_event')
@Index(['status', 'receivedAt'])
export class WhoopWebhookEvent {
  /** Свой автоинкремент (bigint → строка в TS) — для упорядоченной обработки. */
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Уникальный id события WHOOP — ключ идемпотентности/дедупа. */
  @Column({ type: 'varchar', unique: true })
  traceId: string;

  @Column({ type: 'varchar' })
  type: WebhookEventType;

  @Column({ type: 'bigint', nullable: true })
  whoopUserId: string | null;

  /** id ресурса из вебхука (UUID или int — храним строкой). */
  @Column({ type: 'varchar' })
  resourceId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: WebhookStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Полное сырое тело вебхука. */
  @Column({ type: 'jsonb', nullable: true })
  raw: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
