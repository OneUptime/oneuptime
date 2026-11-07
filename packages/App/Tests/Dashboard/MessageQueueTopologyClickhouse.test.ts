import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  MessageQueueTopologyKeys,
  MessageQueueTopologyPairRow,
  MessageQueueTopologyQueueRow,
  MessageQueueTopologyWindow,
  buildMessageQueueTopologyKeys,
  buildMessageQueueTopologyStatement,
  readMessageQueueTopologyRows,
} from "Common/Server/Utils/Telemetry/MessageQueueTopology";
import { TelemetryServiceFilter } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
  MessageQueueTopologyService as MessageQueueTopologyServiceEntry,
  readMessageQueueTopologyResponse,
} from "Common/Types/MessageQueue/MessageQueueTopology";
import {
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import {
  FixtureAttributes,
  SPAN_FIXTURES,
  SpanFixture,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import {
  MessageQueueSpanRow,
  toStoredAttributes,
} from "Common/Tests/App/Dashboard/MessageQueueSpanStore";
import { readMessageQueueTopologyTwin } from "Common/Tests/Server/Utils/Telemetry/MessageQueueTopologyReadTwin";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
 * The Queues topology's read against a real ClickHouse server.
 *
 * The topology reads every queue's spans in one statement
 * (buildMessageQueueTopologyStatement): the key array joined out, each
 * group of spans counted with the Overview's own filter - compiled by the
 * query builder, and switched per system with has({keys}, queueKey) where a
 * system reads a group apart - its p95 by quantileIf, the caller's read
 * scope, the retention filter, the busiest pairs first under a row limit.
 * The unit suites read that statement through its twin
 * (Common/Tests/Server/Utils/Telemetry/MessageQueueTopologyReadTwin) and
 * hold the map built from it to every queue's Overview over the in-memory
 * span store. So this suite, over spans keyed by the REAL ingest stamper and
 * stored as ingest stores them in a table built from the real Span model:
 *
 *   1. runs the REAL service (MessageQueueTopologyService.getTopology; the
 *      queue rows and the services' names Postgres holds are stood in for)
 *      and every queue's REAL Overview fetcher, both on ClickHouse, and
 *      checks the map says what each Overview says - its tiles, and every
 *      row of its Producers and Consumers cards, p95s to the last bit;
 *   2. checks the statement's rows are its twin's, row for row and in
 *      order, p95s included under ClickHouse's own percentile rule;
 *   3. pins what the read leaves out on ClickHouse: spans outside the
 *      window, past their retention, of another project, of a service the
 *      caller may not read, and keys of no queue;
 *   4. does both over the core's whole corpus at once.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Dashboard/MessageQueueTopologyClickhouse.test.ts
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

// The dashboard's API client, answered by the real SpanService.
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

/*
 * Postgres's part - the queue rows discovery stored, and the names of the
 * services - stood in for: the span read is what this suite is about.
 */
const mockQueueRowsByProject: Map<
  string,
  Array<MessageQueueTopologyQueueRow>
> = new Map<string, Array<MessageQueueTopologyQueueRow>>();
const mockServiceNames: Map<string, string> = new Map<string, string>();

jest.mock("Common/Server/Services/MessageQueueService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (args: {
        query: { projectId: unknown };
      }): Promise<Array<JSONObject>> => {
        return Promise.resolve(
          (mockQueueRowsByProject.get(String(args.query.projectId)) || []).map(
            (row: MessageQueueTopologyQueueRow): JSONObject => {
              return { ...row, _id: row.id } as unknown as JSONObject;
            },
          ),
        );
      },
      countBy: (): Promise<never> => {
        return Promise.reject(
          new Error("No project of this suite has that many queues"),
        );
      },
    },
  };
});

jest.mock("Common/Server/Services/ServiceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (args: {
        query: { _id: { values: Array<unknown> } };
      }): Promise<Array<JSONObject>> => {
        return Promise.resolve(
          args.query._id.values
            .map((id: unknown): string => {
              return String(id);
            })
            .filter((id: string): boolean => {
              return mockServiceNames.has(id);
            })
            .map((id: string): JSONObject => {
              return { _id: id, name: mockServiceNames.get(id)! };
            }),
        );
      },
    },
  };
});

