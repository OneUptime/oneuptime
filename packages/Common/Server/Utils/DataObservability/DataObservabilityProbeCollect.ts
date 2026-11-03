import DataAssetKind, {
  isDataAssetKind,
} from "../../../Types/DataObservability/DataAssetKind";
import {
  MAX_COLUMNS_PER_DATA_ASSET,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import { JSONObject } from "../../../Types/JSON";
import {
  DATABASE_ENGINES,
  DatabaseEngine,
} from "../DataSecurity/Content/DatabaseSampler";
import { isValidProbeConnectionVariable } from "../DataSecurity/DataSecurityProbeScan";
import {
  CollectedTable,
  MAX_COLLECTION_WARNINGS,
  MAX_COLUMNS_PER_COLLECTION,
  MAX_IDENTIFIER_LENGTH,
  MAX_TABLES_PER_COLLECTION,
  readCount,
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "./TableHealthCollector";

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

function isDatabaseEngine(value: unknown): value is DatabaseEngine {
  return (
    typeof value === "string" &&
    (DATABASE_ENGINES as ReadonlyArray<string>).includes(value)
  );
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
  };
}

export function buildProbeCollectOptions(
  work: DataObservabilityProbeStoreWork,
): TableHealthCollectOptions {
  return {
    maxTables: work.maxTables,
    maxColumns: work.maxColumns,
    exclusions: work.exclusions,
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
    columns:
      columns === null
        ? null
        : readDataAssetColumns(columns).slice(0, MAX_COLUMNS_PER_DATA_ASSET),
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
