FROM python:3.12-slim

RUN adduser --disabled-password --gecos "" appuser

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY assistant/ assistant/

RUN mkdir -p workspace && chown -R appuser:appuser /app/workspace

USER appuser

CMD ["python", "-m", "assistant.bridge.telegram_bot"]
