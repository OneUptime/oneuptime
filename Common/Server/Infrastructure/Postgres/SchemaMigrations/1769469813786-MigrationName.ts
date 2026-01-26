import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769469813786 implements MigrationInterface {
    public name = 'MigrationName1769469813786'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "triggeredByAlertEpisodeId" uuid`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" ADD "triggeredByAlertEpisodeId" uuid`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD "triggeredByAlertEpisodeId" uuid`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_1fda33fffd89b95dafa537f3be" ON "OnCallDutyPolicyExecutionLogTimeline" ("triggeredByAlertEpisodeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2c98f4eeddf1d00ec073b49352" ON "UserOnCallLogTimeline" ("triggeredByAlertEpisodeId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_1fda33fffd89b95dafa537f3bef" FOREIGN KEY ("triggeredByAlertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_114aa962f2bc3c6736a1469df36" FOREIGN KEY ("triggeredByAlertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_2c98f4eeddf1d00ec073b493525" FOREIGN KEY ("triggeredByAlertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_2c98f4eeddf1d00ec073b493525"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_114aa962f2bc3c6736a1469df36"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_1fda33fffd89b95dafa537f3bef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c98f4eeddf1d00ec073b49352"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1fda33fffd89b95dafa537f3be"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "triggeredByAlertEpisodeId"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" DROP COLUMN "triggeredByAlertEpisodeId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "triggeredByAlertEpisodeId"`);
    }

}
