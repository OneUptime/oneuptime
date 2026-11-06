import { JSONObject, JSONValue } from "../JSON";

/*
 * DBT'S ARTIFACTS, AS DATA OBSERVABILITY READS THEM.
 *
 * After `dbt build` - or run, test, seed or snapshot - dbt writes
 * target/manifest.json, every model, seed, snapshot, source and test of the
 * project with what each depends on, and target/run_results.json, how each
 * node of that invocation went. A manifest runs to tens of megabytes, almost
 * all of it compiled SQL and macros: the CLI sends only what is read here
 * (trimDbtManifest), and the server reads no more than that of a whole one.
 */

// The resources of a manifest that Data Observability reads.
export enum DbtResourceType {
  Model = "model",
  Seed = "seed",
  Snapshot = "snapshot",
  Source = "source",
  Test = "test",
}

// The resources that build a table: dbt writes them, and a test can be on them.
export const DBT_TABLE_RESOURCE_TYPES: ReadonlyArray<DbtResourceType> = [
  DbtResourceType.Model,
  DbtResourceType.Seed,
  DbtResourceType.Snapshot,
];

// How a dbt node's last build went, from the run results it was in.
export interface DataAssetDbtLastRun {
  // dbt's own status: success, error, skipped.
  status: string;
  completedAt: string | null;
  executionTimeInSeconds: number | null;
  message: string | null;
}

// The dbt node a watched table is (DataAsset.dbtNode).
export interface DataAssetDbtNode {
  uniqueId: string;
  resourceType: DbtResourceType;
  projectName: string;
  packageName: string | null;
  materialized: string | null;
  path: string | null;
  tags: Array<string>;
  owner: string | null;
  // When the manifest naming it was read.
  readAt: string;
  lastRun: DataAssetDbtLastRun | null;
}

// What is read of each node and source; the rest of the manifest is left out.
export const DBT_NODE_KEYS: ReadonlyArray<string> = [
  "unique_id",
  "resource_type",
  "name",
  "database",
  "schema",
  "alias",
  "identifier",
  "source_name",
  "package_name",
  "original_file_path",
  "description",
  "tags",
  "meta",
  "config",
  "depends_on",
  "test_metadata",
  "attached_node",
  "column_name",
  "compiled_code",
];

const DBT_CONFIG_KEYS: ReadonlyArray<string> = [
  "materialized",
  "severity",
  "enabled",
  "tags",
  "meta",
];

const DBT_TEST_ARGUMENT_KEYS: ReadonlyArray<string> = [
  "column_name",
  "values",
  "field",
  "to",
];

// What is read of each result of run_results.json.
export const DBT_RESULT_KEYS: ReadonlyArray<string> = [
  "unique_id",
  "status",
  "execution_time",
  "timing",
  "message",
  "failures",
];

// The longest compiled SQL of a test kept, to show what it reads.
export const MAX_DBT_COMPILED_CODE_LENGTH: number = 4000;

// The longest message of a result kept.
export const MAX_DBT_MESSAGE_LENGTH: number = 2000;

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(value: unknown, keys: ReadonlyArray<string>): JSONObject {
  const picked: JSONObject = {};

  if (!isObject(value)) {
    return picked;
  }

  for (const key of keys) {
    if (value[key] !== undefined) {
      picked[key] = value[key];
    }
  }

  return picked;
}

function trimText(value: JSONValue, maxLength: number): JSONValue {
  return typeof value === "string" ? value.slice(0, maxLength) : value;
}

function trimNode(node: unknown): JSONObject {
  const trimmed: JSONObject = pick(node, DBT_NODE_KEYS);

  if (trimmed["config"] !== undefined) {
    trimmed["config"] = pick(trimmed["config"], DBT_CONFIG_KEYS);
  }

  if (trimmed["depends_on"] !== undefined) {
    trimmed["depends_on"] = pick(trimmed["depends_on"], ["nodes"]);
  }

  if (isObject(trimmed["test_metadata"])) {
    trimmed["test_metadata"] = {
      ...pick(trimmed["test_metadata"], ["name", "namespace"]),
      kwargs: pick(trimmed["test_metadata"]["kwargs"], DBT_TEST_ARGUMENT_KEYS),
    };
  }

  // A test's SQL shows what it reads; a model's is most of a manifest, and unread.
  if (trimmed["resource_type"] !== DbtResourceType.Test) {
    delete trimmed["compiled_code"];
  } else if (trimmed["compiled_code"] !== undefined) {
    trimmed["compiled_code"] = trimText(
      trimmed["compiled_code"],
      MAX_DBT_COMPILED_CODE_LENGTH,
    );
  }

  return trimmed;
}

// The manifest as Data Observability reads it: its tables, sources and tests.
export function trimDbtManifest(manifest: unknown): JSONObject {
  const nodes: JSONObject = {};
  const sources: JSONObject = {};

  if (isObject(manifest) && isObject(manifest["nodes"])) {
    for (const [uniqueId, node] of Object.entries(manifest["nodes"])) {
      const resourceType: unknown = isObject(node)
        ? node["resource_type"]
        : undefined;

      if (
        resourceType === DbtResourceType.Test ||
        DBT_TABLE_RESOURCE_TYPES.includes(resourceType as DbtResourceType)
      ) {
        nodes[uniqueId] = trimNode(node);
      }
    }
  }

  if (isObject(manifest) && isObject(manifest["sources"])) {
    for (const [uniqueId, source] of Object.entries(manifest["sources"])) {
      sources[uniqueId] = trimNode(source);
    }
  }

  return {
    metadata: pick(isObject(manifest) ? manifest["metadata"] : undefined, [
      "project_name",
      "adapter_type",
      "dbt_version",
      "generated_at",
      "invocation_id",
    ]),
    nodes,
    sources,
  };
}

// The results as Data Observability reads them: each node's status and timing.
export function trimDbtRunResults(runResults: unknown): JSONObject {
  const results: Array<JSONObject> = [];

  if (isObject(runResults) && Array.isArray(runResults["results"])) {
    for (const result of runResults["results"]) {
      const trimmed: JSONObject = pick(result, DBT_RESULT_KEYS);

      if (trimmed["message"] !== undefined) {
        trimmed["message"] = trimText(
          trimmed["message"],
          MAX_DBT_MESSAGE_LENGTH,
        );
      }

      results.push(trimmed);
    }
  }

  return {
    metadata: pick(isObject(runResults) ? runResults["metadata"] : undefined, [
      "generated_at",
      "invocation_id",
      "dbt_version",
    ]),
    elapsed_time: isObject(runResults) ? runResults["elapsed_time"] : undefined,
    args: pick(isObject(runResults) ? runResults["args"] : undefined, [
      "which",
    ]),
    results,
  } as JSONObject;
}
