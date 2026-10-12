import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its foreign key is added online, in a
 * migration of its own (AddWorkflowLogStartedByForeignKey1801450000000).
 *
 * A workflow that is turned off can now be run by hand from its Builder, to
 * test it: off pauses its trigger, not a person testing it. Each run records
 * whether it was such a test run, and who started it by hand:
 *
 *   - WorkflowLog.isTestRun: a person started it while the workflow was off.
 *     Every earlier run is false - a workflow that was off did not run at all
 *     before this.
 *   - WorkflowLog.startedByUserId: the person who started it with Run
 *     Workflow or Run just this step, on or off. Earlier runs name nobody.
 *
 * Adding a column with a constant default changes no row on Postgres 11 and
 * later (the default is kept in the catalog), and the second column is
 * nullable with no default, so neither rewrites the table.
 */
export class AddWorkflowLogTestRun1801400000000 implements MigrationInterface {
  public name: string = "AddWorkflowLogTestRun1801400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "isTestRun" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "startedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "startedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "WorkflowLog" DROP COLUMN "isTestRun"`);
  }
}
