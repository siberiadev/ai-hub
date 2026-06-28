import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { postgresSsl, postgresUrl } from './db-options';

/**
 * Слой БД для данных WHOOP (внешний Postgres, TypeORM). Подключается ТОЛЬКО когда задан
 * `DATABASE_URL` — иначе модуль превращается в no-op (бот и остальное приложение работают как
 * раньше). Это зеркалит идиому «фича выключена при пустой env» (ср. TelegramService при пустом
 * `TELEGRAM_BOT_TOKEN`), но на уровне модуля, т.к. TypeORM коннектится при регистрации.
 *
 * Sessions-БД (`SessionService`, SQLite) живёт отдельно и этим модулем не затрагивается.
 *
 * ВАЖНО: `DatabaseModule.forRoot()` должен импортироваться ПОСЛЕ `ConfigModule.forRoot()` —
 * он читает `process.env`, который наполняет ConfigModule.
 */
@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      new Logger(DatabaseModule.name).warn(
        'DATABASE_URL не задан — TypeORM/WHOOP-БД выключены.',
      );
      return { module: DatabaseModule };
    }

    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            type: 'postgres' as const,
            url: postgresUrl(),
            ssl: postgresSsl(),
            namingStrategy: new SnakeNamingStrategy(),
            // Сущности подтягивают feature-модули через TypeOrmModule.forFeature (Фаза 2+).
            autoLoadEntities: true,
            // Схему меняем только миграциями, никогда не синхронизацией.
            synchronize: false,
            // Прод: dist/database/migrations/*.js (компилируется из src/database/migrations).
            migrations: [join(__dirname, 'migrations', '*.js')],
            migrationsRun: true,
          }),
        }),
      ],
    };
  }
}
