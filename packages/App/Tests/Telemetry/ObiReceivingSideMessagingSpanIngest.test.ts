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
 *   - a NATS broker's deliveries are SERVER too, the one OBI splits off an
 *     exchange and the one it types client-side, while the delivery OBI
 *     splits off a client's ack stays the client's CONSUMER;
 *   - so are the publishes OBI types client-side on a broker, mosquitto's
 *     PUBLISH to a subscriber and the PUB nats-server read beside a split
 *     delivery, told from a client's by their equal ephemeral ports;
 *   - every span captured from a real nats-server and mosquitto
 *     (Fixtures/ObiMessaging) is stored with the kind OBI's own event type
 *     calls for;
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

/*
 * A JetStream subject on a real nats-server 2.11, traced by OBI v0.14.0's
 * generic tracer (as for a Go binary OBI has no offsets for): values as
 * captured in Fixtures/ObiMessaging. Ports are OTLP int64s, sent as strings
 * the way OTLP/JSON and the protobuf and gRPC decoders deliver them.
 */
function stringIntAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: String(value) } };
}

function capturedNatsAttributes(data: {
  serverAddress: string;
  serverPort: number;
  peerAddress: string;
  peerPort: number;
  operation: "publish" | "process";
  subject: string;
  servicePeerName?: string;
}): Array<OtlpAttribute> {
  return [
    stringIntAttribute("server.port", data.serverPort),
    stringAttribute("messaging.system", "nats"),
    stringIntAttribute("messaging.message.envelope.size", 12),
    stringAttribute("messaging.destination.name", data.subject),
    stringAttribute("server.address", data.serverAddress),
    stringAttribute("messaging.operation.name", data.operation),
    stringAttribute(
      "messaging.operation.type",
      data.operation === "publish" ? "send" : "process",
    ),
    ...(data.servicePeerName
      ? [stringAttribute("service.peer.name", data.servicePeerName)]
      : []),
    stringAttribute("network.peer.address", data.peerAddress),
    stringIntAttribute("network.peer.port", data.peerPort),
  ];
}

function natsNodeResourceAttributes(): Array<OtlpAttribute> {
  return [
    ...obiResourceAttributes(),
    stringAttribute("k8s.node.name", "fu-nats-worker"),
  ];
}

const NATS_JS_ORDERS_KEY: string = queueKey("nats", "js.orders.created");
const NATS_ACK_SUBJECT: string =
  "$JS.ACK.ORDERS.billing.1.179.179.1791058721653797801.0";

const NATS_BROKER_PUB_SPAN_ID: string = "4b5c6d7e8f900112";
const NATS_BROKER_SPLIT_SPAN_ID: string = "5c6d7e8f90011223";
const NATS_BROKER_CLIENT_TYPED_MSG_SPAN_ID: string = "6d7e8f9001122334";
const NATS_BROKER_CLIENT_TYPED_ACK_SPAN_ID: string = "7e8f900112233445";
const NATS_PRODUCER_PUBLISH_SPAN_ID: string = "8f90011223344556";
const NATS_CONSUMER_ACK_SPAN_ID: string = "9001122334455667";
const NATS_CONSUMER_SPLIT_SPAN_ID: string = "a011223344556677";

/*
 * js-producer publishes to js.orders.created; js-pull-consumer is handed
 * each message and acks it. nats-server reads the PUB (B1), and on the
 * consumer's connection writes the MSG and reads the ack in one exchange:
 * OBI splits the MSG off (B3) and types the ack client-side (B3-main), or
 * types a MSG it wrote first client-side (B4). On the consumer, OBI splits
 * its delivery off its ack (C2).
 */
