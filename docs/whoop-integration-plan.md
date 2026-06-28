# WHOOP → БД → Claude (MCP): план интеграции

> Цель: подключить персональный WHOOP к проекту `ai-hub`. По вебхукам получать новые
> активности (workout / sleep / recovery / cycle), писать их в БД через наш NestJS-сервис,
> а затем дать Claude доступ к этим данным через собственный MCP-сервер с тулзой `whoop:read`
> (в будущем — больше тулзов).

Документ — **верхнеуровневая карта работ**, разбитая на фазы. Каждую фазу можно отдать в детальную
проработку отдельно. Внутри фаз: цель → результат → ключевые решения → файлы → критерии готовности.

---

## 0. Контекст текущего проекта (что уже есть)

- **Стек:** NestJS 11, grammY (Telegram, long-polling), `better-sqlite3` (напрямую, без ORM),
  Claude CLI как подпроцесс. STT через whisper.cpp.
- **БД сейчас:** `SessionService` сам делает `CREATE TABLE` через `better-sqlite3`
  (`data/ai-hub.db`, WAL). TypeORM **отсутствует**.
- **Сеть:** `main.ts` биндит HTTP на `127.0.0.1` — наружу порт не торчит (бот работает на
  исходящих long-poll соединениях). **Публичного ингресса нет.**
- **MCP:** Claude CLI уже умеет грузить MCP-серверы (`CLAUDE_MCP_CONFIG`, `CLAUDE_STRICT_MCP`).

**Сквозные решения зафиксированы в Фазе 0** (см. [adr/0001-whoop-infra.md](adr/0001-whoop-infra.md)):
- **(A) БД WHOOP — внешний managed Postgres** (`DATABASE_URL` + SSL, драйвер `pg`); sessions-БД
  остаётся на локальном SQLite и не трогается.
- **(B) Публичный ингресс — Cloudflare Tunnel** (`cloudflared`), наружу доступен только `/whoop/*`,
  входящие порты не открываются.

---

## 🛠 Пред-условие: что настроить на стороне WHOOP (Developer Dashboard)

Это делается **руками в дашборде** до/во время реализации — без этого ни данные, ни вебхуки не пойдут.
Источник истины: <https://developer.whoop.com/docs/developing/getting-started>.

**Чек-лист в WHOOP Developer Dashboard:**

1. **Создать аккаунт разработчика и приложение (App).** Заполнить обязательные поля приложения
   (название, контакты, privacy policy URL и т.п.).
2. **Запросить нужные scopes** для приложения — это и есть «доступ к моделям данных», который вы
   мне даёте:
   - `offline` — обязательно, иначе не выдадут refresh-токен;
   - `read:profile` — профиль пользователя;
   - `read:body_measurement` — рост/вес/max HR;
   - `read:cycles` — физиологические циклы (день по Whoop, strain);
   - `read:recovery` — восстановление (recovery %, HRV, RHR);
   - `read:sleep` — сон и его стадии;
   - `read:workout` — тренировки/активности.
3. **Зарегистрировать Redirect URL (Callback).** Должен **точно** совпадать с `WHOOP_REDIRECT_URI`
   в `.env`. Форма — HTTPS (`https://<host>/whoop/oauth/callback`) или кастомная схема. Для локалки
   без публичного HTTPS — использовать туннель (`cloudflared`) и его URL как redirect.
4. **Зарегистрировать Webhook URL** — публичный `https://<host>/whoop/webhook`. WHOOP шлёт на него
   **все** типы событий (`workout/sleep/recovery` · `updated/deleted`). Один URL на приложение.
5. **Скопировать `Client ID` и `Client Secret`** → в `.env` (`WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`).
   ⚠️ `Client Secret` используется **дважды**: для обмена токенов *и* как секрет HMAC-подписи вебхуков.
6. **После деплоя — один раз пройти OAuth** (открыть `/whoop/oauth/start`, авторизовать свой
   аккаунт WHOOP) → токены лягут в БД. Это и есть момент, когда вы «даёте доступ к своим данным».

**Точные эндпоинты WHOOP (зашить в конфиг):**

