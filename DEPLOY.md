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

## Заметки

- **Авторизация без токена.** Сервис работает под тем же пользователем, что делал `claude /login` —
  поэтому `CLAUDE_CODE_OAUTH_TOKEN` в `.env` не нужен (он опционален, для контейнеров/CI).
- **Биллинг.** В юните `ANTHROPIC_API_KEY` принудительно пуст — расход идёт по подписке. В первые дни
  сверь дашборды claude.ai / platform.claude.com.
- **Голос на 1 ГБ не ставить** — сборка whisper и модель medium требуют памяти; сначала resize.