function natsJetStreamResources(): Array<ResourceSpansInput> {
  return [
    {
      serviceName: "nats",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: NATS_BROKER_PUB_SPAN_ID,
          name: "publish js.orders.created",
          kind: PRODUCER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "nats",
            serverPort: 4222,
            peerAddress: "10.244.1.77",
            peerPort: 41822,
            operation: "publish",
            subject: "js.orders.created",
          }),
        },
        {
          spanId: NATS_BROKER_SPLIT_SPAN_ID,
          name: "process js.orders.created",
          kind: CONSUMER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "js-pull-consumer",
            serverPort: 54276,
            peerAddress: "10.244.1.72",
            peerPort: 4222,
            operation: "process",
            subject: "js.orders.created",
          }),
        },
        {
          spanId: NATS_BROKER_CLIENT_TYPED_MSG_SPAN_ID,
          name: "process js.orders.created",
          kind: CONSUMER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "js-pull-consumer",
            serverPort: 54276,
            peerAddress: "10.244.1.59",
            peerPort: 54276,
            operation: "process",
            subject: "js.orders.created",
            servicePeerName: "js-pull-consumer",
          }),
        },
        {
          spanId: NATS_BROKER_CLIENT_TYPED_ACK_SPAN_ID,
          name: `publish ${NATS_ACK_SUBJECT}`,
          kind: PRODUCER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "js-pull-consumer",
            serverPort: 54276,
            peerAddress: "10.244.1.59",
            peerPort: 54276,
            operation: "publish",
            subject: NATS_ACK_SUBJECT,
            servicePeerName: "js-pull-consumer",
          }),
        },
      ],
    },
    {
      serviceName: "js-producer",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: NATS_PRODUCER_PUBLISH_SPAN_ID,
          name: "publish js.orders.created",
          kind: PRODUCER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "nats",
            serverPort: 4222,
            peerAddress: "10.96.212.229",
            peerPort: 4222,
            operation: "publish",
            subject: "js.orders.created",
            servicePeerName: "nats",
          }),
        },
      ],
    },
    {
      serviceName: "js-pull-consumer",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: NATS_CONSUMER_ACK_SPAN_ID,
          name: `publish ${NATS_ACK_SUBJECT}`,
          kind: PRODUCER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "nats",
            serverPort: 4222,
            peerAddress: "10.96.212.229",
            peerPort: 4222,
            operation: "publish",
            subject: NATS_ACK_SUBJECT,
            servicePeerName: "nats",
          }),
        },
        {
          spanId: NATS_CONSUMER_SPLIT_SPAN_ID,
          name: "process js.orders.created",
          kind: CONSUMER_KIND,
          attributes: capturedNatsAttributes({
            serverAddress: "nats",
            serverPort: 4222,
            peerAddress: "10.244.1.59",
            peerPort: 54276,
            operation: "process",
            subject: "js.orders.created",
          }),
        },
      ],
    },
  ];
}

function spanIdsOf(rows: Array<JSONObject>): Array<string> {
  return rows
    .map((row: JSONObject): string => {
      return row["spanId"] as string;
    })
    .sort();
}

