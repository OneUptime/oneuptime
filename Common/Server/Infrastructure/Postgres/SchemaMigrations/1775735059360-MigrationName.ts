import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1775735059360 implements MigrationInterface {
    name = 'MigrationName1775735059360'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_SERVICE_PROJECT_NAME_UNIQUE"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "Workflow" DROP COLUMN "webhookSecretKey"`);
        await queryRunner.query(`ALTER TABLE "Workflow" ADD "webhookSecretKey" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Workflow" DROP COLUMN "webhookSecretKey"`);
        await queryRunner.query(`ALTER TABLE "Workflow" ADD "webhookSecretKey" text`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_SERVICE_PROJECT_NAME_UNIQUE" ON "Service" ("projectId") WHERE ("deletedAt" IS NULL)`);
    }

}
