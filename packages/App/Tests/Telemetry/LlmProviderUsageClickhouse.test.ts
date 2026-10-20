import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { LlmUsageRecord } from "Common/Types/LlmObservability/LlmConnectionRecords";
import {
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * A provider account's daily figures and a company AI tool's imported
 * chats against a real ClickHouse.
 *
 * The unit tests pin the SQL the writer and the importer write. What they
 * cannot show is that ClickHouse accepts it: that the stored sums group by
 * the day and the series attributes read out of the Metric table's map, so
 * writing the same figures again writes nothing and a correction writes
 * its difference; that a budget's provider spend adds up the day's cost
 * points; and that the importer's look-up finds the chat turns a service
 * already has, and no other project's or service's.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LlmProviderUsageClickhouse.test.ts
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

import LlmProviderUsageWriter, {
  LlmProviderUsageWriteResult,
  LlmProviderUsageWriteTarget,
} from "Common/Server/Utils/LlmObservability/LlmProviderUsageWriter";
import LlmProviderSpend from "Common/Server/Utils/LlmObservability/LlmProviderSpend";
import LlmConnectionPullRunner from "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `llm_provider_usage_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("8800000000000000000000c1");
const OTHER_PROJECT: ObjectID = new ObjectID("8800000000000000000000c2");
const SERVICE: ObjectID = new ObjectID("8800000000000000000000d1");
const OTHER_SERVICE: ObjectID = new ObjectID("8800000000000000000000d2");
const CONNECTION: ObjectID = new ObjectID("8800000000000000000000e1");
const OTHER_CONNECTION: ObjectID = new ObjectID("8800000000000000000000e2");

const todayUtc: Date = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ),
);
const DAY_MS: number = 24 * 60 * 60 * 1000;
const YESTERDAY: Date = new Date(todayUtc.getTime() - DAY_MS);
const WINDOW: { startDay: Date; endDay: Date } = {
  startDay: new Date(todayUtc.getTime() - 2 * DAY_MS),
  endDay: new Date(todayUtc.getTime() + DAY_MS),
};

function target(
  overrides: Partial<LlmProviderUsageWriteTarget> = {},
): LlmProviderUsageWriteTarget {
  return {
    projectId: PROJECT,
    connectionId: CONNECTION,
    connectionName: "OpenAI production",
    genAiProviderName: "openai",
    serviceId: SERVICE,
    serviceName: "OpenAI production",
    retentionInDays: 30,
    costIsEstimated: false,
    projectPriceOverrides: [],
    ...overrides,
  };
}

