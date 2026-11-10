import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Exceptions apart from traces in telemetry usage (issue #6356): a Traces
 * usage row (TelemetryUsageBilling) keeps everything it is billed for - its
 * spans and its exceptions - in dataIngestedInGB, as before, and records in
 * exceptionDataIngestedInGB how much of that was exceptions, for the usage
 * pages and the API to show apart. Nothing is billed from it: a row's cost is
 * still worked out from dataIngestedInGB alone.
 *
 * Generated with npm run generate-postgres-migration. A nullable numeric
 * with no default, so it is added without rewriting the table, and every row
 * counted before it is empty: its exceptions stay inside Traces, as they
 * were shown when it was counted.
 */
export class AddTelemetryUsageExceptionsPart1809080476356
  implements MigrationInterface
{
  public name: string = "AddTelemetryUsageExceptionsPart1809080476356";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD "exceptionDataIngestedInGB" numeric`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP COLUMN "exceptionDataIngestedInGB"`,
    );
  }
}
