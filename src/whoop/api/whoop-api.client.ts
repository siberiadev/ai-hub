import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhoopTokenService } from '../oauth/whoop-token.service';
import { WHOOP_API_BASE } from '../whoop.constants';
import type {
  WhoopCycleDto,
  WhoopPage,
  WhoopRecoveryDto,
  WhoopSleepDto,
  WhoopWorkoutDto,
} from './whoop-api.types';

const PAGE_LIMIT = 25; // максимум на страницу у WHOOP
const MAX_RETRIES = 4; // на 429/5xx
const BACKOFF_BASE_MS = 500;
const THROTTLE_MS = 600; // ~100 req/min — бережём rate limit

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Диапазон дат для коллекций (ISO-строки). */
export interface WhoopRange {
  start?: string;
  end?: string;
}

/**
 * Клиент WHOOP API v2: Bearer от WhoopTokenService, авто-refresh на 401 (1 повтор), backoff на
 * 429/5xx, простой троттлинг и пагинация. Все методы кидают при не-2xx (кроме обработанных кодов).
 */
@Injectable()
export class WhoopApiClient {
  private readonly log = new Logger(WhoopApiClient.name);
  private lastRequestAt = 0;
  private readonly throttleMs: number;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly tokens: WhoopTokenService,
    private readonly config: ConfigService,
  ) {
    this.throttleMs = Number(
      config.get<string>('WHOOP_API_THROTTLE_MS', String(THROTTLE_MS)),
    );
    this.backoffBaseMs = Number(
      config.get<string>('WHOOP_API_BACKOFF_MS', String(BACKOFF_BASE_MS)),
    );
  }

  getWorkout(id: string): Promise<WhoopWorkoutDto> {
    return this.get(`/v2/activity/workout/${id}`);
  }
  getSleep(id: string): Promise<WhoopSleepDto> {
    return this.get(`/v2/activity/sleep/${id}`);
  }
  getCycle(id: string): Promise<WhoopCycleDto> {
    return this.get(`/v2/cycle/${id}`);
  }
  getRecoveryForCycle(cycleId: string): Promise<WhoopRecoveryDto> {
    return this.get(`/v2/cycle/${cycleId}/recovery`);
  }

  listWorkouts(range: WhoopRange = {}): Promise<WhoopWorkoutDto[]> {
    return this.paginate('/v2/activity/workout', range);
  }
  listSleeps(range: WhoopRange = {}): Promise<WhoopSleepDto[]> {
    return this.paginate('/v2/activity/sleep', range);
  }
  listCycles(range: WhoopRange = {}): Promise<WhoopCycleDto[]> {
    return this.paginate('/v2/cycle', range);
  }
  listRecoveries(range: WhoopRange = {}): Promise<WhoopRecoveryDto[]> {
    return this.paginate('/v2/recovery', range);
  }

  /** GET с авто-Bearer; на 401 — forceRefresh и один повтор. */
  async get<T>(path: string): Promise<T> {
    let token = await this.tokens.getValidAccessToken();
    let res = await this.fetchWithRetry(path, token);
    if (res.status === 401) {
      token = await this.tokens.forceRefresh();
      res = await this.fetchWithRetry(path, token);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WHOOP API ${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /** Все записи коллекции через next_token. */
  async paginate<T>(path: string, range: WhoopRange = {}): Promise<T[]> {
    const out: T[] = [];
    let nextToken: string | undefined;
    do {
      const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (range.start) qs.set('start', range.start);
      if (range.end) qs.set('end', range.end);
      if (nextToken) qs.set('nextToken', nextToken);
      const page = await this.get<WhoopPage<T>>(`${path}?${qs.toString()}`);
      out.push(...(page.records ?? []));
      nextToken = page.next_token ?? undefined;
    } while (nextToken);
    return out;
  }

  private async fetchWithRetry(
    path: string,
    token: string,
    attempt = 0,
  ): Promise<Response> {
    await this.throttle();
    const res = await fetch(`${WHOOP_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return res; // обрабатывает get() (refresh+повтор)
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const waitMs =
        res.status === 429
          ? this.retryAfterMs(res)
          : this.backoffBaseMs * 2 ** attempt;
      this.log.warn(`WHOOP ${res.status} ${path} → повтор через ${waitMs}мс`);
      await delay(waitMs);
      return this.fetchWithRetry(path, token, attempt + 1);
    }
    return res;
  }

  private retryAfterMs(res: Response): number {
    const ra = Number(res.headers.get('retry-after'));
    return Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.backoffBaseMs * 4;
  }

  /** Не чаще одного запроса в throttleMs. */
  private async throttle(): Promise<void> {
    if (this.throttleMs <= 0) return;
    const wait = this.lastRequestAt + this.throttleMs - Date.now();
    if (wait > 0) await delay(wait);
    this.lastRequestAt = Date.now();
  }
}
