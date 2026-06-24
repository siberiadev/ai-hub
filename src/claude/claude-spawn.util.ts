import { ConfigService } from '@nestjs/config';
import { ASK_SYSTEM_PROMPT } from './ask-protocol';

/** Разрешённые параметры запуска claude, прочитанные из конфига. */
export interface SpawnConfig {
  bin: string;
  cwd: string;
  permissionMode: string;
  timeoutMs: number;
  strictMcp: boolean;
  mcpConfig: string;
  askEnabled: boolean;
}

/** Считывает параметры запуска из ConfigService (cwdOverride — из RunOptions.cwd). */
export function readSpawnConfig(
  config: ConfigService,
  cwdOverride?: string,
): SpawnConfig {
  return {
    bin: config.get<string>('CLAUDE_BIN', 'claude'),
    cwd: cwdOverride ?? config.get<string>('CLAUDE_WORKSPACE', process.cwd()),
    permissionMode: config.get<string>('CLAUDE_PERMISSION_MODE', 'default'),
    timeoutMs: Number(config.get<string>('CLAUDE_TIMEOUT_MS', '120000')),
    strictMcp: config.get<string>('CLAUDE_STRICT_MCP', 'false') === 'true',
    mcpConfig: config.get<string>('CLAUDE_MCP_CONFIG', ''),
    askEnabled: config.get<string>('CLAUDE_ASK_ENABLED', 'true') !== 'false',
  };
}

/** Собирает аргументы `claude`. persistent=true добавляет `--input-format stream-json`. */
export function buildArgs(
  cfg: SpawnConfig,
  opts: { sessionId: string; resume: boolean; persistent: boolean },
): string[] {
  const args = [
    '-p',
    opts.resume ? '--resume' : '--session-id',
    opts.sessionId,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    cfg.permissionMode,
  ];
  if (opts.persistent) {
    args.push('--input-format', 'stream-json');
  }
  if (cfg.askEnabled) {
    args.push('--append-system-prompt', ASK_SYSTEM_PROMPT);
  }
  if (cfg.strictMcp) {
    args.push('--strict-mcp-config');
    if (cfg.mcpConfig) args.push('--mcp-config', cfg.mcpConfig);
  }
  return args;
}

/**
 * Окружение дочернего процесса: убираем ANTHROPIC_API_KEY, чтобы не уйти в оплату
 * по токенам (он имеет приоритет над OAuth). CLAUDE_CODE_OAUTH_TOKEN пробрасываем как есть.
 */
export function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/** Формирует строку user-сообщения для stream-json input. */
export function userMessageLine(message: string): string {
  return (
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: message }] },
    }) + '\n'
  );
}
