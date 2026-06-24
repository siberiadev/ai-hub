import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ClaudeSession } from './claude-session';
import { SpawnConfig } from './claude-spawn.util';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as unknown as jest.Mock;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill = jest.fn();
}

const cfg: SpawnConfig = {
  bin: 'claude',
  cwd: '/tmp',
  permissionMode: 'default',
  timeoutMs: 120000,
  strictMcp: false,
  mcpConfig: '',
  askEnabled: false,
};

const resultLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'ok',
    session_id: 's1',
    total_cost_usd: 0,
    is_error: false,
    ...over,
  }) + '\n';

const tick = () => new Promise((r) => setImmediate(r));

describe('ClaudeSession', () => {
  let child: FakeChild;
  let onExit: jest.Mock;

  beforeEach(() => {
    spawnMock.mockReset();
    child = new FakeChild();
    spawnMock.mockReturnValue(child);
    onExit = jest.fn();
  });

  afterEach(() => {
    // снять висящий таймаут текущего хода (если есть) через onDeath
    child.emit('close', 0);
  });

  it('спавнит постоянный процесс с --input-format stream-json', () => {
    new ClaudeSession(cfg, 's1', false, onExit);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        '--input-format',
        'stream-json',
        '--session-id',
        's1',
      ]),
    );
  });

  it('send пишет user-JSON в stdin и резолвит по result', async () => {
    const s = new ClaudeSession(cfg, 's1', false, onExit);
    const writes: string[] = [];
    child.stdin.on('data', (d: Buffer) => writes.push(d.toString()));

    const { done } = s.send('привет');
    await tick();
    expect(JSON.parse(writes.join('').trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'привет' }] },
    });

    child.stdout.write(resultLine({ result: 'pong' }));
    await expect(done).resolves.toMatchObject({ text: 'pong', isError: false });
    expect(s.busy).toBe(false);
  });

  it('два хода на одном процессе (spawn вызван один раз)', async () => {
    const s = new ClaudeSession(cfg, 's1', false, onExit);

    const r1 = s.send('a');
    child.stdout.write(resultLine({ result: 'one' }));
    await expect(r1.done).resolves.toMatchObject({ text: 'one' });

    const r2 = s.send('b');
    child.stdout.write(resultLine({ result: 'two' }));
    await expect(r2.done).resolves.toMatchObject({ text: 'two' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('busy: параллельный send бросает', () => {
    const s = new ClaudeSession(cfg, 's1', false, onExit);
    const first = s.send('a'); // ход не завершаем
    first.done.catch(() => undefined); // afterEach закроет процесс → reject, гасим
    expect(() => s.send('b')).toThrow(/busy/);
  });

  it('смерть процесса → reject хода, alive=false, onExit', async () => {
    const s = new ClaudeSession(cfg, 's1', false, onExit);
    const { done } = s.send('a');
    child.emit('close', 1);
    await expect(done).rejects.toThrow();
    expect(s.alive).toBe(false);
    expect(onExit).toHaveBeenCalledWith(s);
  });
});
