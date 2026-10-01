import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Archive for the resources people create and keep that could not be archived
 * yet: workflows, monitors, status pages, dashboards and on-call policies.
 * Each gets the same three columns every archivable resource already has
 * (1782600000000-AddArchiveToResources): "isArchived" (NOT NULL DEFAULT
 * false, so every existing row stays live), "archivedAt" and
 * "archivedByUserId" (stamped by the server from the isArchived write, NULL
 * while not archived, SET NULL when that user is deleted), plus the
 * ("projectId", "isArchived") index every list query filters on.
 *
 * Adding a NOT NULL column with a constant default does not rewrite the table
 * on Postgres 11+, so this is cheap even on a large Monitor table.
 */
export class AddArchiveToMoreResources1797200000000
  implements MigrationInterface
{
  public name: string = "AddArchiveToMoreResources1797200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c538a124340d6df2474d178f7e" ON "OnCallDutyPolicy" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2574818e18375c4e77199e09e4" ON "StatusPage" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84ee6949e41b09ca3b2728f76b" ON "Workflow" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43fd45f385e6620444df61ae9e" ON "Dashboard" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_30540eb00f5264500c246a4656f" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_30e313a8df89c8b4e904913a2de" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_a3645d531917a7236432c7caeb4" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_a1238cc4415cdf9b099a755fac2" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_a1238cc4415cdf9b099a755fac2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_a3645d531917a7236432c7caeb4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_30e313a8df89c8b4e904913a2de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_30540eb00f5264500c246a4656f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43fd45f385e6620444df61ae9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84ee6949e41b09ca3b2728f76b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2574818e18375c4e77199e09e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c538a124340d6df2474d178f7e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cdc971b41d78e4bed90a1d611b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "Dashboard" DROP COLUMN "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "Dashboard" DROP COLUMN "isArchived"`);
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "Workflow" DROP COLUMN "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "Workflow" DROP COLUMN "isArchived"`);
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "Monitor" DROP COLUMN "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "Monitor" DROP COLUMN "isArchived"`);
  }
}
