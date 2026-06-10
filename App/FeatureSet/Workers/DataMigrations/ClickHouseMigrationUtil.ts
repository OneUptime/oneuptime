import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

export interface ClickHouseJsonResult {
  data?: Array<Record<string, unknown>>;
}

export interface PartitionwiseCopyOptions {
  sourceTable: string;
  destinationTable: string;
  /**
   * Destination-column → source-column overrides for renamed columns.
   * Columns not listed map by identical name.
   */
  renameMap?: Record<string, string>;
  /** Log/error message prefix — usually the migration name. */
  logPrefix: string;
}

/*
 * Progress marker for partition-wise table copies: one row per
 * (tableName, partition) that finished copying. Re-runs after a partial
 * failure resume from the partitions that are still missing instead of
 * re-copying whole tables — a whole-table re-copy would duplicate rows and
 * double-fire any materialized views reading from the destination.
 */
const COPY_PROGRESS_TABLE: string = "TelemetryV3CopyProgress";

/*
 * Shared ClickHouse helpers for data migrations. All statements run through
 * `MetricService` — every analytics service shares one ClickHouse connection,
 * and each statement names its own table.
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

  /*
   * `partition_id` (not the human-readable `partition` value) so the copy can
   * filter on the `_partition_id` virtual column — an exact string match with
   * no quoting concerns for tuple/expression partition keys.
   */
  private static async getActivePartitionIds(
    table: string,
  ): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT DISTINCT partition_id FROM system.parts WHERE database = currentDatabase() AND table = '${table}' AND active ORDER BY partition_id`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return (json.data ?? []).map((r: Record<string, unknown>) => {
      return String(r["partition_id"]);
    });
  }

  private static async ensureCopyProgressTable(): Promise<void> {
    await MetricService.execute(
      `CREATE TABLE IF NOT EXISTS ${COPY_PROGRESS_TABLE} (tableName String, \`partition\` String, copiedAt DateTime) ENGINE = MergeTree() ORDER BY (tableName, \`partition\`)`,
    );
  }

  private static async getCopiedPartitionIds(
    table: string,
  ): Promise<Set<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT DISTINCT \`partition\` FROM ${COPY_PROGRESS_TABLE} WHERE tableName = '${table}'`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return new Set(
      (json.data ?? []).map((r: Record<string, unknown>) => {
        return String(r["partition"]);
      }),
    );
  }

  private static async markPartitionCopied(
    table: string,
    partitionId: string,
  ): Promise<void> {
    await MetricService.execute(
      `INSERT INTO ${COPY_PROGRESS_TABLE} (tableName, \`partition\`, copiedAt) VALUES ('${table}', '${partitionId}', now())`,
    );
  }

  /**
   * Copies `sourceTable` → `destinationTable` one active partition at a time,
   * recording per-partition progress in `TelemetryV3CopyProgress` so a re-run
   * only copies the partitions that are still missing.
   *
   * Only destination columns whose source column exists (after `renameMap`)
   * are copied — destination-only columns (e.g. `entityKeys`) fall back to
   * the destination table's DEFAULT. Errors are collected and returned, not
   * thrown, so callers can attempt every table and fail loudly at the end.
   */
  public static async copyTablePartitionwise(
    options: PartitionwiseCopyOptions,
  ): Promise<Array<string>> {
    const src: string = options.sourceTable;
    const dst: string = options.destinationTable;

    let destinationColumns: Array<string>;
    let sourceColumns: Array<string>;
    let partitionIds: Array<string>;
    let copiedPartitionIds: Set<string>;

    try {
      await this.ensureCopyProgressTable();
      destinationColumns = await this.getColumns(dst);
      sourceColumns = await this.getColumns(src);
      partitionIds = await this.getActivePartitionIds(src);
      copiedPartitionIds = await this.getCopiedPartitionIds(src);
    } catch (err) {
      logger.error(`${options.logPrefix}: failed preparing ${src} -> ${dst}:`);
      logger.error(err as Error);
      return [`${src} -> ${dst}: ${(err as Error).message}`];
    }

    if (destinationColumns.length === 0) {
      return [`${src} -> ${dst}: ${dst} has no columns — was it created?`];
    }

    const renameMap: Record<string, string> = options.renameMap ?? {};
    const sourceColumnSet: Set<string> = new Set(sourceColumns);

    const copyColumns: Array<string> = destinationColumns.filter(
      (c: string) => {
        return sourceColumnSet.has(renameMap[c] ?? c);
      },
    );

    if (copyColumns.length === 0) {
      return [`${src} -> ${dst}: no overlapping columns — cannot copy.`];
    }

    const insertList: string = copyColumns
      .map((c: string) => {
        return `\`${c}\``;
      })
      .join(", ");
    const selectList: string = copyColumns
      .map((c: string) => {
        return `\`${renameMap[c] ?? c}\``;
      })
      .join(", ");

    const errors: Array<string> = [];

    for (const partitionId of partitionIds) {
      /*
       * Marked partitions completed on a previous run. A crash after a
       * partition's INSERT committed but before its marker row was written
       * can still duplicate that single partition on the next run — an
       * accepted tradeoff for keeping the marker a plain row-per-partition
       * table (no transactional coupling to the copy itself).
       */
      if (copiedPartitionIds.has(partitionId)) {
        logger.info(
          `${options.logPrefix}: ${src} partition ${partitionId} already copied — skipping.`,
        );
        continue;
      }

      try {
        await MetricService.execute(
          `INSERT INTO ${dst} (${insertList}) SELECT ${selectList} FROM ${src} WHERE _partition_id = '${partitionId}'`,
        );
        await this.markPartitionCopied(src, partitionId);
        logger.info(
          `${options.logPrefix}: copied ${src} partition ${partitionId} -> ${dst}.`,
        );
      } catch (err) {
        logger.error(
          `${options.logPrefix}: failed copying ${src} partition ${partitionId} -> ${dst}:`,
        );
        logger.error(err as Error);
        errors.push(
          `${src} -> ${dst} (partition ${partitionId}): ${(err as Error).message}`,
        );
      }
    }

    if (partitionIds.length === 0) {
      logger.info(
        `${options.logPrefix}: ${src} has no active partitions — nothing to copy.`,
      );
    }

    return errors;
  }
}