import SpanService from "Common/Server/Services/SpanService";
import MessageQueueTopologyService, {
  MessageQueueTopologyRequest,
} from "Common/Server/Services/MessageQueueTopologyService";
import {
  MessageQueueServiceRow,
  MessageQueueSpanOverview,
  fetchMessageQueueSpanOverview,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `message_queue_topology_test_${process.pid}_${Date.now()}`;

const HOUR_MS: number = 60 * 60 * 1000;
const MINUTE_MS: number = 60 * 1000;
const now: number = Date.now();
// A whole past hour, so every interval of it is complete.
const WINDOW_START: Date = new Date(
  Math.floor((now - 3 * HOUR_MS) / HOUR_MS) * HOUR_MS,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + HOUR_MS);
const WINDOW: MessageQueueTopologyWindow = {
  startTime: WINDOW_START,
  endTime: WINDOW_END,
};

function retentionDay(days: number): string {
  return OneUptimeDate.toClickhouseDateTime(
    OneUptimeDate.addRemoveDays(new Date(), days),
  ).substring(0, 10);
}

const LIVE_RETENTION: string = retentionDay(30);
// Past its retention: the row is still in the table, every read leaves it out.
const EXPIRED_RETENTION: string = retentionDay(-2);

const CHECKOUT: string = "3c0e7b2a-2222-4222-8222-000000000001";
const BILLING: string = "3c0e7b2a-2222-4222-8222-000000000002";
const FULFILMENT: string = "3c0e7b2a-2222-4222-8222-000000000003";
// A service the caller may not read the name of: listed, unnamed.
const NOTIFIER: string = "3c0e7b2a-2222-4222-8222-000000000004";
const SERVICES: ReadonlyArray<string> = [
  CHECKOUT,
  BILLING,
  FULFILMENT,
  NOTIFIER,
];
const SERVICE_NAMES: ReadonlyArray<[string, string]> = [
  [CHECKOUT, "checkout"],
  [BILLING, "billing"],
  [FULFILMENT, "fulfilment"],
];

// A project none of the scenarios is: its spans carry another project's key.
const STRAY_PROJECT_ID: string = "7a4c5b1e-3c4d-4e5f-9a0b-0000000000ff";

const SQS_QUEUE_URL: string =
  "https://sqs.us-east-1.amazonaws.com/123456789012/orders";

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

// ---- spans as ingest writes them -------------------------------------------

interface InsertedSpan {
  projectId: string;
  kind: string;
  serviceId: string;
  durationMs: number;
  failed: boolean;
  startMs: number;
  attributes: FixtureAttributes;
  entityKeys: Array<string>;
  expired: boolean;
}

const insertedSpans: Array<InsertedSpan> = [];

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

interface Project {
  index: number;
  id: string;
  // Queue key → the row discovery stores for the queue.
  queues: Map<string, MessageQueueTopologyQueueRow>;
}

function newProject(index: number): Project {
  return {
    index: index,
    id: `7a4c5b1e-3c4d-4e5f-9a0b-${String(index + 1).padStart(12, "0")}`,
    queues: new Map<string, MessageQueueTopologyQueueRow>(),
  };
}

/*
 * The key ingest stamps on a span, and the row discovery stores for its
 * queue: one per identifier, with the system the span resolves to. Throws
 * unless ingest stamps one key and discovery's identity builds that key.
 */
function keyOf(
  project: Project,
  kind: string,
  attributes: FixtureAttributes,
): string {
  const stamped: Array<string> = stamp(project.id, kind, attributes);
  const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    kind: kind,
  });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  const identifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;
  if (stamped.length !== 1 || !resolved || !identity || !identifier) {
    throw new Error(`Not one queue's span: ${JSON.stringify(attributes)}`);
  }
  const key: string = stamped[0]!;
  if (keyForMessageQueue(project.id, identity) !== key) {
    throw new Error(`Ingest and discovery key ${identifier} apart`);
  }
  if (!project.queues.has(key)) {
    const queueNumber: number = project.queues.size + 1;
    project.queues.set(key, {
      id: `9d1e2f3a-${String(project.index).padStart(4, "0")}-4000-8000-${String(
        queueNumber,
      ).padStart(12, "0")}`,
      name: resolved.destination,
      messagingSystem: resolved.system,
      destinationName: resolved.destination,
      brokerScope: identity.brokerScope,
      brokerAddress: resolved.brokerAddress || "",
      queueIdentifier: identifier,
      discoverySource: "traces",
      lastSeenAt: WINDOW_END,
      brokerMetricsLastSeenAt: null,
    });
  }
  return key;
}

interface SpanShape {
  kind: string;
  attributes: FixtureAttributes;
  service: string;
  // The copies' durations, in turn.
  durationsMs: ReadonlyArray<number>;
  copies: number;
  // How many of the copies failed.
  failed?: number;
}

/*
 * Durations that all differ, so a p95 falls between two of them: there
 * ClickHouse's quantile interpolates, and any other percentile rule reads
 * another number.
 */
function ladder(count: number, fromMs: number, stepMs: number): Array<number> {
  const durations: Array<number> = [];
  for (let index: number = 0; index < count; index++) {
    durations.push(fromMs + index * stepMs);
  }
  return durations;
}

