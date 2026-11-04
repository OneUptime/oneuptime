import {
  DBT_TABLE_RESOURCE_TYPES,
  DbtResourceType,
  MAX_DBT_COMPILED_CODE_LENGTH,
  MAX_DBT_MESSAGE_LENGTH,
} from "../../../Types/DataObservability/DbtArtifact";
import { JSONObject } from "../../../Types/JSON";
import { OpenLineageDataset, OpenLineageRunState } from "./OpenLineageEvent";

/*
 * WHAT DBT'S ARTIFACTS SAY, READ STRICTLY.
 *
 * They come from outside: a manifest is read for its tables (models, seeds,
 * snapshots, sources) and tests, run results for how each node went, each
 * bounded and each field checked, so a malformed file is read as far as it
 * is sound and no further. A table is matched to a watched one by the same
 * names an OpenLineage dataset carries (getDbtDataset), so DatasetMatching
 * decides, and refuses when it is not sure.
 */

// The most tables, tests and results read of one upload.
export const MAX_DBT_NODES: number = 20_000;
export const MAX_DBT_RESULTS: number = 20_000;

const MAX_NAME_LENGTH: number = 500;
const MAX_TAGS: number = 50;
const MAX_ACCEPTED_VALUES: number = 200;
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A model, seed, snapshot or source: a table dbt builds or reads.
export interface DbtTable {
  uniqueId: string;
  resourceType: DbtResourceType;
  name: string;
  database: string | null;
  schema: string | null;
  // The table's own name in the database: the alias, or a source's identifier.
  relation: string;
  description: string | null;
  tags: Array<string>;
  owner: string | null;
  materialized: string | null;
  packageName: string | null;
  path: string | null;
  // The nodes it is built from, by unique id.
  dependsOn: Array<string>;
}

export interface DbtTest {
  uniqueId: string;
  name: string;
  // The generic test it is (not_null, unique, accepted_values, ...); null for a singular test.
  testName: string | null;
  // The table it tests, by unique id.
  attachedNode: string | null;
  columnName: string | null;
  severity: string | null;
  description: string | null;
  compiledCode: string | null;
  acceptedValues: Array<string> | null;
}

export interface DbtManifest {
  projectName: string | null;
  adapterType: string | null;
  tables: Map<string, DbtTable>;
  tests: Array<DbtTest>;
}

export enum DbtResultStatus {
  Success = "success",
  Error = "error",
  Skipped = "skipped",
  Pass = "pass",
  Fail = "fail",
  Warn = "warn",
}

export interface DbtNodeResult {
  uniqueId: string;
  status: DbtResultStatus | null;
  executionTimeInSeconds: number | null;
  completedAt: Date | null;
  message: string | null;
  failures: number | null;
}

export interface DbtRunResults {
  // dbt's invocation id: one run of the project's pipeline.
  invocationId: string | null;
  generatedAt: Date;
  elapsedTimeInSeconds: number | null;
  command: string | null;
  results: Array<DbtNodeResult>;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, maxLength) : null;
}

function readTextList(value: unknown, max: number): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const texts: Array<string> = [];

  for (const item of value) {
    const text: string | null = readText(item, MAX_NAME_LENGTH);

    if (text && !texts.includes(text)) {
      texts.push(text);
    }

    if (texts.length >= max) {
      break;
    }
  }

  return texts;
}

