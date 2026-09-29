import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778514515756 implements MigrationInterface {
  public name = "MigrationName1778514515756";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WebhookLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "webhookUrl" character varying(500) NOT NULL, "requestBody" text, "responseStatusCode" integer, "responseBody" text, "statusMessage" character varying(500), "status" character varying(100) NOT NULL, "incidentId" uuid, "userId" uuid, "alertId" uuid, "monitorId" uuid, "scheduledMaintenanceId" uuid, "statusPageId" uuid, "statusPageAnnouncementId" uuid, "teamId" uuid, "onCallDutyPolicyId" uuid, "onCallDutyPolicyEscalationRuleId" uuid, "onCallDutyPolicyScheduleId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8b4fb22fc2774d14ef402d1c95e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f056061dd856d2dd80535e3942" ON "WebhookLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e2a6f99b1b4a71cb55d58a543" ON "WebhookLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f25add443b218167cea96700df" ON "WebhookLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f72afbb4b77f17ce9dcf87bc2" ON "WebhookLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5210a7081bc1ea3bf1aad779a" ON "WebhookLog" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76a097527742676669dc19fa43" ON "WebhookLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77ca2f920c9c3fce2e135bd3f3" ON "WebhookLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ed307f7eb8b93597310359a5c" ON "WebhookLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d625e8286c577c2f15391c3a38" ON "WebhookLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8721a253d2babe86ca2904c514" ON "WebhookLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b12854b347864adb78bdda6f9" ON "WebhookLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c340cb0653d553203a37f402e4" ON "WebhookLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserWebhook" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "webhookUrl" character varying(500) NOT NULL, "secret" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e991ee25a603453aeb5b315af6b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9da84652f2f0459d4a27ea3f44" ON "UserWebhook" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9836b0a924af14d912d344e21" ON "UserWebhook" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userWebhookId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByWebhook" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userWebhookId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e183e6394d209918fbac3ec039" ON "UserNotificationRule" ("userWebhookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de891557845d64087311a45478" ON "UserOnCallLogTimeline" ("userWebhookId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_f056061dd856d2dd80535e39422" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_8e2a6f99b1b4a71cb55d58a5435" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_f25add443b218167cea96700df3" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_3f72afbb4b77f17ce9dcf87bc2b" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_e5210a7081bc1ea3bf1aad779a0" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_76a097527742676669dc19fa430" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_77ca2f920c9c3fce2e135bd3f33" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_4ed307f7eb8b93597310359a5cd" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_d625e8286c577c2f15391c3a38d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_8721a253d2babe86ca2904c514f" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_0b12854b347864adb78bdda6f99" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_c340cb0653d553203a37f402e4e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_41d96b5c3cb970753f81acd0142" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ADD CONSTRAINT "FK_9da84652f2f0459d4a27ea3f44e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ADD CONSTRAINT "FK_a9836b0a924af14d912d344e211" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ADD CONSTRAINT "FK_5ef3baab14ef8ea04b1bf14ac3e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ADD CONSTRAINT "FK_ef72bea12b483dcf47137aa7d82" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_e183e6394d209918fbac3ec039c" FOREIGN KEY ("userWebhookId") REFERENCES "UserWebhook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_de891557845d64087311a45478d" FOREIGN KEY ("userWebhookId") REFERENCES "UserWebhook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_de891557845d64087311a45478d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_e183e6394d209918fbac3ec039c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" DROP CONSTRAINT "FK_ef72bea12b483dcf47137aa7d82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" DROP CONSTRAINT "FK_5ef3baab14ef8ea04b1bf14ac3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" DROP CONSTRAINT "FK_a9836b0a924af14d912d344e211"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" DROP CONSTRAINT "FK_9da84652f2f0459d4a27ea3f44e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_41d96b5c3cb970753f81acd0142"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_c340cb0653d553203a37f402e4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_0b12854b347864adb78bdda6f99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_8721a253d2babe86ca2904c514f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_d625e8286c577c2f15391c3a38d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_4ed307f7eb8b93597310359a5cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_77ca2f920c9c3fce2e135bd3f33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_76a097527742676669dc19fa430"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_e5210a7081bc1ea3bf1aad779a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_3f72afbb4b77f17ce9dcf87bc2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_f25add443b218167cea96700df3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_8e2a6f99b1b4a71cb55d58a5435"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_f056061dd856d2dd80535e39422"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de891557845d64087311a45478"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e183e6394d209918fbac3ec039"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userWebhookId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByWebhook"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userWebhookId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9836b0a924af14d912d344e21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9da84652f2f0459d4a27ea3f44"`,
    );
    await queryRunner.query(`DROP TABLE "UserWebhook"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c340cb0653d553203a37f402e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b12854b347864adb78bdda6f9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8721a253d2babe86ca2904c514"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d625e8286c577c2f15391c3a38"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ed307f7eb8b93597310359a5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77ca2f920c9c3fce2e135bd3f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76a097527742676669dc19fa43"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5210a7081bc1ea3bf1aad779a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f72afbb4b77f17ce9dcf87bc2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f25add443b218167cea96700df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e2a6f99b1b4a71cb55d58a543"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f056061dd856d2dd80535e3942"`,
    );
    await queryRunner.query(`DROP TABLE "WebhookLog"`);
  }
}
