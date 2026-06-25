#!/usr/bin/env bash
#
# ai-hub installer (Ubuntu/Debian). Идемпотентен — можно запускать повторно.
#   bash scripts/install.sh [--with-voice] [--reconfigure]
#
# Ставит зависимости, собирает проект, интерактивно заполняет .env и поднимает
# systemd-демон `ai-hub`. Запускать ПОД ОБЫЧНЫМ пользователем (sudo поднимается сам),
# тем же, под которым будет авторизован claude (`claude /login`).
set -euo pipefail

# --- параметры ---
WITH_VOICE=0
RECONFIGURE=0
for arg in "$@"; do
  case "$arg" in
    --with-voice) WITH_VOICE=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    *) echo "Неизвестный флаг: $arg" >&2; exit 2 ;;
  esac
done

NODE_MAJOR=22
SERVICE=ai-hub
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
ENV_FILE="$APP_DIR/.env"
WHISPER_DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
WHISPER_MODEL_NAME="medium-q5_0"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

# --- guards ---
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Этот скрипт рассчитан на Ubuntu/Debian (нужен apt-get). Прерываю." >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  echo "Не запускай под root — нужен обычный пользователь (sudo скрипт поднимает сам)," >&2
  echo "тот же, под которым будет 'claude /login'. Прерываю." >&2
  exit 1
fi

# --- 2. системные пакеты ---
log "Системные пакеты (apt)"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates build-essential python3

# --- 3. Node ${NODE_MAJOR} ---
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "${major:-0}" -ge "$NODE_MAJOR" ] 2>/dev/null; then need_node=0; fi
fi
if [ "$need_node" -eq 1 ]; then
  log "Установка Node.js ${NODE_MAJOR}.x (nodesource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node $(node -v) — ок"
fi

# --- 4. Claude CLI ---
if ! command -v claude >/dev/null 2>&1; then
  log "Установка Claude CLI (npm -g)"
  sudo npm install -g @anthropic-ai/claude-code
fi
log "Claude CLI: $(claude --version 2>/dev/null || echo '???')"

# --- 5. (опц.) голос: ffmpeg + whisper.cpp + модель ---
if [ "$WITH_VOICE" -eq 1 ]; then
  log "Голос: ffmpeg + cmake"
  sudo apt-get install -y ffmpeg cmake
  if [ ! -d "$WHISPER_DIR/.git" ]; then
    log "Клонирую whisper.cpp → $WHISPER_DIR"
    git clone https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
  fi
  if [ ! -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
    log "Сборка whisper.cpp (может занять время)"
    cmake -B "$WHISPER_DIR/build" -S "$WHISPER_DIR"
    cmake --build "$WHISPER_DIR/build" -j --config Release
  fi
  if [ ! -f "$WHISPER_DIR/models/ggml-${WHISPER_MODEL_NAME}.bin" ]; then
    log "Скачиваю модель ${WHISPER_MODEL_NAME}"
    ( cd "$WHISPER_DIR" && sh ./models/download-ggml-model.sh "$WHISPER_MODEL_NAME" )
  fi
fi

# --- 6. сборка приложения ---
log "npm ci && build"
npm ci
npm run build
mkdir -p "$APP_DIR/data" "$APP_DIR/workspace"

# --- helpers для .env ---
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true; }
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { FS="="; done=0 }
    $1==k && !done { print k"="v; done=1; next }
    { print }
    END { if (!done) print k"="v }
  ' "$ENV_FILE" >"$tmp" && mv "$tmp" "$ENV_FILE"
}
ask() {
  local key="$1" desc="$2" def="${3:-}" cur val=""
  cur="$(get_env "$key")"; [ -z "$cur" ] && cur="$def"
  if [ -r /dev/tty ]; then
    read -rp "    ${key} — ${desc} [${cur:-—}]: " val </dev/tty || true
  fi
  set_env "$key" "${val:-$cur}"
}
# Секретный ввод: не печатает значение и не показывает текущее (только факт, что оно задано).
ask_secret() {
  local key="$1" desc="$2" cur val=""
  cur="$(get_env "$key")"
  local hint="не задано"; [ -n "$cur" ] && hint="задано, Enter — оставить"
  if [ -r /dev/tty ]; then
    read -rsp "    ${key} — ${desc} (${hint}): " val </dev/tty || true
    echo
  fi
  set_env "$key" "${val:-$cur}"
}