describe("OBI v0.14 NATS deliveries at ingest", () => {
  test("nats-server's split delivery (B3), the MSG it wrote and the ack it read that OBI typed client-side (B4, B3-main) are stored as SERVER with no queue key; the consumer's own split delivery (C2) stays CONSUMER and is keyed; the subject is discovered from the producer's and the consumer's spans only", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest(natsJetStreamResources()),
    );

    expect(captured.spans).toHaveLength(7);
    const broker: TelemetryServiceMetadata = issuedFor("nats");
    for (const spanId of [
      NATS_BROKER_PUB_SPAN_ID,
      NATS_BROKER_SPLIT_SPAN_ID,
      NATS_BROKER_CLIENT_TYPED_MSG_SPAN_ID,
      // The ack the broker read, at the consumer's ephemeral port.
      NATS_BROKER_CLIENT_TYPED_ACK_SPAN_ID,
    ]) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, kind: row["kind"] }).toEqual({
        spanId: spanId,
        kind: SpanKind.Server,
      });
      expect(row["entityKeys"]).toBe(broker.entityKeys);
    }

    const producerRow: JSONObject = spanById(
      captured.spans,
      NATS_PRODUCER_PUBLISH_SPAN_ID,
    );
    expect(producerRow["kind"]).toBe(SpanKind.Producer);
    expect(producerRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      NATS_JS_ORDERS_KEY,
    ]);
    const consumerRow: JSONObject = spanById(
      captured.spans,
      NATS_CONSUMER_SPLIT_SPAN_ID,
    );
    expect(consumerRow["kind"]).toBe(SpanKind.Consumer);
    expect(consumerRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      NATS_JS_ORDERS_KEY,
    ]);
    expect(spanById(captured.spans, NATS_CONSUMER_ACK_SPAN_ID)["kind"]).toBe(
      SpanKind.Producer,
    );

    // Keyed exactly twice: the producer's publish and the consumer's delivery.
    expect(
      spanIdsOf(
        captured.spans.filter((row: JSONObject): boolean => {
          return (row["entityKeys"] as Array<string>).includes(
            NATS_JS_ORDERS_KEY,
          );
        }),
      ),
    ).toEqual(
      [NATS_PRODUCER_PUBLISH_SPAN_ID, NATS_CONSUMER_SPLIT_SPAN_ID].sort(),
    );

    const discovered: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows(captured.spans.map(discoveryRowFor));
    expect(
      discovered.map((queue: DiscoveredMessageQueue): string => {
        return keyForMessageQueue(PROJECT_ID.toString(), queue.identity);
      }),
    ).toEqual([NATS_JS_ORDERS_KEY]);
    expect(discovered[0]!.spans?.count).toBe(2);
    expectEveryResourceArrayUntouched();
  });

  test("the same payload with the kinds OBI v0.13 sent (SERVER for every NATSServer span) is stored the same, but the consumer's split delivery, which v0.13 sent as SERVER", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const v013: Array<ResourceSpansInput> = natsJetStreamResources().map(
      (resource: ResourceSpansInput): ResourceSpansInput => {
        return {
          ...resource,
          resourceAttributes: resource.resourceAttributes.map(
            (attribute: OtlpAttribute): OtlpAttribute => {
              return attribute.key === "telemetry.distro.version"
                ? stringAttribute("telemetry.distro.version", "v0.13.0")
                : attribute;
            },
          ),
          spans: resource.spans.map((span: SpanInput): SpanInput => {
            return [
              NATS_BROKER_PUB_SPAN_ID,
              NATS_BROKER_SPLIT_SPAN_ID,
              NATS_CONSUMER_SPLIT_SPAN_ID,
            ].includes(span.spanId)
              ? { ...span, kind: SERVER_KIND }
              : span;
          }),
        };
      },
    );

    await OtelTracesIngestService.processTracesFromQueue(tracesRequest(v013));

    const kinds: Record<string, unknown> = {};
    for (const row of captured.spans) {
      kinds[row["spanId"] as string] = row["kind"];
    }
    expect(kinds).toEqual({
      [NATS_BROKER_PUB_SPAN_ID]: SpanKind.Server,
      [NATS_BROKER_SPLIT_SPAN_ID]: SpanKind.Server,
      // v0.13 sent these as CONSUMER and PRODUCER too: still the broker's.
      [NATS_BROKER_CLIENT_TYPED_MSG_SPAN_ID]: SpanKind.Server,
      [NATS_BROKER_CLIENT_TYPED_ACK_SPAN_ID]: SpanKind.Server,
      [NATS_PRODUCER_PUBLISH_SPAN_ID]: SpanKind.Producer,
      [NATS_CONSUMER_ACK_SPAN_ID]: SpanKind.Producer,
      [NATS_CONSUMER_SPLIT_SPAN_ID]: SpanKind.Server,
    });
  });

  test("a drop filter on CONSUMER drops the consumer's delivery, never nats-server's", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      .mockResolvedValue([dropFilter("kind = 'SPAN_KIND_CONSUMER'")]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest(natsJetStreamResources()),
    );

    expect(spanIdsOf(captured.spans)).toEqual(
      [
        NATS_BROKER_PUB_SPAN_ID,
        NATS_BROKER_SPLIT_SPAN_ID,
        NATS_BROKER_CLIENT_TYPED_MSG_SPAN_ID,
        NATS_BROKER_CLIENT_TYPED_ACK_SPAN_ID,
        NATS_PRODUCER_PUBLISH_SPAN_ID,
        NATS_CONSUMER_ACK_SPAN_ID,
      ].sort(),
    );
  });
});

