import anthropic
from pathlib import Path
from collections.abc import AsyncIterator
from . import sessions

_client = anthropic.AsyncAnthropic()
SYSTEM_PROMPT = Path(__file__).parent.joinpath("system_prompt.md").read_text()
MODEL = "claude-opus-4-8"


async def run(user_message: str, chat_id: int) -> AsyncIterator[str]:
    history = await sessions.get_history(chat_id)
    history.append({"role": "user", "content": user_message})

    full_text = ""
    async with _client.messages.stream(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=history,
        thinking={"type": "adaptive"},
    ) as stream:
        async for text in stream.text_stream:
            full_text += text
            yield text

    history.append({"role": "assistant", "content": full_text})
    await sessions.save_history(chat_id, history)
