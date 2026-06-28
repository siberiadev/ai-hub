import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConversationModule } from './conversation/conversation.module';
import { DatabaseModule } from './database/database.module';
import { TelegramModule } from './telegram/telegram.module';
import { WhoopModule } from './whoop/whoop.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot(), // ПОСЛЕ ConfigModule: читает process.env. No-op без DATABASE_URL.
    WhoopModule.forRoot(), // ПОСЛЕ DatabaseModule: нужны репозитории. No-op без DATABASE_URL.
    ConversationModule, // подтягивает SessionModule + ClaudeModule
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
