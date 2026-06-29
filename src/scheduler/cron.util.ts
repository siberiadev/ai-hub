import { CronExpressionParser } from 'cron-parser';
import type {
  ScheduledTask,
  ScheduledTaskStatus,
} from './entities/scheduled-task.entity';

/**
 * Утилиты расписания поверх cron-parser (v5).
 *
 * Cron — 5 полей (минута час день месяц день-недели), считается в таймзоне `tz`.
 * Время наружу — всегда UTC `Date`.
 */

/** Бросает с понятным текстом, если выражение/таймзона невалидны. */
export function validateCron(expr: string, tz = 'UTC'): void {
  try {
    CronExpressionParser.parse(expr, { tz });
  } catch (err) {
    throw new Error(
      `Некорректное cron-выражение "${expr}" (tz=${tz}): ${(err as Error).message}`,
    );
  }
}

/** Следующий запуск после `from` (строго больше) для cron в таймзоне `tz`. */
export function computeNextRun(
  expr: string,
  tz = 'UTC',
  from: Date = new Date(),
): Date {
  const it = CronExpressionParser.parse(expr, { currentDate: from, tz });
  return it.next().toDate();
}

/**
 * Поля задачи после успешного/неуспешного прогона. `runCount` уже инкрементирован вызывающим
 * (передаётся актуальное значение). Решает: завершить задачу или назначить следующий запуск.
 *
 * - разовая (`cron` пустой) → `completed`;
 * - повторяющаяся → считаем кандидата `computeNextRun`; завершаем, если он позже `endAt`
 *   или достигнут `maxRuns`; иначе остаёмся `active` с новым `nextRunAt`.
 */
export interface Lifecycle {
  status: ScheduledTaskStatus;
  nextRunAt: Date;
}

export function computeLifecycle(
  task: Pick<
    ScheduledTask,
    'cron' | 'timezone' | 'endAt' | 'maxRuns' | 'runCount' | 'nextRunAt'
  >,
  now: Date = new Date(),
): Lifecycle {
  if (!task.cron) {
    return { status: 'completed', nextRunAt: task.nextRunAt };
  }
  if (task.maxRuns != null && task.runCount >= task.maxRuns) {
    return { status: 'completed', nextRunAt: task.nextRunAt };
  }
  const candidate = computeNextRun(task.cron, task.timezone, now);
  if (task.endAt && candidate.getTime() > task.endAt.getTime()) {
    return { status: 'completed', nextRunAt: task.nextRunAt };
  }
  return { status: 'active', nextRunAt: candidate };
}
