import { readColumnMappings } from "../../../Types/DataObservability/DataColumnLineage";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import DataAssetKind, {
  isDataAssetKind,
} from "../../../Types/DataObservability/DataAssetKind";
import {
  MAX_COLUMNS_PER_DATA_ASSET,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import { JSONObject } from "../../../Types/JSON";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import { isCollectorEngine } from "./DataObservabilityEngines";
import {
  CollectedJobSpend,
  MAX_SPEND_JOBS,
  readCollectedJobSpend,
} from "../../../Types/DataObservability/DataWarehouseSpend";
import { isValidProbeConnectionVariable } from "../DataSecurity/DataSecurityProbeScan";
import {
  CollectedLineageEdge,
  CollectedTable,
  MAX_COLLECTION_WARNINGS,
  MAX_COLUMNS_PER_COLLECTION,
  MAX_IDENTIFIER_LENGTH,
  MAX_LINEAGE_EDGES_PER_COLLECTION,
  MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS,
  MAX_SEEN_BY_LENGTH,
  MAX_TABLES_PER_COLLECTION,
  readCount,
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "./TableHealthCollector";
import { readTableHealthTarget } from "./TableHealthTarget";
import {
  DataCheckRunResult,
  DataCheckSegmentValue,
  MAX_CHECK_ERROR_LENGTH,
  PlannedDataCheck,
  readNumber,
  readSegment,
} from "./DataCheckResults";
import {
  DataCheckType,
  MAX_ACCEPTED_VALUES,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import { MAX_CUSTOM_SQL_LENGTH } from "./DataCheckSql";
import ObjectID from "../../../Types/ObjectID";

/*
 * A DATABASE ONLY A CUSTOMER'S PROBE CAN REACH, COLLECTED FROM THAT PROBE.
 *
 * The same arrangement as Data Security's scans (DataSecurityProbeScan): a
 * store scanned by a probe names the probe's environment variable that
 * holds its connection string, and the probe collects with it. Every few
 * minutes:
 *
 *   POST /probe/data-observability/work    the stores due for a collection
 *                                          by this probe, claimed so no
 *                                          other poll gets them - the
 *                                          variable's name, never a
 *                                          connection string
 *   POST /probe/data-observability/result  what the collection read (a
 *                                          TableHealthSnapshot: catalog
 *                                          facts, never a row), or why it
 *                                          could not run
 *
 * This file is that conversation's contract. The server reads a result as
 * it reads anything it did not write: every field checked, every list and
 * string bounded.
 */

export const DATA_OBSERVABILITY_PROBE_WORK_ROUTE: string =
  "/probe/data-observability/work";
export const DATA_OBSERVABILITY_PROBE_RESULT_ROUTE: string =
  "/probe/data-observability/result";
// How often a store's tables are collected.
export const TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES: number = 5;
// How long a claimed store is held for its collector before it is due again.
export const TABLE_HEALTH_CLAIM_IN_MINUTES: number = 15;
// The most stores handed to a probe in one poll.
export const DATA_OBSERVABILITY_PROBE_STORES_PER_POLL: number = 5;
// How soon a collection that failed is tried again.
export const FAILED_COLLECTION_RETRY_IN_MINUTES: number = 15;

export interface DataObservabilityProbeStoreWork {
  dataStoreId: string;
  engine: DatabaseEngine;
  probeConnectionVariable: string;
  maxTables: number;
  maxColumns: number;
  exclusions: Array<string>;
  // The store's due data checks, their statements built by the server.
  checks?: Array<PlannedDataCheck> | undefined;
  // How far back to read the query history for lineage; 0 reads no lineage this time.
  queryHistoryLookbackInSeconds?: number | undefined;
}

// The most checks one work item carries, and one report records.
export const MAX_CHECKS_PER_WORK: number = 50;

// The longest statement a check sends: a custom query, wrapped.
const MAX_CHECK_SQL_LENGTH: number = MAX_CUSTOM_SQL_LENGTH + 200;

// The checks a work item carries, read strictly: a probe runs only what the server built.
export function readPlannedChecks(value: unknown): Array<PlannedDataCheck> {
  if (!Array.isArray(value)) {
    return [];
  }

  const checks: Array<PlannedDataCheck> = [];

  for (const raw of value.slice(0, MAX_CHECKS_PER_WORK)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const item: JSONObject = raw as JSONObject;
    const checkId: unknown = item["checkId"];
    const type: unknown = item["type"];
    const sql: unknown = item["sql"];
    const params: unknown = item["params"];

    if (
      typeof checkId !== "string" ||
      !ObjectID.isValidUUID(checkId) ||
      typeof type !== "string" ||
      !Object.values(DataCheckType).includes(type as DataCheckType) ||
      typeof sql !== "string" ||
      sql.length === 0 ||
      sql.length > MAX_CHECK_SQL_LENGTH ||
      !Array.isArray(params) ||
      params.length > MAX_ACCEPTED_VALUES + 1 ||
      !params.every((param: unknown) => {
        return typeof param === "string";
      })
    ) {
      continue;
    }

    const limits: JSONObject =
      item["limits"] && typeof item["limits"] === "object"
        ? (item["limits"] as JSONObject)
        : {};
    const maxBytesScanned: number | null = readCount(limits["maxBytesScanned"]);

    checks.push({
      checkId,
      type: type as DataCheckType,
      isSegmented: item["isSegmented"] === true,
      sql,
      params: params as Array<string>,
      ...(maxBytesScanned ? { limits: { maxBytesScanned } } : {}),
    });
  }

  return checks;
}

// What a report says each check read, read strictly: numbers, bounded text, known checks only.
export function readCheckResults(value: unknown): Array<DataCheckRunResult> {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: Array<DataCheckRunResult> = [];

  for (const raw of value.slice(0, MAX_CHECKS_PER_WORK)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const item: JSONObject = raw as JSONObject;
    const checkId: unknown = item["checkId"];

    if (typeof checkId !== "string" || !ObjectID.isValidUUID(checkId)) {
      continue;
    }

    const values: Array<DataCheckSegmentValue> = [];

    for (const entry of Array.isArray(item["values"])
      ? (item["values"] as Array<unknown>).slice(0, MAX_SEGMENTS_PER_CHECK)
      : []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const number: number | null = readNumber((entry as JSONObject)["value"]);
      const segment: unknown = (entry as JSONObject)["segment"];

      if (number !== null) {
        values.push({
          segment:
            segment === null || segment === undefined
              ? null
              : readSegment(segment),
          value: number,
        });
      }
    }

    results.push({
      checkId,
      values,
      error:
        typeof item["error"] === "string" && item["error"].length > 0
          ? item["error"].slice(0, MAX_CHECK_ERROR_LENGTH)
          : null,
    });
  }

  return results;
}

export interface DataObservabilityProbeResultReport {
  dataStoreId: string;
  startedAt: string;
  snapshot?: TableHealthSnapshot | undefined;
  error?: string | undefined;
}

const MAX_EXCLUSIONS: number = 200;
const MAX_ERROR_LENGTH: number = 1_000;
const MAX_WARNING_LENGTH: number = 300;

// Every engine Data Observability collects, Redshift among them (DataObservabilityEngines).
function isDatabaseEngine(value: unknown): value is DatabaseEngine {
  return isCollectorEngine(value);
}

function boundedWholeNumber(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const number: number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
}

// Reads a work item from the server; anything malformed is not work.
export function readProbeCollectWork(
  value: unknown,
): DataObservabilityProbeStoreWork | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const dataStoreId: unknown = item["dataStoreId"];
  const engine: unknown = item["engine"];
  const variable: unknown = item["probeConnectionVariable"];

  if (
    typeof dataStoreId !== "string" ||
    dataStoreId.length === 0 ||
    !isDatabaseEngine(engine) ||
    typeof variable !== "string"
  ) {
    return null;
  }

  return {
    dataStoreId,
    engine,
    probeConnectionVariable: variable,
    maxTables: boundedWholeNumber(
      item["maxTables"],
      MAX_TABLES_PER_COLLECTION,
      MAX_TABLES_PER_COLLECTION,
    ),
    maxColumns: boundedWholeNumber(
      item["maxColumns"],
      MAX_COLUMNS_PER_COLLECTION,
      MAX_COLUMNS_PER_COLLECTION,
    ),
    exclusions: Array.isArray(item["exclusions"])
      ? (item["exclusions"] as Array<unknown>)
          .filter((exclusion: unknown): exclusion is string => {
            return typeof exclusion === "string";
          })
          .slice(0, MAX_EXCLUSIONS)
      : [],
    checks: readPlannedChecks(item["checks"]),
    // An item from an older server says nothing: no lineage, which it would not keep.
    queryHistoryLookbackInSeconds: boundedWholeNumber(
      item["queryHistoryLookbackInSeconds"],
      0,
      MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS,
    ),
  };
}

export function buildProbeCollectOptions(
  work: DataObservabilityProbeStoreWork,
): TableHealthCollectOptions {
  return {
    maxTables: work.maxTables,
    maxColumns: work.maxColumns,
    exclusions: work.exclusions,
    checks: work.checks || [],
    queryHistoryLookbackInSeconds: work.queryHistoryLookbackInSeconds || 0,
  };
}

// Whether the probe may read the variable a work item names.
export function isCollectableVariable(name: unknown): name is string {
  return isValidProbeConnectionVariable(name);
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.slice(0, MAX_IDENTIFIER_LENGTH);
}

function readCollectedTable(value: unknown): CollectedTable | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const schema: string | null = readName(item["schema"]);
  const name: string | null = readName(item["name"]);
  const kind: unknown = item["kind"];

  if (schema === null || !name || !isDataAssetKind(kind)) {
    return null;
  }

  const columns: unknown = item["columns"];

  return {
    schema,
    name,
    kind: kind as DataAssetKind,
    estimatedRows: readCount(item["estimatedRows"]),
    sizeInBytes: readCount(item["sizeInBytes"]),
    writeCount: readCount(item["writeCount"]),
    secondsSinceChange: readCount(item["secondsSinceChange"]),
    readCount: readCount(item["readCount"]),
    secondsSinceRead: readCount(item["secondsSinceRead"]),
    ...(item["columnsAreInferred"] === true
      ? { columnsAreInferred: true }
      : {}),
    columns:
      columns === null
        ? null
        : readDataAssetColumns(columns).slice(0, MAX_COLUMNS_PER_DATA_ASSET),
  };
}

// An edge of lineage a probe sent: known sources only, names bounded as a table's are.
function readLineageEdge(value: unknown): CollectedLineageEdge | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const source: unknown = item["source"];

  if (
    source !== DataAssetLineageSource.QueryHistory &&
    source !== DataAssetLineageSource.ViewDefinition
  ) {
    return null;
  }

  const upstreamSchema: string | null = readName(item["upstreamSchema"]);
  const upstreamTable: string | null = readName(item["upstreamTable"]);
  const downstreamSchema: string | null = readName(item["downstreamSchema"]);
  const downstreamTable: string | null = readName(item["downstreamTable"]);

  if (
    upstreamSchema === null ||
    !upstreamTable ||
    downstreamSchema === null ||
    !downstreamTable
  ) {
    return null;
  }

  const isQuery: boolean = source === DataAssetLineageSource.QueryHistory;
  const seenBy: unknown = item["seenBy"];

  return {
    source,
    upstreamDatabase: readName(item["upstreamDatabase"]) || null,
    upstreamSchema,
    upstreamTable,
    downstreamSchema,
    downstreamTable,
    secondsSinceSeen: isQuery ? readCount(item["secondsSinceSeen"]) : null,
    seenBy:
      isQuery && typeof seenBy === "string"
        ? seenBy.slice(0, MAX_SEEN_BY_LENGTH) || null
        : null,
    ...(Array.isArray(item["columnMappings"])
      ? { columnMappings: readColumnMappings(item["columnMappings"]) }
      : {}),
  };
}

