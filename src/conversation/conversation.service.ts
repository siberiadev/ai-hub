import { Injectable, Logger } from '@nestjs/common';
import { ClaudeClientService } from '../claude/claude-client.service';
import { ClaudeEvent, RunResult } from '../claude/claude.types';
import { SessionService } from '../session/session.service';
import { ChatQueue } from './chat-queue';

/**
 * Единая точка оркестрации одного хода диалога.
 *
 * `send` ставит ход в очередь конкретного чата (ChatQueue), поэтому два сообщения
 * в один чат не запустят два `claude --resume` по одной сессии одновременно.
 * Внутри: выбор сессии (SessionService) → запуск (ClaudeClientService) →
 * фиксация успешного хода / ротация неудавшейся первой сессии.
 */
@Injectable()
export class ConversationService {
  private readonly log = new Logger(ConversationService.name);

  constructor(
    private readonly queue: ChatQueue,
    private readonly sessions: SessionService,
    private readonly claude: ClaudeClientService,
  ) {}

  /**
   * Обработать сообщение чата. Сериализуется по chatId.
   * @param onEvent опциональный колбэк потоковых событий (tool_use, текст и т.п.).
   */
  send(
    chatId: string,
    message: string,
    onEvent?: (e: ClaudeEvent) => void,
  ): Promise<RunResult> {
    return this.queue.enqueue(chatId, () =>
      this.runTurn(chatId, message, onEvent),
    );
  }

  private async runTurn(
    chatId: string,
    message: string,
    onEvent?: (e: ClaudeEvent) => void,
  ): Promise<RunResult> {
    const { sessionId, resume } = this.sessions.resolveForMessage(chatId);
    this.log.log(`chat=${chatId} session=${sessionId} resume=${resume}`);

    const { events$, done } = this.claude.run({ message, sessionId, resume });
    events$.subscribe({
      next: (evt) => {
        if (evt.type === 'assistant') {
          for (const block of evt.message.content) {
            if (block.type === 'tool_use') this.log.log(`tool_use: ${block.name}`);
          }
        }
        onEvent?.(evt);
      },
      // Ошибку хода обрабатываем через промис `done` ниже; здесь гасим, чтобы
      // unhandled error в потоке событий не уронил процесс.
      error: () => undefined,
    });

    try {
      const result = await done;
      if (result.isError) {
        // claude вернул ошибку-результат: ротируем неудавшийся первый ход, но
        // отдаём result наверх — вызывающий (Telegram) покажет текст ошибки.
        if (!resume) this.sessions.discardIfUnused(chatId, sessionId);
      } else {
        this.sessions.recordTurn(chatId, sessionId);
      }
      return result;
    } catch (err) {
      // процесс упал / нет финального result: на первом ходе сбрасываем сессию,
      // чтобы следующий запрос стартовал со свежим UUID.
      if (!resume) this.sessions.discardIfUnused(chatId, sessionId);
      throw err;
    }
  }
}
