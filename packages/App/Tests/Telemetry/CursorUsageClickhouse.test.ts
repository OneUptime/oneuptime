import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import LlmBudgetSpendSource from "Common/Types/LlmObservability/LlmBudgetSpendSource";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import {
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import { LlmConnectionPullState } from "Common/Types/LlmObservability/LlmConnectionRecords";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
} from "Common/Types/Telemetry/LlmMetricUsageApi";
import {
  LlmUsageDimension,
  LlmUsageResponse,
  LlmUsageSource,
} from "Common/Types/Telemetry/LlmUsageApi";
import AggregateBy from "Common/Server/Types/AnalyticsDatabase/AggregateBy";
import {
  LlmMetricSource,
  LlmSetupCheckMetricSource,
} from "Common/Types/Telemetry/LlmSetupCheckApi";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
  LlmUsageWindow,
} from "Common/Server/Utils/LlmObservability/LlmConnectorTypes";
import {
  FakeCursorClock,
  FakeCursorMember,
  createFakeCursorApi,
  cursorEvent,
  cursorMember,
  usageOf,
} from "Common/Tests/Server/Utils/LlmObservability/FakeCursorApi";
import {
  LlmProviderUsageSummary,
  buildProviderMetricQuery,
  foldProviderUsage,
  getProviderUsageDimension,
} from "../../FeatureSet/Dashboard/src/Components/AI/LlmProviderUsageQuery";
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
 * #5547: a Cursor team's usage, read with its Admin API key and kept in a
 * real ClickHouse - and Cursor's own OpenTelemetry Export beside it.
 *
 * The unit tests pin what the connector reads and the SQL the writer
 * writes. What they cannot show is that ClickHouse sums Cursor's points by
 * the hour: that a read through the connector (against a fake of Cursor's
 * Admin API) writes each hour once, that an hour Cursor adds to later is
 * written as its difference while the day's other hours stay, and that the
 * figures read back as Usage, the connection and a budget read them. Nor
 * that the two ways Cursor comes in are never added together: the Export's
 * cursor.* metrics are read by Your AI calls and a budget on the calls, the
 * Admin API's oneuptime.llm.provider.* points by Provider accounts and a
 * budget on the provider accounts - never one by the other.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/CursorUsageClickhouse.test.ts
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

import CursorConnector from "Common/Server/Utils/LlmObservability/Connectors/Cursor/CursorConnector";
import LlmProviderUsageWriter, {
  LlmProviderUsageTotals,
  LlmProviderUsageWriteResult,
  LlmProviderUsageWriteTarget,
} from "Common/Server/Utils/LlmObservability/LlmProviderUsageWriter";
import LlmProviderSpend from "Common/Server/Utils/LlmObservability/LlmProviderSpend";
import LlmCostBudgetEvaluator, {
  LlmResolvedSpend,
} from "Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import LlmMetricUsageReader from "Common/Server/Utils/Telemetry/LlmMetricUsageReader";
import LlmUsageReader from "Common/Server/Utils/Telemetry/LlmUsageReader";
import LlmSetupCheckReader from "Common/Server/Utils/Telemetry/LlmSetupCheckReader";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cursor_usage_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("8800000000000000000000f1");
// The Cursor connection's own service, and the Export's "cursor" service.
const SERVICE: ObjectID = new ObjectID("8800000000000000000000f2");
const OTEL_SERVICE: ObjectID = new ObjectID("8800000000000000000000f3");
const CONNECTION: ObjectID = new ObjectID("8800000000000000000000f4");

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/*
 * An hour that is over, a little in the past, so every read below is of
 * finished hours whatever the time the suite runs: the read's "now" is
 * half past it, and the hour in progress (END) is where a read ends.
 */
const END: number = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
const NOW: Date = new Date(END + 30 * MINUTE);
const H3: number = END - 3 * HOUR;
const H2: number = END - 2 * HOUR;
const YESTERDAY_HOUR: number = END - 26 * HOUR;

const API_KEY: string = `crsr_${"c0ffee00".repeat(8)}`;
const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.Cursor,
  config: {},
  secrets: { apiKey: API_KEY },
};

const ANA: string = "ana@sysnetix.com";
const BOB: string = "bob@sysnetix.com";
const CY: string = "cy@sysnetix.com";
const DEE: string = "dee@sysnetix.com";

const MEMBERS: Array<FakeCursorMember> = [
  cursorMember(ANA, { role: "owner" }),
  cursorMember(BOB),
  cursorMember(CY),
  // Left the team; what they used stays theirs.
  cursorMember(DEE, { isRemoved: true }),
];

