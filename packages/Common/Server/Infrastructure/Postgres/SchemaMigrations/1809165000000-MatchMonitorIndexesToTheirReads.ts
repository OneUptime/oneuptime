import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration after the Monitor
 * model's indexes were matched to what reads them.
 *
 * Built:
 *
 *   ("autoProvisionedNetworkDeviceId") WHERE it IS NOT NULL - the monitors
 *     made for a network device: the device's pages, the alert policy engine,
 *     the device delete's count of them and its foreign key check (ON DELETE
 *     RESTRICT), which read the whole project (or, the check, the whole
 *     table) without it. The unique index on the column requires a template,
 *     which none of them imply.
 *   ("projectId") of the monitors the Monitors menu's Probe Disconnected,
 *     Probe Disabled and Disabled entries count, each partial - counted again
 *     on every change to a monitor.
 *   ("projectId", "isArchived", "createdAt") in place of ("projectId",
 *     "isArchived"): the list's default order, newest first.
 *   ("monitorType", "_id") in place of ("monitorType"): the heartbeat and
 *     server sweeps page through one type by id, and read the whole table
 *     in id order without it.
 *
 * Dropped: the bare ("projectId"), which those composites lead with; a
 * second index on "slug", whose unique constraint has one; "monitoringInterval"
 * and the incoming email's last received time, which nothing filters on; the
 * two pause reasons, filtered only by `= false`, which every monitor but a
 * paused one matches; the bare ("disableActiveMonitoring"), now the
 * Disabled count's partial; and the timestamps the busiest writes move -
 * telemetryMonitorLastMonitorAt and NextMonitorAt (every minute), the
 * incoming request and email heartbeat stamps (every 30 seconds) and
 * serverMonitorRequestReceivedAt (every report). An update that changes a
 * column an index names cannot be HOT: it writes an entry into every index
 * on the table and leaves a dead row version for vacuum. Their sweeps find
 * their monitors by type.
 *
 * Online, outside a transaction: heartbeats, sweeps and status changes
 * write "Monitor" all the time. Every new index is built before an old one
 * goes, so no read is left without the index it had. Safe to run again
 * after a stop part way.
 */
export class MatchMonitorIndexesToTheirReads1809165000000
  implements MigrationInterface
{
  public name: string = "MatchMonitorIndexesToTheirReads1809165000000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_1c537aa7885967f19fb1f76d1c" ON "Monitor" ("projectId") WHERE "disableActiveMonitoring" = true AND "isArchived" = false AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_32415a529149e372d15b03aeeb" ON "Monitor" ("projectId") WHERE "isNoProbeEnabledOnThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_7211446751a8adf91b8dec60c7" ON "Monitor" ("projectId") WHERE "isAllProbesDisconnectedFromThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_5856097e6093bb00fe11ee6d18" ON "Monitor" ("monitorType", "_id") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_26979816e9ae6fcec4920a9f89" ON "Monitor" ("autoProvisionedNetworkDeviceId") WHERE "autoProvisionedNetworkDeviceId" IS NOT NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d624869a64f9b590b387f71985" ON "Monitor" ("projectId", "isArchived", "createdAt") `,
    );

    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_996acfb590bda327843f78b7ad"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_42ecc6e0ac9984cd24d5f9ddd8"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_db5cc02633b36957c9be4d70c6"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1e0f03c5e067eeb505b2b87aa8"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ea5170227069c85269b3a6db93"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_9c8f4b9103fa6b62ff5a121f36"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_28d1e0cdf3fcf1ac30249f5d3a"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_540a4857bf04eabc59775ca210"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_02bae6cdc6d5b3092ac393fbb3"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_62cf90e5fbcd9f3742ed35a2bb"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_185f36c4cebf452333df869187"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_33a77f31ba5b28905464433756"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ff92577021975c63c570943872"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_cdc971b41d78e4bed90a1d611b"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are the generated plain ones. The old indexes come back before
   * the new ones go.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff92577021975c63c570943872" ON "Monitor" ("monitorType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33a77f31ba5b28905464433756" ON "Monitor" ("incomingEmailMonitorHeartbeatCheckedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_185f36c4cebf452333df869187" ON "Monitor" ("incomingEmailMonitorLastEmailReceivedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62cf90e5fbcd9f3742ed35a2bb" ON "Monitor" ("incomingRequestMonitorHeartbeatCheckedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02bae6cdc6d5b3092ac393fbb3" ON "Monitor" ("telemetryMonitorLastMonitorAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_540a4857bf04eabc59775ca210" ON "Monitor" ("telemetryMonitorNextMonitorAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28d1e0cdf3fcf1ac30249f5d3a" ON "Monitor" ("serverMonitorRequestReceivedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c8f4b9103fa6b62ff5a121f36" ON "Monitor" ("disableActiveMonitoringBecauseOfManualIncident") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea5170227069c85269b3a6db93" ON "Monitor" ("disableActiveMonitoringBecauseOfScheduledMaintenanceEvent") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e0f03c5e067eeb505b2b87aa8" ON "Monitor" ("disableActiveMonitoring") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db5cc02633b36957c9be4d70c6" ON "Monitor" ("monitoringInterval") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42ecc6e0ac9984cd24d5f9ddd8" ON "Monitor" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_996acfb590bda327843f78b7ad" ON "Monitor" ("projectId") `,
    );

    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d624869a64f9b590b387f71985"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_26979816e9ae6fcec4920a9f89"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_5856097e6093bb00fe11ee6d18"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_7211446751a8adf91b8dec60c7"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_32415a529149e372d15b03aeeb"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1c537aa7885967f19fb1f76d1c"`,
    );
  }
}
