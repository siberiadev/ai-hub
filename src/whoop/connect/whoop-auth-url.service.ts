import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { WHOOP_AUTH_URL, WHOOP_SCOPES } from '../whoop.constants';

/**
 * Построение authorize-URL WHOOP с одноразовым `state`. Вынесено в отдельный
 * always-on сервис (общий модуль), чтобы и HTTP-контроллер, и Telegram-команда
 * могли строить ссылку через ОДИН и тот же {@link OAuthStateStore} — без
 * циклической зависимости модулей.
 */
@Injectable()
export class WhoopAuthUrlService {
  constructor(
    private readonly config: ConfigService,
    private readonly stateStore: OAuthStateStore,
  ) {}

  /** Строит URL согласия WHOOP с одноразовым state. */
  buildAuthorizeUrl(): { url: string } {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.getOrThrow<string>('WHOOP_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow<string>('WHOOP_REDIRECT_URI'),
      scope: WHOOP_SCOPES,
      state: this.stateStore.issue(),
    });
    return { url: `${WHOOP_AUTH_URL}?${params.toString()}` };
  }
}
