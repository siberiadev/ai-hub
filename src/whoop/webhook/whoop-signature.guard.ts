import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const SIG_HEADER = 'x-whoop-signature';
const TS_HEADER = 'x-whoop-signature-timestamp';

/**
 * Проверка подлинности вебхука WHOOP: `base64(HMAC_SHA256(timestamp + rawBody, secret))` ==
 * заголовок `X-WHOOP-Signature`, плюс анти-replay по `X-WHOOP-Signature-Timestamp`.
 * Секрет: WHOOP_WEBHOOK_SECRET, иначе WHOOP_CLIENT_SECRET. Требует rawBody (включён в main.ts).
 */
@Injectable()
export class WhoopSignatureGuard implements CanActivate {
  private readonly log = new Logger(WhoopSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<RawBodyRequest<FastifyRequest>>();
    const signature = this.header(req, SIG_HEADER);
    const timestamp = this.header(req, TS_HEADER);
    const rawBody = req.rawBody;

    if (!signature || !timestamp || !rawBody) {
      throw new UnauthorizedException('Отсутствует подпись/тело вебхука WHOOP.');
    }

    // Анти-replay: WHOOP подписывает каждую доставку свежим timestamp.
    const toleranceMs =
      Number(this.config.get<string>('WHOOP_WEBHOOK_TOLERANCE_SEC', '300')) *
      1000;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > toleranceMs) {
      throw new UnauthorizedException('Просроченный timestamp вебхука WHOOP.');
    }

    const secret =
      this.config.get<string>('WHOOP_WEBHOOK_SECRET')?.trim() ||
      this.config.getOrThrow<string>('WHOOP_CLIENT_SECRET');
    const expected = createHmac('sha256', secret)
      .update(timestamp)
      .update(rawBody)
      .digest('base64');

    if (!this.safeEqual(expected, signature)) {
      throw new UnauthorizedException('Неверная подпись вебхука WHOOP.');
    }
    return true;
  }

  private header(req: FastifyRequest, name: string): string | undefined {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  }

  /** Сравнение в постоянное время; разная длина → false (timingSafeEqual бросает на разной длине). */
  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
