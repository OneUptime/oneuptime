import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755688892257 implements MigrationInterface {
    name = 'MigrationName1755688892257'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPage" ADD "enableMicrosoftTeamsSubscribers" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsIncomingWebhookUrl" character varying`);
        await queryRunner.query(`ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsChannelName" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsChannelName"`);
        await queryRunner.query(`ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsIncomingWebhookUrl"`);
        await queryRunner.query(`ALTER TABLE "StatusPage" DROP COLUMN "enableMicrosoftTeamsSubscribers"`);
    }

}
