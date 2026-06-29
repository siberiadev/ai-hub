import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerAdminService } from './scheduler-admin.service';
import type {
  CreateTaskInput,
  UpdateTaskInput,
} from './scheduler-admin.service';

/**
 * Внутренние CRUD-эндпоинты планировщика для MCP-сервера `scheduler`. Защищены
 * `?key=<SCHEDULER_ADMIN_SECRET>` (как /whoop/admin): без верного ключа — 404.
 */
@Controller('scheduler/tasks')
export class SchedulerAdminController {
  constructor(
    private readonly admin: SchedulerAdminService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  create(@Query('key') key: string | undefined, @Body() body: CreateTaskInput) {
    this.assertKey(key);
    return this.admin.create(body ?? {});
  }

  @Get()
  list(@Query('key') key?: string) {
    this.assertKey(key);
    return this.admin.list();
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Query('key') key: string | undefined,
    @Body() body: UpdateTaskInput,
  ) {
    this.assertKey(key);
    return this.admin.update(id, body ?? {});
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('key') key?: string) {
    this.assertKey(key);
    return this.admin.remove(id);
  }

  /** Неверный/пустой ключ → 404 (не светим существование эндпоинта). */
  private assertKey(key?: string): void {
    const secret = this.config.get<string>('SCHEDULER_ADMIN_SECRET');
    if (!secret || key !== secret) {
      throw new NotFoundException();
    }
  }
}
