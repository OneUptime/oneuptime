import { ClickhouseDatabase } from "../../EnvironmentConfig";
import {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "../../Infrastructure/ClickhouseDatabase";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import logger from "../Logger";
import {
  getClickhouseClusterName,
  getStorageTableName,
} from "../AnalyticsDatabase/ClusterConfig";

/*
 * -----------------------------------------------------------------------------
 * Telemetry ingestion probes for the master-admin OneUptime Health dashboard.
 *
 * Two views over the same three tables:
 *
 *   - by SIGNAL   — how many log / metric / trace rows landed in ClickHouse over
 *                   the last minute, hour and day, plus each signal's actual
 *                   (uncompressed) footprint. This answers "is the pipeline
 *                   flowing, and how fast".
 *   - by PROJECT  — the same three windows split per tenant, which answers
 *                   "who is sending it" — the question behind a sudden ingest
 *                   spike, a noisy-neighbour investigation or a capacity
 *                   conversation with one customer.
 *
 * Only counts and size metadata are read; no telemetry row data ever leaves
 * ClickHouse through here. Every query is capped with max_execution_time so a
 * dashboard poll can never pin the cluster.
 * -----------------------------------------------------------------------------
 */

export enum TelemetryIngestionSignal {
  Logs = "Logs",
  Metrics = "Metrics",
  Traces = "Traces",
}

export interface TelemetryIngestionSignalSpec {
  telemetryType: TelemetryIngestionSignal;
  table: AnalyticsTableName;
  // The event-time column this table is partitioned and primary-key ordered on.
  timeColumn: string;
}

export interface TelemetryIngestionCounts {
  lastMinute: number | null;
  lastHour: number | null;
  lastDay: number | null;
}

export interface TelemetrySignalIngestion extends TelemetryIngestionCounts {
  telemetryType: string;
  table: string;
  uncompressedBytes: number | null;
  available: boolean;
}

export interface TelemetrySignalIngestionResult {
  connected: boolean;
  tables: Array<TelemetrySignalIngestion>;
}

// One project's counts for one signal.
export interface TelemetryProjectSignalIngestion
  extends TelemetryIngestionCounts {
  telemetryType: string;
}

export interface TelemetryProjectIngestion extends TelemetryIngestionCounts {
  projectId: string;
  // Filled in by attachProjectNames; null when the project no longer exists.
  projectName: string | null;
  signals: Array<TelemetryProjectSignalIngestion>;
}

// A single GROUP BY projectId row, before the three signals are merged.
export interface TelemetryProjectIngestionRow extends TelemetryIngestionCounts {
  projectId: string;
}

export interface TelemetrySignalProjectRows {
  telemetryType: string;
  /*
   * False when the per-project query failed for this signal (missing table,
   * timeout). The signal's counts then stay null for every project instead of
   * being reported as a truthful-looking zero.
   */
  available: boolean;
  // True when the signal had more projects than the per-signal cap allowed.
  truncated: boolean;
  rows: Array<TelemetryProjectIngestionRow>;
}

export interface TelemetryProjectIngestionResult {
  connected: boolean;
  projects: Array<TelemetryProjectIngestion>;
  signals: Array<{
    telemetryType: string;
    available: boolean;
    truncated: boolean;
  }>;
  truncated: boolean;
}

/*
 * The three telemetry signals OneUptime ingests into ClickHouse and the
 * event-time column each table is partitioned + primary-key ordered on. We count
 * ingestion on THIS column (never `createdAt`) precisely because it is the
 * partition key (toYYYYMMDD) and the leading primary-key column: ClickHouse can
 * prune to the last day's partitions and use the primary index, so the count
 * stays cheap even on multi-billion-row tables. `createdAt` — the true write
 * time — is unindexed and unpartitioned here, so filtering on it would force a
 * full-table scan; for a live pipeline event-time and write-time agree to within
 * seconds, and the only divergence (historical backfill) is not what a
 * "current ingestion rate" view is meant to show.
 */
export const TELEMETRY_INGESTION_SIGNALS: Array<TelemetryIngestionSignalSpec> =
  [
    {
      telemetryType: TelemetryIngestionSignal.Logs,
      table: AnalyticsTableName.Log,
      timeColumn: "time",
    },
    {
      telemetryType: TelemetryIngestionSignal.Metrics,
      table: AnalyticsTableName.Metric,
      timeColumn: "time",
    },
    {
      telemetryType: TelemetryIngestionSignal.Traces,
      table: AnalyticsTableName.Span,
      timeColumn: "startTime",
    },
  ];

/*
 * How many projects one signal's GROUP BY may return. Every OneUptime instance
 * we have seen has far fewer active tenants than this, so the cap is a runaway
 * guard rather than a real ceiling — but when it does bite, the caller is told
 * (`truncated`) so the page can say the list is partial instead of quietly
 * dropping tenants off the bottom.
 */
export const MAX_PROJECTS_PER_SIGNAL: number = 500;

// Every diagnostic query here is read-only, and none of them may outlive this.
const QUERY_TIMEOUT_IN_SECONDS: number = 10;

type ClickhouseJsonResult = { data: Array<JSONObject> };

function escapeStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

/*
 * ClickHouse returns UInt64 aggregates as JSON strings. A value we could not
 * read stays null and renders as "—" rather than as a confident zero.
 */
export function toCountOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/*
 * Sum counts where null means "unknown". A total is only meaningful when at
 * least one input reported a number, so an all-unknown sum stays unknown
 * instead of collapsing to 0.
 */
export function sumCountsOrNull(values: Array<number | null>): number | null {
  const known: Array<number> = values.filter(
    (value: number | null): value is number => {
      return value !== null;
    },
  );

  if (known.length === 0) {
    return null;
  }

  return known.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
}

/*
 * Counts for one table across the three windows. All three come from ONE scan:
 * the WHERE clause bounds it to the last day (so only the last day's partitions
 * are touched) and countIf picks the smaller windows out of that same pass. The
 * upper `<= now()` bound stops a future-dated event from inflating the counts.
 */
export function buildSignalIngestionQuery(data: {
  spec: TelemetryIngestionSignalSpec;
  databaseName: string;
}): string {
  const timeColumn: string = quoteIdentifier(data.spec.timeColumn);

  return (
    "SELECT " +
    `countIf(${timeColumn} >= now() - INTERVAL 1 MINUTE) AS last_minute, ` +
    `countIf(${timeColumn} >= now() - INTERVAL 1 HOUR) AS last_hour, ` +
    "count() AS last_day " +
    `FROM ${quoteIdentifier(data.databaseName)}.${quoteIdentifier(
      data.spec.table,
    )} ` +
    `WHERE ${timeColumn} >= now() - INTERVAL 1 DAY AND ${timeColumn} <= now()`
  );
}

/*
 * The same three windows, split by tenant. projectId is the LEADING primary-key
 * column of all three telemetry tables, so this is the one dimension the tables
 * can be grouped on without paying for a full scan of the day's partitions.
 *
 * Ordered by the widest window descending so that, if the cap ever bites, it is
 * the smallest tenants that fall off rather than an arbitrary slice; projectId
 * breaks ties so the list is stable between refreshes.
 */
export function buildProjectIngestionQuery(data: {
  spec: TelemetryIngestionSignalSpec;
  databaseName: string;
  limit: number;
}): string {
  const timeColumn: string = quoteIdentifier(data.spec.timeColumn);

  return (
    "SELECT projectId AS project_id, " +
    `countIf(${timeColumn} >= now() - INTERVAL 1 MINUTE) AS last_minute, ` +
    `countIf(${timeColumn} >= now() - INTERVAL 1 HOUR) AS last_hour, ` +
    "count() AS last_day " +
    `FROM ${quoteIdentifier(data.databaseName)}.${quoteIdentifier(
      data.spec.table,
    )} ` +
    `WHERE ${timeColumn} >= now() - INTERVAL 1 DAY AND ${timeColumn} <= now() ` +
    "GROUP BY projectId " +
    "ORDER BY last_day DESC, project_id ASC " +
    `LIMIT ${Math.max(1, Math.floor(data.limit))}`
  );
}

/*
 * Total ACTUAL (uncompressed) data volume per telemetry table, read from
 * system.parts metadata — the real data size, not the compressed bytes_on_disk.
 * It is a metadata aggregate (no data scan), so it stays cheap regardless of
 * table size.
 *
 * Two cluster subtleties are handled here:
 *
 *   1. The app-facing table names (LogItemV3, …) are Distributed wrappers, which
 *      hold NO parts of their own — the rows live in the per-shard local storage
 *      tables (`<tableName>Local`). So we filter system.parts on the *Local
 *      names (and key the size map by them); the Distributed names would match
 *      nothing and leave every "Actual size" cell blank.
 *
 *   2. system.parts is node-local, so a plain read would only size the connected
 *      node's shard. We read it through `cluster(<name>, system.parts)` which —
 *      like the Distributed read path the ingestion counts use — hits ONE replica
 *      per shard, so sum(...) GROUP BY table totals every shard exactly once (no
 *      replica double-counting; clusterAllReplicas would overcount by the
 *      replication factor). On a single-node "cluster of one" this equals
 *      reading system.parts directly.
 */
export function buildTelemetryStorageSizeQuery(data: {
  clusterName: string;
  databaseName: string;
  storageTableNames: Array<string>;
}): string {
  const tableList: string = data.storageTableNames
    .map((tableName: string): string => {
      return `'${escapeStringLiteral(tableName)}'`;
    })
    .join(", ");

  return (
    "SELECT table, sum(data_uncompressed_bytes) AS uncompressed_bytes " +
    `FROM cluster('${escapeStringLiteral(data.clusterName)}', system.parts) ` +
    `WHERE active AND database = '${escapeStringLiteral(
      data.databaseName,
    )}' AND table IN (${tableList}) ` +
    "GROUP BY table"
  );
}

/*
 * Fold the three per-signal GROUP BY results into one row per project.
 *
 * A project that appears in one signal's rows but not another's really did
 * ingest zero of that signal, so it gets 0 — but only when that signal's query
 * SUCCEEDED. When the query failed the signal is unknown for every project and
 * stays null, which is what keeps a missing table from reading as "this tenant
 * stopped sending traces".
 *
 * Rows come back ordered by the day window descending, the order the page shows
 * them in; projectId breaks ties so the order does not shuffle between polls.
 */
export function mergeProjectIngestionRows(
  signalResults: Array<TelemetrySignalProjectRows>,
): Array<TelemetryProjectIngestion> {
  const countsByProject: Map<
    string,
    Map<string, TelemetryIngestionCounts>
  > = new Map();

  for (const signalResult of signalResults) {
    if (!signalResult.available) {
      continue;
    }

    for (const row of signalResult.rows) {
      const byTelemetryType: Map<string, TelemetryIngestionCounts> =
        countsByProject.get(row.projectId) ||
        new Map<string, TelemetryIngestionCounts>();

      byTelemetryType.set(signalResult.telemetryType, {
        lastMinute: row.lastMinute,
        lastHour: row.lastHour,
        lastDay: row.lastDay,
      });
      countsByProject.set(row.projectId, byTelemetryType);
    }
  }

  const projects: Array<TelemetryProjectIngestion> = [];

  for (const [projectId, byTelemetryType] of countsByProject) {
    const signals: Array<TelemetryProjectSignalIngestion> = signalResults.map(
      (
        signalResult: TelemetrySignalProjectRows,
      ): TelemetryProjectSignalIngestion => {
        const counts: TelemetryIngestionCounts | undefined =
          signalResult.available
            ? byTelemetryType.get(signalResult.telemetryType) || {
                lastMinute: 0,
                lastHour: 0,
                lastDay: 0,
              }
            : undefined;

        return {
          telemetryType: signalResult.telemetryType,
          lastMinute: counts ? counts.lastMinute : null,
          lastHour: counts ? counts.lastHour : null,
          lastDay: counts ? counts.lastDay : null,
        };
      },
    );

    projects.push({
      projectId,
      projectName: null,
      signals,
      lastMinute: sumCountsOrNull(
        signals.map(
          (signal: TelemetryProjectSignalIngestion): number | null => {
            return signal.lastMinute;
          },
        ),
      ),
      lastHour: sumCountsOrNull(
        signals.map(
          (signal: TelemetryProjectSignalIngestion): number | null => {
            return signal.lastHour;
          },
        ),
      ),
      lastDay: sumCountsOrNull(
        signals.map(
          (signal: TelemetryProjectSignalIngestion): number | null => {
            return signal.lastDay;
          },
        ),
      ),
    });
  }

  return projects.sort(
    (
      left: TelemetryProjectIngestion,
      right: TelemetryProjectIngestion,
    ): number => {
      return (
        (right.lastDay ?? 0) - (left.lastDay ?? 0) ||
        left.projectId.localeCompare(right.projectId)
      );
    },
  );
}

/*
 * ClickHouse only knows tenants by id. Names come from Postgres, and a project
 * deleted while its telemetry is still inside the retention window has none —
 * that project keeps a null name and the page labels it by id, rather than
 * disappearing from a total it still contributes to.
 */
export function attachProjectNames(
  projects: Array<TelemetryProjectIngestion>,
  namesByProjectId: Map<string, string>,
): Array<TelemetryProjectIngestion> {
  return projects.map(
    (project: TelemetryProjectIngestion): TelemetryProjectIngestion => {
      return {
        ...project,
        projectName: namesByProjectId.get(project.projectId) || null,
      };
    },
  );
}

function getClient(): ClickhouseClient | null {
  return ClickhouseAppInstance.getDataSource();
}

async function queryJson(
  client: ClickhouseClient,
  query: string,
): Promise<Array<JSONObject>> {
  const result: ClickhouseJsonResult = (await (
    await client.query({
      query,
      format: "JSON",
      clickhouse_settings: {
        max_execution_time: QUERY_TIMEOUT_IN_SECONDS,
      },
    })
  ).json()) as ClickhouseJsonResult;

  return result.data || [];
}

/*
 * Ingestion throughput per signal, with each signal's actual (uncompressed)
 * footprint alongside it. Each table is probed independently so a missing table
 * (e.g. an instance that only ingests logs) degrades gracefully rather than
 * blanking the whole card.
 */
export async function getTelemetryIngestionBySignal(): Promise<TelemetrySignalIngestionResult> {
  const result: TelemetrySignalIngestionResult = {
    connected: false,
    tables: [],
  };

  try {
    const client: ClickhouseClient | null = getClient();

    if (!client) {
      return result;
    }

    result["connected"] = true;

    /*
     * Guarded independently so a failure here never drops the ingestion counts
     * below — a blank "Actual size" column is a much smaller loss than a blank
     * ingestion rate.
     */
    const uncompressedBytesByStorageTable: Map<string, number | null> =
      new Map();

    try {
      const rows: Array<JSONObject> = await queryJson(
        client,
        buildTelemetryStorageSizeQuery({
          clusterName: getClickhouseClusterName(),
          databaseName: ClickhouseDatabase,
          storageTableNames: TELEMETRY_INGESTION_SIGNALS.map(
            (spec: TelemetryIngestionSignalSpec): string => {
              return getStorageTableName(String(spec.table));
            },
          ),
        }),
      );

      for (const row of rows) {
        uncompressedBytesByStorageTable.set(
          String(row["table"]),
          toCountOrNull(row["uncompressed_bytes"]),
        );
      }
    } catch (err) {
      logger.debug("AdminHealth: telemetry uncompressed-size query failed");
      logger.debug(err);
    }

    for (const spec of TELEMETRY_INGESTION_SIGNALS) {
      const entry: TelemetrySignalIngestion = {
        telemetryType: spec.telemetryType,
        table: String(spec.table),
        lastMinute: null,
        lastHour: null,
        lastDay: null,
        uncompressedBytes:
          uncompressedBytesByStorageTable.get(
            getStorageTableName(String(spec.table)),
          ) ?? null,
        available: false,
      };

      try {
        const rows: Array<JSONObject> = await queryJson(
          client,
          buildSignalIngestionQuery({
            spec,
            databaseName: ClickhouseDatabase,
          }),
        );
        const row: JSONObject = rows[0] || {};

        entry.lastMinute = toCountOrNull(row["last_minute"]);
        entry.lastHour = toCountOrNull(row["last_hour"]);
        entry.lastDay = toCountOrNull(row["last_day"]);
        entry.available = true;
      } catch (err) {
        logger.debug(
          `AdminHealth: telemetry ingestion query failed for ${spec.table}`,
        );
        logger.debug(err);
      }

      result.tables.push(entry);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse telemetry ingestion");
    logger.error(err);
  }

  return result;
}

/*
 * Ingestion split by tenant. Each signal is queried independently — one failing
 * table must not blank the other two — and the three results are folded into one
 * row per project. Names are NOT resolved here: they live in Postgres, and the
 * caller attaches them with attachProjectNames.
 */
export async function getTelemetryIngestionByProject(): Promise<TelemetryProjectIngestionResult> {
  const result: TelemetryProjectIngestionResult = {
    connected: false,
    projects: [],
    signals: [],
    truncated: false,
  };

  try {
    const client: ClickhouseClient | null = getClient();

    if (!client) {
      return result;
    }

    result.connected = true;

    const signalResults: Array<TelemetrySignalProjectRows> = [];

    for (const spec of TELEMETRY_INGESTION_SIGNALS) {
      const signalResult: TelemetrySignalProjectRows = {
        telemetryType: spec.telemetryType,
        available: false,
        truncated: false,
        rows: [],
      };

      try {
        const rows: Array<JSONObject> = await queryJson(
          client,
          buildProjectIngestionQuery({
            spec,
            databaseName: ClickhouseDatabase,
            limit: MAX_PROJECTS_PER_SIGNAL,
          }),
        );

        signalResult.rows = rows.map(
          (row: JSONObject): TelemetryProjectIngestionRow => {
            return {
              projectId: String(row["project_id"] || ""),
              lastMinute: toCountOrNull(row["last_minute"]),
              lastHour: toCountOrNull(row["last_hour"]),
              lastDay: toCountOrNull(row["last_day"]),
            };
          },
        );
        signalResult.available = true;
        signalResult.truncated = rows.length >= MAX_PROJECTS_PER_SIGNAL;
      } catch (err) {
        logger.debug(
          `AdminHealth: per-project telemetry ingestion query failed for ${spec.table}`,
        );
        logger.debug(err);
      }

      signalResults.push(signalResult);
    }

    result.projects = mergeProjectIngestionRows(signalResults);
    result.signals = signalResults.map(
      (
        signalResult: TelemetrySignalProjectRows,
      ): { telemetryType: string; available: boolean; truncated: boolean } => {
        return {
          telemetryType: signalResult.telemetryType,
          available: signalResult.available,
          truncated: signalResult.truncated,
        };
      },
    );
    result.truncated = signalResults.some(
      (signalResult: TelemetrySignalProjectRows): boolean => {
        return signalResult.truncated;
      },
    );
  } catch (err) {
    logger.error(
      "AdminHealth: failed to read per-project ClickHouse telemetry ingestion",
    );
    logger.error(err);
  }

  return result;
}
