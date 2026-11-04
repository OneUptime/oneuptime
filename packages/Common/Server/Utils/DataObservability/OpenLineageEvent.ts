import { JSONObject } from "../../../Types/JSON";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";

/*
 * AN OPENLINEAGE EVENT, READ STRICTLY.
 *
 * Airflow, Spark, dbt, Dagster, Flink and every other OpenLineage producer
 * describe each run of a job the same way: the job (namespace and name),
 * the run (an id, a state, an error), and the datasets it read (inputs) and
 * wrote (outputs), each named by the OpenLineage naming spec - a namespace
 * like postgres://db.internal:5432 and a name like orders.public.orders.
 * The events come from outside, so everything here is bounded and checked;
 * what does not fit is dropped, never guessed.
 */

export enum OpenLineageRunState {
  Start = "START",
  Running = "RUNNING",
  Complete = "COMPLETE",
  Abort = "ABORT",
  Fail = "FAIL",
  Other = "OTHER",
  /*
   * OneUptime's own, never OpenLineage's: a run its tool stopped to finish
   * later (a Fivetran sync rescheduled at an API's rate limit). It ended,
   * neither a success nor a failure, so it pages no one and teaches no
   * duration.
   */
  Rescheduled = "RESCHEDULED",
}

// The states a run ends in.
export const FINAL_RUN_STATES: ReadonlyArray<OpenLineageRunState> = [
  OpenLineageRunState.Complete,
  OpenLineageRunState.Abort,
  OpenLineageRunState.Fail,
  OpenLineageRunState.Rescheduled,
];

// The states a run fails in: what the Pipeline Run Failed alert counts.
export const FAILED_RUN_STATES: ReadonlyArray<OpenLineageRunState> = [
  OpenLineageRunState.Abort,
  OpenLineageRunState.Fail,
];

// The states an OpenLineage producer may send: the spec's own.
const OPENLINEAGE_EVENT_TYPES: ReadonlyArray<string> = [
  OpenLineageRunState.Start,
  OpenLineageRunState.Running,
  OpenLineageRunState.Complete,
  OpenLineageRunState.Abort,
  OpenLineageRunState.Fail,
  OpenLineageRunState.Other,
];

export interface OpenLineageDataset {
  namespace: string;
  name: string;
}

export interface OpenLineageRunEvent {
  eventType: OpenLineageRunState;
  eventTime: Date;
  // Absent for a job event: what a job reads and writes, with no run.
  runId: string | null;
  jobNamespace: string;
  jobName: string;
  errorMessage: string | null;
  // When the run was scheduled for (its nominalTime facet), when the producer says.
  scheduledAt: Date | null;
  inputs: Array<OpenLineageDataset>;
  outputs: Array<OpenLineageDataset>;
  /*
   * Watched tables the run wrote, by id, when its producer named them some
   * other way than a dataset (a Fivetran connector's schema). Never read
   * from an OpenLineage event.
   */
  outputDataAssetIds?: Array<string> | undefined;
}

export const MAX_EVENTS_PER_REQUEST: number = 500;
export const MAX_DATASETS_PER_EVENT: number = 200;
const MAX_NAME_LENGTH: number = 500;
const MAX_ERROR_LENGTH: number = 2000;
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text && text.length <= maxLength ? text : null;
}

function readDatasets(value: unknown): Array<OpenLineageDataset> {
  if (!Array.isArray(value)) {
    return [];
  }

  const datasets: Array<OpenLineageDataset> = [];
  const seen: Set<string> = new Set();

  for (const raw of value.slice(0, MAX_DATASETS_PER_EVENT)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const namespace: string | null = readText(
      (raw as JSONObject)["namespace"],
      MAX_NAME_LENGTH,
    );
    const name: string | null = readText(
      (raw as JSONObject)["name"],
      MAX_NAME_LENGTH,
    );

    if (!namespace || !name) {
      continue;
    }

    const key: string = `${namespace}\u0000${name}`;

    if (!seen.has(key)) {
      seen.add(key);
      datasets.push({ namespace, name });
    }
  }

  return datasets;
}