function readNumber(value: unknown): number | null {
  const number: number = typeof value === "number" ? value : Number.NaN;

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readDate(value: unknown): Date | null {
  const time: number = Date.parse(String(value || ""));

  return Number.isFinite(time) ? new Date(time) : null;
}

function readOwner(node: JSONObject, config: JSONObject): string | null {
  const meta: unknown = node["meta"];
  const configMeta: unknown = config["meta"];

  return (
    (isObject(meta) ? readText(meta["owner"], MAX_NAME_LENGTH) : null) ||
    (isObject(configMeta)
      ? readText(configMeta["owner"], MAX_NAME_LENGTH)
      : null)
  );
}

function readTable(node: JSONObject): DbtTable | null {
  const uniqueId: string | null = readText(node["unique_id"], MAX_NAME_LENGTH);
  const resourceType: string | null = readText(node["resource_type"], 50);
  const name: string | null = readText(node["name"], MAX_NAME_LENGTH);

  if (
    !uniqueId ||
    !name ||
    !(
      resourceType === DbtResourceType.Source ||
      DBT_TABLE_RESOURCE_TYPES.includes(resourceType as DbtResourceType)
    )
  ) {
    return null;
  }

  const config: JSONObject = isObject(node["config"]) ? node["config"] : {};
  const dependsOn: unknown = isObject(node["depends_on"])
    ? node["depends_on"]["nodes"]
    : [];

  return {
    uniqueId,
    resourceType: resourceType as DbtResourceType,
    name,
    database: readText(node["database"], MAX_NAME_LENGTH),
    schema: readText(node["schema"], MAX_NAME_LENGTH),
    relation:
      (resourceType === DbtResourceType.Source
        ? readText(node["identifier"], MAX_NAME_LENGTH)
        : readText(node["alias"], MAX_NAME_LENGTH)) || name,
    description: readText(node["description"], MAX_DBT_MESSAGE_LENGTH),
    tags: readTextList(node["tags"], MAX_TAGS),
    owner: readOwner(node, config),
    materialized: readText(config["materialized"], 100),
    packageName: readText(node["package_name"], MAX_NAME_LENGTH),
    path: readText(node["original_file_path"], MAX_NAME_LENGTH),
    dependsOn: readTextList(dependsOn, 500),
  };
}

function readTest(node: JSONObject): DbtTest | null {
  const uniqueId: string | null = readText(node["unique_id"], MAX_NAME_LENGTH);
  const name: string | null = readText(node["name"], MAX_NAME_LENGTH);

  if (!uniqueId || !name || node["resource_type"] !== DbtResourceType.Test) {
    return null;
  }

  const config: JSONObject = isObject(node["config"]) ? node["config"] : {};
  const metadata: JSONObject | null = isObject(node["test_metadata"])
    ? node["test_metadata"]
    : null;
  const kwargs: JSONObject =
    metadata && isObject(metadata["kwargs"]) ? metadata["kwargs"] : {};
  const dependsOn: Array<string> = readTextList(
    isObject(node["depends_on"]) ? node["depends_on"]["nodes"] : [],
    50,
  );
  const acceptedValues: Array<string> = Array.isArray(kwargs["values"])
    ? kwargs["values"]
        .slice(0, MAX_ACCEPTED_VALUES)
        .map((value: unknown): string => {
          return String(value);
        })
    : [];

  return {
    uniqueId,
    name,
    testName: metadata ? readText(metadata["name"], 200) : null,
    // A test older than dbt 1.5 names its table only among what it depends on.
    attachedNode:
      readText(node["attached_node"], MAX_NAME_LENGTH) || dependsOn[0] || null,
    columnName:
      readText(node["column_name"], MAX_NAME_LENGTH) ||
      readText(kwargs["column_name"], MAX_NAME_LENGTH),
    severity: readText(config["severity"], 20)?.toLowerCase() || null,
    description: readText(node["description"], MAX_DBT_MESSAGE_LENGTH),
    compiledCode: readText(node["compiled_code"], MAX_DBT_COMPILED_CODE_LENGTH),
    acceptedValues: acceptedValues.length > 0 ? acceptedValues : null,
  };
}

export function readDbtManifest(value: unknown): DbtManifest | null {
  if (!isObject(value)) {
    return null;
  }

  const metadata: JSONObject = isObject(value["metadata"])
    ? value["metadata"]
    : {};
  const tables: Map<string, DbtTable> = new Map();
  const tests: Array<DbtTest> = [];
  let read: number = 0;

  for (const group of [value["nodes"], value["sources"]]) {
    if (!isObject(group)) {
      continue;
    }

    for (const node of Object.values(group)) {
      if (read >= MAX_DBT_NODES) {
        break;
      }

      if (!isObject(node)) {
        continue;
      }

      read++;

      const table: DbtTable | null = readTable(node);

      if (table) {
        tables.set(table.uniqueId, table);
        continue;
      }

      const test: DbtTest | null = readTest(node);

      if (test) {
        tests.push(test);
      }
    }
  }

  return {
    projectName: readText(metadata["project_name"], 200),
    adapterType: readText(metadata["adapter_type"], 50)?.toLowerCase() || null,
    tables,
    tests,
  };
}

// The status of a result, of those dbt writes; null for one it does not.
function readStatus(value: unknown): DbtResultStatus | null {
  const status: string = String(value || "").toLowerCase();

  if (status === "runtime error") {
    return DbtResultStatus.Error;
  }

  return (Object.values(DbtResultStatus) as Array<string>).includes(status)
    ? (status as DbtResultStatus)
    : null;
}

function readCompletedAt(timing: unknown): Date | null {
  if (!Array.isArray(timing)) {
    return null;
  }

  let completedAt: Date | null = null;

  for (const step of timing) {
    const at: Date | null = isObject(step)
      ? readDate(step["completed_at"])
      : null;

    if (at && (!completedAt || at > completedAt)) {
      completedAt = at;
    }
  }

  return completedAt;
}

export function readDbtRunResults(
  value: unknown,
  now: Date,
): DbtRunResults | null {
  if (!isObject(value) || !Array.isArray(value["results"])) {
    return null;
  }

  const metadata: JSONObject = isObject(value["metadata"])
    ? value["metadata"]
    : {};
  const invocationId: string | null = readText(metadata["invocation_id"], 100);
  const generatedAt: Date | null = readDate(metadata["generated_at"]);
  const results: Array<DbtNodeResult> = [];

  for (const result of value["results"].slice(0, MAX_DBT_RESULTS)) {
    if (!isObject(result)) {
      continue;
    }

    const uniqueId: string | null = readText(
      result["unique_id"],
      MAX_NAME_LENGTH,
    );

    if (!uniqueId) {
      continue;
    }

    const failures: number | null = readNumber(result["failures"]);

    results.push({
      uniqueId,
      status: readStatus(result["status"]),
      executionTimeInSeconds: readNumber(result["execution_time"]),
      completedAt: readCompletedAt(result["timing"]),
      message: readText(result["message"], MAX_DBT_MESSAGE_LENGTH),
      failures: failures === null ? null : Math.floor(failures),
    });
  }

  return {
    invocationId:
      invocationId && UUID_PATTERN.test(invocationId)
        ? invocationId.toLowerCase()
        : null,
    // A clock far ahead is the producer's: the results are taken as now.
    generatedAt:
      generatedAt && generatedAt.getTime() <= now.getTime() + 5 * 60 * 1000
        ? generatedAt
        : now,
    elapsedTimeInSeconds: readNumber(value["elapsed_time"]),
    command: isObject(value["args"])
      ? readText(value["args"]["which"], 50)
      : null,
    results,
  };
}

const ADAPTER_SCHEMES: Readonly<Record<string, string>> = {
  postgres: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlserver: "sqlserver",
  redshift: "redshift",
  snowflake: "snowflake",
  bigquery: "bigquery",
  clickhouse: "clickhouse",
  databricks: "databricks",
  athena: "awsathena",
  oracle: "oracle",
};

/*
 * The table as an OpenLineage dataset names it, for DatasetMatching: the
 * engine from the adapter, and the database, schema and table from the
 * node. dbt does not know the host, so a table is matched only when one
 * watched database of that engine has its database's name. MySQL's and
 * ClickHouse's schema is their database; Databricks' database is its
 * catalog.
 */
export function getDbtDataset(
  adapterType: string | null,
  table: DbtTable,
): OpenLineageDataset | null {
  const scheme: string | undefined = adapterType
    ? ADAPTER_SCHEMES[adapterType]
    : undefined;

  if (!scheme || !table.schema) {
    return null;
  }

  if (scheme === "mysql" || scheme === "clickhouse") {
    return {
      namespace: `${scheme}://`,
      name: `${table.schema}.${table.relation}`,
    };
  }

  return {
    namespace: `${scheme}://`,
    name: table.database
      ? `${table.database}.${table.schema}.${table.relation}`
      : `${table.schema}.${table.relation}`,
  };
}

// What a test is called on its table's Checks tab: "not_null: order_id".
export function getDbtTestCheckName(test: DbtTest): string {
  const name: string =
    test.testName && test.columnName
      ? `${test.testName}: ${test.columnName}`
      : test.testName || test.name;

  return name.slice(0, 100);
}

// A test result as a check reads it: its status, and the rows it found failing.
export function getDbtTestValue(result: DbtNodeResult): number | null {
  if (result.status === DbtResultStatus.Pass) {
    return 0;
  }

  if (
    result.status === DbtResultStatus.Fail ||
    result.status === DbtResultStatus.Warn
  ) {
    // dbt counts the failing rows; a test that only says it failed found at least one.
    return Math.max(result.failures ?? 1, 1);
  }

  return null;
}

export interface DbtInvocationOutcome {
  state: OpenLineageRunState;
  startedAt: Date;
  endedAt: Date;
  errorMessage: string | null;
}

// How the whole invocation went: failed when any node errored or a test failed.
export function getDbtInvocationOutcome(
  runResults: DbtRunResults,
): DbtInvocationOutcome {
  const failed: Array<DbtNodeResult> = runResults.results.filter(
    (result: DbtNodeResult) => {
      return (
        result.status === DbtResultStatus.Error ||
        result.status === DbtResultStatus.Fail
      );
    },
  );
  const endedAt: Date = runResults.generatedAt;
  const startedAt: Date = new Date(
    endedAt.getTime() - (runResults.elapsedTimeInSeconds || 0) * 1000,
  );

  if (failed.length === 0) {
    return {
      state: OpenLineageRunState.Complete,
      startedAt,
      endedAt,
      errorMessage: null,
    };
  }

  const lines: Array<string> = failed
    .slice(0, 10)
    .map((result: DbtNodeResult): string => {
      return result.message
        ? `${result.uniqueId}: ${result.message}`
        : result.uniqueId;
    });

  return {
    state: OpenLineageRunState.Fail,
    startedAt,
    endedAt,
    errorMessage: [
      `${failed.length} of ${runResults.results.length} nodes failed.`,
      ...lines,
      ...(failed.length > lines.length
        ? [`And ${failed.length - lines.length} more.`]
        : []),
    ]
      .join("\n")
      .slice(0, MAX_DBT_MESSAGE_LENGTH),
  };
}
