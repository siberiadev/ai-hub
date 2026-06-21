import asyncio
import os
from aiogram import Bot, Dispatcher, Router
from aiogram.types import Message
from dotenv import load_dotenv
from assistant.agent import loop

load_dotenv()

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
OWNER_ID = int(os.environ["OWNER_TELEGRAM_ID"])

router = Router()
bot = Bot(token=TOKEN)
dp = Dispatcher()
dp.include_router(router)


@router.message()
async def handle(message: Message) -> None:
    # WHITELIST — первая строка, обязательно
    if message.from_user is None or message.from_user.id != OWNER_ID:
        return

    text = message.text or message.caption or ""
    if not text:
        return

    reply = await message.answer("…")
    buffer = ""
    last_edit = 0.0

    async for chunk in loop.run(text, message.chat.id):
        buffer += chunk
        now = asyncio.get_event_loop().time()
        if now - last_edit > 0.3:
            await reply.edit_text(buffer or "…")
            last_edit = now

    if buffer:
        await reply.edit_text(buffer)


async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
