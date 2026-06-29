import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import {
  READ_TYPES,
  buildQuery,
  buildSummaryQueries,
  isReadType,
  type ReadArgs,
} from './finance-read.queries';

/**
 * Standalone stdio MCP-сервер `finance`: одна тула `query` отдаёт аналитику леджера
 * банковских выписок из Postgres (read-only). Claude видит её как `mcp__finance__query`.
 * ВАЖНО: stdout — только JSON-RPC, все логи → stderr.
 */

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: READ_TYPES,
      description:
        'summary — итоги доход/расход; monthly — по месяцам; by_category — расходы по ' +
        'категориям с долей; category_month — категория×месяц; top_merchants — крупнейшие ' +
        'получатели; transactions — список операций; income — поступления. Расходы считаются ' +
        'без alipay_funding и переводов (нет задвоения с Alipay).',
    },
    from: {
      type: 'string',
      description: 'Нижняя граница txn_date (YYYY-MM-DD, включительно).',
    },
    to: {
      type: 'string',
      description: 'Верхняя граница txn_date (YYYY-MM-DD, включительно).',
    },
    source: {
      type: 'string',
      enum: ['mox', 'standard_chartered', 'alipay'],
      description: 'Фильтр по источнику.',
    },
    category: {
      type: 'string',
      description:
        'Фильтр по названию категории (для transactions/by_category).',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 500,
      description:
        'Сколько строк вернуть для списков (transactions/top_merchants/income).',
    },
  },
  required: ['type'],
} as const;

function databaseUrl(): string {
  const raw = (
    process.env.FINANCE_MCP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
  if (!raw) {
    console.error(
      'FINANCE_MCP_DATABASE_URL/DATABASE_URL не задан — нечем читать.',
    );
    process.exit(1);
  }
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
    options: '-c default_transaction_read_only=on',
    max: 2,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));

  const server = new Server(
    { name: 'finance', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'query',
        description:
          'Аналитика расходов/доходов из банковских выписок (Mox, Standard Chartered, Alipay HK). ' +
          'Только чтение. Суммы в HKD. Пустой массив = данных за период нет.',
        inputSchema: INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'query') {
      return {
        content: [
          { type: 'text', text: `Неизвестная тула: ${req.params.name}` },
        ],
        isError: true,
      };
    }
    const args = (req.params.arguments ?? {}) as ReadArgs & { type?: unknown };
    if (!isReadType(args.type)) {
      return {
        content: [
          {
            type: 'text',
            text: `Поле type обязательно: ${READ_TYPES.join(' | ')}`,
          },
        ],
        isError: true,
      };
    }
    try {
      let payload: unknown;
      if (args.type === 'summary') {
        const out: Record<string, unknown> = {};
        for (const [key, q] of Object.entries(buildSummaryQueries(args))) {
          const { rows } = await pool.query(q.text, q.params);
          out[key] = key === 'totals' ? (rows[0] ?? null) : rows;
        }
        payload = out;
      } else {
        const q = buildQuery(args.type, args);
        payload = (await pool.query(q.text, q.params)).rows;
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      console.error('query error:', err);
      return {
        content: [
          { type: 'text', text: `Ошибка чтения: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error('finance MCP server готов (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
