import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from './oauth-state.store';
import { WhoopOAuthService } from './whoop-oauth.service';
import { WhoopTokenService } from './whoop-token.service';

function makeConfig(): ConfigService {
  const vals: Record<string, string> = {
    WHOOP_CLIENT_ID: 'cid',
    WHOOP_REDIRECT_URI: 'https://app/cb',
    WHOOP_AUTH_URL: 'https://whoop/auth',
    WHOOP_API_BASE: 'https://whoop/api',
    WHOOP_SCOPES: 'offline read:profile',
  };
  return {
    get: (k: string, d?: string) => vals[k] ?? d,
    getOrThrow: (k: string) => {
      if (!vals[k]) throw new Error(`missing ${k}`);
      return vals[k];
    },
  } as unknown as ConfigService;
}

describe('WhoopOAuthService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('buildAuthorizeUrl собирает URL с обязательными параметрами', () => {
    const store = new OAuthStateStore();
    const svc = new WhoopOAuthService(makeConfig(), {} as WhoopTokenService, store);
    const { url } = svc.buildAuthorizeUrl();
    expect(url).toContain('https://whoop/auth?');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb');
    expect(url).toContain('scope=offline');
    expect(url).toMatch(/state=[^&]+/);
  });

  it('handleCallback отвергает невалидный state (не дёргает обмен)', async () => {
    const tokens = { exchangeCode: jest.fn() } as unknown as WhoopTokenService;
    const store = { consume: jest.fn(() => false) } as unknown as OAuthStateStore;
    const svc = new WhoopOAuthService(makeConfig(), tokens, store);

    await expect(svc.handleCallback('code', 'bad')).rejects.toThrow(/state|code/i);
    expect(tokens.exchangeCode).not.toHaveBeenCalled();
  });

  it('happy path: обмен кода → профиль → сохранение аккаунта', async () => {
    const tokens = {
      exchangeCode: jest.fn(async () => ({ access_token: 'AT', expires_in: 3600 })),
      saveTokens: jest.fn(async () => ({})),
    } as unknown as WhoopTokenService;
    const store = { consume: jest.fn(() => true) } as unknown as OAuthStateStore;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ user_id: 777, email: 'me@x.io', first_name: 'A' }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const svc = new WhoopOAuthService(makeConfig(), tokens, store);
    const res = await svc.handleCallback('code', 'good');

    expect(res).toEqual({ userId: '777', email: 'me@x.io' });
    expect(tokens.exchangeCode).toHaveBeenCalledWith('code');
    expect(tokens.saveTokens).toHaveBeenCalledWith(
      '777',
      { access_token: 'AT', expires_in: 3600 },
      expect.objectContaining({ user_id: 777 }),
    );
    // профиль запрошен с Bearer
    const [profileUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(profileUrl).toBe('https://whoop/api/v2/user/profile/basic');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AT');
  });
});