| Назначение | URL |
|---|---|
| Authorization (получить `code`) | `https://api.prod.whoop.com/oauth/oauth2/auth` |
| Token / Refresh (обмен `code`/refresh → токены) | `https://api.prod.whoop.com/oauth/oauth2/token` |
| Data API v2 (база) | `https://api.prod.whoop.com/developer` (далее `/v2/...`) |
| Revoke доступа | `revokeUserOAuthAccess` (см. API Reference) |

**Нюансы OAuth, которые легко упустить:**
- `state` обязателен (CSRF) и должен быть **минимум 8 символов** — генерируем и проверяем сами.
- **Refresh-токен ротируется:** каждый успешный refresh возвращает **новый** `access_token` **и
  новый** `refresh_token`, а старые сразу инвалидируются. → всегда сохранять оба из ответа.
- Параллельные refresh опасны: выиграет первый запрос, второй упадёт (старый refresh уже сожжён).
  → обновлять токен в одном месте (фоновый job + мьютекс), а не на каждом API-вызове.
- При отключении интеграции пользователем — вызвать `revokeUserOAuthAccess` (после revoke вебхуки
  по этому юзеру перестают приходить).

---

## ⚠️ Что легко забыть (важное — прочти до старта)

1. **Вебхук не содержит данных.** WHOOP присылает только `{ user_id, id, type, trace_id }`.
   Сами данные надо **дотягивать REST-вызовом** к API v2 по `id`. → значит, нужен рабочий
   OAuth-токен ещё до того, как вебхуки станут полезны.
2. **Нужен публичный HTTPS-URL.** Решено: **Cloudflare Tunnel** (`cloudflared`) — исходящий туннель,
   входящие порты не открываем, наружу светится только `/whoop/*`; остальное приложение остаётся на
   `127.0.0.1`. Настройка — в [DEPLOY.md](../DEPLOY.md).
3. **OAuth + refresh-токены.** Access-токен живёт ~1 час. Нужен `offline`-скоуп → refresh-токен,
   фоновое обновление, шифрование токенов в БД.
4. **Проверка подписи вебхука** (HMAC-SHA256, см. ниже). Без неё эндпоинт открыт для подделок.
5. **Идемпотентность / дедуп.** Вебхуки могут прийти повторно и не по порядку. Дедуп по
   `trace_id`, апсерт ресурса по `(type, whoop_id)` с учётом `updated_at`.
6. **Историческая загрузка (backfill).** Вебхуки дают только новое «вперёд». Прошлые данные
   нужно один раз вытянуть пагинацией через API (`/v2/activity/*`, `/v2/cycle`, `/v2/recovery`).
7. **`cycle` не шлёт вебхуков** — только `workout/sleep/recovery`. Циклы (день по Whoop) и
   профиль/замеры тела синкаем по расписанию (cron) или при обращении.
8. **Rate limits WHOOP** (уточнить актуальные в дашборде; исторически ~100 req/min). Нужен
   троттлинг + ретраи с backoff на API-клиенте.
9. **Быстрый ответ вебхуку.** Отвечать `200` сразу, тяжёлую работу (поход в API + запись) делать
   асинхронно (очередь/буфер), иначе WHOOP будет ретраить по таймауту.
10. **Регистрация webhook-URL** делается в WHOOP Developer Dashboard на уровне приложения (один
    URL на app), не per-user. Секрет подписи = client secret приложения.
11. **Маппинг `user_id` → аккаунт/токен.** Даже если пользователь один (владелец), завязывай
    запись на `whoop_user_id`, чтобы потом не переделывать.
12. **MCP отдаёт данные read-only.** MCP-процесс подключается к Postgres **отдельной read-only
    ролью** (`WHOOP_MCP_DATABASE_URL`, `GRANT SELECT`) — Claude физически не может писать в БД.
13. **Часовые пояса.** WHOOP отдаёт время в UTC + `timezone_offset`. Хранить UTC, оффсет — рядом.
14. **Секреты.** `WHOOP_CLIENT_ID/SECRET`, webhook-secret, ключ шифрования токенов — в `.env`,
    добавить в `.env.example`, не коммитить `.env`.
15. **API только v2.** v1 объявлен deprecated; идентификаторы — UUID-строки.

---

## Карта фаз (зависимости)

