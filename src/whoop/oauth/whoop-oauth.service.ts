import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from './oauth-state.store';
import { WhoopTokenService } from './whoop-token.service';
import { WHOOP_API_BASE } from '../whoop.constants';
import type { WhoopProfile } from '../whoop.types';

/**
 * Authorization Code Flow WHOOP: обработка callback (обмен code → токены, профиль).
 * Построение authorize-URL вынесено в {@link WhoopAuthUrlService} (общий модуль).
 */
@Injectable()
export class WhoopOAuthService {
  private readonly log = new Logger(WhoopOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: WhoopTokenService,
    private readonly stateStore: OAuthStateStore,
  ) {}

  /** Валидирует state, меняет code на токены, тянет профиль (→ user_id), сохраняет аккаунт. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string; email: string | null }> {
    if (!code || !this.stateStore.consume(state)) {
      throw new BadRequestException(
        'Невалидный или просроченный OAuth state/code.',
      );
    }
    const tokens = await this.tokens.exchangeCode(code);
    const profile = await this.fetchProfile(tokens.access_token);
    const userId = String(profile.user_id);
    await this.tokens.saveTokens(userId, tokens, profile);
    this.log.log(`WHOOP подключён: user ${userId}`);
    return { userId, email: profile.email ?? null };
  }

  private async fetchProfile(accessToken: string): Promise<WhoopProfile> {
    const res = await fetch(`${WHOOP_API_BASE}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WHOOP profile ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as WhoopProfile;
  }
}
