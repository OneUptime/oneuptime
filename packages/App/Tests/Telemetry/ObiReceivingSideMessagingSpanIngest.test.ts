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
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService, {
  LoadedTracePipeline,
} from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import TracePipelineProcessorType, {
  SpanKindRemapperConfig,
} from "Common/Types/Trace/TracePipelineProcessorType";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
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
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * OBI v0.14 (#3306) exports the Kafka, MQTT and NATS spans it records on the
 * RECEIVING side of a connection — a broker serving a produce or a fetch, a
 * subscriber handed a delivery — as PRODUCER / CONSUMER, where v0.13 sent
 * SERVER. Through the real ingest service, pinned here:
 *
 *   - such spans are stored as SPAN_KIND_SERVER, so the queue stamper turns
 *     them away (no queue key, the row keeps the resource's shared array)
 *     and the discovery cron reads them as no messaging evidence: a topic
 *     is not counted twice and its broker is no producer or consumer of it;
 *   - the application's own OBI span in the same payload keeps OBI's kind
 *     and is keyed once;
 *   - the kind is decided before the evaluation row: a drop filter sees the
 *     stored kind, and a Span Kind Remapper still has the last word.
 *
 * The harness is MessagingEntityKeysIngest.test.ts's, with a service name
 * and OBI's resource attributes per resource.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const TRACE_ID_HEX: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const START_MS: number = Date.UTC(2026, 9, 1, 10, 0, 0, 0);
const START_NANO: string = `${START_MS}000000`;
const END_NANO: string = `${START_MS + 3}000000`;

// Resource-level keys the resolver stamped (service, pod, cluster, …).
const RESOURCE_KEYS: Array<string> = ["0123456789abcdef", "fedcba9876543210"];

function queueKey(system: string, destination: string): string {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: system,
    brokerScope: "",
    destination: destination,
  });
  if (!identity) {
    throw new Error(`Not a queue identity: ${system}|${destination}`);
  }
  return keyForMessageQueue(PROJECT_ID.toString(), identity);
}

const KAFKA_ORDERS_KEY: string = queueKey("kafka", "orders");

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

// The resource attributes OBI v0.14 sends for an instrumented process.
function obiResourceAttributes(): Array<OtlpAttribute> {
  return [
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.sdk.language", "java"),
    stringAttribute(
      "telemetry.distro.name",
      "opentelemetry-ebpf-instrumentation",
    ),
    stringAttribute("telemetry.distro.version", "v0.14.0"),
    stringAttribute("k8s.namespace.name", "shop"),
    stringAttribute("k8s.cluster.name", "prod-eu"),
  ];
}

// A Java agent's resource: same service names, not OBI.
function sdkResourceAttributes(): Array<OtlpAttribute> {
  return [
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.sdk.language", "java"),
    stringAttribute(
      "telemetry.distro.name",
      "opentelemetry-java-instrumentation",
    ),
  ];
}

/*
 * Every resource's metadata the mocked resolver handed out, in order. Each
 * one's entityKeys array is THE shared array every row of that resource
 * starts out pointing at.
 */
let issuedMetadata: Array<TelemetryServiceMetadata> = [];

