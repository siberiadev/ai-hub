/** Лимит длины одного сообщения Telegram. */
export const TELEGRAM_MAX_LEN = 4096;

/** Лимит длины rich-сообщения (Bot API 10.1). */
export const RICH_MAX_LEN = 32768;

/**
 * Режет текст на части не длиннее `size`. Старается резать по переводам строк;
 * слишком длинную строку рубит жёстко. Пустой/пробельный текст → одна заглушка.
 */
export function chunk(text: string, size = TELEGRAM_MAX_LEN): string[] {
  if (text.length <= size) return [text.length ? text : '(пустой ответ)'];

  const chunks: string[] = [];
  let buf = '';

  const pushBuf = () => {
    if (buf.length) {
      chunks.push(buf);
      buf = '';
    }
  };

  for (const line of text.split('\n')) {
    // Строка сама по себе длиннее лимита — рубим жёстко.
    if (line.length > size) {
      pushBuf();
      for (let i = 0; i < line.length; i += size) {
        chunks.push(line.slice(i, i + size));
      }
      continue;
    }
    // +1 на восстанавливаемый '\n'.
    if (buf.length + line.length + (buf.length ? 1 : 0) > size) {
      pushBuf();
    }
    buf = buf.length ? `${buf}\n${line}` : line;
  }
  pushBuf();
  return chunks;
}

/** Короткий префикс UUID для списков. */
export function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** Человекочитаемый возраст по epoch ms: «только что», «5м», «2ч», «3д». */
export function formatAge(timestampMs: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestampMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min}м`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}ч`;
  return `${Math.floor(hours / 24)}д`;
}

/** Строка прогресса для tool_use. */
export function progressLine(toolName?: string): string {
  return toolName ? `🔧 ${toolName}…` : '🤔 думаю…';
}

/**
 * Готовит текст для live-превью в editMessageText (≤ лимита). Длинный текст
 * усекаем с многоточием — финальный ответ всё равно уйдёт через chunk().
 */
export function clampForEdit(text: string, max = TELEGRAM_MAX_LEN): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * Можно ли отрендерить ответ как rich-сообщение (нативные таблицы/заголовки):
 * включён флаг, текст непустой и помещается в лимит rich. Иначе — обычный текст.
 */
export function canRenderRich(body: string, enabled: boolean): boolean {
  return enabled && !!body.trim() && body.length <= RICH_MAX_LEN;
}
