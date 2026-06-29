import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Таблица планировщика: задачи-промпты (разовые и повторяющиеся по cron), которые тикер
 * SchedulerService забирает по `next_run_at` и шлёт в Claude. Хенд-крафт, как WhoopInit.
 */
export class CreateScheduledTask1783100000000 implements MigrationInterface {
  name = 'CreateScheduledTask1783100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "scheduled_task" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "title" character varying NOT NULL,
      "prompt" text NOT NULL,
      "cron" character varying,
      "timezone" character varying NOT NULL DEFAULT 'UTC',
      "end_at" TIMESTAMP WITH TIME ZONE,
      "max_runs" integer,
      "run_count" integer NOT NULL DEFAULT 0,
      "status" character varying NOT NULL DEFAULT 'active',
      "next_run_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "last_run_at" TIMESTAMP WITH TIME ZONE,
      "last_status" character varying,
      "last_error" text,
      "running" boolean NOT NULL DEFAULT false,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scheduled_task" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_scheduled_task_status_next_run_at" ON "scheduled_task" ("status", "next_run_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_scheduled_task_status_next_run_at"`);
    await q.query(`DROP TABLE "scheduled_task"`);
  }
}
