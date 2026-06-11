import MetricService from "Common/Server/Services/MetricService";
import {
  ClickHouseSettings,
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import {
  DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES,
  DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES,
  DEFAULT_MAX_MEMORY_USAGE_IN_BYTES,
} from "Common/Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import logger from "Common/Server/Utils/Logger";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import Span from "Common/Models/AnalyticsModels/Span";

export interface ClickHouseJsonResult {
  data?: Array<Record<string, unknown>>;
}

/**
 * One (source partition × calendar month of the time column) copy unit.
 * Month chunks bound statement size (~1/3 of a sipHash partition at 90d
 * retention), keep the destination partition fan-out at <= ~31 daily
 * partitions (far under max_partitions_per_insert_block), and limit
 * source re-scan amplification on retry to roughly one month of one
 * partition.
 */
export interface CopyChunk {
  partitionId: string;
  month: number; // YYYYMM of the table's time column
  sourceRowCount: number; // rows in the chunk at enumeration time
}

export interface ChunkedCopyOptions {
  sourceTable: string;
  destinationTable: string;
  /** Time column used for month chunking — same name on source and destination. */
  timeColumn: string;
  /**
   * Destination sort-key columns. The chunk SELECT is ORDER BYed on these
   * (mapped through `renameMap` to source names, `_id`-tiebroken) so the
   * insert's block contents and boundaries are deterministic across
   * retries — which is what makes the per-chunk
   * `insert_deduplication_token` actually drop retried blocks.
   */
  destinationSortKeys: Array<string>;
  /**
   * Destination-column → source-column overrides for renamed columns.
   * Columns not listed map by identical name.
   */
  renameMap?: Record<string, string> | undefined;
  /** Log/error message prefix — usually the migration/cron name. */
  logPrefix: string;
  /**
   * Stop STARTING new chunks once Date.now() passes this. Chunks already
   * running are awaited. Omit to copy every pending chunk (boot
   * migrations); the backfill cron passes a ~50s budget per tick.
   */
  deadlineAtInMs?: number | undefined;
}

export interface ChunkedCopyResult {
  totalChunks: number;
  chunksAlreadyCopied: number;
  chunksCopiedNow: number;
  /** Marked copied from a finished-but-unmarked predecessor in system.query_log. */
  chunksRecovered: number;
  /** Skipped because a predecessor with the same query-id prefix is still in system.processes. */
  chunksSkippedStillRunning: number;
  deadlineReached: boolean;
  errors: Array<string>;
}

export interface SweepResult {
  chunksSwept: number;
  errors: Array<string>;
}

/** One V2 → V3 telemetry signal-table copy, consumed by the BackfillTelemetryV3 cron. */
export interface TelemetrySignalCopyPair {
  sourceTable: string;
  destinationTable: string;
  timeColumn: string;
  destinationSortKeys: Array<string>;
  renameMap: Record<string, string>;
  /**
   * Materialized views that must exist (and read FROM the destination)
   * before any data is copied — copying rows before the MVs exist would
   * permanently skip their aggregates for the copied history.
   */
  requiredViews: Array<string>;
}

/*
 * Progress marker for chunk-wise table copies: one row per
 * (tableName, chunk) that finished copying, where chunk is
 * '<partitionId>:<YYYYMM>' (legacy rows from the pre-chunking engine hold
 * a bare '<partitionId>' and are honored as "whole partition copied").
 * `rowCount` records the chunk's source row count just before the INSERT
 * ran — the baseline the tail sweep compares against. A special
 * '__completed__' row per table marks "all chunks copied + tail sweep
 * done"; the backfill cron is a no-op for completed tables.
 */
const COPY_PROGRESS_TABLE: string = "TelemetryV3CopyProgress";

/** Marker `partition` value of the per-table "backfill + sweep finished" row. */
export const COPY_COMPLETED_MARKER: string = "__completed__";

/*
 * Per-chunk deterministic identifiers.
 *
 * insert_deduplication_token: 'v3copy:<dst>:<partition>:<YYYYMM>'. The V3
 * destination tables carry non_replicated_deduplication_window = 10000
 * (model tableSettings; `ensureDedupWindow` ALTERs it onto destinations
 * and their MV target tables that predate the setting), so a retried
 * chunk dedups block-by-block. Verified empirically on dev ClickHouse
 * 25.7.8 (2026-06-10), 3754-row / 8-block INSERT...SELECT into a
 * MergeTree destination with one SummingMergeTree MV and one
 * AggregatingMergeTree (AggregateFunction-state) MV hanging off it:
 *   - same statement + same token run 3x: destination stayed 3754 rows
 *     and BOTH MV targets stayed unchanged — but ONLY with
 *     deduplicate_blocks_in_dependent_materialized_views=1 AND the dedup
 *     window set on the MV TARGET tables. With the window only on the
 *     destination, the destination deduped but the MV targets DOUBLED
 *     (non-replicated MergeTree re-fires MVs for deduped blocks, unlike
 *     the documented Replicated behavior) — hence both knobs below.
 *   - re-running a chunk with the same token after the SOURCE grew does
 *     NOT no-op: added rows shift the sorted block boundaries, so only an
 *     unshifted prefix dedups (probe: 200 interleaved stragglers in a
 *     3954-row chunk re-inserted 3454 rows; even append-only growth
 *     re-inserted all but the first block). The tail sweep therefore uses
 *     an explicit count-guard (see `sweepTableChunked`) instead of
 *     relying on block dedup.
 *
 * query_id: '<token>:<unix-ms>' per attempt. Before re-running an
 * unmarked chunk the engine checks system.processes for a predecessor
 * with the chunk's query-id prefix (and skips it — no concurrent
 * double-run), and system.query_log for a predecessor that reached
 * QueryFinish (and just marks the chunk copied — no re-run). Verified on
 * dev: an INSERT whose client socket was destroyed at the 58s idle
 * timeout still reached QueryFinish at 80s server-side, which is exactly
 * the duplication mechanism this engine exists to close.
 */
function chunkToken(destinationTable: string, chunk: CopyChunk): string {
  return `v3copy:${destinationTable}:${chunk.partitionId}:${chunk.month}`;
}

function chunkKey(chunk: CopyChunk): string {
  return `${chunk.partitionId}:${chunk.month}`;
}

/*
 * Shared ClickHouse helpers for data migrations and the BackfillTelemetryV3
 * cron. All statements run through `MetricService` — every analytics service
 * shares one ClickHouse connection, and each statement names its own table.
 */
export default class ClickHouseMigrationUtil {
  /*
   * Per-process caches. Chunk lists are stable once the old-code pods stop
   * writing the V2 tables (minutes after a deploy), so re-enumerating the
   * full table every cron tick would be wasted scans; the tail sweep
   * re-enumerates fresh to catch anything that appeared after caching.
   */
  private static chunkListCache: Map<string, Array<CopyChunk>> = new Map();
  private static dedupWindowEnsured: Set<string> = new Set();
  private static progressTableEnsured: boolean = false;

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

  /**
   * The 6 telemetry signal copies of the V3 cut. Sort keys and the time
   * column are derived from the live V3 models so the copy can never
   * drift from the schema; the rename map covers the two columns the V3
   * cut renamed. Only the Metric destination has dependent MVs, and they
   * must exist before history is copied (their aggregates are only
   * produced at insert time).
   */
  public static getTelemetrySignalCopyPairs(): Array<TelemetrySignalCopyPair> {
    const renameMap: Record<string, string> = {
      primaryEntityId: "serviceId",
      primaryEntityType: "serviceType",
    };

    const pairFor: (
      sourceTable: string,
      model: AnalyticsBaseModel,
      requiredViews?: Array<string>,
    ) => TelemetrySignalCopyPair = (
      sourceTable: string,
      model: AnalyticsBaseModel,
      requiredViews?: Array<string>,
    ): TelemetrySignalCopyPair => {
      return {
        sourceTable: sourceTable,
        destinationTable: model.tableName,
        timeColumn: this.getPartitionTimeColumn(model),
        destinationSortKeys: model.sortKeys,
        renameMap: renameMap,
        requiredViews: requiredViews ?? [],
      };
    };

    return [
      pairFor("LogItemV2", new Log()),
      pairFor("MetricItemV2", new Metric(), [
        "MetricItemAggMV1m_mv",
        "MetricItemAggMV1mByHostV2_mv",
        "MetricBaselineHourly_mv",
      ]),
      pairFor("SpanItemV2", new Span()),
      pairFor("ExceptionItemV2", new ExceptionInstance()),
      pairFor("ProfileItemV2", new Profile()),
      pairFor("ProfileSampleItemV2", new ProfileSample()),
    ];
  }

  /** Extracts the column inside a 'toYYYYMMDD(col)' / 'toYYYYMM(col)' partition key. */
  public static getPartitionTimeColumn(model: AnalyticsBaseModel): string {
    const match: RegExpMatchArray | null =
      model.partitionKey.match(/^\w+\((\w+)\)$/);
    if (!match || !match[1]) {
      throw new Error(
        `${model.tableName}: partition key '${model.partitionKey}' is not a simple time function — cannot derive the chunking time column.`,
      );
    }
    return match[1];
  }

  public static async ensureCopyProgressTable(): Promise<void> {
    if (this.progressTableEnsured) {
      return;
    }
    await MetricService.execute(
      `CREATE TABLE IF NOT EXISTS ${COPY_PROGRESS_TABLE} (tableName String, \`partition\` String, copiedAt DateTime, rowCount UInt64 DEFAULT 0) ENGINE = MergeTree() ORDER BY (tableName, \`partition\`)`,
    );
    // Installs whose marker table predates chunking lack rowCount.
    await MetricService.execute(
      `ALTER TABLE ${COPY_PROGRESS_TABLE} ADD COLUMN IF NOT EXISTS rowCount UInt64 DEFAULT 0`,
    );
    this.progressTableEnsured = true;
  }

  public static async getCompletedTables(): Promise<Set<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT DISTINCT tableName FROM ${COPY_PROGRESS_TABLE} WHERE \`partition\` = '${COPY_COMPLETED_MARKER}'`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return new Set(
      (json.data ?? []).map((r: Record<string, unknown>) => {
        return String(r["tableName"]);
      }),
    );
  }

  public static async markTableCompleted(sourceTable: string): Promise<void> {
    await MetricService.execute(
      `INSERT INTO ${COPY_PROGRESS_TABLE} (tableName, \`partition\`, copiedAt, rowCount) VALUES ('${sourceTable}', '${COPY_COMPLETED_MARKER}', now(), 0)`,
    );
  }

  /**
   * Copies `sourceTable` → `destinationTable` one (partition × month)
   * chunk at a time, oldest months first (so the months still receiving
   * stragglers from old-code pods during a rolling deploy are copied
   * last, after those pods are gone). Each chunk INSERT...SELECT is
   * deterministic (ORDER BY destination sort keys + `_id` tiebreaker),
   * carries the chunk's dedup token, keeps its HTTP socket alive with
   * progress headers, and records its source row count in
   * `TelemetryV3CopyProgress` on success. Errors are collected and
   * returned, not thrown, so callers can attempt every chunk/table and
   * decide how loudly to fail.
   */
  public static async copyTableChunked(
    options: ChunkedCopyOptions,
  ): Promise<ChunkedCopyResult> {
    const src: string = options.sourceTable;
    const dst: string = options.destinationTable;

    const result: ChunkedCopyResult = {
      totalChunks: 0,
      chunksAlreadyCopied: 0,
      chunksCopiedNow: 0,
      chunksRecovered: 0,
      chunksSkippedStillRunning: 0,
      deadlineReached: false,
      errors: [],
    };

    let chunks: Array<CopyChunk>;
    let markers: Map<string, number>;
    let selectColumns: { insertList: string; selectList: string };
    let orderBy: string;
    let runningKeys: Set<string>;
    let finishedKeys: Set<string>;

    try {
      await this.ensureCopyProgressTable();
      await this.ensureDedupWindow(dst);
      selectColumns = await this.buildColumnLists(
        src,
        dst,
        options.renameMap ?? {},
      );
      orderBy = await this.buildDeterministicOrderBy(
        src,
        options.destinationSortKeys,
        options.renameMap ?? {},
      );
      chunks = await this.listChunks(src, options.timeColumn);
      markers = await this.getChunkMarkers(src);
      runningKeys = await this.getRunningChunkKeys(dst);
      finishedKeys = await this.getFinishedChunkKeys(dst);
    } catch (err) {
      logger.error(`${options.logPrefix}: failed preparing ${src} -> ${dst}:`);
      logger.error(err as Error);
      result.errors.push(`${src} -> ${dst}: ${(err as Error).message}`);
      return result;
    }

    result.totalChunks = chunks.length;
    if (chunks.length === 0) {
      logger.info(
        `${options.logPrefix}: ${src} has no rows — nothing to copy.`,
      );
      return result;
    }

    for (const chunk of chunks) {
      const key: string = chunkKey(chunk);

      /*
       * Marked chunks completed on a previous run. A bare partition id is
       * a legacy marker from the pre-chunking engine: the whole partition
       * was copied, so every chunk inside it is done.
       */
      if (markers.has(key) || markers.has(chunk.partitionId)) {
        result.chunksAlreadyCopied++;
        continue;
      }

      if (
        options.deadlineAtInMs !== undefined &&
        Date.now() >= options.deadlineAtInMs
      ) {
        result.deadlineReached = true;
        break;
      }

      // A predecessor for this chunk is still executing — let it finish.
      if (runningKeys.has(key)) {
        result.chunksSkippedStillRunning++;
        logger.info(
          `${options.logPrefix}: ${src} chunk ${key} still running from a previous attempt — skipping this tick.`,
        );
        continue;
      }

      /*
       * A predecessor finished server-side but its marker was never
       * written (client disconnect / process crash after the INSERT).
       * The data is in `dst`; just record the marker. The recorded
       * baseline is the chunk's CURRENT source count — slightly
       * optimistic if stragglers arrived after that predecessor's
       * snapshot, in which case only further source growth re-triggers
       * the sweep for this chunk; logged so the case is auditable.
       */
      if (finishedKeys.has(key)) {
        try {
          const recoveredCount: number = await this.countChunkRows(
            src,
            options.timeColumn,
            chunk,
          );
          await this.markChunkCopied(src, key, recoveredCount);
          result.chunksRecovered++;
          logger.warn(
            `${options.logPrefix}: ${src} chunk ${key} already finished server-side (found QueryFinish in system.query_log) — marked copied without re-running (${recoveredCount} rows).`,
          );
        } catch (err) {
          result.errors.push(
            `${src} -> ${dst} (chunk ${key}, recovery): ${(err as Error).message}`,
          );
        }
        continue;
      }

      try {
        /*
         * Baseline for the tail sweep, taken immediately before the
         * INSERT so it can only undercount what the INSERT's snapshot
         * sees (sub-second race) — an undercount makes the sweep re-copy
         * the chunk (bounded duplicates), never lose rows.
         */
        const preCount: number = await this.countChunkRows(
          src,
          options.timeColumn,
          chunk,
        );
        await this.runChunkInsert(options, chunk, selectColumns, orderBy);
        await this.markChunkCopied(src, key, preCount);
        result.chunksCopiedNow++;
        logger.info(
          `${options.logPrefix}: copied ${src} chunk ${key} -> ${dst} (${preCount} rows).`,
        );
      } catch (err) {
        logger.error(
          `${options.logPrefix}: failed copying ${src} chunk ${key} -> ${dst}:`,
        );
        logger.error(err as Error);
        result.errors.push(
          `${src} -> ${dst} (chunk ${key}): ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * Final tail sweep for rolling-deploy stragglers: rows old-code pods
   * wrote to the V2 table AFTER its chunk was copied. Re-enumerates the
   * table fresh and re-runs ONLY chunks whose current source count
   * exceeds the count recorded when the chunk was copied, with a
   * ':sweep'-suffixed dedup token. A grown chunk is re-inserted in full —
   * bounded duplicates for that chunk, loudly logged — because block
   * dedup against the original token cannot be relied on: source growth
   * shifts the sorted block boundaries (verified empirically on dev — see
   * the token comment above), so a same-token re-run is NOT a no-op.
   * Chunks covered only by a legacy whole-partition marker have no count
   * baseline and are skipped (logged). Expected steady-state: zero swept
   * chunks, because months still receiving writes are copied last, hours
   * after the old pods are gone.
   */
  public static async sweepTableChunked(
    options: ChunkedCopyOptions,
  ): Promise<SweepResult> {
    const src: string = options.sourceTable;
    const dst: string = options.destinationTable;
    const result: SweepResult = { chunksSwept: 0, errors: [] };

    try {
      const selectColumns: { insertList: string; selectList: string } =
        await this.buildColumnLists(src, dst, options.renameMap ?? {});
      const orderBy: string = await this.buildDeterministicOrderBy(
        src,
        options.destinationSortKeys,
        options.renameMap ?? {},
      );
      // Fresh enumeration — the cache may predate late stragglers.
      this.chunkListCache.delete(src);
      const chunks: Array<CopyChunk> = await this.listChunks(
        src,
        options.timeColumn,
      );
      const markers: Map<string, number> = await this.getChunkMarkers(src);
      const runningKeys: Set<string> = await this.getRunningChunkKeys(dst);

      for (const chunk of chunks) {
        const key: string = chunkKey(chunk);

        if (runningKeys.has(key)) {
          result.errors.push(
            `${src} chunk ${key}: copy still running — sweep deferred.`,
          );
          continue;
        }

        const recordedCount: number | undefined = markers.get(key);

        if (recordedCount === undefined) {
          if (markers.has(chunk.partitionId)) {
            // Legacy whole-partition marker: no per-chunk baseline.
            logger.info(
              `${options.logPrefix}: ${src} chunk ${key} covered by a legacy whole-partition marker — no count baseline, sweep skipped.`,
            );
            continue;
          }
          // A chunk that appeared after the copy finished (new month).
          logger.warn(
            `${options.logPrefix}: ${src} chunk ${key} appeared after the copy — copying it now.`,
          );
        } else if (chunk.sourceRowCount <= recordedCount) {
          continue; // nothing arrived after the copy — the common case.
        }

        try {
          logger.warn(
            `${options.logPrefix}: ${src} chunk ${key} grew from ${recordedCount ?? 0} to ${chunk.sourceRowCount} rows since its copy — re-running with a ':sweep' token. The previously copied rows of this chunk are re-inserted (bounded duplicates).`,
          );
          await this.runChunkInsert(
            options,
            chunk,
            selectColumns,
            orderBy,
            ":sweep",
          );
          await this.markChunkCopied(src, key, chunk.sourceRowCount);
          result.chunksSwept++;
        } catch (err) {
          result.errors.push(
            `${src} chunk ${key} (sweep): ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      result.errors.push(`${src} -> ${dst} (sweep): ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Per-call settings every backfill INSERT...SELECT runs with:
   *   - send_progress_in_http_headers + 20s interval: ClickHouse streams
   *     X-ClickHouse-Progress header lines, so the client's 58s socket
   *     IDLE timer (ClickhouseConfig request_timeout) never fires on a
   *     healthy long copy. Verified on dev through the production client
   *     config: an 80s INSERT...SELECT died at exactly 58.0s without
   *     progress headers and completed in 80.2s with them. Node's HTTP
   *     parser caps the buffered header section at 16KB (~117 progress
   *     lines), so 20s/line gives ~39min per statement before a client-
   *     side "Parse Error: Header overflow" — month-chunking keeps normal
   *     chunks well under that, and the system.processes/system.query_log
   *     recovery protocol turns an overflow into a skipped tick, never a
   *     duplicate. (10s would halve that horizon; 20s still resets the
   *     58s idle timer ~3x per window.)
   *   - bonus, also verified: with progress headers enabled a client
   *     disconnect makes the server-side query fail fast (EPIPE on the
   *     next header write → ExceptionWhileProcessing) instead of running
   *     to silent completion.
   *   - explicit block-size pins so retried chunks re-produce identical
   *     block boundaries even across server-default changes.
   *   - memory ceiling + spill thresholds match QuerySettingsHelper
   *     defaults; max_execution_time is a generous 4h server-side cap.
   */
  private static buildCopySettings(token: string): ClickHouseSettings {
    return {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "20000",
      max_execution_time: 14400,
      max_partitions_per_insert_block: "500",
      max_threads: 4,
      max_insert_threads: "1",
      max_block_size: "65536",
      min_insert_block_size_rows: "1048576",
      min_insert_block_size_bytes: "268435456",
      max_memory_usage: String(DEFAULT_MAX_MEMORY_USAGE_IN_BYTES),
      max_bytes_before_external_group_by: String(
        DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES,
      ),
      max_bytes_before_external_sort: String(
        DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES,
      ),
      insert_deduplication_token: token,
      deduplicate_blocks_in_dependent_materialized_views: 1,
    };
  }

  /** Keepalive + bounded-resource settings for the engine's own reads (enumeration GROUP BYs). */
  private static buildReadSettings(): ClickHouseSettings {
    return {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "20000",
      max_execution_time: 1800,
      max_threads: 4,
      max_memory_usage: String(DEFAULT_MAX_MEMORY_USAGE_IN_BYTES),
      max_bytes_before_external_group_by: String(
        DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES,
      ),
      max_bytes_before_external_sort: String(
        DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES,
      ),
    };
  }

  /**
   * Runs a single INSERT...SELECT with the full copy protocol (token,
   * keepalive settings, deterministic query id). Exposed for migrations
   * whose SELECT the generic column-intersection copier cannot express
   * (e.g. RekeyMetricHostRollupToEntityKey's computed entity key).
   */
  public static async executeCopyStatement(data: {
    sql: string;
    token: string;
  }): Promise<void> {
    const execOptions: ClickhouseExecuteOptions = {
      clickhouseSettings: this.buildCopySettings(data.token),
      queryId: `${data.token}:${Date.now()}`,
    };
    await MetricService.execute(data.sql, execOptions);
  }

  /**
   * Chunk keys ('<partition>:<YYYYMM>' — or '<partition>' for
   * partition-level copies) of copy statements into `destinationTable`
   * currently executing on the server. NOTE: system.processes is
   * node-local; OneUptime targets a single ClickHouse node.
   */
  public static async getRunningChunkKeys(
    destinationTable: string,
  ): Promise<Set<string>> {
    return this.collectChunkKeys(
      `SELECT query_id FROM system.processes WHERE query_id LIKE 'v3copy:${destinationTable}:%'`,
      destinationTable,
    );
  }

  /**
   * Chunk keys of copy statements into `destinationTable` that reached
   * QueryFinish — i.e. committed fully server-side — within the last 14
   * days, regardless of whether their client survived to see it.
   */
  public static async getFinishedChunkKeys(
    destinationTable: string,
  ): Promise<Set<string>> {
    return this.collectChunkKeys(
      `SELECT DISTINCT query_id FROM system.query_log WHERE event_date >= today() - 14 AND type = 'QueryFinish' AND query_id LIKE 'v3copy:${destinationTable}:%'`,
      destinationTable,
    );
  }

  private static async collectChunkKeys(
    sql: string,
    destinationTable: string,
  ): Promise<Set<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(sql, {
        clickhouseSettings: this.buildReadSettings(),
      });
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;

    const keys: Set<string> = new Set();
    const prefix: string = `v3copy:${destinationTable}:`;

    for (const row of json.data ?? []) {
      const queryId: string = String(row["query_id"]);
      if (!queryId.startsWith(prefix)) {
        continue;
      }
      // '<key parts...>:<unix-ms attempt suffix>'
      const parts: Array<string> = queryId.slice(prefix.length).split(":");
      if (parts.length < 2) {
        continue;
      }
      parts.pop(); // attempt timestamp
      // Sweep attempts ('<key>:sweep:<ts>') are not copy completions.
      if (parts[parts.length - 1] === "sweep") {
        continue;
      }
      keys.add(parts.join(":"));
    }

    return keys;
  }

  /**
   * Sets non_replicated_deduplication_window=10000 on the destination AND
   * on every MV target table fed from it. Required twice over: (a) plain
   * MergeTree ignores insert_deduplication_token without the window, and
   * (b) deduplicate_blocks_in_dependent_materialized_views only drops the
   * MV's re-fired blocks if the MV TARGET has its own window (verified on
   * dev — see the token comment). MODIFY SETTING is idempotent and
   * metadata-only; MV-driven inserts are unaffected because they only get
   * dedup ids when the triggering insert opts in.
   */
  public static async ensureDedupWindow(
    destinationTable: string,
  ): Promise<void> {
    if (this.dedupWindowEnsured.has(destinationTable)) {
      return;
    }

    const tables: Array<string> = [
      destinationTable,
      ...(await this.getDependentMaterializedViewTargets(destinationTable)),
    ];

    for (const table of tables) {
      await MetricService.execute(
        `ALTER TABLE ${table} MODIFY SETTING non_replicated_deduplication_window = 10000`,
      );
    }

    this.dedupWindowEnsured.add(destinationTable);
  }

  /** TO-target tables of materialized views that read FROM `table`. */
  private static async getDependentMaterializedViewTargets(
    table: string,
  ): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND engine = 'MaterializedView' AND create_table_query LIKE concat('%FROM ', currentDatabase(), '.${table}%')`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;

    const targets: Array<string> = [];
    const fromPattern: RegExp = new RegExp(
      `FROM\\s+\\w+\\.\`?${table}\`?(?![\\w])`,
    );

    for (const row of json.data ?? []) {
      const createQuery: string = String(row["create_table_query"]);
      if (!fromPattern.test(createQuery)) {
        continue; // LIKE prefix-matched a longer table name.
      }
      const toMatch: RegExpMatchArray | null = createQuery.match(
        /\sTO\s+\w+\.`?(\w+)`?/,
      );
      if (toMatch && toMatch[1]) {
        targets.push(toMatch[1]);
      }
    }

    return targets;
  }

  /**
   * Enumerates (partition × month) chunks with row counts via one GROUP
   * BY over the source's time column — only non-empty months, oldest
   * first. Cached per process (see chunkListCache).
   */
  private static async listChunks(
    sourceTable: string,
    timeColumn: string,
  ): Promise<Array<CopyChunk>> {
    const cached: Array<CopyChunk> | undefined =
      this.chunkListCache.get(sourceTable);
    if (cached) {
      return cached;
    }

    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT _partition_id AS partitionId, toYYYYMM(\`${timeColumn}\`) AS month, count() AS rowCount FROM ${sourceTable} GROUP BY partitionId, month ORDER BY month, partitionId`,
        { clickhouseSettings: this.buildReadSettings() },
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;

    const chunks: Array<CopyChunk> = (json.data ?? []).map(
      (r: Record<string, unknown>) => {
        return {
          partitionId: String(r["partitionId"]),
          month: Number(r["month"]),
          sourceRowCount: Number(r["rowCount"]),
        };
      },
    );

    this.chunkListCache.set(sourceTable, chunks);
    return chunks;
  }

  private static async countChunkRows(
    sourceTable: string,
    timeColumn: string,
    chunk: CopyChunk,
  ): Promise<number> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT count() AS c FROM ${sourceTable} WHERE _partition_id = '${chunk.partitionId}' AND toYYYYMM(\`${timeColumn}\`) = ${chunk.month}`,
        { clickhouseSettings: this.buildReadSettings() },
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return Number(json.data?.[0]?.["c"] ?? 0);
  }

  /** Marker → recorded source row count (max across re-marks, e.g. after a sweep). */
  private static async getChunkMarkers(
    sourceTable: string,
  ): Promise<Map<string, number>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT \`partition\` AS marker, max(rowCount) AS rowCount FROM ${COPY_PROGRESS_TABLE} WHERE tableName = '${sourceTable}' GROUP BY marker`,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;

    const markers: Map<string, number> = new Map();
    for (const row of json.data ?? []) {
      markers.set(String(row["marker"]), Number(row["rowCount"] ?? 0));
    }
    return markers;
  }

  public static async markChunkCopied(
    sourceTable: string,
    marker: string,
    rowCount: number,
  ): Promise<void> {
    await MetricService.execute(
      `INSERT INTO ${COPY_PROGRESS_TABLE} (tableName, \`partition\`, copiedAt, rowCount) VALUES ('${sourceTable}', '${marker}', now(), ${rowCount})`,
    );
  }

  /**
   * Only destination columns whose source column exists (after
   * `renameMap`) are copied — destination-only columns (e.g. `entityKeys`)
   * fall back to the destination table's DEFAULT.
   */
  private static async buildColumnLists(
    sourceTable: string,
    destinationTable: string,
    renameMap: Record<string, string>,
  ): Promise<{ insertList: string; selectList: string }> {
    const destinationColumns: Array<string> =
      await this.getColumns(destinationTable);
    const sourceColumns: Set<string> = new Set(
      await this.getColumns(sourceTable),
    );

    if (destinationColumns.length === 0) {
      throw new Error(`${destinationTable} has no columns — was it created?`);
    }

    const copyColumns: Array<string> = destinationColumns.filter(
      (c: string) => {
        return sourceColumns.has(renameMap[c] ?? c);
      },
    );

    if (copyColumns.length === 0) {
      throw new Error(
        `${sourceTable} -> ${destinationTable}: no overlapping columns — cannot copy.`,
      );
    }

    return {
      insertList: copyColumns
        .map((c: string) => {
          return `\`${c}\``;
        })
        .join(", "),
      selectList: copyColumns
        .map((c: string) => {
          return `\`${renameMap[c] ?? c}\``;
        })
        .join(", "),
    };
  }

  /**
   * ORDER BY clause that totally orders the chunk SELECT: the destination
   * sort keys (mapped to source column names) plus the source's `_id`
   * tiebreaker. Sort-key ties between rows that differ in non-key columns
   * would otherwise make block contents retry-dependent and defeat the
   * dedup token; `_id` is a per-row random ObjectID, so remaining ties
   * are byte-identical rows where order cannot matter.
   */
  private static async buildDeterministicOrderBy(
    sourceTable: string,
    destinationSortKeys: Array<string>,
    renameMap: Record<string, string>,
  ): Promise<string> {
    const sourceColumns: Set<string> = new Set(
      await this.getColumns(sourceTable),
    );

    const orderColumns: Array<string> = destinationSortKeys
      .map((key: string) => {
        return renameMap[key] ?? key;
      })
      .filter((column: string) => {
        return sourceColumns.has(column);
      });

    if (sourceColumns.has("_id") && !orderColumns.includes("_id")) {
      orderColumns.push("_id");
    }

    if (orderColumns.length === 0) {
      throw new Error(
        `${sourceTable}: none of the destination sort keys exist on the source — cannot build a deterministic ORDER BY.`,
      );
    }

    return orderColumns
      .map((c: string) => {
        return `\`${c}\``;
      })
      .join(", ");
  }

  private static async runChunkInsert(
    options: ChunkedCopyOptions,
    chunk: CopyChunk,
    selectColumns: { insertList: string; selectList: string },
    orderBy: string,
    tokenSuffix: string = "",
  ): Promise<void> {
    const token: string = `${chunkToken(options.destinationTable, chunk)}${tokenSuffix}`;
    await this.executeCopyStatement({
      sql: `INSERT INTO ${options.destinationTable} (${selectColumns.insertList}) SELECT ${selectColumns.selectList} FROM ${options.sourceTable} WHERE _partition_id = '${chunk.partitionId}' AND toYYYYMM(\`${options.timeColumn}\`) = ${chunk.month} ORDER BY ${orderBy}`,
      token: token,
    });
  }
}
