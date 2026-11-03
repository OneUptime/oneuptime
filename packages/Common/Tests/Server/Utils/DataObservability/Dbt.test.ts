import { describe, expect, test } from "@jest/globals";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DbtResourceType,
  trimDbtManifest,
} from "../../../../Types/DataObservability/DbtArtifact";
import { JSONObject } from "../../../../Types/JSON";
import {
  DbtManifest,
  DbtResultStatus,
  DbtRunResults,
  DbtTable,
  DbtTest,
  getDbtDataset,
  getDbtInvocationOutcome,
  getDbtTestCheckName,
  getDbtTestValue,
  readDbtManifest,
  readDbtRunResults,
} from "../../../../Server/Utils/DataObservability/DbtArtifacts";
import {
  buildDataAssetDbtNode,
  DBT_PIPELINE_NAMESPACE,
  getDbtInvocationEvents,
  getDbtTestCheckFields,
  getDbtTestRunStatus,
} from "../../../../Server/Utils/DataObservability/DbtIngest";
import { matchDataset } from "../../../../Server/Utils/DataObservability/DatasetMatching";
import { OpenLineageRunState } from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import {
  UsageAsset,
  UsageStore,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";

/*
 * dbt's artifacts come from outside: they are read strictly, their tables
 * matched to watched ones only when that is certain, their tests made
 * checks of what dbt decides, and an invocation a run of the project's
 * pipeline.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const INVOCATION_ID: string = "01890a5d-ac96-774b-b8e4-2b2c3b3f4c5d";

const MANIFEST: JSONObject = {
  metadata: { project_name: "jaffle_shop", adapter_type: "postgres" },
  nodes: {
    "model.jaffle_shop.orders": {
      unique_id: "model.jaffle_shop.orders",
      resource_type: "model",
      name: "orders",
      database: "jaffle",
      schema: "public",
      alias: "orders_v2",
      package_name: "jaffle_shop",
      original_file_path: "models/orders.sql",
      description: "One row per order.",
      tags: ["finance", "finance", "daily"],
      meta: { owner: "data-team" },
      config: { materialized: "table" },
      depends_on: {
        nodes: [
          "model.jaffle_shop.stg_orders",
          "source.jaffle_shop.raw.orders",
        ],
      },
    },
    "test.jaffle_shop.accepted_values_orders_status.ab12": {
      unique_id: "test.jaffle_shop.accepted_values_orders_status.ab12",
      resource_type: "test",
      name: "accepted_values_orders_status__placed__shipped",
      test_metadata: {
        name: "accepted_values",
        kwargs: { column_name: "status", values: ["placed", "shipped"] },
      },
      attached_node: "model.jaffle_shop.orders",
      config: { severity: "WARN" },
      compiled_code: "select status from orders where status not in (...)",
    },
    "test.jaffle_shop.assert_total_positive": {
      unique_id: "test.jaffle_shop.assert_total_positive",
      resource_type: "test",
      name: "assert_total_positive",
      // Before dbt 1.5 a test names its table only among what it depends on.
      depends_on: { nodes: ["model.jaffle_shop.orders"] },
    },
    "operation.jaffle_shop.on-run-end": {
      unique_id: "operation.jaffle_shop.on-run-end",
      resource_type: "operation",
      name: "on-run-end",
    },
  },
  sources: {
    "source.jaffle_shop.raw.orders": {
      unique_id: "source.jaffle_shop.raw.orders",
      resource_type: "source",
      name: "orders",
      identifier: "raw_orders",
      database: "jaffle",
      schema: "raw",
    },
  },
};

const RUN_RESULTS: JSONObject = {
  metadata: {
    generated_at: "2026-11-03T11:00:00Z",
    invocation_id: INVOCATION_ID,
  },
  elapsed_time: 120,
  args: { which: "build" },
  results: [
    {
      unique_id: "model.jaffle_shop.orders",
      status: "success",
      execution_time: 4.5,
      timing: [
        { name: "compile", completed_at: "2026-11-03T10:59:00Z" },
        { name: "execute", completed_at: "2026-11-03T10:59:30Z" },
      ],
      message: "SELECT 99",
      failures: null,
    },
    {
      unique_id: "test.jaffle_shop.accepted_values_orders_status.ab12",
      status: "warn",
      message: "Got 3 results, configured to warn if != 0",
      failures: 3,
    },
    {
      unique_id: "test.jaffle_shop.assert_total_positive",
      status: "fail",
      message: "Got 1 result, configured to fail if != 0",
      failures: 1,
    },
  ],
};

function manifest(): DbtManifest {
  return readDbtManifest(MANIFEST)!;
}

function runResults(): DbtRunResults {
  return readDbtRunResults(RUN_RESULTS, NOW)!;
}

describe("readDbtManifest", () => {
  test("reads the project, its tables and its tests, and nothing else", () => {
    const read: DbtManifest = manifest();

    expect(read.projectName).toBe("jaffle_shop");
    expect(read.adapterType).toBe("postgres");
    expect(Array.from(read.tables.keys()).sort()).toEqual([
      "model.jaffle_shop.orders",
      "source.jaffle_shop.raw.orders",
    ]);
    expect(
      read.tests.map((test: DbtTest) => {
        return test.uniqueId;
      }),
    ).toEqual([
      "test.jaffle_shop.accepted_values_orders_status.ab12",
      "test.jaffle_shop.assert_total_positive",
    ]);
  });

  test("a model is its alias, a source its identifier", () => {
    const read: DbtManifest = manifest();

    expect(read.tables.get("model.jaffle_shop.orders")).toEqual({
      uniqueId: "model.jaffle_shop.orders",
      resourceType: DbtResourceType.Model,
      name: "orders",
      database: "jaffle",
      schema: "public",
      relation: "orders_v2",
      description: "One row per order.",
      tags: ["finance", "daily"],
      owner: "data-team",
      materialized: "table",
      packageName: "jaffle_shop",
      path: "models/orders.sql",
      dependsOn: [
        "model.jaffle_shop.stg_orders",
        "source.jaffle_shop.raw.orders",
      ],
    });
    expect(read.tables.get("source.jaffle_shop.raw.orders")?.relation).toBe(
      "raw_orders",
    );
  });

  test("a test's table, column, values and severity", () => {
    const [generic, singular] = manifest().tests;

    expect(generic).toMatchObject({
      testName: "accepted_values",
      attachedNode: "model.jaffle_shop.orders",
      columnName: "status",
      severity: "warn",
      acceptedValues: ["placed", "shipped"],
    });
    expect(singular).toMatchObject({
      testName: null,
      attachedNode: "model.jaffle_shop.orders",
      columnName: null,
    });
  });

  test("the trimmed manifest the CLI sends reads the same", () => {
    const fromTrimmed: DbtManifest = readDbtManifest(
      trimDbtManifest(MANIFEST),
    )!;

    expect(Array.from(fromTrimmed.tables.values())).toEqual(
      Array.from(manifest().tables.values()),
    );
    expect(fromTrimmed.tests).toEqual(manifest().tests);
  });

  test("what is not a manifest is none", () => {
    expect(readDbtManifest("nope")).toBe(null);
    expect(readDbtManifest([])).toBe(null);
    expect(readDbtManifest({ nodes: { a: "junk" } })?.tables.size).toBe(0);
  });
});

describe("readDbtRunResults", () => {
  test("reads the invocation and each result", () => {
    const read: DbtRunResults = runResults();

    expect(read.invocationId).toBe(INVOCATION_ID);
    expect(read.generatedAt).toEqual(new Date("2026-11-03T11:00:00Z"));
    expect(read.elapsedTimeInSeconds).toBe(120);
    expect(read.command).toBe("build");
    expect(read.results[0]).toEqual({
      uniqueId: "model.jaffle_shop.orders",
      status: DbtResultStatus.Success,
      executionTimeInSeconds: 4.5,
      completedAt: new Date("2026-11-03T10:59:30Z"),
      message: "SELECT 99",
      failures: null,
    });
    expect(read.results[1]?.failures).toBe(3);
  });

  test("a clock far ahead is taken as now; an id that is no UUID is none", () => {
    const read: DbtRunResults = readDbtRunResults(
      {
        metadata: { generated_at: "2031-01-01T00:00:00Z", invocation_id: "x" },
        results: [{ unique_id: "model.a.b", status: "runtime error" }],
      },
      NOW,
    )!;

    expect(read.generatedAt).toEqual(NOW);
    expect(read.invocationId).toBe(null);
    expect(read.results[0]?.status).toBe(DbtResultStatus.Error);
  });

  test("what is not run results is none", () => {
    expect(readDbtRunResults({ metadata: {} }, NOW)).toBe(null);
  });
});

describe("matching a dbt table to a watched one", () => {
  const stores: Array<UsageStore> = [
    {
      dataStoreId: "store-jaffle",
      kind: DataStoreKind.PostgreSql,
      databaseName: "jaffle",
      serverAddress: "jaffle-db",
    },
  ];
  const assets: Array<UsageAsset> = [
    {
      dataAssetId: "asset-orders",
      dataStoreId: "store-jaffle",
      schemaName: "public",
      name: "orders_v2",
    },
    {
      dataAssetId: "asset-raw-orders",
      dataStoreId: "store-jaffle",
      schemaName: "raw",
      name: "raw_orders",
    },
  ];

  function matched(adapter: string | null, table: DbtTable): string | null {
    const dataset: ReturnType<typeof getDbtDataset> = getDbtDataset(
      adapter,
      table,
    );

    return dataset
      ? matchDataset({ dataset, stores, assets })?.dataAssetId || null
      : null;
  }

  test("by database, schema and its name in the database", () => {
    const read: DbtManifest = manifest();

    expect(
      matched("postgres", read.tables.get("model.jaffle_shop.orders")!),
    ).toBe("asset-orders");
    expect(
      matched("postgres", read.tables.get("source.jaffle_shop.raw.orders")!),
    ).toBe("asset-raw-orders");
  });

  test("a warehouse OneUptime does not read, or another database, matches nothing", () => {
    const orders: DbtTable = manifest().tables.get("model.jaffle_shop.orders")!;

    expect(getDbtDataset("databricks", orders)).toBe(null);
    expect(getDbtDataset("snowflake", orders)).toEqual({
      namespace: "snowflake://",
      name: "jaffle.public.orders_v2",
    });
    expect(matched("postgres", { ...orders, database: "other" })).toBe(null);
    expect(matched("mysql", orders)).toBe(null);
  });

  test("MySQL's schema is its database", () => {
    expect(
      getDbtDataset("mysql", {
        ...manifest().tables.get("model.jaffle_shop.orders")!,
        database: null,
        schema: "shop",
      }),
    ).toEqual({ namespace: "mysql://", name: "shop.orders_v2" });
  });
});

describe("a test as a check", () => {
  test("named by the test and its column, described by what dbt says", () => {
    const [generic, singular] = manifest().tests;

    expect(getDbtTestCheckName(generic!)).toBe("accepted_values: status");
    expect(getDbtTestCheckName(singular!)).toBe("assert_total_positive");
    expect(getDbtTestCheckFields(generic!)).toEqual({
      name: "accepted_values: status",
      description: "dbt test accepted_values on status (severity warn).",
      columnName: "status",
      acceptedValues: ["placed", "shipped"],
      customSql: "select status from orders where status not in (...)",
    });
  });

  test("its value is the rows it found failing; a pass is 0, an error none", () => {
    expect(
      getDbtTestValue({
        uniqueId: "t",
        status: DbtResultStatus.Pass,
        executionTimeInSeconds: null,
        completedAt: null,
        message: null,
        failures: 0,
      }),
    ).toBe(0);
    expect(getDbtTestValue(runResults().results[1]!)).toBe(3);
    expect(
      getDbtTestValue({
        uniqueId: "t",
        status: DbtResultStatus.Fail,
        executionTimeInSeconds: null,
        completedAt: null,
        message: null,
        failures: null,
      }),
    ).toBe(1);
    expect(
      getDbtTestValue({
        uniqueId: "t",
        status: DbtResultStatus.Error,
        executionTimeInSeconds: null,
        completedAt: null,
        message: "relation does not exist",
        failures: null,
      }),
    ).toBe(null);
  });

  test("its result as the check shows it; a skipped test keeps its last", () => {
    expect(getDbtTestRunStatus(DbtResultStatus.Pass)).toBe("Passed");
    expect(getDbtTestRunStatus(DbtResultStatus.Fail)).toBe("Failed");
    expect(getDbtTestRunStatus(DbtResultStatus.Warn)).toBe("Warned");
    expect(getDbtTestRunStatus(DbtResultStatus.Error)).toBe("Errored");
    expect(getDbtTestRunStatus(DbtResultStatus.Skipped)).toBe(null);
  });
});

describe("a table's dbt node", () => {
  test("what dbt says of it, and how its last build went", () => {
    expect(
      buildDataAssetDbtNode({
        table: manifest().tables.get("model.jaffle_shop.orders")!,
        projectName: "jaffle_shop",
        result: runResults().results[0],
        readAt: NOW,
      }),
    ).toEqual({
      uniqueId: "model.jaffle_shop.orders",
      resourceType: DbtResourceType.Model,
      projectName: "jaffle_shop",
      packageName: "jaffle_shop",
      materialized: "table",
      path: "models/orders.sql",
      tags: ["finance", "daily"],
      owner: "data-team",
      readAt: NOW.toISOString(),
      lastRun: {
        status: "success",
        completedAt: "2026-11-03T10:59:30.000Z",
        executionTimeInSeconds: 4.5,
        message: "SELECT 99",
      },
    });
  });
});

describe("an invocation as a run of the project's pipeline", () => {
  test("failed when a node errored or a test failed, with what failed", () => {
    const outcome: ReturnType<typeof getDbtInvocationOutcome> =
      getDbtInvocationOutcome(runResults());

    expect(outcome.state).toBe(OpenLineageRunState.Fail);
    expect(outcome.startedAt).toEqual(new Date("2026-11-03T10:58:00Z"));
    expect(outcome.endedAt).toEqual(new Date("2026-11-03T11:00:00Z"));
    // A warning does not fail the build: the failed test does.
    expect(outcome.errorMessage).toBe(
      "1 of 3 nodes failed.\ntest.jaffle_shop.assert_total_positive: Got 1 result, configured to fail if != 0",
    );
  });

  test("its start and its end, under the dbt namespace and the project's name", () => {
    const events: ReturnType<typeof getDbtInvocationEvents> =
      getDbtInvocationEvents({
        projectName: "jaffle_shop",
        runResults: runResults(),
      });

    expect(
      events.map((event: (typeof events)[number]) => {
        return [
          event.eventType,
          event.runId,
          event.jobNamespace,
          event.jobName,
        ];
      }),
    ).toEqual([
      [
        OpenLineageRunState.Start,
        INVOCATION_ID,
        DBT_PIPELINE_NAMESPACE,
        "jaffle_shop",
      ],
      [
        OpenLineageRunState.Fail,
        INVOCATION_ID,
        DBT_PIPELINE_NAMESPACE,
        "jaffle_shop",
      ],
    ]);
    // Lineage is the manifest's, edge by edge, never every input to every output.
    expect(events[1]!.inputs).toEqual([]);
    expect(events[1]!.outputs).toEqual([]);
  });

  test("without an invocation id there is no run to record", () => {
    expect(
      getDbtInvocationEvents({
        projectName: "jaffle_shop",
        runResults: { ...runResults(), invocationId: null },
      }),
    ).toEqual([]);
  });
});
