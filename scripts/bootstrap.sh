#!/usr/bin/env bash
#
# ai-hub bootstrap — раскатка одной командой:
#   curl -fsSL https://raw.githubusercontent.com/siberiadev/ai-hub/main/scripts/bootstrap.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/siberiadev/ai-hub/main/scripts/bootstrap.sh | bash -s -- --with-voice
#
# Ставит git, клонирует (или обновляет) репозиторий и запускает scripts/install.sh.
# Запускать ПОД ОБЫЧНЫМ пользователем (не root).
set -euo pipefail

REPO="${AIHUB_REPO:-https://github.com/siberiadev/ai-hub.git}"
DEST="${AIHUB_DIR:-$HOME/ai-hub}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Bootstrap рассчитан на Ubuntu/Debian (нужен apt-get). Прерываю." >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  echo "Не запускай под root — нужен обычный пользователь (sudo поднимется сам). Прерываю." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  log "Устанавливаю git"
  sudo apt-get update -y
  sudo apt-get install -y git
fi

if [ -d "$DEST/.git" ]; then
  log "Обновляю репозиторий в $DEST"
  git -C "$DEST" pull --ff-only
else
  log "Клонирую $REPO → $DEST"
  git clone "$REPO" "$DEST"
fi

cd "$DEST"
log "Запускаю установщик"
exec bash scripts/install.sh "$@"
