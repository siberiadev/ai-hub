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

## Заметки

- **Авторизация без токена.** Сервис работает под тем же пользователем, что делал `claude /login` —
  поэтому `CLAUDE_CODE_OAUTH_TOKEN` в `.env` не нужен (он опционален, для контейнеров/CI).
- **Биллинг.** В юните `ANTHROPIC_API_KEY` принудительно пуст — расход идёт по подписке. В первые дни
  сверь дашборды claude.ai / platform.claude.com.
- **Голос на 1 ГБ не ставить** — сборка whisper и модель medium требуют памяти; сначала resize.
- **Кодовые задачи и таймаут.** `CLAUDE_TIMEOUT_MS` (дефолт 600000 = 10 мин) ограничивает один ход;
  для долгих агентных правок увеличь. При срабатывании сессия убивается, следующий ход поднимет её заново.
- **Правки своего кода на сервере** применяются только после пересборки: `npm run build && sudo systemctl restart ai-hub`.
