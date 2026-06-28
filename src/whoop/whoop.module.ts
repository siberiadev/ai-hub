import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramModule } from '../telegram/telegram.module';
import { WhoopAdminService } from './admin/whoop-admin.service';
import { WhoopMonitorService } from './admin/whoop-monitor.service';
import { WhoopAccount } from './entities/whoop-account.entity';
import { WhoopCycle } from './entities/whoop-cycle.entity';
import { WhoopRecovery } from './entities/whoop-recovery.entity';
import { WhoopSleep } from './entities/whoop-sleep.entity';
import { WhoopWebhookEvent } from './entities/whoop-webhook-event.entity';
import { WhoopWorkout } from './entities/whoop-workout.entity';
import { WhoopOAuthController } from './oauth/whoop-oauth.controller';
import { WhoopOAuthService } from './oauth/whoop-oauth.service';
import { OAuthStateStore } from './oauth/oauth-state.store';
import { WhoopTokenService } from './oauth/whoop-token.service';
import { WhoopWebhookController } from './webhook/whoop-webhook.controller';
import { WhoopSignatureGuard } from './webhook/whoop-signature.guard';
import { WhoopWebhookService } from './webhook/whoop-webhook.service';
import { WhoopApiClient } from './api/whoop-api.client';
import { WhoopSyncService } from './sync/whoop-sync.service';
import { WhoopBackfill } from './sync/whoop-backfill';

/**
 * Модуль WHOOP. Грузится только при заданном `DATABASE_URL` (нужны TypeORM-репозитории) — тем же
 * приёмом graceful-off, что DatabaseModule. Подключать в AppModule ПОСЛЕ DatabaseModule.forRoot().
 *
 * Фаза 3: OAuth (подключение + токены). Контроллеры вебхуков/синк добавятся в Фазах 4–5.
 */
@Module({})
export class WhoopModule {
  static forRoot(): DynamicModule {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      new Logger(WhoopModule.name).warn(
        'DATABASE_URL не задан — WHOOP-модуль выключен.',
      );
      return { module: WhoopModule };
    }
    if (!process.env.WHOOP_CLIENT_ID?.trim()) {
      new Logger(WhoopModule.name).warn(
        'WHOOP_CLIENT_ID не задан — OAuth-роуты не заработают до настройки .env.',
      );
    }
    return {
      module: WhoopModule,
      imports: [
        TypeOrmModule.forFeature([
          WhoopAccount,
          WhoopWorkout,
          WhoopSleep,
          WhoopRecovery,
          WhoopCycle,
          WhoopWebhookEvent,
        ]),
        TelegramModule, // для NOTIFIER (алерты владельцу из WhoopMonitorService)
      ],
      controllers: [WhoopOAuthController, WhoopWebhookController],
      providers: [
        WhoopOAuthService,
        WhoopTokenService,
        OAuthStateStore,
        WhoopWebhookService,
        WhoopSignatureGuard,
        WhoopApiClient,
        WhoopSyncService,
        WhoopBackfill,
        WhoopAdminService,
        WhoopMonitorService,
      ],
      exports: [WhoopTokenService, WhoopApiClient],
    };
  }
}
