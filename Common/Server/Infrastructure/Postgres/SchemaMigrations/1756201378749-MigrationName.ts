import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756201378749 implements MigrationInterface {
    public name = 'MigrationName1756201378749'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAccessToken" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520" UNIQUE ("metaWhatsAppAccessToken")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppPhoneNumberId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_ef032cda9dd2fac68daeedd7bd2" UNIQUE ("metaWhatsAppPhoneNumberId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppBusinessAccountId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_607e6e88215689951d9b3645f00" UNIQUE ("metaWhatsAppBusinessAccountId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAppId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_e67fd0998ca781ec7db0e573e91" UNIQUE ("metaWhatsAppAppId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAppSecret" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c" UNIQUE ("metaWhatsAppAppSecret")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppWebhookVerifyToken" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8" UNIQUE ("metaWhatsAppWebhookVerifyToken")`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppWebhookVerifyToken"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAppSecret"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_e67fd0998ca781ec7db0e573e91"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAppId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_607e6e88215689951d9b3645f00"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppBusinessAccountId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_ef032cda9dd2fac68daeedd7bd2"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppPhoneNumberId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAccessToken"`);
    }

}
