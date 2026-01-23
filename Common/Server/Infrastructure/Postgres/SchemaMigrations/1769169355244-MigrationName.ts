import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769169355244 implements MigrationInterface {
    public name = 'MigrationName1769169355244'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Alert" DROP CONSTRAINT "FK_a8ec56304ee3dbb682be7317937"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8ec56304ee3dbb682be731793"`);
        await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "alertEpisodeId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "monitorLogRetentionInDays" integer`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_b70d3efc581792f9f7f9d93d257" UNIQUE ("monitorLogRetentionInDays")`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_b70d3efc581792f9f7f9d93d257"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "monitorLogRetentionInDays"`);
        await queryRunner.query(`ALTER TABLE "Alert" ADD "alertEpisodeId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_a8ec56304ee3dbb682be731793" ON "Alert" ("alertEpisodeId") `);
        await queryRunner.query(`ALTER TABLE "Alert" ADD CONSTRAINT "FK_a8ec56304ee3dbb682be7317937" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
