import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { WhoopAccount } from '../entities/whoop-account.entity';
import { decrypt, encrypt } from '../whoop-crypto';
import { WhoopTokenService } from './whoop-token.service';

const KEY = Buffer.alloc(32, 5).toString('base64');

function makeConfig(): ConfigService {
  const vals: Record<string, string> = {
    WHOOP_CLIENT_ID: 'cid',
    WHOOP_CLIENT_SECRET: 'csec',
    WHOOP_REDIRECT_URI: 'https://app/cb',
    WHOOP_TOKEN_URL: 'https://whoop/token',
  };
  return {
    get: (k: string, d?: string) => vals[k] ?? d,
    getOrThrow: (k: string) => {
      if (!vals[k]) throw new Error(`missing ${k}`);
      return vals[k];
    },
  } as unknown as ConfigService;
}

/** Мок-репозиторий с одной in-memory строкой. */
function makeRepo(initial: WhoopAccount | null = null) {
  let stored = initial;
  return {
    findOne: jest.fn(async () => stored),
    find: jest.fn(async () => (stored ? [stored] : [])),
    save: jest.fn(async (a: WhoopAccount) => {
      stored = a;
      return a;
    }),
    current: () => stored,
  };
}

function account(partial: Partial<WhoopAccount>): WhoopAccount {
  return Object.assign(new WhoopAccount(), {
    whoopUserId: '42',
    accessTokenEnc: encrypt('AT'),
    refreshTokenEnc: encrypt('RT'),
    expiresAt: new Date(Date.now() + 3600_000),
    connectedAt: new Date(),
    ...partial,
  });
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body, text: async () => '' };
}

describe('WhoopTokenService', () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.WHOOP_TOKEN_ENC_KEY = KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('exchangeCode шлёт form-urlencoded grant_type=authorization_code', async () => {
    const fetchMock = jest.fn(async () =>
      okJson({ access_token: 'AT', expires_in: 3600 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new WhoopTokenService(makeRepo() as unknown as Repository<WhoopAccount>, makeConfig());
    const tokens = await svc.exchangeCode('the-code');

    expect(tokens.access_token).toBe('AT');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://whoop/token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=the-code');
  });

  it('возвращает текущий access без refresh, если токен ещё валиден', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const repo = makeRepo(account({ accessTokenEnc: encrypt('valid-AT') }));

    const svc = new WhoopTokenService(repo as unknown as Repository<WhoopAccount>, makeConfig());
    await expect(svc.getValidAccessToken()).resolves.toBe('valid-AT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('рефрешит истёкший токен и персистит ротированный refresh', async () => {
    const fetchMock = jest.fn(async () =>
      okJson({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const repo = makeRepo(
      account({ expiresAt: new Date(Date.now() - 1000) }),
    );

    const svc = new WhoopTokenService(repo as unknown as Repository<WhoopAccount>, makeConfig());
    await expect(svc.getValidAccessToken()).resolves.toBe('AT2');

    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain(
      'grant_type=refresh_token',
    );
    const saved = repo.current()!;
    expect(decrypt(saved.accessTokenEnc)).toBe('AT2');
    expect(decrypt(saved.refreshTokenEnc!)).toBe('RT2'); // ротация
  });

  it('сериализует параллельные refresh в один запрос (мьютекс)', async () => {
    let calls = 0;
    const fetchMock = jest.fn(
      () =>
        new Promise((resolve) =>
          setImmediate(() => {
            calls++;
            resolve(okJson({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }));
          }),
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const repo = makeRepo(account({ expiresAt: new Date(Date.now() - 1000) }));

    const svc = new WhoopTokenService(repo as unknown as Repository<WhoopAccount>, makeConfig());
    const [a, b] = await Promise.all([
      svc.getValidAccessToken(),
      svc.getValidAccessToken(),
    ]);

    expect(a).toBe('AT2');
    expect(b).toBe('AT2');
    expect(calls).toBe(1); // один сетевой refresh на двоих
  });

  it('бросает, если аккаунт не подключён', async () => {
    const svc = new WhoopTokenService(makeRepo() as unknown as Repository<WhoopAccount>, makeConfig());
    await expect(svc.getValidAccessToken()).rejects.toThrow(/подключ/i);
  });
});
