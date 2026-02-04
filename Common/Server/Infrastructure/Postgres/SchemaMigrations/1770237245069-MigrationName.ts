import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770237245069 implements MigrationInterface {
    name = 'MigrationName1770237245069'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPage" ADD "showEpisodeHistoryInDays" integer NOT NULL DEFAULT '14'`);
        await queryRunner.query(`ALTER TABLE "StatusPage" ADD "showEpisodeLabelsOnStatusPage" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "StatusPage" DROP COLUMN "showEpisodeLabelsOnStatusPage"`);
        await queryRunner.query(`ALTER TABLE "StatusPage" DROP COLUMN "showEpisodeHistoryInDays"`);
    }

}
