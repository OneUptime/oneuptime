import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1741908200702 implements MigrationInterface {
    public name = 'MigrationName1741908200702'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b0bdac6c10d7ed30e696aded2c"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyUserOverride" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyUserOverride" DROP COLUMN "description"`);
       
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
       
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyUserOverride" ADD "description" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyUserOverride" ADD "name" character varying(100) NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_b0bdac6c10d7ed30e696aded2c" ON "OnCallDutyPolicyUserOverride" ("name") `);
    }

}
