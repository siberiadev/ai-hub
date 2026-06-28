/**
 * Общие настройки подключения к Postgres для рантайма (DatabaseModule) и CLI (data-source).
 * Держим в одном месте, чтобы SSL вёл себя одинаково в обоих путях.
 */

/**
 * DATABASE_URL без параметра `sslmode` (и `uselibpqcompat`). Режим SSL задаём явно через
 * объект {@link postgresSsl}, а не строкой подключения: свежий `pg` трактует `sslmode=require`
 * как `verify-full` и падает на self-signed цепочке managed-провайдеров (напр. DigitalOcean)
 * с `SELF_SIGNED_CERT_IN_CHAIN`.
 */
export function postgresUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('uselibpqcompat');
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * SSL-параметр для pg. `DATABASE_SSL=false` → без SSL (локальный Postgres).
 * Иначе SSL включён, но без верификации CA (`rejectUnauthorized:false`) — managed-провайдеры
 * обычно отдают self-signed цепочку. Ужесточение (пин CA) — отдельной настройкой позже.
 */
export function postgresSsl(): false | { rejectUnauthorized: boolean } {
  return (process.env.DATABASE_SSL ?? 'true') !== 'false'
    ? { rejectUnauthorized: false }
    : false;
}
