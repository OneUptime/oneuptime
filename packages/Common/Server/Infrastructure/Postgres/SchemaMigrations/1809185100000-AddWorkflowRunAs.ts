import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a workflow runs as (OneUptime issue #9695, Types/Workflow
 * /WorkflowRunAs):
 *
 *   - Workflow.runAs: Default, ProjectOwner or CustomRole. NOT NULL with a
 *     constant default, which Postgres adds without rewriting the table, so
 *     every existing workflow runs as Default - exactly what it did before.
 *   - Workflow.runAsCustomRoleId: the custom role, for CustomRole.
 *   - Workflow.runAsGivenByUserId and runAsGivenAt: the person whose
 *     permissions a raised workflow runs with, and since when.
 *   - WorkflowLog.runAs, runAsCustomRoleName and runAsGivenByUserId: what
 *     each run acted as, and for whom. Nullable: every run from before
 *     these columns ran as Default.
 *
 * Generated with npm run generate-postgres-migration. Nothing here reads a
 * row. The three foreign keys are added online, apart, in
 * AddWorkflowRunAsKeys1809185100100: "WorkflowLog" is written by every run,
 * and a key added here would check every row while holding the table
 * (Docs/migrations/README.md).
 */
export class AddWorkflowRunAs1809185100000 implements MigrationInterface {
  public name: string = "AddWorkflowRunAs1809185100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "runAs" character varying(100) NOT NULL DEFAULT 'Default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "runAsCustomRoleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "runAsGivenByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "runAsGivenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "runAs" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "runAsCustomRoleName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsCustomRoleName"`,
    );
    await queryRunner.query(`ALTER TABLE "WorkflowLog" DROP COLUMN "runAs"`);
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "runAsCustomRoleId"`,
    );
    await queryRunner.query(`ALTER TABLE "Workflow" DROP COLUMN "runAs"`);
  }
}