```
Фаза 1 (TypeORM)  ─┬─► Фаза 2 (сущности+миграции) ─┬─► Фаза 3 (OAuth) ─► Фаза 5 (API-клиент+синк)
                   │                                │                         ▲
Фаза 0 (решения) ──┘                                └─► Фаза 4 (webhook-приём) ┘
                                                                              │
                                                          Фаза 6 (MCP whoop:read) ◄─ читает БД
                                                                              │
                                                          Фаза 7 (hardening) · Фаза 8 (future)
```

Минимальный сквозной MVP «данные дошли до Claude»: **1 → 2 → 3 → 4 → 5 → 6**.
Фаза 0 — подготовительные решения, можно совместить с Фазой 1.

---

## Фаза 0 — Решения и подготовка инфраструктуры ✅ (решено)

**Цель:** снять архитектурные развилки до кода. Решения зафиксированы в
[adr/0001-whoop-infra.md](adr/0001-whoop-infra.md):

- **БД WHOOP (A):** внешний managed **Postgres** (`DATABASE_URL` + SSL, драйвер `pg`).
  Sessions-БД (`SessionService`, SQLite) не трогаем — две независимые подсистемы.
- **Публичный ингресс (B):** **Cloudflare Tunnel** — наружу только `/whoop/*`, входящие порты не
  открываем, листен приложения остаётся `127.0.0.1`. Настройка — в [DEPLOY.md](../DEPLOY.md).
- **MCP-процесс:** отдельный stdio-энтрипоинт, подключение к Postgres **read-only** ролью
  (`WHOOP_MCP_DATABASE_URL`).
- **Шифрование токенов:** AES-256-GCM, ключ `WHOOP_TOKEN_ENC_KEY` (32 байта), на `node:crypto`.

**Сделано в Фазе 0:** ADR + обновлён этот план + блок переменных в `.env.example` + раздел Cloudflare
Tunnel в `DEPLOY.md`. Инфра-шаги (поднять `cloudflared`, выдать managed Postgres + read-only роль,
сгенерировать enc-key) — выполняются на дроплете/у провайдера по инструкции из `DEPLOY.md`.

**Критерий готовности:** `curl https://<host>/whoop/` идёт через туннель на `127.0.0.1:3000` и отвечает;
`psql "$DATABASE_URL" -c 'select 1'` подключается по SSL; ufw остаётся `OpenSSH only`.

---

## Фаза 1 — Установка и базовая настройка TypeORM

**Цель:** ввести TypeORM + инфраструктуру миграций (внешний Postgres), не трогая существующий
`SessionService` (он остаётся на SQLite).

**Сделать:**
- Зависимости: `@nestjs/typeorm typeorm pg`.
- `src/database/data-source.ts` — `DataSource` для CLI-миграций (отдельно от рантайма Nest),
  читает `DATABASE_URL` + `DATABASE_SSL`.
- `TypeOrmModule.forRootAsync` через `ConfigService`: `type: 'postgres'`, `url: DATABASE_URL`,
  `ssl` (managed-провайдеры обычно `{ rejectUnauthorized: false }` или явный CA),
  `autoLoadEntities: true`, `synchronize: false`, `migrationsRun: true` (или ручной прогон).
- npm-скрипты: `migration:generate`, `migration:run`, `migration:revert`, `typeorm`.
- Папка `src/database/migrations/`.

**Файлы:**
```
src/database/data-source.ts
src/database/database.module.ts        (опц. обёртка)
src/database/migrations/
package.json                            (+ scripts)
```

**Решения:** `synchronize` всегда `false` (только миграции); naming strategy snake_case, чтобы
совпадало со стилем существующих таблиц.

**Критерий готовности:** `npm run migration:run` отрабатывает на пустой Postgres-схеме; приложение
поднимается и держит подключение по SSL; `SessionService` продолжает работать со своим SQLite.

---

## Фаза 2 — Доменная модель: сущности WHOOP + миграции

**Цель:** описать сущности и сгенерировать первую миграцию.

**Сущности (черновой список):**
- `whoop_account` — `whoop_user_id` (PK/uniq), access/refresh-токены (зашифрованы), `expires_at`,
  `scopes`, `connected_at`. Маппинг user → токен.
