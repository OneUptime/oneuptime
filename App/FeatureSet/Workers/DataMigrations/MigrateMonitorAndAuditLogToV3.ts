import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Time-partition the last two telemetry tables. `MonitorLog` and `AuditLog`
 * were `sipHash64(projectId) % 16` partitioned; the models now use
 * `toYYYYMMDD(time)` (daily) and `toYYYYMM(createdAt)` (monthly) respectively
 * (+ `ttl_only_drop_parts`). The partition key is fixed at table creation, so
 * they are cut to new names (`MonitorLogV3`, `AuditLogV2`) and data is copied.
 *
 * No column rename here, so the copy uses an explicit name-matched column
 * list (robust to physical column-order drift from past ALTERs). The old
 * tables are retained as a rollback window (TTL self-drains).
 */
interface ClickHouseJsonResult {
  data?: Array<Record<string, unknown>>;
}

export default class MigrateMonitorAndAuditLogToV3 extends DataMigrationBase {
  public constructor() {
    super("MigrateMonitorAndAuditLogToV3");
  }

  public override async migrate(): Promise<void> {
    // Ensure the new time-partitioned tables exist (idempotent).
    await AnalyticsTableManagement.createTables();

    const copies: Array<[string, string]> = [
      ["MonitorLogV2", "MonitorLogV3"],
      ["AuditLogV1", "AuditLogV2"],
    ];

    for (const [src, dst] of copies) {
      try {
        if (!(await this.tableExists(src))) {
          logger.info(
            `MigrateMonitorAndAuditLogToV3: ${src} not present — skipping copy.`,
          );
          continue;
        }
        const columns: Array<string> = await this.getColumns(dst);
        if (columns.length === 0) {
          logger.warn(
            `MigrateMonitorAndAuditLogToV3: no columns for ${dst} — skip.`,
          );
          continue;
        }
        // No rename: identical column names in src and dst. The explicit list
        // makes the copy name-aligned regardless of physical column order.
        const list: string = columns.map((c: string) => `\`${c}\``).join(", ");
        await MetricService.execute(
          `INSERT INTO ${dst} (${list}) SELECT ${list} FROM ${src}`,
        );
        logger.info(`MigrateMonitorAndAuditLogToV3: copied ${src} -> ${dst}.`);
      } catch (err) {
        logger.error(`MigrateMonitorAndAuditLogToV3: failed copying ${src} -> ${dst}:`);
        logger.error(err as Error);
      }
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