function addSpans(project: Project, shape: SpanShape): void {
  const key: string = keyOf(project, shape.kind, shape.attributes);
  for (let copy: number = 0; copy < shape.copies; copy++) {
    insertedSpans.push({
      projectId: project.id,
      kind: shape.kind,
      serviceId: shape.service,
      durationMs: shape.durationsMs[copy % shape.durationsMs.length]!,
      failed: copy < (shape.failed || 0),
      // Spread over the hour, a second into each minute.
      startMs: WINDOW_START.getTime() + (copy % 60) * MINUTE_MS + 1000,
      attributes: shape.attributes,
      entityKeys: [key],
      expired: false,
    });
  }
}

// One span as given, the rest a live, healthy span mid-window.
function addSpan(
  span: Pick<InsertedSpan, "projectId" | "kind" | "attributes" | "entityKeys"> &
    Partial<InsertedSpan>,
): void {
  insertedSpans.push({
    serviceId: CHECKOUT,
    durationMs: 3,
    failed: false,
    startMs: WINDOW_START.getTime() + 30 * MINUTE_MS,
    expired: false,
    ...span,
  });
}

function insertRows(spans: ReadonlyArray<InsertedSpan>): Array<JSONObject> {
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
      retentionDate: span.expired ? EXPIRED_RETENTION : LIVE_RETENTION,
    };
  });
}

// The same span as the twin reads it.
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

// ---- the two reads ---------------------------------------------------------

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

function keysOf(project: Project): MessageQueueTopologyKeys {
  return buildMessageQueueTopologyKeys(
    project.id,
    Array.from(project.queues.values()),
  );
}

async function topologyOf(
  project: Project,
  serviceFilter: TelemetryServiceFilter = {},
): Promise<MessageQueueTopologyResponse> {
  const props: DatabaseCommonInteractionProps = {
    tenantId: new ObjectID(project.id),
    isRoot: true,
  };
  const request: MessageQueueTopologyRequest = {
    projectId: new ObjectID(project.id),
    window: WINDOW,
    serviceFilter: serviceFilter,
    props: props,
  };
  return MessageQueueTopologyService.getTopology(request);
}

interface ReadOptions {
  serviceFilter?: TelemetryServiceFilter;
  rowLimit?: number;
}

async function readOnClickhouse(
  project: Project,
  options: ReadOptions = {},
): Promise<Array<MessageQueueTopologyPairRow>> {
  const statement: Statement = buildMessageQueueTopologyStatement({
    generator: SpanService.statementGenerator as StatementGenerator<Span>,
    projectId: new ObjectID(project.id),
    keys: keysOf(project),
    window: WINDOW,
    serviceFilter: options.serviceFilter || {},
    rowLimit: options.rowLimit || MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
  });
  const result: Results = await SpanService.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();
  return readMessageQueueTopologyRows(response.data || []);
}

/*
 * ClickHouse's quantile: below its reservoir of 8192 values it keeps every
 * value, sorts them, and interpolates linearly between the two ranks either
 * side of level × (n - 1). (Past the reservoir it samples; no group here
 * comes near it.)
 */
function clickhouseQuantile(
  level: number,
  values: ReadonlyArray<number>,
): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  const index: number = Math.max(
    0,
    Math.min(sorted.length - 1, level * (sorted.length - 1)),
  );
  const left: number = Math.floor(index);
  const right: number = left + 1;
  if (right === sorted.length) {
    return sorted[left]!;
  }
  return sorted[left]! * (right - index) + sorted[right]! * (index - left);
}

function clickhouseP95(values: ReadonlyArray<number>): number {
  return clickhouseQuantile(0.95, values);
}

// Every live span of every project: the twin keeps the project's own.
function liveStoreRows(): Array<MessageQueueSpanRow> {
  return insertedSpans
    .filter((span: InsertedSpan): boolean => {
      return !span.expired;
    })
    .map(toStoreRow);
}

function readByTwin(
  project: Project,
  options: ReadOptions = {},
): Array<MessageQueueTopologyPairRow> {
  return readMessageQueueTopologyTwin({
    rows: liveStoreRows(),
    projectId: project.id,
    keys: keysOf(project),
    window: WINDOW,
    serviceFilter: options.serviceFilter,
    p95Of: clickhouseP95,
  }).slice(0, options.rowLimit || MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS);
}

type CardRow = [string, number, number, number | null, number | null];

function flowRows(flows: Array<MessageQueueTopologyFlow>): Array<CardRow> {
  return flows.map((flow: MessageQueueTopologyFlow): CardRow => {
    return [
      flow.serviceId,
      flow.messages,
      flow.errors,
      flow.errorRatePercent,
      flow.p95DurationMs,
    ];
  });
}

