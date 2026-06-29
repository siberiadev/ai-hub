import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategorizationService } from './categorize/categorization.service';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceCategoryRule } from './entities/finance-category-rule.entity';
import { FinanceMerchant } from './entities/finance-merchant.entity';
import { FinanceStatement } from './entities/finance-statement.entity';
import { FinanceTransaction } from './entities/finance-transaction.entity';
import { FINANCE_IMPORT } from './finance.types';
import { FinanceImportService } from './import/finance-import.service';

/**
 * Финансовый модуль: импорт банковских выписок (PDF) → нормализованный леджер.
 * Грузится только при заданном `DATABASE_URL` (нужны TypeORM-репозитории), как и
 * WhoopModule. Объявлен `global`, чтобы токен FINANCE_IMPORT инъектировался в
 * TelegramService через @Optional() без импорта этого модуля (и без graceful-off
 * костылей, когда БД не настроена — тогда токена просто нет).
 */
@Module({})
export class FinanceModule {
  static forRoot(): DynamicModule {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      new Logger(FinanceModule.name).warn(
        'DATABASE_URL не задан — финансовый модуль выключен.',
      );
      return { module: FinanceModule, global: true };
    }
    return {
      module: FinanceModule,
      global: true,
      imports: [
        TypeOrmModule.forFeature([
          FinanceAccount,
          FinanceCategory,
          FinanceCategoryRule,
          FinanceMerchant,
          FinanceStatement,
          FinanceTransaction,
        ]),
      ],
      providers: [
        CategorizationService,
        FinanceImportService,
        { provide: FINANCE_IMPORT, useExisting: FinanceImportService },
      ],
      exports: [FINANCE_IMPORT],
    };
  }
}