/*
 * mosquitto 2 and its clients, as OBI v0.14.0 captured them (values from
 * Fixtures/ObiMessaging): mosquitto reads mqtt-publisher's PUBLISH (typed
 * receiving-side) and writes it on to mqtt-subscriber first, which OBI types
 * client-side: a PRODUCER naming the subscriber at the ephemeral port it
 * connected from. The publisher's own PUBLISH names mosquitto's port 1883.
 * And a Kafka client reaching its broker at a port Docker published in the
 * ephemeral range: Kafka is never re-typed.
 */
function capturedMqttAttributes(data: {
  serverAddress: string;
  serverPort: number;
  peerAddress: string;
  peerPort: number;
  operation: "publish" | "process";
  topic: string;
  servicePeerName?: string;
}): Array<OtlpAttribute> {
  return [
    stringIntAttribute("server.port", data.serverPort),
    stringAttribute("messaging.system", "mqtt"),
    stringAttribute("messaging.destination.name", data.topic),
    stringAttribute("server.address", data.serverAddress),
    stringAttribute("messaging.operation.name", data.operation),
    stringAttribute(
      "messaging.operation.type",
      data.operation === "publish" ? "send" : "process",
    ),
    ...(data.servicePeerName
      ? [stringAttribute("service.peer.name", data.servicePeerName)]
      : []),
    stringAttribute("network.peer.address", data.peerAddress),
    stringIntAttribute("network.peer.port", data.peerPort),
  ];
}

const MQTT_SENSORS_TEMP_KEY: string = queueKey("mqtt", "sensors/temp");

const MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID: string = "3e41acc7106be89f";
const MOSQUITTO_READ_PUBLISH_SPAN_ID: string = "b011223344556678";
const MQTT_PUBLISHER_PUBLISH_SPAN_ID: string = "c011223344556679";
const MQTT_SUBSCRIBER_DELIVERY_SPAN_ID: string = "d01122334455667a";
const MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID: string = "e01122334455667b";
const KAFKA_PUBLISHED_PORT_PRODUCE_SPAN_ID: string = "f01122334455667c";

function mosquittoResources(): Array<ResourceSpansInput> {
  return [
    {
      serviceName: "mosquitto",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID,
          name: "publish sensors/temp",
          kind: PRODUCER_KIND,
          attributes: capturedMqttAttributes({
            serverAddress: "mqtt-subscriber",
            serverPort: 37910,
            peerAddress: "10.244.1.78",
            peerPort: 37910,
            operation: "publish",
            topic: "sensors/temp",
            servicePeerName: "mqtt-subscriber",
          }),
        },
        {
          spanId: MOSQUITTO_READ_PUBLISH_SPAN_ID,
          name: "publish sensors/temp",
          kind: PRODUCER_KIND,
          attributes: capturedMqttAttributes({
            serverAddress: "mosquitto",
            serverPort: 1883,
            peerAddress: "10.244.1.76",
            peerPort: 51976,
            operation: "publish",
            topic: "sensors/temp",
          }),
        },
      ],
    },
    {
      serviceName: "mqtt-publisher",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: MQTT_PUBLISHER_PUBLISH_SPAN_ID,
          name: "publish sensors/temp",
          kind: PRODUCER_KIND,
          attributes: capturedMqttAttributes({
            serverAddress: "mosquitto",
            serverPort: 1883,
            peerAddress: "10.96.56.243",
            peerPort: 1883,
            operation: "publish",
            topic: "sensors/temp",
            servicePeerName: "mosquitto",
          }),
        },
      ],
    },
    {
      serviceName: "mqtt-subscriber",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          // The delivery, reversed: server.address its own name.
          spanId: MQTT_SUBSCRIBER_DELIVERY_SPAN_ID,
          name: "publish sensors/temp",
          kind: PRODUCER_KIND,
          attributes: capturedMqttAttributes({
            serverAddress: "mqtt-subscriber",
            serverPort: 37910,
            peerAddress: "10.96.56.243",
            peerPort: 1883,
            operation: "publish",
            topic: "sensors/temp",
          }),
        },
        {
          spanId: MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID,
          name: "process sensors/#",
          kind: CONSUMER_KIND,
          attributes: capturedMqttAttributes({
            serverAddress: "mosquitto",
            serverPort: 1883,
            peerAddress: "10.96.56.243",
            peerPort: 1883,
            operation: "process",
            topic: "sensors/#",
            servicePeerName: "mosquitto",
          }),
        },
      ],
    },
    {
      serviceName: "orders-api",
      resourceAttributes: natsNodeResourceAttributes(),
      spans: [
        {
          spanId: KAFKA_PUBLISHED_PORT_PRODUCE_SPAN_ID,
          name: "publish orders",
          kind: PRODUCER_KIND,
          attributes: [
            ...kafkaAttributes({
              serverAddress: "kafka",
              operation: "publish",
              servicePeerName: "kafka",
            }).filter((attribute: OtlpAttribute): boolean => {
              return attribute.key !== "server.port";
            }),
            stringIntAttribute("server.port", 49154),
            stringAttribute("network.peer.address", "172.18.0.1"),
            stringIntAttribute("network.peer.port", 49154),
          ],
        },
      ],
    },
  ];
}

