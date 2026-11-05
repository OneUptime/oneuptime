import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Run again starts a new run with what an earlier run started with, so each run
 * now keeps it (Types/Workflow/WorkflowRunAgain):
 *
 *   - WorkflowLog.triggerValues: what its trigger started with, as JSON text,
 *     encrypted at rest and read by nobody through the API.
 *   - WorkflowLog.canRunAgain: whether it did. Every earlier run is false: what
 *     it started with was never kept.
 *
 * Neither rewrites the table: the first is nullable with no default, and the
 * second's constant default is kept in the catalog on Postgres 11 and later.
 */
export class AddWorkflowLogRunAgain1808994200000 implements MigrationInterface {
  public name: string = "AddWorkflowLogRunAgain1808994200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "triggerValues" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "canRunAgain" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "canRunAgain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "triggerValues"`,
    );
  }
}
