import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { WhoopSignatureGuard } from './whoop-signature.guard';

const SECRET = 'whoop-client-secret';

function makeConfig(vals: Record<string, string> = {}): ConfigService {
  const all: Record<string, string> = {
    WHOOP_CLIENT_SECRET: SECRET,
    WHOOP_WEBHOOK_TOLERANCE_SEC: '300',
    ...vals,
  };
  return {
    get: (k: string, d?: string) => all[k] ?? d,
    getOrThrow: (k: string) => {
      if (!all[k]) throw new Error(k);
      return all[k];
    },
  } as unknown as ConfigService;
}

function ctx(rawBody: Buffer | undefined, headers: Record<string, string>): ExecutionContext {
  const req = { rawBody, headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function sign(ts: string, body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(ts).update(body).digest('base64');
}

describe('WhoopSignatureGuard', () => {
  const body = Buffer.from(JSON.stringify({ trace_id: 't1', type: 'sleep.updated' }));

  it('пропускает корректную подпись', () => {
    const ts = String(Date.now());
    const guard = new WhoopSignatureGuard(makeConfig());
    const c = ctx(body, {
      'x-whoop-signature': sign(ts, body),
      'x-whoop-signature-timestamp': ts,
    });
    expect(guard.canActivate(c)).toBe(true);
  });

  it('отвергает неверную подпись (401)', () => {
    const ts = String(Date.now());
    const guard = new WhoopSignatureGuard(makeConfig());
    const c = ctx(body, {
      'x-whoop-signature': sign(ts, Buffer.from('tampered')),
      'x-whoop-signature-timestamp': ts,
    });
    expect(() => guard.canActivate(c)).toThrow(/подпис/i);
  });

  it('отвергает протухший timestamp', () => {
    const ts = String(Date.now() - 10 * 60 * 1000); // 10 минут назад
    const guard = new WhoopSignatureGuard(makeConfig());
    const c = ctx(body, {
      'x-whoop-signature': sign(ts, body),
      'x-whoop-signature-timestamp': ts,
    });
    expect(() => guard.canActivate(c)).toThrow(/timestamp/i);
  });

  it('отвергает отсутствие заголовков/тела', () => {
    const guard = new WhoopSignatureGuard(makeConfig());
    expect(() => guard.canActivate(ctx(body, {}))).toThrow();
    expect(() =>
      guard.canActivate(ctx(undefined, {
        'x-whoop-signature': 'x',
        'x-whoop-signature-timestamp': String(Date.now()),
      })),
    ).toThrow();
  });

  it('использует WHOOP_WEBHOOK_SECRET, если задан', () => {
    const ts = String(Date.now());
    const guard = new WhoopSignatureGuard(makeConfig({ WHOOP_WEBHOOK_SECRET: 'hook-secret' }));
    // подпись клиентским секретом не подойдёт
    expect(() =>
      guard.canActivate(
        ctx(body, { 'x-whoop-signature': sign(ts, body), 'x-whoop-signature-timestamp': ts }),
      ),
    ).toThrow();
    // подпись webhook-секретом — проходит
    const c = ctx(body, {
      'x-whoop-signature': sign(ts, body, 'hook-secret'),
      'x-whoop-signature-timestamp': ts,
    });
    expect(guard.canActivate(c)).toBe(true);
  });
});
