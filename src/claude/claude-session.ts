import { Logger } from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Observable, Subject } from 'rxjs';
import {
  buildArgs,
  buildEnv,
  SpawnConfig,
  userMessageLine,
} from './claude-spawn.util';
import { ClaudeEvent, RunResult } from './claude.types';

interface CurrentTurn {
  subject: Subject<ClaudeEvent>;
  resolve: (r: RunResult) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

/**
 * Один постоянный процесс `claude` (`--input-format stream-json`), привязанный к
 * конкретной сессии. Холодный старт платится один раз; каждый `send` — это новый
 * ход в той же сессии (JSON-строка в stdin), процесс остаётся жив до `kill()`.
 *
 * Один ход за раз (`busy`); очередь по чату (Фаза 3) это и так гарантирует.
 */
export class ClaudeSession {
  private readonly log = new Logger(ClaudeSession.name);
  private readonly child: ChildProcessWithoutNullStreams;
  private current: CurrentTurn | null = null;
  private stderr = '';

  alive = true;
  busy = false;
  lastUsedAt = Date.now();

  constructor(
    private readonly cfg: SpawnConfig,
    readonly sessionId: string,
    resume: boolean,
    /** Вызывается при смерти процесса — пул удаляет сессию из map. */
    private readonly onExit: (session: ClaudeSession) => void,
  ) {
    const args = buildArgs(cfg, { sessionId, resume, persistent: true });
    this.log.debug(`spawn persistent ${cfg.bin} ${args.join(' ')} (cwd=${cfg.cwd})`);

    this.child = spawn(cfg.bin, args, {
      cwd: cfg.cwd,
      env: buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdin.on('error', (e) =>
      this.log.warn(`stdin error: ${(e as Error).message}`),
    );
    this.child.stderr.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', (line) => this.onLine(line));
    this.child.on('error', (err) => this.onDeath(err));
    this.child.on('close', (code) =>
      this.onDeath(
        new Error(`claude exited ${code}. stderr: ${this.stderr.slice(-2000).trim()}`),
      ),
    );
  }

  /** Новый ход в этой сессии. */
  send(message: string): {
    events$: Observable<ClaudeEvent>;
    done: Promise<RunResult>;
  } {
    if (!this.alive) throw new Error('claude session is dead');
    if (this.busy) throw new Error('claude session is busy');
    this.busy = true;
    this.lastUsedAt = Date.now();

    const subject = new Subject<ClaudeEvent>();
    const done = new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.log.warn(`turn timed out after ${this.cfg.timeoutMs}ms, killing session`);
        this.kill();
      }, this.cfg.timeoutMs);
      this.current = { subject, resolve, reject, timer };
    });

    this.child.stdin.write(userMessageLine(message));
    return { events$: subject.asObservable(), done };
  }

  /** Убить процесс (выселение/таймаут/shutdown). */
  kill(): void {
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    this.child.kill('SIGTERM');
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cur = this.current;
    if (!cur) return; // между ходами — игнорируем шальные строки

    let evt: ClaudeEvent;
    try {
      evt = JSON.parse(trimmed) as ClaudeEvent;
    } catch {
      this.log.warn(`non-JSON stdout line skipped: ${trimmed.slice(0, 200)}`);
      return;
    }
    cur.subject.next(evt);

    if (evt.type === 'result') {
      const final: RunResult = {
        text: evt.result,
        sessionId: evt.session_id,
        costUsd: evt.total_cost_usd,
        isError: evt.is_error,
      };
      clearTimeout(cur.timer);
      cur.subject.complete();
      this.current = null;
      this.busy = false;
      this.lastUsedAt = Date.now();
      cur.resolve(final);
    }
  }

  private onDeath(err: Error): void {
    if (!this.alive) return;
    this.alive = false;
    const cur = this.current;
    if (cur) {
      clearTimeout(cur.timer);
      if (!cur.subject.closed) cur.subject.error(err);
      this.current = null;
      this.busy = false;
      cur.reject(err);
    }
    this.onExit(this);
  }
}
