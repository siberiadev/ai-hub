import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Бот работает через long polling (исходящие соединения) — HTTP-сервер наружу
  // не нужен. Биндим на localhost, чтобы порт не торчал в интернет.
  const port = process.env.PORT ?? 3000;
  const host = process.env.HTTP_HOST ?? '127.0.0.1';
  await app.listen(port, host);
}
bootstrap();
