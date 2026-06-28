import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { WhoopSignatureGuard } from './whoop-signature.guard';
import { WhoopWebhookService } from './whoop-webhook.service';
import type { WhoopWebhookPayload } from './whoop-webhook.types';

/** Приём вебхуков WHOOP. Подпись проверяет guard; тело сразу кладётся в очередь, ответ — 200. */
@Controller('whoop')
@UseGuards(WhoopSignatureGuard)
export class WhoopWebhookController {
  constructor(private readonly service: WhoopWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() payload: WhoopWebhookPayload,
  ): Promise<{ received: boolean }> {
    await this.service.record(payload);
    return { received: true };
  }
}