function cardRows(services: Array<MessageQueueServiceRow>): Array<CardRow> {
  return services.map((service: MessageQueueServiceRow): CardRow => {
    return [
      service.serviceId,
      service.calls,
      service.errors,
      service.errorRatePercent,
      service.p95DurationMs,
    ];
  });
}

function queueOnMap(
  map: MessageQueueTopologyResponse,
  row: MessageQueueTopologyQueueRow,
): MessageQueueTopologyQueue {
  const found: MessageQueueTopologyQueue | undefined = map.queues.find(
    (candidate: MessageQueueTopologyQueue): boolean => {
      return candidate.id === row.id;
    },
  );
  if (!found) {
    throw new Error(`The map leaves out ${row.queueIdentifier}`);
  }
  return found;
}

function linesOf(
  map: MessageQueueTopologyResponse,
  queueId: string,
  direction: "publish" | "consume",
): Array<MessageQueueTopologyFlow> {
  return map.flows.filter((flow: MessageQueueTopologyFlow): boolean => {
    return flow.queueId === queueId && flow.direction === direction;
  });
}

/*
 * Every queue of the project, read both ways on ClickHouse: the map once,
 * and each queue's Overview, told its row's system and asked for every
 * service (the cards show the busiest ten; the map draws them all).
 */
async function expectMapToBeTheOverviews(
  project: Project,
  map: MessageQueueTopologyResponse,
): Promise<number> {
  let compared: number = 0;
  mockAnswer = answerFromClickhouse;

  for (const [key, row] of project.queues.entries()) {
    const overview: MessageQueueSpanOverview =
      await fetchMessageQueueSpanOverview({
        projectId: project.id,
        keys: [key],
        start: WINDOW_START,
        end: WINDOW_END,
        messagingSystem: row.messagingSystem,
        serviceLimit: 10000,
      });
    const onMap: MessageQueueTopologyQueue = queueOnMap(map, row);
    const context: string = `${row.messagingSystem} ${row.destinationName}`;

    expect({
      context,
      spans: onMap.spans,
      errors: onMap.errors,
      published: onMap.published,
      consumed: onMap.consumed,
    }).toEqual({
      context,
      spans: overview.metrics.total,
      errors: overview.metrics.errors,
      published: overview.metrics.published,
      consumed: overview.metrics.consumed,
    });
    expect({
      context,
      producers: flowRows(linesOf(map, row.id, "publish")),
    }).toEqual({
      context,
      producers: cardRows(overview.producers.services),
    });
    expect({
      context,
      consumers: flowRows(linesOf(map, row.id, "consume")),
    }).toEqual({
      context,
      consumers: cardRows(overview.consumers.services),
    });
    expect(linesOf(map, row.id, "publish")).toHaveLength(
      overview.producers.total,
    );
    expect(linesOf(map, row.id, "consume")).toHaveLength(
      overview.consumers.total,
    );
    compared += 1;
  }

  // Nothing on the map but the project's queues and the services it names.
  expect(map.queues).toHaveLength(project.queues.size);
  const listed: Set<string> = new Set<string>(
    map.services.map((service: MessageQueueTopologyServiceEntry): string => {
      return service.id;
    }),
  );
  for (const flow of map.flows) {
    expect(listed.has(flow.serviceId)).toBe(true);
  }
  return compared;
}

// ---- the scenarios ---------------------------------------------------------

const KAFKA_ORDERS_SEND: FixtureAttributes = {
  "messaging.system": "kafka",
  "messaging.destination.name": "orders",
  "messaging.operation.type": "send",
};

const KAFKA_ORDERS_PROCESS: FixtureAttributes = {
  "messaging.system": "kafka",
  "messaging.destination.name": "orders",
  "messaging.operation.type": "process",
  "messaging.consumer.group.name": "fulfilment",
};

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

const SQS_SEND: FixtureAttributes = {
  "rpc.system": "aws-api",
  "rpc.service": "SQS",
  "rpc.method": "SendMessage",
  "messaging.system": "aws_sqs",
  "messaging.destination.name": "orders",
  "url.full": SQS_QUEUE_URL,
};

function serviceBus(operation: string): FixtureAttributes {
  return {
    "messaging.system": "servicebus",
    "messaging.destination.name": "orders",
    "server.address": "orders-prod.servicebus.windows.net",
    "messaging.operation": operation,
  };
}

function kafkaTopic(topic: string, operation: string): FixtureAttributes {
  return {
    "messaging.system": "kafka",
    "messaging.destination.name": topic,
    "messaging.operation.type": operation,
  };
}

interface Scenario {
  name: string;
  // How many queues its spans name, when the scenario is about that.
  queues?: number;
  fill: (project: Project) => void;
}

