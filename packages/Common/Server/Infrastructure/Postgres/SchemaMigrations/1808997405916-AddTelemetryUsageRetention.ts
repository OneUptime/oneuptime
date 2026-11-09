import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Telemetry usage on every install (issue #5916): how long the daily usage
 * rows (TelemetryUsageBilling) are kept is an instance-wide setting now,
 * GlobalConfig.telemetryUsageRetentionInDays (Admin Dashboard > Settings >
 * Data Retention), with billing on or off. Empty is 120 days, the retention
 * the rows had before, so nothing changes until an admin sets it.
 *
 * Generated with npm run generate-postgres-migration. A nullable column with
 * no default, so it is added without rewriting the table. The createdAt
 * index the same model change asks for is built online, in
 * AddTelemetryUsageCreatedAtIndex1808997415916.
 */
export class AddTelemetryUsageRetention1808997405916
  implements MigrationInterface
{
  public name: string = "AddTelemetryUsageRetention1808997405916";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telemetryUsageRetentionInDays" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telemetryUsageRetentionInDays"`,
    );
  }
}
