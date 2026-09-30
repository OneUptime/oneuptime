/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService, {
  LoadedTracePipeline,
} from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import TracePipelineProcessorType, {
  SpanKindRemapperConfig,
} from "Common/Types/Trace/TracePipelineProcessorType";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import * as MessagingTelemetryResolverModule from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import { MESSAGING_RESOLVER_INPUT_ATTRIBUTES } from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  DiscoveredMessageQueue,
  MessagingSpanDiscoveryRow,
  getMessagingDiscoveryColumn,
  resolveMessagingSpanDiscoveryRows,
} from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  toStoredColumns,
  toStoredKind,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import {
  MessageQueueIdentity,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import * as EntityKeyModule from "Common/Utils/Telemetry/EntityKey";
import {
  keyForDatabaseEndpoint,
  keyForMessageQueue,
} from "Common/Utils/Telemetry/EntityKey";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The ingest side of the Queues product, through the real service methods:
 * a messaging span (any kind but SERVER) and a broker or messaging-client
 * datapoint get their queue's key appended to their OWN entityKeys, the way
 * a database call gets its database's (DatabaseCallEntityKeys.test.ts, whose
 * harness this suite follows). Pinned here:
 *
 *   - the key is computed from the FINAL row — after drop filter, scrub
 *     rules and pipeline for spans, after the metric pipeline rules for
 *     datapoints (a rename or a redaction decides);
 *   - it is added as a NEW array: the row's entityKeys is, until then, the
 *     resource's shared array — sibling rows, exception rows and the
 *     resource metadata itself must never see another row's queue;
 *   - datapoints are read from the flattened STORED attribute map: resource
 *     attributes `resource.`-prefixed (the rabbitmq receiver's per-queue
 *     resource, Pub/Sub's monitored resource), kvlists flattened
 *     (CloudWatch's `Dimensions.QueueName`);
 *   - the Azure SDK's `messaging.servicebus.*` metrics, which carry no
 *     `messaging.system`, are keyed by their name;
 *   - rows that are not about a queue cost no resolver work, and one
 *     request resolves each distinct queue once;
 *   - the golden row shape (field order) is unchanged, and the stamp sits
 *     right after the database stamp in both services.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "orders-api";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const START_MS: number = Date.UTC(2026, 8, 30, 10, 0, 0, 0);
const START_NANO: string = `${START_MS}000000`;
const END_NANO: string = `${START_MS + 25}000000`;

// Resource-level keys the resolver stamped (service, host, …).
const RESOURCE_KEYS: Array<string> = ["0123456789abcdef", "fedcba9876543210"];

const SERVICE_BUS_HOST: string = "orders-prod.servicebus.windows.net";

function queueKey(
  system: string,
  destination: string,
  brokerScope: string = "",
): string {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: system,
    brokerScope: brokerScope,
    destination: destination,
  });
  if (!identity) {
    throw new Error(`Not a queue identity: ${system}|${destination}`);
  }
  return keyForMessageQueue(PROJECT_ID.toString(), identity);
}

const KAFKA_ORDERS_KEY: string = queueKey("kafka", "orders");
const KAFKA_PAYMENTS_KEY: string = queueKey("kafka", "payments");

const EXPECTED_SPAN_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "startTime",
  "endTime",
  "startTimeUnixNano",
  "endTimeUnixNano",
  "durationUnixNano",
  "traceId",
  "spanId",
  "sessionId",
  "parentSpanId",
  "traceState",
  "attributes",
  "attributeKeys",
  "statusCode",
  "statusMessage",
  "name",
  "kind",
  "events",
  "links",
  "hasException",
  "isRootSpan",
  "isLlmSpan",
  "llmSystem",
  "llmOperation",
  "llmRequestModel",
  "llmResponseModel",
  "llmAgentName",
  "llmToolName",
  "llmInputTokens",
  "llmOutputTokens",
  "llmTotalTokens",
  "llmCost",
  "llmConversationId",
  "llmUserId",
  "llmUserEmail",
  "llmTeam",
  "retentionDate",
];

const EXPECTED_METRIC_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "name",
  "time",
  "timeUnixNano",
  "metricPointType",
  "aggregationTemporality",
  "isMonotonic",
  "attributes",
  "attributeKeys",
  "value",
  "count",
  "sum",
  "min",
  "max",
  "bucketCounts",
  "explicitBounds",
  "scale",
  "zeroCount",
  "positiveOffset",
  "positiveBucketCounts",
  "negativeOffset",
  "negativeBucketCounts",
  "summaryQuantiles",
  "summaryValues",
  "traceId",
  "spanId",
  "retentionDate",
  "startTime",
  "startTimeUnixNano",
];

type OtlpAttribute = {
  key: string;
  value: JSONObject;
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: value } };
}

function boolAttribute(key: string, value: boolean): OtlpAttribute {
  return { key: key, value: { boolValue: value } };
}

function kvlistAttribute(
  key: string,
  values: Array<OtlpAttribute>,
): OtlpAttribute {
  return {
    key: key,
    value: { kvlistValue: { values: values } } as unknown as JSONObject,
  };
}

/*
 * Every resource's metadata the mocked resolver handed out, in order. Each
 * one's entityKeys array is THE shared array every row of that resource
 * starts out pointing at.
 */
let issuedMetadata: Array<TelemetryServiceMetadata> = [];