function record(overrides: Partial<LlmUsageRecord> = {}): LlmUsageRecord {
  return {
    day: YESTERDAY,
    model: "gpt-4o",
    person: "ana@example.com",
    project: "Web",
    apiKey: "web-prod",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
    requests: 12,
    costUsd: 0.5,
    ...overrides,
  };
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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function connectionOf(service: ServiceConnection): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

integration("AI provider usage and chat imports against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let originalMetric: ServiceConnection | undefined;
  let originalSpan: ServiceConnection | undefined;

  // The stored sum of one metric for one day and connection, as a chart adds it up.
  async function sumOf(data: {
    metricName: string;
    day: Date;
    connectionId?: ObjectID;
    tokenType?: string;
  }): Promise<number> {
    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT sum(value) AS total FROM ${database}.${new Metric().tableName} WHERE name = {name:String} AND time = {day:DateTime} AND attributes['oneuptime.llm.connection.id'] = {connection:String} AND ({tokenType:String} = '' OR attributes['gen_ai.token.type'] = {tokenType:String})`,
        query_params: {
          name: data.metricName,
          day: OneUptimeDate.toClickhouseDateTime(data.day),
          connection: (data.connectionId || CONNECTION).toString(),
          tokenType: data.tokenType || "",
        },
        format: "JSON",
      })) as never;

    const rows: Array<JSONObject> = (await result.json()).data;
    return Number(rows[0]?.["total"] || 0);
  }

  async function write(
    records: Array<LlmUsageRecord>,
    overrides: Partial<LlmProviderUsageWriteTarget> = {},
  ): Promise<LlmProviderUsageWriteResult> {
    return await LlmProviderUsageWriter.write({
      target: target(overrides),
      window: WINDOW,
      records,
      now: new Date(),
    });
  }

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

    await createTable(
      client,
      clickhouse,
      Metric as unknown as { new (): AnalyticsBaseModel },
    );
    await createTable(
      client,
      clickhouse,
      Span as unknown as { new (): AnalyticsBaseModel },
    );

    originalMetric = connectionOf(
      MetricService as unknown as ServiceConnection,
    );
    originalSpan = connectionOf(SpanService as unknown as ServiceConnection);

    for (const service of [
      MetricService,
      SpanService,
    ] as unknown as Array<ServiceConnection>) {
      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    }

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined);
  });

  afterAll(async (): Promise<void> => {
    if (originalMetric) {
      Object.assign(MetricService, originalMetric);
    }

    if (originalSpan) {
      Object.assign(SpanService, originalSpan);
    }

    jest.restoreAllMocks();

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the first read stores the provider's figures, by day and series", async () => {
    const result: LlmProviderUsageWriteResult = await write([
      record(),
      record({
        day: todayUtc,
        person: "bob@example.com",
        costUsd: 0.25,
        cacheReadTokens: 0,
      }),
    ]);

    expect(result.pointsWritten).toBe(result.seriesCount);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        day: YESTERDAY,
      }),
    ).toBeCloseTo(0.5, 9);
    expect(
      await sumOf({ metricName: LLM_PROVIDER_COST_METRIC_NAME, day: todayUtc }),
    ).toBeCloseTo(0.25, 9);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
        day: YESTERDAY,
        tokenType: "cache_read",
      }),
    ).toBe(100);
  });

  test("reading the same figures again writes nothing", async () => {
    const result: LlmProviderUsageWriteResult = await write([
      record(),
      record({
        day: todayUtc,
        person: "bob@example.com",
        costUsd: 0.25,
        cacheReadTokens: 0,
      }),
    ]);

    expect(result.pointsWritten).toBe(0);
  });

  test("a day the provider corrects is stored as the corrected figure", async () => {
    await write([
      record({ outputTokens: 260, requests: 15, costUsd: 0.75 }),
      record({
        day: todayUtc,
        person: "bob@example.com",
        costUsd: 0.25,
        cacheReadTokens: 0,
      }),
    ]);

    expect(
      await sumOf({
        metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
        day: YESTERDAY,
        tokenType: "output",
      }),
    ).toBe(260);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        day: YESTERDAY,
      }),
    ).toBe(15);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        day: YESTERDAY,
      }),
    ).toBeCloseTo(0.75, 9);
  });

  test("a write that landed twice is taken back by the next read", async () => {
    // The day's points written a second time, as a retried insert would.
    await MetricService.insertJsonRows(
      LlmProviderUsageWriter.buildRows({
        target: target(),
        deltas: LlmProviderUsageWriter.toSeriesPoints({
          records: [
            record({
              day: todayUtc,
              person: "bob@example.com",
              costUsd: 0.25,
              cacheReadTokens: 0,
            }),
          ],
          costIsEstimated: false,
          projectPriceOverrides: [],
        }),
        now: new Date(),
      }),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
    expect(
      await sumOf({ metricName: LLM_PROVIDER_COST_METRIC_NAME, day: todayUtc }),
    ).toBeCloseTo(0.5, 9);

    await write([
      record({ outputTokens: 260, requests: 15, costUsd: 0.75 }),
      record({
        day: todayUtc,
        person: "bob@example.com",
        costUsd: 0.25,
        cacheReadTokens: 0,
      }),
    ]);

    expect(
      await sumOf({ metricName: LLM_PROVIDER_COST_METRIC_NAME, day: todayUtc }),
    ).toBeCloseTo(0.25, 9);
  });

  test("another connection of the service keeps its own figures", async () => {
    await write([record({ costUsd: 9 })], {
      connectionId: OTHER_CONNECTION,
      connectionName: "OpenAI staging",
    });

    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        day: YESTERDAY,
        connectionId: OTHER_CONNECTION,
      }),
    ).toBeCloseTo(9, 9);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        day: YESTERDAY,
      }),
    ).toBeCloseTo(0.75, 9);

    // And ours reads as it was: nothing to write.
    const result: LlmProviderUsageWriteResult = await write([
      record({ outputTokens: 260, requests: 15, costUsd: 0.75 }),
      record({
        day: todayUtc,
        person: "bob@example.com",
        costUsd: 0.25,
        cacheReadTokens: 0,
      }),
    ]);
    expect(result.pointsWritten).toBe(0);
  });

  test("a budget on the provider accounts reads the day's bill, by provider and model", async () => {
    const yesterdaysBill: number = await LlmProviderSpend.getCostInUSD({
      projectId: PROJECT,
      startTime: YESTERDAY,
      endTime: new Date(YESTERDAY.getTime() + DAY_MS - 1000),
    });
    // Both connections' bills: 0.75 + 9.
    expect(yesterdaysBill).toBeCloseTo(9.75, 6);

    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: todayUtc,
        endTime: new Date(),
        provider: "openai",
        model: "gpt-4o",
      }),
    ).toBeCloseTo(0.25, 6);
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: todayUtc,
        endTime: new Date(),
        provider: "anthropic",
      }),
    ).toBe(0);
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: OTHER_PROJECT,
        startTime: YESTERDAY,
        endTime: new Date(),
      }),
    ).toBe(0);
  });

  test("the importer finds the turns a service already has, and no one else's", async () => {
    const at: Date = new Date(Date.now() - 60 * 60 * 1000);
    const row: (
      spanId: string,
      projectId: ObjectID,
      serviceId: ObjectID,
    ) => JSONObject = (
      spanId: string,
      projectId: ObjectID,
      serviceId: ObjectID,
    ): JSONObject => {
      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
        projectId: projectId.toString(),
        primaryEntityId: serviceId.toString(),
        primaryEntityType: "Service",
        startTime: OneUptimeDate.toClickhouseDateTime(at),
        endTime: OneUptimeDate.toClickhouseDateTime(at),
        startTimeUnixNano: String(at.getTime() * 1000000),
        endTimeUnixNano: String(at.getTime() * 1000000),
        durationUnixNano: "0",
        traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
        spanId,
        parentSpanId: "",
        name: "chat claude-opus-5-5",
        kind: "SPAN_KIND_CLIENT",
        statusCode: 0,
        statusMessage: "",
        attributes: {},
        attributeKeys: [],
        events: "[]",
        isLlmSpan: true,
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(new Date(), 30),
        ).substring(0, 10),
      };
    };

    await SpanService.insertJsonRows(
      [
        row("1111111111111111", PROJECT, SERVICE),
        row("2222222222222222", PROJECT, OTHER_SERVICE),
        row("3333333333333333", OTHER_PROJECT, SERVICE),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const found: Set<string> =
      await LlmConnectionPullRunner.findExistingSpanIds({
        projectId: PROJECT,
        serviceId: SERVICE,
        spanIds: [
          "1111111111111111",
          "2222222222222222",
          "3333333333333333",
          "4444444444444444",
        ],
        from: new Date(at.getTime() - DAY_MS),
        to: new Date(at.getTime() + DAY_MS),
      });

    expect(Array.from(found)).toEqual(["1111111111111111"]);

    // Outside the window looked at, it is not found.
    expect(
      (
        await LlmConnectionPullRunner.findExistingSpanIds({
          projectId: PROJECT,
          serviceId: SERVICE,
          spanIds: ["1111111111111111"],
          from: new Date(at.getTime() + 60 * 60 * 1000),
          to: new Date(at.getTime() + DAY_MS),
        })
      ).size,
    ).toBe(0);
  });
});

describe("AI provider usage ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
