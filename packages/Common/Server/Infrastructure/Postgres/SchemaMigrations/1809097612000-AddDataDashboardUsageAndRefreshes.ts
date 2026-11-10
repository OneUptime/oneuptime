import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Power BI usage and refresh history on BI dashboards (#6610, part two).
 *
 *  - DataDashboard: its views, viewers and latest view over the last 28
 *    days, who views it most (usageSummary), the ledger they are counted
 *    from (usageLedger, never returned by the API), and its data's last
 *    refresh and latest refreshes (lastRefreshStatus, lastRefreshAt,
 *    refreshHistory).
 *  - DataBiConnection: the hours of the activity log read so far
 *    (usageReadFrom, usageReadUntil), and what the last read could not read
 *    (lastSyncWarning).
 *
 * Every column is new and nullable: Postgres adds them without touching a
 * row, and the next hourly read fills them in.
 */
export class AddDataDashboardUsageAndRefreshes1809097612000
  implements MigrationInterface
{
  public name: string = "AddDataDashboardUsageAndRefreshes1809097612000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "lastSyncWarning" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "usageReadFrom" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "usageReadUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "viewCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "viewerCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "lastViewedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "usageSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "usageLedger" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "lastRefreshStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "lastRefreshAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" ADD "refreshHistory" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "refreshHistory"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "lastRefreshAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "lastRefreshStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "usageLedger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "usageSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "lastViewedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "viewerCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "viewCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "usageReadUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "usageReadFrom"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "lastSyncWarning"`,
    );
  }
}