function applicationMetadata(): TelemetryServiceMetadata {
  const metadata: TelemetryServiceMetadata = {
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    entityKeys: [...RESOURCE_KEYS],
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
  issuedMetadata.push(metadata);
  return metadata;
}

function onlyMetadata(): TelemetryServiceMetadata {
  expect(issuedMetadata).toHaveLength(1);
  return issuedMetadata[0]!;
}

function expectEveryResourceArrayUntouched(): void {
  expect(issuedMetadata.length).toBeGreaterThan(0);
  for (const metadata of issuedMetadata) {
    expect(metadata.entityKeys).toEqual(RESOURCE_KEYS);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
  issuedMetadata = [];
});

/*
 * ---- Traces pillar ----------------------------------------------------------
 */

const TRACE_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type SpanInput = {
  spanId: string;
  name: string;
  kind: number;
  attributes: Array<OtlpAttribute>;
  events?: Array<JSONObject>;
};

type CapturedTraceRows = {
  spans: Array<JSONObject>;
  exceptions: Array<JSONObject>;
};

function setupTraceMocks(): CapturedTraceRows {
  const captured: CapturedTraceRows = { spans: [], exceptions: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of TRACE_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return applicationMetadata();
    });

  jest
    .spyOn(service, "submitSpansBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.spans.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.exceptions.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return captured;
}

type ResourceSpansInput = {
  resourceAttributes?: Array<OtlpAttribute>;
  spans: Array<SpanInput>;
};

function tracesRequest(resources: Array<ResourceSpansInput>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: resources.map(
        (resource: ResourceSpansInput): JSONObject => {
          return {
            resource: {
              attributes: [
                stringAttribute("service.name", SERVICE_NAME),
                ...(resource.resourceAttributes || []),
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: "io.opentelemetry.kafka-clients",
                  version: "2.9.0",
                },
                spans: resource.spans.map((span: SpanInput): JSONObject => {
                  return {
                    traceId: TRACE_ID_HEX,
                    spanId: span.spanId,
                    parentSpanId: "",
                    name: span.name,
                    kind: span.kind,
                    startTimeUnixNano: START_NANO,
                    endTimeUnixNano: END_NANO,
                    status: { code: 0 },
                    attributes: span.attributes,
                    events: span.events || [],
                    links: [],
                  } as unknown as JSONObject;
                }),
              },
            ],
          } as unknown as JSONObject;
        },
      ),
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function spanById(rows: Array<JSONObject>, spanId: string): JSONObject {
  const row: JSONObject | undefined = rows.find((r: JSONObject) => {
    return r["spanId"] === spanId;
  });
  expect(row).toBeDefined();
  return row!;
}

// OTLP kinds on the wire.
const INTERNAL_KIND: number = 1;
const SERVER_KIND: number = 2;
const CLIENT_KIND: number = 3;
const PRODUCER_KIND: number = 4;
const CONSUMER_KIND: number = 5;

const PRODUCER_SPAN_ID: string = "a1b2c3d4e5f60718";
const CONSUMER_SPAN_ID: string = "b2c3d4e5f6071829";
const SERVER_SPAN_ID: string = "c3d4e5f60718293a";
const CLIENT_SPAN_ID: string = "d4e5f60718293a4b";

const KAFKA_SEND_ORDERS: Array<OtlpAttribute> = [
  stringAttribute("messaging.system", "kafka"),
  stringAttribute("messaging.destination.name", "orders"),
  stringAttribute("messaging.operation", "publish"),
  stringAttribute("messaging.client_id", "producer-1"),
  stringAttribute("messaging.destination.partition.id", "3"),
];

const KAFKA_PROCESS_PAYMENTS: Array<OtlpAttribute> = [
  stringAttribute("messaging.system", "kafka"),
  stringAttribute("messaging.destination.name", "payments"),
  stringAttribute("messaging.operation", "process"),
  stringAttribute("messaging.kafka.consumer.group", "billing"),
  intAttribute("messaging.kafka.message.offset", 1042),
];

describe("traces: per-span queue keys", () => {
  test("producer, consumer and server spans on one resource: only the messaging spans carry their queue's key, and the shared array is untouched", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: SERVER_SPAN_ID,
              name: "POST /orders",
              kind: SERVER_KIND,
              attributes: [stringAttribute("http.request.method", "POST")],
            },
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
            {
              spanId: CONSUMER_SPAN_ID,
              name: "payments process",
              kind: CONSUMER_KIND,
              attributes: KAFKA_PROCESS_PAYMENTS,
            },
          ],
        },
      ]),
    );

    expect(captured.spans).toHaveLength(3);
    const metadata: TelemetryServiceMetadata = onlyMetadata();
    const serverRow: JSONObject = spanById(captured.spans, SERVER_SPAN_ID);
    const producerRow: JSONObject = spanById(captured.spans, PRODUCER_SPAN_ID);
    const consumerRow: JSONObject = spanById(captured.spans, CONSUMER_SPAN_ID);

    expect(producerRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_ORDERS_KEY,
    ]);
    expect(consumerRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_PAYMENTS_KEY,
    ]);
    expect(serverRow["entityKeys"]).toBe(metadata.entityKeys);

    // Each keyed row got its own array; the resource's was never pushed to.
    expect(producerRow["entityKeys"]).not.toBe(metadata.entityKeys);
    expect(consumerRow["entityKeys"]).not.toBe(metadata.entityKeys);
    expect(producerRow["entityKeys"]).not.toBe(consumerRow["entityKeys"]);
    expectEveryResourceArrayUntouched();
  });

  test("the keyed row keeps the golden field order", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
          ],
        },
      ]),
    );

    const row: JSONObject = spanById(captured.spans, PRODUCER_SPAN_ID);
    expect(Object.keys(row)).toEqual(EXPECTED_SPAN_ROW_KEY_ORDER);
    expect(row["kind"]).toBe(SpanKind.Producer);
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
  });

  test("CLIENT and INTERNAL messaging spans are keyed too: an AWS SDK SQS call without messaging.system, a kind-less batch process", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: CLIENT_SPAN_ID,
              name: "SQS.SendMessage",
              kind: CLIENT_KIND,
              attributes: [
                stringAttribute("rpc.system", "aws-api"),
                stringAttribute("rpc.service", "SQS"),
                stringAttribute("rpc.method", "SendMessage"),
                stringAttribute(
                  "aws.queue_url",
                  "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
                ),
              ],
            },
            {
              spanId: CONSUMER_SPAN_ID,
              name: "orders process",
              kind: INTERNAL_KIND,
              attributes: [
                stringAttribute("messaging.system", "rabbitmq"),
                stringAttribute("messaging.destination.name", "orders"),
                stringAttribute("messaging.operation", "process"),
              ],
            },
          ],
        },
      ]),
    );

    expect(spanById(captured.spans, CLIENT_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("aws_sqs", "orders"),
    ]);
    expect(spanById(captured.spans, CONSUMER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("rabbitmq", "orders"),
    ]);
    expectEveryResourceArrayUntouched();
  });

  test("the .NET Azure SDK's Service Bus send keys the namespace-scoped queue — the one Azure Monitor's metrics key", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "ServiceBusSender.Send",
              kind: PRODUCER_KIND,
              attributes: [
                stringAttribute("az.namespace", "Microsoft.ServiceBus"),
                stringAttribute("messaging.system", "servicebus"),
                stringAttribute("messaging.destination.name", "orders"),
                stringAttribute("messaging.operation.type", "send"),
                stringAttribute("server.address", SERVICE_BUS_HOST),
              ],
            },
          ],
        },
      ]),
    );

    expect(spanById(captured.spans, PRODUCER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("servicebus", "orders", "orders-prod"),
    ]);
  });

  test.each<[string, number, Array<OtlpAttribute>, Array<OtlpAttribute>]>([
    [
      "a SERVER span with messaging attributes",
      SERVER_KIND,
      KAFKA_SEND_ORDERS,
      [],
    ],
    [
      "an HTTP CLIENT span",
      CLIENT_KIND,
      [
        stringAttribute("http.request.method", "GET"),
        stringAttribute("server.address", "inventory.example.com"),
      ],
      [],
    ],
    [
      "a span whose only messaging attribute is on its RESOURCE",
      PRODUCER_KIND,
      [stringAttribute("http.request.method", "GET")],
      [
        stringAttribute("messaging.system", "kafka"),
        stringAttribute("messaging.destination.name", "orders"),
      ],
    ],
    [
      "a RabbitMQ server-named reply queue",
      CONSUMER_KIND,
      [
        stringAttribute("messaging.system", "rabbitmq"),
        stringAttribute(
          "messaging.destination.name",
          "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
        ),
      ],
      [],
    ],
    [
      "a temporary destination flag",
      CONSUMER_KIND,
      [
        stringAttribute("messaging.system", "rabbitmq"),
        stringAttribute("messaging.destination.name", "rpc-replies"),
        boolAttribute("messaging.destination.temporary", true),
      ],
      [],
    ],
    [
      "in-process Spring Integration channels",
      PRODUCER_KIND,
      [
        stringAttribute("messaging.system", "spring_integration"),
        stringAttribute("messaging.destination.name", "inputChannel"),
      ],
      [],
    ],
  ])(
    "no key for %s",
    async (
      _label: string,
      kind: number,
      spanAttributes: Array<OtlpAttribute>,
      resourceAttributes: Array<OtlpAttribute>,
    ) => {
      const captured: CapturedTraceRows = setupTraceMocks();

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest([
          {
            resourceAttributes: resourceAttributes,
            spans: [
              {
                spanId: CLIENT_SPAN_ID,
                name: "work",
                kind: kind,
                attributes: spanAttributes,
              },
            ],
          },
        ]),
      );

      const row: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
      expect(row["entityKeys"]).toBe(onlyMetadata().entityKeys);
      expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
    },
  );

  test("spans that are not messaging cost no resolver or key work", async () => {
    setupTraceMocks();
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: CLIENT_SPAN_ID,
              name: "GET /inventory",
              kind: CLIENT_KIND,
              attributes: [
                stringAttribute("server.address", "inventory.example.com"),
              ],
            },
            {
              spanId: SERVER_SPAN_ID,
              name: "orders publish (served)",
              kind: SERVER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
            {
              spanId: PRODUCER_SPAN_ID,
              name: "compute",
              kind: INTERNAL_KIND,
              attributes: [stringAttribute("code.function.name", "compute")],
            },
          ],
        },
      ]),
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
  });

  test("an exception row on a messaging span keeps the resource's keys", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: CONSUMER_SPAN_ID,
              name: "payments process",
              kind: CONSUMER_KIND,
              attributes: KAFKA_PROCESS_PAYMENTS,
              events: [
                {
                  timeUnixNano: START_NANO,
                  name: "exception",
                  attributes: [
                    stringAttribute(
                      "exception.type",
                      "PaymentDeclinedException",
                    ),
                    stringAttribute("exception.message", "card declined"),
                    stringAttribute(
                      "exception.stacktrace",
                      "PaymentDeclinedException: card declined\n    at Billing.charge(Billing.java:10)",
                    ),
                  ],
                } as unknown as JSONObject,
              ],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = spanById(captured.spans, CONSUMER_SPAN_ID);
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_PAYMENTS_KEY]);

    expect(captured.exceptions).toHaveLength(1);
    expect(captured.exceptions[0]!["entityKeys"]).toEqual(RESOURCE_KEYS);
    expect(captured.exceptions[0]!["entityKeys"]).toBe(
      onlyMetadata().entityKeys,
    );
  });

  test("a scrubbed destination yields no key (the FINAL row decides)", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceScrubRuleService, "scrubSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        return {
          ...row,
          attributes: {
            ...(row["attributes"] as JSONObject),
            "messaging.destination.name": "[REDACTED]",
          },
        };
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
          ],
        },
      ]),
    );

    const row: JSONObject = spanById(captured.spans, PRODUCER_SPAN_ID);
    expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
  });

  test("a pipeline that rewrites the destination keys the rewritten queue", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        (row["attributes"] as JSONObject)["messaging.destination.name"] =
          "orders-v2";
        return row;
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
          ],
        },
      ]),
    );

    expect(spanById(captured.spans, PRODUCER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("kafka", "orders-v2"),
    ]);
  });

  test('a Span Kind Remapper that writes a number: the stamper reads it as the cron will read the stored text, so 2, "2" and "02" key nothing', async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    /*
     * The real remapper, as a configuration saved through the API holds it:
     * the mapping's kind is any JSON, and it is written to the row as it is.
     * Each Kafka topic below is remapped to its own kind.
     */
    const cases: Array<{
      topic: string;
      kind: number | string;
      keyed: boolean;
    }> = [
      { topic: "server-by-number", kind: 2, keyed: false },
      { topic: "server-by-digits", kind: "2", keyed: false },
      { topic: "server-by-zero-padded-digits", kind: "02", keyed: false },
      { topic: "producer-by-number", kind: 4, keyed: true },
      { topic: "consumer-by-digits", kind: "5", keyed: true },
      { topic: "no-kind-by-number", kind: 9, keyed: true },
    ];
    const config: SpanKindRemapperConfig = {
      sourceKey: "messaging.destination.name",
      mappings: cases.map(
        (entry: {
          topic: string;
          kind: number | string;
        }): { matchValue: string; kind: string } => {
          return { matchValue: entry.topic, kind: entry.kind as string };
        },
      ),
    };
    const processor: TracePipelineProcessor = new TracePipelineProcessor();
    processor.name = "Remap the span kind";
    processor.processorType = TracePipelineProcessorType.SpanKindRemapper;
    processor.configuration = config as unknown as JSONObject;
    processor.isEnabled = true;
    const pipeline: TracePipeline = new TracePipeline();
    pipeline.name = "Messaging spans";
    pipeline.isEnabled = true;
    const pipelines: Array<LoadedTracePipeline> = [
      {
        pipeline: pipeline,
        compiledFilter: compileFilter(""),
        processors: [processor],
      },
    ];
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      .mockResolvedValue(pipelines);

    const spanIdOf: (index: number) => string = (index: number): string => {
      return `e5f60718293a4b${String(index).padStart(2, "0")}`;
    };

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: cases.map(
            (entry: { topic: string }, index: number): SpanInput => {
              return {
                spanId: spanIdOf(index),
                name: `${entry.topic} publish`,
                kind: PRODUCER_KIND,
                attributes: [
                  stringAttribute("messaging.system", "kafka"),
                  stringAttribute("messaging.destination.name", entry.topic),
                ],
              };
            },
          ),
        },
      ]),
    );

    cases.forEach(
      (
        entry: { topic: string; kind: number | string; keyed: boolean },
        index: number,
      ): void => {
        const row: JSONObject = spanById(captured.spans, spanIdOf(index));
        const key: string = queueKey("kafka", entry.topic);

        // The stamper saw — and the insert carries — the kind as written.
        expect(row["kind"]).toBe(entry.kind);
        expect({ topic: entry.topic, entityKeys: row["entityKeys"] }).toEqual({
          topic: entry.topic,
          entityKeys: entry.keyed ? [...RESOURCE_KEYS, key] : RESOURCE_KEYS,
        });

        /*
         * The discovery cron reads the row back with the kind column's text
         * (2 is stored "2") and lands on exactly the key ingest stamped.
         */
        const stored: Record<string, string> = toStoredColumns(
          row["attributes"] as JSONObject,
          MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
        );
        const queryRow: MessagingSpanDiscoveryRow = {
          kind: toStoredKind(row["kind"]),
          spanCount: "1",
          errorCount: "0",
          lastSeenUnixMs: String(START_MS),
        };
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES.forEach(
          (attribute: string, column: number): void => {
            queryRow[getMessagingDiscoveryColumn(column)] = stored[attribute];
          },
        );
        expect({
          topic: entry.topic,
          discovered: resolveMessagingSpanDiscoveryRows([queryRow]).map(
            (queue: DiscoveredMessageQueue): string => {
              return keyForMessageQueue(PROJECT_ID.toString(), queue.identity);
            },
          ),
        }).toEqual({
          topic: entry.topic,
          discovered: entry.keyed ? [key] : [],
        });
      },
    );
    expectEveryResourceArrayUntouched();
  });

  test("a dropped span is never resolved; its surviving siblings are keyed", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceDropFilterService, "shouldDropSpan")
      .mockImplementation((row: JSONObject): boolean => {
        return (
          (row["attributes"] as JSONObject)["messaging.destination.name"] ===
          "orders"
        );
      });
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
            {
              spanId: CONSUMER_SPAN_ID,
              name: "payments process",
              kind: CONSUMER_KIND,
              attributes: KAFKA_PROCESS_PAYMENTS,
            },
          ],
        },
      ]),
    );

    expect(captured.spans).toHaveLength(1);
    expect(spanById(captured.spans, CONSUMER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_PAYMENTS_KEY,
    ]);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  test("many spans to two queues: each span keyed by ITS queue, each queue resolved once per request", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );

    const spans: Array<SpanInput> = [];
    for (let i: number = 0; i < 30; i++) {
      spans.push({
        spanId: `${i.toString(16).padStart(2, "0")}c3d4e5f6071829`,
        name: i % 2 === 0 ? "orders publish" : "payments process",
        kind: i % 2 === 0 ? PRODUCER_KIND : CONSUMER_KIND,
        attributes: [
          ...(i % 2 === 0 ? KAFKA_SEND_ORDERS : KAFKA_PROCESS_PAYMENTS),
          stringAttribute("messaging.message.id", `message-${i}`),
        ],
      });
    }

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([{ spans: spans }]),
    );

    expect(captured.spans).toHaveLength(30);
    for (const row of captured.spans) {
      const expected: string =
        (row["attributes"] as JSONObject)["messaging.destination.name"] ===
        "orders"
          ? KAFKA_ORDERS_KEY
          : KAFKA_PAYMENTS_KEY;
      expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, expected]);
    }
    expect(keySpy).toHaveBeenCalledTimes(2);
    expectEveryResourceArrayUntouched();
  });

  test("two resources in one request: each keeps its own shared array untouched", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          resourceAttributes: [stringAttribute("service.instance.id", "a")],
          spans: [
            {
              spanId: PRODUCER_SPAN_ID,
              name: "orders publish",
              kind: PRODUCER_KIND,
              attributes: KAFKA_SEND_ORDERS,
            },
            {
              spanId: SERVER_SPAN_ID,
              name: "POST /orders",
              kind: SERVER_KIND,
              attributes: [],
            },
          ],
        },
        {
          resourceAttributes: [stringAttribute("service.instance.id", "b")],
          spans: [
            {
              spanId: CONSUMER_SPAN_ID,
              name: "payments process",
              kind: CONSUMER_KIND,
              attributes: KAFKA_PROCESS_PAYMENTS,
            },
          ],
        },
      ]),
    );

    expect(issuedMetadata).toHaveLength(2);
    expect(spanById(captured.spans, PRODUCER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_ORDERS_KEY,
    ]);
    expect(spanById(captured.spans, CONSUMER_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_PAYMENTS_KEY,
    ]);
    expect(spanById(captured.spans, SERVER_SPAN_ID)["entityKeys"]).toBe(
      issuedMetadata[0]!.entityKeys,
    );
    expectEveryResourceArrayUntouched();
  });

  test("a CLIENT span that is both a database call and a messaging call carries both keys, database first", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          spans: [
            {
              spanId: CLIENT_SPAN_ID,
              name: "XADD orders",
              kind: CLIENT_KIND,
              attributes: [
                stringAttribute("db.system.name", "redis"),
                stringAttribute("server.address", "cache.example.com"),
                intAttribute("server.port", 6379),
                stringAttribute("messaging.system", "bullmq"),
                stringAttribute("messaging.destination.name", "orders"),
              ],
            },
          ],
        },
      ]),
    );

    expect(spanById(captured.spans, CLIENT_SPAN_ID)["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "cache.example.com",
        port: 6379,
      }),
      queueKey("bullmq", "orders"),
    ]);
    expectEveryResourceArrayUntouched();
  });
});

