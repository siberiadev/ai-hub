import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NOTIFIER } from '../../notify/notifier';
import type { Notifier } from '../../notify/notifier';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';

/**
 * Мониторинг пайплайна WHOOP: периодически считает failed-события и алертит владельцу (через Notifier)
 * при их росте. Debounce — алерт только когда число выросло (не на каждом тике).
 */
@Injectable()
export class WhoopMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhoopMonitorService.name);
  private timer?: NodeJS.Timeout;
  private lastAlerted = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(WhoopWebhookEvent)
    private readonly events: Repository<WhoopWebhookEvent>,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  onModuleInit(): void {
    const sec = Number(
      this.config.get<string>('WHOOP_MONITOR_INTERVAL_SEC', '300'),
    );
    this.timer = setInterval(() => void this.checkFailures(), sec * 1000);
    this.timer.unref?.();
    this.log.log(`monitor started (interval ${sec}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Считает failed; при росте относительно прошлого алерта — уведомляет владельца. */
  async checkFailures(): Promise<void> {
    const failed = await this.events.count({ where: { status: 'failed' } });
    if (failed > this.lastAlerted) {
      await this.notifier.notifyOwner(
        `⚠️ WHOOP: ${failed} событий не обработались (failed).\n` +
          `Диагностика: npm run whoop:status · вернуть в очередь: npm run whoop:requeue`,
      );
      this.log.warn(`failed=${failed} — отправлен алерт владельцу`);
    }
    this.lastAlerted = failed;
  }
}
