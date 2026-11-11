import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Alerts on failed Power BI refreshes, on the BI tool (DataBiConnection):
 * whether it alerts on them (alertOnFailedRefreshes), the monitor it keeps
 * for them (refreshMonitorId), and the datasets whose last refresh failed,
 * as the hourly read left them (failedRefreshes).
 *
 * Every column is new and nullable, the one default a constant: Postgres
 * adds them without rewriting a row. A tool added before keeps not alerting
 * until someone turns it on.
 */
export class AddDataBiConnectionRefreshAlerts1809100612300
  implements MigrationInterface
{
  public name: string = "AddDataBiConnectionRefreshAlerts1809100612300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "alertOnFailedRefreshes" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "refreshMonitorId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" ADD "failedRefreshes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "failedRefreshes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "refreshMonitorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataBiConnection" DROP COLUMN "alertOnFailedRefreshes"`,
    );
  }
}
