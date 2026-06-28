import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWhoopAccount1782639430350 implements MigrationInterface {
    name = 'AddWhoopAccount1782639430350'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "whoop_account" ("whoop_user_id" bigint NOT NULL, "access_token_enc" text NOT NULL, "refresh_token_enc" text, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "scopes" character varying, "token_type" character varying, "email" character varying, "first_name" character varying, "last_name" character varying, "connected_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7af493c752e0c7d156a499bba58" PRIMARY KEY ("whoop_user_id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "whoop_account"`);
    }

}
