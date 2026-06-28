import { decrypt, encrypt, loadKey } from './whoop-crypto';

describe('whoop-crypto (AES-256-GCM)', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');

  beforeAll(() => {
    process.env.WHOOP_TOKEN_ENC_KEY = KEY;
  });

  it('шифрует и расшифровывает обратно', () => {
    const blob = encrypt('secret-access-token');
    expect(blob).not.toContain('secret-access-token');
    expect(decrypt(blob)).toBe('secret-access-token');
  });

  it('даёт разный шифротекст при каждом вызове (случайный IV)', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });

  it('ловит подмену шифротекста (authTag)', () => {
    const buf = Buffer.from(encrypt('hello'), 'base64');
    buf[buf.length - 1] ^= 0xff; // портим последний байт ciphertext
    expect(() => decrypt(buf.toString('base64'))).toThrow();
  });

  it('не расшифровывается чужим ключом', () => {
    const blob = encrypt('hello');
    expect(() => decrypt(blob, Buffer.alloc(32, 9))).toThrow();
  });

  it('loadKey отвергает ключ неверной длины', () => {
    process.env.WHOOP_TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadKey()).toThrow(/32/);
    process.env.WHOOP_TOKEN_ENC_KEY = KEY;
  });
});
