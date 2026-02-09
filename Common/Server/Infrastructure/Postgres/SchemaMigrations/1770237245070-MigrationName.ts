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

    // Backfill counters from COUNT of each entity table (including soft-deleted rows)
    // Using JOIN-based updates instead of correlated subqueries for performance
    await queryRunner.query(
      `UPDATE "Project" SET "incidentCounter" = sub.cnt FROM (SELECT "projectId", COUNT(*) as cnt FROM "Incident" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertCounter" = sub.cnt FROM (SELECT "projectId", COUNT(*) as cnt FROM "Alert" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "scheduledMaintenanceCounter" = sub.cnt FROM (SELECT "projectId", COUNT(*) as cnt FROM "ScheduledMaintenance" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "incidentEpisodeCounter" = sub.cnt FROM (SELECT "projectId", COUNT(*) as cnt FROM "IncidentEpisode" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "alertEpisodeCounter" = sub.cnt FROM (SELECT "projectId", COUNT(*) as cnt FROM "AlertEpisode" GROUP BY "projectId") sub WHERE "Project"."_id" = sub."projectId"`,
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
