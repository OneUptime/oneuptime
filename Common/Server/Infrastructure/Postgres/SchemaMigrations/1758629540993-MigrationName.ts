import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1758629540993 implements MigrationInterface {
    public name = 'MigrationName1758629540993'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP COLUMN "ruleType"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD "ruleType" character varying(500) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ef7342919ff02501c2b0ddc029" ON "TeamComplianceSetting" ("teamId", "ruleType") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ef7342919ff02501c2b0ddc029"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP COLUMN "ruleType"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD "ruleType" character varying(100) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
    }

}
