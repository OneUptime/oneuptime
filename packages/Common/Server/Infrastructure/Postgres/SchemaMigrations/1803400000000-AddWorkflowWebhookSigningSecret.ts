import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. Huntress became a
 * workflow trigger: the workflow keeps the signing secret Huntress signs
 * its requests with ("webhookSigningSecret", encrypted, write-only),
 * whether one is saved, and what the last request to its Huntress trigger
 * did (when one was last accepted, and why one was last refused).
 *
 * Every column is nullable or has a default, so on Postgres 11 and later
 * each ADD is a change to the table's metadata only: no row is rewritten.
 * The Huntress connections themselves become workflows in the Workers'
 * MoveHuntressConnectionsToWorkflows data migration, which reads their
 * tables - left as they are - after this has run.
 */
export class AddWorkflowWebhookSigningSecret1803400000000
  implements MigrationInterface
{
  public name: string = "AddWorkflowWebhookSigningSecret1803400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "webhookSigningSecret" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "isWebhookSigningSecretSet" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "lastWebhookRequestAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "lastWebhookError" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "lastWebhookErrorAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "lastWebhookErrorAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "lastWebhookError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "lastWebhookRequestAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "isWebhookSigningSecretSet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "webhookSigningSecret"`,
    );
  }
}
