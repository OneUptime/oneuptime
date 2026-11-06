import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A hunt's run history and the Hunt Library (Types/SecurityEvent/SecurityHunt,
 * Types/SecurityEvent/SecurityHuntLibrary):
 *
 *   - "SecurityHuntRun": one row per scheduled run of a hunt that read
 *     events - the window it searched, how many events it found, or why it
 *     could not run. Read by its hunt, newest first (securityHuntId,
 *     createdAt), and cleared once it is 90 days old (createdAt). Deleted
 *     with its hunt or its project.
 *   - "SecurityHunt" gains one nullable column, "libraryHuntId": the Hunt
 *     Library starter a hunt was added from. No index or foreign key is
 *     added to that existing table, so nothing scans or locks it.
 *
 * The new table is empty, so its indexes and foreign keys are built here.
 */
export class AddSecurityHuntRunHistory1808992040000
  implements MigrationInterface
{
  public name: string = "AddSecurityHuntRunHistory1808992040000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityHuntRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityHuntId" uuid NOT NULL, "windowStartAt" TIMESTAMP WITH TIME ZONE NOT NULL, "windowEndAt" TIMESTAMP WITH TIME ZONE NOT NULL, "eventCount" integer, "error" text, CONSTRAINT "PK_86dc12d2d730b8a2225bd07a8f4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e147a5ad643535e1d7ff9c647e" ON "SecurityHuntRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5070015832151e71b8435e795" ON "SecurityHuntRun" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22819188a47a765f3590ff1788" ON "SecurityHuntRun" ("securityHuntId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" ADD "libraryHuntId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntRun" ADD CONSTRAINT "FK_e147a5ad643535e1d7ff9c647e3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntRun" ADD CONSTRAINT "FK_fdb6cacde94e9ead9e451a492a9" FOREIGN KEY ("securityHuntId") REFERENCES "SecurityHunt"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntRun" DROP CONSTRAINT "FK_fdb6cacde94e9ead9e451a492a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntRun" DROP CONSTRAINT "FK_e147a5ad643535e1d7ff9c647e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" DROP COLUMN "libraryHuntId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22819188a47a765f3590ff1788"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5070015832151e71b8435e795"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e147a5ad643535e1d7ff9c647e"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityHuntRun"`);
  }
}