/*
 * The team's usage events, as Cursor's Admin API answers them: Ana twice
 * at H3, Bob and Ana at H2 - Ana's request there included in the plan,
 * charged nothing - and Dee a day earlier. Each request is 160 input
 * tokens (cache included) and 20 output.
 */
const EVENTS: Array<JSONObject> = [
  cursorEvent({ at: H3 + 5 * MINUTE, email: ANA, totalCents: 4 }),
  cursorEvent({ at: H3 + 40 * MINUTE, email: ANA, totalCents: 6 }),
  cursorEvent({
    at: H2 + 10 * MINUTE,
    email: BOB,
    model: "gpt-5",
    totalCents: 10,
  }),
  cursorEvent({
    at: H2 + 20 * MINUTE,
    email: ANA,
    totalCents: 5,
    chargedCents: 0,
    kind: "Included in Business",
  }),
  cursorEvent({ at: YESTERDAY_HOUR + 15 * MINUTE, email: DEE, totalCents: 25 }),
];

// Bob's request at H2 that Cursor counted late.
const LATE_EVENT: JSONObject = cursorEvent({
  at: H2 + 50 * MINUTE,
  email: BOB,
  model: "gpt-5",
  totalCents: 12,
});

const TARGET: LlmProviderUsageWriteTarget = {
  projectId: PROJECT,
  connectionId: CONNECTION,
  connectionName: "Cursor",
  genAiProviderName: "cursor",
  serviceId: SERVICE,
  serviceName: "Cursor",
  retentionInDays: 30,
  costIsEstimated: false,
  projectPriceOverrides: [],
};

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

/*
 * One scheduled read through the connector, as LlmConnectionPullRunner
 * makes it: the connector plans its window from where the last read got
 * to, reads Cursor, and its covered window is what is written.
 */
async function readCursor(data: {
  events: Array<JSONObject>;
  state: LlmConnectionPullState;
  now: Date;
}): Promise<{ fetched: LlmUsageFetchResult; window: LlmUsageWindow }> {
  const clock: FakeCursorClock = new FakeCursorClock(data.now);
  const api: ReturnType<typeof createFakeCursorApi> = createFakeCursorApi({
    team: {
      apiKey: API_KEY,
      members: MEMBERS,
      usage: usageOf(data.events),
      activeOn: (dayMs: number): Array<string> => {
        return dayMs >= END - 7 * DAY ? [ANA, BOB] : [];
      },
    },
    clock,
  });
  const connector: CursorConnector = new CursorConnector();
  const planned: LlmUsageWindow = connector.planUsageWindow({
    now: data.now,
    state: data.state,
    backfillDays: 30,
  });
  const fetched: LlmUsageFetchResult = await connector.fetchUsage(
    SETTINGS,
    planned,
    {
      transport: api.transport,
      now: () => {
        return data.now;
      },
      state: data.state,
      sleep: clock.sleep,
      clock: clock.clock,
    },
  );

  return { fetched, window: fetched.coveredWindow || planned };
}

// What the runner writes for a read: the covered window, by the hour.
async function writeRead(read: {
  fetched: LlmUsageFetchResult;
  window: LlmUsageWindow;
}): Promise<LlmProviderUsageWriteResult> {
  return await LlmProviderUsageWriter.write({
    target: TARGET,
    window: read.window,
    records: read.fetched.records,
    now: new Date(),
    bucket: read.fetched.bucket,
  });
}

/*
 * A point of Cursor's OpenTelemetry Export as it is stored: a delta Sum of
 * the "cursor" service, the person and team as Cursor's resource
 * attributes.
 */
function exportRow(data: {
  name: string;
  value: number;
  at: number;
  attributes: Record<string, string>;
}): JSONObject {
  const at: Date = new Date(data.at);
  const attributes: Record<string, string> = {
    "resource.service.name": "cursor",
    "resource.cursor.team.id": "4242",
    "resource.cursor.user.id": "17",
    "cursor.user.email": ANA,
    ...data.attributes,
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    projectId: PROJECT.toString(),
    primaryEntityId: OTEL_SERVICE.toString(),
    primaryEntityType: "Service",
    entityKeys: [],
    serviceEntityKey: "",
    hostEntityKey: "",
    k8sPodEntityKey: "",
    k8sNodeEntityKey: "",
    k8sClusterEntityKey: "",
    containerEntityKey: "",
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    name: data.name,
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1_000_000),
    startTime: OneUptimeDate.toClickhouseDateTime(at),
    startTimeUnixNano: String(at.getTime() * 1_000_000),
    metricPointType: "Sum",
    aggregationTemporality: "Delta",
    isMonotonic: true,
    value: data.value,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ),
  };
}

