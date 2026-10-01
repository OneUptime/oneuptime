import {
  OBI_RECEIVING_SIDE_MESSAGING_SYSTEMS,
  OBI_TELEMETRY_DISTRO_NAME,
  isObiReceivingSideMessagingSpan,
  normalizeObiReceivingSideMessagingSpanKind,
} from "../../FeatureSet/Telemetry/Utils/ObiReceivingSideMessagingSpan";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { describe, expect, test } from "@jest/globals";

/*
 * OBI v0.14 (#3306) exports the Kafka, MQTT and NATS spans it records on
 * the RECEIVING side of a connection (a broker serving a produce or fetch, a
 * subscriber handed a delivery) as PRODUCER / CONSUMER instead of v0.13's
 * SERVER. These pin which spans the ingest service stores as SERVER again.
 *
 * The fixtures are the attribute maps the ingest service builds for OBI's
 * spans: span attributes bare, exactly as OBI v0.14's tracesgen.go writes
 * them for a messaging event (server.port and messaging.kafka.offset as
 * numbers, the partition as a string), resource attributes
 * `resource.`-prefixed.
 */

type Attributes = Record<string, unknown>;

function obiResource(serviceName: string): Attributes {
  return {
    "resource.service.name": serviceName,
    "resource.service.namespace": "messaging",
    "resource.telemetry.sdk.name": "opentelemetry",
    "resource.telemetry.sdk.language": "java",
    "resource.telemetry.distro.name": "opentelemetry-ebpf-instrumentation",
    "resource.telemetry.distro.version": "v0.14.0",
    "resource.k8s.namespace.name": "messaging",
    "resource.k8s.cluster.name": "prod-eu",
  };
}

// A Kafka broker (service "kafka") handling a Produce for topic "orders".
const KAFKA_BROKER_PRODUCE: Attributes = {
  ...obiResource("kafka"),
  "server.port": 9092,
  "messaging.system": "kafka",
  "messaging.client.id": "orders-api-producer-1",
  "messaging.destination.name": "orders",
  "server.address": "kafka",
  "messaging.operation.name": "publish",
  "messaging.operation.type": "send",
  "messaging.destination.partition.id": "0",
};

// The same broker serving a Fetch: process, with partition and offset.
const KAFKA_BROKER_FETCH: Attributes = {
  ...obiResource("kafka"),
  "server.port": 9092,
  "messaging.system": "kafka",
  "messaging.client.id": "billing-consumer-1",
  "messaging.destination.name": "orders",
  "server.address": "kafka",
  "messaging.operation.name": "process",
  "messaging.operation.type": "process",
  "messaging.destination.partition.id": "0",
  "messaging.kafka.offset": 1042,
};

// The application's own produce: a client span, server.address names the broker.
const KAFKA_APP_PRODUCE: Attributes = {
  ...obiResource("orders-api"),
  "server.port": 9092,
  "messaging.system": "kafka",
  "messaging.client.id": "orders-api-producer-1",
  "messaging.destination.name": "orders",
  "server.address": "kafka",
  "messaging.operation.name": "publish",
  "messaging.operation.type": "send",
  "service.peer.name": "kafka",
  "messaging.destination.partition.id": "0",
};

function mqttSpan(
  serviceName: string,
  serverAddress: string,
  operation: { name: string; type: string },
): Attributes {
  return {
    ...obiResource(serviceName),
    "server.port": 1883,
    "messaging.system": "mqtt",
    "messaging.destination.name": "sensors/temperature",
    "messaging.client.id": "sensor-17",
    "server.address": serverAddress,
    "messaging.operation.name": operation.name,
    "messaging.operation.type": operation.type,
  };
}

function natsSpan(
  serviceName: string,
  serverAddress: string,
  operation: { name: string; type: string },
): Attributes {
  return {
    ...obiResource(serviceName),
    "server.port": 4222,
    "messaging.system": "nats",
    "messaging.message.envelope.size": 128,
    "messaging.destination.name": "orders.created",
    "messaging.client.id": "orders-api",
    "server.address": serverAddress,
    "messaging.operation.name": operation.name,
    "messaging.operation.type": operation.type,
  };
}

const PUBLISH: { name: string; type: string } = {
  name: "publish",
  type: "send",
};
const PROCESS: { name: string; type: string } = {
  name: "process",
  type: "process",
};

function withAttributes(
  base: Attributes,
  changes: Record<string, unknown>,
): Attributes {
  const result: Attributes = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result;
}