export function readOpenLineageEvent(
  value: unknown,
  now: Date,
): OpenLineageRunEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const job: JSONObject | null =
    item["job"] && typeof item["job"] === "object"
      ? (item["job"] as JSONObject)
      : null;
  const jobNamespace: string | null = readText(
    job?.["namespace"],
    MAX_NAME_LENGTH,
  );
  const jobName: string | null = readText(job?.["name"], MAX_NAME_LENGTH);

  if (!jobNamespace || !jobName) {
    return null;
  }

  const run: JSONObject | null =
    item["run"] && typeof item["run"] === "object"
      ? (item["run"] as JSONObject)
      : null;
  const runId: string | null =
    typeof run?.["runId"] === "string" && UUID_PATTERN.test(run["runId"])
      ? run["runId"].toLowerCase()
      : null;
  const typeValue: string = String(item["eventType"] || "").toUpperCase();
  const eventType: OpenLineageRunState = OPENLINEAGE_EVENT_TYPES.includes(
    typeValue,
  )
    ? (typeValue as OpenLineageRunState)
    : OpenLineageRunState.Other;
  const parsedTime: number = Date.parse(String(item["eventTime"] || ""));
  // A clock far off is the producer's: the event is taken as now.
  const eventTime: Date =
    Number.isFinite(parsedTime) &&
    parsedTime <= now.getTime() + 5 * 60 * 1000 &&
    parsedTime >= now.getTime() - 30 * 24 * 60 * 60 * 1000
      ? new Date(parsedTime)
      : now;
  const facets: JSONObject | null =
    run?.["facets"] && typeof run["facets"] === "object"
      ? (run["facets"] as JSONObject)
      : null;
  const errorFacet: JSONObject | null =
    facets?.["errorMessage"] && typeof facets["errorMessage"] === "object"
      ? (facets["errorMessage"] as JSONObject)
      : null;
  const nominalTimeFacet: JSONObject | null =
    facets?.["nominalTime"] && typeof facets["nominalTime"] === "object"
      ? (facets["nominalTime"] as JSONObject)
      : null;
  const parsedScheduledTime: number = Date.parse(
    String(nominalTimeFacet?.["nominalStartTime"] || ""),
  );

  return {
    eventType,
    eventTime,
    runId,
    jobNamespace,
    jobName,
    errorMessage: errorFacet
      ? readText(errorFacet["message"], MAX_ERROR_LENGTH * 4)?.slice(
          0,
          MAX_ERROR_LENGTH,
        ) || null
      : null,
    // A backfilled run is scheduled long before it runs, never after.
    scheduledAt:
      Number.isFinite(parsedScheduledTime) &&
      parsedScheduledTime <= eventTime.getTime() + 5 * 60 * 1000
        ? new Date(parsedScheduledTime)
        : null,
    inputs: readDatasets(item["inputs"]),
    outputs: readDatasets(item["outputs"]),
  };
}

// A request's events: one event, or an array of them (some producers batch).
export function readOpenLineageEvents(
  body: unknown,
  now: Date,
): Array<OpenLineageRunEvent> {
  const values: Array<unknown> = Array.isArray(body) ? body : [body];

  return values
    .slice(0, MAX_EVENTS_PER_REQUEST)
    .map((value: unknown) => {
      return readOpenLineageEvent(value, now);
    })
    .filter(
      (event: OpenLineageRunEvent | null): event is OpenLineageRunEvent => {
        return event !== null;
      },
    );
}

export interface ParsedDatasetName {
  kind: DataStoreKind | null;
  host: string | null;
  database: string | null;
  schema: string | null;
  table: string;
}

const SCHEME_KINDS: Readonly<Record<string, DataStoreKind>> = {
  postgres: DataStoreKind.PostgreSql,
  postgresql: DataStoreKind.PostgreSql,
  mysql: DataStoreKind.MySql,
  mariadb: DataStoreKind.MySql,
  sqlserver: DataStoreKind.SqlServer,
  mssql: DataStoreKind.SqlServer,
  redshift: DataStoreKind.AwsRedshiftCluster,
  snowflake: DataStoreKind.Snowflake,
  bigquery: DataStoreKind.GcpBigQueryDataset,
  clickhouse: DataStoreKind.ClickHouse,
  databricks: DataStoreKind.Databricks,
  awsathena: DataStoreKind.AwsAthena,
};

/*
 * A dataset's namespace and name, by the OpenLineage naming spec, as the
 * parts a table is matched by: postgres://host:5432 + db.schema.table;
 * mysql://host:3306 + db.table; sqlserver://host:1433 + db.schema.table.
 * Other kinds of dataset (files, topics, warehouses OneUptime does not
 * read yet) come back without a kind.
 */
export function parseDatasetName(
  dataset: OpenLineageDataset,
): ParsedDatasetName | null {
  const scheme: string = dataset.namespace.split("://")[0]!.toLowerCase();
  const kind: DataStoreKind | null = SCHEME_KINDS[scheme] || null;
  const authority: string = dataset.namespace.includes("://")
    ? dataset.namespace.split("://")[1]!.split("/")[0]!
    : "";
  const host: string | null =
    authority.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase() || null;
  const parts: Array<string> = dataset.name.split(".");

  if (
    parts.some((part: string) => {
      return !part;
    })
  ) {
    return null;
  }

  /*
   * Athena names a table catalog.database.table, its catalog Glue's
   * (AwsDataCatalog): the Glue database is the store, and its schema too.
   */
  if (kind === DataStoreKind.AwsAthena) {
    const database: string | undefined = parts[parts.length - 2];

    return parts.length >= 2 && parts.length <= 3 && database
      ? {
          kind,
          host,
          database,
          schema: database,
          table: parts[parts.length - 1]!,
        }
      : null;
  }

  // MySQL's and ClickHouse's schema is their database: db.table.
  if (kind === DataStoreKind.MySql || kind === DataStoreKind.ClickHouse) {
    return parts.length === 2
      ? {
          kind,
          host,
          database: parts[0]!,
          schema: parts[0]!,
          table: parts[1]!,
        }
      : null;
  }

  if (parts.length === 3) {
    return {
      kind,
      host,
      database: parts[0]!,
      schema: parts[1]!,
      table: parts[2]!,
    };
  }

  if (parts.length === 2) {
    return { kind, host, database: null, schema: parts[0]!, table: parts[1]! };
  }

  return parts.length === 1
    ? { kind, host, database: null, schema: null, table: parts[0]! }
    : null;
}