describe("OBI publishes typed client-side on a broker, at ingest", () => {
  test("mosquitto's PUBLISH to a subscriber is stored as SERVER with no queue key, like the PUBLISH it read; the publisher keeps PRODUCER and its key, so the topic is discovered from its span alone; a Kafka client at a published high port keeps PRODUCER", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest(mosquittoResources()),
    );

    expect(captured.spans).toHaveLength(6);
    const broker: TelemetryServiceMetadata = issuedFor("mosquitto");
    for (const spanId of [
      MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID,
      MOSQUITTO_READ_PUBLISH_SPAN_ID,
    ]) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, kind: row["kind"] }).toEqual({
        spanId: spanId,
        kind: SpanKind.Server,
      });
      expect(row["entityKeys"]).toBe(broker.entityKeys);
    }

    const publisherRow: JSONObject = spanById(
      captured.spans,
      MQTT_PUBLISHER_PUBLISH_SPAN_ID,
    );
    expect(publisherRow["kind"]).toBe(SpanKind.Producer);
    expect(publisherRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      MQTT_SENSORS_TEMP_KEY,
    ]);
    expect(
      spanById(captured.spans, MQTT_SUBSCRIBER_DELIVERY_SPAN_ID)["kind"],
    ).toBe(SpanKind.Server);
    expect(
      spanById(captured.spans, MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID)["kind"],
    ).toBe(SpanKind.Consumer);
    const kafkaRow: JSONObject = spanById(
      captured.spans,
      KAFKA_PUBLISHED_PORT_PRODUCE_SPAN_ID,
    );
    expect(kafkaRow["kind"]).toBe(SpanKind.Producer);
    expect(kafkaRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      KAFKA_ORDERS_KEY,
    ]);

    // Keyed once: the publisher's PUBLISH, not mosquitto's.
    expect(
      spanIdsOf(
        captured.spans.filter((row: JSONObject): boolean => {
          return (row["entityKeys"] as Array<string>).includes(
            MQTT_SENSORS_TEMP_KEY,
          );
        }),
      ),
    ).toEqual([MQTT_PUBLISHER_PUBLISH_SPAN_ID]);

    const discovered: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows(captured.spans.map(discoveryRowFor));
    const sensors: DiscoveredMessageQueue | undefined = discovered.find(
      (queue: DiscoveredMessageQueue): boolean => {
        return (
          keyForMessageQueue(PROJECT_ID.toString(), queue.identity) ===
          MQTT_SENSORS_TEMP_KEY
        );
      },
    );
    expect(sensors?.spans?.count).toBe(1);
    const orders: DiscoveredMessageQueue | undefined = discovered.find(
      (queue: DiscoveredMessageQueue): boolean => {
        return (
          keyForMessageQueue(PROJECT_ID.toString(), queue.identity) ===
          KAFKA_ORDERS_KEY
        );
      },
    );
    expect(orders?.spans?.count).toBe(1);

    // The broker's rows alone are no messaging evidence.
    expect(
      resolveMessagingSpanDiscoveryRows(
        [
          MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID,
          MOSQUITTO_READ_PUBLISH_SPAN_ID,
        ].map((spanId: string): MessagingSpanDiscoveryRow => {
          return discoveryRowFor(spanById(captured.spans, spanId));
        }),
      ),
    ).toEqual([]);
    expectEveryResourceArrayUntouched();
  });

  test("the same payload with the kinds OBI v0.13 sent (SERVER for every MQTTServer span) is stored the same: v0.13 sent mosquitto's PUBLISH to a subscriber as PRODUCER too", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const v013: Array<ResourceSpansInput> = mosquittoResources().map(
      (resource: ResourceSpansInput): ResourceSpansInput => {
        return {
          ...resource,
          resourceAttributes: resource.resourceAttributes.map(
            (attribute: OtlpAttribute): OtlpAttribute => {
              return attribute.key === "telemetry.distro.version"
                ? stringAttribute("telemetry.distro.version", "v0.13.0")
                : attribute;
            },
          ),
          spans: resource.spans.map((span: SpanInput): SpanInput => {
            return [
              MOSQUITTO_READ_PUBLISH_SPAN_ID,
              MQTT_SUBSCRIBER_DELIVERY_SPAN_ID,
            ].includes(span.spanId)
              ? { ...span, kind: SERVER_KIND }
              : span;
          }),
        };
      },
    );

    await OtelTracesIngestService.processTracesFromQueue(tracesRequest(v013));

    const kinds: Record<string, unknown> = {};
    for (const row of captured.spans) {
      kinds[row["spanId"] as string] = row["kind"];
    }
    expect(kinds).toEqual({
      [MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID]: SpanKind.Server,
      [MOSQUITTO_READ_PUBLISH_SPAN_ID]: SpanKind.Server,
      [MQTT_PUBLISHER_PUBLISH_SPAN_ID]: SpanKind.Producer,
      [MQTT_SUBSCRIBER_DELIVERY_SPAN_ID]: SpanKind.Server,
      [MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID]: SpanKind.Consumer,
      [KAFKA_PUBLISHED_PORT_PRODUCE_SPAN_ID]: SpanKind.Producer,
    });
  });

  test("from an install whose attributes.select drops network.peer.port, mosquitto's PUBLISH to a subscriber is still SERVER by its service.peer.name and server.port, and the topic is still keyed by the publisher alone", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const withoutPeerPort: Array<ResourceSpansInput> = mosquittoResources().map(
      (resource: ResourceSpansInput): ResourceSpansInput => {
        return {
          ...resource,
          spans: resource.spans.map((span: SpanInput): SpanInput => {
            return {
              ...span,
              attributes: span.attributes.filter(
                (attribute: OtlpAttribute): boolean => {
                  return attribute.key !== "network.peer.port";
                },
              ),
            };
          }),
        };
      },
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest(withoutPeerPort),
    );

    const kinds: Record<string, unknown> = {};
    for (const row of captured.spans) {
      kinds[row["spanId"] as string] = row["kind"];
    }
    expect(kinds).toEqual({
      [MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID]: SpanKind.Server,
      // No peer name: the address, mosquitto's own name, decides.
      [MOSQUITTO_READ_PUBLISH_SPAN_ID]: SpanKind.Server,
      [MQTT_PUBLISHER_PUBLISH_SPAN_ID]: SpanKind.Producer,
      [MQTT_SUBSCRIBER_DELIVERY_SPAN_ID]: SpanKind.Server,
      [MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID]: SpanKind.Consumer,
      [KAFKA_PUBLISHED_PORT_PRODUCE_SPAN_ID]: SpanKind.Producer,
    });
    expect(
      spanIdsOf(
        captured.spans.filter((row: JSONObject): boolean => {
          return (row["entityKeys"] as Array<string>).includes(
            MQTT_SENSORS_TEMP_KEY,
          );
        }),
      ),
    ).toEqual([MQTT_PUBLISHER_PUBLISH_SPAN_ID]);
    expectEveryResourceArrayUntouched();
  });

  test("a drop filter on PRODUCER drops the publisher's PUBLISH and the Kafka produce, never mosquitto's", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      .mockResolvedValue([dropFilter("kind = 'SPAN_KIND_PRODUCER'")]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest(mosquittoResources()),
    );

    expect(spanIdsOf(captured.spans)).toEqual(
      [
        MOSQUITTO_PUBLISH_TO_SUBSCRIBER_SPAN_ID,
        MOSQUITTO_READ_PUBLISH_SPAN_ID,
        MQTT_SUBSCRIBER_DELIVERY_SPAN_ID,
        MQTT_SUBSCRIBER_SUBSCRIBE_SPAN_ID,
      ].sort(),
    );
  });
});

