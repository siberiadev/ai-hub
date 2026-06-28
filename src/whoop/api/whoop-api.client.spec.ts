import { ConfigService } from '@nestjs/config';
import { WhoopTokenService } from '../oauth/whoop-token.service';
import { WHOOP_API_BASE } from '../whoop.constants';
import { WhoopApiClient } from './whoop-api.client';

function config(): ConfigService {
  const vals: Record<string, string> = {
    WHOOP_API_THROTTLE_MS: '0', // мгновенные тесты
    WHOOP_API_BACKOFF_MS: '1',
  };
  return { get: (k: string, d?: string) => vals[k] ?? d } as unknown as ConfigService;
}

function httpRes(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  };
}

describe('WhoopApiClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  function tokens(over: Partial<WhoopTokenService> = {}): WhoopTokenService {
    return {
      getValidAccessToken: jest.fn(async () => 'AT'),
      forceRefresh: jest.fn(async () => 'AT2'),
      ...over,
    } as unknown as WhoopTokenService;
  }

  it('подставляет Bearer и возвращает JSON', async () => {
    const fetchMock = jest.fn(async () => httpRes(200, { id: 'w1' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new WhoopApiClient(tokens(), config());
    await expect(client.getWorkout('w1')).resolves.toEqual({ id: 'w1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WHOOP_API_BASE}/v2/activity/workout/w1`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AT');
  });

  it('на 401 делает forceRefresh и повторяет с новым токеном', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(httpRes(401, {}))
      .mockResolvedValueOnce(httpRes(200, { id: 'w1' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const tk = tokens();

    const client = new WhoopApiClient(tk, config());
    await expect(client.getWorkout('w1')).resolves.toEqual({ id: 'w1' });

    expect(tk.forceRefresh).toHaveBeenCalledTimes(1);
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init2.headers as Record<string, string>).Authorization).toBe('Bearer AT2');
  });

  it('на 429 ждёт и повторяет', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(httpRes(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(httpRes(200, { id: 'c1' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new WhoopApiClient(tokens(), config());
    await expect(client.getCycle('c1')).resolves.toEqual({ id: 'c1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('paginate идёт по next_token до пустого', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(httpRes(200, { records: [{ id: 1 }, { id: 2 }], next_token: 't2' }))
      .mockResolvedValueOnce(httpRes(200, { records: [{ id: 3 }], next_token: null }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new WhoopApiClient(tokens(), config());
    const all = await client.listWorkouts({ start: '2024-01-01T00:00:00.000Z' });

    expect(all).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][0] as string)).toContain('nextToken=t2');
  });
});
