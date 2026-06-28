import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ResolveResult, SessionRecord } from './session.types';

/** Максимальная длина авто-заголовка сессии (символов). */
const TITLE_MAX_LEN = 40;

/**
 * Делает короткий заголовок из первого сообщения пользователя: схлопывает пробелы
 * и переносы в один пробел, обрезает до TITLE_MAX_LEN символов (с «…», если длиннее).
 * Пустой/пробельный вход → ''.
 */
export function deriveTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > TITLE_MAX_LEN
    ? normalized.slice(0, TITLE_MAX_LEN).trimEnd() + '…'
    : normalized;
}

/** Сырая строка таблицы sessions (snake_case). */
interface SessionRow {
  session_id: string;
  chat_id: string;
  title: string | null;
  turn_count: number;
  created_at: number;
  last_used_at: number;
}

/**
 * Хранилище соответствия Telegram-чат → сессии Claude (SQLite, better-sqlite3).
 *
 * Модель: таблица всех сессий чата (`sessions`) + указатель активной (`chat_state`).
 * Главный метод — `resolveForMessage`: решает, запускать `claude` с `--session-id`
 * (новый разговор) или `--resume` (продолжение).
 */
@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SessionService.name);
  private db!: Database.Database;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const dbPath = this.config.get<string>(
      'DB_PATH',
      join(process.cwd(), 'data', 'ai-hub.db'),
    );
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id   TEXT PRIMARY KEY,
        chat_id      TEXT NOT NULL,
        title        TEXT,
        turn_count   INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_chat
        ON sessions(chat_id, last_used_at DESC);

      CREATE TABLE IF NOT EXISTS chat_state (
        chat_id           TEXT PRIMARY KEY,
        active_session_id TEXT NOT NULL
          REFERENCES sessions(session_id) ON DELETE CASCADE
      );
    `);
    this.log.log(`SQLite ready at ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.db?.close();
  }

  /**
   * Выбор сессии для входящего сообщения чата.
   * Нет активной → создаёт новую (resume:false). Есть → resume = (было ≥1 успешного хода).
   */
  resolveForMessage(chatId: string): ResolveResult {
    const active = this.getActive(chatId);
    if (!active) {
      const created = this.createNew(chatId);
      return { sessionId: created.sessionId, resume: false };
    }
    return { sessionId: active.sessionId, resume: active.turnCount > 0 };
  }

  /** Создаёт новую сессию и делает её активной для чата (для /new и авто-создания). */
  createNew(chatId: string, title: string | null = null): SessionRecord {
    const now = Date.now();
    const sessionId = randomUUID();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (session_id, chat_id, title, turn_count, created_at, last_used_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
        )
        .run(sessionId, chatId, title, now, now);
      this.setActiveRow(chatId, sessionId);
    });
    tx();

    return {
      sessionId,
      chatId,
      title,
      turnCount: 0,
      createdAt: now,
      lastUsedAt: now,
    };
  }

  /** Делает существующую сессию чата активной (для /resume <id>). */
  setActive(chatId: string, sessionId: string): SessionRecord {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE session_id = ? AND chat_id = ?`)
      .get(sessionId, chatId) as SessionRow | undefined;
    if (!row) {
      throw new NotFoundException(
        `session ${sessionId} not found for chat ${chatId}`,
      );
    }
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.setActiveRow(chatId, sessionId);
      this.db
        .prepare(`UPDATE sessions SET last_used_at = ? WHERE session_id = ?`)
        .run(now, sessionId);
    });
    tx();
    return this.mapRow({ ...row, last_used_at: now });
  }

  /** Список сессий чата, новые сверху (для /sessions). */
  list(chatId: string, limit = 20): SessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE chat_id = ? ORDER BY last_used_at DESC LIMIT ?`,
      )
      .all(chatId, limit) as SessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  /** Фиксирует успешно завершённый ход: +1 к turn_count, обновляет last_used_at. */
  recordTurn(chatId: string, sessionId: string): void {
    const info = this.db
      .prepare(
        `UPDATE sessions SET turn_count = turn_count + 1, last_used_at = ?
         WHERE session_id = ? AND chat_id = ?`,
      )
      .run(Date.now(), sessionId, chatId);
    if (info.changes === 0) {
      this.log.warn(
        `recordTurn: no session ${sessionId} for chat ${chatId}`,
      );
    }
  }

  /**
   * Ставит заголовок сессии только если он ещё не задан (idempotent) — для
   * авто-заголовка из первого сообщения. Повторные вызовы не перетирают title.
   */
  setTitleIfEmpty(chatId: string, sessionId: string, title: string): void {
    this.db
      .prepare(
        `UPDATE sessions SET title = ?
         WHERE session_id = ? AND chat_id = ? AND title IS NULL`,
      )
      .run(title, sessionId, chatId);
  }

  /**
   * Удаляет ещё не отработавшую (turn_count=0) сессию — например после провала
   * первого хода, чтобы следующий запрос стартовал со свежим UUID и не упёрся в
   * «session already exists». FK-каскад убирает указатель active автоматически.
   * @returns true, если запись была удалена.
   */
  discardIfUnused(chatId: string, sessionId: string): boolean {
    const info = this.db
      .prepare(
        `DELETE FROM sessions WHERE session_id = ? AND chat_id = ? AND turn_count = 0`,
      )
      .run(sessionId, chatId);
    return info.changes > 0;
  }

  /** Текущая активная сессия чата или null. */
  getActive(chatId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT s.* FROM chat_state cs
         JOIN sessions s ON s.session_id = cs.active_session_id
         WHERE cs.chat_id = ?`,
      )
      .get(chatId) as SessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  // --- внутреннее ---

  private setActiveRow(chatId: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO chat_state (chat_id, active_session_id) VALUES (?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET active_session_id = excluded.active_session_id`,
      )
      .run(chatId, sessionId);
  }

  private mapRow(r: SessionRow): SessionRecord {
    return {
      sessionId: r.session_id,
      chatId: r.chat_id,
      title: r.title,
      turnCount: r.turn_count,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    };
  }
}
