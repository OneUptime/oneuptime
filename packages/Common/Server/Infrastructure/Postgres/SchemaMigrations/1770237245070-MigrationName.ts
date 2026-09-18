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

    /*
     * Backfill counters from MAX number of each entity table (per project)
     * Using MAX instead of COUNT to correctly handle deleted rows
     */
    await queryRunner.query(
      `UPDATE "Project" SET "incidentCounter" = sub.max_num FROM (SELECT "projectId", COALESCE(MAX("incidentNumber"), 0) as max_num FROM "Incident" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertCounter" = sub.max_num FROM (SELECT "projectId", COALESCE(MAX("alertNumber"), 0) as max_num FROM "Alert" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "scheduledMaintenanceCounter" = sub.max_num FROM (SELECT "projectId", COALESCE(MAX("scheduledMaintenanceNumber"), 0) as max_num FROM "ScheduledMaintenance" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "incidentEpisodeCounter" = sub.max_num FROM (SELECT "projectId", COALESCE(MAX("episodeNumber"), 0) as max_num FROM "IncidentEpisode" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertEpisodeCounter" = sub.max_num FROM (SELECT "projectId", COALESCE(MAX("episodeNumber"), 0) as max_num FROM "AlertEpisode" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
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
