import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from './oauth-state.store';
import { WhoopTokenService } from './whoop-token.service';
import type { WhoopProfile } from '../whoop.types';

const DEFAULT_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const DEFAULT_API_BASE = 'https://api.prod.whoop.com/developer';
const DEFAULT_SCOPES =
  'offline read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout';

/** Authorization Code Flow WHOOP: построение authorize-URL, обработка callback, профиль. */
@Injectable()
export class WhoopOAuthService {
  private readonly log = new Logger(WhoopOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: WhoopTokenService,
    private readonly stateStore: OAuthStateStore,
  ) {}

  /** Строит URL согласия WHOOP с одноразовым state. */
  buildAuthorizeUrl(): { url: string } {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.getOrThrow<string>('WHOOP_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow<string>('WHOOP_REDIRECT_URI'),
      scope: this.config.get<string>('WHOOP_SCOPES', DEFAULT_SCOPES),
      state: this.stateStore.issue(),
    });
    const authUrl = this.config.get<string>('WHOOP_AUTH_URL', DEFAULT_AUTH_URL);
    return { url: `${authUrl}?${params.toString()}` };
  }

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
    const base = this.config.get<string>('WHOOP_API_BASE', DEFAULT_API_BASE);
    const res = await fetch(`${base}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WHOOP profile ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as WhoopProfile;
  }
}
