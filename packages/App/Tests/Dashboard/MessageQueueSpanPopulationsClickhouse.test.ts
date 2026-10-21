import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  FixtureAttributes,
  SPAN_FIXTURES,
  SpanFixture,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import {
  MessageQueueSpanRow,
  MessageQueueSpanStore,
  spanMatchesQuery,
  toStoredAttributes,
} from "Common/Tests/App/Dashboard/MessageQueueSpanStore";
import { resolveMessagingSpan } from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import MessagingEntityKeyResolver from "../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
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
 * The queue Overview's span groups against a real ClickHouse server.
 *
 * The Overview tells a queue's spans apart by kind AND by the operation
 * they record (MessageQueueSpanPopulation): the attribute filters it sends
 * lean on how the query builder compiles a Map(String, String) filter — a
 * missing key reading "", `NOT IN` passing a span without the key, a
 * numeric comparison on the stored text, `attributeKeys` — and on how
 * ingest stores a typed value (a batch size of 0 as the text "0"). The
 * unit suites (Common/Tests/App/Dashboard/MessageQueueSpanPopulations)
 * answer the Overview's requests from an in-memory store that evaluates
 * each query the way this suite shows ClickHouse does. So this suite:
 *
 *   1. stores spans shaped as the instrumentations emit them — keyed by the
 *      REAL ingest stamper, inserted with typed attribute values as ingest
 *      inserts them — in a table built from the real Span model;
 *   2. runs the REAL fetcher (fetchMessageQueueSpanOverview) with every
 *      aggregate request sent across the wire as the dashboard sends it
 *      (JSONFunctions serialize, deserialize) to the REAL SpanService;
 *   3. checks what the Overview shows — the idle SQS queue consumes
 *      nothing, a Java agent's SNS publishes are published, a Service Bus
 *      producer's failures are its sends' — and that the in-memory store
 *      answers every scenario exactly as ClickHouse does;
 *   4. over the core's whole corpus, that every group's query matches the
 *      same spans on ClickHouse as in the store.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Dashboard/MessageQueueSpanPopulationsClickhouse.test.ts
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

/*
 * The dashboard's API client, answered by whichever backend a test picks:
 * the real SpanService over ClickHouse, or the in-memory store.
 */
let mockAnswer: ((request: unknown) => Promise<unknown>) | null = null;

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        if (!mockAnswer) {
          throw new Error("No backend picked for the aggregate request");
        }
        return mockAnswer(request);
      },
    },
  };
});