- `whoop_workout` — `id` (UUID от Whoop, PK), `whoop_user_id`, `start/end`, `sport_id`,
  `strain`, `avg_hr`, `max_hr`, `kilojoules`, `score_state`, `updated_at`, `raw` (JSON).
- `whoop_sleep` — `id`, длительности/стадии, `respiratory_rate`, `sleep_performance`,
  `score_state`, `updated_at`, `raw`.
- `whoop_recovery` — ключ по `cycle_id`/`sleep_id`, `recovery_score`, `hrv_rmssd`, `resting_hr`,
  `spo2`, `skin_temp`, `score_state`, `updated_at`, `raw`.
- `whoop_cycle` — `id`, `start/end`, `strain`, `avg_hr`, `kilojoules`, `updated_at`, `raw`.
- `whoop_webhook_event` — журнал сырых вебхуков: `trace_id` (uniq, дедуп), `type`, `whoop_user_id`,
  `resource_id`, `received_at`, `status` (pending/processed/failed), `error`, `attempts`.
  Служит и аудитом, и идемпотентностью, и очередью.
- (опц.) `whoop_profile`, `whoop_body_measurement`.

**Соглашения (Postgres):** хранить и нормализованные поля (для запросов/MCP), и `raw` как `jsonb`
(на будущее, без потери данных). Время — `timestamptz` (UTC) + `timezone_offset` рядом. `score_state`
важен: WHOOP может прислать `SCORE_STATE=PENDING_SCORE`, данные дозреют позже → апсерт перезапишет.

**Файлы:**
```
src/whoop/entities/*.entity.ts
src/database/migrations/<timestamp>-WhoopInit.ts
```

**Критерий готовности:** миграция применяется/откатывается; сущности грузятся в Nest.

---

## Фаза 3 — OAuth-подключение WHOOP (авторизация + токены)

**Цель:** получить и поддерживать живой access-токен (это предпосылка для Фазы 5).

**Сделать:**
- Authorization Code Flow:
  - `GET /whoop/oauth/start` → редирект на `https://api.prod.whoop.com/oauth/oauth2/auth` с
    `client_id`, `redirect_uri`, `response_type=code`, `scope=offline read:profile read:body_measurement
    read:cycles read:recovery read:sleep read:workout`, `state` (≥8 символов, сохранить для сверки).
  - `GET /whoop/oauth/callback` → сверка `state`, обмен `code` на токены через POST
    `https://api.prod.whoop.com/oauth/oauth2/token` (`grant_type=authorization_code`), запись в
    `whoop_account` (токены зашифрованы, `expires_at = now + expires_in`).
- `WhoopTokenService`: хранение/шифрование, авто-refresh по `expires_at` (с запасом ~5 мин), отдача
  валидного токена API-клиенту. Refresh: POST на тот же token-URL, `grant_type=refresh_token`,
  `scope=offline`.
- **Ротация refresh-токена:** ответ refresh содержит **новые** `access_token` и `refresh_token` —
  атомарно перезаписать оба; старые уже инвалидированы.
- **Один писатель токена:** фоновый cron + мьютекс/блокировка, чтобы исключить параллельные refresh
  (второй сожжёт уже использованный refresh и упадёт).
- (опц.) `revokeUserOAuthAccess` при отключении интеграции.

**Файлы:**
```
src/whoop/oauth/whoop-oauth.controller.ts
src/whoop/oauth/whoop-oauth.service.ts
src/whoop/oauth/whoop-token.service.ts
```

**Решения:** колбэк можно прокинуть через тот же публичный прокси, что и вебхук, **или** авторизоваться
один раз локально (туннель/`localhost` в Whoop-app для dev). Для одного пользователя — разовая
ручная авторизация ок.

