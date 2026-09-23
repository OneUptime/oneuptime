import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import PositiveNumber from "Common/Types/PositiveNumber";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ExceptionQueryScope,
  buildExceptionQueryScope,
} from "../../../../FeatureSet/Dashboard/src/Utils/ExceptionQueryScope";
import { buildExceptionInstanceScopeQuery } from "../../../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

/*
 * ------------------------------------------------------------------
 * Environment-scoped Exceptions monitors against a real ClickHouse server.
 *
 * The unit tests pin that the monitor puts `environment IN (...)` on its
 * query. What they cannot show is what that query COUNTS: whether an empty
 * or differently-cased environment slips through, whether the filter
 * composes with the service, entity, type, message, window and
 * resolved/archived filters, and whether the monitor agrees with the
 * Exceptions explorer's own `env:` filter and with the "view exceptions"
 * list an incident links to. So this suite runs monitorException, the exact
 * function the telemetry monitor worker calls, over rows in a table built
 * from the real ExceptionInstance model.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorExceptionEnvironmentClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively loads the native `isolated-vm` addon through the
 * criteria evaluator. Nothing here evaluates JavaScript expressions.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * Resolved/archived state lives on the Postgres exception group. The
 * ClickHouse side is what this suite is about, so the group lookup is
 * stubbed and each test says which fingerprints it has resolved.
 */
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { getResolvedOrArchivedFingerprints: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import ExceptionAggregationService, {
  FacetValue,
  HistogramBucket,
} from "Common/Server/Services/ExceptionAggregationService";
import { monitorException } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `exception_env_monitor_test_${process.pid}_${Date.now()}`;

const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;

const projectId: ObjectID = new ObjectID("7700000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("7700000000000000000000a2");

/*
 * One telemetry service used by both production and staging: the setup the
 * issue describes, where scoping by service alone counts both environments.
 */
const checkoutServiceId: ObjectID = new ObjectID("7700000000000000000000b1");
// A second service in the same project, also in production.
const billingServiceId: ObjectID = new ObjectID("7700000000000000000000b2");
// A service whose occurrences carry every awkward environment value.
const edgeServiceId: ObjectID = new ObjectID("7700000000000000000000b3");

const now: number = Date.now();

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface OccurrenceFixture {
  projectId?: ObjectID;
  serviceId: ObjectID;
  /*
   * undefined leaves the column out of the insert entirely, the way a log
   * ingest that found no deployment.environment writes it.
   */
  environment: string | undefined;
  fingerprint: string;
  exceptionType?: string;
  message?: string;
  entityKeys?: Array<string>;
  minutesAgo?: number;
}

const occurrences: Array<OccurrenceFixture> = [
  // The acceptance example: two production and three staging exceptions.
  {
    serviceId: checkoutServiceId,
    environment: "production",
    fingerprint: "checkout-timeout",
    exceptionType: "TimeoutError",
    message: "upstream timed out",
    entityKeys: ["host:checkout-1"],
  },
  {
    serviceId: checkoutServiceId,
    environment: "production",
    fingerprint: "checkout-type-error",
    exceptionType: "TypeError",
    message: "cart is undefined",
    entityKeys: ["host:checkout-2"],
  },
  {
    serviceId: checkoutServiceId,
    environment: "staging",
    fingerprint: "checkout-timeout",
    exceptionType: "TimeoutError",
    message: "upstream timed out",
    entityKeys: ["host:checkout-staging"],
  },
  {
    serviceId: checkoutServiceId,
    environment: "staging",
    fingerprint: "checkout-type-error",
    exceptionType: "TypeError",
    message: "cart is undefined",
    entityKeys: ["host:checkout-staging"],
  },
  {
    serviceId: checkoutServiceId,
    environment: "staging",
    fingerprint: "checkout-type-error",
    exceptionType: "TypeError",
    message: "cart is undefined",
    entityKeys: ["host:checkout-staging"],
  },

  // Same project and environment, another service.
  {
    serviceId: billingServiceId,
    environment: "production",
    fingerprint: "billing-declined",
  },
  {
    serviceId: billingServiceId,
    environment: "production",
    fingerprint: "billing-declined",
  },
  {
    serviceId: billingServiceId,
    environment: "production",
    fingerprint: "billing-declined",
  },
  {
    serviceId: billingServiceId,
    environment: "production",
    fingerprint: "billing-declined",
  },

  // Production, but long before any monitor window.
  {
    serviceId: checkoutServiceId,
    environment: "production",
    fingerprint: "checkout-timeout",
    minutesAgo: 180,
  },

  // Same service id and environment, another project.
  {
    projectId: otherProjectId,
    serviceId: checkoutServiceId,
    environment: "production",
    fingerprint: "checkout-timeout",
  },

  // Only the first of these is production.
  { serviceId: edgeServiceId, environment: "production", fingerprint: "edge" },
  { serviceId: edgeServiceId, environment: "", fingerprint: "edge" },
  { serviceId: edgeServiceId, environment: undefined, fingerprint: "edge" },
  { serviceId: edgeServiceId, environment: "Production", fingerprint: "edge" },
  { serviceId: edgeServiceId, environment: "prod", fingerprint: "edge" },
  { serviceId: edgeServiceId, environment: " production", fingerprint: "edge" },
];

function occurrenceRow(fixture: OccurrenceFixture, index: number): JSONObject {
  const time: Date = new Date(
    now - (fixture.minutesAgo ?? 1) * 60 * 1000 - index * 1000,
  );

  const row: JSONObject = {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    exceptionType: fixture.exceptionType || "Error",
    stackTrace: "",
    message: fixture.message || "something failed",
    spanStatusCode: 2,
    escaped: false,
    traceId: "",
    spanId: "",
    fingerprint: fixture.fingerprint,
    spanName: "",
    release: "",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: fixture.entityKeys || [],
    retentionDate: retentionDate,
  };

  if (fixture.environment !== undefined) {
    row["environment"] = fixture.environment;
  }

  return row;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new ExceptionInstance();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: ExceptionInstance as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

async function evaluate(
  config: Partial<MonitorStepExceptionMonitor>,
): Promise<ExceptionMonitorResponse> {
  const step: MonitorStep = new MonitorStep();
  step.setExceptionMonitor({
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    lastXSecondsOfExceptions: 600,
    ...config,
  });

  return monitorException({
    monitorStep: step,
    monitorId: ObjectID.generate(),
    projectId: projectId,
  });
}

async function countFor(
  config: Partial<MonitorStepExceptionMonitor>,
): Promise<number> {
  return (await evaluate(config)).exceptionCount;
}

integration("Exceptions monitor environment filter against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse);

    original = {
      database: ExceptionInstanceService.database,
      databaseClient: ExceptionInstanceService.databaseClient,
      ingestDatabase: ExceptionInstanceService.ingestDatabase,
      ingestDatabaseClient: ExceptionInstanceService.ingestDatabaseClient,
    };

    ExceptionInstanceService.database = clickhouse;
    ExceptionInstanceService.databaseClient = client;
    ExceptionInstanceService.ingestDatabase = clickhouse;
    ExceptionInstanceService.ingestDatabaseClient = client;

    await ExceptionInstanceService.insertJsonRows(
      occurrences.map(occurrenceRow),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(ExceptionInstanceService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach(() => {
    resolvedFingerprints.mockReset().mockResolvedValue([]);
  });

  test("the fixture loaded every occurrence", async () => {
    const total: PositiveNumber = await ExceptionInstanceService.countBy({
      query: {},
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });

    expect(total.toNumber()).toBe(occurrences.length);
  });

  test("the issue's acceptance example: production 2, staging 3, unfiltered 5", async () => {
    const service: Partial<MonitorStepExceptionMonitor> = {
      telemetryServiceIds: [checkoutServiceId],
    };

    expect(await countFor({ ...service, environments: ["production"] })).toBe(
      2,
    );
    expect(await countFor({ ...service, environments: ["staging"] })).toBe(3);
    expect(await countFor({ ...service, environments: [] })).toBe(5);
    expect(await countFor({ ...service })).toBe(5);
  });

  test("a list of environments counts any of them", async () => {
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["production", "staging"],
      }),
    ).toBe(5);

    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["production", "qa"],
      }),
    ).toBe(2);
  });

  test("an empty, missing or different environment never matches a production filter", async () => {
    const edge: Partial<MonitorStepExceptionMonitor> = {
      telemetryServiceIds: [edgeServiceId],
    };

    // Unfiltered, every one of them counts — nothing new is excluded.
    expect(await countFor(edge)).toBe(6);

    /*
     * Only the exact value: not "", not a row with no environment, not
     * "Production", "prod" or " production".
     */
    expect(await countFor({ ...edge, environments: ["production"] })).toBe(1);

    // Exact and case-sensitive the other way too.
    expect(await countFor({ ...edge, environments: ["Production"] })).toBe(1);
    expect(await countFor({ ...edge, environments: ["prod"] })).toBe(1);
  });

  test("an environment nobody sends counts nothing rather than everything", async () => {
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["qa"],
      }),
    ).toBe(0);
  });

  test("without a service filter the environment still stays inside the project and window", async () => {
    /*
     * Checkout 2 + billing 4 + edge 1. Not the 3-hour-old production
     * occurrence, and not the other project's.
     */
    expect(await countFor({ environments: ["production"] })).toBe(7);
  });

  test("combines with exception type, message and entity filters", async () => {
    const production: Partial<MonitorStepExceptionMonitor> = {
      telemetryServiceIds: [checkoutServiceId],
      environments: ["production"],
    };

    expect(
      await countFor({ ...production, exceptionTypes: ["TypeError"] }),
    ).toBe(1);
    expect(
      await countFor({
        environments: ["staging"],
        exceptionTypes: ["TypeError"],
      }),
    ).toBe(2);
    expect(await countFor({ ...production, message: "timed out" })).toBe(1);
    expect(
      await countFor({ ...production, entityKeys: ["host:checkout-2"] }),
    ).toBe(1);
    expect(
      await countFor({
        environments: ["production"],
        entityKeys: ["host:checkout-staging"],
      }),
    ).toBe(0);
  });

  test("combines with the time window", async () => {
    // Widen past the 3-hour-old production occurrence: now it counts.
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["production"],
        lastXSecondsOfExceptions: 43200,
      }),
    ).toBe(3);
  });

  test("combines with the resolved/archived exclusion", async () => {
    /*
     * The group spans environments: resolving checkout-type-error removes its
     * production occurrence and both of its staging ones.
     */
    resolvedFingerprints.mockResolvedValue(["checkout-type-error"]);

    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["production"],
      }),
    ).toBe(1);
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["staging"],
      }),
    ).toBe(1);

    // Opting back in to resolved exceptions restores the full count.
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: ["production"],
        includeResolved: true,
        includeArchived: true,
      }),
    ).toBe(2);
  });

  test("a monitor saved and reloaded keeps counting the same environment", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setExceptionMonitor({
      ...MonitorStepExceptionMonitorUtil.getDefault(),
      telemetryServiceIds: [checkoutServiceId],
      environments: ["staging"],
      lastXSecondsOfExceptions: 600,
    });

    // What the monitor row stores, and what the worker reads back.
    const stored: string = JSON.stringify(step.toJSON());
    const reloaded: MonitorStep = MonitorStep.fromJSON(
      JSONFunctions.deserialize(JSON.parse(stored) as JSONObject) as JSONObject,
    );

    const response: ExceptionMonitorResponse = await monitorException({
      monitorStep: reloaded,
      monitorId: ObjectID.generate(),
      projectId: projectId,
    });

    expect(response.exceptionCount).toBe(3);
  });

  test("an API caller's single environment string is honored", async () => {
    expect(
      await countFor({
        telemetryServiceIds: [checkoutServiceId],
        environments: "production" as unknown as Array<string>,
      }),
    ).toBe(2);
  });

  test("agrees with the Exceptions explorer's env: filter", async () => {
    /*
     * The explorer's chart and facets for `service:checkout env:production`
     * run through ExceptionAggregationService with `environments`.
     */
    const startTime: Date = new Date(now - 10 * 60 * 1000);
    const endTime: Date = new Date(now + 60 * 1000);

    for (const environment of ["production", "staging"]) {
      const buckets: Array<HistogramBucket> =
        await ExceptionAggregationService.getHistogram({
          projectId: projectId,
          startTime: startTime,
          endTime: endTime,
          bucketSizeInMinutes: 60,
          serviceIds: [checkoutServiceId],
          environments: [environment],
        });

      const explorerCount: number = buckets.reduce(
        (sum: number, bucket: HistogramBucket): number => {
          return sum + bucket.count;
        },
        0,
      );

      expect(explorerCount).toBe(
        await countFor({
          telemetryServiceIds: [checkoutServiceId],
          environments: [environment],
        }),
      );
    }

    // And the environment facet the explorer offers lists the same counts.
    const facet: Array<FacetValue> =
      await ExceptionAggregationService.getFacetValues({
        projectId: projectId,
        startTime: startTime,
        endTime: endTime,
        facetKey: "environment",
        serviceIds: [checkoutServiceId],
      });

    expect(
      facet
        .map((value: FacetValue): string => {
          return `${value.value}=${value.count}`;
        })
        .sort(),
    ).toEqual(["production=2", "staging=3"]);
  });

  test("the stored view-exceptions query lists the same occurrences the monitor counted", async () => {
    const response: ExceptionMonitorResponse = await evaluate({
      telemetryServiceIds: [checkoutServiceId],
      environments: ["production"],
    });

    expect(response.exceptionCount).toBe(2);

    /*
     * What an incident or alert keeps and hands to the embedded explorer,
     * as the page receives it: JSON, read back by the explorer's own reader
     * and turned into the instance query that resolves which exception
     * groups to list.
     */
    const stored: JSONObject = JSON.parse(
      JSON.stringify(response.exceptionQuery),
    ) as JSONObject;

    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      JSONFunctions.deserialize(stored) as unknown as Query<ExceptionInstance>,
    );

    expect(scope.hasScope).toBe(true);
    expect(scope.window).not.toBeNull();
    expect(
      scope.chips.map((chip: { displayKey: string; value: string }) => {
        return `${chip.displayKey}: ${chip.value}`;
      }),
    ).toContain("Environment: production");

    const instanceQuery: Query<ExceptionInstance> =
      buildExceptionInstanceScopeQuery({
        projectId: projectId,
        window: scope.window as InBetween<Date>,
        scope: scope.instanceScope,
      });

    const listed: Array<ExceptionInstance> =
      await ExceptionInstanceService.findBy({
        query: instanceQuery,
        select: { fingerprint: true, environment: true },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      });

    expect(listed).toHaveLength(2);
    expect(
      listed.map((instance: ExceptionInstance): string => {
        return `${instance.fingerprint}@${instance.environment}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "checkout-timeout@production",
        "checkout-type-error@production",
      ]),
    );
  });
});

describe("Exceptions monitor environment ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