import SpanService from "Common/Server/Services/SpanService";
import {
  MessageQueueQueryWindow,
  MessageQueueServiceRow,
  MessageQueueSpanOverview,
  MessageQueueSpanPopulation,
  MessageQueueTimePoint,
  buildMessageQueueSpanQuery,
  fetchMessageQueueSpanOverview,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `message_queue_overview_test_${process.pid}_${Date.now()}`;

const now: number = Date.now();
// A whole past hour, so every interval of it is complete.
const WINDOW_START: Date = new Date(
  Math.floor((now - 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) * 60 * 60 * 1000,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 60 * 60 * 1000);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const SQS_QUEUE_URL: string =
  "https://sqs.us-east-1.amazonaws.com/123456789012/orders";

const SENDER: string = "3c0e7b2a-1111-4111-8111-000000000001";
const NODE_CONSUMER: string = "3c0e7b2a-1111-4111-8111-000000000002";
const PYTHON_CONSUMER: string = "3c0e7b2a-1111-4111-8111-000000000003";
const JAVA_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000004";
const GO_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000005";
const DOTNET_SERVICE: string = "3c0e7b2a-1111-4111-8111-000000000006";

function fixture(name: string): SpanFixture {
  const found: SpanFixture | undefined = SPAN_FIXTURES.find(
    (candidate: SpanFixture): boolean => {
      return candidate.name === name;
    },
  );
  if (!found) {
    throw new Error(`No span fixture named "${name}"`);
  }
  return found;
}

// Node's instrumentation-aws-sdk 0.58+: one CONSUMER span per ReceiveMessage.
function nodeSqsReceive(messages: number): FixtureAttributes {
  return {
    "rpc.system": "aws-api",
    "rpc.service": "SQS",
    "rpc.method": "ReceiveMessage",
    "messaging.system": "aws_sqs",
    "messaging.destination.name": "orders",
    "url.full": SQS_QUEUE_URL,
    "messaging.operation.type": "receive",
    // A number, as the SDK sets it: ClickHouse stores its text.
    "messaging.batch.message_count": messages,
  };
}

const NODE_SQS_SEND: FixtureAttributes = {
  "rpc.system": "aws-api",
  "rpc.service": "SQS",
  "rpc.method": "SendMessage",
  "messaging.system": "aws_sqs",
  "messaging.destination.name": "orders",
  "url.full": SQS_QUEUE_URL,
};

const BOTO3SQS_PROCESS: FixtureAttributes = {
  "messaging.system": "aws.sqs",
  "messaging.destination": "orders",
  "messaging.destination_kind": "queue",
  "messaging.url": "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
  "messaging.operation": "process",
  "messaging.message_id": "5fea7756-0ea4-451a-a703-a558b933e274",
};

interface SpanShape {
  kind: string;
  attributes: FixtureAttributes;
  service: string;
  durationMs: number;
  copies: number;
  // How many of the copies failed.
  failed?: number;
}

interface Scenario {
  name: string;
  // The row's specific system, which the page passes.
  messagingSystem: string;
  spans: Array<SpanShape>;
  // What the Overview must show.
  expect: (overview: MessageQueueSpanOverview) => void;
}

function sumOf(series: Array<MessageQueueTimePoint>): number {
  return series.reduce(
    (total: number, point: MessageQueueTimePoint): number => {
      return total + point.y;
    },
    0,
  );
}

function onlyRow(
  services: Array<MessageQueueServiceRow>,
): MessageQueueServiceRow {
  expect(services).toHaveLength(1);
  return services[0]!;
}

const SCENARIOS: Array<Scenario> = [
  {
    name: "an idle SQS queue long-polled by Node's instrumentation-aws-sdk 0.58+",
    messagingSystem: "aws_sqs",
    spans: [
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(0),
        service: NODE_CONSUMER,
        durationMs: 20_000,
        copies: 180,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.total).toBe(180);
      expect(overview.metrics.consumed).toBe(0);
      expect(overview.metrics.p95ProcessingMs).toBeNull();
      expect(overview.consumers.services).toEqual([]);
    },
  },
  {
    name: "a boto3sqs consumer: its receives are polls, its process spans the messages",
    messagingSystem: "aws_sqs",
    spans: [
      {
        kind: SpanKind.Consumer,
        attributes: fixture(
          "Python boto3sqs receive (queue URL in messaging.url)",
        ).attributes,
        service: PYTHON_CONSUMER,
        durationMs: 5_000,
        copies: 60,
      },
      {
        kind: SpanKind.Consumer,
        attributes: BOTO3SQS_PROCESS,
        service: PYTHON_CONSUMER,
        durationMs: 30,
        copies: 120,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.total).toBe(180);
      expect(overview.metrics.consumed).toBe(120);
      expect(overview.metrics.p95ProcessingMs).toBeCloseTo(30, 3);
      expect(onlyRow(overview.consumers.services).calls).toBe(120);
    },
  },
  {
    name: "Node 0.58+ receives that returned a message: one batch each, no processing time",
    messagingSystem: "aws_sqs",
    spans: [
      {
        kind: SpanKind.Producer,
        attributes: NODE_SQS_SEND,
        service: SENDER,
        durationMs: 25,
        copies: 60,
      },
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(0),
        service: NODE_CONSUMER,
        durationMs: 20_000,
        copies: 120,
      },
      {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(1),
        service: NODE_CONSUMER,
        durationMs: 10_000,
        copies: 60,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.published).toBe(60);
      expect(overview.metrics.consumed).toBe(60);
      expect(sumOf(overview.metrics.consumedSeries)).toBe(60);
      expect(overview.metrics.p95ProcessingMs).toBeNull();
      expect(onlyRow(overview.consumers.services)).toEqual({
        serviceId: NODE_CONSUMER,
        calls: 60,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
      });
    },
  },
  {
    name: "pika's CONSUMER receives are deliveries, counted with their time",
    messagingSystem: "rabbitmq",
    spans: [
      {
        kind: SpanKind.Consumer,
        attributes: fixture("Python pika consume").attributes,
        service: PYTHON_CONSUMER,
        durationMs: 12,
        copies: 50,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.consumed).toBe(50);
      expect(overview.metrics.p95ProcessingMs).toBeCloseTo(12, 3);
    },
  },
  {
    name: "a Kafka receive that returned nothing is not consumption",
    messagingSystem: "kafka",
    spans: [
      {
        kind: SpanKind.Consumer,
        attributes: {
          ...fixture("Java agent Kafka process (default mode)").attributes,
          "messaging.operation": "receive",
          "messaging.batch.message_count": 0,
        },
        service: JAVA_SERVICE,
        durationMs: 5_000,
        copies: 30,
      },
      {
        kind: SpanKind.Consumer,
        attributes: fixture("Java agent Kafka process (default mode)")
          .attributes,
        service: JAVA_SERVICE,
        durationMs: 8,
        copies: 40,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.total).toBe(70);
      expect(overview.metrics.consumed).toBe(40);
      expect(overview.metrics.p95ProcessingMs).toBeCloseTo(8, 3);
    },
  },
  {
    name: "an SNS topic the Java agent publishes to: CLIENT spans named by rpc.method only",
    messagingSystem: "aws.sns",
    spans: [
      {
        kind: SpanKind.Client,
        attributes: fixture(
          "Java agent SNS Publish (an RPC span with no messaging.system)",
        ).attributes,
        service: JAVA_SERVICE,
        durationMs: 30,
        copies: 500,
        failed: 10,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.total).toBe(500);
      expect(overview.metrics.published).toBe(500);
      expect(sumOf(overview.metrics.publishedSeries)).toBe(500);
      const producer: MessageQueueServiceRow = onlyRow(
        overview.producers.services,
      );
      expect(producer.calls).toBe(500);
      expect(producer.errorRatePercent).toBeCloseTo(2, 5);
      expect(overview.metrics.consumed).toBe(0);
    },
  },
  {
    name: "Go's otelaws SNS publish: counted once, by its operation type",
    messagingSystem: "aws.sns",
    spans: [
      {
        kind: SpanKind.Client,
        attributes: fixture(
          "Go otelaws SNS Publish (aws_sns, short topic name)",
        ).attributes,
        service: GO_SERVICE,
        durationMs: 18,
        copies: 40,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.published).toBe(40);
      expect(onlyRow(overview.producers.services).calls).toBe(40);
    },
  },
  {
    name: "Service Bus from .NET: the messages from the per-message spans, failures and time from the sends",
    messagingSystem: "servicebus",
    spans: [
      {
        kind: SpanKind.Producer,
        attributes: fixture(".NET Service Bus per-message PRODUCER span")
          .attributes,
        service: DOTNET_SERVICE,
        durationMs: 0.02,
        copies: 200,
      },
      {
        kind: SpanKind.Client,
        attributes: {
          ...fixture(".NET Service Bus send (ActivitySource mode)").attributes,
          "messaging.batch.message_count": 1,
        },
        service: DOTNET_SERVICE,
        durationMs: 45,
        copies: 200,
        failed: 50,
      },
    ],
    expect: (overview: MessageQueueSpanOverview): void => {
      expect(overview.metrics.total).toBe(400);
      expect(overview.metrics.errors).toBe(50);
      expect(overview.metrics.published).toBe(200);
      const producer: MessageQueueServiceRow = onlyRow(
        overview.producers.services,
      );
      expect(producer.calls).toBe(200);
      expect(producer.errorRatePercent).toBeCloseTo(25, 5);
      expect(producer.p95DurationMs!).toBeCloseTo(45, 3);
    },
  },
];

