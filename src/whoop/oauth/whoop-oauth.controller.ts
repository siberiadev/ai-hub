import {
  Controller,
  Get,
  Header,
  Logger,
  NotFoundException,
  Query,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhoopOAuthService } from './whoop-oauth.service';

/** OAuth-эндпоинты WHOOP. `/start` защищён секретом, `/callback` — целевой redirect URI. */
@Controller('whoop/oauth')
export class WhoopOAuthController {
  private readonly log = new Logger(WhoopOAuthController.name);

  constructor(
    private readonly oauth: WhoopOAuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Старт авторизации: редирект на согласие WHOOP. Защищён `?key=<WHOOP_CONNECT_SECRET>` —
   * без верного ключа отдаём 404 (не светим существование эндпоинта).
   */
  @Get('start')
  @Redirect()
  start(@Query('key') key?: string): { url: string } {
    const secret = this.config.get<string>('WHOOP_CONNECT_SECRET');
    if (!secret || key !== secret) {
      throw new NotFoundException();
    }
    return this.oauth.buildAuthorizeUrl();
  }

  /** Callback WHOOP: обмен кода на токены и сохранение аккаунта. */
  @Get('callback')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<string> {
    const { userId, email } = await this.oauth.handleCallback(
      code ?? '',
      state ?? '',
    );
    return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif">
<h3>WHOOP подключён ✅</h3>
<p>user ${userId}${email ? ` (${email})` : ''}. Можно закрыть окно.</p>
</body>`;
  }
}
