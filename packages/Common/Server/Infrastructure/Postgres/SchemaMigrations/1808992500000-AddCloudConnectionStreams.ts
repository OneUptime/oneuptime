import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A cloud connection's streams (Types/CloudConnection/CloudStream): an AWS
 * account's CloudWatch metrics and logs, delivered through Amazon Data
 * Firehose. "CloudConnection" gains three nullable columns with no default:
 *
 *   - "streamKeyHashes": the SHA-256 of the connection's stream key, and of
 *     the key it replaced while that one still works. Server only.
 *   - "streamKeyCreatedAt": when the key was made; empty, the connection
 *     streams nothing.
 *   - "streamSummary": what its streams delivered, and the last delivery
 *     refused.
 *
 * No index or foreign key is added to the existing table, so nothing scans,
 * locks or rewrites it.
 */
export class AddCloudConnectionStreams1808992500000
  implements MigrationInterface
{
  public name: string = "AddCloudConnectionStreams1808992500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD "streamKeyHashes" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD "streamKeyCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD "streamSummary" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP COLUMN "streamSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP COLUMN "streamKeyCreatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP COLUMN "streamKeyHashes"`,
    );
  }
}