function metadataFor(serviceName: string): TelemetryServiceMetadata {
  const metadata: TelemetryServiceMetadata = {
    serviceName: serviceName,
    primaryEntityId: ObjectID.generate(),
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

function issuedFor(serviceName: string): TelemetryServiceMetadata {
  const matches: Array<TelemetryServiceMetadata> = issuedMetadata.filter(
    (metadata: TelemetryServiceMetadata): boolean => {
      return metadata.serviceName === serviceName;
    },
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
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
  // OTLP/JSON sends the number; protobuf and gRPC bodies the enum name.
  kind: number | string;
  attributes: Array<OtlpAttribute>;
};

type CapturedTraceRows = {
  spans: Array<JSONObject>;
};

function setupTraceMocks(): CapturedTraceRows {
  const captured: CapturedTraceRows = { spans: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of TRACE_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  // One Service per resource, named by its service.name.
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(
      async (...args: Array<unknown>): Promise<TelemetryServiceMetadata> => {
        const attributes: Array<OtlpAttribute> = (
          args[0] as { attributes: Array<OtlpAttribute> }
        ).attributes;
        const serviceName: OtlpAttribute | undefined = attributes.find(
          (attribute: OtlpAttribute): boolean => {
            return attribute.key === "service.name";
          },
        );
        return metadataFor(
          String(
            (serviceName?.value as { stringValue?: string } | undefined)
              ?.stringValue || "",
          ),
        );
      },
    );

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
      (args[0] as Array<JSONObject>).splice(0);
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
  serviceName: string;
  resourceAttributes: Array<OtlpAttribute>;
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
                stringAttribute("service.name", resource.serviceName),
                ...resource.resourceAttributes,
              ],
            },
            scopeSpans: [
              {
                scope: { name: "go.opentelemetry.io/obi" },
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
                    events: [],
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

const BROKER_PRODUCE_SPAN_ID: string = "a1b2c3d4e5f60718";
const BROKER_FETCH_SPAN_ID: string = "b2c3d4e5f6071829";
const APP_PRODUCE_SPAN_ID: string = "c3d4e5f60718293a";
const SUBSCRIBER_DELIVERY_SPAN_ID: string = "d4e5f60718293a4b";
const BROKER_SUBSCRIBE_SPAN_ID: string = "e5f60718293a4b5c";
const APP_PUBLISH_SPAN_ID: string = "f60718293a4b5c6d";
const NATS_SERVER_PUB_SPAN_ID: string = "0718293a4b5c6d7e";
const NATS_SUBSCRIBER_MSG_SPAN_ID: string = "18293a4b5c6d7e8f";
const BROKER_UNKNOWN_OP_SPAN_ID: string = "293a4b5c6d7e8f90";
const BROKER_SERVER_SPAN_ID: string = "3a4b5c6d7e8f9001";

/*
 * Span attributes as OBI v0.14's tracesgen.go writes them for a Kafka event
 * (server.port and the offset as integers, the partition as a string).
 */
function kafkaAttributes(data: {
  serverAddress: string;
  operation: "publish" | "process";
  servicePeerName?: string;
}): Array<OtlpAttribute> {
  const attributes: Array<OtlpAttribute> = [
    intAttribute("server.port", 9092),
    stringAttribute("messaging.system", "kafka"),
    stringAttribute("messaging.client.id", "orders-api-producer-1"),
    stringAttribute("messaging.destination.name", "orders"),
    stringAttribute("server.address", data.serverAddress),
    stringAttribute("messaging.operation.name", data.operation),
    stringAttribute(
      "messaging.operation.type",
      data.operation === "publish" ? "send" : "process",
    ),
  ];
  if (data.servicePeerName) {
    attributes.push(stringAttribute("service.peer.name", data.servicePeerName));
  }
  attributes.push(stringAttribute("messaging.destination.partition.id", "0"));
  if (data.operation === "process") {
    attributes.push(intAttribute("messaging.kafka.offset", 1042));
  }
  return attributes;
}

function mqttAttributes(data: {
  serverAddress: string;
  operation: { name: string; type: string };
  servicePeerName?: string;
}): Array<OtlpAttribute> {
  return [
    intAttribute("server.port", 1883),
    stringAttribute("messaging.system", "mqtt"),
    stringAttribute("messaging.destination.name", "sensors/temperature"),
    stringAttribute("messaging.client.id", "sensor-17"),
    stringAttribute("server.address", data.serverAddress),
    stringAttribute("messaging.operation.name", data.operation.name),
    stringAttribute("messaging.operation.type", data.operation.type),
    ...(data.servicePeerName
      ? [stringAttribute("service.peer.name", data.servicePeerName)]
      : []),
  ];
}

function natsAttributes(data: {
  serverAddress: string;
  operation: { name: string; type: string };
}): Array<OtlpAttribute> {
  return [
    intAttribute("server.port", 4222),
    stringAttribute("messaging.system", "nats"),
    intAttribute("messaging.message.envelope.size", 128),
    stringAttribute("messaging.destination.name", "orders.created"),
    stringAttribute("messaging.client.id", "orders-api"),
    stringAttribute("server.address", data.serverAddress),
    stringAttribute("messaging.operation.name", data.operation.name),
    stringAttribute("messaging.operation.type", data.operation.type),
  ];
}

const PUBLISH: { name: string; type: string } = {
  name: "publish",
  type: "send",
};
const PROCESS: { name: string; type: string } = {
  name: "process",
  type: "process",
};

// The Kafka broker (service "kafka") serving a produce and a fetch.
function kafkaBrokerResource(
  resourceAttributes: Array<OtlpAttribute> = obiResourceAttributes(),
): ResourceSpansInput {
  return {
    serviceName: "kafka",
    resourceAttributes: resourceAttributes,
    spans: [
      {
        spanId: BROKER_PRODUCE_SPAN_ID,
        name: "publish orders",
        kind: PRODUCER_KIND,
        attributes: kafkaAttributes({
          serverAddress: "kafka",
          operation: "publish",
        }),
      },
      {
        spanId: BROKER_FETCH_SPAN_ID,
        name: "process orders",
        kind: CONSUMER_KIND,
        attributes: kafkaAttributes({
          serverAddress: "kafka",
          operation: "process",
        }),
      },
    ],
  };
}

// The application (service "orders-api") producing to the broker "kafka".
function ordersApiResource(): ResourceSpansInput {
  return {
    serviceName: "orders-api",
    resourceAttributes: obiResourceAttributes(),
    spans: [
      {
        spanId: APP_PRODUCE_SPAN_ID,
        name: "publish orders",
        kind: PRODUCER_KIND,
        attributes: kafkaAttributes({
          serverAddress: "kafka",
          operation: "publish",
          servicePeerName: "kafka",
        }),
      },
    ],
  };
}

/*
 * What the discovery cron reads back for ONE stored span row: the resolver
 * input attributes as the ClickHouse columns hold them, and the kind
 * column's text.
 */
function discoveryRowFor(row: JSONObject): MessagingSpanDiscoveryRow {
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
  return queryRow;
}

function dropFilter(filterQuery: string): LoadedTraceDropFilter {
  /*
   * No id on the model on purpose: recordDrop() short-circuits without one,
   * keeping the drop-recorder (and its Redis surface) out of this suite.
   */
  const filter: TraceDropFilter = new TraceDropFilter();
  filter.action = TraceDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

describe("OBI v0.14 receiving-side messaging spans at ingest", () => {
  test("an OBI v0.14 Kafka broker's produce (kind 4) and fetch (kind 5) spans are stored as SPAN_KIND_SERVER, carry no queue key, and the row's entityKeys is still the resource's shared array", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([kafkaBrokerResource()]),
    );

    expect(captured.spans).toHaveLength(2);
    const metadata: TelemetryServiceMetadata = issuedFor("kafka");
    for (const spanId of [BROKER_PRODUCE_SPAN_ID, BROKER_FETCH_SPAN_ID]) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, kind: row["kind"] }).toEqual({
        spanId: spanId,
        kind: SpanKind.Server,
      });
      expect(row["entityKeys"]).toBe(metadata.entityKeys);
      // Name and attributes are stored as OBI sent them.
      expect(
        (row["attributes"] as JSONObject)["messaging.operation.type"],
      ).toBe(spanId === BROKER_PRODUCE_SPAN_ID ? "send" : "process");
    }
    expectEveryResourceArrayUntouched();
  });

  test("the application's OBI producer span (service orders-api, server.address kafka) in the same payload stays SPAN_KIND_PRODUCER and gets queueKey('kafka', 'orders') once; the topic is discovered from one span, not two", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([ordersApiResource(), kafkaBrokerResource()]),
    );

    expect(captured.spans).toHaveLength(3);
    const appRow: JSONObject = spanById(captured.spans, APP_PRODUCE_SPAN_ID);
    const brokerProduceRow: JSONObject = spanById(
      captured.spans,
      BROKER_PRODUCE_SPAN_ID,
    );
    const brokerFetchRow: JSONObject = spanById(
      captured.spans,
      BROKER_FETCH_SPAN_ID,
    );

    expect(appRow["kind"]).toBe(SpanKind.Producer);
    expect(appRow["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
    expect(
      captured.spans.filter((row: JSONObject): boolean => {
        return (row["entityKeys"] as Array<string>).includes(KAFKA_ORDERS_KEY);
      }),
    ).toHaveLength(1);
    expect(brokerProduceRow["kind"]).toBe(SpanKind.Server);
    expect(brokerProduceRow["entityKeys"]).toBe(issuedFor("kafka").entityKeys);
    expect(brokerFetchRow["kind"]).toBe(SpanKind.Server);

    // The discovery cron, over every stored row: one span of evidence.
    const discovered: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows(captured.spans.map(discoveryRowFor));
    expect(
      discovered.map((queue: DiscoveredMessageQueue): string => {
        return queue.identifier;
      }),
    ).toHaveLength(1);
    expect(
      keyForMessageQueue(PROJECT_ID.toString(), discovered[0]!.identity),
    ).toBe(KAFKA_ORDERS_KEY);
    expect(discovered[0]!.spans?.count).toBe(1);
    expectEveryResourceArrayUntouched();
  });

  test("an MQTT subscriber's reversed delivery (PRODUCER, server.address its own name) and the broker's SUBSCRIBE (CONSUMER) are SERVER; the publishing sensor keeps PRODUCER and its key", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          serviceName: "temperature-alerts",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: SUBSCRIBER_DELIVERY_SPAN_ID,
              name: "publish sensors/temperature",
              kind: PRODUCER_KIND,
              attributes: mqttAttributes({
                serverAddress: "temperature-alerts",
                operation: PUBLISH,
              }),
            },
          ],
        },
        {
          serviceName: "mosquitto",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: BROKER_SUBSCRIBE_SPAN_ID,
              name: "process sensors/temperature",
              kind: CONSUMER_KIND,
              attributes: mqttAttributes({
                serverAddress: "mosquitto",
                operation: PROCESS,
              }),
            },
            {
              // An operation OBI cannot name: INTERNAL in v0.14.
              spanId: BROKER_UNKNOWN_OP_SPAN_ID,
              name: "unknown sensors/temperature",
              kind: INTERNAL_KIND,
              attributes: mqttAttributes({
                serverAddress: "mosquitto",
                operation: { name: "unknown", type: "unknown" },
              }),
            },
          ],
        },
        {
          serviceName: "temperature-sensor",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: APP_PUBLISH_SPAN_ID,
              name: "publish sensors/temperature",
              kind: PRODUCER_KIND,
              attributes: mqttAttributes({
                serverAddress: "mosquitto",
                operation: PUBLISH,
                servicePeerName: "mosquitto",
              }),
            },
          ],
        },
      ]),
    );

    expect(captured.spans).toHaveLength(4);
    for (const [spanId, serviceName] of [
      [SUBSCRIBER_DELIVERY_SPAN_ID, "temperature-alerts"],
      [BROKER_SUBSCRIBE_SPAN_ID, "mosquitto"],
      [BROKER_UNKNOWN_OP_SPAN_ID, "mosquitto"],
    ] as Array<[string, string]>) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, kind: row["kind"] }).toEqual({
        spanId: spanId,
        kind: SpanKind.Server,
      });
      expect(row["entityKeys"]).toBe(issuedFor(serviceName).entityKeys);
    }

    const sensorRow: JSONObject = spanById(captured.spans, APP_PUBLISH_SPAN_ID);
    expect(sensorRow["kind"]).toBe(SpanKind.Producer);
    expect(sensorRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("mqtt", "sensors/temperature"),
    ]);
    expectEveryResourceArrayUntouched();
  });

  test("nats-server's PUB and a subscriber's reversed MSG are SERVER", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          serviceName: "nats-server",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: NATS_SERVER_PUB_SPAN_ID,
              name: "publish orders.created",
              kind: PRODUCER_KIND,
              attributes: natsAttributes({
                serverAddress: "nats-server",
                operation: PUBLISH,
              }),
            },
          ],
        },
        {
          serviceName: "order-notifier",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: NATS_SUBSCRIBER_MSG_SPAN_ID,
              name: "process orders.created",
              kind: CONSUMER_KIND,
              attributes: natsAttributes({
                serverAddress: "order-notifier",
                operation: PROCESS,
              }),
            },
          ],
        },
      ]),
    );

    expect(captured.spans).toHaveLength(2);
    for (const spanId of [
      NATS_SERVER_PUB_SPAN_ID,
      NATS_SUBSCRIBER_MSG_SPAN_ID,
    ]) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, kind: row["kind"] }).toEqual({
        spanId: spanId,
        kind: SpanKind.Server,
      });
    }
    expectEveryResourceArrayUntouched();
  });

  test("a kind sent as the enum NAME (protobuf / gRPC bodies) is normalized the same way, and a SERVER span stays SERVER", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          serviceName: "kafka",
          resourceAttributes: obiResourceAttributes(),
          spans: [
            {
              spanId: BROKER_PRODUCE_SPAN_ID,
              name: "publish orders",
              kind: "SPAN_KIND_PRODUCER",
              attributes: kafkaAttributes({
                serverAddress: "kafka",
                operation: "publish",
              }),
            },
            {
              spanId: BROKER_FETCH_SPAN_ID,
              name: "process orders",
              kind: CLIENT_KIND,
              attributes: kafkaAttributes({
                serverAddress: "kafka",
                operation: "process",
              }),
            },
            {
              // What OBI v0.13 sent for the same span.
              spanId: BROKER_SERVER_SPAN_ID,
              name: "publish orders",
              kind: SERVER_KIND,
              attributes: kafkaAttributes({
                serverAddress: "kafka",
                operation: "publish",
              }),
            },
          ],
        },
      ]),
    );

    expect(
      captured.spans.map((row: JSONObject): unknown => {
        return row["kind"];
      }),
    ).toEqual([SpanKind.Server, SpanKind.Server, SpanKind.Server]);
  });

  test("an SDK span with the very same attributes is not OBI's: it keeps its kind and its key", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([kafkaBrokerResource(sdkResourceAttributes())]),
    );

    const produceRow: JSONObject = spanById(
      captured.spans,
      BROKER_PRODUCE_SPAN_ID,
    );
    expect(produceRow["kind"]).toBe(SpanKind.Producer);
    expect(produceRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_ORDERS_KEY,
    ]);
    expect(spanById(captured.spans, BROKER_FETCH_SPAN_ID)["kind"]).toBe(
      SpanKind.Consumer,
    );
  });

  test("a drop filter sees the stored kind: dropping PRODUCER spans drops the application's, not the broker's", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      .mockResolvedValue([dropFilter("kind = 'SPAN_KIND_PRODUCER'")]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([ordersApiResource(), kafkaBrokerResource()]),
    );

    expect(
      captured.spans
        .map((row: JSONObject): string => {
          return row["spanId"] as string;
        })
        .sort(),
    ).toEqual([BROKER_PRODUCE_SPAN_ID, BROKER_FETCH_SPAN_ID].sort());
  });

  test("a Span Kind Remapper keeps the last word: remapped back to PRODUCER, the broker's span is keyed again", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    const config: SpanKindRemapperConfig = {
      sourceKey: "resource.service.name",
      mappings: [{ matchValue: "kafka", kind: SpanKind.Producer }],
    };
    const processor: TracePipelineProcessor = new TracePipelineProcessor();
    processor.name = "Keep OBI's broker kinds";
    processor.processorType = TracePipelineProcessorType.SpanKindRemapper;
    processor.configuration = config as unknown as JSONObject;
    processor.isEnabled = true;
    const pipeline: TracePipeline = new TracePipeline();
    pipeline.name = "Broker spans";
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

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest([
        {
          ...kafkaBrokerResource(),
          spans: kafkaBrokerResource().spans.slice(0, 1),
        },
      ]),
    );

    const row: JSONObject = spanById(captured.spans, BROKER_PRODUCE_SPAN_ID);
    expect(row["kind"]).toBe(SpanKind.Producer);
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, KAFKA_ORDERS_KEY]);
    expectEveryResourceArrayUntouched();
  });
});

