import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhoopWebhookEvent } from '../entities/whoop-webhook-event.entity';
import type { WhoopWebhookPayload } from './whoop-webhook.types';

/** Приём вебхуков в журнал-очередь `whoop_webhook_event` с дедупом по trace_id. */
@Injectable()
export class WhoopWebhookService {
  private readonly log = new Logger(WhoopWebhookService.name);

  constructor(
    @InjectRepository(WhoopWebhookEvent)
    private readonly events: Repository<WhoopWebhookEvent>,
  ) {}

  /** Идемпотентно сохраняет событие (status=pending). Повтор trace_id игнорируется. */
  async record(payload: WhoopWebhookPayload): Promise<void> {
    const result = await this.events
      .createQueryBuilder()
      .insert()
      .into(WhoopWebhookEvent)
      .values({
        traceId: payload.trace_id,
        type: payload.type,
        whoopUserId: String(payload.user_id),
        resourceId: String(payload.id),
        raw: payload,
      })
      .orIgnore() // ON CONFLICT (trace_id) DO NOTHING
      .execute();

    const inserted = (result.raw as unknown[]).length > 0;
    this.log.log(
      `вебхук ${payload.type} trace=${payload.trace_id} → ${inserted ? 'принят (pending)' : 'дубль, игнор'}`,
    );
  }
}