const EDGES: string =
  "the edges: the window's ends, retention, another project, other keys, no service";

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: "Kafka: two producers and a consumer group, failures on both sides",
    queues: 1,
    fill: (project: Project): void => {
      addSpans(project, {
        kind: SpanKind.Producer,
        attributes: KAFKA_ORDERS_SEND,
        service: CHECKOUT,
        durationsMs: ladder(120, 4, 0.37),
        copies: 120,
        failed: 3,
      });
      addSpans(project, {
        kind: SpanKind.Producer,
        attributes: KAFKA_ORDERS_SEND,
        service: BILLING,
        durationsMs: [2, 3.5],
        copies: 41,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: KAFKA_ORDERS_PROCESS,
        service: FULFILMENT,
        durationsMs: ladder(163, 30, 1.13),
        copies: 163,
        failed: 10,
      });
    },
  },
  {
    name: "Amazon SQS: polls are no messages, received batches are, process spans carry the time; PRODUCER and CLIENT senders",
    queues: 1,
    fill: (project: Project): void => {
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(0),
        service: FULFILMENT,
        durationsMs: [20000],
        copies: 90,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(4),
        service: FULFILMENT,
        durationsMs: [3000, 2500.5],
        copies: 30,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: fixture(
          "Python boto3sqs receive (queue URL in messaging.url)",
        ).attributes,
        service: NOTIFIER,
        durationsMs: [5000],
        copies: 20,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: {
          "messaging.system": "aws.sqs",
          "messaging.destination": "orders",
          "messaging.destination_kind": "queue",
          "messaging.url":
            "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
          "messaging.operation": "process",
        },
        service: NOTIFIER,
        durationsMs: [25, 26.75, 90],
        copies: 60,
        failed: 4,
      });
      addSpans(project, {
        kind: SpanKind.Producer,
        attributes: SQS_SEND,
        service: CHECKOUT,
        durationsMs: [12, 13.5],
        copies: 70,
      });
      // A botocore sender: its publishes are client sends only.
      addSpans(project, {
        kind: SpanKind.Client,
        attributes: SQS_SEND,
        service: BILLING,
        durationsMs: [15, 40.5],
        copies: 30,
        failed: 5,
      });
    },
  },
  {
    name: "Azure Service Bus from .NET: the markers are the messages, the sends the failures and time",
    queues: 1,
    fill: (project: Project): void => {
      addSpans(project, {
        kind: SpanKind.Producer,
        attributes: serviceBus("create"),
        service: CHECKOUT,
        durationsMs: [0.02],
        copies: 13,
      });
      // More failed sends than messages: the card's rate is a share of sends.
      addSpans(project, {
        kind: SpanKind.Client,
        attributes: serviceBus("publish"),
        service: CHECKOUT,
        durationsMs: [18, 50.5],
        copies: 40,
        failed: 31,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: serviceBus("process"),
        service: FULFILMENT,
        durationsMs: [45],
        copies: 12,
      });
      addSpans(project, {
        kind: SpanKind.Client,
        attributes: serviceBus("settle"),
        service: FULFILMENT,
        durationsMs: [3],
        copies: 2,
        failed: 2,
      });
    },
  },
  {
    name: "Amazon SNS: the Java agent's publishes named by rpc.method only, Go's by their operation type",
    fill: (project: Project): void => {
      addSpans(project, {
        kind: SpanKind.Client,
        attributes: fixture(
          "Java agent SNS Publish (an RPC span with no messaging.system)",
        ).attributes,
        service: CHECKOUT,
        durationsMs: [30, 32.5, 35],
        copies: 500,
        failed: 10,
      });
      addSpans(project, {
        kind: SpanKind.Client,
        attributes: fixture(
          "Go otelaws SNS Publish (aws_sns, short topic name)",
        ).attributes,
        service: BILLING,
        durationsMs: [18],
        copies: 40,
      });
    },
  },
  {
    name: "several queues of several brokers in one read, each with its own system's groups",
    queues: 3,
    fill: (project: Project): void => {
      addSpans(project, {
        kind: SpanKind.Producer,
        attributes: kafkaTopic("payments", "send"),
        service: CHECKOUT,
        durationsMs: [3, 3.75],
        copies: 50,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: kafkaTopic("payments", "process"),
        service: FULFILMENT,
        durationsMs: [20, 22.5],
        copies: 48,
      });
      // A RabbitMQ receive is a delivery (pika): consumed, not a poll.
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "emails",
          "messaging.rabbitmq.destination.routing_key": "emails",
          "messaging.operation.type": "receive",
        },
        service: FULFILMENT,
        durationsMs: [11, 12.25],
        copies: 33,
      });
      // The same service's SQS receives: polls there.
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: nodeSqsReceive(2),
        service: FULFILMENT,
        durationsMs: [2000],
        copies: 7,
      });
    },
  },
  {
    name: EDGES,
    queues: 3,
    fill: (project: Project): void => {
      const audit: string = keyOf(
        project,
        SpanKind.Producer,
        kafkaTopic("audit", "send"),
      );
      const ledger: string = keyOf(
        project,
        SpanKind.Producer,
        kafkaTopic("ledger", "send"),
      );
      // A queue whose only span is before the window: listed, with nothing.
      const archive: string = keyOf(
        project,
        SpanKind.Producer,
        kafkaTopic("archive", "send"),
      );
      const send: FixtureAttributes = kafkaTopic("audit", "send");
      const base: Pick<
        InsertedSpan,
        "projectId" | "kind" | "attributes" | "entityKeys"
      > = {
        projectId: project.id,
        kind: SpanKind.Producer,
        attributes: send,
        entityKeys: [audit],
      };
      // Counted: both ends of the window are in it.
      addSpan({ ...base, startMs: WINDOW_START.getTime() });
      addSpan({ ...base, startMs: WINDOW_END.getTime() });
      // Counted once: a key of no queue beside the queue's.
      addSpan({ ...base, entityKeys: ["fedcba9876543210", audit] });
      // Counted under each of the project's queues it carries.
      addSpan({ ...base, entityKeys: [audit, ledger], failed: true });
      // Counted on the queue, on no line: no service recorded it.
      addSpan({ ...base, serviceId: "" });
      // Not counted: outside the window, past retention, another project's.
      addSpan({ ...base, startMs: WINDOW_START.getTime() - 1000 });
      addSpan({ ...base, startMs: WINDOW_END.getTime() + 1000 });
      addSpan({ ...base, expired: true });
      addSpan({ ...base, projectId: STRAY_PROJECT_ID });
      addSpan({
        ...base,
        attributes: kafkaTopic("archive", "send"),
        entityKeys: [archive],
        startMs: WINDOW_START.getTime() - 10 * MINUTE_MS,
      });
      addSpans(project, {
        kind: SpanKind.Consumer,
        attributes: kafkaTopic("audit", "process"),
        service: FULFILMENT,
        durationsMs: [5],
        copies: 3,
      });
    },
  },
];

