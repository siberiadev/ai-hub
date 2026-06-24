import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Observable, Subject } from 'rxjs';
import { ClaudeSession } from './claude-session';
import {
  buildArgs,
  buildEnv,
  readSpawnConfig,
} from './claude-spawn.util';
import { ClaudeEvent, RunOptions, RunResult } from './claude.types';

const EVICT_INTERVAL_MS = 60_000;

/**
 * Запуск `claude` CLI в одном из двух режимов (флаг `CLAUDE_PERSISTENT`):
 *  - persistent (по умолчанию): пул постоянных процессов `ClaudeSession`, по одному
 *    на сессию — холодный старт платится один раз, дальше ход ≈ только инференс;
 *  - one-shot (fallback): новый процесс на каждый ход (как до Фазы 6).
 *
 * Публичный API `run()` одинаков для обоих режимов → верхние слои не зависят от режима.
 */
@Injectable()
export class ClaudeClientService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ClaudeClientService.name);
  private readonly sessions = new Map<string, ClaudeSession>();
  private evictTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.isPersistent()) {
      this.evictTimer = setInterval(
        () => this.evictIdle(),
        EVICT_INTERVAL_MS,
      );
      this.evictTimer.unref?.();
      this.log.log('persistent режим: пул постоянных процессов активен');
    }
  }

  onModuleDestroy(): void {
    if (this.evictTimer) clearInterval(this.evictTimer);
    for (const s of this.sessions.values()) s.kill();
    this.sessions.clear();
  }

  /** Удобный хелпер, когда поток событий не нужен — только итог. */
  runToResult(opts: RunOptions): Promise<RunResult> {
    return this.run(opts).done;
  }

  /** Запускает один ход. Маршрутизирует в persistent-пул или one-shot по флагу. */
  run(opts: RunOptions): {
    events$: Observable<ClaudeEvent>;
    done: Promise<RunResult>;
  } {
    return this.isPersistent()
      ? this.runPersistent(opts)
      : this.runOneShot(opts);
  }

  private isPersistent(): boolean {
    return this.config.get<string>('CLAUDE_PERSISTENT', 'true') !== 'false';
  }

  // --- persistent: пул постоянных процессов ---

  private runPersistent(opts: RunOptions): {
    events$: Observable<ClaudeEvent>;
    done: Promise<RunResult>;
  } {
    const live = this.sessions.get(opts.sessionId);
    if (live && live.alive) {
      return live.send(opts.message);
    }

    const cfg = readSpawnConfig(this.config, opts.cwd);
    const maxProcs = Number(this.config.get<string>('CLAUDE_MAX_PROCS', '3'));
    if (this.sessions.size >= maxProcs) this.evictLru();

    const session = new ClaudeSession(cfg, opts.sessionId, opts.resume, (s) => {
      if (this.sessions.get(s.sessionId) === s) {
        this.sessions.delete(s.sessionId);
      }
    });
    this.sessions.set(opts.sessionId, session);
    return session.send(opts.message);
  }

  /** Выселяет самую давно не использованную НЕ занятую сессию. */
  private evictLru(): void {
    let oldest: ClaudeSession | undefined;
    for (const s of this.sessions.values()) {
      if (s.busy) continue;
      if (!oldest || s.lastUsedAt < oldest.lastUsedAt) oldest = s;
    }
    if (oldest) {
      this.log.debug(`evict LRU session ${oldest.sessionId}`);
      oldest.kill();
      this.sessions.delete(oldest.sessionId);
    }
  }

  /** Периодическое выселение простаивающих сессий. */
  private evictIdle(): void {
    const ttl = Number(this.config.get<string>('CLAUDE_IDLE_TTL_MS', '300000'));
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (!s.busy && now - s.lastUsedAt > ttl) {
        this.log.debug(`evict idle session ${s.sessionId}`);
        s.kill();
        this.sessions.delete(s.sessionId);
      }
    }
  }

  // --- one-shot: процесс на каждый ход (fallback) ---

  private runOneShot(opts: RunOptions): {
    events$: Observable<ClaudeEvent>;
    done: Promise<RunResult>;
  } {
    const subject = new Subject<ClaudeEvent>();
    const cfg = readSpawnConfig(this.config, opts.cwd);
    const args = buildArgs(cfg, {
      sessionId: opts.sessionId,
      resume: opts.resume,
      persistent: false,
    });

    this.log.debug(
      `spawn ${cfg.bin} ${args.join(' ')} (cwd=${cfg.cwd}, timeout=${cfg.timeoutMs}ms)`,
    );

    const child = spawn(cfg.bin, args, {
      cwd: cfg.cwd,
      env: buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const done = new Promise<RunResult>((resolve, reject) => {
      let final: RunResult | null = null;
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        this.log.warn(`claude timed out after ${cfg.timeoutMs}ms, killing`);
        child.kill('SIGTERM');
      }, cfg.timeoutMs);

      const onAbort = () => {
        this.log.warn('run aborted, killing claude');
        child.kill('SIGTERM');
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };

      child.stdin.on('error', (err) =>
        this.log.warn(`stdin error: ${(err as Error).message}`),
      );
      child.stdin.write(opts.message);
      child.stdin.end();

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: ClaudeEvent;
        try {
          evt = JSON.parse(trimmed) as ClaudeEvent;
        } catch {
          this.log.warn(`non-JSON stdout line skipped: ${trimmed.slice(0, 200)}`);
          return;
        }
        subject.next(evt);
        if (evt.type === 'result') {
          final = {
            text: evt.result,
            sessionId: evt.session_id,
            costUsd: evt.total_cost_usd,
            isError: evt.is_error,
          };
          if (!settled) {
            settled = true;
            cleanup();
            resolve(final);
          }
        }
      });

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        cleanup();
        if (!subject.closed) subject.error(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.on('close', (code) => {
        cleanup();
        if (!subject.closed) subject.complete();
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `claude exited ${code} without a result event. stderr: ${stderr
                .slice(-2000)
                .trim()}`,
            ),
          );
        }
      });
    });

    return { events$: subject.asObservable(), done };
  }
}
