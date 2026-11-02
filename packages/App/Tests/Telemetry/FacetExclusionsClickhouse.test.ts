import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * "Is not" in the telemetry explorers, against a real ClickHouse server: the
 * values a reader leaves out of the Logs, Traces and Exceptions explorers
 * (a facet row's minus) are proven on the engine, not only on the SQL
 * string - in the aggregate reads behind each chart and facet count
 * (Log/Trace/ExceptionAggregationService) and in the list's own read
 * (StatementGenerator), so the two cannot disagree:
 *
 *   - a severity, a service, a span status, kind or name, an exception type
 *     or environment left out is a NOT IN on its column;
 *   - a resource left out (a host) negates its whole membership group, so a
 *     row that belongs to it as its primary entity, by its entity key or by
 *     its resource attribute is left out - and a row that names no host at
 *     all is kept.
 *
 * Every read is checked on the default analyzer and on the older one
 * (enable_analyzer = 0), as servers still configured that way read them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/FacetExclusionsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import AnalyticsDatabaseService, {
  ClickHouseSettings,
} from "Common/Server/Services/AnalyticsDatabaseService";
import LogAggregationService, {
  FacetValue,
  HistogramBucket,
} from "Common/Server/Services/LogAggregationService";
import TraceAggregationService, {
  HistogramBucket as TraceHistogramBucket,
} from "Common/Server/Services/TraceAggregationService";
import ExceptionAggregationService, {
  FacetValue as ExceptionFacetValue,
  HistogramBucket as ExceptionHistogramBucket,
} from "Common/Server/Services/ExceptionAggregationService";
import { ResourceEntityScope } from "Common/Server/Utils/Telemetry/ResourceEntityFilter";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `facet_exclusions_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
// The reads' clock: every row sits in the hour before it.
const NOW: Date = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
const WINDOW_START: Date = new Date(NOW.getTime() - 60 * MINUTE);

const PROJECT_ID: ObjectID = new ObjectID(
  "5a670000-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5a670000-0000-4000-8000-000000000002";
const BILLING: string = "5a670000-0000-4000-8000-000000000003";
// A host whose agent logs are primary-keyed on it.
const WEB_01: string = "5a670000-0000-4000-8000-000000000004";

const WEB_01_KEY: string = "host-key-web-01";
const WEB_02_KEY: string = "host-key-web-02";
const HOST_ATTRIBUTE: string = "resource.host.name";

// Logs, by how each one names (or does not name) host web-01.
const ERRORS_ON_WEB_01_BY_KEY: number = 10;
const INFO_ON_WEB_01_BY_ATTRIBUTE: number = 6;
const AGENT_INFO_ON_WEB_01: number = 4;
const BILLING_DEBUG_ON_WEB_02: number = 20;
const WARNINGS_WITHOUT_HOST: number = 5;

// Spans.
const ORDERS_OK: number = 8;
const HEALTH_OK: number = 12;
const ORDERS_CLIENT_ERRORS: number = 3;
const BILLING_UNSET: number = 5;

// Exception occurrences.
const TYPE_ERRORS: number = 4;
const TIMEOUT_ERRORS: number = 3;
const VALUE_ERRORS_STAGING: number = 2;

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function timeOf(index: number): Date {
  return new Date(WINDOW_START.getTime() + MINUTE + (index % 40) * MINUTE);
}

function hex(seed: number, length: number): string {
  return seed.toString(16).padStart(length, "0").slice(-length);
}

function logRow(data: {
  index: number;
  primaryEntityId: string;
  primaryEntityType: string;
  severity: LogSeverity;
  entityKeys?: Array<string> | undefined;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = data.attributes || {};
  const time: Date = timeOf(data.index);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: data.primaryEntityId,
    primaryEntityType: data.primaryEntityType,
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    severityText: data.severity,
    severityNumber: 9,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: data.entityKeys || [],
    traceId: "",
    spanId: "",
    body: `line ${data.index}`,
    retentionDate,
  };
}

function fixtureLogs(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  let index: number = 0;

  const add: (count: number, make: (index: number) => JSONObject) => void = (
    count: number,
    make: (index: number) => JSONObject,
  ): void => {
    for (let each: number = 0; each < count; each++) {
      rows.push(make(index++));
    }
  };

  // On web-01 by its entity key only (OTLP logs keyed on their service).
  add(ERRORS_ON_WEB_01_BY_KEY, (at: number): JSONObject => {
    return logRow({
      index: at,
      primaryEntityId: CHECKOUT,
      primaryEntityType: "Service",
      severity: LogSeverity.Error,
      entityKeys: [WEB_01_KEY],
    });
  });

  // On web-01 by its resource attribute only (rows from before entityKeys).
  add(INFO_ON_WEB_01_BY_ATTRIBUTE, (at: number): JSONObject => {
    return logRow({
      index: at,
      primaryEntityId: CHECKOUT,
      primaryEntityType: "Service",
      severity: LogSeverity.Information,
      attributes: { [HOST_ATTRIBUTE]: "web-01" },
    });
  });

  // web-01's own agent logs: primary-keyed on the host.
  add(AGENT_INFO_ON_WEB_01, (at: number): JSONObject => {
    return logRow({
      index: at,
      primaryEntityId: WEB_01,
      primaryEntityType: "Host",
      severity: LogSeverity.Information,
    });
  });

  add(BILLING_DEBUG_ON_WEB_02, (at: number): JSONObject => {
    return logRow({
      index: at,
      primaryEntityId: BILLING,
      primaryEntityType: "Service",
      severity: LogSeverity.Debug,
      entityKeys: [WEB_02_KEY],
      attributes: { [HOST_ATTRIBUTE]: "web-02" },
    });
  });

  // No host at all: never on web-01, so never left out with it.
  add(WARNINGS_WITHOUT_HOST, (at: number): JSONObject => {
    return logRow({
      index: at,
      primaryEntityId: CHECKOUT,
      primaryEntityType: "Service",
      severity: LogSeverity.Warning,
    });
  });

  return rows;
}

function spanRow(data: {
  index: number;
  serviceId: string;
  name: string;
  kind: string;
  statusCode: SpanStatus;
}): JSONObject {
  const start: Date = timeOf(data.index);
  const startNs: string = String(BigInt(start.getTime()) * BigInt(1000000));
  const durationNs: number = 5 * 1000000;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: data.serviceId,
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(start),
    endTime: OneUptimeDate.toClickhouseDateTime64(start),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
    durationUnixNano: String(durationNs),
    traceId: `${hex(9, 8)}${hex(data.index, 24)}`,
    spanId: hex(data.index + 1, 16),
    parentSpanId: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    statusCode: data.statusCode,
    name: data.name,
    kind: data.kind,
    isRootSpan: true,
    retentionDate,
  };
}

function fixtureSpans(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  let index: number = 0;

  const add: (
    count: number,
    data: Omit<Parameters<typeof spanRow>[0], "index">,
  ) => void = (
    count: number,
    data: Omit<Parameters<typeof spanRow>[0], "index">,
  ): void => {
    for (let each: number = 0; each < count; each++) {
      rows.push(spanRow({ ...data, index: index++ }));
    }
  };

  add(ORDERS_OK, {
    serviceId: CHECKOUT,
    name: "GET /orders",
    kind: "SPAN_KIND_SERVER",
    statusCode: SpanStatus.Ok,
  });
  add(HEALTH_OK, {
    serviceId: CHECKOUT,
    name: "GET /health",
    kind: "SPAN_KIND_SERVER",
    statusCode: SpanStatus.Ok,
  });
  add(ORDERS_CLIENT_ERRORS, {
    serviceId: CHECKOUT,
    name: "GET /orders",
    kind: "SPAN_KIND_CLIENT",
    statusCode: SpanStatus.Error,
  });
  add(BILLING_UNSET, {
    serviceId: BILLING,
    name: "POST /invoices",
    kind: "SPAN_KIND_SERVER",
    statusCode: SpanStatus.Unset,
  });

  return rows;
}

function exceptionRow(data: {
  index: number;
  exceptionType: string;
  environment: string;
}): JSONObject {
  const time: Date = timeOf(data.index);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: CHECKOUT,
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    exceptionType: data.exceptionType,
    message: `${data.exceptionType} ${data.index}`,
    stackTrace: "",
    escaped: false,
    traceId: "",
    spanId: "",
    fingerprint: hex(data.exceptionType.length, 16),
    environment: data.environment,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    retentionDate,
  };
}

function fixtureExceptions(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  let index: number = 0;

  for (const [exceptionType, environment, count] of [
    ["TypeError", "production", TYPE_ERRORS],
    ["TimeoutError", "production", TIMEOUT_ERRORS],
    ["ValueError", "staging", VALUE_ERRORS_STAGING],
  ] as Array<[string, string, number]>) {
    for (let each: number = 0; each < count; each++) {
      rows.push(exceptionRow({ index: index++, exceptionType, environment }));
    }
  }

  return rows;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
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

interface Connection {
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

const services: Array<AnalyticsDatabaseService<AnalyticsBaseModel>> = [
  LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  ExceptionInstanceService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
];

function useConnection(connection: Connection): void {
  for (const service of services) {
    service.database = connection.database;
    service.databaseClient = connection.client;
    service.ingestDatabase = connection.database;
    service.ingestDatabaseClient = connection.client;
  }
}

// What a facet answered, as value -> count.
function countsOf(
  values: Array<FacetValue | ExceptionFacetValue>,
): Record<string, number> {
  return Object.fromEntries(
    values.map((value: FacetValue | ExceptionFacetValue): [string, number] => {
      return [value.value, value.count];
    }),
  );
}

// A histogram's rows added up, by series (a trace's status, a log's severity).
function totalsBySeries(
  buckets: Array<
    TraceHistogramBucket | ExceptionHistogramBucket | HistogramBucket
  >,
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const bucket of buckets) {
    const series: string =
      "severity" in bucket ? bucket.severity : bucket.series;
    totals[series] = (totals[series] || 0) + bucket.count;
  }

  return totals;
}

function total(buckets: Array<{ count: number }>): number {
  return buckets.reduce((sum: number, bucket: { count: number }): number => {
    return sum + bucket.count;
  }, 0);
}

// Host web-01, as the server resolves a "Host is not web-01" chip.
function web01Scope(isExcluded: boolean): ResourceEntityScope {
  return {
    entityIds: [WEB_01],
    entityKeys: [WEB_01_KEY],
    attributeKey: HOST_ATTRIBUTE,
    attributeValues: ["web-01"],
    ...(isExcluded ? { isExcluded: true } : {}),
  };
}

integration("Facet exclusions, against ClickHouse", () => {
  let options: ClickHouseClientConfigOptions;
  let current: Connection;
  let older: Connection | null = null;
  let original: Array<Record<string, unknown>> = [];

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
      compression: { request: true, response: true },
    };

    // connect() creates the database.
    const clickhouse: ClickhouseDatabase = new ClickhouseDatabase(options);
    const client: ClickhouseClient = await clickhouse.connect(options);
    current = { database: clickhouse, client };

    await createTable(client, clickhouse, Log);
    await createTable(
      client,
      clickhouse,
      Span as unknown as { new (): AnalyticsBaseModel },
    );
    await createTable(client, clickhouse, ExceptionInstance);

    await client.insert({
      table: `${database}.${new Log().tableName}`,
      values: fixtureLogs(),
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${new Span().tableName}`,
      values: fixtureSpans(),
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${new ExceptionInstance().tableName}`,
      values: fixtureExceptions(),
      format: "JSONEachRow",
    });

    // The older analyzer, under whichever of its names this server knows.
    const found: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const [setting] = (await found.json()) as Array<{ name: string }>;

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );

      older = {
        database: olderDatabase,
        client: await olderDatabase.connect(olderOptions),
      };
    }

    original = services.map(
      (service: AnalyticsDatabaseService<AnalyticsBaseModel>) => {
        return {
          database: service.database,
          databaseClient: service.databaseClient,
          ingestDatabase: service.ingestDatabase,
          ingestDatabaseClient: service.ingestDatabaseClient,
        };
      },
    );

    useConnection(current);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useConnection(current);
  });

  afterAll(async (): Promise<void> => {
    services.forEach(
      (
        service: AnalyticsDatabaseService<AnalyticsBaseModel>,
        index: number,
      ) => {
        if (original[index]) {
          Object.assign(service, original[index]);
        }
      },
    );

    if (current) {
      await current.client.command({
        query: `DROP DATABASE IF EXISTS ${database}`,
      });
      await current.database.disconnect();
    }

    if (older) {
      await older.database.disconnect();
    }
  });

  // Each check, on the default analyzer and on the older one.
  async function onBothAnalyzers(check: () => Promise<void>): Promise<void> {
    useConnection(current);
    await check();

    if (older) {
      useConnection(older);
      await check();
      useConnection(current);
    }
  }

  const window: { projectId: ObjectID; startTime: Date; endTime: Date } = {
    projectId: PROJECT_ID,
    startTime: WINDOW_START,
    endTime: NOW,
  };

  describe("logs", () => {
    test("the severity facet counts every severity but the ones left out", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const counts: Record<string, number> = countsOf(
          await LogAggregationService.getFacetValues({
            ...window,
            facetKey: "severityText",
            excludedSeverityTexts: [LogSeverity.Debug, LogSeverity.Warning],
          }),
        );

        expect(counts).toEqual({
          [LogSeverity.Error]: ERRORS_ON_WEB_01_BY_KEY,
          [LogSeverity.Information]:
            INFO_ON_WEB_01_BY_ATTRIBUTE + AGENT_INFO_ON_WEB_01,
        });
      });
    });

    test("the chart leaves the severity out, on the severity projection's shape", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const buckets: Array<HistogramBucket> =
          await LogAggregationService.getHistogram({
            ...window,
            bucketSizeInMinutes: 60,
            excludedSeverityTexts: [LogSeverity.Debug],
          });

        expect(totalsBySeries(buckets)[LogSeverity.Debug]).toBeUndefined();
        expect(total(buckets)).toBe(
          ERRORS_ON_WEB_01_BY_KEY +
            INFO_ON_WEB_01_BY_ATTRIBUTE +
            AGENT_INFO_ON_WEB_01 +
            WARNINGS_WITHOUT_HOST,
        );
      });
    });

    test("a service left out leaves out every log primary-keyed on it", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const counts: Record<string, number> = countsOf(
          await LogAggregationService.getFacetValues({
            ...window,
            facetKey: "severityText",
            excludedServiceIds: [new ObjectID(BILLING)],
          }),
        );

        expect(counts[LogSeverity.Debug]).toBeUndefined();
        expect(counts[LogSeverity.Error]).toBe(ERRORS_ON_WEB_01_BY_KEY);
      });
    });

    test("Host is not web-01: a log on it in ANY way is left out, one naming no host is kept", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const counts: Record<string, number> = countsOf(
          await LogAggregationService.getFacetValues({
            ...window,
            facetKey: "severityText",
            resourceScopes: [web01Scope(true)],
          }),
        );

        expect(counts).toEqual({
          [LogSeverity.Debug]: BILLING_DEBUG_ON_WEB_02,
          [LogSeverity.Warning]: WARNINGS_WITHOUT_HOST,
        });
      });
    });

    test("the same host kept is exactly the rows left out: the two split the logs", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const kept: number = total(
          await LogAggregationService.getHistogram({
            ...window,
            bucketSizeInMinutes: 60,
            resourceScopes: [web01Scope(false)],
          }),
        );
        const leftOut: number = total(
          await LogAggregationService.getHistogram({
            ...window,
            bucketSizeInMinutes: 60,
            resourceScopes: [web01Scope(true)],
          }),
        );

        expect(kept).toBe(
          ERRORS_ON_WEB_01_BY_KEY +
            INFO_ON_WEB_01_BY_ATTRIBUTE +
            AGENT_INFO_ON_WEB_01,
        );
        expect(kept + leftOut).toBe(fixtureLogs().length);
      });
    });

    test("the list's own read leaves out the same rows the chart does", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        const read: (
          query: Record<string, unknown>,
        ) => Promise<number> = async (
          query: Record<string, unknown>,
        ): Promise<number> => {
          const rows: Array<Log> = await LogService.findBy({
            query: { projectId: PROJECT_ID, ...query } as never,
            select: { _id: true } as never,
            limit: 1000,
            skip: 0,
            props: { isRoot: true, ignoreHooks: true },
          });

          return rows.length;
        };

        expect(
          await read({ severityText: new NotEqual(LogSeverity.Debug) }),
        ).toBe(
          ERRORS_ON_WEB_01_BY_KEY +
            INFO_ON_WEB_01_BY_ATTRIBUTE +
            AGENT_INFO_ON_WEB_01 +
            WARNINGS_WITHOUT_HOST,
        );
        expect(
          await read({
            severityText: new IncludesNone([
              LogSeverity.Debug,
              LogSeverity.Warning,
            ]),
          }),
        ).toBe(
          ERRORS_ON_WEB_01_BY_KEY +
            INFO_ON_WEB_01_BY_ATTRIBUTE +
            AGENT_INFO_ON_WEB_01,
        );
        expect(
          await read({ primaryEntityId: new IncludesNone([BILLING]) }),
        ).toBe(fixtureLogs().length - BILLING_DEBUG_ON_WEB_02);
        expect(await read({ resourceEntityScopes: [web01Scope(true)] })).toBe(
          BILLING_DEBUG_ON_WEB_02 + WARNINGS_WITHOUT_HOST,
        );
      });
    });
  });

  describe("traces", () => {
    async function spansBy(
      filters: Record<string, unknown>,
    ): Promise<Record<string, number>> {
      return totalsBySeries(
        await TraceAggregationService.getHistogram({
          ...window,
          bucketSizeInMinutes: 60,
          ...filters,
        }),
      );
    }

    test("a status left out: no error spans in the chart", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(
          await spansBy({ excludedStatusCodes: [SpanStatus.Error] }),
        ).toEqual({ ok: ORDERS_OK + HEALTH_OK, unset: BILLING_UNSET });
      });
    });

    test("a span kind left out: no client spans", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(
          await spansBy({ excludedSpanKinds: ["SPAN_KIND_CLIENT"] }),
        ).toEqual({ ok: ORDERS_OK + HEALTH_OK, unset: BILLING_UNSET });
      });
    });

    test("a span name left out exactly; beside a name searched as a substring, both apply", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(await spansBy({ excludedSpanNames: ["GET /health"] })).toEqual({
          ok: ORDERS_OK,
          error: ORDERS_CLIENT_ERRORS,
          unset: BILLING_UNSET,
        });

        expect(
          await spansBy({
            spanNameSearches: ["GET"],
            excludedSpanNames: ["GET /health"],
          }),
        ).toEqual({ ok: ORDERS_OK, error: ORDERS_CLIENT_ERRORS });
      });
    });

    test("a service left out", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(
          await spansBy({ excludedServiceIds: [new ObjectID(BILLING)] }),
        ).toEqual({
          ok: ORDERS_OK + HEALTH_OK,
          error: ORDERS_CLIENT_ERRORS,
        });
      });
    });
  });

  describe("exceptions", () => {
    test("a type and an environment left out, in the facet counts", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(
          countsOf(
            await ExceptionAggregationService.getFacetValues({
              ...window,
              facetKey: "exceptionType",
              excludedExceptionTypes: ["TypeError"],
            }),
          ),
        ).toEqual({
          TimeoutError: TIMEOUT_ERRORS,
          ValueError: VALUE_ERRORS_STAGING,
        });

        expect(
          countsOf(
            await ExceptionAggregationService.getFacetValues({
              ...window,
              facetKey: "exceptionType",
              excludedEnvironments: ["staging"],
            }),
          ),
        ).toEqual({ TypeError: TYPE_ERRORS, TimeoutError: TIMEOUT_ERRORS });
      });
    });

    test("and in the chart", async () => {
      await onBothAnalyzers(async (): Promise<void> => {
        expect(
          total(
            await ExceptionAggregationService.getHistogram({
              ...window,
              bucketSizeInMinutes: 60,
              excludedExceptionTypes: ["TypeError", "TimeoutError"],
            }),
          ),
        ).toBe(VALUE_ERRORS_STAGING);
      });
    });
  });
});

describe("Facet exclusions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
