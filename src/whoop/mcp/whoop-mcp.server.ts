import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import {
  READ_TYPES,
  TREND_BUCKETS,
  TREND_METRIC_NAMES,
  buildListQuery,
  buildSummaryQueries,
  buildTrendQuery,
  computeSlopePerBucket,
  isReadType,
  isTrendBucket,
  isTrendMetric,
} from './whoop-read.queries';

/**
 * Standalone stdio MCP-сервер `whoop`: одна тула `read` отдаёт данные WHOOP из Postgres (read-only).
 * Claude видит её как `mcp__whoop__read`. ВАЖНО: stdout — только JSON-RPC, все логи → stderr.
 */

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: READ_TYPES,
      description:
        'workout|sleep|recovery|cycle — список записей; summary — краткая сводка; ' +
        'trend — агрегация метрики по корзинам (нужны metric и bucket).',
    },
    from: { type: 'string', description: 'ISO 8601 нижняя граница по времени (включительно).' },
    to: { type: 'string', description: 'ISO 8601 верхняя граница по времени (включительно).' },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      description: 'Сколько записей вернуть (по умолчанию 20). Для summary/trend игнорируется.',
    },
    metric: {
      type: 'string',
      enum: TREND_METRIC_NAMES,
      description: 'Для type=trend: какую метрику агрегировать.',
    },
    bucket: {
      type: 'string',
      enum: TREND_BUCKETS,
      description: 'Для type=trend: размер корзины (по умолчанию week).',
    },
  },
  required: ['type'],
} as const;

const BACKFILL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    since: {
      type: 'string',
      description:
        'С какой даты грузить историю (YYYY-MM-DD или ISO 8601). Без неё — вся доступная история.',
    },
  },
} as const;

/**
 * Триггерит бэкфилл на основном приложении (там есть WHOOP-токены и write-БД; сам MCP read-only).
 * Возвращается сразу — загрузка идёт в фоне. URL/секрет берём из env MCP-сервера.
 */
async function triggerBackfill(since?: string): Promise<string> {
  const base = (process.env.WHOOP_APP_URL || 'http://127.0.0.1:3000').replace(
    /\/+$/,
    '',
  );
  const secret = (process.env.WHOOP_ADMIN_SECRET || '').trim();
  if (!secret) {
    throw new Error(
      'WHOOP_ADMIN_SECRET не задан в env MCP-сервера — нечем авторизовать запуск бэкфилла.',
    );
  }
  const url = new URL(`${base}/whoop/admin/backfill`);
  url.searchParams.set('key', secret);
  if (since) url.searchParams.set('since', since);

  const res = await fetch(url, { method: 'POST' });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`приложение ответило ${res.status}: ${body || '(пусто)'}`);
  }
  return body;
}

function databaseUrl(): string {
  const raw = (
    process.env.WHOOP_MCP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
  if (!raw) {
    console.error('WHOOP_MCP_DATABASE_URL/DATABASE_URL не задан — нечем читать.');
    process.exit(1);
  }
  // sslmode задаём объектом ssl ниже (иначе свежий pg трактует require как verify-full).
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('uselibpqcompat');
    return u.toString();
  } catch {
    return raw;
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl(),
    ssl:
      (process.env.DATABASE_SSL ?? 'true') !== 'false'
        ? { rejectUnauthorized: false }
        : false,
    options: '-c default_transaction_read_only=on', // защита от записи на уровне сессии
    max: 2,
  });
  // Без обработчика 'error' у idle-клиента (обрыв соединения с БД) EventEmitter уронил бы процесс.
  pool.on('error', (err) => console.error('pg pool error:', err.message));

  const server = new Server(
    { name: 'whoop', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'read',
        description:
          'Чтение данных WHOOP пользователя из БД (тренировки, сон, восстановление, циклы, сводка). ' +
          'Только чтение. Время — UTC. Пустой массив = данных за период нет.',
        inputSchema: INPUT_SCHEMA,
      },
      {
        name: 'backfill',
        description:
          'Запускает историческую загрузку данных из WHOOP API в БД (тренировки, сон, восстановление, ' +
          'циклы). Идемпотентно (upsert). Возвращается сразу — загрузка идёт в фоне; результат смотри ' +
          'позже через read summary. Повторный запуск во время работы вернёт alreadyRunning.',
        inputSchema: BACKFILL_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === 'backfill') {
      const since = (req.params.arguments as { since?: string } | undefined)
        ?.since;
      try {
        const text = await triggerBackfill(since);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        console.error('backfill error:', err);
        return {
          content: [
            {
              type: 'text',
              text: `Не удалось запустить бэкфилл: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (req.params.name !== 'read') {
      return {
        content: [{ type: 'text', text: `Неизвестная тула: ${req.params.name}` }],
        isError: true,
      };
    }
    const args = (req.params.arguments ?? {}) as {
      type?: unknown;
      from?: string;
      to?: string;
      limit?: number;
      metric?: unknown;
      bucket?: unknown;
    };
    if (!isReadType(args.type)) {
      return {
        content: [
          { type: 'text', text: `Поле type обязательно: ${READ_TYPES.join(' | ')}` },
        ],
        isError: true,
      };
    }
    try {
      let payload: unknown;
      if (args.type === 'summary') {
        const out: Record<string, unknown> = {};
        for (const [key, q] of Object.entries(buildSummaryQueries())) {
          const { rows } = await pool.query(q.text, q.params);
          out[key] = rows[0] ?? null;
        }
        payload = out;
      } else if (args.type === 'trend') {
        if (!isTrendMetric(args.metric)) {
          return {
            content: [
              {
                type: 'text',
                text: `Для type=trend нужен metric: ${TREND_METRIC_NAMES.join(' | ')}`,
              },
            ],
            isError: true,
          };
        }
        const bucket = isTrendBucket(args.bucket) ? args.bucket : 'week';
        const q = buildTrendQuery({
          metric: args.metric,
          bucket,
          from: args.from,
          to: args.to,
        });
        const { rows } = await pool.query(q.text, q.params);
        payload = {
          metric: args.metric,
          bucket,
          from: args.from ?? null,
          to: args.to ?? null,
          points: rows,
          slope_per_bucket: computeSlopePerBucket(rows, bucket),
        };
      } else {
        const q = buildListQuery(args.type, args);
        payload = (await pool.query(q.text, q.params)).rows;
      }
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    } catch (err) {
      console.error('read error:', err);
      return {
        content: [{ type: 'text', text: `Ошибка чтения: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error('whoop MCP server готов (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
