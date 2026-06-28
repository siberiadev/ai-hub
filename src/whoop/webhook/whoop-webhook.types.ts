import type { WebhookEventType } from '../whoop.types';

/** Тело вебхука WHOOP v2 — только метаданные (данные тянутся из API по `id`, Фаза 5). */
export interface WhoopWebhookPayload {
  /** WHOOP user id (int64). */
  user_id: number;
  /** id ресурса: UUID (workout/sleep) или int (recovery cycle/sleep). */
  id: string | number;
  type: WebhookEventType;
  /** Уникальный id события — ключ дедупа/идемпотентности. */
  trace_id: string;
}
