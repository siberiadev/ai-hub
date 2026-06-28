// Бот не нужен во время backfill — глушим до загрузки ConfigModule (dotenv не перезапишет process.env).
process.env.TELEGRAM_BOT_TOKEN = '';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BACKFILL_ALL_SINCE, WhoopBackfill } from './sync/whoop-backfill';

/** Парсит `--since YYYY-MM-DD` → ISO; иначе вся история. */
function parseSince(argv: string[]): string {
  const i = argv.indexOf('--since');
  if (i >= 0 && argv[i + 1]) return new Date(argv[i + 1]).toISOString();
  return BACKFILL_ALL_SINCE;
}

async function main(): Promise<void> {
  const since = parseSince(process.argv);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const backfill = app.get(WhoopBackfill, { strict: false });
    await backfill.run(since);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('backfill.cli').error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
