import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "incomingEmailSecretKey": the key a workflow's Incoming Email trigger
 * address is built from (workflow-{key}@{inbound email domain}). NULL until
 * the workflow's graph first has that trigger, so no existing row needs a
 * value; WorkflowService gives one when the graph is saved. Unique, because
 * the inbound webhook finds the workflow by this key alone - two workflows
 * sharing one would mean one of them receives the other's mail.
 */
export class AddWorkflowIncomingEmailSecretKey1797000000000
  implements MigrationInterface
{
  public name: string = "AddWorkflowIncomingEmailSecretKey1797000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "incomingEmailSecretKey" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "UQ_7451cb0cff5b50e2cfc5863c55e" UNIQUE ("incomingEmailSecretKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "UQ_7451cb0cff5b50e2cfc5863c55e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "incomingEmailSecretKey"`,
    );
  }
}
