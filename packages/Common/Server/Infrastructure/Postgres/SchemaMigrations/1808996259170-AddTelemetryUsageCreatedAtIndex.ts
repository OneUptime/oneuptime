import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddTelemetryUsageRetention1808996259160, and moved into a migration of its
 * own: "TelemetryUsageBilling" already holds rows on installs with billing,
 * so its index is built online, without blocking the usage the billing run
 * stages meanwhile. A usage row's createdAt is the UTC day its usage is for,
 * and the usage pages read a range of days for every project at once (the
 * Admin Dashboard's Telemetry Usage), and the daily cleanup deletes the days
 * past the retention, both by it. Safe to run again after a stop part way.
 */
export class AddTelemetryUsageCreatedAtIndex1808996259170
  implements MigrationInterface
{
  public name: string = "AddTelemetryUsageCreatedAtIndex1808996259170";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_229a2aaa9b4df04bfa5551b455" ON "TelemetryUsageBilling" ("createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_229a2aaa9b4df04bfa5551b455"`,
    );
  }
}
