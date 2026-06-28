import { MigrationInterface, QueryRunner } from "typeorm";

export class WhoopInit1782371859509 implements MigrationInterface {
    name = 'WhoopInit1782371859509'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "whoop_workout" ("id" uuid NOT NULL, "whoop_user_id" bigint NOT NULL, "v1_id" integer, "start" TIMESTAMP WITH TIME ZONE NOT NULL, "end" TIMESTAMP WITH TIME ZONE, "timezone_offset" character varying, "sport_id" integer, "sport_name" character varying, "score_state" character varying NOT NULL, "strain" double precision, "average_heart_rate" integer, "max_heart_rate" integer, "kilojoule" double precision, "percent_recorded" double precision, "distance_meter" double precision, "altitude_gain_meter" double precision, "altitude_change_meter" double precision, "zone_zero_milli" integer, "zone_one_milli" integer, "zone_two_milli" integer, "zone_three_milli" integer, "zone_four_milli" integer, "zone_five_milli" integer, "whoop_created_at" TIMESTAMP WITH TIME ZONE, "whoop_updated_at" TIMESTAMP WITH TIME ZONE, "raw" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_35fa7792074f8833bdb3dab710a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0dc927f32561e51bcc74128a7c" ON "whoop_workout" ("whoop_user_id", "start") `);
        await queryRunner.query(`CREATE TABLE "whoop_webhook_event" ("id" BIGSERIAL NOT NULL, "trace_id" character varying NOT NULL, "type" character varying NOT NULL, "whoop_user_id" bigint, "resource_id" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "error" text, "raw" jsonb, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_998bd349db25672fccb232f024a" UNIQUE ("trace_id"), CONSTRAINT "PK_9931964d7fc172b89b656fac121" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ea11bbbd75512a76585d730ce3" ON "whoop_webhook_event" ("status", "received_at") `);
        await queryRunner.query(`CREATE TABLE "whoop_sleep" ("id" uuid NOT NULL, "whoop_user_id" bigint NOT NULL, "cycle_id" bigint, "v1_id" integer, "nap" boolean NOT NULL DEFAULT false, "start" TIMESTAMP WITH TIME ZONE NOT NULL, "end" TIMESTAMP WITH TIME ZONE, "timezone_offset" character varying, "score_state" character varying NOT NULL, "respiratory_rate" double precision, "sleep_performance_percentage" integer, "sleep_consistency_percentage" integer, "sleep_efficiency_percentage" double precision, "total_in_bed_time_milli" integer, "total_awake_time_milli" integer, "total_no_data_time_milli" integer, "total_light_sleep_time_milli" integer, "total_slow_wave_sleep_time_milli" integer, "total_rem_sleep_time_milli" integer, "sleep_cycle_count" integer, "disturbance_count" integer, "baseline_milli" integer, "need_from_sleep_debt_milli" integer, "need_from_recent_strain_milli" integer, "need_from_recent_nap_milli" integer, "whoop_created_at" TIMESTAMP WITH TIME ZONE, "whoop_updated_at" TIMESTAMP WITH TIME ZONE, "raw" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eb3f43ca43df7aa638bd7a6a0ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d9350799425a8761f4af0f27e2" ON "whoop_sleep" ("whoop_user_id", "start") `);
        await queryRunner.query(`CREATE TABLE "whoop_recovery" ("sleep_id" uuid NOT NULL, "cycle_id" bigint NOT NULL, "whoop_user_id" bigint NOT NULL, "score_state" character varying NOT NULL, "user_calibrating" boolean, "recovery_score" integer, "resting_heart_rate" integer, "hrv_rmssd_milli" double precision, "spo2_percentage" double precision, "skin_temp_celsius" double precision, "whoop_created_at" TIMESTAMP WITH TIME ZONE, "whoop_updated_at" TIMESTAMP WITH TIME ZONE, "raw" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_695558c49c4c31680820ba5371b" PRIMARY KEY ("sleep_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1c580868460091ff6aae4b3b7b" ON "whoop_recovery" ("cycle_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_c778085825a1f6541e864ef2f1" ON "whoop_recovery" ("whoop_user_id") `);
        await queryRunner.query(`CREATE TABLE "whoop_cycle" ("id" bigint NOT NULL, "whoop_user_id" bigint NOT NULL, "start" TIMESTAMP WITH TIME ZONE NOT NULL, "end" TIMESTAMP WITH TIME ZONE, "timezone_offset" character varying, "score_state" character varying NOT NULL, "strain" double precision, "kilojoule" double precision, "average_heart_rate" integer, "max_heart_rate" integer, "whoop_created_at" TIMESTAMP WITH TIME ZONE, "whoop_updated_at" TIMESTAMP WITH TIME ZONE, "raw" jsonb, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d35d27d9202aa105d3d4b46bda0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_62b531694e3a6c524921cb581c" ON "whoop_cycle" ("whoop_user_id", "start") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_62b531694e3a6c524921cb581c"`);
        await queryRunner.query(`DROP TABLE "whoop_cycle"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c778085825a1f6541e864ef2f1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1c580868460091ff6aae4b3b7b"`);
        await queryRunner.query(`DROP TABLE "whoop_recovery"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9350799425a8761f4af0f27e2"`);
        await queryRunner.query(`DROP TABLE "whoop_sleep"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ea11bbbd75512a76585d730ce3"`);
        await queryRunner.query(`DROP TABLE "whoop_webhook_event"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0dc927f32561e51bcc74128a7c"`);
        await queryRunner.query(`DROP TABLE "whoop_workout"`);
    }

}
