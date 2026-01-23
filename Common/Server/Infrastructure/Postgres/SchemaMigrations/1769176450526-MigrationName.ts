import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769176450526 implements MigrationInterface {
    name = 'MigrationName1769176450526'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "triggeredByAlertEpisodeId" uuid`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" ADD "alertEpisodeId" uuid`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeInternalNote" ADD "postedFromSlackMessageId" character varying`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_71a74e4141a9de6626e3710f2d" ON "OnCallDutyPolicyExecutionLog" ("triggeredByAlertEpisodeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4eee6dbdf00be2aec7c6cdbcb3" ON "WorkspaceNotificationLog" ("alertEpisodeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_26bd01eb674e2e659fe6409423" ON "AlertEpisodeInternalNote" ("postedFromSlackMessageId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_71a74e4141a9de6626e3710f2d7" FOREIGN KEY ("triggeredByAlertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_4eee6dbdf00be2aec7c6cdbcb33" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_4eee6dbdf00be2aec7c6cdbcb33"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_71a74e4141a9de6626e3710f2d7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_26bd01eb674e2e659fe6409423"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4eee6dbdf00be2aec7c6cdbcb3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_71a74e4141a9de6626e3710f2d"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "AlertEpisodeInternalNote" DROP COLUMN "postedFromSlackMessageId"`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "alertEpisodeId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "triggeredByAlertEpisodeId"`);
    }

}
