import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Чистит вывод whisper-cli: убирает строки-таймстемпы `[00:00.000 --> 00:02.000]`
 * (на случай запуска без `-nt`), пустые строки и схлопывает пробелы.
 */
export function cleanTranscript(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]*-->[^\]]*\]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Локальный STT: ffmpeg (любой формат → WAV 16k mono) + whisper.cpp subprocess → текст.
 * Транскрипции сериализуются глобально (один whisper одновременно) — защита RAM дроплета.
 * Telegram-агностичен: на вход путь к аудиофайлу.
 */
@Injectable()
export class TranscriptionService {
  private readonly log = new Logger(TranscriptionService.name);
  /** Глобальная цепочка: один whisper за раз. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  /** Включено ли распознавание (нужны установленные ffmpeg/whisper/модель). */
  get enabled(): boolean {
    return this.config.get<string>('WHISPER_ENABLED', 'false') === 'true';
  }

  /** Транскрибирует аудиофайл. Сериализуется глобально. */
  transcribe(audioPath: string): Promise<string> {
    const run = this.chain
      .catch(() => undefined)
      .then(() => this.runTranscription(audioPath));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runTranscription(audioPath: string): Promise<string> {
    const ffmpegBin = this.config.get<string>('FFMPEG_BIN', 'ffmpeg');
    const whisperBin = this.config.get<string>('WHISPER_BIN', 'whisper-cli');
    const model = this.config.get<string>('WHISPER_MODEL', '');
    const lang = this.config.get<string>('WHISPER_LANG', 'auto');
    const threads = this.config.get<string>('WHISPER_THREADS', '2');
    const timeoutMs = Number(
      this.config.get<string>('WHISPER_TIMEOUT_MS', '120000'),
    );

    const wavPath = join(tmpdir(), `aihub-${randomUUID()}.wav`);
    try {
      await this.exec(
        ffmpegBin,
        ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath],
        timeoutMs,
      );
      const stdout = await this.exec(
        whisperBin,
        ['-m', model, '-f', wavPath, '-l', lang, '-nt', '-t', threads],
        timeoutMs,
      );
      return cleanTranscript(stdout);
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  }

  /** Запускает процесс, копит stdout, ждёт exit 0 (иначе reject). Таймаут → kill. */
  private exec(bin: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        this.log.warn(`${bin} timed out after ${timeoutMs}ms, killing`);
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else
          reject(
            new Error(`${bin} exited ${code}: ${err.slice(-500).trim()}`),
          );
      });
    });
  }
}
