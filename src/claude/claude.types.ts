/**
 * Типы событий потока `claude -p --output-format stream-json --verbose`.
 * Каждая строка stdout — отдельный JSON-объект одного из перечисленных видов.
 */

/** Блок контента внутри сообщения assistant/user. */
export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | string;
  /** Для type === 'text'. */
  text?: string;
  /** Имя инструмента для type === 'tool_use'. */
  name?: string;
  /** Прочие поля блока (id, input, content и т.п.) — не типизируем строго. */
  [key: string]: unknown;
}

/** Первое событие хода: инициализация сессии. */
export interface ClaudeInitEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
  model: string;
}

/** Сообщение ассистента (текст и/или вызовы инструментов). */
export interface ClaudeAssistantEvent {
  type: 'assistant';
  message: { content: ClaudeContentBlock[] };
  session_id: string;
}

/** Сообщение «user» — как правило, результаты выполнения инструментов. */
export interface ClaudeUserEvent {
  type: 'user';
  message: { content: ClaudeContentBlock[] };
  session_id: string;
}

/** Финальное событие хода: итоговый ответ + стоимость. */
export interface ClaudeResultEvent {
  type: 'result';
  subtype: string;
  result: string;
  session_id: string;
  total_cost_usd: number;
  is_error: boolean;
}

/**
 * Частичное событие генерации (только с `--include-partial-messages`).
 * Для стриминга текста интересен `event.delta.type === 'text_delta'` → `event.delta.text`.
 */
export interface ClaudeStreamEvent {
  type: 'stream_event';
  event: {
    type: string;
    delta?: { type: string; text?: string };
    [key: string]: unknown;
  };
  session_id: string;
}

/** Любое известное событие потока. */
export type ClaudeEvent =
  | ClaudeInitEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
  | ClaudeStreamEvent;

/** Параметры одного хода. */
export interface RunOptions {
  /** Текст сообщения пользователя (передаётся в stdin). */
  message: string;
  /** UUID сессии. На первом ходе генерируется заранее. */
  sessionId: string;
  /** false → первый ход (--session-id); true → продолжение (--resume). */
  resume: boolean;
  /** Рабочая директория процесса. По умолчанию — из конфига. */
  cwd?: string;
  /** Внешняя отмена хода. */
  signal?: AbortSignal;
}

/** Итог одного хода. */
export interface RunResult {
  /** Финальный текст ответа (поле result события type:'result'). */
  text: string;
  /** UUID сессии (для последующего --resume). */
  sessionId: string;
  /** Стоимость хода в USD (мониторинг расхода). */
  costUsd: number;
  /** Признак ошибки от CLI. */
  isError: boolean;
}