/*
 * ---- Metrics pillar ---------------------------------------------------------
 */

const METRIC_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type MetricShape = "gauge" | "sum" | "histogram";

type MetricInput = {
  name: string;
  shape?: MetricShape;
  datapoints: Array<Array<OtlpAttribute>>;
};

type ResourceMetricsInput = {
  resourceAttributes?: Array<OtlpAttribute>;
  metrics: Array<MetricInput>;
};

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function setupMetricMocks(rules: MetricRulesForProject): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });
  for (const method of METRIC_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return applicationMetadata();
    });
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(rules);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return rows;
}

function metricPayload(metric: MetricInput): JSONObject {
  const datapoints: Array<JSONObject> = metric.datapoints.map(
    (attributes: Array<OtlpAttribute>): JSONObject => {
      if (metric.shape === "histogram") {
        return {
          timeUnixNano: START_NANO,
          startTimeUnixNano: START_NANO,
          count: 3,
          sum: 0.012,
          bucketCounts: [3, 0],
          explicitBounds: [0.1],
          attributes: attributes,
        } as unknown as JSONObject;
      }
      return {
        timeUnixNano: START_NANO,
        startTimeUnixNano: START_NANO,
        asDouble: 42,
        attributes: attributes,
      } as unknown as JSONObject;
    },
  );

  if (metric.shape === "sum") {
    return {
      name: metric.name,
      unit: "{message}",
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: datapoints,
      },
    } as unknown as JSONObject;
  }
  if (metric.shape === "histogram") {
    return {
      name: metric.name,
      unit: "s",
      histogram: { aggregationTemporality: 2, dataPoints: datapoints },
    } as unknown as JSONObject;
  }
  return {
    name: metric.name,
    unit: "{message}",
    gauge: { dataPoints: datapoints },
  } as unknown as JSONObject;
}