// ---- rows as ingest writes them -------------------------------------------

interface InsertedSpan {
  projectId: string;
  kind: string;
  serviceId: string;
  durationMs: number;
  failed: boolean;
  startMs: number;
  attributes: FixtureAttributes;
  // What the real stamper put on the row.
  entityKeys: Array<string>;
}

// The real stamper, as ingest runs it on the final row.
function stamp(
  projectId: string,
  kind: string,
  attributes: FixtureAttributes,
): Array<string> {
  const row: JSONObject = {
    kind: kind,
    attributes: attributes as JSONObject,
    entityKeys: [],
  };
  new MessagingEntityKeyResolver(projectId).appendToSpanRow(row);
  return [...((row["entityKeys"] as Array<string>) || [])];
}

function scenarioSpans(
  projectId: string,
  scenario: Scenario,
): Array<InsertedSpan> {
  const spans: Array<InsertedSpan> = [];
  for (const shape of scenario.spans) {
    const entityKeys: Array<string> = stamp(
      projectId,
      shape.kind,
      shape.attributes,
    );
    expect({ scenario: scenario.name, keyed: entityKeys.length }).toEqual({
      scenario: scenario.name,
      keyed: 1,
    });
    for (let copy: number = 0; copy < shape.copies; copy++) {
      spans.push({
        projectId: projectId,
        kind: shape.kind,
        serviceId: shape.service,
        durationMs: shape.durationMs,
        failed: copy < (shape.failed || 0),
        // Spread over the hour, a second into each minute.
        startMs: WINDOW_START.getTime() + (copy % 60) * 60 * 1000 + 1000,
        attributes: shape.attributes,
        entityKeys: entityKeys,
      });
    }
  }
  return spans;
}

