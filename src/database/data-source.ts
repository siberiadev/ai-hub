import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { postgresSsl, postgresUrl } from './db-options';

/**
 * Отдельный `DataSource` для TypeORM CLI (миграции). Не участвует в Nest DI — читает `.env`
 * напрямую через `dotenv/config`. Используется npm-скриптами `migration:*`
 * (bin `typeorm-ts-node-commonjs -d src/database/data-source.ts`).
 *
 * Рантайм-подключение приложения настраивается отдельно в DatabaseModule.forRoot().
 */
export default new DataSource({
  type: 'postgres',
  url: postgresUrl(),
  ssl: postgresSsl(),
  namingStrategy: new SnakeNamingStrategy(),
  // Глоб для migration:generate (сравнение со схемой) — сущности появятся в Фазе 2.
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
