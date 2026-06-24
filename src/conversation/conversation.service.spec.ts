import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { ClaudeClientService } from '../claude/claude-client.service';
import { ClaudeEvent, RunResult } from '../claude/claude.types';
import { SessionService } from '../session/session.service';
import { ChatQueue } from './chat-queue';
import { ConversationService } from './conversation.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

const okResult: RunResult = {
  text: 'pong',
  sessionId: 'srv',
  costUsd: 0.01,
  isError: false,
};

function makeSessions(): SessionService {
  const config = {
    get: (key: string, def?: unknown) =>
      key === 'DB_PATH' ? ':memory:' : def,
  } as unknown as ConfigService;
  const s = new SessionService(config);
  s.onModuleInit();
  return s;
}

/** Мок ClaudeClientService с настраиваемым run(). */
function makeClaude(): { run: jest.Mock } {
  return { run: jest.fn() };
}

describe('ConversationService', () => {
  let queue: ChatQueue;
  let sessions: SessionService;
  let claude: { run: jest.Mock };
  let svc: ConversationService;

  beforeEach(() => {
    queue = new ChatQueue();
    sessions = makeSessions();
    claude = makeClaude();
    svc = new ConversationService(
      queue,
      sessions,
      claude as unknown as ClaudeClientService,
    );
  });

  afterEach(() => sessions.onModuleDestroy());

  it('новый чат: run с resume=false, при успехе recordTurn', async () => {
    claude.run.mockReturnValue({ events$: of(), done: Promise.resolve(okResult) });

    const res = await svc.send('c1', 'hi');

    expect(res.isError).toBe(false);
    expect(claude.run).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hi', resume: false }),
    );
    expect(sessions.getActive('c1')?.turnCount).toBe(1);
  });

  it('второй ход того же чата: resume=true', async () => {
    claude.run.mockReturnValue({ events$: of(), done: Promise.resolve(okResult) });

    await svc.send('c1', 'hi');
    await svc.send('c1', 'again');

    expect(claude.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ resume: true }),
    );
  });

  it('сериализация: второй run стартует только после завершения первого', async () => {
    const d1 = deferred<RunResult>();
    claude.run
      .mockReturnValueOnce({ events$: of(), done: d1.promise })
      .mockReturnValueOnce({ events$: of(), done: Promise.resolve(okResult) });

    const p1 = svc.send('c1', 'm1');
    const p2 = svc.send('c1', 'm2');

    await tick();
    expect(claude.run).toHaveBeenCalledTimes(1); // второй ждёт

    d1.resolve(okResult);
    await Promise.all([p1, p2]);
    expect(claude.run).toHaveBeenCalledTimes(2);
  });

  it('провал первого хода: сессия сброшена, ошибка проброшена, следующий ход — свежий UUID', async () => {
    claude.run
      .mockReturnValueOnce({
        events$: of(),
        done: Promise.reject(new Error('crash')),
      })
      .mockReturnValue({ events$: of(), done: Promise.resolve(okResult) });

    await expect(svc.send('c1', 'm1')).rejects.toThrow('crash');
    expect(sessions.getActive('c1')).toBeNull();

    await svc.send('c1', 'm2');
    const firstId = claude.run.mock.calls[0][0].sessionId;
    const secondId = claude.run.mock.calls[1][0].sessionId;
    expect(secondId).not.toBe(firstId);
    expect(claude.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ resume: false }),
    );
  });

  it('isError на первом ходе: сессия сброшена, но send резолвится результатом', async () => {
    const errResult: RunResult = { ...okResult, isError: true, text: 'ошибка' };
    claude.run.mockReturnValue({
      events$: of(),
      done: Promise.resolve(errResult),
    });

    const res = await svc.send('c1', 'm1');
    expect(res.isError).toBe(true);
    expect(res.text).toBe('ошибка');
    expect(sessions.getActive('c1')).toBeNull();
  });

  it('onEvent получает проброшенные события', async () => {
    const events: ClaudeEvent[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
        session_id: 'srv',
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'pong',
        session_id: 'srv',
        total_cost_usd: 0.01,
        is_error: false,
      },
    ];
    claude.run.mockReturnValue({
      events$: of(...events),
      done: Promise.resolve(okResult),
    });

    const received: ClaudeEvent[] = [];
    await svc.send('c1', 'm', (e) => received.push(e));
    expect(received).toEqual(events);
  });
});