describe("the stored kind is decided once, before the evaluation row", () => {
  /*
   * Read from the source, comments stripped and whitespace collapsed (as
   * MessagingEntityKeysIngest.test.ts does): the behavioural tests above
   * prove drop filters, pipelines and the queue stamper see the stored
   * kind; this pins that the kind every one of them reads is the
   * normalized one.
   */
  function readTracesService(): string {
    return fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Telemetry",
          "Services",
          "OtelTracesIngestService.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ");
  }

  test("normalizeObiReceivingSideMessagingSpanKind wraps the only mapSpanKind call, ahead of buildSpanEvaluationRow", () => {
    const source: string = readTracesService();
    const normalized: string =
      'const spanKind: SpanKind = normalizeObiReceivingSideMessagingSpanKind({ kind: OtelTracesIngestService.mapSpanKind(span["kind"]), attributes: spanAttributes, });';

    expect(source.split(normalized)).toHaveLength(2);
    expect(source.split("mapSpanKind(span[")).toHaveLength(2);
    expect(source.indexOf(normalized)).toBeGreaterThan(
      source.indexOf("const spanAttributes:"),
    );
    expect(source.indexOf(normalized)).toBeLessThan(
      source.indexOf("this.buildSpanEvaluationRow({"),
    );
    expect(source).toContain("kind: spanKind,");
  });
});
