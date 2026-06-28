import {
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhoopAdminService, type BackfillStart } from './whoop-admin.service';

/**
 * Операционные admin-эндпоинты WHOOP. Защищены `?key=<WHOOP_CONNECT_SECRET>` (тот же приём, что
 * `/whoop/oauth/start`): без верного ключа — 404, не светим существование эндпоинта.
 */
@Controller('whoop/admin')
export class WhoopAdminController {
  constructor(
    private readonly admin: WhoopAdminService,
    private readonly config: ConfigService,
  ) {}

  /** Триггер исторической загрузки. `since=YYYY-MM-DD` (опц.); пусто → вся история. Возврат сразу. */
  @Post('backfill')
  @HttpCode(202)
  backfill(
    @Query('key') key?: string,
    @Query('since') since?: string,
  ): BackfillStart {
    const secret = this.config.get<string>('WHOOP_CONNECT_SECRET');
    if (!secret || key !== secret) {
      throw new NotFoundException();
    }
    return this.admin.startBackfill(since);
  }
}
