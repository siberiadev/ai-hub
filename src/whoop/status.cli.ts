// Бот не нужен — глушим до загрузки ConfigModule.
process.env.TELEGRAM_BOT_TOKEN = '';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WhoopAdminService } from './admin/whoop-admin.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const status = await app.get(WhoopAdminService, { strict: false }).status();
    const a = status.account;
    const lines = [
      '=== WHOOP status ===',
      a
        ? `account:   подключён (user ${a.whoopUserId}, токен до ${a.expiresAt.toISOString()})`
        : 'account:   НЕ подключён (пройдите /whoop/oauth/start)',
      `events:    pending=${status.events.pending} failed=${status.events.failed} processed=${status.events.processed}`,
      `rows:      workout=${status.rows.workout} sleep=${status.rows.sleep} recovery=${status.rows.recovery} cycle=${status.rows.cycle}`,
      `last sync: ${status.lastProcessedAt ? status.lastProcessedAt.toISOString() : '—'}`,
    ];
    console.log(lines.join('\n'));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('status.cli').error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