describe("isObiReceivingSideMessagingSpan", () => {
  test("a Kafka broker's produce span (OBI v0.14 PRODUCER, server.address = its own service.name) is receiving-side", () => {
    expect(isObiReceivingSideMessagingSpan(KAFKA_BROKER_PRODUCE)).toBe(true);
  });

  test("a Kafka broker's fetch span (process, partition and offset) is receiving-side", () => {
    expect(isObiReceivingSideMessagingSpan(KAFKA_BROKER_FETCH)).toBe(true);
  });

  test.each([
    [
      "mosquitto handling a PUBLISH",
      mqttSpan("mosquitto", "mosquitto", PUBLISH),
    ],
    [
      "mosquitto handling a SUBSCRIBE",
      mqttSpan("mosquitto", "mosquitto", PROCESS),
    ],
    [
      "a subscriber's reversed PUBLISH (the broker's delivery)",
      mqttSpan("temperature-alerts", "temperature-alerts", PUBLISH),
    ],
    [
      "an operation OBI cannot name (INTERNAL in v0.14)",
      mqttSpan("mosquitto", "mosquitto", { name: "unknown", type: "unknown" }),
    ],
    [
      "nats-server handling a PUB",
      natsSpan("nats-server", "nats-server", PUBLISH),
    ],
    [
      "nats-server handling a delivery",
      natsSpan("nats-server", "nats-server", PROCESS),
    ],
    [
      "a subscriber's reversed MSG",
      natsSpan("order-notifier", "order-notifier", PROCESS),
    ],
  ])("MQTT / NATS receiving side: %s", (_label: string, span: Attributes) => {
    expect(isObiReceivingSideMessagingSpan(span)).toBe(true);
  });

  test("an application's own OBI Kafka / MQTT / NATS client span (server.address names the broker) is not", () => {
    expect(isObiReceivingSideMessagingSpan(KAFKA_APP_PRODUCE)).toBe(false);
    // Even without service.peer.name (v0.14 makes it opt-in), the address decides.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_APP_PRODUCE, { "service.peer.name": undefined }),
      ),
    ).toBe(false);
    expect(
      isObiReceivingSideMessagingSpan(
        mqttSpan("temperature-sensor", "mosquitto", PUBLISH),
      ),
    ).toBe(false);
    expect(
      isObiReceivingSideMessagingSpan(
        natsSpan("orders-api", "nats-server", PUBLISH),
      ),
    ).toBe(false);
  });

  test("service.peer.name or peer.service marks a client-typed span: never receiving-side, even when server.address equals service.name", () => {
    /*
     * An application talking to a broker that resolves to its own name (a
     * broker in the same pod: OBI names the pod IP after the pod's service).
     */
    for (const key of ["service.peer.name", "peer.service"]) {
      expect({
        key: key,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(KAFKA_BROKER_PRODUCE, { [key]: "kafka" }),
        ),
      }).toEqual({ key: key, receivingSide: false });
    }
    // An empty one names no peer (OBI never writes one).
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_BROKER_PRODUCE, {
          "service.peer.name": "",
          "peer.service": null,
        }),
      ),
    ).toBe(true);
  });

  test("only OBI's spans: another distro, a missing distro, or an SDK span with the same attributes is not", () => {
    for (const distro of [
      undefined,
      "",
      "beyla",
      "opentelemetry-java-instrumentation",
      "Opentelemetry-ebpf-instrumentation",
      " opentelemetry-ebpf-instrumentation",
    ]) {
      expect({
        distro: distro,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(KAFKA_BROKER_PRODUCE, {
            "resource.telemetry.distro.name": distro,
          }),
        ),
      }).toEqual({ distro: distro, receivingSide: false });
    }

    // A bare (not resource.-prefixed) distro key is a span attribute, not OBI's.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_BROKER_PRODUCE, {
          "resource.telemetry.distro.name": undefined,
          "telemetry.distro.name": OBI_TELEMETRY_DISTRO_NAME,
        }),
      ),
    ).toBe(false);

    // A Java agent producer whose service shares the broker's host name.
    expect(
      isObiReceivingSideMessagingSpan({
        "resource.service.name": "kafka",
        "resource.telemetry.sdk.name": "opentelemetry",
        "resource.telemetry.distro.name": "opentelemetry-java-instrumentation",
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        "messaging.operation.type": "send",
        "server.address": "kafka",
      }),
    ).toBe(false);
  });

  test("only the systems OBI sees from the receiving side: AMQP, RabbitMQ, SQS and others are not", () => {
    expect(Array.from(OBI_RECEIVING_SIDE_MESSAGING_SYSTEMS).sort()).toEqual([
      "kafka",
      "mqtt",
      "nats",
    ]);
    for (const system of [
      "amqp",
      "rabbitmq",
      "aws_sqs",
      "aws.sns",
      "servicebus",
      "pulsar",
      "Kafka",
      " kafka",
      "",
      undefined,
    ]) {
      expect({
        system: system,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(KAFKA_BROKER_PRODUCE, { "messaging.system": system }),
        ),
      }).toEqual({ system: system, receivingSide: false });
    }
  });

  test("a missing, empty or non-string server.address or service.name is not", () => {
    const cases: Array<Record<string, unknown>> = [
      { "server.address": undefined },
      { "server.address": "", "resource.service.name": "" },
      { "server.address": null },
      { "server.address": 9092, "resource.service.name": 9092 },
      { "server.address": ["kafka"], "resource.service.name": ["kafka"] },
      { "resource.service.name": undefined },
      { "resource.service.name": "" },
    ];
    for (const changes of cases) {
      expect({
        changes: changes,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(KAFKA_BROKER_PRODUCE, changes),
        ),
      }).toEqual({ changes: changes, receivingSide: false });
    }
  });

  test("names are compared exactly: a case or whitespace difference is a different name", () => {
    /*
     * OBI writes both from one string, so a receiving-side span never
     * differs; a looser match could only hide an application's client span.
     */
    for (const serverAddress of [
      "Kafka",
      "KAFKA",
      " kafka",
      "kafka ",
      "kafka.",
    ]) {
      expect({
        serverAddress: serverAddress,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(KAFKA_BROKER_PRODUCE, {
            "server.address": serverAddress,
          }),
        ),
      }).toEqual({ serverAddress: serverAddress, receivingSide: false });
    }
    // A broker whose service name is itself mixed case still matches itself.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_BROKER_PRODUCE, {
          "resource.service.name": "Kafka-Broker",
          "server.address": "Kafka-Broker",
        }),
      ),
    ).toBe(true);
  });

  test("a cross-namespace client address (OBI's name.namespace form) is never the caller's own name", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_APP_PRODUCE, {
          "server.address": "kafka.messaging",
          "service.peer.name": undefined,
        }),
      ),
    ).toBe(false);
  });

  test("no attributes at all is not", () => {
    expect(isObiReceivingSideMessagingSpan(undefined)).toBe(false);
    expect(isObiReceivingSideMessagingSpan(null)).toBe(false);
    expect(isObiReceivingSideMessagingSpan({})).toBe(false);
  });
});

