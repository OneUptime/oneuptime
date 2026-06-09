import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Telemetry V3 cut.
 *
 * The analytics models were (a) renamed `serviceId`/`serviceType` →
 * `primaryEntityId`/`primaryEntityType` and (b) switched from
 * `sipHash64(projectId) % 16` to time-based partitioning. Neither can be
 * applied in place — `serviceId` is part of the ClickHouse sort key and
 * the partition key is fixed at table creation — so the signal tables are
 * cut to a new `…V3` name and data is copied across.
 *
 * Steps:
 *   1. Drop the 3 stale metric MVs (old `serviceId` column + sipHash
 *      partition, reading `FROM MetricItemV2`).
 *   2. Recreate every analytics table + MV from the updated models via the
 *      schema-sync helpers — creating the `…V3` signal tables and rebuilding
 *      the MVs (`FROM MetricItemV3`). Idempotent.
 *   3. Copy each `…V2` → `…V3` with an explicit, NAME-BASED column mapping
 *      (`serviceId`→`primaryEntityId`, `serviceType`→`primaryEntityType`).
 *      A positional `SELECT *` is NOT safe: `serviceType` was appended to the
 *      V2 tables by an earlier ALTER, so it sits last in V2's physical column
 *      order whereas V3 places `primaryEntityType` second. The mapping is
 *      derived from the live V3 column list so it stays correct as columns
 *      evolve.
 *
 * The `…V2` tables are intentionally retained (rollback window; they
 * self-drain via their `retentionDate` TTL). A follow-up migration can DROP
 * them once V3 is confirmed.
 *
 * All statements run through `MetricService` — every analytics service shares
 * one ClickHouse connection, and each statement names its own table.
 *
 * NOTE: large deployments should copy step 3 in time-windowed batches rather
 * than one `INSERT … SELECT`; the single statement is fine for typical/test
 * volumes.
 */
interface ClickHouseJsonResult {
  data?: Array<Record<string, unknown>>;
}

export default class MigrateTelemetryToV3PrimaryEntityId extends DataMigrationBase {
  public constructor() {
    super("MigrateTelemetryToV3PrimaryEntityId");
  }

  public override async migrate(): Promise<void> {
    // 1. Drop stale MV triggers + target tables.
    const staleViews: Array<string> = [
      "MetricItemAggMV1m_mv",
      "MetricItemAggMV1mByHost_mv",
      "MetricBaselineHourly_mv",
    ];
    const staleTables: Array<string> = [
      "MetricItemAggMV1m",
      "MetricItemAggMV1mByHost",
      "MetricBaselineHourly",
    ];
    for (const view of staleViews) {
      await this.safeExec(`DROP VIEW IF EXISTS ${view}`);
    }
    for (const table of staleTables) {
      await this.safeExec(`DROP TABLE IF EXISTS ${table}`);
    }

    // 2. Recreate tables + MVs from the updated models.
    await AnalyticsTableManagement.createTables();
    await AnalyticsTableManagement.createMaterializedViews();

    // 3. Copy historical signal data V2 -> V3 with a name-based column map.
    const copies: Array<[string, string]> = [
      ["LogItemV2", "LogItemV3"],
      ["MetricItemV2", "MetricItemV3"],
      ["SpanItemV2", "SpanItemV3"],
      ["ExceptionItemV2", "ExceptionItemV3"],
      ["ProfileItemV2", "ProfileItemV3"],
      ["ProfileSampleItemV2", "ProfileSampleItemV3"],
    ];

    for (const [v2, v3] of copies) {
      try {
        if (!(await this.tableExists(v2))) {
          logger.info(
            `MigrateTelemetryToV3: ${v2} not present (fresh install) — skipping copy.`,
          );
          continue;
        }

        // V3 column list (storage order). Map the two renamed columns back
        // to their V2 source names; everything else maps by identical name.
        const v3Columns: Array<string> = await this.getColumns(v3);
        if (v3Columns.length === 0) {
          logger.warn(`MigrateTelemetryToV3: no columns found for ${v3} — skip.`);
          continue;
        }
        const renameMap: Record<string, string> = {
          primaryEntityId: "serviceId",
          primaryEntityType: "serviceType",
        };
        const insertList: string = v3Columns.map((c: string) => `\`${c}\``).join(", ");
        const selectList: string = v3Columns
          .map((c: string) => `\`${renameMap[c] ?? c}\``)
          .join(", ");

        await MetricService.execute(
          `INSERT INTO ${v3} (${insertList}) SELECT ${selectList} FROM ${v2}`,
        );
        logger.info(`MigrateTelemetryToV3: copied ${v2} -> ${v3}.`);
      } catch (err) {
        logger.error(`MigrateTelemetryToV3: failed copying ${v2} -> ${v3}:`);
        logger.error(err as Error);
      }
    }
  }

  private async safeExec(sql: string): Promise<void> {
    try {
      await MetricService.execute(sql);
    } catch (err) {
      logger.error(err as Error);
    }
  }

  private async tableExists(table: string): Promise<boolean> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(`EXISTS TABLE ${table}`);
    const json: ClickHouseJsonResult = (await result.json()) as ClickHouseJsonResult;
    const row: Record<string, unknown> | undefined = json.data?.[0];
    return row ? Number(Object.values(row)[0]) === 1 : false;
  }

  private async getColumns(table: string): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${table}' ORDER BY position`,
      );
    const json: ClickHouseJsonResult = (await result.json()) as ClickHouseJsonResult;
    return (json.data ?? []).map((r: Record<string, unknown>) => String(r["name"]));
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