/*
 * Reads a snapshot a probe sent. A collection time in the future, or more
 * than a day old, is read as now: the probe's clock decides nothing.
 */
export function readTableHealthSnapshot(
  value: unknown,
  now: Date,
): TableHealthSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const engine: unknown = item["engine"];

  if (!isDatabaseEngine(engine) || !Array.isArray(item["tables"])) {
    return null;
  }

  const tables: Array<CollectedTable> = [];
  const seen: Set<string> = new Set();

  for (const raw of item["tables"] as Array<unknown>) {
    const table: CollectedTable | null = readCollectedTable(raw);

    if (!table) {
      continue;
    }

    const key: string = `${table.schema}\u0000${table.name}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tables.push(table);

    if (tables.length >= MAX_TABLES_PER_COLLECTION) {
      break;
    }
  }

  const collectedAtValue: number = Date.parse(String(item["collectedAt"]));
  const isPlausible: boolean =
    Number.isFinite(collectedAtValue) &&
    collectedAtValue <= now.getTime() + 60_000 &&
    collectedAtValue >= now.getTime() - 24 * 60 * 60 * 1000;

  return {
    engine,
    collectedAt: isPlausible
      ? new Date(Math.min(collectedAtValue, now.getTime())).toISOString()
      : now.toISOString(),
    tables,
    isComplete: item["isComplete"] === true,
    secondsSinceStatsReset: readCount(item["secondsSinceStatsReset"]),
    target: readTableHealthTarget(item["target"]),
    checkResults: readCheckResults(item["checkResults"]),
    ...(Array.isArray(item["lineage"])
      ? {
          lineage: (item["lineage"] as Array<unknown>)
            .slice(0, MAX_LINEAGE_EDGES_PER_COLLECTION)
            .map(readLineageEdge)
            .filter(
              (
                edge: CollectedLineageEdge | null,
              ): edge is CollectedLineageEdge => {
                return edge !== null;
              },
            ),
          isViewLineageComplete: item["isViewLineageComplete"] === true,
        }
      : {}),
    ...(Array.isArray(item["spend"])
      ? {
          spend: (item["spend"] as Array<unknown>)
            .slice(0, MAX_SPEND_JOBS)
            .map(readCollectedJobSpend)
            .filter(
              (job: CollectedJobSpend | null): job is CollectedJobSpend => {
                return job !== null;
              },
            ),
        }
      : {}),
    warnings: Array.isArray(item["warnings"])
      ? (item["warnings"] as Array<unknown>)
          .filter((warning: unknown): warning is string => {
            return typeof warning === "string";
          })
          .slice(0, MAX_COLLECTION_WARNINGS)
          .map((warning: string) => {
            return warning.slice(0, MAX_WARNING_LENGTH);
          })
      : [],
  };
}

export function readProbeCollectError(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.slice(0, MAX_ERROR_LENGTH);
}
