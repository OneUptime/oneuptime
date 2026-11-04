import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  OpenLineageRunEvent,
  OpenLineageRunState,
  readAttemptNumber,
  readOpenLineageEvent,
} from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import { ProjectCatalog } from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import {
  buildTraceJobRunsStatement,
  buildTraceJobTablesStatement,
  MAX_RUNS_PER_JOB,
  readTraceJobRun,
  toTraceJobEvents,
  TraceJobRun,
  TraceJobTableRow,
} from "../../../../Server/Utils/DataObservability/TraceJobDiscovery";

/*
 * A CronJob or a function on a timer, found in its traces and recorded as a
 * pipeline: its runs, whether they failed, and the tables they touched.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));

const CATALOG: ProjectCatalog = {
  stores: [
    {
      dataStoreId: "store",
      kind: DataStoreKind.PostgreSql,
      databaseName: "shop",
      serverAddress: "db",
    },
  ],
  assets: [
    {
      dataAssetId: "orders",
      dataStoreId: "store",
      schemaName: "public",
      name: "orders",
    },
    {
      dataAssetId: "customers",
      dataStoreId: "store",
      schemaName: "public",
      name: "customers",
    },
  ],
  storeNames: new Map(),
};

function run(overrides: Partial<TraceJobRun> = {}): TraceJobRun {
  return {
    jobNamespace: "kubernetes://prod/default",
    jobName: "nightly-export",
    runKey: "nightly-export-28394110",
    startedAt: new Date(NOW.getTime() - 20 * 60_000),
    endedAt: new Date(NOW.getTime() - 10 * 60_000),
    failedRootCount: 0,
    errorMessage: null,
    traceId: "abc",
    ...overrides,
  };
}

function tableRow(operation: string, collection: string): TraceJobTableRow {
  return {
    jobNamespace: "kubernetes://prod/default",
    jobName: "nightly-export",
    runKey: "nightly-export-28394110",
    serviceId: "service",
    dbSystem: "postgresql",
    dbNamespace: "shop",
    serverAddress: "db",
    collection,
    operation,
    callCount: 1,
    errorCount: 0,
    lastSeenAt: NOW,
  };
}

function eventTypes(events: Array<OpenLineageRunEvent>): Array<string> {
  return events.map((event: OpenLineageRunEvent) => {
    return event.eventType;
  });
}

describe("a run from its spans", () => {
  test("a run that has gone quiet started and ended", () => {
    const events: Array<OpenLineageRunEvent> = toTraceJobEvents({
      runs: [run()],
      tables: [],
      catalog: CATALOG,
      now: NOW,
    });

    expect(eventTypes(events)).toEqual([
      OpenLineageRunState.Start,
      OpenLineageRunState.Complete,
    ]);
    expect(events[1]?.eventTime).toEqual(run().endedAt);
    expect(events[0]?.traceId).toBe("abc");
  });

  test("a run still sending spans has only started", () => {
    expect(
      eventTypes(
        toTraceJobEvents({
          runs: [run({ endedAt: new Date(NOW.getTime() - 60_000) })],
          tables: [],
          catalog: CATALOG,
          now: NOW,
        }),
      ),
    ).toEqual([OpenLineageRunState.Start]);
  });

  test("a failure at the top of its trace fails it, and says why", () => {
    const events: Array<OpenLineageRunEvent> = toTraceJobEvents({
      runs: [run({ failedRootCount: 1, errorMessage: "out of memory" })],
      tables: [],
      catalog: CATALOG,
      now: NOW,
    });

    expect(events[1]?.eventType).toBe(OpenLineageRunState.Fail);
    expect(events[1]?.errorMessage).toBe("out of memory");
  });

  test("what it wrote and read are tables the project watches", () => {
    const events: Array<OpenLineageRunEvent> = toTraceJobEvents({
      runs: [run()],
      tables: [
        tableRow("INSERT", "public.orders"),
        tableRow("SELECT", "public.customers"),
        tableRow("SELECT", "public.not_watched"),
      ],
      catalog: CATALOG,
      now: NOW,
    });

    expect(events[0]?.outputDataAssetIds).toEqual(["orders"]);
    expect(events[0]?.inputDataAssetIds).toEqual(["customers"]);
  });

  test("a busy job keeps its latest runs", () => {
    const events: Array<OpenLineageRunEvent> = toTraceJobEvents({
      runs: Array.from({ length: MAX_RUNS_PER_JOB + 5 }).map(
        (_: unknown, index: number) => {
          return run({ runKey: `run-${index}` });
        },
      ),
      tables: [],
      catalog: CATALOG,
      now: NOW,
    });

    expect(
      new Set(
        events.map((event: OpenLineageRunEvent) => {
          return event.runId;
        }),
      ).size,
    ).toBe(MAX_RUNS_PER_JOB);
  });
});

describe("a row of the read", () => {
  test("reads ClickHouse's dates", () => {
    expect(
      readTraceJobRun({
        jobNamespace: "function://aws",
        jobName: "nightly",
        runKey: "invocation-1",
        startedAt: "2026-11-04 11:00:00.000000",
        endedAt: "2026-11-04 11:05:00.000000",
        failedRootCount: "2",
        errorMessage: "boom",
        traceId: "abc",
      }),
    ).toEqual({
      jobNamespace: "function://aws",
      jobName: "nightly",
      runKey: "invocation-1",
      startedAt: new Date(Date.UTC(2026, 10, 4, 11, 0, 0)),
      endedAt: new Date(Date.UTC(2026, 10, 4, 11, 5, 0)),
      failedRootCount: 2,
      errorMessage: "boom",
      traceId: "abc",
    });
  });

  test("no job, or a name too long to be one, is no run", () => {
    expect(
      readTraceJobRun({
        jobName: "",
        runKey: "a",
        startedAt: "x",
        endedAt: "y",
      }),
    ).toBeNull();
    expect(
      readTraceJobRun({
        jobName: "a",
        runKey: "r".repeat(101),
        startedAt: "2026-11-04 11:00:00.000000",
        endedAt: "2026-11-04 11:05:00.000000",
      }),
    ).toBeNull();
  });
});

describe("the reads", () => {
  const window: { projectId: ObjectID; since: Date; until: Date } = {
    projectId: new ObjectID("7f9c24e8-3b12-4fef-91e2-111111111111"),
    since: new Date(NOW.getTime() - 30 * 60_000),
    until: NOW,
  };

  test("a function behind HTTP is a service, not a job", () => {
    expect(buildTraceJobRunsStatement(window).query).toContain(
      "attributes['faas.trigger'] IN ('timer', 'datasource')",
    );
  });

  test("a CronJob's run is its Kubernetes Job", () => {
    expect(buildTraceJobRunsStatement(window).query).toContain(
      "attributes['resource.k8s.job.name'] != '', attributes['resource.k8s.job.name']",
    );
  });

  test("tables come from its client spans", () => {
    const query: string = buildTraceJobTablesStatement(window).query;

    expect(query).toContain("dbSystem != ''");
    expect(query).toContain("kind = ");
  });
});

describe("which try a run is", () => {
  test("Airflow's provider says", () => {
    expect(
      readAttemptNumber({ airflow: { taskInstance: { try_number: 3 } } }),
    ).toBe(3);
  });

  test("anything else says nothing", () => {
    expect(readAttemptNumber(null)).toBeNull();
    expect(readAttemptNumber({ airflow: {} })).toBeNull();
    expect(
      readAttemptNumber({ airflow: { taskInstance: { try_number: "x" } } }),
    ).toBeNull();
  });

  test("it comes through with the event", () => {
    expect(
      readOpenLineageEvent(
        {
          eventType: "FAIL",
          eventTime: "2026-11-04T11:00:00Z",
          job: { namespace: "airflow", name: "dag.task" },
          run: {
            runId: "7f9c24e8-3b12-4fef-91e2-111111111111",
            facets: { airflow: { taskInstance: { try_number: 2 } } },
          },
        },
        NOW,
      )?.attemptNumber,
    ).toBe(2);
  });
});
