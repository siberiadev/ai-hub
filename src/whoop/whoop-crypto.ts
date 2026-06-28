import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

/**
 * Шифрование OAuth-токенов WHOOP для хранения в БД (AES-256-GCM, node:crypto).
 * Формат blob: base64( iv(12) || authTag(16) || ciphertext ). Ключ — из WHOOP_TOKEN_ENC_KEY
 * (base64, ровно 32 байта). Подмена шифротекста ловится authTag при расшифровке.
 */

const IV_LEN = 12; // рекомендованная длина nonce для GCM
const TAG_LEN = 16;

/** Загружает и валидирует 32-байтный ключ из env. Бросает при отсутствии/неверной длине. */
export function loadKey(): Buffer {
  const raw = process.env.WHOOP_TOKEN_ENC_KEY?.trim();
  if (!raw) {
    throw new Error(
      'WHOOP_TOKEN_ENC_KEY не задан — нечем шифровать токены WHOOP (нужно 32 байта base64).',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `WHOOP_TOKEN_ENC_KEY должен быть 32 байта (base64), получено ${key.length}. ` +
        'Сгенерируйте: openssl rand -base64 32',
    );
  }
  return key;
}

/** Шифрует строку → base64 blob (iv||tag||ciphertext). */
export function encrypt(plaintext: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Расшифровывает base64 blob → строку. Бросает, если ключ/данные неверны (GCM authTag). */
export function decrypt(blob: string, key: Buffer = loadKey()): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Повреждённый зашифрованный токен WHOOP (слишком короткий).');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
