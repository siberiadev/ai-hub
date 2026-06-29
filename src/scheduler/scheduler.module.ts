import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationModule } from '../conversation/conversation.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ScheduledTask } from './entities/scheduled-task.entity';
import { SchedulerAdminController } from './scheduler-admin.controller';
import { SchedulerAdminService } from './scheduler-admin.service';
import { SchedulerService } from './scheduler.service';

/**
 * Планировщик задач-промптов. Грузится только при заданном `DATABASE_URL` (нужны TypeORM-репозитории),
 * как WhoopModule. Подключать в AppModule ПОСЛЕ TelegramModule (нужны ConversationService и NOTIFIER).
 */
@Module({})
export class SchedulerModule {
  static forRoot(): DynamicModule {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      new Logger(SchedulerModule.name).warn(
        'DATABASE_URL не задан — планировщик выключен.',
      );
      return { module: SchedulerModule };
    }
    return {
      module: SchedulerModule,
      imports: [
        TypeOrmModule.forFeature([ScheduledTask]),
        ConversationModule, // ConversationService.runOnce
        TelegramModule, // NOTIFIER (доставка результата владельцу)
      ],
      controllers: [SchedulerAdminController],
      providers: [SchedulerService, SchedulerAdminService],
    };
  }
}
