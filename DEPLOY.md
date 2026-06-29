# Деплой ai-hub на дроплет (одной командой)

Цель: поднять бота на Ubuntu/Debian-дроплете (DigitalOcean) с минимумом ручных шагов.

## TL;DR

```bash
# на дроплете, под обычным пользователем (НЕ root):
curl -fsSL https://raw.githubusercontent.com/siberiadev/ai-hub/main/scripts/bootstrap.sh | bash
# с голосовыми (whisper) — нужен дроплет ≥ 4 ГБ:
curl -fsSL https://raw.githubusercontent.com/siberiadev/ai-hub/main/scripts/bootstrap.sh | bash -s -- --with-voice
```

Скрипт сам: поставит Node/git/ffmpeg, claude CLI, (опц.) соберёт whisper.cpp, соберёт проект,
**спросит переменные `.env` по ходу** (вставляешь значение → Enter), предложит авторизацию и
поднимет systemd-демон.

## Что нужно подготовить заранее (вручную)

1. **Бот в Telegram:** создать у [@BotFather](https://t.me/BotFather) (`/newbot`) → получить токен.
2. **Дроплет:** для голосовых — resize до **≥ 4 ГБ / 2 vCPU** (whisper + claude в памяти).
3. SSH-доступ под обычным пользователем с правами `sudo`.

## Шаги

1. **Запустить bootstrap** (команда из TL;DR). Репозиторий склонируется в `~/ai-hub`.
2. **Ответить мастеру `.env`** (скрипт спросит сам):
   - `TELEGRAM_BOT_TOKEN` — токен от BotFather (обязательно);
   - `TELEGRAM_ALLOWED_USER_IDS` — твой Telegram id; **можно оставить пустым** и узнать позже;
   - `CLAUDE_PERMISSION_MODE` — Enter (дефолт `bypassPermissions`);
   - `CLAUDE_WORKSPACE` — Enter (дефолт `~/ai-hub/workspace`).
   - **WHOOP-интеграция** — отдельный вопрос «Настроить WHOOP? [y/N]» (опционально). При `y` спросит
     `DATABASE_URL` (managed Postgres), `WHOOP_CLIENT_ID/SECRET`, `WHOOP_REDIRECT_URI` и **сам
     сгенерирует** `WHOOP_TOKEN_ENC_KEY` и `WHOOP_CONNECT_SECRET`. Пропустишь (`N`) — WHOOP просто
     выключен, бот работает как обычно. Настроить позже: `bash scripts/install.sh --reconfigure`.
     Не забудь зарегистрировать `WHOOP_REDIRECT_URI` и webhook-URL в WHOOP Dashboard (см. ниже про туннель).
3. **Авторизовать Claude** (один раз, под тем же пользователем):
   ```bash
   claude        # затем /login → открыть ссылку в браузере на ноуте → вставить код
   claude        # /status — проверить, что вошёл по подписке (не API)
   ```
   Скрипт может предложить запустить это сам.
4. **Узнать свой Telegram id** (если оставил allowlist пустым): напиши боту любое сообщение — он
   ответит отказом с твоим id. Затем добавь его:
   ```bash
   cd ~/ai-hub && bash scripts/install.sh --reconfigure
   ```
   (мастер подставит прежние значения как дефолты — меняешь только нужное).

## Управление сервисом

```bash
systemctl status ai-hub          # статус
journalctl -u ai-hub -f          # живые логи
sudo systemctl restart ai-hub    # перезапуск
sudo systemctl stop ai-hub       # остановить
```

Демон уже на автозапуске (поднимается после ребута) и сам перезапускается при падении.

## Обновление

```bash
curl -fsSL https://raw.githubusercontent.com/siberiadev/ai-hub/main/scripts/bootstrap.sh | bash
# (= git pull + пересборка + рестарт; .env и авторизация сохраняются)
```

## ⚠️ Security / модель угроз — прочитай

Этот бот по сути даёт **доступ к серверу через чат**. Отнесись соответственно:

- **`bypassPermissions` = удалённое выполнение команд.** В этом режиме Claude выполняет любые команды
  и правит файлы **без подтверждения**. Любой, кто в `TELEGRAM_ALLOWED_USER_IDS` (или кто угнал токен
  бота / этот Telegram-аккаунт), получает фактически шелл на сервере под пользователем сервиса. Радиус
  поражения: чтение `.env`, кража OAuth-кредов Claude из `~/.claude/`, запуск чего угодно. Безопаснее —
  `default`/`acceptEdits` (но тогда Claude не сможет сам пользоваться инструментами в headless).
- **Минимизируй allowlist.** Только свои id в `TELEGRAM_ALLOWED_USER_IDS`. Это твой главный периметр.
- **Токен — секрет.** Утёк/засветился (в логах, истории) → немедленно `/revoke` у @BotFather и
  `bash scripts/install.sh --reconfigure`. `.env` держится `chmod 600` (скрипт ставит сам).
- **Изолируй.** Ставь на отдельный дроплет, где нет других важных данных/проектов.
- **Сеть.** Приложение слушает только `127.0.0.1` (бот на long polling, входящий порт не нужен).
  Дополнительно включи firewall: `sudo ufw allow OpenSSH && sudo ufw enable`.
- **Хардени хост:** применяй security-апдейты (`sudo apt upgrade`, включи `unattended-upgrades`),
  отключи вход root по SSH и используй ключи вместо паролей, поставь `fail2ban`.
- **Зависимости:** иногда проверяй `npm audit` и обновляйся.

## Публичный доступ для WHOOP (Cloudflare Tunnel)

Нужен только для интеграции WHOOP (приём вебхуков + OAuth-callback). WHOOP шлёт вебхуки на публичный
HTTPS-URL, а приложение слушает только `127.0.0.1`. Открываем доступ **без** проброса входящих портов —
через исходящий туннель Cloudflare. Наружу при этом доступен **только путь `/whoop/*`**.

> Требуется домен, добавленный в Cloudflare (бесплатный план подходит).

```bash
# 1. Установить cloudflared (Debian/Ubuntu, репозиторий Cloudflare)
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | \
  sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | \
  sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

# 2. Авторизовать домен (откроется ссылка — выбрать зону в браузере)
cloudflared tunnel login

# 3. Создать именованный туннель (получишь UUID и creds-файл в ~/.cloudflared/<UUID>.json)
cloudflared tunnel create ai-hub
```

Конфиг `~/.cloudflared/config.yml` (подставь `<UUID>` и свой `<host>`, напр. `whoop.example.com`):

```yaml
tunnel: <UUID>
credentials-file: /home/<user>/.cloudflared/<UUID>.json
ingress:
  - hostname: <host>
    path: /whoop/.*          # наружу пускаем только маршрут WHOOP
    service: http://127.0.0.1:3000
  - service: http_status:404 # всё остальное — 404 (обязательное завершающее правило)
```

```bash
# 4. DNS-запись на туннель
cloudflared tunnel route dns ai-hub <host>

# 5. Поднять как systemd-сервис (автозапуск + рестарт при падении)
sudo cloudflared service install
systemctl status cloudflared

# 6. Смоук-тест (через Cloudflare на 127.0.0.1:3000 → пока отдаёт корневой роут)
curl -i https://<host>/whoop/   # маршрут есть; конкретные эндпоинты появятся в фазах WHOOP
```

После этого пропиши `WHOOP_REDIRECT_URI=https://<host>/whoop/oauth/callback` в `.env` и зарегистрируй
в WHOOP Developer Dashboard этот redirect-URL и webhook-URL `https://<host>/whoop/webhook`.

**Периметр не меняется:** ufw остаётся `OpenSSH only`, приложение слушает `127.0.0.1`, входящие порты
не открыты — туннель работает на исходящем соединении.

## Доступ Claude к данным WHOOP (MCP `whoop`)

Чтобы Claude в боте мог читать данные WHOOP, поднимаем MCP-сервер `whoop`. Сервер — отдельный
stdio-процесс, claude запускает его сам. Тулы:
- `read` — **только чтение** из Postgres (тренировки/сон/восстановление/циклы/сводка/тренды).
- `backfill` — запускает историческую загрузку из WHOOP API. Сам MCP остаётся read-only: тула шлёт
  `POST /whoop/admin/backfill` на **основное приложение** (там есть токены и write-БД), которое грузит
  данные в фоне. Эндпоинт защищён `?key=<WHOOP_CONNECT_SECRET>` (неверный ключ → 404).

1. **Read-only роль в Postgres** (минимум прав для MCP):
   ```sql
   CREATE ROLE whoop_ro LOGIN PASSWORD '...';
   GRANT CONNECT ON DATABASE defaultdb TO whoop_ro;
   GRANT USAGE ON SCHEMA public TO whoop_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO whoop_ro;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO whoop_ro;
   ```
2. **Конфиг MCP**: скопировать `.mcp.json.example` → `~/ai-hub/.mcp.json`, подставить абсолютный путь к
   `dist/whoop/mcp/whoop-mcp.server.js` и строку read-only роли в `WHOOP_MCP_DATABASE_URL`. Для тулы
   `backfill` задать `WHOOP_APP_URL` (адрес приложения, по умолчанию `http://127.0.0.1:3000`) и
   `WHOOP_ADMIN_SECRET` (= значение `WHOOP_CONNECT_SECRET` из `.env`).
3. **Подключить к claude** (headless — детерминированно): в `.env`
   ```
   CLAUDE_STRICT_MCP=true
   CLAUDE_MCP_CONFIG=/home/<user>/ai-hub/.mcp.json
   ```
   Грузится ровно этот набор MCP (другие свои серверы добавь в тот же файл). Пересобрать и
   перезапустить: `npm run build && sudo systemctl restart ai-hub`.
4. Проверка: спросить бота «покажи мои последние тренировки WHOOP» — Claude вызовет `mcp__whoop__read`.
   (Данные появятся после OAuth-подключения и бэкфилла.) Бэкфилл можно запустить из бота («запусти
   backfill WHOOP» → `mcp__whoop__backfill`) или с сервера `npm run whoop:backfill`.

## Планировщик задач (MCP `scheduler`)

Чтобы Claude мог сам ставить повторяющиеся и разовые задачи (ежедневные саммари, напоминания),
поднимаем MCP-сервер `scheduler`. Тикер в приложении (`SchedulerService`) раз в `SCHEDULER_TICK_SEC`
секунд забирает из таблицы `scheduled_task` задачи, у которых наступил `next_run_at`, и прогоняет
их промпт через Claude (в свежей сессии), доставляя результат владельцу в Telegram. Тулы:
- `schedule_create` — создать задачу: ПОВТОРЯЮЩУЮСЯ (`cron` + опц. `endAt`/`maxRuns`) или РАЗОВУЮ
  (`runAt` — ISO дата-время; после срабатывания `status=completed`).
- `schedule_list` / `schedule_update` / `schedule_delete` — управление задачами.

Сам MCP read/write не трогает БД напрямую — тулы шлют HTTP на `/scheduler/tasks` основного
приложения (там валидация cron и расчёт расписания), эндпоинт защищён `?key=<SCHEDULER_ADMIN_SECRET>`
(неверный ключ → 404).

1. **Секрет**: задать `SCHEDULER_ADMIN_SECRET` в `.env` приложения (`openssl rand -hex 16`).
2. **Конфиг MCP**: в `~/ai-hub/.mcp.json` добавить сервер `scheduler` (см. `.mcp.json.example`):
   абсолютный путь к `dist/scheduler/mcp/scheduler-mcp.server.js`, `SCHEDULER_APP_URL`
   (по умолчанию `http://127.0.0.1:3000`) и `SCHEDULER_ADMIN_SECRET` (= значение из `.env`).
3. Пересобрать и перезапустить: `npm run build && sudo systemctl restart ai-hub`.
4. Проверка: попросить бота «настрой ежедневное саммари сна в 8 утра» или «напомни в пятницу
   отправить платёж» — Claude вызовет `mcp__scheduler__schedule_create`; «покажи мои задачи» →
   `mcp__scheduler__schedule_list`.

## Заметки

- **Авторизация без токена.** Сервис работает под тем же пользователем, что делал `claude /login` —
  поэтому `CLAUDE_CODE_OAUTH_TOKEN` в `.env` не нужен (он опционален, для контейнеров/CI).
- **Биллинг.** В юните `ANTHROPIC_API_KEY` принудительно пуст — расход идёт по подписке. В первые дни
  сверь дашборды claude.ai / platform.claude.com.
- **Голос на 1 ГБ не ставить** — сборка whisper и модель medium требуют памяти; сначала resize.
- **Кодовые задачи и таймаут.** `CLAUDE_TIMEOUT_MS` (дефолт 600000 = 10 мин) ограничивает один ход;
  для долгих агентных правок увеличь. При срабатывании сессия убивается, следующий ход поднимет её заново.
- **Правки своего кода на сервере** применяются только после пересборки: `npm run build && sudo systemctl restart ai-hub`.
- **Бэкап (WHOOP).** Данные WHOOP — в managed-Postgres: включи авто-бэкапы/PITR в панели провайдера
  (у DigitalOcean — Settings → Backups). Sessions-БД `data/ai-hub.db` входит в бэкап хоста. Проверь
  пайплайн: `npm run whoop:status` (счётчики `failed`/`pending`, наполнение таблиц), вернуть зависшие —
  `npm run whoop:requeue`.
