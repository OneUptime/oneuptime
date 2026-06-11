import MetricService from "Common/Server/Services/MetricService";

export interface ClickHouseJsonResult {
  data?: Array<Record<string, unknown>>;
}

/**
 * Shared read-only helpers for hand-written ClickHouse DataMigrations:
 * existence/column/DDL introspection used by guards so legacy migrations
 * no-op cleanly on installs where their target tables never existed
 * (e.g. V2 telemetry tables on a fresh V3 install).
 *
 * NOTE: this module previously also contained the chunked V2 -> V3
 * historical copy engine. That copy was removed by decision (2026-06-11):
 * the V3 cut is forward-only — V3 tables start fresh and history ages in
 * over the retention window. Operators who want to carry history forward
 * run the documented queries by hand via clickhouse-client instead; see
 * Internal/Docs/TelemetryV3UpgradeGuide.md.
 */
export default class ClickHouseMigrationUtil {
  public static async tableExists(table: string): Promise<boolean> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(`EXISTS TABLE ${table}`);
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    const row: Record<string, unknown> | undefined = json.data?.[0];
    return row ? Number(Object.values(row)[0]) === 1 : false;
  }

  public static async getColumns(table: string): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${table}' ORDER BY position`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return (json.data ?? []).map((r: Record<string, unknown>) => {
      return String(r["name"]);
    });
  }

  /** Stored CREATE statement of a table/view, or null if it does not exist. */
  public static async getCreateQuery(name: string): Promise<string | null> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = '${name}' LIMIT 1`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    const row: Record<string, unknown> | undefined = json.data?.[0];
    const createQuery: unknown = row?.["create_table_query"];
    return typeof createQuery === "string" ? createQuery : null;
  }
}
