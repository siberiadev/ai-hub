import json
import aiofiles
from pathlib import Path

SESSIONS_FILE = Path("workspace/sessions.json")
_cache: dict[int, list[dict]] = {}


async def get_history(chat_id: int) -> list[dict]:
    if chat_id in _cache:
        return _cache[chat_id]
    if SESSIONS_FILE.exists():
        async with aiofiles.open(SESSIONS_FILE) as f:
            data = json.loads(await f.read())
        _cache.update({int(k): v for k, v in data.items()})
    return list(_cache.get(chat_id, []))


async def save_history(chat_id: int, history: list[dict]) -> None:
    _cache[chat_id] = history
    SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(SESSIONS_FILE, "w") as f:
        await f.write(json.dumps({str(k): v for k, v in _cache.items()}, ensure_ascii=False))
