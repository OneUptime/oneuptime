import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756293325324 implements MigrationInterface {
    public name = 'MigrationName1756293325324'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_73297560a1a70e4fe47eac29861"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_73297560a1a70e4fe47eac2986"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a67c82e4e093ae5c89d2d76bd"`);
        await queryRunner.query(`ALTER TABLE "Project" RENAME COLUMN "enableWhatsAppNotifications" TO "businessDetails"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAccessToken"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_ef032cda9dd2fac68daeedd7bd2"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppPhoneNumberId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_607e6e88215689951d9b3645f00"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppBusinessAccountId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_e67fd0998ca781ec7db0e573e91"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAppId"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppAppSecret"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "metaWhatsAppWebhookVerifyToken"`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" DROP COLUMN "userWhatsAppId"`);
        await queryRunner.query(`ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByWhatsApp"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userWhatsAppId"`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "businessDetails"`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "businessDetails" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "businessDetails"`);
        await queryRunner.query(`ALTER TABLE "Project" ADD "businessDetails" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD "userWhatsAppId" uuid`);
        await queryRunner.query(`ALTER TABLE "UserNotificationSetting" ADD "alertByWhatsApp" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" ADD "userWhatsAppId" uuid`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppWebhookVerifyToken" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8" UNIQUE ("metaWhatsAppWebhookVerifyToken")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAppSecret" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c" UNIQUE ("metaWhatsAppAppSecret")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAppId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_e67fd0998ca781ec7db0e573e91" UNIQUE ("metaWhatsAppAppId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppBusinessAccountId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_607e6e88215689951d9b3645f00" UNIQUE ("metaWhatsAppBusinessAccountId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppPhoneNumberId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_ef032cda9dd2fac68daeedd7bd2" UNIQUE ("metaWhatsAppPhoneNumberId")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "metaWhatsAppAccessToken" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520" UNIQUE ("metaWhatsAppAccessToken")`);
        await queryRunner.query(`ALTER TABLE "Project" RENAME COLUMN "businessDetails" TO "enableWhatsAppNotifications"`);
        await queryRunner.query(`CREATE INDEX "IDX_0a67c82e4e093ae5c89d2d76bd" ON "UserOnCallLogTimeline" ("userWhatsAppId") `);
        await queryRunner.query(`CREATE INDEX "IDX_73297560a1a70e4fe47eac2986" ON "UserNotificationRule" ("userWhatsAppId") `);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_73297560a1a70e4fe47eac29861" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
