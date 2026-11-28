import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #11119). A
 * probe's pending count - what its KEDA autoscaler reads, every 30 seconds
 * per probe - counts its due monitor probes whose monitor and project may
 * be probed. With thousands due, Postgres joined them to "Monitor" by
 * reading the whole table: 9,925 of the count's 10,689 pages at 39,700
 * monitors, and more with every monitor added to the install. The index
 * holds the id of every monitor a probe may check now (the monitor's half
 * of MonitorProbeService.getProbeableSql), so the join reads the ids alone:
 * 155 pages for 39,700 monitors. "Monitor" is written all the time
 * (heartbeats, sweeps, status changes), so it is built online, without
 * blocking them. Safe to run again after a stop part way.
 */
export class AddMonitorProbeableIndex1809187791119
  implements MigrationInterface
{
  public name: string = "AddMonitorProbeableIndex1809187791119";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_35665422ae411fa9290bc619e9" ON "Monitor" ("_id") WHERE "isArchived" = false AND "disableActiveMonitoring" = false AND "disableActiveMonitoringBecauseOfManualIncident" = false AND "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_35665422ae411fa9290bc619e9"`,
    );
  }
}
