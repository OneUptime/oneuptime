import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769125561322 implements MigrationInterface {
    public name = 'MigrationName1769125561322'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "enableResolveDelay" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "enableReopenWindow" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "enableInactivityTimeout" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "enableInactivityTimeout"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "enableReopenWindow"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "enableResolveDelay"`);
    }

}
