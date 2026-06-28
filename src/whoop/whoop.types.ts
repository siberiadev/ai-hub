/** Общие union-типы домена WHOOP (используются сущностями и сервисами Фаз 3–6). */

/** Состояние скоринга ресурса. `score` присутствует в ответе только при `SCORED`. */
export type ScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';

/** Типы вебхук-событий WHOOP v2 (cycle вебхуков не шлёт). */
export type WebhookEventType =
  | 'workout.updated'
  | 'workout.deleted'
  | 'sleep.updated'
  | 'sleep.deleted'
  | 'recovery.updated'
  | 'recovery.deleted';

/** Статус обработки записи журнала вебхуков (очередь синхронизации). */
export type WebhookStatus = 'pending' | 'processed' | 'failed';

/** Ответ токен-эндпоинта WHOOP (обмен кода и refresh). */
export interface WhoopTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/** Базовый профиль WHOOP (GET /v2/user/profile/basic) — даёт whoop_user_id. */
export interface WhoopProfile {
  user_id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
}
