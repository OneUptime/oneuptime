import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Global Runners: Runners the OneUptime server runs for every project, which
 * no project owns (Runner.isGlobalRunner, with an empty projectId); a job
 * that waits for any of them (RunnerJob.runsOnGlobalRunner); a project's
 * switch for using them, on (Project.useGlobalRunners); and whether a runbook
 * secret is filled into a step a global Runner runs, off
 * (RunbookSecret.isAvailableToGlobalRunners), so a secret that existed before
 * reaches only the Runners it was assigned to.
 *
 * Columns with a constant default and a dropped NOT NULL: no table is
 * rewritten or scanned. The generator also dropped the Runner's project
 * foreign key and added it back as it was, because the column's nullability
 * changed; that is left out here - the key is unchanged, and adding it back
 * would check every Runner row while blocking the table's writers. The new
 * index is built online, in AddGlobalRunnerJobIndex1804000000000.
 */
export class AddGlobalRunners1803950000000 implements MigrationInterface {
  public name: string = "AddGlobalRunners1803950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "useGlobalRunners" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "isGlobalRunner" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "runsOnGlobalRunner" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" ADD "isAvailableToGlobalRunners" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ALTER COLUMN "projectId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A global Runner belongs to no project, so it cannot outlive the column.
    await queryRunner.query(`DELETE FROM "Runner" WHERE "projectId" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "Runner" ALTER COLUMN "projectId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" DROP COLUMN "isAvailableToGlobalRunners"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "runsOnGlobalRunner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "isGlobalRunner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "useGlobalRunners"`,
    );
  }
}
