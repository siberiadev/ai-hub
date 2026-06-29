import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { computeNextRun, validateCron } from './cron.util';
import { ScheduledTask } from './entities/scheduled-task.entity';

/** Тело создания задачи: ровно одно из `cron` / `runAt`. */
export interface CreateTaskInput {
  title?: string;
  prompt?: string;
  cron?: string;
  runAt?: string; // ISO 8601 — разовая задача
  timezone?: string;
  endAt?: string; // ISO 8601 — стоп по дате (только с cron)
  maxRuns?: number; // стоп по числу прогонов (только с cron)
}

/** Тело обновления: все поля опциональны. */
export interface UpdateTaskInput {
  title?: string;
  prompt?: string;
  cron?: string | null;
  runAt?: string;
  timezone?: string;
  endAt?: string | null;
  maxRuns?: number | null;
  status?: 'active' | 'paused';
}

/** Краткая проекция задачи для list/ответов (без громоздкого prompt). */
export interface TaskView {
  id: string;
  title: string;
  cron: string | null;
  timezone: string;
  status: string;
  nextRunAt: string;
  endAt: string | null;
  maxRuns: number | null;
  runCount: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

function parseIso(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Поле ${field} не ISO-дата: "${value}"`);
  }
  return d;
}

/**
 * CRUD планировщика. Вся валидация (cron, ровно один режим, расчёт next-run) — здесь, чтобы
 * MCP-сервер оставался тонким. Контроллер только проверяет секрет.
 */
@Injectable()
export class SchedulerAdminService {
  constructor(
    @InjectRepository(ScheduledTask)
    private readonly tasks: Repository<ScheduledTask>,
  ) {}

  async create(input: CreateTaskInput): Promise<TaskView> {
    const title = input.title?.trim();
    const prompt = input.prompt?.trim();
    if (!title) throw new BadRequestException('title обязателен');
    if (!prompt) throw new BadRequestException('prompt обязателен');

    const hasCron = !!input.cron?.trim();
    const hasRunAt = !!input.runAt?.trim();
    if (hasCron === hasRunAt) {
      throw new BadRequestException('Укажите ровно одно из cron / runAt');
    }

    const timezone = input.timezone?.trim() || 'UTC';
    const task = this.tasks.create({
      title,
      prompt,
      timezone,
      status: 'active',
      runCount: 0,
      running: false,
    });

    if (hasCron) {
      const cron = input.cron!.trim();
      validateCron(cron, timezone);
      task.cron = cron;
      task.endAt = input.endAt ? parseIso(input.endAt, 'endAt') : null;
      task.maxRuns = input.maxRuns ?? null;
      task.nextRunAt = computeNextRun(cron, timezone);
    } else {
      if (input.endAt || input.maxRuns != null) {
        throw new BadRequestException('endAt/maxRuns применимы только с cron');
      }
      const runAt = parseIso(input.runAt!, 'runAt');
      task.cron = null;
      task.endAt = null;
      task.maxRuns = null;
      task.nextRunAt = runAt;
    }

    return this.toView(await this.tasks.save(task));
  }

  async list(): Promise<TaskView[]> {
    const rows = await this.tasks.find({
      order: { status: 'ASC', nextRunAt: 'ASC' },
    });
    return rows.map((r) => this.toView(r));
  }

  async update(id: string, input: UpdateTaskInput): Promise<TaskView> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Задача ${id} не найдена`);

    if (input.title !== undefined) task.title = input.title.trim();
    if (input.prompt !== undefined) task.prompt = input.prompt.trim();
    if (input.timezone !== undefined)
      task.timezone = input.timezone.trim() || 'UTC';
    if (input.endAt !== undefined) {
      task.endAt = input.endAt ? parseIso(input.endAt, 'endAt') : null;
    }
    if (input.maxRuns !== undefined) task.maxRuns = input.maxRuns;
    if (input.status !== undefined) task.status = input.status;

    // Смена режима/расписания → пересчёт nextRunAt.
    if (input.runAt !== undefined) {
      task.cron = null;
      task.nextRunAt = parseIso(input.runAt, 'runAt');
    } else if (input.cron !== undefined && input.cron !== null) {
      const cron = input.cron.trim();
      validateCron(cron, task.timezone);
      task.cron = cron;
      task.nextRunAt = computeNextRun(cron, task.timezone);
    } else if (input.timezone !== undefined && task.cron) {
      // Только сменили таймзону у cron-задачи — пересчитать.
      task.nextRunAt = computeNextRun(task.cron, task.timezone);
    }

    return this.toView(await this.tasks.save(task));
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const res = await this.tasks.delete(id);
    if (!res.affected) throw new NotFoundException(`Задача ${id} не найдена`);
    return { deleted: true };
  }

  private toView(t: ScheduledTask): TaskView {
    return {
      id: t.id,
      title: t.title,
      cron: t.cron,
      timezone: t.timezone,
      status: t.status,
      nextRunAt: t.nextRunAt.toISOString(),
      endAt: t.endAt ? t.endAt.toISOString() : null,
      maxRuns: t.maxRuns,
      runCount: t.runCount,
      lastRunAt: t.lastRunAt ? t.lastRunAt.toISOString() : null,
      lastStatus: t.lastStatus,
      lastError: t.lastError,
    };
  }
}