/*
 * Every captured span replayed as the request body it was: OBI's OTLP/JSON
 * export, verbatim (Fixtures/ObiMessaging), through the real attribute
 * flattening and the string int64 ports. Each row's stored kind must be the
 * one the fixture's truth table names, derived from OBI's own trace
 * printer — SERVER for a client's split delivery whose server.address is
 * its own name, the rule's documented limitation.
 */
type FixtureTruth = {
  spanId: string;
  shape: string;
  role: "broker" | "client";
  expectedStoredKind: string;
};

const FIXTURE_DIR: string = path.join(__dirname, "Fixtures", "ObiMessaging");

describe("captured OBI spans replayed through the ingest service", () => {
  test.each(["v0.13.0", "v0.14.0"])(
    "OBI %s: every span is stored with the kind its truth table names, a SERVER row keeps its resource's shared array, and no broker span is messaging evidence, B3-main and mosquitto's PUBLISH to a subscriber included",
    async (obiVersion: string) => {
      const captured: CapturedTraceRows = setupTraceMocks();
      const fixture: { spans: Array<FixtureTruth>; body: JSONObject } =
        JSON.parse(
          fs.readFileSync(
            path.join(FIXTURE_DIR, `obi-${obiVersion}.json`),
            "utf8",
          ),
        ) as { spans: Array<FixtureTruth>; body: JSONObject };

      await OtelTracesIngestService.processTracesFromQueue({
        projectId: PROJECT_ID,
        body: fixture.body,
        headers: {},
      } as unknown as TelemetryRequest);

      expect(captured.spans).toHaveLength(fixture.spans.length);
      expect(
        fixture.spans.map((span: FixtureTruth) => {
          return {
            spanId: span.spanId,
            shape: span.shape,
            kind: spanById(captured.spans, span.spanId)["kind"],
          };
        }),
      ).toEqual(
        fixture.spans.map((span: FixtureTruth) => {
          return {
            spanId: span.spanId,
            shape: span.shape,
            kind: span.expectedStoredKind,
          };
        }),
      );

      for (const span of fixture.spans) {
        const row: JSONObject = spanById(captured.spans, span.spanId);
        if (row["kind"] !== SpanKind.Server) {
          continue;
        }
        expect({
          spanId: span.spanId,
          sharedArray: issuedMetadata.some(
            (metadata: TelemetryServiceMetadata): boolean => {
              return metadata.entityKeys === row["entityKeys"];
            },
          ),
        }).toEqual({ spanId: span.spanId, sharedArray: true });
      }
      expectEveryResourceArrayUntouched();

      const brokerSpans: Array<FixtureTruth> = fixture.spans.filter(
        (span: FixtureTruth): boolean => {
          return span.role === "broker";
        },
      );
      expect(
        brokerSpans
          .map((span: FixtureTruth): string => {
            return span.shape;
          })
          .filter((shape: string): boolean => {
            return ["B3-main", "MQTT broker publish"].includes(shape);
          }).length,
      ).toBeGreaterThan(0);
      const brokerRows: Array<JSONObject> = brokerSpans.map(
        (span: FixtureTruth): JSONObject => {
          return spanById(captured.spans, span.spanId);
        },
      );
      for (const row of brokerRows) {
        expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
      }
      expect(
        resolveMessagingSpanDiscoveryRows(brokerRows.map(discoveryRowFor)),
      ).toEqual([]);
    },
  );
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