function insertRows(spans: Array<InsertedSpan>): Array<JSONObject> {
  return spans.map((span: InsertedSpan, index: number): JSONObject => {
    const start: Date = new Date(span.startMs);
    const durationNs: number = Math.round(span.durationMs * 1_000_000);
    const startNs: string = String(BigInt(span.startMs) * BigInt(1_000_000));
    return {
      projectId: span.projectId,
      primaryEntityId: span.serviceId,
      primaryEntityType: "Service",
      startTime: OneUptimeDate.toClickhouseDateTime64(start),
      endTime: OneUptimeDate.toClickhouseDateTime64(start),
      startTimeUnixNano: startNs,
      endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
      durationUnixNano: String(durationNs),
      traceId: `trace-${index}`,
      spanId: `span-${index}`,
      parentSpanId: "",
      // Typed values, as ingest sends them: ClickHouse stores their text.
      attributes: span.attributes as JSONObject,
      attributeKeys: Object.keys(span.attributes),
      entityKeys: span.entityKeys,
      statusCode: span.failed ? SpanStatus.Error : SpanStatus.Unset,
      name: "messaging",
      kind: span.kind,
      retentionDate: retentionDate,
    };
  });
}

// The same spans as the in-memory store holds them.
function toStoreRow(span: InsertedSpan): MessageQueueSpanRow {
  return {
    projectId: span.projectId,
    kind: span.kind,
    statusCode: span.failed ? SpanStatus.Error : SpanStatus.Unset,
    durationMs: span.durationMs,
    serviceId: span.serviceId,
    entityKeys: [...span.entityKeys],
    attributes: toStoredAttributes(span.attributes),
    startTime: new Date(span.startMs),
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Span();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Span as unknown as { new (): AnalyticsBaseModel },
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

// A request as the wire carries it: serialized, sent, deserialized.
function overTheWire<T>(value: T): T {
  return JSONFunctions.deserialize(
    JSON.parse(
      JSON.stringify(JSONFunctions.serialize(value as unknown as JSONObject)),
    ) as JSONObject,
  ) as unknown as T;
}

async function answerFromClickhouse(request: unknown): Promise<unknown> {
  const sent: { aggregateBy: JSONObject } = request as {
    aggregateBy: JSONObject;
  };
  const aggregateBy: JSONObject = overTheWire(sent.aggregateBy);
  const result: AggregatedResult = await SpanService.aggregateBy({
    ...(aggregateBy as unknown as Parameters<
      typeof SpanService.aggregateBy
    >[0]),
    props: { isRoot: true },
  });
  return overTheWire({ ...result } as unknown as JSONObject);
}

function answerFromStore(
  store: MessageQueueSpanStore,
): (request: unknown) => Promise<unknown> {
  return (request: unknown): Promise<unknown> => {
    return Promise.resolve(
      store.aggregate(request as Parameters<typeof store.aggregate>[0]),
    );
  };
}

function windowOf(
  projectId: string,
  keys: Array<string>,
): MessageQueueQueryWindow {
  return {
    projectId: projectId,
    keys: keys,
    start: WINDOW_START,
    end: WINDOW_END,
  };
}

// The figures two backends must agree on; p95s to the microsecond.
function comparable(overview: MessageQueueSpanOverview): JSONObject {
  const rows: (services: Array<MessageQueueServiceRow>) => Array<JSONObject> = (
    services: Array<MessageQueueServiceRow>,
  ): Array<JSONObject> => {
    return services.map((row: MessageQueueServiceRow): JSONObject => {
      return {
        serviceId: row.serviceId,
        calls: row.calls,
        errors: row.errors,
        errorRatePercent: row.errorRatePercent,
        p95DurationMs:
          row.p95DurationMs === null
            ? null
            : Math.round(row.p95DurationMs * 1000) / 1000,
      };
    });
  };
  const series: (points: Array<MessageQueueTimePoint>) => Array<string> = (
    points: Array<MessageQueueTimePoint>,
  ): Array<string> => {
    return points.map((point: MessageQueueTimePoint): string => {
      return `${point.x.toISOString()}=${point.y}`;
    });
  };
  const m: MessageQueueSpanOverview["metrics"] = overview.metrics;
  return {
    total: m.total,
    published: m.published,
    consumed: m.consumed,
    errors: m.errors,
    errorRatePercent: m.errorRatePercent,
    p95ProcessingMs:
      m.p95ProcessingMs === null
        ? null
        : Math.round(m.p95ProcessingMs * 1000) / 1000,
    publishedSeries: series(m.publishedSeries),
    consumedSeries: series(m.consumedSeries),
    errorSeries: series(m.errorSeries),
    p95Intervals: m.p95ProcessingSeries.length,
    producers: rows(overview.producers.services),
    producerTotal: overview.producers.total,
    consumers: rows(overview.consumers.services),
    consumerTotal: overview.consumers.total,
  };
}

const CORPUS_PROJECT_ID: string = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

// One scenario per project, so no two see each other's spans.
function scenarioProjectId(index: number): string {
  return `7a4c5b1e-2b3f-4c1d-9e8f-${String(index + 1).padStart(12, "0")}`;
}

interface CorpusSpan {
  name: string;
  system: string;
  span: InsertedSpan;
}

function corpusSpans(): Array<CorpusSpan> {
  const corpus: Array<CorpusSpan> = [];
  for (const [index, spanFixture] of SPAN_FIXTURES.entries()) {
    // An OTLP span without a kind is stored as INTERNAL.
    const kind: string = spanFixture.kind || SpanKind.Internal;
    const entityKeys: Array<string> = stamp(
      CORPUS_PROJECT_ID,
      kind,
      spanFixture.attributes,
    );
    if (entityKeys.length === 0) {
      continue;
    }
    const system: string =
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          return spanFixture.attributes[key];
        },
        kind: kind,
      })?.system || "";
    corpus.push({
      name: spanFixture.name,
      system: system,
      span: {
        projectId: CORPUS_PROJECT_ID,
        kind: kind,
        // One service per span: a group-by names each span that matched.
        serviceId: `3c0e7b2a-3333-4333-8333-${String(index).padStart(12, "0")}`,
        durationMs: 1,
        failed: false,
        startMs: WINDOW_START.getTime() + 60 * 1000,
        attributes: spanFixture.attributes,
        entityKeys: entityKeys,
      },
    });
  }
  return corpus;
}

