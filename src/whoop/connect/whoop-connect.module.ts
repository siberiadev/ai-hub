import { Module } from '@nestjs/common';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { WhoopAuthUrlService } from './whoop-auth-url.service';
import { WhoopBackfillTriggerService } from './whoop-backfill-trigger.service';

/**
 * Лёгкий always-on модуль подключения WHOOP. Зависит только от глобального
 * ConfigModule, поэтому его безопасно импортируют и WhoopModule, и TelegramModule
 * без циклической зависимости. Держит singleton {@link OAuthStateStore}, общий для
 * выдачи state (команда/контроллер) и его проверки в callback.
 */
@Module({
  providers: [
    OAuthStateStore,
    WhoopAuthUrlService,
    WhoopBackfillTriggerService,
  ],
  exports: [OAuthStateStore, WhoopAuthUrlService, WhoopBackfillTriggerService],
})
export class WhoopConnectModule {}
