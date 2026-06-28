import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhoopAccount } from '../entities/whoop-account.entity';
import { WHOOP_TOKEN_URL } from '../whoop.constants';
import { decrypt, encrypt } from '../whoop-crypto';
import { WhoopNotConnectedError } from '../whoop.errors';
import type { WhoopProfile, WhoopTokenResponse } from '../whoop.types';

/** Обновлять access-токен, если до истечения осталось меньше этого, мс. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Хранение и выдача OAuth-токенов WHOOP: обмен кода, шифрованное хранение, ленивый refresh с
 * ротацией и per-user мьютексом (параллельные обновления сериализуются — иначе второй запрос сожжёт
 * уже использованный refresh-токен).
 */
@Injectable()
export class WhoopTokenService {
  private readonly log = new Logger(WhoopTokenService.name);
  /** Текущие in-flight refresh по whoop_user_id. */
  private readonly refreshing = new Map<string, Promise<WhoopAccount>>();

  constructor(
    @InjectRepository(WhoopAccount)
    private readonly accounts: Repository<WhoopAccount>,
    private readonly config: ConfigService,
  ) {}

  /** Обмен authorization code на токены. */
  exchangeCode(code: string): Promise<WhoopTokenResponse> {
    return this.postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.get<string>('WHOOP_REDIRECT_URI', ''),
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
    });
  }

  /** Шифрует и сохраняет токены (+опц. профиль) для пользователя; upsert по whoop_user_id. */
  async saveTokens(
    whoopUserId: string,
    tokens: WhoopTokenResponse,
    profile?: WhoopProfile,
  ): Promise<WhoopAccount> {
    const existing = await this.accounts.findOne({ where: { whoopUserId } });
    const account = existing ?? new WhoopAccount();
    account.whoopUserId = whoopUserId;
    account.accessTokenEnc = encrypt(tokens.access_token);
    if (tokens.refresh_token) {
      account.refreshTokenEnc = encrypt(tokens.refresh_token);
    }
    account.expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    account.scopes = tokens.scope ?? account.scopes ?? null;
    account.tokenType = tokens.token_type ?? account.tokenType ?? null;
    if (profile) {
      account.email = profile.email ?? null;
      account.firstName = profile.first_name ?? null;
      account.lastName = profile.last_name ?? null;
    }
    if (!existing) account.connectedAt = new Date();
    return this.accounts.save(account);
  }

  /**
   * Валидный access-токен пользователя (по умолчанию — единственного аккаунта). Если истекает —
   * рефрешит под мьютексом. Бросает, если аккаунт не подключён.
   */
  async getValidAccessToken(whoopUserId?: string): Promise<string> {
    const account = await this.getAccount(whoopUserId);
    if (!account) {
      throw new WhoopNotConnectedError();
    }
    if (account.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
      return decrypt(account.accessTokenEnc);
    }
    const refreshed = await this.refreshLocked(account);
    return decrypt(refreshed.accessTokenEnc);
  }

  /**
   * Принудительный refresh (на 401 от API, когда токен формально ещё не истёк, но отозван).
   * Рефреш под общим мьютексом.
   */
  async forceRefresh(whoopUserId?: string): Promise<string> {
    const account = await this.getAccount(whoopUserId);
    if (!account) {
      throw new WhoopNotConnectedError();
    }
    const refreshed = await this.refreshLocked(account);
    return decrypt(refreshed.accessTokenEnc);
  }

  /** Аккаунт по id или единственный подключённый (single-user). */
  async getAccount(whoopUserId?: string): Promise<WhoopAccount | null> {
    if (whoopUserId) {
      return this.accounts.findOne({ where: { whoopUserId } });
    }
    const [account] = await this.accounts.find({
      order: { connectedAt: 'DESC' },
      take: 1,
    });
    return account ?? null;
  }

  /** Рефреш с ротацией токена; сериализован per-user мьютексом. */
  private refreshLocked(account: WhoopAccount): Promise<WhoopAccount> {
    const key = account.whoopUserId;
    let inflight = this.refreshing.get(key);
    if (!inflight) {
      inflight = this.refresh(account).finally(() => this.refreshing.delete(key));
      this.refreshing.set(key, inflight);
    }
    return inflight;
  }

  private async refresh(account: WhoopAccount): Promise<WhoopAccount> {
    if (!account.refreshTokenEnc) {
      throw new UnauthorizedException(
        'Нет refresh-токена WHOOP — переподключите /whoop/oauth/start (scope offline).',
      );
    }
    this.log.log(`refresh токена WHOOP для user ${account.whoopUserId}`);
    const tokens = await this.postToken({
      grant_type: 'refresh_token',
      refresh_token: decrypt(account.refreshTokenEnc),
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      scope: 'offline',
    });
    // Ротация: ответ содержит НОВЫЕ access и refresh — перезаписываем оба.
    return this.saveTokens(account.whoopUserId, tokens);
  }

  private async postToken(
    params: Record<string, string>,
  ): Promise<WhoopTokenResponse> {
    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WHOOP token endpoint ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as WhoopTokenResponse;
  }

  private clientId(): string {
    return this.config.getOrThrow<string>('WHOOP_CLIENT_ID');
  }

  private clientSecret(): string {
    return this.config.getOrThrow<string>('WHOOP_CLIENT_SECRET');
  }
}
