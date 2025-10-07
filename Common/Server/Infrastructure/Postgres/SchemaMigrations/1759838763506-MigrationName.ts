import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1759838763506 implements MigrationInterface {
  public name = "MigrationName1759838763506";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP COLUMN "whatsAppText"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableWhatsAppNotifications" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD "messageText" text`);
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userWhatsAppId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByWhatsApp" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userWhatsAppId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ALTER COLUMN "whatsAppCostInUSDCents" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ALTER COLUMN "whatsAppCostInUSDCents" SET DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" ALTER COLUMN "verificationCode" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98e71cf97956e7938195be8451" ON "WhatsAppLog" ("whatsAppCostInUSDCents") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73297560a1a70e4fe47eac2986" ON "UserNotificationRule" ("userWhatsAppId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a67c82e4e093ae5c89d2d76bd" ON "UserOnCallLogTimeline" ("userWhatsAppId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_73297560a1a70e4fe47eac29861" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_73297560a1a70e4fe47eac29861"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a67c82e4e093ae5c89d2d76bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73297560a1a70e4fe47eac2986"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98e71cf97956e7938195be8451"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" ALTER COLUMN "verificationCode" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ALTER COLUMN "whatsAppCostInUSDCents" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ALTER COLUMN "whatsAppCostInUSDCents" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userWhatsAppId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByWhatsApp"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userWhatsAppId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP COLUMN "messageText"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableWhatsAppNotifications"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD "whatsAppText" character varying(500) NOT NULL`,
    );
  }
}