describe("normalizeObiReceivingSideMessagingSpanKind", () => {
  test("every kind v0.14 gives a receiving-side messaging span is stored as SERVER", () => {
    for (const kind of [
      SpanKind.Producer,
      SpanKind.Consumer,
      SpanKind.Client,
      SpanKind.Internal,
    ]) {
      expect({
        kind: kind,
        stored: normalizeObiReceivingSideMessagingSpanKind({
          kind: kind,
          attributes: KAFKA_BROKER_PRODUCE,
        }),
      }).toEqual({ kind: kind, stored: SpanKind.Server });
    }
  });

  test("a SERVER span (v0.13's kind for the same span) stays SERVER", () => {
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Server,
        attributes: KAFKA_BROKER_FETCH,
      }),
    ).toBe(SpanKind.Server);
  });

  test("a kind that is none of the five is left as it is", () => {
    const unknownKind: SpanKind = "SPAN_KIND_UNSPECIFIED" as SpanKind;
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: unknownKind,
        attributes: KAFKA_BROKER_PRODUCE,
      }),
    ).toBe(unknownKind);
  });

  test("client spans and spans that are not OBI's keep their kind", () => {
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Producer,
        attributes: KAFKA_APP_PRODUCE,
      }),
    ).toBe(SpanKind.Producer);
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Consumer,
        attributes: withAttributes(KAFKA_BROKER_FETCH, {
          "resource.telemetry.distro.name": undefined,
        }),
      }),
    ).toBe(SpanKind.Consumer);
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Client,
        attributes: null,
      }),
    ).toBe(SpanKind.Client);
  });

  test("a span that is not OBI's costs one property read", () => {
    const reads: Array<string> = [];
    const attributes: Attributes = new Proxy(
      { ...KAFKA_BROKER_PRODUCE, "resource.telemetry.distro.name": "other" },
      {
        get: (target: Attributes, key: string | symbol): unknown => {
          reads.push(String(key));
          return target[key as string];
        },
      },
    );
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Producer,
        attributes: attributes,
      }),
    ).toBe(SpanKind.Producer);
    expect(reads).toEqual(["resource.telemetry.distro.name"]);

    // A SERVER span is not even read.
    reads.length = 0;
    normalizeObiReceivingSideMessagingSpanKind({
      kind: SpanKind.Server,
      attributes: attributes,
    });
    expect(reads).toEqual([]);
  });
});
