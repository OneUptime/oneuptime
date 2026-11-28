import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * MonitorStatusTimeline.pausedBy (issue #11433): what paused a monitor's
 * checks for a status event whose time is left out of uptime - an incident
 * declared by hand, scheduled maintenance, or both - so that time says
 * "paused", and why, apart from time with monitoring turned off. A nullable
 * column with no default: no table rewrite, and every row from before reads
 * as it did until the data migration fills in the paused ones
 * (RecordWhatPausedMonitorsOnStatusTimelines).
 */
export class AddMonitorStatusTimelinePausedBy1809188011433
  implements MigrationInterface
{
  public name = "AddMonitorStatusTimelinePausedBy1809188011433";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD "pausedBy" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP COLUMN "pausedBy"`,
    );
  }
}