# --- 7. .env + интерактивный мастер ---
fresh=0
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  fresh=1
fi
# claude из PATH — пропишем абсолютный путь, чтобы systemd точно нашёл бинарь
set_env CLAUDE_BIN "$(command -v claude)"

run_wizard=0
if [ "$fresh" -eq 1 ] || [ "$RECONFIGURE" -eq 1 ] || [ -z "$(get_env TELEGRAM_BOT_TOKEN)" ]; then
  run_wizard=1
fi

if [ "$run_wizard" -eq 1 ] && [ -r /dev/tty ]; then
  log "Конфигурация .env (Enter — оставить значение в скобках)"
  ask_secret TELEGRAM_BOT_TOKEN  "токен бота от @BotFather"
  ask TELEGRAM_ALLOWED_USER_IDS  "твой Telegram id (можно пусто; узнать — напиши боту)"
  echo
  warn "ВНИМАНИЕ про режим разрешений:"
  echo  "    'bypassPermissions' = Claude выполняет ЛЮБЫЕ команды/правки БЕЗ подтверждения."
  echo  "    Любой из TELEGRAM_ALLOWED_USER_IDS получает фактически шелл на этом сервере."
  echo  "    Держи allowlist минимальным и токен в секрете. Безопаснее: 'default' или 'acceptEdits'"
  echo  "    (но тогда Claude не сможет сам пользоваться инструментами в headless-режиме)."
  ask CLAUDE_PERMISSION_MODE     "режим разрешений claude" "bypassPermissions"
  ask CLAUDE_WORKSPACE           "рабочая папка claude" "$APP_DIR/workspace"
  ask CLAUDE_TIMEOUT_MS          "таймаут одного хода, мс (для кодовых задач больше)" "600000"
elif [ "$run_wizard" -eq 1 ]; then
  warn "Нет терминала для мастера — заполни $ENV_FILE вручную (TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS)."
fi

# .env содержит токен — закрываем права
chmod 600 "$ENV_FILE" 2>/dev/null || true

# голос: пути подставляем автоматически
if [ "$WITH_VOICE" -eq 1 ]; then
  set_env WHISPER_ENABLED true
  set_env WHISPER_BIN   "$WHISPER_DIR/build/bin/whisper-cli"
  set_env WHISPER_MODEL "$WHISPER_DIR/models/ggml-${WHISPER_MODEL_NAME}.bin"
fi

# --- 8. авторизация claude ---
if [ "$run_wizard" -eq 1 ] && [ -r /dev/tty ]; then
  echo
  warn "Авторизация Claude (один раз, под пользователем $RUN_USER):"
  echo  "    запусти 'claude' и выполни /login (вход в браузере), проверь /status."
  read -rp "    Запустить 'claude' сейчас для входа? [y/N]: " a </dev/tty || true
  if [ "${a:-N}" = "y" ] || [ "${a:-N}" = "Y" ]; then
    claude </dev/tty || true
  fi
fi

# --- 9. systemd-демон ---
log "Настройка systemd-сервиса '$SERVICE'"
NODE_BIN="$(command -v node)"
sudo tee "/etc/systemd/system/${SERVICE}.service" >/dev/null <<EOF
[Unit]
Description=ai-hub (Telegram <-> Claude bridge)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} dist/main
Restart=always
RestartSec=3
User=${RUN_USER}
Environment=NODE_ENV=production
Environment=ANTHROPIC_API_KEY=

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null 2>&1 || true
sudo systemctl restart "$SERVICE"

echo
log "Готово. Сервис '$SERVICE' запущен."
echo  "    Статус: systemctl status $SERVICE"
echo  "    Логи:   journalctl -u $SERVICE -f"
if [ -z "$(get_env TELEGRAM_BOT_TOKEN)" ]; then
  warn "TELEGRAM_BOT_TOKEN пуст — бот выключен. Запусти повторно: bash scripts/install.sh --reconfigure"
fi
