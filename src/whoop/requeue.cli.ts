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
    const n = await app.get(WhoopAdminService, { strict: false }).requeueFailed();
    console.log(`Возвращено в очередь (failed→pending): ${n}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('requeue.cli').error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
