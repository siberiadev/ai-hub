import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConversationModule } from './conversation/conversation.module';
import { DatabaseModule } from './database/database.module';
import { FinanceModule } from './finance/finance.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TelegramModule } from './telegram/telegram.module';
import { WhoopModule } from './whoop/whoop.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot(), // ПОСЛЕ ConfigModule: читает process.env. No-op без DATABASE_URL.
    WhoopModule.forRoot(), // ПОСЛЕ DatabaseModule: нужны репозитории. No-op без DATABASE_URL.
    FinanceModule.forRoot(), // global: токен FINANCE_IMPORT для TelegramService. No-op без DATABASE_URL.
    ConversationModule, // подтягивает SessionModule + ClaudeModule
    TelegramModule,
    SchedulerModule.forRoot(), // ПОСЛЕ TelegramModule: нужны ConversationService + NOTIFIER. No-op без DATABASE_URL.
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