function metricsRequest(
  resources: Array<ResourceMetricsInput>,
): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceMetrics: resources.map(
        (resource: ResourceMetricsInput): JSONObject => {
          return {
            resource: {
              attributes: [
                stringAttribute("service.name", SERVICE_NAME),
                ...(resource.resourceAttributes || []),
              ],
            },
            scopeMetrics: [
              {
                scope: {
                  name: "github.com/open-telemetry/opentelemetry-collector-contrib",
                  version: "0.161.0",
                },
                metrics: resource.metrics.map(metricPayload),
              },
            ],
          } as unknown as JSONObject;
        },
      ),
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function rowsNamed(rows: Array<JSONObject>, name: string): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return row["name"] === name;
  });
}

function lastKey(row: JSONObject): string | undefined {
  const keys: Array<string> = row["entityKeys"] as Array<string>;
  return keys[keys.length - 1];
}

describe("metrics: per-datapoint queue keys", () => {
  test("a broker metric datapoint carries its queue's key; a non-messaging metric with the same attributes does not", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("kafka.cluster.alias", "prod-kafka"),
          ],
          metrics: [
            {
              name: "kafka.consumer_group.lag_sum",
              datapoints: [
                [
                  stringAttribute("group", "billing"),
                  stringAttribute("topic", "orders"),
                ],
              ],
            },
            {
              name: "http.client.request.duration",
              shape: "histogram",
              datapoints: [
                [
                  stringAttribute("group", "billing"),
                  stringAttribute("topic", "orders"),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const lagRow: JSONObject = rowsNamed(
      rows,
      "kafka.consumer_group.lag_sum",
    )[0]!;
    const httpRow: JSONObject = rowsNamed(
      rows,
      "http.client.request.duration",
    )[0]!;
    const metadata: TelemetryServiceMetadata = onlyMetadata();

    expect(lagRow["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
    expect(lagRow["entityKeys"]).not.toBe(metadata.entityKeys);
    expect(httpRow["entityKeys"]).toBe(metadata.entityKeys);
    expectEveryResourceArrayUntouched();
  });

  test("the keyed metric row keeps the golden field order", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "kafka.consumer_group.lag_sum",
              datapoints: [[stringAttribute("topic", "orders")]],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "kafka.consumer_group.lag_sum")[0]!;
    expect(Object.keys(row)).toEqual(EXPECTED_METRIC_ROW_KEY_ORDER);
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
  });

  test("the rabbitmq receiver names its queue on the RESOURCE: read resource.-prefixed from the stored row, one key per queue resource", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    function rabbitQueue(queue: string): ResourceMetricsInput {
      return {
        resourceAttributes: [
          stringAttribute("rabbitmq.node.name", "rabbit@16c76f2d8aa2"),
          stringAttribute("rabbitmq.queue.name", queue),
          stringAttribute("rabbitmq.vhost.name", "/"),
        ],
        metrics: [
          {
            name: "rabbitmq.message.current",
            shape: "sum",
            datapoints: [
              [stringAttribute("state", "ready")],
              [stringAttribute("state", "unacknowledged")],
            ],
          },
          {
            name: "rabbitmq.consumer.count",
            shape: "sum",
            datapoints: [[]],
          },
        ],
      };
    }

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([rabbitQueue("orders"), rabbitQueue("payments")]),
    );

    const depth: Array<JSONObject> = rowsNamed(
      rows,
      "rabbitmq.message.current",
    );
    expect(depth).toHaveLength(4);
    for (const row of [
      ...depth,
      ...rowsNamed(rows, "rabbitmq.consumer.count"),
    ]) {
      const queue: unknown = (row["attributes"] as JSONObject)[
        "resource.rabbitmq.queue.name"
      ];
      expect(lastKey(row)).toBe(queueKey("rabbitmq", String(queue)));
    }
    expectEveryResourceArrayUntouched();
  });

  test("Pub/Sub's monitored resource names the subscription (resource.subscription_id)", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("gcp.resource_type", "pubsub_subscription"),
            stringAttribute("project_id", "acme-prod"),
            stringAttribute("subscription_id", "billing-sub"),
          ],
          metrics: [
            {
              name: "pubsub.googleapis.com/subscription/num_undelivered_messages",
              datapoints: [[]],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(
      rows,
      "pubsub.googleapis.com/subscription/num_undelivered_messages",
    )[0]!;
    expect(row["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("gcp_pubsub", "billing-sub"),
    ]);
  });

  test("CloudWatch's Dimensions kvlist is flattened to Dimensions.QueueName and keys the queue", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());
    const name: string =
      "amazonaws.com/AWS/SQS/ApproximateNumberOfMessagesVisible";

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("cloud.provider", "aws"),
            stringAttribute("cloud.region", "us-east-1"),
          ],
          metrics: [
            {
              name: name,
              datapoints: [
                [
                  stringAttribute("Namespace", "AWS/SQS"),
                  stringAttribute(
                    "MetricName",
                    "ApproximateNumberOfMessagesVisible",
                  ),
                  kvlistAttribute("Dimensions", [
                    stringAttribute("QueueName", "orders"),
                  ]),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, name.toLowerCase())[0]!;
    expect((row["attributes"] as JSONObject)["Dimensions.QueueName"]).toBe(
      "orders",
    );
    expect(row["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("aws_sqs", "orders"),
    ]);
  });

  test("Azure Monitor, in either dimension casing and any type casing, keys the namespace-scoped queue", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute(
              "azuremonitor.subscription_id",
              "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
            ),
          ],
          metrics: [
            {
              name: "azure_activemessages_average",
              datapoints: [
                [
                  stringAttribute("type", "Microsoft.ServiceBus/Namespaces"),
                  stringAttribute("name", "Orders-Prod"),
                  stringAttribute("metadata_entityname", "orders"),
                ],
                [
                  stringAttribute("type", "microsoft.servicebus/namespaces"),
                  stringAttribute("name", "orders-prod"),
                  stringAttribute("metadata_EntityName", "Orders"),
                ],
              ],
            },
            {
              name: "azure_incomingmessages_total",
              datapoints: [
                [
                  stringAttribute("type", "Microsoft.EventHub/namespaces"),
                  stringAttribute("name", "ingest-prod"),
                  stringAttribute("metadata_entityname", "telemetry"),
                ],
                [
                  stringAttribute("type", "Microsoft.ServiceBus/namespaces"),
                  stringAttribute("name", "orders-prod"),
                  stringAttribute(
                    "metadata_entityname",
                    "-NamespaceOnlyMetric-",
                  ),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const active: Array<JSONObject> = rowsNamed(
      rows,
      "azure_activemessages_average",
    );
    expect(active).toHaveLength(2);
    for (const row of active) {
      expect(row["entityKeys"]).toEqual([
        ...RESOURCE_KEYS,
        queueKey("servicebus", "orders", "orders-prod"),
      ]);
    }

    const incoming: Array<JSONObject> = rowsNamed(
      rows,
      "azure_incomingmessages_total",
    );
    expect(incoming).toHaveLength(2);
    const eventHub: JSONObject = incoming.find((row: JSONObject): boolean => {
      return (
        (row["attributes"] as JSONObject)["metadata_entityname"] === "telemetry"
      );
    })!;
    const namespaceOnly: JSONObject = incoming.find(
      (row: JSONObject): boolean => {
        return row !== eventHub;
      },
    )!;
    expect(eventHub["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("eventhubs", "telemetry", "ingest-prod"),
    ]);
    expect(namespaceOnly["entityKeys"]).toBe(onlyMetadata().entityKeys);
    expectEveryResourceArrayUntouched();
  });

  test("the Azure SDK's messaging.servicebus.* metrics carry no messaging.system and are keyed by their name", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("telemetry.sdk.language", "java"),
          ],
          metrics: [
            {
              name: "messaging.servicebus.messages.sent",
              shape: "sum",
              datapoints: [
                [
                  stringAttribute("server.address", SERVICE_BUS_HOST),
                  stringAttribute("messaging.destination.name", "orders"),
                  stringAttribute("messaging.servicebus.outcome", "success"),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(
      rows,
      "messaging.servicebus.messages.sent",
    )[0]!;
    expect(
      (row["attributes"] as JSONObject)["messaging.system"],
    ).toBeUndefined();
    expect(row["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("servicebus", "orders", "orders-prod"),
    ]);
  });

  test("a semconv messaging client metric and an application gauge carrying messaging.system are keyed", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "messaging.client.sent.messages",
              shape: "sum",
              datapoints: [
                [
                  stringAttribute("messaging.system", "kafka"),
                  stringAttribute("messaging.destination.name", "orders"),
                  stringAttribute("messaging.operation.name", "send"),
                ],
              ],
            },
            {
              name: "queue.size",
              datapoints: [
                [
                  stringAttribute("messaging.system", "bullmq"),
                  stringAttribute("messaging.destination.name", "Workers"),
                  stringAttribute("state", "waiting"),
                ],
              ],
            },
            {
              name: "queue.size.untagged",
              datapoints: [
                [stringAttribute("messaging.destination.name", "Workers")],
              ],
            },
          ],
        },
      ]),
    );

    expect(
      rowsNamed(rows, "messaging.client.sent.messages")[0]!["entityKeys"],
    ).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
    expect(rowsNamed(rows, "queue.size")[0]!["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("bullmq", "Workers"),
    ]);
    // A destination alone, without a system or a messaging name: no queue.
    expect(rowsNamed(rows, "queue.size.untagged")[0]!["entityKeys"]).toBe(
      onlyMetadata().entityKeys,
    );
  });

  test("metric names are matched after the ingest lower-casing", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "Kafka.Consumer_Group.Lag_Sum",
              datapoints: [[stringAttribute("topic", "orders")]],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "kafka.consumer_group.lag_sum")[0]!;
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
  });

  /*
   * Two topics under the one verbatim name: the memo must be keyed on the
   * curated entry's `topic` (picked by the name lowercased), or the second
   * datapoint would get the first one's queue.
   */
  test("a rule that renames a metric INTO a messaging name — verbatim, mixed case — keys each datapoint's queue by the final name, lowercased", async () => {
    const rename: MetricPipelineRule = new MetricPipelineRule();
    rename.ruleType = MetricPipelineRuleType.RenameMetric;
    rename.renameToKey = "Kafka.Consumer_Group.Lag_Sum";
    rename.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
        value: "legacy.kafka.lag",
      },
    ];
    const rows: Array<JSONObject> = setupMetricMocks({
      projectRules: [rename],
      rulesByServiceId: new Map(),
    });
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "legacy.kafka.lag",
              datapoints: [
                [
                  stringAttribute("group", "billing"),
                  stringAttribute("topic", "orders"),
                ],
                [
                  stringAttribute("group", "billing"),
                  stringAttribute("topic", "payments"),
                ],
                [
                  stringAttribute("group", "shipping"),
                  stringAttribute("topic", "orders"),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const renamed: Array<JSONObject> = rowsNamed(
      rows,
      "Kafka.Consumer_Group.Lag_Sum",
    );
    expect(renamed).toHaveLength(3);
    for (const row of renamed) {
      const topic: unknown = (row["attributes"] as JSONObject)["topic"];
      expect({ topic: topic, entityKeys: row["entityKeys"] }).toEqual({
        topic: topic,
        entityKeys: [
          ...RESOURCE_KEYS,
          topic === "orders" ? KAFKA_ORDERS_KEY : KAFKA_PAYMENTS_KEY,
        ],
      });
    }
    // The consumer group is a series, not the queue: one resolution per topic.
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expectEveryResourceArrayUntouched();
  });

  test("a rule that renames a metric OUT of the messaging names leaves no key", async () => {
    const rename: MetricPipelineRule = new MetricPipelineRule();
    rename.ruleType = MetricPipelineRuleType.RenameMetric;
    rename.renameToKey = "orders.lag";
    rename.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
        value: "kafka.consumer_group.lag_sum",
      },
    ];
    const rows: Array<JSONObject> = setupMetricMocks({
      projectRules: [rename],
      rulesByServiceId: new Map(),
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "kafka.consumer_group.lag_sum",
              datapoints: [[stringAttribute("topic", "orders")]],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "orders.lag")[0]!;
    expect(row["entityKeys"]).toBe(onlyMetadata().entityKeys);
  });

  test("a rule that renames the destination attribute away leaves no key (the FINAL row decides)", async () => {
    const renameTopic: MetricPipelineRule = new MetricPipelineRule();
    renameTopic.ruleType = MetricPipelineRuleType.RenameAttribute;
    renameTopic.renameFromKey = "topic";
    renameTopic.renameToKey = "kafka.topic.redacted";
    renameTopic.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
        attributeKey: "topic",
        conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
      },
    ];
    const rows: Array<JSONObject> = setupMetricMocks({
      projectRules: [renameTopic],
      rulesByServiceId: new Map(),
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            {
              name: "kafka.consumer_group.lag_sum",
              datapoints: [[stringAttribute("topic", "orders")]],
            },
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "kafka.consumer_group.lag_sum")[0]!;
    expect((row["attributes"] as JSONObject)["topic"]).toBeUndefined();
    expect(row["entityKeys"]).toBe(onlyMetadata().entityKeys);
  });

  test("a kafka_metrics scrape: many datapoints, each keyed by ITS topic, each topic resolved once", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );

    const datapoints: Array<Array<OtlpAttribute>> = [];
    for (let i: number = 0; i < 24; i++) {
      datapoints.push([
        stringAttribute("group", `group-${i % 3}`),
        stringAttribute("topic", i % 2 === 0 ? "orders" : "payments"),
        intAttribute("partition", i % 4),
      ]);
    }

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          metrics: [
            { name: "kafka.consumer_group.lag", datapoints: datapoints },
          ],
        },
      ]),
    );

    const lagRows: Array<JSONObject> = rowsNamed(
      rows,
      "kafka.consumer_group.lag",
    );
    expect(lagRows).toHaveLength(24);
    for (const row of lagRows) {
      const topic: unknown = (row["attributes"] as JSONObject)["topic"];
      expect(row["entityKeys"]).toEqual([
        ...RESOURCE_KEYS,
        topic === "orders" ? KAFKA_ORDERS_KEY : KAFKA_PAYMENTS_KEY,
      ]);
    }
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expectEveryResourceArrayUntouched();
  });

  test("Pulsar's per-consumer copies count toward no queue; the subscription series of the same topic do", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("server.address", "pulsar-broker-0"),
            stringAttribute("server.port", "8080"),
          ],
          metrics: [
            {
              name: "pulsar_out_messages_total",
              datapoints: [
                [
                  stringAttribute(
                    "topic",
                    "persistent://public/default/payments-partition-0",
                  ),
                  stringAttribute("subscription", "billing"),
                ],
                [
                  stringAttribute(
                    "topic",
                    "persistent://public/default/payments-partition-0",
                  ),
                  stringAttribute("subscription", "billing"),
                  stringAttribute("consumer_name", "billing-worker-1"),
                  stringAttribute("consumer_id", "0"),
                ],
              ],
            },
          ],
        },
      ]),
    );

    const outRows: Array<JSONObject> = rowsNamed(
      rows,
      "pulsar_out_messages_total",
    );
    expect(outRows).toHaveLength(2);
    const [subscriptionRow, consumerRow]: Array<JSONObject> = [
      outRows.find((row: JSONObject): boolean => {
        return !(row["attributes"] as JSONObject)["consumer_name"];
      })!,
      outRows.find((row: JSONObject): boolean => {
        return Boolean((row["attributes"] as JSONObject)["consumer_name"]);
      })!,
    ];
    expect(subscriptionRow!["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("pulsar", "persistent://public/default/payments"),
    ]);
    expect(consumerRow!["entityKeys"]).toBe(onlyMetadata().entityKeys);
  });

  test("metrics that are not about a queue cost no resolver or key work", async () => {
    setupMetricMocks(noRules());
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          resourceAttributes: [
            stringAttribute("host.name", "web-1"),
            stringAttribute("os.type", "linux"),
          ],
          metrics: [
            {
              name: "system.cpu.utilization",
              datapoints: [
                [stringAttribute("state", "user")],
                [stringAttribute("state", "system")],
              ],
            },
            {
              name: "http.server.request.duration",
              shape: "histogram",
              datapoints: [
                [
                  stringAttribute("http.request.method", "GET"),
                  stringAttribute("messaging.destination.name", "not-a-gate"),
                ],
              ],
            },
          ],
        },
      ]),
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
  });
});

