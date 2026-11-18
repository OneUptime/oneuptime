import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written to match TypeORM's migration:generate for the models, and
 * numbered after the last registered migration.
 *
 * Why a BI tool's dashboards are, or are not, tied to watched tables
 * (#9507): each tool's lineage summary of its last read
 * (DataBiConnection.lineageSummary) - the tables its dashboards read and
 * how many matched, the data sources behind them, and what keeps the rest
 * from matching, such as a Power BI tenant setting that is off - and what
 * each dashboard is built on, as its tool says (DataDashboard.upstream):
 * its datasets and where their data comes from.
 *
 * Two nullable JSON columns, no default, no index, no key, nothing
 * backfilled: adding them rewrites no row, a server of the release before
 * ignores them, and the next hourly read of each tool fills them in.
 */
export class AddBiLineageSummaryAndDashboardUpstream1809183870000
  implements MigrationInterface
{
  public name: string = "AddBiLineageSummaryAndDashboardUpstream1809183870000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "lineageSummary" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "DataDashboard" ADD "upstream" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataDashboard" DROP COLUMN "upstream"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "lineageSummary"`,
    );
  }
}
