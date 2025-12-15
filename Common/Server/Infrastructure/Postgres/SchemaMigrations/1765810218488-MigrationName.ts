import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765810218488 implements MigrationInterface {
    public name = 'MigrationName1765810218488'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" ADD "aiCurrentBalanceInUSDCents" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "autoAiRechargeByBalanceInUSD" integer NOT NULL DEFAULT '20'`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "autoRechargeAiWhenCurrentBalanceFallsInUSD" integer NOT NULL DEFAULT '10'`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "enableAi" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "enableAutoRechargeAiBalance" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "lowAiBalanceNotificationSentToOwners" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "failedAiBalanceChargeNotificationSentToOwners" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "notEnabledAiNotificationSentToOwners" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "notEnabledAiNotificationSentToOwners"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "failedAiBalanceChargeNotificationSentToOwners"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "lowAiBalanceNotificationSentToOwners"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "enableAutoRechargeAiBalance"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "enableAi"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "autoRechargeAiWhenCurrentBalanceFallsInUSD"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "autoAiRechargeByBalanceInUSD"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "aiCurrentBalanceInUSDCents"`);
    }

}