integration("The queue Overview's span groups against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original:
    | {
        database: ClickhouseDatabase;
        databaseClient: ClickhouseClient | null;
        ingestDatabase: ClickhouseDatabase;
        ingestDatabaseClient: ClickhouseClient | null;
      }
    | undefined;

  const scenarioRows: Map<string, Array<InsertedSpan>> = new Map<
    string,
    Array<InsertedSpan>
  >();
  let corpus: Array<CorpusSpan> = [];

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
      database: SpanService.database,
      databaseClient: SpanService.databaseClient,
      ingestDatabase: SpanService.ingestDatabase,
      ingestDatabaseClient: SpanService.ingestDatabaseClient,
    };
    SpanService.database = clickhouse;
    SpanService.databaseClient = client;
    SpanService.ingestDatabase = clickhouse;
    SpanService.ingestDatabaseClient = client;

    const all: Array<InsertedSpan> = [];
    for (const [index, scenario] of SCENARIOS.entries()) {
      const rows: Array<InsertedSpan> = scenarioSpans(
        scenarioProjectId(index),
        scenario,
      );
      scenarioRows.set(scenario.name, rows);
      all.push(...rows);
    }
    corpus = corpusSpans();
    all.push(
      ...corpus.map((entry: CorpusSpan): InsertedSpan => {
        return entry.span;
      }),
    );

    const model: Span = new Span();
    await client.insert({
      table: `${database}.${model.tableName}`,
      values: insertRows(all),
      format: "JSONEachRow",
    });
  });

  afterAll(async (): Promise<void> => {
    mockAnswer = null;
    if (original) {
      Object.assign(SpanService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test.each(
    SCENARIOS.map((scenario: Scenario, index: number): [string, number] => {
      return [scenario.name, index];
    }),
  )(
    "%s: what the Overview shows, and the in-memory store agrees",
    async (_name: string, index: number): Promise<void> => {
      const scenario: Scenario = SCENARIOS[index]!;
      const projectId: string = scenarioProjectId(index);
      const rows: Array<InsertedSpan> = scenarioRows.get(scenario.name)!;
      const keys: Array<string> = Array.from(
        new Set(
          rows.flatMap((row: InsertedSpan): Array<string> => {
            return row.entityKeys;
          }),
        ),
      );
      expect(keys).toHaveLength(1);

      mockAnswer = answerFromClickhouse;
      const fromClickhouse: MessageQueueSpanOverview =
        await fetchMessageQueueSpanOverview({
          ...windowOf(projectId, keys),
          messagingSystem: scenario.messagingSystem,
        });

      scenario.expect(fromClickhouse);

      const store: MessageQueueSpanStore = new MessageQueueSpanStore();
      store.rows = rows.map(toStoreRow);
      mockAnswer = answerFromStore(store);
      const fromStore: MessageQueueSpanOverview =
        await fetchMessageQueueSpanOverview({
          ...windowOf(projectId, keys),
          messagingSystem: scenario.messagingSystem,
        });

      expect(comparable(fromStore)).toEqual(comparable(fromClickhouse));
    },
  );

  test("over the whole corpus, every group's query matches the same spans on ClickHouse as in the store", async (): Promise<void> => {
    expect(corpus.length).toBeGreaterThan(80);

    const populations: Array<MessageQueueSpanPopulation> = [
      "all",
      "publish",
      "send",
      "awsSend",
      "consume",
      "receivedBatch",
    ];
    const systems: Array<string> = Array.from(
      new Set(
        corpus.map((entry: CorpusSpan): string => {
          return entry.system;
        }),
      ),
    ).sort();
    const storeRows: Array<MessageQueueSpanRow> = corpus.map(
      (entry: CorpusSpan): MessageQueueSpanRow => {
        return toStoreRow(entry.span);
      },
    );

    let compared: number = 0;
    for (const system of systems) {
      const members: Array<CorpusSpan> = corpus.filter(
        (entry: CorpusSpan): boolean => {
          return entry.system === system;
        },
      );
      const keys: Array<string> = Array.from(
        new Set(
          members.flatMap((entry: CorpusSpan): Array<string> => {
            return entry.span.entityKeys;
          }),
        ),
      );

      for (const population of populations) {
        const query: Record<string, unknown> = buildMessageQueueSpanQuery(
          windowOf(CORPUS_PROJECT_ID, keys),
          { population: population, messagingSystem: system },
        )!;

        const result: AggregatedResult = (await answerFromClickhouse({
          aggregateBy: {
            query: query,
            aggregationType: AggregationType.Count,
            aggregateColumnName: "durationUnixNano",
            aggregationTimestampColumnName: "startTime",
            startTimestamp: WINDOW_START,
            endTimestamp: WINDOW_END,
            limit: 10000,
            skip: 0,
            groupBy: { primaryEntityId: true },
            aggregationInterval: AggregationInterval.Total,
          },
        })) as AggregatedResult;

        const onClickhouse: Array<string> = result.data
          .filter((row: AggregatedModel): boolean => {
            return Number(row["value"]) > 0;
          })
          .map((row: AggregatedModel): string => {
            return String(row["primaryEntityId"]);
          })
          .sort();

        const inStore: Array<string> = storeRows
          .filter((row: MessageQueueSpanRow): boolean => {
            return spanMatchesQuery(row, query);
          })
          .map((row: MessageQueueSpanRow): string => {
            return row.serviceId;
          })
          .sort();

        expect({ system, population, spans: onClickhouse }).toEqual({
          system,
          population,
          spans: inStore,
        });
        compared += inStore.length;
      }
    }
    // Every keyed span is in its system's "all" group at least.
    expect(compared).toBeGreaterThanOrEqual(corpus.length);
  });
});

describe("The queue Overview's ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
