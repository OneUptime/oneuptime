import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770237245070 implements MigrationInterface {
  public name = "MigrationName1770237245070";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add counter columns with default 0
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "scheduledMaintenanceCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentEpisodeCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertEpisodeCounter" integer NOT NULL DEFAULT '0'`,
    );

    // Backfill from MAX of each entity table (including soft-deleted rows)
    await queryRunner.query(
      `UPDATE "Project" SET "incidentCounter" = COALESCE((SELECT MAX("incidentNumber") FROM "Incident" WHERE "Incident"."projectId" = "Project"."_id"), 0)`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertCounter" = COALESCE((SELECT MAX("alertNumber") FROM "Alert" WHERE "Alert"."projectId" = "Project"."_id"), 0)`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "scheduledMaintenanceCounter" = COALESCE((SELECT MAX("scheduledMaintenanceNumber") FROM "ScheduledMaintenance" WHERE "ScheduledMaintenance"."projectId" = "Project"."_id"), 0)`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "incidentEpisodeCounter" = COALESCE((SELECT MAX("episodeNumber") FROM "IncidentEpisode" WHERE "IncidentEpisode"."projectId" = "Project"."_id"), 0)`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertEpisodeCounter" = COALESCE((SELECT MAX("episodeNumber") FROM "AlertEpisode" WHERE "AlertEpisode"."projectId" = "Project"."_id"), 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertEpisodeCounter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentEpisodeCounter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "scheduledMaintenanceCounter"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "alertCounter"`);
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentCounter"`,
    );
  }
}
