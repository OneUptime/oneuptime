import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "CloudAccount" gains "aiAgentKeys": the SHA-256 of the key the account's
 * Cloud AI agent connects with, and of the keys made for its setup command
 * that it has not connected with yet (each for a day), with whether the
 * project's telemetry ingestion key still connects it - never the keys
 * themselves (CloudAccountService, Types/CloudConnection/CloudAiAgentKey).
 * No role may read or write it. Empty for every account there is: its agent
 * keeps connecting with the ingestion key until its setup command runs
 * again.
 *
 * A nullable column without a default adds no value to any row, so nothing
 * scans or rewrites the table.
 */
export class AddCloudAccountAiAgentKeys1808994400000
  implements MigrationInterface
{
  public name: string = "AddCloudAccountAiAgentKeys1808994400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiAgentKeys" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAgentKeys"`,
    );
  }
}