// The core's whole corpus: every shape from several services, some failing.
function fillCorpus(project: Project): void {
  const random: SeededRandom = seededRandom(61891);
  for (const spanFixture of SPAN_FIXTURES) {
    // An OTLP span without a kind is stored as INTERNAL.
    const kind: string = spanFixture.kind || SpanKind.Internal;
    if (stamp(project.id, kind, spanFixture.attributes).length !== 1) {
      continue;
    }
    for (const service of SERVICES) {
      if (random(2) === 0) {
        continue;
      }
      const durationsMs: Array<number> = [];
      const durations: number = 1 + random(3);
      for (let index: number = 0; index < durations; index++) {
        // Microseconds apart, as spans are timed.
        durationsMs.push((1 + random(500_000)) / 1000);
      }
      addSpans(project, {
        kind: kind,
        attributes: spanFixture.attributes,
        service: service,
        durationsMs: durationsMs,
        copies: 1 + random(4),
      });
      if (random(4) === 0) {
        const failed: number = 1 + random(3);
        addSpans(project, {
          kind: kind,
          attributes: spanFixture.attributes,
          service: service,
          durationsMs: [(1 + random(500_000)) / 1000],
          copies: failed,
          failed: failed,
        });
      }
    }
  }
}

integration("The Queues topology's read against ClickHouse", () => {
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

  const projects: Map<string, Project> = new Map<string, Project>();
  let corpus: Project;

  function projectOf(name: string): Project {
    const project: Project | undefined = projects.get(name);
    if (!project) {
      throw new Error(`No project for "${name}"`);
    }
    return project;
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

    for (const [id, name] of SERVICE_NAMES) {
      mockServiceNames.set(id, name);
    }

    for (const [index, scenario] of SCENARIOS.entries()) {
      const project: Project = newProject(index);
      scenario.fill(project);
      projects.set(scenario.name, project);
    }
    corpus = newProject(SCENARIOS.length);
    fillCorpus(corpus);

    for (const project of [...projects.values(), corpus]) {
      mockQueueRowsByProject.set(
        project.id,
        Array.from(project.queues.values()),
      );
    }

    const model: Span = new Span();
    await client.insert({
      table: `${database}.${model.tableName}`,
      values: insertRows(insertedSpans),
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

  test("ClickHouse's quantile is the interpolation the read's twin is told", async (): Promise<void> => {
    const random: SeededRandom = seededRandom(6189);
    const samples: Array<Array<number>> = [
      [7],
      [5, 9],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [4_000_000, 4_250_000, 7_500_000, 12_125_000, 40_000_000],
    ];
    for (let draw: number = 0; draw < 40; draw++) {
      const values: Array<number> = [];
      const length: number = 1 + random(300);
      for (let index: number = 0; index < length; index++) {
        values.push((1 + random(4_000_000_000)) * (1 + random(10)));
      }
      samples.push(values);
    }
    const tuples: string = samples
      .flatMap((values: Array<number>, id: number): Array<string> => {
        return values.map((value: number): string => {
          return `(${id}, ${value})`;
        });
      })
      .join(", ");

    const result: Results = await SpanService.executeQuery(
      `SELECT id, quantile(0.95)(toInt128(value)) AS p95 FROM (SELECT tupleElement(pair, 1) AS id, tupleElement(pair, 2) AS value FROM (SELECT arrayJoin([${tuples}]) AS pair)) GROUP BY id ORDER BY id`,
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    expect(
      (response.data || []).map((row: JSONObject): number => {
        return Number(row["p95"]);
      }),
    ).toEqual(samples.map(clickhouseP95));
  });

  test.each(
    SCENARIOS.map((scenario: Scenario): [string] => {
      return [scenario.name];
    }),
  )(
    "%s: the map says what each queue's Overview says",
    async (name: string): Promise<void> => {
      const project: Project = projectOf(name);
      const scenario: Scenario = SCENARIOS.find(
        (candidate: Scenario): boolean => {
          return candidate.name === name;
        },
      )!;
      if (scenario.queues !== undefined) {
        expect(project.queues.size).toBe(scenario.queues);
      }

      const map: MessageQueueTopologyResponse = await topologyOf(project);

      expect(await expectMapToBeTheOverviews(project, map)).toBe(
        project.queues.size,
      );
      expect(map.startTime).toBe(WINDOW_START.toISOString());
      expect(map.endTime).toBe(WINDOW_END.toISOString());
      expect(map.truncation).toEqual({ queues: false, flows: false });
    },
  );

  test.each(
    SCENARIOS.map((scenario: Scenario): [string] => {
      return [scenario.name];
    }),
  )(
    "%s: the read's rows are its twin's, in order, p95s included",
    async (name: string): Promise<void> => {
      const project: Project = projectOf(name);
      const rows: Array<MessageQueueTopologyPairRow> =
        await readOnClickhouse(project);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows).toEqual(readByTwin(project));
    },
  );

  test("the edges, in numbers: what is counted and what is left out", async (): Promise<void> => {
    const project: Project = projectOf(EDGES);
    const map: MessageQueueTopologyResponse = await topologyOf(project);
    const byName: (name: string) => MessageQueueTopologyQueue = (
      name: string,
    ): MessageQueueTopologyQueue => {
      return map.queues.find((queue: MessageQueueTopologyQueue): boolean => {
        return queue.destinationName === name;
      })!;
    };

    // Both ends, the one with another key, the one with two queue keys, the
    // service-less one; and the three consumes.
    expect(byName("audit")).toMatchObject({
      spans: 8,
      errors: 1,
      published: 5,
      consumed: 3,
    });
    expect(flowRows(linesOf(map, byName("audit").id, "publish"))).toEqual([
      [CHECKOUT, 4, 1, 25, 3],
    ]);
    expect(flowRows(linesOf(map, byName("audit").id, "consume"))).toEqual([
      [FULFILMENT, 3, 0, 0, 5],
    ]);
    // The span with both keys is the ledger's too.
    expect(byName("ledger")).toMatchObject({
      spans: 1,
      errors: 1,
      published: 1,
      consumed: 0,
    });
    // Listed with nothing on it: its only span is before the window.
    expect(byName("archive")).toMatchObject({
      spans: 0,
      errors: 0,
      published: 0,
      consumed: 0,
    });
    expect(
      map.flows.filter((flow: MessageQueueTopologyFlow): boolean => {
        return flow.queueId === byName("archive").id;
      }),
    ).toEqual([]);
    // No line, no listing, for spans no service recorded.
    expect(
      map.services.map((service: MessageQueueTopologyServiceEntry): string => {
        return service.id;
      }),
    ).not.toContain("");
  });

  test("the services are named as the caller may read them, and listed unnamed otherwise", async (): Promise<void> => {
    const map: MessageQueueTopologyResponse = await topologyOf(
      projectOf(SCENARIOS[1]!.name),
    );
    const names: Map<string, string> = new Map<string, string>(
      map.services.map(
        (service: MessageQueueTopologyServiceEntry): [string, string] => {
          return [service.id, service.name];
        },
      ),
    );
    expect(names).toEqual(
      new Map<string, string>([
        [CHECKOUT, "checkout"],
        [BILLING, "billing"],
        [FULFILMENT, "fulfilment"],
        [NOTIFIER, ""],
      ]),
    );
  });

  test("the read scope: only the services the caller may read, either way, on the map as in the rows", async (): Promise<void> => {
    const filters: Array<[TelemetryServiceFilter, Array<string>]> = [
      [
        { serviceIds: [new ObjectID(CHECKOUT), new ObjectID(FULFILMENT)] },
        [CHECKOUT, FULFILMENT],
      ],
      [
        { excludedServiceIds: [new ObjectID(BILLING)] },
        [CHECKOUT, FULFILMENT, NOTIFIER],
      ],
      [
        {
          serviceIds: [new ObjectID(CHECKOUT), new ObjectID(BILLING)],
          excludedServiceIds: [new ObjectID(BILLING)],
        },
        [CHECKOUT],
      ],
    ];

    for (const [serviceFilter, readable] of filters) {
      const rows: Array<MessageQueueTopologyPairRow> = await readOnClickhouse(
        corpus,
        { serviceFilter },
      );
      expect(rows).toEqual(readByTwin(corpus, { serviceFilter }));
      expect(
        Array.from(
          new Set(
            rows.map((row: MessageQueueTopologyPairRow): string => {
              return row.serviceId;
            }),
          ),
        ).sort(),
      ).toEqual([...readable].sort());

      const map: MessageQueueTopologyResponse = await topologyOf(
        corpus,
        serviceFilter,
      );
      for (const flow of map.flows) {
        expect(readable).toContain(flow.serviceId);
      }
      // A queue's figures are the readable services' spans alone.
      const keys: MessageQueueTopologyKeys = keysOf(corpus);
      for (const queue of map.queues) {
        const spans: number = rows
          .filter((row: MessageQueueTopologyPairRow): boolean => {
            return keys.queueIdByKey.get(row.queueKey) === queue.id;
          })
          .reduce((total: number, row: MessageQueueTopologyPairRow) => {
            return total + row.spans;
          }, 0);
        expect({ queue: queue.queueIdentifier, spans: queue.spans }).toEqual({
          queue: queue.queueIdentifier,
          spans,
        });
      }
    }
  });

  test("busiest first: a row limit keeps the twin's first rows", async (): Promise<void> => {
    const all: Array<MessageQueueTopologyPairRow> =
      await readOnClickhouse(corpus);
    expect(all.length).toBeGreaterThan(20);

    for (const rowLimit of [1, 5, all.length - 1]) {
      const rows: Array<MessageQueueTopologyPairRow> = await readOnClickhouse(
        corpus,
        { rowLimit },
      );
      expect(rows).toHaveLength(rowLimit);
      expect(rows).toEqual(all.slice(0, rowLimit));
      expect(rows).toEqual(readByTwin(corpus, { rowLimit }));
    }
  });

  test("the whole corpus: the map says what every queue's Overview says", async (): Promise<void> => {
    expect(corpus.queues.size).toBeGreaterThan(20);
    const map: MessageQueueTopologyResponse = await topologyOf(corpus);

    expect(await expectMapToBeTheOverviews(corpus, map)).toBe(
      corpus.queues.size,
    );
    // The queues' spans are every corpus span: each carries one queue key.
    const corpusSpans: number = insertedSpans.filter(
      (span: InsertedSpan): boolean => {
        return span.projectId === corpus.id;
      },
    ).length;
    expect(
      map.queues.reduce(
        (total: number, queue: MessageQueueTopologyQueue): number => {
          return total + queue.spans;
        },
        0,
      ),
    ).toBe(corpusSpans);
  });

  test("the whole corpus: the read's rows are its twin's, in order, p95s included", async (): Promise<void> => {
    const rows: Array<MessageQueueTopologyPairRow> =
      await readOnClickhouse(corpus);
    expect(rows).toEqual(readByTwin(corpus));
    // Interpolated p95s, most of them no whole number of milliseconds.
    const p95s: Array<number> = rows.flatMap(
      (row: MessageQueueTopologyPairRow): Array<number> => {
        return Object.values(row.groups)
          .map((group: { p95Ms: number | null }): number | null => {
            return group.p95Ms;
          })
          .filter((p95: number | null): p95 is number => {
            return p95 !== null;
          });
      },
    );
    expect(p95s.length).toBeGreaterThan(20);
    expect(
      p95s.filter((p95: number): boolean => {
        return !Number.isInteger(p95);
      }).length,
    ).toBeGreaterThan(p95s.length / 2);
  });

  test("the answer reaches the dashboard whole: its decoder keeps every figure", async (): Promise<void> => {
    const map: MessageQueueTopologyResponse = await topologyOf(corpus);
    expect(map.flows.length).toBeGreaterThan(20);
    expect(
      readMessageQueueTopologyResponse(JSON.parse(JSON.stringify(map))),
    ).toEqual(map);
  });
});

describe("The Queues topology's ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