function budget(spendSource: LlmBudgetSpendSource): LlmCostBudget {
  const item: LlmCostBudget = new LlmCostBudget();
  item.projectId = PROJECT;
  item.spendSource = spendSource;
  return item;
}

integration("Cursor's usage against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let originalMetric: ServiceConnection | undefined;
  let originalSpan: ServiceConnection | undefined;
  let lastState: LlmConnectionPullState = {};

  // One metric's stored sum for one hour, as a chart adds it up.
  async function sumOf(data: {
    metricName: string;
    hour: number;
    person?: string | undefined;
    tokenType?: string | undefined;
  }): Promise<number> {
    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT sum(value) AS total FROM ${database}.${new Metric().tableName} WHERE name = {name:String} AND time = {hour:DateTime} AND attributes['oneuptime.llm.connection.id'] = {connection:String} AND ({person:String} = '' OR attributes['user.email'] = {person:String}) AND ({tokenType:String} = '' OR attributes['gen_ai.token.type'] = {tokenType:String})`,
        query_params: {
          name: data.metricName,
          hour: OneUptimeDate.toClickhouseDateTime(new Date(data.hour)),
          connection: CONNECTION.toString(),
          person: data.person || "",
          tokenType: data.tokenType || "",
        },
        format: "JSON",
      })) as never;
    const rows: Array<JSONObject> = (await result.json()).data;
    return Number(rows[0]?.["total"] || 0);
  }

  // How many points the connection has stored for an hour.
  async function pointsAt(hour: number): Promise<number> {
    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT count() AS points FROM ${database}.${new Metric().tableName} WHERE time = {hour:DateTime} AND attributes['oneuptime.llm.connection.id'] = {connection:String}`,
        query_params: {
          hour: OneUptimeDate.toClickhouseDateTime(new Date(hour)),
          connection: CONNECTION.toString(),
        },
        format: "JSON",
      })) as never;
    const rows: Array<JSONObject> = (await result.json()).data;
    return Number(rows[0]?.["points"] || 0);
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

  test("a first read through the connector stores the team's hours, by person and model", async () => {
    const read: { fetched: LlmUsageFetchResult; window: LlmUsageWindow } =
      await readCursor({ events: EVENTS, state: {}, now: NOW });

    expect(read.fetched.bucket).toBe("hour");
    expect(read.fetched.complete).not.toBe(false);
    expect(read.fetched.members).toBe(3);
    expect(read.fetched.activeMembers).toBe(2);
    lastState = read.fetched.nextState || {};

    const result: LlmProviderUsageWriteResult = await writeRead(read);

    expect(result.pointsWritten).toBe(result.seriesCount);
    expect(result.daysWithUsage).toBe(
      new Set(
        [H3, H2, YESTERDAY_HOUR].map((hour: number) => {
          return Math.floor(hour / DAY);
        }),
      ).size,
    );

    // Ana's two requests at H3, at the start of the hour.
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        hour: H3,
        person: ANA,
      }),
    ).toBe(2);
    expect(
      await sumOf({ metricName: LLM_PROVIDER_COST_METRIC_NAME, hour: H3 }),
    ).toBeCloseTo(0.1, 9);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
        hour: H3,
        tokenType: "input",
      }),
    ).toBe(320);
    // What Cursor charged: Ana's included request costs nothing.
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        hour: H2,
        person: ANA,
      }),
    ).toBe(0);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        hour: H2,
        person: ANA,
      }),
    ).toBe(1);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        hour: H2,
        person: BOB,
      }),
    ).toBeCloseTo(0.1, 9);
    // Dee left the team; what Dee used is still Dee's.
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        hour: YESTERDAY_HOUR,
        person: DEE,
      }),
    ).toBeCloseTo(0.25, 9);
  });

  test("the next read, with nothing new: nothing is written", async () => {
    const read: { fetched: LlmUsageFetchResult; window: LlmUsageWindow } =
      await readCursor({
        events: EVENTS,
        state: lastState,
        now: new Date(NOW.getTime() + 5 * MINUTE),
      });

    const result: LlmProviderUsageWriteResult = await writeRead(read);

    expect(result.pointsWritten).toBe(0);
    lastState = read.fetched.nextState || lastState;
  });

  test("an hour Cursor adds to later is written as its difference; the other hours stay", async () => {
    const h3Points: number = await pointsAt(H3);

    // An hour on: the read goes over the last hours again, and finds Bob's late request.
    const read: { fetched: LlmUsageFetchResult; window: LlmUsageWindow } =
      await readCursor({
        events: [...EVENTS, LATE_EVENT],
        state: lastState,
        now: new Date(NOW.getTime() + HOUR),
      });

    expect(read.window.startDay.getTime()).toBeLessThanOrEqual(H2);

    const result: LlmProviderUsageWriteResult = await writeRead(read);

    // Bob's tokens (input, output, cache read, cache write), requests and cost.
    expect(result.pointsWritten).toBe(6);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        hour: H2,
        person: BOB,
      }),
    ).toBe(2);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_COST_METRIC_NAME,
        hour: H2,
        person: BOB,
      }),
    ).toBeCloseTo(0.22, 9);
    // H3 was read again, and nothing of it was written.
    expect(await pointsAt(H3)).toBe(h3Points);
    expect(
      await sumOf({
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        hour: H3,
        person: ANA,
      }),
    ).toBe(2);
  });

  test("what the connection says it used over the past 7 days is read back from its points", async () => {
    const totals: LlmProviderUsageTotals =
      await LlmProviderUsageWriter.readUsageTotals({
        target: TARGET,
        startTime: new Date(Math.floor(END / DAY) * DAY - 6 * DAY),
        endTime: new Date(END + HOUR),
      });

    // Six requests of 160 input and 20 output tokens.
    expect(totals).toEqual({
      inputTokens: 960,
      outputTokens: 120,
      requests: 6,
      costUsd: 0.57,
      daysWithUsage: new Set(
        [H3, H2, YESTERDAY_HOUR].map((hour: number) => {
          return Math.floor(hour / DAY);
        }),
      ).size,
    });
  });

  test("Usage > Provider accounts: each person, as the page asks for them", async () => {
    const aggregate: (
      metricName: string,
      keys: Array<string>,
    ) => Promise<Array<AggregatedModel>> = async (
      metricName: string,
      keys: Array<string>,
    ): Promise<Array<AggregatedModel>> => {
      const startTime: Date = new Date(END - 3 * DAY);
      const endTime: Date = new Date(END + HOUR);
      const result: AggregatedResult = await MetricService.aggregateBy({
        query: buildProviderMetricQuery({
          projectId: PROJECT,
          metricName,
          startTime,
          endTime,
        }),
        aggregationType: AggregationType.Sum,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startTime,
        endTimestamp: endTime,
        aggregationInterval: AggregationInterval.Total,
        groupByAttributeKeys: keys,
        limit: 1000,
        skip: 0,
        props: { isRoot: true },
      } as AggregateBy<Metric>);

      return result.data || [];
    };

    const person: ReturnType<typeof getProviderUsageDimension> =
      getProviderUsageDimension("person");
    const summary: LlmProviderUsageSummary = foldProviderUsage({
      dimension: person,
      costRows: await aggregate(LLM_PROVIDER_COST_METRIC_NAME, [
        LLM_PROVIDER_PERSON_ATTRIBUTE,
        LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
      ]),
      tokenRows: await aggregate(LLM_PROVIDER_TOKENS_METRIC_NAME, [
        LLM_PROVIDER_PERSON_ATTRIBUTE,
        LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
      ]),
      requestRows: await aggregate(LLM_PROVIDER_REQUESTS_METRIC_NAME, [
        LLM_PROVIDER_PERSON_ATTRIBUTE,
      ]),
    });

    expect(
      summary.rows.map((row: { key: string; costUsd: number }) => {
        return [row.key, row.costUsd];
      }),
    ).toEqual([
      [DEE, 0.25],
      [BOB, 0.22],
      [ANA, 0.1],
    ]);
    expect(summary.totals.requests).toBe(6);
    expect(summary.totals.costIncludesEstimate).toBe(false);
  });

  test("a budget on the provider accounts reads what Cursor charged, by provider and model", async () => {
    const from: Date = new Date(END - 3 * DAY);
    const to: Date = new Date(END + HOUR);

    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: from,
        endTime: to,
        provider: "cursor",
      }),
    ).toBeCloseTo(0.57, 6);
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: from,
        endTime: to,
        provider: "cursor",
        model: "gpt-5",
      }),
    ).toBeCloseTo(0.22, 6);
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: from,
        endTime: to,
        provider: "openai",
      }),
    ).toBe(0);
  });

  /*
   * Cursor Enterprise's OpenTelemetry Export arrives as well: the same
   * requests, as cursor.* metrics of the "cursor" service. Each reader
   * counts one of the two, so nothing ever adds them up.
   */
  test("with the OpenTelemetry Export too, the two ways are never added together", async () => {
    const at: number = H3 + 10 * MINUTE;

    await MetricService.insertJsonRows(
      [
        exportRow({
          name: "cursor.cost.usage",
          value: 0.08,
          at,
          attributes: { "cursor.model.name": "claude-4.5-sonnet" },
        }),
        exportRow({
          name: "cursor.token.usage",
          value: 300,
          at,
          attributes: {
            "cursor.model.name": "claude-4.5-sonnet",
            "cursor.token.type": "input",
          },
        }),
        exportRow({
          name: "cursor.token.usage",
          value: 40,
          at,
          attributes: {
            "cursor.model.name": "claude-4.5-sonnet",
            "cursor.token.type": "output",
          },
        }),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const from: Date = new Date(END - 3 * DAY);
    const to: Date = new Date(END + HOUR);

    // Your AI calls, and a budget on the calls: the Export alone.
    const calls: LlmMetricUsageResponse = await LlmMetricUsageReader.read({
      projectId: PROJECT,
      startTime: from,
      endTime: to,
      dimension: LlmMetricUsageDimension.None,
    });

    expect(calls.totals.costUsd).toBeCloseTo(0.08, 9);
    expect(calls.totals.inputTokens).toBe(300);
    expect(calls.totals.outputTokens).toBe(40);

    /*
     * The Usage tab's tiles (#6349): the Export, counted from its metrics
     * under its own service - never with the Admin API's points.
     */
    const usage: LlmUsageResponse = await LlmUsageReader.read({
      projectId: PROJECT,
      startTime: from,
      endTime: to,
      dimension: LlmUsageDimension.None,
    });

    expect(usage.totals.costUsd).toBeCloseTo(0.08, 9);
    expect(usage.totals.inputTokens).toBe(300);
    expect(usage.totals.outputTokens).toBe(40);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Metrics);

    // Provider accounts: the Admin API's points alone.
    expect(
      await LlmProviderSpend.getCostInUSD({
        projectId: PROJECT,
        startTime: from,
        endTime: to,
      }),
    ).toBeCloseTo(0.57, 6);
    expect(
      await LlmProviderUsageWriter.readUsageTotals({
        target: TARGET,
        startTime: from,
        endTime: to,
      }),
    ).toMatchObject({ inputTokens: 960, outputTokens: 120, costUsd: 0.57 });

    // A budget counts one of them, as its source says.
    const providers: LlmResolvedSpend =
      await LlmCostBudgetEvaluator.resolveSpend({
        budget: budget(LlmBudgetSpendSource.Providers),
        dayStart: from,
        now: to,
      });
    const onCalls: LlmResolvedSpend = await LlmCostBudgetEvaluator.resolveSpend(
      {
        budget: budget(LlmBudgetSpendSource.Calls),
        dayStart: from,
        now: to,
      },
    );

    expect(providers.source).toBe("providers");
    expect(providers.spendInUSD).toBeCloseTo(0.57, 6);
    expect(onCalls.source).toBe("metrics");
    expect(onCalls.spendInUSD).toBeCloseTo(0.08, 6);

    // The setup check: the Export is Cursor's metrics; the account's own is its newest hour.
    const sources: Array<LlmSetupCheckMetricSource> =
      LlmSetupCheckReader.toMetricSources(
        (
          await (
            await MetricService.executeQuery(
              LlmSetupCheckReader.buildMetricSourcesStatement(
                {
                  projectId: PROJECT,
                  now: to,
                  metricFilter: {},
                  logFilter: {},
                  props: { isRoot: true },
                },
                {},
              ),
            )
          ).json<{ data?: Array<JSONObject> }>()
        ).data as Array<JSONObject>,
      );

    expect(sources).toEqual([
      {
        source: LlmMetricSource.Cursor,
        points: 3,
        newestAt: new Date(at).toISOString(),
      },
    ]);

    const newest: Array<JSONObject> = (
      await (
        await MetricService.executeQuery(
          LlmSetupCheckReader.buildProviderUsageStatement(
            {
              projectId: PROJECT,
              now: to,
              metricFilter: {},
              logFilter: {},
              props: { isRoot: true },
            },
            {},
          ),
        )
      ).json<{ data?: Array<JSONObject> }>()
    ).data as Array<JSONObject>;

    expect(newest).toHaveLength(1);
    expect(newest[0]!["connectionId"]).toBe(CONNECTION.toString());
    // The newest hour with usage: Bob's at H2.
    expect(Number(newest[0]!["newestAtMs"])).toBe(H2);
  });
});

describe("Cursor usage ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
