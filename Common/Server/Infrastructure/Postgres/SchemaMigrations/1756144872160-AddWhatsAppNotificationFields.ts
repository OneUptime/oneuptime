import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWhatsAppNotificationFields1756144872160 implements MigrationInterface {
    name = 'AddWhatsAppNotificationFields1756144872160'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" ADD "enableWhatsAppNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "UserNotificationSetting" ADD "alertByWhatsApp" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByWhatsApp"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "enableWhatsAppNotifications"`);
    }

}
