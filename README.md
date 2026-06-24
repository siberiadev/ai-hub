# ai-hub — мост Telegram ↔ Claude CLI

Персональный AI-ассистент: Telegram-бот запускает `claude` CLI как подпроцесс, ведёт сессии,
отдаёт ответы (стриминг, нативные таблицы, кнопки-вопросы) и распознаёт голосовые сообщения.
Работает **строго на подписке Claude Pro/Max** (без оплаты по API).

> Стек: NestJS 11 · grammY (Telegram) · better-sqlite3 · whisper.cpp (STT).

---

## ⚙️ Зависимости вне `npm install`

`npm install` ставит только Node-пакеты. Ниже — всё, что нужно поставить **дополнительно** в систему.
Команды даны для **macOS (разработка)** и **Ubuntu/Debian (сервер/дроплет)**.

### 1. Node.js 22+

```bash
node -v   # требуется >= 22
# macOS:   brew install node
# Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

### 2. Claude Code CLI + авторизация по подписке (обязательно)

Бот вызывает бинарь `claude`. Его нет в зависимостях проекта — ставится отдельно.

```bash
# Установка (см. https://code.claude.com/docs). Например:
npm install -g @anthropic-ai/claude-code
claude --version            # проверка (тестировалось на v2.1.186)
```

**Авторизация:**

- **Локально (mac):** один раз войти интерактивно (`claude`, вход через браузер) — токен ляжет в keychain,
  в `.env` ничего добавлять не нужно.
- **На сервере (headless, без браузера):**
  ```bash
  claude setup-token        # требует активную подписку Pro/Max
  ```
  Полученный токен прописать в `.env` как `CLAUDE_CODE_OAUTH_TOKEN`.

> ⚠️ **Критично:** НЕ задавайте переменную `ANTHROPIC_API_KEY` в окружении — она имеет приоритет и
> переключает биллинг на оплату по API. (Приложение само вычищает её из окружения подпроцесса,
> но не держите её в shell/`.env`.) Проверить активный путь: `claude` → `/status`.

### 3. Build-инструменты для `better-sqlite3` (нативный модуль)

`better-sqlite3` ставится через npm, но это нативный аддон. Обычно подтягивается готовый prebuilt-бинарь;
если на сервере он собирается из исходников — нужны компиляторы:

```bash
# macOS:   xcode-select --install
# Ubuntu:  sudo apt install -y build-essential python3
```

### 4. Голосовые сообщения — ffmpeg + whisper.cpp + модель (опционально, Фаза 9)

Нужны только если включаете распознавание голоса (`WHISPER_ENABLED=true`). Иначе бот на голосовое
ответит «не настроено», и эти шаги можно пропустить.

**4.1. ffmpeg** (конвертация OGG/Opus → WAV 16k):

```bash
# macOS:   brew install ffmpeg
# Ubuntu:  sudo apt install -y ffmpeg
```

**4.2. whisper.cpp** (локальный STT, собирается из исходников):

```bash
git clone https://github.com/ggml-org/whisper.cpp /opt/whisper.cpp
cd /opt/whisper.cpp
cmake -B build
cmake --build build -j --config Release
# бинарь появится в: /opt/whisper.cpp/build/bin/whisper-cli
```

**4.3. Модель** (для русского рекомендуется `medium`, квантизованная — экономит RAM):

```bash
cd /opt/whisper.cpp
sh ./models/download-ggml-model.sh medium-q5_0
# модель: /opt/whisper.cpp/models/ggml-medium-q5_0.bin
```

> 💡 RAM моделей (рантайм): tiny ~273МБ · base ~388МБ · small ~852МБ · medium ~2.1ГБ.
> whisper.cpp упирается в CPU — на 1 vCPU медленно. Рекомендуемый дроплет под голос: **≥ 4 GB / 2 vCPU**.

Затем в `.env`:
```
WHISPER_ENABLED=true
WHISPER_BIN=/opt/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=/opt/whisper.cpp/models/ggml-medium-q5_0.bin
```

### 5. Telegram-бот

Создайте бота у [@BotFather](https://t.me/BotFather) (`/newbot`) → получите токен → в `.env`
`TELEGRAM_BOT_TOKEN=...`. Свой Telegram ID узнаете, написав боту (он ответит отказом с вашим id) —
впишите его в `TELEGRAM_ALLOWED_USER_IDS`.

---

## 🚀 Установка и запуск

```bash
npm install
cp .env.example .env     # затем заполните токены (см. ниже)

npm run start:dev        # разработка (watch)
npm run start:prod       # прод (после npm run build)
```

## 🔧 Конфигурация (`.env`)

Все переменные с описанием — в [`.env.example`](./.env.example). Минимум для запуска бота:

| Переменная | Обязательна | Назначение |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | да (иначе бот выключен) | токен от BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | да | разрешённые user id (csv) |
| `CLAUDE_CODE_OAUTH_TOKEN` | на сервере | токен подписки (`claude setup-token`) |
| `CLAUDE_WORKSPACE` | реком. | рабочая папка для файлов claude |
| `CLAUDE_PERMISSION_MODE` | реком. | `bypassPermissions` для headless-инструментов |
| `WHISPER_*`, `FFMPEG_BIN` | для голоса | см. шаг 4 |

## 🧪 Тесты

```bash
npm run test         # юнит-тесты
npm run test:cov     # покрытие
```

---

## 📦 Деплой на сервер (кратко)

1. Поставить зависимости из разделов 1–4 выше (Node, claude CLI + `setup-token`, при нужде ffmpeg+whisper).
2. `npm ci && npm run build`.
3. Прописать `.env` (с `CLAUDE_CODE_OAUTH_TOKEN`, без `ANTHROPIC_API_KEY`).
4. Завести systemd-юнит на `node dist/main` с автозапуском (план — отдельно).
5. В первые дни сверять расход на дашбордах claude.ai / platform.claude.com (должна быть подписка, не API).
</content>
