import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { cleanTranscript, TranscriptionService } from './transcription.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as unknown as jest.Mock;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = jest.fn();
}

function makeService(
  overrides: Record<string, string> = {},
): TranscriptionService {
  const merged: Record<string, string> = {
    WHISPER_ENABLED: 'true',
    WHISPER_BIN: 'whisper-cli',
    WHISPER_MODEL: '/models/ggml.bin',
    FFMPEG_BIN: 'ffmpeg',
    ...overrides,
  };
  const config = {
    get: (key: string, def?: unknown) =>
      key in merged ? merged[key] : def,
  } as unknown as ConfigService;
  return new TranscriptionService(config);
}

describe('cleanTranscript', () => {
  it('снимает таймстемпы и пустые строки', () => {
    const raw =
      '[00:00.000 --> 00:02.000]  Привет\n\n[00:02.000 --> 00:04.000]  мир\n';
    expect(cleanTranscript(raw)).toBe('Привет мир');
  });
  it('без таймстемпов — просто склейка', () => {
    expect(cleanTranscript('одна строка\n  вторая  \n')).toBe(
      'одна строка вторая',
    );
  });
  it('пустой ввод → пустая строка', () => {
    expect(cleanTranscript('\n\n')).toBe('');
  });
});

describe('TranscriptionService', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    // ffmpeg → close 0; whisper → выдаёт текст и close 0
    spawnMock.mockImplementation((bin: string) => {
      const child = new FakeChild();
      setImmediate(() => {
        if (bin === 'whisper-cli') {
          child.stdout.write('[00:00.000 --> 00:01.000]  привет из голоса\n');
        }
        child.emit('close', 0);
      });
      return child;
    });
  });

  it('enabled читается из конфига', () => {
    expect(makeService().enabled).toBe(true);
    expect(makeService({ WHISPER_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('transcribe: ffmpeg→WAV16k, whisper, возвращает чистый текст', async () => {
    const svc = makeService();
    const text = await svc.transcribe('/tmp/voice.ogg');
    expect(text).toBe('привет из голоса');

    const [ffmpegCall, whisperCall] = spawnMock.mock.calls;
    expect(ffmpegCall[0]).toBe('ffmpeg');
    expect(ffmpegCall[1]).toEqual(
      expect.arrayContaining(['-i', '/tmp/voice.ogg', '-ar', '16000', '-ac', '1']),
    );
    expect(whisperCall[0]).toBe('whisper-cli');
    expect(whisperCall[1]).toEqual(
      expect.arrayContaining(['-m', '/models/ggml.bin', '-nt']),
    );
  });

  it('reject при ненулевом коде ffmpeg', async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = new FakeChild();
      setImmediate(() => {
        child.stderr.write('boom');
        child.emit('close', 1);
      });
      return child;
    });
    await expect(makeService().transcribe('/tmp/x.ogg')).rejects.toThrow(
      /exited 1/,
    );
  });
});
