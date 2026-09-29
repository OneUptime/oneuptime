import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776761171349 implements MigrationInterface {
  public name = "MigrationName1776761171349";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelegramLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "toChatId" character varying(100) NOT NULL, "fromBotUsername" character varying(100), "messageText" text, "statusMessage" character varying(500), "telegramMessageId" character varying(100), "status" character varying(100) NOT NULL, "telegramCostInUSDCents" integer NOT NULL DEFAULT '0', "incidentId" uuid, "userId" uuid, "alertId" uuid, "monitorId" uuid, "scheduledMaintenanceId" uuid, "statusPageId" uuid, "statusPageAnnouncementId" uuid, "teamId" uuid, "onCallDutyPolicyId" uuid, "onCallDutyPolicyEscalationRuleId" uuid, "onCallDutyPolicyScheduleId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e2558933aa0127dcf898bd46b8d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d3d34f75279f6eac53deebb5b" ON "TelegramLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef6f28a9cb405d8d44213d5e2e" ON "TelegramLog" ("toChatId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7873cfadbe5fabb31b82d7ad08" ON "TelegramLog" ("telegramMessageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_446a8adf2a8c26e9cfe9c76c71" ON "TelegramLog" ("telegramCostInUSDCents") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16996668b58a1136761abaec76" ON "TelegramLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5f24de2f7376d28d1fc003af7a" ON "TelegramLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78a501831da3b3bd09026f271e" ON "TelegramLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac1eb5a4f94d508dea52b687d6" ON "TelegramLog" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74d8579be62641f08e056311c3" ON "TelegramLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1e1160d30d108c1a34d3b2405" ON "TelegramLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa93bd2f49066a1fd0947cf41c" ON "TelegramLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d20420ec35d6b20c195ac04be" ON "TelegramLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fcfea829364f765a3256596431" ON "TelegramLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73d4a08358acbc3f18bb8cf6c2" ON "TelegramLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59948ea3c04951efe8fc1295b8" ON "TelegramLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserTelegram" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telegramUserHandle" character varying(100), "telegramChatId" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, "verificationCode" character varying(100) NOT NULL, CONSTRAINT "PK_5eeb44dfd6cf1b7126cda720a69" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9dd52803bd06407f0cac63fbc" ON "UserTelegram" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db5803875d850dcf9b4e7ab7b5" ON "UserTelegram" ("telegramChatId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4bcd99431d2749fef273ec4224" ON "UserTelegram" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableTelegramNotifications" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telegramBotToken" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_31520e25e0cb9d1e8c8efb66a59" UNIQUE ("telegramBotToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telegramBotUsername" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_0e005cfbdef3209c9523e0c6aa0" UNIQUE ("telegramBotUsername")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telegramWebhookSecretToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_cab6bddc355be1d75097f372eff" UNIQUE ("telegramWebhookSecretToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userTelegramId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByTelegram" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userTelegramId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf2f774f6f4a5a59ada931e7a3" ON "UserNotificationRule" ("userTelegramId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a61a74c006b54967cdba5e4f28" ON "UserOnCallLogTimeline" ("userTelegramId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_1d3d34f75279f6eac53deebb5b2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_16996668b58a1136761abaec76a" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_5f24de2f7376d28d1fc003af7a4" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_78a501831da3b3bd09026f271ef" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_ac1eb5a4f94d508dea52b687d67" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_74d8579be62641f08e056311c3f" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_b1e1160d30d108c1a34d3b2405e" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_fa93bd2f49066a1fd0947cf41c0" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_5d20420ec35d6b20c195ac04beb" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_fcfea829364f765a32565964310" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_73d4a08358acbc3f18bb8cf6c2a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_59948ea3c04951efe8fc1295b88" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_dc36097ea0f6f4ba8e929f3e70a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" ADD CONSTRAINT "FK_e9dd52803bd06407f0cac63fbcf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" ADD CONSTRAINT "FK_4bcd99431d2749fef273ec42242" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" ADD CONSTRAINT "FK_fdc04a15efa381b1951ce952dad" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" ADD CONSTRAINT "FK_a3d125c9c6d49543234415c3f2f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_cf2f774f6f4a5a59ada931e7a3a" FOREIGN KEY ("userTelegramId") REFERENCES "UserTelegram"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a61a74c006b54967cdba5e4f280" FOREIGN KEY ("userTelegramId") REFERENCES "UserTelegram"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a61a74c006b54967cdba5e4f280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_cf2f774f6f4a5a59ada931e7a3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" DROP CONSTRAINT "FK_a3d125c9c6d49543234415c3f2f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" DROP CONSTRAINT "FK_fdc04a15efa381b1951ce952dad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" DROP CONSTRAINT "FK_4bcd99431d2749fef273ec42242"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTelegram" DROP CONSTRAINT "FK_e9dd52803bd06407f0cac63fbcf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_dc36097ea0f6f4ba8e929f3e70a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_59948ea3c04951efe8fc1295b88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_73d4a08358acbc3f18bb8cf6c2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_fcfea829364f765a32565964310"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_5d20420ec35d6b20c195ac04beb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_fa93bd2f49066a1fd0947cf41c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_b1e1160d30d108c1a34d3b2405e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_74d8579be62641f08e056311c3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_ac1eb5a4f94d508dea52b687d67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_78a501831da3b3bd09026f271ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_5f24de2f7376d28d1fc003af7a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_16996668b58a1136761abaec76a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_1d3d34f75279f6eac53deebb5b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a61a74c006b54967cdba5e4f28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf2f774f6f4a5a59ada931e7a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userTelegramId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByTelegram"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userTelegramId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_cab6bddc355be1d75097f372eff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telegramWebhookSecretToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_0e005cfbdef3209c9523e0c6aa0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telegramBotUsername"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_31520e25e0cb9d1e8c8efb66a59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telegramBotToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableTelegramNotifications"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bcd99431d2749fef273ec4224"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db5803875d850dcf9b4e7ab7b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9dd52803bd06407f0cac63fbc"`,
    );
    await queryRunner.query(`DROP TABLE "UserTelegram"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59948ea3c04951efe8fc1295b8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73d4a08358acbc3f18bb8cf6c2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fcfea829364f765a3256596431"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d20420ec35d6b20c195ac04be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa93bd2f49066a1fd0947cf41c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1e1160d30d108c1a34d3b2405"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74d8579be62641f08e056311c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac1eb5a4f94d508dea52b687d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78a501831da3b3bd09026f271e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5f24de2f7376d28d1fc003af7a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16996668b58a1136761abaec76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_446a8adf2a8c26e9cfe9c76c71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7873cfadbe5fabb31b82d7ad08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef6f28a9cb405d8d44213d5e2e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d3d34f75279f6eac53deebb5b"`,
    );
    await queryRunner.query(`DROP TABLE "TelegramLog"`);
  }
}
