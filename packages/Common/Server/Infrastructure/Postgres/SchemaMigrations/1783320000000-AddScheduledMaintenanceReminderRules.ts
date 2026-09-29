import { MigrationInterface, QueryRunner } from "typeorm";

export class AddScheduledMaintenanceReminderRules1783320000000
  implements MigrationInterface
{
  public name = "AddScheduledMaintenanceReminderRules1783320000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceReminderRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "order" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "reminderIntervalInMinutes" integer NOT NULL, "stopRemindersOnState" character varying NOT NULL DEFAULT 'Completed', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_02c0366932aa9c0a3140113de4b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cdfe86ca6afb1ca38389dfd797" ON "ScheduledMaintenanceReminderRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_344c7b5c5f21faa7dd410b9258" ON "ScheduledMaintenanceReminderRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d0daa2057ea64ed1ae3b0c9a2" ON "ScheduledMaintenanceReminderRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48f38b077e68389d660b7b9e28" ON "ScheduledMaintenanceReminderRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceReminderRuleLabel" ("scheduledMaintenanceReminderRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_6e7e491d4e939bf3ce72e2bbdcf" PRIMARY KEY ("scheduledMaintenanceReminderRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89f3e38c024ff24dfd1c096071" ON "ScheduledMaintenanceReminderRuleLabel" ("scheduledMaintenanceReminderRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b655fdb0aedc35ce1055c016e7" ON "ScheduledMaintenanceReminderRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "enableReminders" boolean DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "nextReminderNotificationAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "reminderNotificationSentCount" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3961cc017ca406112af1a3e20c" ON "ScheduledMaintenance" ("nextReminderNotificationAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD CONSTRAINT "FK_cdfe86ca6afb1ca38389dfd797b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD CONSTRAINT "FK_bb22a2cf85eca2123f07ba88d68" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD CONSTRAINT "FK_1b79ca9eb4514e73dcdf27b6e9f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRuleLabel" ADD CONSTRAINT "FK_89f3e38c024ff24dfd1c0960716" FOREIGN KEY ("scheduledMaintenanceReminderRuleId") REFERENCES "ScheduledMaintenanceReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRuleLabel" ADD CONSTRAINT "FK_b655fdb0aedc35ce1055c016e76" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRuleLabel" DROP CONSTRAINT "FK_b655fdb0aedc35ce1055c016e76"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRuleLabel" DROP CONSTRAINT "FK_89f3e38c024ff24dfd1c0960716"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP CONSTRAINT "FK_1b79ca9eb4514e73dcdf27b6e9f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP CONSTRAINT "FK_bb22a2cf85eca2123f07ba88d68"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP CONSTRAINT "FK_cdfe86ca6afb1ca38389dfd797b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3961cc017ca406112af1a3e20c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "reminderNotificationSentCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "nextReminderNotificationAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "enableReminders"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b655fdb0aedc35ce1055c016e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89f3e38c024ff24dfd1c096071"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceReminderRuleLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48f38b077e68389d660b7b9e28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d0daa2057ea64ed1ae3b0c9a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_344c7b5c5f21faa7dd410b9258"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cdfe86ca6afb1ca38389dfd797"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceReminderRule"`);
  }
}
