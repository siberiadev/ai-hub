import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SEED_ACCOUNTS,
  SEED_CATEGORIES,
  SEED_RULES,
} from '../../finance/categorize/category-rules.seed';

/**
 * Финансовый модуль: 6 таблиц fin_* (леджер банковских выписок) + сид справочников
 * (счета, категории, правила категоризации). Хенд-крафт, как WhoopInit.
 */
export class FinanceInit1783000000000 implements MigrationInterface {
  name = 'FinanceInit1783000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---- dimensions ----
    await q.query(`CREATE TABLE "fin_account" (
      "id" SERIAL NOT NULL,
      "source" character varying NOT NULL,
      "bank" character varying NOT NULL,
      "account_no" character varying,
      "base_currency" character varying NOT NULL DEFAULT 'HKD',
      "label" character varying,
      CONSTRAINT "UQ_fin_account_source" UNIQUE ("source"),
      CONSTRAINT "PK_fin_account" PRIMARY KEY ("id"))`);

    await q.query(`CREATE TABLE "fin_category" (
      "id" SERIAL NOT NULL,
      "name" character varying NOT NULL,
      "kind" character varying NOT NULL,
      CONSTRAINT "UQ_fin_category_name" UNIQUE ("name"),
      CONSTRAINT "PK_fin_category" PRIMARY KEY ("id"))`);

    await q.query(`CREATE TABLE "fin_merchant" (
      "id" SERIAL NOT NULL,
      "norm_name" character varying NOT NULL,
      "display" character varying NOT NULL,
      "category_id" integer,
      CONSTRAINT "UQ_fin_merchant_norm_name" UNIQUE ("norm_name"),
      CONSTRAINT "PK_fin_merchant" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_fin_merchant_category" ON "fin_merchant" ("category_id")`,
    );

    await q.query(`CREATE TABLE "fin_category_rule" (
      "id" SERIAL NOT NULL,
      "priority" integer NOT NULL,
      "rule_type" character varying NOT NULL,
      "pattern" text NOT NULL,
      "category_id" integer,
      "txn_class" character varying,
      "enabled" boolean NOT NULL DEFAULT true,
      CONSTRAINT "PK_fin_category_rule" PRIMARY KEY ("id"))`);

    // ---- statement (one per uploaded PDF) ----
    await q.query(`CREATE TABLE "fin_statement" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "source" character varying NOT NULL,
      "bank" character varying NOT NULL,
      "account_no" character varying,
      "file_hash" character varying NOT NULL,
      "file_name" character varying,
      "period_start" date,
      "period_end" date,
      "statement_date" date,
      "status" character varying NOT NULL,
      "txn_count" integer NOT NULL DEFAULT 0,
      "total_in_hkd" numeric(14,2) NOT NULL DEFAULT 0,
      "total_out_hkd" numeric(14,2) NOT NULL DEFAULT 0,
      "reconciled" boolean NOT NULL DEFAULT false,
      "issues" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_fin_statement_file_hash" UNIQUE ("file_hash"),
      CONSTRAINT "PK_fin_statement" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_fin_statement_source" ON "fin_statement" ("source")`,
    );

    // ---- transaction (the ledger) ----
    await q.query(`CREATE TABLE "fin_transaction" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "statement_id" uuid,
      "source" character varying NOT NULL,
      "account_no" character varying,
      "txn_date" date,
      "txn_time" time,
      "settle_date" date,
      "currency" character varying NOT NULL DEFAULT 'HKD',
      "amount" numeric(14,2) NOT NULL,
      "amount_hkd" numeric(14,2) NOT NULL,
      "direction" character varying NOT NULL,
      "txn_class" character varying NOT NULL,
      "description_raw" text,
      "merchant_id" integer,
      "original_amount" numeric(14,2),
      "original_currency" character varying,
      "balance_after" numeric(14,2),
      "txn_no" character varying,
      "is_alipay_funding" boolean NOT NULL DEFAULT false,
      "is_internal" boolean NOT NULL DEFAULT false,
      "dedupe_key" character varying NOT NULL,
      "raw" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_fin_transaction_dedupe_key" UNIQUE ("dedupe_key"),
      CONSTRAINT "PK_fin_transaction" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_fin_transaction_statement" ON "fin_transaction" ("statement_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_fin_transaction_date" ON "fin_transaction" ("txn_date")`,
    );
    await q.query(
      `CREATE INDEX "IDX_fin_transaction_source" ON "fin_transaction" ("source")`,
    );
    await q.query(
      `CREATE INDEX "IDX_fin_transaction_class" ON "fin_transaction" ("txn_class")`,
    );
    await q.query(
      `CREATE INDEX "IDX_fin_transaction_merchant" ON "fin_transaction" ("merchant_id")`,
    );

    // ---- seed dimensions ----
    for (const a of SEED_ACCOUNTS) {
      await q.query(
        `INSERT INTO "fin_account" (source, bank, account_no, base_currency, label) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source) DO NOTHING`,
        [a.source, a.bank, a.accountNo, a.baseCurrency, a.label],
      );
    }
    for (const c of SEED_CATEGORIES) {
      await q.query(
        `INSERT INTO "fin_category" (name, kind) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
        [c.name, c.kind],
      );
    }
    for (const r of SEED_RULES) {
      await q.query(
        `INSERT INTO "fin_category_rule" (priority, rule_type, pattern, category_id, txn_class, enabled)
         VALUES ($1,$2,$3,(SELECT id FROM "fin_category" WHERE name=$4),$5,true)`,
        [r.priority, r.ruleType, r.pattern, r.category, r.txnClass],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "fin_transaction"`);
    await q.query(`DROP TABLE "fin_statement"`);
    await q.query(`DROP TABLE "fin_category_rule"`);
    await q.query(`DROP TABLE "fin_merchant"`);
    await q.query(`DROP TABLE "fin_category"`);
    await q.query(`DROP TABLE "fin_account"`);
  }
}
