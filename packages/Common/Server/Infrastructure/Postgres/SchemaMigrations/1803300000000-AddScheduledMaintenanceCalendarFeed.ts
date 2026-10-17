import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The team's calendar link for scheduled maintenance.
 *
 * One new table, ScheduledMaintenanceCalendarFeed: at most one row per
 * project (a unique index on projectId), the link's token stored as its
 * SHA-256 (unique, the public route's lookup key) and encrypted for the
 * Subscribe dialog, the rotated-out hash kept for 30 days, an on / off
 * switch and the fetch bookkeeping.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name and this comment are
 * hand-written. The foreign keys are on the table this migration creates,
 * so they hold no lock on rows anyone writes.
 */
export class AddScheduledMaintenanceCalendarFeed1803300000000
  implements MigrationInterface
{
  public name: string = "AddScheduledMaintenanceCalendarFeed1803300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceCalendarFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "tokenHash" character varying(100) NOT NULL, "token" text, "previousTokenHash" character varying(100), "previousTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "tokenHint" character varying(100), "isEnabled" boolean NOT NULL DEFAULT true, "rotatedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedClient" character varying(100), "fetchCount" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_620e8fa36c9bfb6bcfb5051ded9" UNIQUE ("tokenHash"), CONSTRAINT "PK_80012f62601fb659d8f300eeb10" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7fd84fce72a1e1cf507dbc24d" ON "ScheduledMaintenanceCalendarFeed" ("previousTokenHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b69e35f727da686c20f626530b" ON "ScheduledMaintenanceCalendarFeed" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" ADD CONSTRAINT "FK_b69e35f727da686c20f626530b2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" ADD CONSTRAINT "FK_82024aaa612f7719fc079ceeafa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" ADD CONSTRAINT "FK_31f05d268b5a9eecdaace1004ad" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" DROP CONSTRAINT "FK_31f05d268b5a9eecdaace1004ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" DROP CONSTRAINT "FK_82024aaa612f7719fc079ceeafa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCalendarFeed" DROP CONSTRAINT "FK_b69e35f727da686c20f626530b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b69e35f727da686c20f626530b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7fd84fce72a1e1cf507dbc24d"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceCalendarFeed"`);
  }
}
