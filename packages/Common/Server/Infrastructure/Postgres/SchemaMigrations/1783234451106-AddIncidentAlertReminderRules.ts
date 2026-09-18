import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncidentAlertReminderRules1783234451106
  implements MigrationInterface
{
  public name = "AddIncidentAlertReminderRules1783234451106";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentReminderRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "order" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "reminderIntervalInMinutes" integer NOT NULL, "stopRemindersOnState" character varying NOT NULL DEFAULT 'Resolved', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_153c43f71e834941df1daddb2e4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c972e9e181a2e73a01addfd69" ON "IncidentReminderRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f507b1347cc994158400aaf56" ON "IncidentReminderRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aab9a6d8f36776d33ef3042fa4" ON "IncidentReminderRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8316e7c22648aa72efb14048d9" ON "IncidentReminderRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertReminderRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "order" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "reminderIntervalInMinutes" integer NOT NULL, "stopRemindersOnState" character varying NOT NULL DEFAULT 'Resolved', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cabd1c5a39b09b2e4c4832cde00" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5696a102896872cf6853b542b" ON "AlertReminderRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67cd2ab2648c4b1fb3dba0c940" ON "AlertReminderRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9ff98b1e54135aa8039589030" ON "AlertReminderRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb22f13485f8fa800aa1f72577" ON "AlertReminderRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentReminderRuleIncidentSeverity" ("incidentReminderRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_3ba81b8164395b2acc43004ec7d" PRIMARY KEY ("incidentReminderRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d18e07c9933f71b4021aff78c1" ON "IncidentReminderRuleIncidentSeverity" ("incidentReminderRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42180918910081f290449a5cfa" ON "IncidentReminderRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertReminderRuleAlertSeverity" ("alertReminderRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_b3f7abace9f62b11cba7b8398ca" PRIMARY KEY ("alertReminderRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_615d6b959594c14b2fe7b28fae" ON "AlertReminderRuleAlertSeverity" ("alertReminderRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8cfb554acdaf24c7dae27efd3d" ON "AlertReminderRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "enableReminders" boolean DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "nextReminderNotificationAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "reminderNotificationSentCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "enableReminders" boolean DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "nextReminderNotificationAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "reminderNotificationSentCount" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c03092be68b7095daa296c94b7" ON "Incident" ("nextReminderNotificationAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53cf12c79f9d3f9c0cb662b6b2" ON "Alert" ("nextReminderNotificationAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD CONSTRAINT "FK_6c972e9e181a2e73a01addfd695" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD CONSTRAINT "FK_7c3ec2e35e501188341feab0cd2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" ADD CONSTRAINT "FK_bda9ba3d3ad0d19aa5fa6cf81c7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD CONSTRAINT "FK_c5696a102896872cf6853b542bd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD CONSTRAINT "FK_0c72c230a632c0be1ebc0061f6c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" ADD CONSTRAINT "FK_e8e0b5c1e660e95d5977751dfba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleIncidentSeverity" ADD CONSTRAINT "FK_d18e07c9933f71b4021aff78c1f" FOREIGN KEY ("incidentReminderRuleId") REFERENCES "IncidentReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleIncidentSeverity" ADD CONSTRAINT "FK_42180918910081f290449a5cfa1" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleAlertSeverity" ADD CONSTRAINT "FK_615d6b959594c14b2fe7b28fae3" FOREIGN KEY ("alertReminderRuleId") REFERENCES "AlertReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleAlertSeverity" ADD CONSTRAINT "FK_8cfb554acdaf24c7dae27efd3de" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleAlertSeverity" DROP CONSTRAINT "FK_8cfb554acdaf24c7dae27efd3de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleAlertSeverity" DROP CONSTRAINT "FK_615d6b959594c14b2fe7b28fae3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleIncidentSeverity" DROP CONSTRAINT "FK_42180918910081f290449a5cfa1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleIncidentSeverity" DROP CONSTRAINT "FK_d18e07c9933f71b4021aff78c1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP CONSTRAINT "FK_e8e0b5c1e660e95d5977751dfba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP CONSTRAINT "FK_0c72c230a632c0be1ebc0061f6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRule" DROP CONSTRAINT "FK_c5696a102896872cf6853b542bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP CONSTRAINT "FK_bda9ba3d3ad0d19aa5fa6cf81c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP CONSTRAINT "FK_7c3ec2e35e501188341feab0cd2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRule" DROP CONSTRAINT "FK_6c972e9e181a2e73a01addfd695"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53cf12c79f9d3f9c0cb662b6b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c03092be68b7095daa296c94b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "reminderNotificationSentCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "nextReminderNotificationAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "enableReminders"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "reminderNotificationSentCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "nextReminderNotificationAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "enableReminders"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8cfb554acdaf24c7dae27efd3d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_615d6b959594c14b2fe7b28fae"`,
    );
    await queryRunner.query(`DROP TABLE "AlertReminderRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42180918910081f290449a5cfa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d18e07c9933f71b4021aff78c1"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentReminderRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb22f13485f8fa800aa1f72577"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9ff98b1e54135aa8039589030"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67cd2ab2648c4b1fb3dba0c940"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5696a102896872cf6853b542b"`,
    );
    await queryRunner.query(`DROP TABLE "AlertReminderRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8316e7c22648aa72efb14048d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aab9a6d8f36776d33ef3042fa4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f507b1347cc994158400aaf56"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c972e9e181a2e73a01addfd69"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentReminderRule"`);
  }
}
