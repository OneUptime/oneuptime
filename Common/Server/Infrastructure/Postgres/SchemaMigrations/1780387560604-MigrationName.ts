import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1780387560604 implements MigrationInterface {
    public name = 'MigrationName1780387560604'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_SmsLog_userOnCallLogTimelineId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_SmsLog_userOnCallLogTimelineId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_77bd357cbaad40a136a36f5f1e" ON "SmsLog" ("userOnCallLogTimelineId") `);
        await queryRunner.query(`ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_77bd357cbaad40a136a36f5f1ed" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_77bd357cbaad40a136a36f5f1ed"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_77bd357cbaad40a136a36f5f1e"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_SmsLog_userOnCallLogTimelineId" ON "SmsLog" ("userOnCallLogTimelineId") `);
        await queryRunner.query(`ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_SmsLog_userOnCallLogTimelineId" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