**Env:** `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `WHOOP_TOKEN_ENC_KEY`.

**Критерий готовности:** после `/whoop/oauth/start` в БД лежит валидный токен; refresh обновляет
его без повторного логина.

---

## Фаза 4 — Приём вебхуков (HTTP-эндпоинт + подпись + дедуп)

**Цель:** надёжно принять уведомление и быстро вернуть 200.

**Сделать:**
- `POST /whoop/webhook` — принимает **сырое тело** (нужен raw body для HMAC; настроить
  `rawBody` в Nest/Express до JSON-парсинга).
- `WhoopSignatureGuard`: считает `base64(HMAC_SHA256(timestampHeader + rawBody, CLIENT_SECRET))`,
  сравнивает с `X-WHOOP-Signature` (constant-time), проверяет свежесть `X-WHOOP-Signature-Timestamp`
  (анти-replay, окно напр. 5 мин).
- Запись события в `whoop_webhook_event` (дедуп по `trace_id`), статус `pending`, мгновенный `200`.
- Передача обработки в Фазу 5 (вызов воркера / эмит события), **не блокируя** ответ.
- Наружу роут уже открыт Cloudflare Tunnel'ом (`/whoop/*` → `127.0.0.1:3000`, Фаза 0) — отдельный
  публичный listener не нужен, листен приложения остаётся `127.0.0.1`.

**Файлы:**
```
src/whoop/webhook/whoop-webhook.controller.ts
src/whoop/webhook/whoop-signature.guard.ts
src/whoop/webhook/whoop-webhook.service.ts
main.ts (включить rawBody для проверки HMAC)
```

**Критерий готовности:** валидная подпись → 200 + запись `pending`; невалидная → 401; повтор
`trace_id` → не дублируется. Юнит-тест на guard с зафиксированным секретом.

---

## Фаза 5 — WHOOP API-клиент + воркер синхронизации

**Цель:** превратить уведомление в актуальные данные в БД.

**Сделать:**
- `WhoopApiClient`: базовый URL v2, авто-`Authorization: Bearer` от `WhoopTokenService`, ретраи с
  backoff, троттлинг, обработка 401 (refresh+повтор) и 429 (respect Retry-After).
  Методы: `getWorkout(id)`, `getSleep(id)`, `getRecovery(...)`, `getCycle(id)`, пагинация для
  backfill, `getProfile`, `getBodyMeasurement`.
- `WhoopSyncService`: разбор `whoop_webhook_event` (pending) → fetch по `type/id` → **upsert** в
  нужную таблицу (учёт `updated_at`/`score_state`) → пометить `processed`/`failed` (+attempts).
  Обрабатывать `*.deleted` (мягкое удаление/флаг).
- **Backfill-команда**: разовая историческая загрузка пагинацией (CLI-скрипт или защищённый
  эндпоинт). Идемпотентна.
- (опц.) Cron для `cycle`/profile/body (нет вебхуков) и для «дозревания» PENDING-записей.

**Файлы:**
```
src/whoop/api/whoop-api.client.ts
src/whoop/sync/whoop-sync.service.ts
src/whoop/sync/whoop-backfill.command.ts   (или scripts/whoop-backfill.ts)
```

**Критерий готовности:** тестовый вебхук (или ручной триггер) → соответствующая запись появилась/
обновилась в `whoop_*`; backfill наполняет историю; ретраи работают.

---

## Фаза 6 — MCP-сервер `whoop` с тулзой `read`

**Цель:** дать Claude доступ к данным WHOOP из БД.

**Сделать:**
- Отдельный stdio-энтрипоинт на `@modelcontextprotocol/sdk`: сервер с именем **`whoop`**,
  тула **`read`** → Claude видит её как `mcp__whoop__read` (в проекте/доке зовём `whoop:read`).
- Тула `read` (read-only): параметры вида `{ type: 'workout'|'sleep'|'recovery'|'cycle'|'summary',
  from?, to?, limit? }`. Подключается к Postgres **read-only ролью** (`WHOOP_MCP_DATABASE_URL`),
  отдаёт нормализованный JSON. Никаких записей (роль с `GRANT SELECT`).
- Чёткое описание тулы и схема входа (Zod/JSON-schema) — чтобы Claude корректно её вызывал.
- Регистрация в MCP-конфиге, который читает Claude CLI (`CLAUDE_MCP_CONFIG` / `.mcp.json`):
  команда запуска stdio-сервера + `WHOOP_MCP_DATABASE_URL` через env.
- Учесть `CLAUDE_STRICT_MCP`: при строгом наборе MCP добавить `whoop` в курируемый список.

**Файлы:**
```
src/mcp/whoop-mcp.server.ts          (stdio entrypoint)
src/mcp/tools/whoop-read.tool.ts
.mcp.json / пример для CLAUDE_MCP_CONFIG
package.json (скрипт запуска mcp-сервера)
```

**Критерий готовности:** в сессии Claude доступен `mcp__whoop__read`; запрос «покажи последние
тренировки» возвращает данные из БД. Запись через MCP невозможна (read-only роль Postgres).

---

## Фаза 7 — Hardening, наблюдаемость, тесты, документация

- **Тесты:** guard подписи, дедуп, upsert/score_state, refresh-токена, MCP-тула (контракт).
- **Наблюдаемость:** структурные логи на каждом шаге (received → fetched → upserted), счётчики
  ошибок, алерт при росте `failed` в `whoop_webhook_event`.
- **Обработка отказов:** повторная обработка `failed`/`pending`, dead-letter после N попыток.
- **Безопасность:** проверка `state` в OAuth, constant-time сравнение подписи, минимизация прав
  публичного роута, токены только зашифрованы, ключ шифрования вне репозитория.
- **Документация:** обновить `README.md`/`DEPLOY.md` — переменные окружения, регистрация webhook-URL
  и redirect-URI в WHOOP Dashboard, настройка Cloudflare Tunnel, запуск миграций и backfill.
- **Бэкап БД:** WHOOP-данные в managed Postgres — проверить, что у провайдера включены авто-бэкапы
  (PITR/snapshots). Sessions-SQLite (`data/ai-hub.db`) — как раньше.

---

## Фаза 8 — Расширения (на будущее)

- Новые MCP-тулзы: агрегаты/тренды (`whoop:summary`), сравнение периодов, корреляции сон↔восстановление.
- Проактивные сценарии: утренний дайджест восстановления в Telegram (уже есть бот).
- Кэш/материализованные представления для быстрых ответов MCP.
- Поддержка нескольких пользователей (мультиаккаунт уже заложен через `whoop_user_id`).
- Экспорт/визуализация.

---

## Сводка новых переменных окружения

Финальный набор — в [.env.example](../.env.example) (блоки «WHOOP интеграция», «Внешняя БД»,
«Cloudflare Tunnel»). Кратко:

```
# WHOOP
WHOOP_CLIENT_ID=  WHOOP_CLIENT_SECRET=  WHOOP_REDIRECT_URI=  WHOOP_WEBHOOK_SECRET=
WHOOP_TOKEN_ENC_KEY=  WHOOP_AUTH_URL=  WHOOP_TOKEN_URL=  WHOOP_API_BASE=  WHOOP_SCOPES=
# Внешняя БД (Postgres)
DATABASE_URL=  DATABASE_SSL=true  WHOOP_MCP_DATABASE_URL=   # read-only роль для MCP
# Cloudflare Tunnel — hostname задаётся в ~/.cloudflared/config.yml, не в .env (см. DEPLOY.md)
```

---

## Открытые вопросы (подтвердить перед/во время реализации)

1. ✅ Ингресс — **Cloudflare Tunnel** (решено, Фаза 0).
2. ✅ БД WHOOP — **внешний Postgres** (`DATABASE_URL`+SSL); sessions остаются на SQLite (решено).
3. **Домен** для Cloudflare Tunnel — какой hostname (нужен домен, добавленный в Cloudflare).
4. **Провайдер Postgres** — Neon / Supabase / DO Managed PG / свой? (влияет на нюанс SSL).
5. OAuth-колбэк: разовая ручная авторизация локально или постоянный публичный redirect-URI?
6. Backfill: как глубоко тянуть историю (всё / последние N месяцев)?
7. Точные актуальные rate limits и base-URL v2 — сверить в WHOOP Developer Dashboard.
8. Имя тулы: `mcp__whoop__read` устраивает (в доке зовём `whoop:read`)?

---

### Источники
- [WHOOP Webhooks](https://developer.whoop.com/docs/developing/webhooks/)
- [WHOOP OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/)
- [WHOOP API v2 Reference](https://developer.whoop.com/api/)
- [v1 → v2 Migration](https://developer.whoop.com/docs/developing/v1-v2-migration/)