/*
 * ---- Source pins: where the stamps sit in each service -----------------------
 */

describe("both services stamp the queue key right after the database key, on the final row", () => {
  /*
   * Read from the source, comments stripped and whitespace collapsed: the
   * behavioural tests above prove the stamp sees scrub / pipeline / rule
   * output; these pin that it stays next to the database stamp (the same
   * final-row, new-array contract) and that one resolver serves the whole
   * request.
   */
  const SERVICES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "Services",
  );

  function readService(file: string): string {
    return fs
      .readFileSync(path.join(SERVICES_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ");
  }

  function countOf(source: string, needle: string): number {
    return source.split(needle).length - 1;
  }

  test("traces: after drop / scrub / pipeline, directly after the database stamp, before exceptions and buffering", () => {
    const source: string = readService("OtelTracesIngestService.ts");

    const constructed: string = "new MessagingEntityKeyResolver(projectId)";
    const stamp: string = "messagingEntityKeys.appendToSpanRow(spanRow);";
    expect(countOf(source, constructed)).toBe(1);
    expect(countOf(source, stamp)).toBe(1);
    expect(source.indexOf(constructed)).toBeLessThan(
      source.indexOf("for (const resourceSpan of resourceSpans)"),
    );

    expect(source).toContain(
      `databaseCallEntityKeys.appendToClientSpanRow( spanRow, databaseCaller, ); ${stamp}`,
    );
    const at: number = source.indexOf(stamp);
    for (const before of [
      "TraceDropFilterService.shouldDropSpan(",
      "this.finalizeSpanRow(",
      "TraceScrubRuleService.scrubSpan(",
      "TracePipelineService.processSpan(",
    ]) {
      expect({ before: before, first: source.indexOf(before) < at }).toEqual({
        before: before,
        first: true,
      });
    }
    for (const after of [
      "this.collectSpanExceptions({",
      "dbSpans.push(spanRow);",
    ]) {
      expect({ after: after, later: source.indexOf(after, at) > at }).toEqual({
        after: after,
        later: true,
      });
    }
  });

  test("metrics: after the pipeline rules and the full row, directly after the database stamp, before buffering", () => {
    const source: string = readService("OtelMetricsIngestService.ts");

    const constructed: string = "new MessagingEntityKeyResolver(projectId)";
    const stamp: string = "messagingEntityKeys.appendToMetricRow(metricRow);";
    expect(countOf(source, constructed)).toBe(1);
    expect(countOf(source, stamp)).toBe(1);
    expect(source.indexOf(constructed)).toBeLessThan(
      source.indexOf("for (const resourceMetric of resourceMetrics)"),
    );

    expect(source).toContain(
      `databaseCallEntityKeys.appendToDatabaseClientMetricRow( metricRow, databaseCaller, ); ${stamp}`,
    );
    const at: number = source.indexOf(stamp);
    for (const before of [
      "MetricPipelineRuleService.applyRules(",
      "this.completeMetricRow({",
    ]) {
      expect({ before: before, first: source.indexOf(before) < at }).toEqual({
        before: before,
        first: true,
      });
    }
    expect(source.indexOf("dbMetrics.push(metricRow);", at)).toBeGreaterThan(
      at,
    );
  });
});
