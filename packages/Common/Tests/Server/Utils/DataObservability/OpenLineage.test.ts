import { describe, expect, test } from "@jest/globals";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataPipelineMetricName } from "../../../../Types/DataObservability/DataPipelineMetric";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_DATASETS_PER_EVENT,
  OpenLineageRunEvent,
  OpenLineageRunState,
  parseDatasetName,
  readOpenLineageEvent,
  readOpenLineageEvents,
} from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import { matchDataset } from "../../../../Server/Utils/DataObservability/DatasetMatching";
import {
  buildPipelineMetricRow,
  getPipelineKey,
  isFinalState,
  MAX_DATASETS_KEPT,
  mergeDatasetLabels,
} from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import {
  UsageAsset,
  UsageStore,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";

/*
 * OpenLineage events come from outside: they are read strictly, their
 * datasets matched to watched tables only when that is certain, and a run
 * is kept by what its events say.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const RUN_ID: string = "01890a5d-ac96-774b-b8e4-2b2c3b3f4c5d";

function event(overrides: JSONObject = {}): JSONObject {
  return {
    eventType: "COMPLETE",
    eventTime: "2026-11-03T11:59:00.000Z",
    run: { runId: RUN_ID },
    job: { namespace: "airflow://prod", name: "orders_daily.load_orders" },
    inputs: [
      {
        namespace: "postgres://orders-db:5432",
        name: "orders.public.raw_orders",
      },
    ],
    outputs: [
      { namespace: "postgres://orders-db:5432", name: "orders.public.orders" },
    ],
    ...overrides,
  };
}

describe("readOpenLineageEvent", () => {
  test("reads a run event: its job, run, state, time and datasets", () => {
    expect(readOpenLineageEvent(event(), NOW)).toEqual({
      eventType: OpenLineageRunState.Complete,
      eventTime: new Date("2026-11-03T11:59:00.000Z"),
      runId: RUN_ID,
      jobNamespace: "airflow://prod",
      jobName: "orders_daily.load_orders",
      errorMessage: null,
      inputs: [
        {
          namespace: "postgres://orders-db:5432",
          name: "orders.public.raw_orders",
        },
      ],
      outputs: [
        {
          namespace: "postgres://orders-db:5432",
          name: "orders.public.orders",
        },
      ],
    });
  });

  test("a failed run's error comes from its errorMessage facet", () => {
    expect(
      readOpenLineageEvent(
        event({
          eventType: "FAIL",
          run: {
            runId: RUN_ID,
            facets: { errorMessage: { message: "relation does not exist" } },
          },
        }),
        NOW,
      )?.errorMessage,
    ).toBe("relation does not exist");
  });

  test("no job name or namespace, or not an object, is no event", () => {
    expect(readOpenLineageEvent(event({ job: { namespace: "a" } }), NOW)).toBe(
      null,
    );
    expect(readOpenLineageEvent("nope", NOW)).toBe(null);
    expect(readOpenLineageEvent([], NOW)).toBe(null);
  });

  test("an unknown state is OTHER, a run id that is not a UUID is none", () => {
    const read: OpenLineageRunEvent | null = readOpenLineageEvent(
      event({ eventType: "WEIRD", run: { runId: "not-a-uuid" } }),
      NOW,
    );

    expect(read?.eventType).toBe(OpenLineageRunState.Other);
    expect(read?.runId).toBe(null);
  });

  test("a clock far off is the producer's: the event is taken as now", () => {
    expect(
      readOpenLineageEvent(event({ eventTime: "2031-01-01T00:00:00Z" }), NOW)
        ?.eventTime,
    ).toEqual(NOW);
    expect(
      readOpenLineageEvent(event({ eventTime: "yesterday" }), NOW)?.eventTime,
    ).toEqual(NOW);
  });

  test("datasets are deduplicated, bounded, and need a namespace and a name", () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_DATASETS_PER_EVENT + 50; index++) {
      many.push({ namespace: "s3://bucket", name: `file-${index}` });
    }

    expect(
      readOpenLineageEvent(
        event({
          inputs: [
            { namespace: "a", name: "b" },
            { namespace: "a", name: "b" },
            { namespace: "a" },
            "junk",
          ],
          outputs: many,
        }),
        NOW,
      ),
    ).toMatchObject({
      inputs: [{ namespace: "a", name: "b" }],
    });
    expect(
      readOpenLineageEvent(event({ outputs: many }), NOW)?.outputs.length,
    ).toBe(MAX_DATASETS_PER_EVENT);
  });

  test("a request holds one event or an array of them", () => {
    expect(readOpenLineageEvents(event(), NOW)).toHaveLength(1);
    expect(
      readOpenLineageEvents([event(), event({ job: {} }), event()], NOW),
    ).toHaveLength(2);
  });
});

describe("parseDatasetName", () => {
  test("PostgreSQL and SQL Server: database.schema.table at a host", () => {
    expect(
      parseDatasetName({
        namespace: "postgres://Orders-DB:5432",
        name: "orders.public.orders",
      }),
    ).toEqual({
      kind: DataStoreKind.PostgreSql,
      host: "orders-db",
      database: "orders",
      schema: "public",
      table: "orders",
    });
    expect(
      parseDatasetName({
        namespace: "sqlserver://sql01:1433",
        name: "sales.dbo.invoices",
      })?.kind,
    ).toBe(DataStoreKind.SqlServer);
  });

  test("MySQL: database.table, its schema the database", () => {
    expect(
      parseDatasetName({
        namespace: "mysql://billing:3306",
        name: "billing.invoices",
      }),
    ).toEqual({
      kind: DataStoreKind.MySql,
      host: "billing",
      database: "billing",
      schema: "billing",
      table: "invoices",
    });
  });

  test("a file, a topic, or an empty part has no kind or no name", () => {
    expect(
      parseDatasetName({ namespace: "s3://bucket", name: "path/file.parquet" })
        ?.kind,
    ).toBe(null);
    expect(
      parseDatasetName({ namespace: "postgres://h:5432", name: "a..b" }),
    ).toBe(null);
  });
});

describe("matchDataset", () => {
  const stores: Array<UsageStore> = [
    {
      dataStoreId: "store-orders",
      kind: DataStoreKind.PostgreSql,
      databaseName: "orders",
      serverAddress: "orders-db",
    },
  ];
  const assets: Array<UsageAsset> = [
    {
      dataAssetId: "asset-orders",
      dataStoreId: "store-orders",
      schemaName: "public",
      name: "orders",
    },
  ];

  test("a dataset naming a watched table is that table", () => {
    expect(
      matchDataset({
        dataset: {
          namespace: "postgres://orders-db:5432",
          name: "orders.public.orders",
        },
        stores,
        assets,
      })?.dataAssetId,
    ).toBe("asset-orders");
  });

  test("another database, another engine, or a file matches nothing", () => {
    for (const dataset of [
      {
        namespace: "postgres://orders-db:5432",
        name: "inventory.public.orders",
      },
      { namespace: "mysql://orders-db:3306", name: "orders.orders" },
      { namespace: "s3://bucket", name: "orders.csv" },
    ]) {
      expect(matchDataset({ dataset, stores, assets })).toBe(null);
    }
  });
});

describe("OpenLineageIngest helpers", () => {
  test("a pipeline is its job's namespace and name", () => {
    expect(getPipelineKey(readOpenLineageEvent(event(), NOW)!)).toBe(
      "airflow://prod/orders_daily.load_orders",
    );
  });

  test("a run ends in COMPLETE, FAIL or ABORT", () => {
    expect(isFinalState("COMPLETE")).toBe(true);
    expect(isFinalState("FAIL")).toBe(true);
    expect(isFinalState("ABORT")).toBe(true);
    expect(isFinalState("RUNNING")).toBe(false);
    expect(isFinalState(undefined)).toBe(false);
  });

  test("dataset labels keep what they had, add what is new, bounded", () => {
    expect(
      mergeDatasetLabels(
        ["a/b"],
        [
          { namespace: "a", name: "b" },
          { namespace: "c", name: "d" },
        ],
      ),
    ).toEqual(["a/b", "c/d"]);

    const many: Array<{ namespace: string; name: string }> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({ namespace: "s3://x", name: `f${index}` });
    }

    expect(mergeDatasetLabels([], many)).toHaveLength(MAX_DATASETS_KEPT);
  });

  test("a run's metric row is the pipeline's, never billed", () => {
    const pipeline: DataPipeline = new DataPipeline();
    pipeline.id = ObjectID.generate();
    pipeline.jobName = "load_orders";
    pipeline.jobNamespace = "airflow://prod";

    const row: JSONObject = buildPipelineMetricRow({
      projectId: ObjectID.generate(),
      pipeline,
      metricName: DataPipelineMetricName.RunFailed,
      value: 1,
      at: NOW,
      retentionDays: 30,
    });

    expect(row["name"]).toBe(DataPipelineMetricName.RunFailed);
    expect(row["primaryEntityType"]).toBe(ServiceType.DataPipeline);
    expect(row["primaryEntityId"]).toBe(pipeline.id.toString());
    expect(row["value"]).toBe(1);
    expect(row["attributes"]).toEqual({
      "oneuptime.data.pipeline.id": pipeline.id.toString(),
      "oneuptime.data.pipeline.name": "load_orders",
      "oneuptime.data.pipeline.namespace": "airflow://prod",
    });
  });
});
