import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issues #6480 and
 * #6987). MonitorStatusTimeline.isMonitoringOff says a status event covers
 * time with the monitor's monitoring turned off: nothing checked the monitor
 * then, so uptime, status page bars, SLOs and monitor group graphs leave
 * that time out instead of counting it as the status the monitor was left
 * at. Turning monitoring off or back on starts such a status event
 * (MonitorStatusTimelineService.recordMonitoringSwitch).
 *
 * A NOT NULL column with a constant default rewrites no row, however many
 * status events a project has: every event written before it reads as
 * monitored, as it was counted. The data migration
 * RecordMonitoringOffOnStatusTimelines then marks, from now on, the monitors
 * whose monitoring is already off.
 */
export class AddMonitorStatusTimelineIsMonitoringOff1809122600000
  implements MigrationInterface
{
  public name: string = "AddMonitorStatusTimelineIsMonitoringOff1809122600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD "isMonitoringOff" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP COLUMN "isMonitoringOff"`,
    );
  }
}
