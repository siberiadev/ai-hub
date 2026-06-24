import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Observable, Subject } from 'rxjs';
import { ClaudeEvent, RunOptions, RunResult } from './claude.types';

/**
 * Низкоуровневая обёртка над `claude` CLI.
 *
 * Запускает один ход в headless-режиме (`-p`), парсит построчный `stream-json`
 * из stdout и отдаёт наружу:
 *   - events$ — поток событий (assistant-текст, tool_use, tool_result, …);
 *   - done    — промис с финальным результатом хода.
 *
 * Сессии/очередь/Telegram реализуются поверх этого сервиса в следующих фазах.
 */
@Injectable()
export class ClaudeClientService {
  private readonly log = new Logger(ClaudeClientService.name);

  constructor(private readonly config: ConfigService) {}

  /** Удобный хелпер, когда поток событий не нужен — только итог. */
  runToResult(opts: RunOptions): Promise<RunResult> {
    return this.run(opts).done;
  }

  /**
   * Запускает один ход `claude`.
   * @returns events$ (горячий поток событий) и done (Promise с RunResult).
   */
  run(opts: RunOptions): {
    events$: Observable<ClaudeEvent>;
    done: Promise<RunResult>;
  } {
    const subject = new Subject<ClaudeEvent>();

    const bin = this.config.get<string>('CLAUDE_BIN', 'claude');
    const cwd =
      opts.cwd ?? this.config.get<string>('CLAUDE_WORKSPACE', process.cwd());
    const permissionMode = this.config.get<string>(
      'CLAUDE_PERMISSION_MODE',
      'default',
    );
    const timeoutMs = Number(
      this.config.get<string>('CLAUDE_TIMEOUT_MS', '120000'),
    );

    const args = [
      '-p',
      opts.resume ? '--resume' : '--session-id',
      opts.sessionId,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      permissionMode,
    ];

    // Окружение дочернего процесса: убираем API-ключ, чтобы не уйти в оплату по
    // токенам (он имеет приоритет над OAuth). CLAUDE_CODE_OAUTH_TOKEN, если есть
    // в окружении, пробрасывается как есть (на сервере — из systemd; локально на
    // mac не нужен — claude берёт OAuth из keychain).
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    this.log.debug(
      `spawn ${bin} ${args.join(' ')} (cwd=${cwd}, timeout=${timeoutMs}ms)`,
    );

    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const done = new Promise<RunResult>((resolve, reject) => {
      let final: RunResult | null = null;
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        this.log.warn(`claude timed out after ${timeoutMs}ms, killing`);
        child.kill('SIGTERM');
      }, timeoutMs);

      const onAbort = () => {
        this.log.warn('run aborted, killing claude');
        child.kill('SIGTERM');
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };

      // stdin: пишем сообщение и закрываем поток. Гасим EPIPE, если процесс
      // умер раньше, чем мы успели записать.
      child.stdin.on('error', (err) =>
        this.log.warn(`stdin error: ${(err as Error).message}`),
      );
      child.stdin.write(opts.message);
      child.stdin.end();

      // stdout: одна строка = один JSON-объект.
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
        }
      });

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        subject.error(err);
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        subject.complete();
        if (final) {
          resolve(final);
        } else {
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
