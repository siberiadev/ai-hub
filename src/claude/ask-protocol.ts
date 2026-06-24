/**
 * ASK-протокол: договорённость, через которую Claude в headless-режиме «задаёт
 * вопрос с вариантами». Нативные multiple-choice в `-p` отключены, поэтому просим
 * модель в системном промпте помечать такой вопрос маркером в конце ответа, а на
 * стороне Telegram парсим его и рендерим inline-кнопки.
 */

/** Маркер начала ASK-блока (последняя строка ответа). */
export const ASK_SENTINEL = '[[ASK]]';

/** Максимум вариантов в одном вопросе. */
export const ASK_MAX_OPTIONS = 6;

/** Системный промпт, добавляемый к claude (--append-system-prompt). */
export const ASK_SYSTEM_PROMPT = [
  'Ты отвечаешь пользователю через Telegram-бот.',
  'Если для продолжения тебе нужно, чтобы пользователь выбрал ОДИН из нескольких',
  'предопределённых вариантов, заверши свой ответ ОТДЕЛЬНОЙ ПОСЛЕДНЕЙ строкой строго в формате:',
  `${ASK_SENTINEL} {"question":"краткий вопрос","options":["вариант 1","вариант 2"]}`,
  'Требования к этой строке: валидный ОДНОСТРОЧНЫЙ JSON; 2–6 коротких вариантов;',
  'строка идёт самой последней, без текста после неё.',
  'Если выбор не требуется — отвечай обычным текстом и НЕ добавляй этот маркер.',
].join('\n');

/** Вопрос с вариантами, извлечённый из ответа. */
export interface AskBlock {
  question: string;
  options: string[];
}

export interface ParsedAsk {
  /** Текст ответа без ASK-строки. */
  text: string;
  /** Распознанный вопрос с вариантами (если есть и валиден). */
  ask?: AskBlock;
}

/**
 * Извлекает ASK-блок из ответа Claude. Ищет ПОСЛЕДНЮЮ строку, начинающуюся с
 * маркера. При любой ошибке/невалидности возвращает исходный текст без ask
 * (мягкая деградация — пользователь просто увидит обычный текст).
 */
export function parseAsk(text: string): ParsedAsk {
  const lines = text.split('\n');
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trimStart().startsWith(ASK_SENTINEL)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { text };

  const jsonPart = lines[idx].trimStart().slice(ASK_SENTINEL.length).trim();
  let ask: AskBlock | undefined;
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (isValidAsk(parsed)) {
      ask = { question: parsed.question, options: parsed.options };
    }
  } catch {
    ask = undefined;
  }
  if (!ask) return { text };

  const cleanText = [...lines.slice(0, idx), ...lines.slice(idx + 1)]
    .join('\n')
    .trim();
  return { text: cleanText, ask };
}

function isValidAsk(
  value: unknown,
): value is { question: string; options: string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.question !== 'string' || !v.question.trim()) return false;
  if (!Array.isArray(v.options)) return false;
  if (v.options.length < 2 || v.options.length > ASK_MAX_OPTIONS) return false;
  return v.options.every((o) => typeof o === 'string' && o.length > 0);
}
