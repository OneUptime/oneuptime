import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An API key gives a workflow its Run As (OneUptime issue #9765, Types
 * /Workflow/WorkflowRunAs):
 *
 *   - Workflow.runAsGivenByApiKeyId: the project API key whose permissions a
 *     workflow that runs as more than Default runs with, when a key - not a
 *     person (runAsGivenByUserId) - last chose its Run As or saved its steps
 *     or variables.
 *   - WorkflowLog.runAsGivenByApiKeyId and runAsGivenByApiKeyName: the key
 *     each run ran with, and its name then, so the run still says which key
 *     it was once the key is renamed or deleted.
 *
 * All nullable: every workflow and every run before this names no key,
 * which is true of them. Generated with npm run generate-postgres-migration.
 * Nothing here reads a row. The key of Workflow.runAsGivenByApiKeyId is
 * added online, apart, in AddWorkflowRunAsApiKeyKey1809185400100
 * (Docs/migrations/README.md). WorkflowLog.runAsGivenByApiKeyId has no key:
 * a run's record is history, deleting a key leaves its runs as they were,
 * and no delete of a key waits on every run of the last 30 days.
 */
export class AddWorkflowRunAsApiKey1809185400000 implements MigrationInterface {
  public name: string = "AddWorkflowRunAsApiKey1809185400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "runAsGivenByApiKeyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByApiKeyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByApiKeyName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByApiKeyName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByApiKeyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenByApiKeyId"`,
    );
  }
}
