import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { ClaudeClientService } from './claude-client.service';
import { ClaudeEvent } from './claude.types';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as unknown as jest.Mock;

/** Поддельный дочерний процесс claude. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill = jest.fn();
}

function makeService(
  overrides: Record<string, string> = {},
): ClaudeClientService {
  // one-shot тесты по умолчанию (persistent-пул проверяется отдельным describe)
  const merged: Record<string, string> = {
    CLAUDE_PERSISTENT: 'false',
    ...overrides,
  };
  const config = {
    get: (key: string, def?: unknown) =>
      key in merged ? merged[key] : def,
  } as unknown as ConfigService;
  return new ClaudeClientService(config);
}

/** Прогоняет строки через stdout и корректно завершает процесс. */
function feed(child: FakeChild, lines: object[], code = 0): void {
  for (const obj of lines) child.stdout.write(JSON.stringify(obj) + '\n');
  child.stdout.on('end', () => child.emit('close', code));
  child.stdout.end();
}

const resultLine = (over: Partial<Record<string, unknown>> = {}) => ({
  type: 'result',
  subtype: 'success',
  result: 'pong',
  session_id: 'uuid-1',
  total_cost_usd: 0.01,
  is_error: false,
  ...over,
});

describe('ClaudeClientService', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('парсит поток и резолвит финальный результат', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const events: ClaudeEvent[] = [];
    const { events$, done } = service.run({
      message: 'hi',
      sessionId: 'uuid-1',
      resume: false,
    });
    events$.subscribe((e) => events.push(e));

    feed(child, [
      { type: 'system', subtype: 'init', session_id: 'uuid-1', tools: [], model: 'm' },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read' }] },
        session_id: 'uuid-1',
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result' }] },
        session_id: 'uuid-1',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'pong' }] },
        session_id: 'uuid-1',
      },
      resultLine(),
    ]);

    const result = await done;
    expect(result).toEqual({
      text: 'pong',
      sessionId: 'uuid-1',
      costUsd: 0.01,
      isError: false,
    });
    expect(events.map((e) => e.type)).toEqual([
      'system',
      'assistant',
      'user',
      'assistant',
      'result',
    ]);
  });

  it('игнорирует не-JSON строки, не роняя поток', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-1', resume: false });
    child.stdout.write('not json at all\n');
    feed(child, [resultLine()]);

    await expect(done).resolves.toMatchObject({ text: 'pong' });
  });

  it('первый ход: --session-id, и из env вычищается ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-be-removed';
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-2', resume: false });
    feed(child, [resultLine({ session_id: 'uuid-2', result: '' })]);
    await done;

    const [bin, args, opts] = spawnMock.mock.calls[0];
    expect(bin).toBe('claude');
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--session-id',
        'uuid-2',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
      ]),
    );
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--strict-mcp-config');
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('продолжение: используется --resume вместо --session-id', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-3', resume: true });
    feed(child, [resultLine({ session_id: 'uuid-3' })]);
    await done;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('uuid-3');
    expect(args).not.toContain('--session-id');
  });

  it('reject, если процесс завершился без события result', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-4', resume: false });
    child.stderr.write('boom');
    child.stdout.on('end', () => child.emit('close', 1));
    child.stdout.end();

    await expect(done).rejects.toThrow(/exited 1 without a result/);
  });

  it('резолвит по событию result, не дожидаясь close', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService();

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-5', resume: false });
    // пишем только result-строку, close НЕ эмитим
    child.stdout.write(JSON.stringify(resultLine({ session_id: 'uuid-5' })) + '\n');

    await expect(done).resolves.toMatchObject({ text: 'pong', isError: false });
  });

  it('CLAUDE_STRICT_MCP=true добавляет --strict-mcp-config и --mcp-config', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const service = makeService({
      CLAUDE_STRICT_MCP: 'true',
      CLAUDE_MCP_CONFIG: '/tmp/mcp.json',
    });

    const { done } = service.run({ message: 'hi', sessionId: 'uuid-6', resume: false });
    child.stdout.write(JSON.stringify(resultLine({ session_id: 'uuid-6' })) + '\n');
    await done;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/mcp.json');
    expect(args).not.toContain('--input-format'); // one-shot не персистентный
  });
});

describe('ClaudeClientService (persistent pool)', () => {
  let children: FakeChild[];

  beforeEach(() => {
    spawnMock.mockReset();
    children = [];
    spawnMock.mockImplementation(() => {
      const c = new FakeChild();
      children.push(c);
      return c;
    });
  });

  function poolService(overrides: Record<string, string> = {}): ClaudeClientService {
    const merged: Record<string, string> = {
      CLAUDE_PERSISTENT: 'true',
      CLAUDE_MAX_PROCS: '2',
      ...overrides,
    };
    const config = {
      get: (key: string, def?: unknown) =>
        key in merged ? merged[key] : def,
    } as unknown as ConfigService;
    return new ClaudeClientService(config);
  }

  /** Завершает текущий ход указанного процесса, отдав result. */
  function completeTurn(child: FakeChild, result = 'ok', sessionId = 's'): void {
    child.stdout.write(
      JSON.stringify(resultLine({ result, session_id: sessionId })) + '\n',
    );
  }

  it('persistent режим добавляет --input-format stream-json', async () => {
    const svc = poolService();
    const r = svc.run({ message: 'a', sessionId: 's1', resume: false });
    completeTurn(children[0], 'one', 's1');
    await r.done;
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toEqual(
      expect.arrayContaining(['--input-format', 'stream-json', '--session-id', 's1']),
    );
  });

  it('повтор по тому же sessionId переиспользует процесс (spawn 1 раз)', async () => {
    const svc = poolService();
    const r1 = svc.run({ message: 'a', sessionId: 's1', resume: false });
    completeTurn(children[0], 'one', 's1');
    await r1.done;

    const r2 = svc.run({ message: 'b', sessionId: 's1', resume: true });
    completeTurn(children[0], 'two', 's1');
    await expect(r2.done).resolves.toMatchObject({ text: 'two' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('разные sessionId → разные процессы', async () => {
    const svc = poolService();
    const r1 = svc.run({ message: 'a', sessionId: 's1', resume: false });
    completeTurn(children[0], 'one', 's1');
    await r1.done;

    const r2 = svc.run({ message: 'b', sessionId: 's2', resume: false });
    completeTurn(children[1], 'two', 's2');
    await r2.done;

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('LRU-выселение при превышении CLAUDE_MAX_PROCS', async () => {
    const svc = poolService({ CLAUDE_MAX_PROCS: '1' });
    const r1 = svc.run({ message: 'a', sessionId: 's1', resume: false });
    completeTurn(children[0], 'one', 's1');
    await r1.done;

    const r2 = svc.run({ message: 'b', sessionId: 's2', resume: false });
    completeTurn(children[1], 'two', 's2');
    await r2.done;

    expect(children[0].kill).toHaveBeenCalled(); // старая сессия выселена
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('смерть процесса удаляет сессию из пула → следующий ход респавнит', async () => {
    const svc = poolService();
    const r1 = svc.run({ message: 'a', sessionId: 's1', resume: false });
    completeTurn(children[0], 'one', 's1');
    await r1.done;

    children[0].emit('close', 1); // процесс умер

    const r2 = svc.run({ message: 'b', sessionId: 's1', resume: true });
    completeTurn(children[1], 'two', 's1');
    await expect(r2.done).resolves.toMatchObject({ text: 'two' });

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
