import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // rawBody нужен для проверки HMAC-подписи вебхуков WHOOP (Fastify кладёт req.rawBody).
    { rawBody: true },
  );
  // Бот работает через long polling (исходящие соединения) — HTTP-сервер наружу
  // не нужен. Биндим на localhost, чтобы порт не торчал в интернет.
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HTTP_HOST ?? '127.0.0.1';
  await app.listen(port, host);
}
bootstrap();
