import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Standalone stdio MCP-сервер `scheduler`: Claude управляет задачами планировщика.
 * Сам сервер тонкий — все операции идут HTTP-запросом на основное приложение (там БД и валидация),
 * как `backfill` в whoop-mcp. Claude видит тулы как `mcp__scheduler__*`.
 * ВАЖНО: stdout — только JSON-RPC, все логи → stderr.
 */

function appBase(): string {
  return (process.env.SCHEDULER_APP_URL || 'http://127.0.0.1:3000').replace(
    /\/+$/,
    '',
  );
}

function adminSecret(): string {
  const secret = (process.env.SCHEDULER_ADMIN_SECRET || '').trim();
  if (!secret) {
    throw new Error('SCHEDULER_ADMIN_SECRET не задан в env MCP-сервера.');
  }
  return secret;
}

/** Запрос к /scheduler/tasks с ключом; тело — для POST/PATCH. */
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<string> {
  const url = new URL(`${appBase()}/scheduler/tasks${path}`);
  url.searchParams.set('key', adminSecret());
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`приложение ответило ${res.status}: ${text || '(пусто)'}`);
  }
  return text;
}

const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Короткое имя задачи (показывается при доставке).',
    },
    prompt: {
      type: 'string',
      description:
        'Промпт, который будет отправлен Claude при срабатывании (в свежей сессии).',
    },
    cron: {
      type: 'string',
      description:
        'Cron-выражение (5 полей) для ПОВТОРЯЮЩЕЙСЯ задачи. Примеры: "0 8 * * *" — каждый день в 08:00; ' +
        '"0 */2 * * *" — каждые 2 часа; "0 9 * * 1" — по понедельникам в 09:00. Указывай ЛИБО cron, ЛИБО runAt.',
    },
    runAt: {
      type: 'string',
      description:
        'ISO 8601 дата-время для РАЗОВОЙ задачи (напоминание). Резолви относительные даты ' +
        '("в пятницу", "завтра в 9") в конкретную дату от текущего момента. Указывай ЛИБО runAt, ЛИБО cron.',
    },
    timezone: {
      type: 'string',
      description:
        'IANA-таймзона для расчёта cron (например "Europe/Berlin"). По умолчанию UTC.',
    },
    endAt: {
      type: 'string',
      description:
        'ISO 8601: прекратить повторения после этой даты (только с cron).',
    },
    maxRuns: {
      type: 'integer',
      minimum: 1,
      description: 'Прекратить после N срабатываний (только с cron).',
    },
  },
  required: ['title', 'prompt'],
} as const;

const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID задачи (из schedule_list).' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    cron: {
      type: 'string',
      description: 'Новое cron-выражение (пересчитает ближайший запуск).',
    },
    runAt: { type: 'string', description: 'Новая ISO-дата разового запуска.' },
    timezone: { type: 'string' },
    endAt: { type: 'string' },
    maxRuns: { type: 'integer', minimum: 1 },
    status: {
      type: 'string',
      enum: ['active', 'paused'],
      description: 'Пауза/возобновление.',
    },
  },
  required: ['id'],
} as const;

const ID_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string', description: 'UUID задачи.' } },
  required: ['id'],
} as const;

async function main(): Promise<void> {
  const server = new Server(
    { name: 'scheduler', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'schedule_create',
        description:
          'Создать задачу планировщика. Два режима: РАЗОВАЯ (передай runAt — ISO дата-время, ' +
          'выполнится один раз) или ПОВТОРЯЮЩАЯСЯ (передай cron, опц. endAt/maxRuns как стоп-условия). ' +
          'Результат прогона приходит владельцу в Telegram.',
        inputSchema: CREATE_SCHEMA,
      },
      {
        name: 'schedule_list',
        description:
          'Список задач планировщика (id, title, cron/runAt, status, ближайший запуск, runCount, последний исход).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'schedule_update',
        description:
          'Изменить задачу по id: промпт, расписание (cron/runAt), таймзону, стоп-условия или статус (active/paused).',
        inputSchema: UPDATE_SCHEMA,
      },
      {
        name: 'schedule_delete',
        description: 'Удалить задачу по id (насовсем).',
        inputSchema: ID_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    try {
      let text: string;
      switch (req.params.name) {
        case 'schedule_create':
          text = await call('POST', '', args);
          break;
        case 'schedule_list':
          text = await call('GET', '');
          break;
        case 'schedule_update': {
          const { id, ...rest } = args;
          text = await call(
            'PATCH',
            `/${encodeURIComponent(String(id))}`,
            rest,
          );
          break;
        }
        case 'schedule_delete':
          text = await call(
            'DELETE',
            `/${encodeURIComponent(String(args.id))}`,
          );
          break;
        default:
          return {
            content: [
              { type: 'text', text: `Неизвестная тула: ${req.params.name}` },
            ],
            isError: true,
          };
      }
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      console.error(`${req.params.name} error:`, err);
      return {
        content: [{ type: 'text', text: `Ошибка: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error('scheduler MCP server готов (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
