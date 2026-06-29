import { ConfigService } from '@nestjs/config';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { WhoopAuthUrlService } from './whoop-auth-url.service';
import { WHOOP_AUTH_URL } from '../whoop.constants';

function makeConfig(): ConfigService {
  const vals: Record<string, string> = {
    WHOOP_CLIENT_ID: 'cid',
    WHOOP_REDIRECT_URI: 'https://app/cb',
  };
  return {
    get: (k: string, d?: string) => vals[k] ?? d,
    getOrThrow: (k: string) => {
      if (!vals[k]) throw new Error(`missing ${k}`);
      return vals[k];
    },
  } as unknown as ConfigService;
}

describe('WhoopAuthUrlService', () => {
  it('buildAuthorizeUrl собирает URL с обязательными параметрами', () => {
    const store = new OAuthStateStore();
    const svc = new WhoopAuthUrlService(makeConfig(), store);
    const { url } = svc.buildAuthorizeUrl();
    expect(url).toContain(`${WHOOP_AUTH_URL}?`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb');
    expect(url).toContain('scope=offline');
    expect(url).toMatch(/state=[^&]+/);
  });
});
