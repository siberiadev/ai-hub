import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Результат запуска бэкфилла (зеркалит ответ /whoop/admin/backfill). */
export interface BackfillTriggerResult {
  started: boolean;
  since: string;
  alreadyRunning?: boolean;
}

/**
 * Триггерит исторический бэкфилл WHOOP, дёргая локальный admin-эндпоинт
 * (`POST /whoop/admin/backfill?key=…`) — тем же приёмом, что MCP-тула `backfill`.
 * Живёт в always-on connect-модуле, чтобы Telegram-команда могла запустить загрузку
 * без импорта тяжёлого WhoopModule (он сам импортирует TelegramModule → цикл).
 */
@Injectable()
export class WhoopBackfillTriggerService {
  constructor(private readonly config: ConfigService) {}

  /** true, если есть всё необходимое для запуска (секрет admin-эндпоинта). */
  get configured(): boolean {
    return !!this.config.get<string>('WHOOP_CONNECT_SECRET')?.trim();
  }

  /** Запускает бэкфилл. `since` — `YYYY-MM-DD`/ISO; пусто → вся история. */
  async trigger(since?: string): Promise<BackfillTriggerResult> {
    const secret = this.config.get<string>('WHOOP_CONNECT_SECRET')?.trim();
    if (!secret) {
      throw new Error(
        'WHOOP_CONNECT_SECRET не задан — нечем авторизовать запуск.',
      );
    }
    const port = Number(this.config.get<string>('PORT') ?? 3000);
    const url = new URL(`http://127.0.0.1:${port}/whoop/admin/backfill`);
    url.searchParams.set('key', secret);
    if (since) url.searchParams.set('since', since);

    const res = await fetch(url, { method: 'POST' });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `приложение ответило ${res.status}: ${body || '(пусто)'}`,
      );
    }
    return JSON.parse(body) as BackfillTriggerResult;
  }
}
