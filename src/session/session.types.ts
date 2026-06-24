/** Запись о сессии Claude, привязанной к Telegram-чату. */
export interface SessionRecord {
  /** UUID — тот же, что передаётся в --session-id / --resume. */
  sessionId: string;
  /** Telegram chat_id (стабильный ключ). */
  chatId: string;
  /** Опциональное имя сессии (для /sessions; заполняется позже). */
  title: string | null;
  /** Сколько ходов УСПЕШНО завершено в этой сессии. */
  turnCount: number;
  /** Время создания, epoch ms. */
  createdAt: number;
  /** Время последнего использования, epoch ms. */
  lastUsedAt: number;
}

/** Результат выбора сессии для входящего сообщения. */
export interface ResolveResult {
  /** UUID активной сессии чата. */
  sessionId: string;
  /** false → запускать с --session-id (первый ход); true → --resume. */
  resume: boolean;
}
