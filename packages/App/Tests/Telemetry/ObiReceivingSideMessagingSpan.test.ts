import {
  OBI_RECEIVING_SIDE_MESSAGING_SYSTEMS,
  OBI_TELEMETRY_DISTRO_NAME,
  isObiReceivingSideMessagingSpan,
  normalizeObiReceivingSideMessagingSpanKind,
} from "../../FeatureSet/Telemetry/Utils/ObiReceivingSideMessagingSpan";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { EPHEMERAL_PORT_RANGE_START } from "Common/Types/DatabaseServer/DatabaseEndpoint";
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

/*
 * Spans as OBI v0.14.0 exported them in KinD from a real nats-server 2.11
 * (traced by OBI's generic tracer, as it is for a Go binary OBI has no
 * offsets for) and its nats.js clients, a host-network nats-server, a NATS
 * broker outside the cluster, and mosquitto, labelled with OBI's own event
 * type by its trace printer (Fixtures/ObiMessaging holds the spans
 * themselves). Ports are OTLP int64s, so they reach the attribute map as
 * decimal strings.
 *
 * The NATS shapes, as Fixtures/ObiMessaging names them. On a client: C1 its
 * PUB; C2 the MSG OBI splits off its ack, pull or request, typed NATSServer
 * but not reversed (server.address names the broker, network.peer is the
 * client itself); C3 a MSG OBI reversed (server.address is the client's
 * own name). On nats-server: B1 a PUB it read; B2 a MSG it delivered; B3
 * the MSG OBI splits off an exchange the broker wrote first (server.address
 * names the subscriber, network.peer is the broker itself); B3-main that
 * exchange's PUB and B4 a MSG the broker wrote, both typed client-side.
 */
function capturedNats(data: {
  service: string;
  serverAddress: string;
  serverPort: string | number;
  peerAddress: string;
  peerPort: string | number;
  operation: "publish" | "process";
  subject: string;
  servicePeerName?: string;
}): Attributes {
  const attributes: Attributes = {
    ...obiResource(data.service),
    "resource.k8s.node.name": "fu-nats-worker",
    "server.port": data.serverPort,
    "messaging.system": "nats",
    "messaging.message.envelope.size": "12",
    "messaging.destination.name": data.subject,
    "server.address": data.serverAddress,
    "messaging.operation.name": data.operation,
    "messaging.operation.type":
      data.operation === "publish" ? "send" : "process",
    "network.peer.address": data.peerAddress,
    "network.peer.port": data.peerPort,
    "span.metrics.skip": true,
  };
  if (data.servicePeerName) {
    attributes["service.peer.name"] = data.servicePeerName;
  }
  return attributes;
}

// C1: a JetStream producer's publish, through the broker's Service.
const NATS_CLIENT_PUBLISH: Attributes = capturedNats({
  service: "js-producer",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.96.212.229",
  peerPort: "4222",
  operation: "publish",
  subject: "js.orders.created",
  servicePeerName: "nats",
});
// C1: a pull consumer's ack.
const NATS_CLIENT_ACK_PUBLISH: Attributes = capturedNats({
  service: "js-pull-consumer",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.96.212.229",
  peerPort: "4222",
  operation: "publish",
  subject: "$JS.ACK.ORDERS.billing.1.179.179.1791058721653797801.0",
  servicePeerName: "nats",
});
// C2: the same consumer's delivery, split off its ack.
const NATS_CLIENT_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "js-pull-consumer",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.244.1.59",
  peerPort: "54276",
  operation: "process",
  subject: "js.orders.created",
});
// C3: a subscriber's reversed MSG.
const NATS_SUBSCRIBER_REVERSED_DELIVERY: Attributes = capturedNats({
  service: "ps-subscriber",
  serverAddress: "ps-subscriber",
  serverPort: "45586",
  peerAddress: "10.96.212.229",
  peerPort: "4222",
  operation: "process",
  subject: "ps.orders.created",
});
// B1 and B2: nats-server reading a request and delivering its reply.
const NATS_BROKER_PUB: Attributes = capturedNats({
  service: "nats",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.244.1.79",
  peerPort: "37514",
  operation: "publish",
  subject: "rr.echo",
});
const NATS_BROKER_DELIVERY: Attributes = capturedNats({
  service: "nats",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.244.1.79",
  peerPort: "37514",
  operation: "process",
  subject: "_INBOX.1UIX0POKYH4WEEUFDMDL8J.1UIX0POKYH4WEEUFDMDVO3",
});
// B3: the pull consumer's delivery, split off on nats-server.
const NATS_BROKER_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "nats",
  serverAddress: "js-pull-consumer",
  serverPort: "54276",
  peerAddress: "10.244.1.72",
  peerPort: "4222",
  operation: "process",
  subject: "js.orders.created",
});
// B3-main: the ack nats-server read in that exchange.
const NATS_BROKER_CLIENT_TYPED_ACK: Attributes = capturedNats({
  service: "nats",
  serverAddress: "js-pull-consumer",
  serverPort: "54276",
  peerAddress: "10.244.1.59",
  peerPort: "54276",
  operation: "publish",
  subject: "$JS.ACK.ORDERS.billing.1.179.179.1791058721653797801.0",
  servicePeerName: "js-pull-consumer",
});
// B4: a MSG nats-server wrote to the pull consumer.
const NATS_BROKER_CLIENT_TYPED_DELIVERY: Attributes = capturedNats({
  service: "nats",
  serverAddress: "js-pull-consumer",
  serverPort: "54276",
  peerAddress: "10.244.1.59",
  peerPort: "54276",
  operation: "process",
  subject: "js.orders.created",
  servicePeerName: "js-pull-consumer",
});
// A host-network nats-server: OBI names its own address after the node.
const NATS_HOSTNET_BROKER_PUB: Attributes = capturedNats({
  service: "nats-hostnet",
  serverAddress: "fu-nats-worker",
  serverPort: "4223",
  peerAddress: "10.244.1.65",
  peerPort: "33408",
  operation: "publish",
  subject: "hn.orders.created",
});
const NATS_HOSTNET_BROKER_DELIVERY: Attributes = capturedNats({
  service: "nats-hostnet",
  serverAddress: "fu-nats-worker",
  serverPort: "4223",
  peerAddress: "10.244.1.65",
  peerPort: "33408",
  operation: "process",
  subject: "_INBOX.7JM2IYAQZCNN6RFH0K50NW.7JM2IYAQZCNN6RFH0K5S2K",
});
const NATS_HOSTNET_BROKER_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "nats-hostnet",
  serverAddress: "hn-js-push-consumer",
  serverPort: "50380",
  peerAddress: "172.21.0.10",
  peerPort: "4223",
  operation: "process",
  subject: "hn.orders.created",
});
const NATS_HOSTNET_BROKER_CLIENT_TYPED_DELIVERY: Attributes = capturedNats({
  service: "nats-hostnet",
  serverAddress: "hn-js-push-consumer",
  serverPort: "33068",
  peerAddress: "10.244.1.97",
  peerPort: "33068",
  operation: "process",
  subject: "hn.orders.created",
  servicePeerName: "hn-js-push-consumer",
});
// A push consumer of the host-network broker, through its Service.
const NATS_HOSTNET_CLIENT_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "hn-js-push-consumer",
  serverAddress: "nats-hostnet",
  serverPort: "4223",
  peerAddress: "10.244.1.69",
  peerPort: "50380",
  operation: "process",
  subject: "hn.orders.created",
});
// A client of a broker outside the cluster, which OBI cannot name.
const NATS_EXTERNAL_CLIENT_PUBLISH: Attributes = capturedNats({
  service: "ext-js-push-consumer",
  serverAddress: "172.21.0.11",
  serverPort: "4222",
  peerAddress: "172.21.0.11",
  peerPort: "4222",
  operation: "publish",
  subject: "$JS.ACK.EXTORDERS.ext-audit.1.4722.4722.1791058721538432301.0",
  servicePeerName: "172.21.0.11",
});
const NATS_EXTERNAL_CLIENT_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "ext-js-push-consumer",
  serverAddress: "ext-js-push-consumer",
  serverPort: "4222",
  peerAddress: "10.244.1.71",
  peerPort: "43148",
  operation: "process",
  subject: "ext.orders.created",
});
// An application whose service.name ("nats") is the broker's.
const NATS_APP_NAMED_NATS_PUBLISH: Attributes = capturedNats({
  service: "nats",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.96.212.229",
  peerPort: "4222",
  operation: "publish",
  subject: "rr.echo",
  servicePeerName: "nats",
});
const NATS_APP_NAMED_NATS_SPLIT_DELIVERY: Attributes = capturedNats({
  service: "nats",
  serverAddress: "nats",
  serverPort: "4222",
  peerAddress: "10.244.1.66",
  peerPort: "47100",
  operation: "process",
  subject: "_INBOX.7QCYHPHU9A7AHGHRELIM2Q.7QCYHPHU9A7AHGHRELIMB8",
});

type NatsShape = {
  shape: string;
  attributes: Attributes;
  // The kind OBI v0.14 exports, and the one stored.
  v014: SpanKind;
  stored: SpanKind;
  // The kind OBI v0.13 exports for the same span, and the one stored.
  v013: SpanKind;
  v013Stored: SpanKind;
};

const NATS_SHAPES: Array<NatsShape> = [
  {
    shape: "C1, a client's publish",
    attributes: NATS_CLIENT_PUBLISH,
    v014: SpanKind.Producer,
    stored: SpanKind.Producer,
    v013: SpanKind.Producer,
    v013Stored: SpanKind.Producer,
  },
  {
    shape: "C2, the delivery OBI splits off a client's ack",
    attributes: NATS_CLIENT_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Consumer,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "C3, a subscriber's reversed delivery",
    attributes: NATS_SUBSCRIBER_REVERSED_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "B1, nats-server reading a PUB",
    attributes: NATS_BROKER_PUB,
    v014: SpanKind.Producer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "B2, nats-server delivering a MSG",
    attributes: NATS_BROKER_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "B3, the delivery OBI splits off on nats-server",
    attributes: NATS_BROKER_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape:
      "B3-main, the ack nats-server read in that exchange, typed client-side",
    attributes: NATS_BROKER_CLIENT_TYPED_ACK,
    v014: SpanKind.Producer,
    stored: SpanKind.Server,
    v013: SpanKind.Producer,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "B4, a MSG nats-server wrote, typed client-side",
    attributes: NATS_BROKER_CLIENT_TYPED_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Consumer,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "host-network B1 (server.address names the node)",
    attributes: NATS_HOSTNET_BROKER_PUB,
    v014: SpanKind.Producer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "host-network B2 (server.address names the node)",
    attributes: NATS_HOSTNET_BROKER_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "host-network B3",
    attributes: NATS_HOSTNET_BROKER_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "host-network B4",
    attributes: NATS_HOSTNET_BROKER_CLIENT_TYPED_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Consumer,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "C2 from a host-network broker, through its Service",
    attributes: NATS_HOSTNET_CLIENT_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Consumer,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "C1 against a broker OBI cannot name (server.address its IP)",
    attributes: NATS_EXTERNAL_CLIENT_PUBLISH,
    v014: SpanKind.Producer,
    stored: SpanKind.Producer,
    v013: SpanKind.Producer,
    v013Stored: SpanKind.Producer,
  },
  {
    shape:
      "C2 from a broker OBI cannot name (server.address falls back to the client's own name)",
    attributes: NATS_EXTERNAL_CLIENT_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
  {
    shape: "C1 of an application named like its broker",
    attributes: NATS_APP_NAMED_NATS_PUBLISH,
    v014: SpanKind.Producer,
    stored: SpanKind.Producer,
    v013: SpanKind.Producer,
    v013Stored: SpanKind.Producer,
  },
  {
    shape:
      "C2 of an application named like its broker (server.address its own name)",
    attributes: NATS_APP_NAMED_NATS_SPLIT_DELIVERY,
    v014: SpanKind.Consumer,
    stored: SpanKind.Server,
    v013: SpanKind.Server,
    v013Stored: SpanKind.Server,
  },
];

describe("every NATS span shape OBI emits", () => {
  test.each(NATS_SHAPES)(
    "$shape: OBI v0.14's $v014 is stored as $stored",
    (data: NatsShape) => {
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: data.v014,
          attributes: data.attributes,
        }),
      ).toBe(data.stored);
    },
  );

  test.each(NATS_SHAPES)(
    "$shape: OBI v0.13's $v013 is stored as $v013Stored",
    (data: NatsShape) => {
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: data.v013,
          attributes: withAttributes(data.attributes, {
            "resource.telemetry.distro.version": "v0.13.0",
          }),
        }),
      ).toBe(data.v013Stored);
    },
  );

  test.each(
    NATS_SHAPES.filter((data: NatsShape): boolean => {
      return data.attributes["service.peer.name"] !== undefined;
    }),
  )(
    "$shape: an install that does not select service.peer.name (OBI v0.14's default) stores the same kind",
    (data: NatsShape) => {
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: data.v014,
          attributes: withAttributes(data.attributes, {
            "service.peer.name": undefined,
          }),
        }),
      ).toBe(data.stored);
    },
  );

  test("every shape of nats-server's is stored as SERVER, the PUB it read beside a split delivery too: the broker is no producer or consumer of a subject", () => {
    const brokerShapes: Array<NatsShape> = NATS_SHAPES.filter(
      (data: NatsShape): boolean => {
        return data.shape.match(/\bB[1-4]\b/) !== null;
      },
    );
    expect(brokerShapes).toHaveLength(9);
    for (const data of brokerShapes) {
      expect({
        shape: data.shape,
        stored: normalizeObiReceivingSideMessagingSpanKind({
          kind: data.v014,
          attributes: data.attributes,
        }),
      }).toEqual({ shape: data.shape, stored: SpanKind.Server });
    }
  });
});

describe("port evidence: which side OBI typed a span from", () => {
  test("NATS split deliveries are told apart at EPHEMERAL_PORT_RANGE_START, the first port of Linux's default ephemeral range", () => {
    expect(EPHEMERAL_PORT_RANGE_START).toBe(32768);
  });

  test.each([
    ["a client's publish", NATS_CLIENT_PUBLISH],
    ["a client's ack", NATS_CLIENT_ACK_PUBLISH],
    ["a client of a broker OBI cannot name", NATS_EXTERNAL_CLIENT_PUBLISH],
    ["an app whose service.name is the broker's", NATS_APP_NAMED_NATS_PUBLISH],
  ])(
    "client-typed (equal ports, the broker's listening port) is never receiving-side: %s — with or without service.peer.name",
    (_label: string, span: Attributes) => {
      expect(isObiReceivingSideMessagingSpan(span)).toBe(false);
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(span, { "service.peer.name": undefined }),
        ),
      ).toBe(false);
    },
  );

  test("service.peer.name is read before the ports: OBI writes it on client-typed spans only, so a span with one is client-typed whatever its ports say", () => {
    // nats-server's PUB, given a peer name after OBI: a client's publish.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_BROKER_PUB, { "service.peer.name": "js-producer" }),
      ),
    ).toBe(false);
    // A client's split delivery given one: a MSG this process wrote.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
          "service.peer.name": "nats",
        }),
      ),
    ).toBe(true);
  });

  test("an app named like its broker, without service.peer.name, stays a producer: the address alone would have made it SERVER", () => {
    const span: Attributes = withAttributes(NATS_APP_NAMED_NATS_PUBLISH, {
      "service.peer.name": undefined,
    });
    expect(span["server.address"]).toBe(span["resource.service.name"]);
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Producer,
        attributes: span,
      }),
    ).toBe(SpanKind.Producer);
    // Without network.peer.port the address decides, as it did before.
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Producer,
        attributes: withAttributes(span, { "network.peer.port": undefined }),
      }),
    ).toBe(SpanKind.Server);
  });

  test.each([
    ["nats-server handling a PUB", NATS_BROKER_PUB],
    ["a subscriber's reversed MSG", NATS_SUBSCRIBER_REVERSED_DELIVERY],
    ["a host-network nats-server's PUB", NATS_HOSTNET_BROKER_PUB],
    ["nats-server's split delivery", NATS_BROKER_SPLIT_DELIVERY],
  ])(
    "receiving-side (different ports) whatever server.address names: %s",
    (_label: string, span: Attributes) => {
      expect(isObiReceivingSideMessagingSpan(span)).toBe(true);
      // A pipeline that rewrote server.address changes nothing.
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(span, { "server.address": "rewritten" }),
        ),
      ).toBe(true);
    },
  );

  test("a NATS delivery is the one span whose server.address still matters: nats-server's own, its address rewritten by a pipeline, has a client's split delivery's ports and reads as one", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_BROKER_DELIVERY, { "server.address": "rewritten" }),
      ),
    ).toBe(false);
  });

  test("a host-network broker, which the address alone missed (server.address names the node)", () => {
    expect(NATS_HOSTNET_BROKER_PUB["server.address"]).not.toBe(
      NATS_HOSTNET_BROKER_PUB["resource.service.name"],
    );
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Producer,
        attributes: NATS_HOSTNET_BROKER_PUB,
      }),
    ).toBe(SpanKind.Server);
    expect(
      normalizeObiReceivingSideMessagingSpanKind({
        kind: SpanKind.Consumer,
        attributes: NATS_HOSTNET_BROKER_DELIVERY,
      }),
    ).toBe(SpanKind.Server);
    // Its delivery is told from a client's split delivery by the node name.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_HOSTNET_BROKER_DELIVERY, {
          "resource.k8s.node.name": "another-node",
        }),
      ),
    ).toBe(false);
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_HOSTNET_BROKER_DELIVERY, {
          "resource.k8s.node.name": undefined,
        }),
      ),
    ).toBe(false);
  });

  test.each([
    ["4222", "4222", false],
    [4222, 4222, false],
    ["4222", 4222, false],
    [4222, "37514", true],
    ["4222", "37514", true],
    ["1", 65535, true],
    [65535, "1", true],
    // Equal, but the far end's ephemeral port: a broker's publish.
    ["37514", "37514", true],
    [37514, "37514", true],
    ["37514", 37514, true],
  ] as Array<[string | number, string | number, boolean]>)(
    "server.port %p and network.peer.port %p compare as numbers: receiving-side %p",
    (
      serverPort: string | number,
      peerPort: string | number,
      expected: boolean,
    ) => {
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_PUB, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
            "server.address": "somewhere-else",
          }),
        ),
      ).toBe(expected);
    },
  );

  test.each([
    [undefined],
    [null],
    [""],
    ["0"],
    [0],
    ["04222"],
    ["4222.0"],
    ["+4222"],
    ["-4222"],
    [" 4222"],
    ["4222 "],
    ["4,222"],
    ["1e3"],
    ["0x107e"],
    ["65536"],
    ["99999"],
    ["123456"],
    [65536],
    [-1],
    [4222.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [["4222"]],
    [{ intValue: "4222" }],
    [true],
  ])(
    "%p is no port, in either attribute: the address decides",
    (notAPort: unknown) => {
      for (const key of ["server.port", "network.peer.port"]) {
        // server.address its own name: receiving-side by the address.
        expect({
          key: key,
          receivingSide: isObiReceivingSideMessagingSpan(
            withAttributes(NATS_BROKER_PUB, { [key]: notAPort }),
          ),
        }).toEqual({ key: key, receivingSide: true });
        // server.address the broker's name: a client span by the address.
        expect({
          key: key,
          receivingSide: isObiReceivingSideMessagingSpan(
            withAttributes(NATS_CLIENT_ACK_PUBLISH, {
              [key]: notAPort,
              "service.peer.name": undefined,
            }),
          ),
        }).toEqual({ key: key, receivingSide: false });
        // The split delivery nats-server wrote: CONSUMER, as before.
        expect({
          key: key,
          receivingSide: isObiReceivingSideMessagingSpan(
            withAttributes(NATS_BROKER_SPLIT_DELIVERY, { [key]: notAPort }),
          ),
        }).toEqual({ key: key, receivingSide: false });
      }
    },
  );

  test("without port evidence the node is not read: a client span naming its own node stays a client span", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_ACK_PUBLISH, {
          "server.address": "fu-nats-worker",
          "service.peer.name": undefined,
          "server.port": undefined,
        }),
      ),
    ).toBe(false);
    // Nor with equal ports.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_ACK_PUBLISH, {
          "server.address": "fu-nats-worker",
          "service.peer.name": undefined,
        }),
      ),
    ).toBe(false);
  });

  test("IPv6: network.peer.address plays no part, and an IPv6 server.address is compared like any other name", () => {
    for (const peerAddress of [
      "fd00:10:244:1::3b",
      "::ffff:10.244.1.59",
      "10.244.1.59",
      undefined,
    ]) {
      expect({
        peerAddress: peerAddress,
        broker: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_SPLIT_DELIVERY, {
            "network.peer.address": peerAddress,
          }),
        ),
        client: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
            "network.peer.address": peerAddress,
          }),
        ),
      }).toEqual({ peerAddress: peerAddress, broker: true, client: false });
    }

    // A client of a broker OBI cannot name, on an IPv6 cluster.
    const ipv6Publish: Attributes = withAttributes(
      NATS_EXTERNAL_CLIENT_PUBLISH,
      {
        "server.address": "fd00:10:96::1f",
        "network.peer.address": "fd00:10:96::1f",
        "service.peer.name": undefined,
      },
    );
    expect(isObiReceivingSideMessagingSpan(ipv6Publish)).toBe(false);
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(ipv6Publish, { "network.peer.port": undefined }),
      ),
    ).toBe(false);
    // Its split delivery names the client itself, as on IPv4.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_EXTERNAL_CLIENT_SPLIT_DELIVERY, {
          "network.peer.address": "fd00:10:244:1::47",
        }),
      ),
    ).toBe(true);
  });
});

describe("NATS deliveries (MSG / HMSG, operation process)", () => {
  test("a MSG OBI typed client-side is SERVER with service.peer.name, without it, or with the older peer.service: only a NATS server writes one", () => {
    for (const changes of [
      {},
      { "service.peer.name": undefined },
      { "service.peer.name": undefined, "peer.service": "js-pull-consumer" },
      // A subscriber named like the broker (a sidecar in its pod).
      { "service.peer.name": undefined, "server.address": "nats" },
    ] as Array<Record<string, unknown>>) {
      expect({
        changes: changes,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_CLIENT_TYPED_DELIVERY, changes),
        ),
      }).toEqual({ changes: changes, receivingSide: true });
    }
    // Even without ports, service.peer.name types it client-side.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_BROKER_CLIENT_TYPED_DELIVERY, {
          "server.port": undefined,
          "network.peer.port": undefined,
        }),
      ),
    ).toBe(true);
  });

  test("broker and client split deliveries are mirror images: only the ephemeral range tells them apart", () => {
    expect(NATS_BROKER_SPLIT_DELIVERY["server.port"]).toBe(
      NATS_CLIENT_SPLIT_DELIVERY["network.peer.port"],
    );
    expect(NATS_BROKER_SPLIT_DELIVERY["network.peer.port"]).toBe(
      NATS_CLIENT_SPLIT_DELIVERY["server.port"],
    );
  });

  test.each([
    // The client's own port at the edges of the range.
    ["4222", String(EPHEMERAL_PORT_RANGE_START), false],
    ["4222", String(EPHEMERAL_PORT_RANGE_START - 1), true],
    ["4222", "60999", false],
    ["4222", "65535", false],
    ["4222", "1024", true],
    // A broker listening inside the range: v0.13's SERVER, never worse.
    [String(EPHEMERAL_PORT_RANGE_START), "45678", true],
    [String(EPHEMERAL_PORT_RANGE_START - 1), "45678", false],
    // A NodePort (30000-32767) is below the range.
    ["31222", "45678", false],
  ] as Array<[string, string, boolean]>)(
    "a client's split delivery with server.port %s and network.peer.port %s: receiving-side %p",
    (serverPort: string, peerPort: string, expected: boolean) => {
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
          }),
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["54276", "4222", true],
    [String(EPHEMERAL_PORT_RANGE_START), "4222", true],
    // A subscriber port below the range is still the broker's.
    [String(EPHEMERAL_PORT_RANGE_START - 1), "4222", true],
    ["20000", "4222", true],
    // Both in the range (a broker listening there) is still the broker's.
    ["54276", "40000", true],
    /*
     * Only a subscriber port below the range AND a broker port inside it
     * reads as a client's: OBI's v0.14 kind is kept.
     */
    ["20000", "40000", false],
    [
      String(EPHEMERAL_PORT_RANGE_START - 1),
      String(EPHEMERAL_PORT_RANGE_START),
      false,
    ],
  ] as Array<[string, string, boolean]>)(
    "nats-server's split delivery with server.port %s and network.peer.port %s: receiving-side %p",
    (serverPort: string, peerPort: string, expected: boolean) => {
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_SPLIT_DELIVERY, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
          }),
        ),
      ).toBe(expected);
    },
  );

  test("a client's split delivery naming its own node — a host-network broker reached at the node IP — is SERVER", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
          "server.address": "fu-nats-worker",
        }),
      ),
    ).toBe(true);
    // Another node's name is a broker's.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
          "server.address": "fu-nats-control-plane",
        }),
      ),
    ).toBe(false);
    // An empty server.address and node name name nothing.
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
          "server.address": "",
          "resource.k8s.node.name": "",
        }),
      ),
    ).toBe(false);
  });

  test("the delivery rules are NATS-only and process-only", () => {
    for (const system of ["kafka", "mqtt"]) {
      expect({
        system: system,
        clientTyped: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_CLIENT_TYPED_DELIVERY, {
            "messaging.system": system,
          }),
        ),
        clientSplit: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
            "messaging.system": system,
          }),
        ),
      }).toEqual({ system: system, clientTyped: false, clientSplit: true });
    }
    for (const operationType of [
      "receive",
      "settle",
      "unknown",
      "Process",
      "process ",
      undefined,
    ]) {
      expect({
        operationType: operationType,
        clientTyped: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_BROKER_CLIENT_TYPED_DELIVERY, {
            "messaging.operation.type": operationType,
          }),
        ),
        clientSplit: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_CLIENT_SPLIT_DELIVERY, {
            "messaging.operation.type": operationType,
          }),
        ),
      }).toEqual({
        operationType: operationType,
        clientTyped: false,
        clientSplit: true,
      });
    }
    /*
     * A publish with B4's ports is the PUB a broker read beside a split
     * delivery (B3-main): receiving-side by its ports, not as a MSG.
     */
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_BROKER_CLIENT_TYPED_DELIVERY, {
          "messaging.operation.type": "send",
        }),
      ),
    ).toBe(true);
  });

  test("still only OBI's spans", () => {
    for (const span of [
      NATS_BROKER_SPLIT_DELIVERY,
      NATS_BROKER_CLIENT_TYPED_DELIVERY,
      NATS_HOSTNET_BROKER_PUB,
    ]) {
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(span, {
            "resource.telemetry.distro.name":
              "opentelemetry-java-instrumentation",
          }),
        ),
      ).toBe(false);
    }
  });
});

/*
 * Kafka and MQTT have no split delivery: their ports say what their
 * addresses already said. Captured from mosquitto 2; Kafka as OBI's
 * tracesgen.go writes a broker's and a client's span.
 */
const KAFKA_BROKER_PRODUCE_WITH_PORTS: Attributes = withAttributes(
  KAFKA_BROKER_PRODUCE,
  {
    "server.port": "9092",
    "network.peer.address": "10.244.2.17",
    "network.peer.port": "51544",
  },
);
const KAFKA_APP_PRODUCE_WITH_PORTS: Attributes = withAttributes(
  KAFKA_APP_PRODUCE,
  {
    "server.port": "9092",
    "network.peer.address": "10.96.40.12",
    "network.peer.port": "9092",
  },
);

const KAFKA_AND_MQTT_SHAPES: Array<[string, boolean, Attributes]> = [
  ["a Kafka broker's produce", true, KAFKA_BROKER_PRODUCE_WITH_PORTS],
  [
    "a Kafka broker's fetch",
    true,
    withAttributes(KAFKA_BROKER_FETCH, {
      "server.port": "9092",
      "network.peer.address": "10.244.2.18",
      "network.peer.port": "42110",
    }),
  ],
  ["an application's produce", false, KAFKA_APP_PRODUCE_WITH_PORTS],
  [
    "an application's fetch",
    false,
    withAttributes(KAFKA_APP_PRODUCE_WITH_PORTS, {
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "messaging.kafka.offset": 1042,
    }),
  ],
  [
    "mosquitto reading a PUBLISH",
    true,
    withAttributes(mqttSpan("mosquitto", "mosquitto", PUBLISH), {
      "server.port": "1883",
      "network.peer.address": "10.244.1.76",
      "network.peer.port": "33436",
    }),
  ],
  [
    "mosquitto reading a SUBSCRIBE",
    true,
    withAttributes(mqttSpan("mosquitto", "mosquitto", PROCESS), {
      "server.port": "1883",
      "network.peer.address": "10.244.1.83",
      "network.peer.port": "39876",
    }),
  ],
  [
    "a subscriber's reversed delivery",
    true,
    withAttributes(mqttSpan("mqtt-subscriber", "mqtt-subscriber", PUBLISH), {
      "server.port": "37910",
      "network.peer.address": "10.96.56.243",
      "network.peer.port": "1883",
    }),
  ],
  [
    "a publisher's PUBLISH",
    false,
    withAttributes(mqttSpan("mqtt-publisher", "mosquitto", PUBLISH), {
      "server.port": "1883",
      "network.peer.address": "10.96.56.243",
      "network.peer.port": "1883",
      "service.peer.name": "mosquitto",
    }),
  ],
  [
    "a subscriber's SUBSCRIBE",
    false,
    withAttributes(mqttSpan("mqtt-subscriber", "mosquitto", PROCESS), {
      "server.port": "1883",
      "network.peer.address": "10.96.56.243",
      "network.peer.port": "1883",
      "service.peer.name": "mosquitto",
    }),
  ],
];

describe("Kafka and MQTT", () => {
  test.each(KAFKA_AND_MQTT_SHAPES)(
    "%s: receiving-side %p, with its ports, without them, and without service.peer.name",
    (_label: string, expected: boolean, span: Attributes) => {
      expect(isObiReceivingSideMessagingSpan(span)).toBe(expected);
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(span, { "network.peer.port": undefined }),
        ),
      ).toBe(expected);
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(span, { "service.peer.name": undefined }),
        ),
      ).toBe(expected);
    },
  );

  test("a host-network broker (server.address names the node) is receiving-side by its ports", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(KAFKA_BROKER_PRODUCE_WITH_PORTS, {
          "server.address": "ip-10-0-3-17",
        }),
      ),
    ).toBe(true);
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(
          withAttributes(mqttSpan("mosquitto", "mosquitto", PUBLISH), {
            "server.port": "1883",
            "network.peer.address": "10.244.1.76",
            "network.peer.port": "33436",
          }),
          { "server.address": "fu-nats-worker" },
        ),
      ),
    ).toBe(true);
  });

  test("an application named like its broker, without service.peer.name, keeps its client kind", () => {
    for (const span of [
      withAttributes(KAFKA_APP_PRODUCE_WITH_PORTS, {
        "resource.service.name": "kafka",
        "service.peer.name": undefined,
      }),
      withAttributes(mqttSpan("mosquitto", "mosquitto", PUBLISH), {
        "server.port": "1883",
        "network.peer.address": "10.96.56.243",
        "network.peer.port": "1883",
      }),
    ]) {
      expect(span["server.address"]).toBe(span["resource.service.name"]);
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Producer,
          attributes: span,
        }),
      ).toBe(SpanKind.Producer);
    }
  });
});

/*
 * The publishes OBI types client-side on a broker, by v0.13 and v0.14
 * alike, as captured: mosquitto's PUBLISH to a subscriber, which it writes
 * first, and the PUB nats-server read beside a split delivery (B3-main,
 * NATS_BROKER_CLIENT_TYPED_ACK above). A client-typed span's server.* is the
 * far end of the connection, here the subscriber at the ephemeral port it
 * connected from; a client's own publish names its broker's listening port.
 */
const MQTT_BROKER_PUBLISH: Attributes = {
  ...obiResource("mosquitto"),
  "resource.k8s.node.name": "fu-nats-worker",
  "server.port": "37910",
  "messaging.system": "mqtt",
  "messaging.destination.name": "sensors/temp",
  "server.address": "mqtt-subscriber",
  "messaging.operation.name": "publish",
  "messaging.operation.type": "send",
  "service.peer.name": "mqtt-subscriber",
  "network.peer.address": "10.244.1.78",
  "network.peer.port": "37910",
  "span.metrics.skip": true,
};
// The same, from an install that does not select service.peer.name.
const MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME: Attributes = withAttributes(
  MQTT_BROKER_PUBLISH,
  {
    "server.port": "57566",
    "network.peer.address": "10.244.1.221",
    "network.peer.port": "57566",
    "service.peer.name": undefined,
  },
);
// The publisher's own PUBLISH, through mosquitto's Service.
const MQTT_CLIENT_PUBLISH: Attributes = {
  ...obiResource("mqtt-publisher"),
  "resource.k8s.node.name": "fu-nats-worker",
  "server.port": "1883",
  "messaging.system": "mqtt",
  "messaging.destination.name": "sensors/temp",
  "server.address": "mosquitto",
  "messaging.operation.name": "publish",
  "messaging.operation.type": "send",
  "service.peer.name": "mosquitto",
  "network.peer.address": "10.96.56.243",
  "network.peer.port": "1883",
  "span.metrics.skip": true,
};
// The subscriber's SUBSCRIBE: only a client writes one.
const MQTT_CLIENT_SUBSCRIBE: Attributes = withAttributes(MQTT_CLIENT_PUBLISH, {
  "resource.service.name": "mqtt-subscriber",
  "messaging.destination.name": "sensors/#",
  "messaging.operation.name": "process",
  "messaging.operation.type": "process",
});
// host-network B3-main: hn-responder's reply, read by the host-network broker.
const NATS_HOSTNET_BROKER_CLIENT_TYPED_REPLY: Attributes = capturedNats({
  service: "nats-hostnet",
  serverAddress: "hn-responder",
  serverPort: "58244",
  peerAddress: "10.244.1.62",
  peerPort: "58244",
  operation: "publish",
  subject: "_INBOX.A23D0L3935BPJJDC1JBZ3Y.A23D0L3935BPJJDC1JCJEV",
  servicePeerName: "hn-responder",
});
// A host-network broker's client, through its Service (port 4223).
const NATS_HOSTNET_CLIENT_PUBLISH: Attributes = capturedNats({
  service: "hn-js-producer",
  serverAddress: "nats-hostnet",
  serverPort: "4223",
  peerAddress: "10.96.140.12",
  peerPort: "4223",
  operation: "publish",
  subject: "hn.orders.created",
  servicePeerName: "nats-hostnet",
});

const BROKER_PUBLISHES: Array<[string, Attributes]> = [
  ["mosquitto's PUBLISH to a subscriber", MQTT_BROKER_PUBLISH],
  [
    "mosquitto's PUBLISH to a subscriber, without service.peer.name",
    MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME,
  ],
  [
    "mosquitto's PUBLISH to a subscriber, with v0.13's peer.service",
    withAttributes(MQTT_BROKER_PUBLISH, {
      "service.peer.name": undefined,
      "peer.service": "mqtt-subscriber",
    }),
  ],
  ["the ack nats-server read (B3-main)", NATS_BROKER_CLIENT_TYPED_ACK],
  [
    "the ack nats-server read (B3-main), without service.peer.name",
    withAttributes(NATS_BROKER_CLIENT_TYPED_ACK, {
      "service.peer.name": undefined,
    }),
  ],
  [
    "the reply a host-network nats-server read (host-network B3-main)",
    NATS_HOSTNET_BROKER_CLIENT_TYPED_REPLY,
  ],
];

const CLIENT_PUBLISHES: Array<[string, SpanKind, Attributes]> = [
  ["an MQTT publisher's PUBLISH", SpanKind.Producer, MQTT_CLIENT_PUBLISH],
  [
    "an MQTT publisher's PUBLISH, without service.peer.name",
    SpanKind.Producer,
    withAttributes(MQTT_CLIENT_PUBLISH, { "service.peer.name": undefined }),
  ],
  ["an MQTT subscriber's SUBSCRIBE", SpanKind.Consumer, MQTT_CLIENT_SUBSCRIBE],
  ["a NATS client's publish (C1)", SpanKind.Producer, NATS_CLIENT_PUBLISH],
  ["a NATS client's ack (C1)", SpanKind.Producer, NATS_CLIENT_ACK_PUBLISH],
  [
    "a NATS client of a broker OBI cannot name",
    SpanKind.Producer,
    NATS_EXTERNAL_CLIENT_PUBLISH,
  ],
  [
    "a NATS client of a host-network broker",
    SpanKind.Producer,
    NATS_HOSTNET_CLIENT_PUBLISH,
  ],
  [
    "an app named like its NATS broker, without service.peer.name",
    SpanKind.Producer,
    withAttributes(NATS_APP_NAMED_NATS_PUBLISH, {
      "service.peer.name": undefined,
    }),
  ],
];

describe("a broker's publish OBI types client-side (an MQTT PUBLISH to a subscriber, NATS B3-main)", () => {
  test.each(BROKER_PUBLISHES)(
    "%s: equal ports in the ephemeral range, stored as SERVER from v0.13's and v0.14's PRODUCER",
    (_label: string, span: Attributes) => {
      expect(span["server.port"]).toBe(span["network.peer.port"]);
      expect(Number(span["server.port"])).toBeGreaterThanOrEqual(
        EPHEMERAL_PORT_RANGE_START,
      );
      expect(isObiReceivingSideMessagingSpan(span)).toBe(true);
      for (const version of ["v0.13.0", "v0.14.0"]) {
        expect({
          version: version,
          stored: normalizeObiReceivingSideMessagingSpanKind({
            kind: SpanKind.Producer,
            attributes: withAttributes(span, {
              "resource.telemetry.distro.version": version,
            }),
          }),
        }).toEqual({ version: version, stored: SpanKind.Server });
      }
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Server,
          attributes: span,
        }),
      ).toBe(SpanKind.Server);
    },
  );

  test.each(CLIENT_PUBLISHES)(
    "%s keeps OBI's %s: its far end is the broker's listening port",
    (_label: string, kind: SpanKind, span: Attributes) => {
      expect(span["server.port"]).toBe(span["network.peer.port"]);
      expect(Number(span["server.port"])).toBeLessThan(
        EPHEMERAL_PORT_RANGE_START,
      );
      expect(isObiReceivingSideMessagingSpan(span)).toBe(false);
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: kind,
          attributes: span,
        }),
      ).toBe(kind);
    },
  );

  test.each([
    ["1883", false],
    ["8883", false],
    ["4222", false],
    // A NodePort (30000-32767) is below the range.
    ["30000", false],
    [String(EPHEMERAL_PORT_RANGE_START - 1), false],
    [String(EPHEMERAL_PORT_RANGE_START), true],
    // IANA's dynamic range (Windows, macOS), and the end of Linux's default.
    ["49152", true],
    ["60999", true],
    ["65535", true],
    [EPHEMERAL_PORT_RANGE_START - 1, false],
    [EPHEMERAL_PORT_RANGE_START, true],
  ] as Array<[string | number, boolean]>)(
    "both ports %p: a broker's publish %p, for MQTT and NATS, with or without service.peer.name",
    (port: string | number, expected: boolean) => {
      for (const span of [
        MQTT_BROKER_PUBLISH,
        MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME,
        NATS_BROKER_CLIENT_TYPED_ACK,
        withAttributes(NATS_BROKER_CLIENT_TYPED_ACK, {
          "service.peer.name": undefined,
        }),
      ]) {
        expect({
          system: span["messaging.system"],
          peerName: span["service.peer.name"],
          receivingSide: isObiReceivingSideMessagingSpan(
            withAttributes(span, {
              "server.port": port,
              "network.peer.port": port,
            }),
          ),
        }).toEqual({
          system: span["messaging.system"],
          peerName: span["service.peer.name"],
          receivingSide: expected,
        });
      }
    },
  );

  test("ports compare as numbers: an int64 as a string or a number is the same port", () => {
    for (const [serverPort, peerPort] of [
      ["37910", 37910],
      [37910, "37910"],
      [37910, 37910],
    ] as Array<[string | number, string | number]>) {
      expect(
        isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
          }),
        ),
      ).toBe(true);
    }
  });

  test("a client of a broker listening in the ephemeral range is taken for the broker, the rule's documented trade-off; its SUBSCRIBE stays its own", () => {
    // A port Docker published at random, a hostPort picked in the range.
    for (const port of ["49154", "40000"]) {
      expect({
        port: port,
        mqtt: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_CLIENT_PUBLISH, {
            "server.port": port,
            "network.peer.port": port,
          }),
        ),
        nats: isObiReceivingSideMessagingSpan(
          withAttributes(NATS_CLIENT_PUBLISH, {
            "server.port": port,
            "network.peer.port": port,
          }),
        ),
        subscribe: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_CLIENT_SUBSCRIBE, {
            "server.port": port,
            "network.peer.port": port,
          }),
        ),
      }).toEqual({ port: port, mqtt: true, nats: true, subscribe: false });
    }
  });

  test("a subscriber whose port is below the range (a low ip_local_port_range, a port SNAT rewrote) leaves the broker's publish to it OBI's PRODUCER, as before", () => {
    for (const port of ["20000", "1024"]) {
      expect({
        port: port,
        stored: normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Producer,
          attributes: withAttributes(MQTT_BROKER_PUBLISH, {
            "server.port": port,
            "network.peer.port": port,
          }),
        }),
      }).toEqual({ port: port, stored: SpanKind.Producer });
    }
  });

  test("unequal ports are not this rule's: with service.peer.name the span is a client's, without it OBI typed it receiving-side", () => {
    for (const [serverPort, peerPort] of [
      ["37910", "37911"],
      ["37910", "1883"],
      ["1883", "37910"],
    ]) {
      expect({
        serverPort: serverPort,
        peerPort: peerPort,
        withPeerName: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
          }),
        ),
        withoutPeerName: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME, {
            "server.port": serverPort,
            "network.peer.port": peerPort,
          }),
        ),
      }).toEqual({
        serverPort: serverPort,
        peerPort: peerPort,
        withPeerName: false,
        withoutPeerName: true,
      });
    }
  });

  test.each([
    [undefined],
    [null],
    [""],
    ["0"],
    [0],
    ["037910"],
    ["37910.0"],
    ["+37910"],
    [" 37910"],
    ["65536"],
    [70000],
    [37910.5],
    [Number.NaN],
    [["37910"]],
    [{ intValue: "37910" }],
    [true],
  ])(
    "%p is no port: as server.port OBI's PRODUCER is kept; as network.peer.port it is a dropped one, service.peer.name typing the span client-side, else the address (the subscriber) deciding",
    (notAPort: unknown) => {
      for (const span of [
        MQTT_BROKER_PUBLISH,
        MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME,
        NATS_BROKER_CLIENT_TYPED_ACK,
        withAttributes(NATS_BROKER_CLIENT_TYPED_ACK, {
          "service.peer.name": undefined,
        }),
      ]) {
        const peerName: boolean = span["service.peer.name"] !== undefined;
        const stored: (key: string) => SpanKind = (key: string): SpanKind => {
          return normalizeObiReceivingSideMessagingSpanKind({
            kind: SpanKind.Producer,
            attributes: withAttributes(span, { [key]: notAPort }),
          });
        };
        expect({
          system: span["messaging.system"],
          peerName: peerName,
          serverPort: stored("server.port"),
          peerPort: stored("network.peer.port"),
        }).toEqual({
          system: span["messaging.system"],
          peerName: peerName,
          serverPort: SpanKind.Producer,
          peerPort: peerName ? SpanKind.Server : SpanKind.Producer,
        });
      }
    },
  );

  /*
   * An attributes.select that leaves out network.peer.port. A span with
   * service.peer.name is still known to be client-typed (OBI writes it on
   * no other), so its server.port alone is the far end of the connection.
   */
  test("without network.peer.port, service.peer.name says the span is client-typed and server.port alone decides, at the same boundary", () => {
    const dropped: (span: Attributes, port?: string) => Attributes = (
      span: Attributes,
      port?: string,
    ): Attributes => {
      return withAttributes(span, {
        "network.peer.port": undefined,
        ...(port === undefined ? {} : { "server.port": port }),
      });
    };
    const storedAs: (span: Attributes, kind?: SpanKind) => SpanKind = (
      span: Attributes,
      kind: SpanKind = SpanKind.Producer,
    ): SpanKind => {
      return normalizeObiReceivingSideMessagingSpanKind({
        kind: kind,
        attributes: span,
      });
    };
    const start: number = EPHEMERAL_PORT_RANGE_START;

    for (const [label, span] of BROKER_PUBLISHES) {
      const peerName: boolean =
        span["service.peer.name"] !== undefined ||
        span["peer.service"] !== undefined;
      expect({
        label: label,
        captured: storedAs(dropped(span)),
        atStart: storedAs(dropped(span, String(start))),
        belowStart: storedAs(dropped(span, String(start - 1))),
      }).toEqual({
        label: label,
        // Without a peer name the address decides: it names the subscriber.
        captured: peerName ? SpanKind.Server : SpanKind.Producer,
        atStart: peerName ? SpanKind.Server : SpanKind.Producer,
        belowStart: SpanKind.Producer,
      });
    }
    for (const [label, kind, span] of CLIENT_PUBLISHES) {
      const namedLikeBroker: boolean =
        span["server.address"] === span["resource.service.name"] &&
        span["service.peer.name"] === undefined;
      expect({ label: label, stored: storedAs(dropped(span), kind) }).toEqual({
        label: label,
        // The address rule's documented case, as before: no ports to read.
        stored: namedLikeBroker ? SpanKind.Server : kind,
      });
    }

    // The trade-off holds here too: a client of a broker listening in the range.
    expect(storedAs(dropped(MQTT_CLIENT_PUBLISH, "49154"))).toBe(
      SpanKind.Server,
    );
    expect(
      storedAs(dropped(MQTT_CLIENT_SUBSCRIBE, "49154"), SpanKind.Consumer),
    ).toBe(SpanKind.Consumer);
    // Kafka is still never re-typed.
    expect(
      storedAs(
        dropped(
          withAttributes(KAFKA_APP_PRODUCE_WITH_PORTS, {
            "service.peer.name": "kafka",
          }),
          "49154",
        ),
      ),
    ).toBe(SpanKind.Producer);
    // A peer name with a server.port that is no port: nothing to read.
    expect(
      storedAs(
        withAttributes(MQTT_BROKER_PUBLISH, {
          "server.port": "037910",
          "network.peer.port": undefined,
        }),
      ),
    ).toBe(SpanKind.Producer);
  });

  test("with neither port the address decides, as before: the publish names the subscriber, a broker's own receiving-side span itself", () => {
    const noPorts: Record<string, unknown> = {
      "server.port": undefined,
      "network.peer.port": undefined,
    };
    for (const span of [
      MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME,
      // A peer name types it client-side, but names no port to read.
      MQTT_BROKER_PUBLISH,
      NATS_BROKER_CLIENT_TYPED_ACK,
    ]) {
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Producer,
          attributes: withAttributes(span, noPorts),
        }),
      ).toBe(SpanKind.Producer);
    }
    expect(
      isObiReceivingSideMessagingSpan(withAttributes(NATS_BROKER_PUB, noPorts)),
    ).toBe(true);
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(
          withAttributes(MQTT_BROKER_PUBLISH_WITHOUT_PEER_NAME, noPorts),
          { "server.address": "mosquitto" },
        ),
      ),
    ).toBe(true);
  });

  test("server.address and network.peer.address play no part: the ports decide", () => {
    for (const changes of [
      { "server.address": "rewritten" },
      { "server.address": "mosquitto" },
      { "server.address": "fu-nats-worker" },
      { "network.peer.address": "fd00:10:244:1::4e" },
      { "network.peer.address": undefined },
    ] as Array<Record<string, unknown>>) {
      expect({
        changes: changes,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH, changes),
        ),
      }).toEqual({ changes: changes, receivingSide: true });
    }
  });

  test("a publish only: no other operation type, spelled exactly", () => {
    for (const operationType of [
      // A SUBSCRIBE, which only a client writes.
      "process",
      "receive",
      "settle",
      "unknown",
      // The operation name, not its type.
      "publish",
      "Send",
      " send",
      "send ",
      "",
      null,
      undefined,
    ]) {
      expect({
        operationType: operationType,
        mqtt: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH, {
            "messaging.operation.type": operationType,
          }),
        ),
      }).toEqual({ operationType: operationType, mqtt: false });
    }
    // The same NATS span typed "process" is a MSG the broker wrote (B4).
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(NATS_BROKER_CLIENT_TYPED_ACK, {
          "messaging.operation.type": "process",
        }),
      ),
    ).toBe(true);
  });

  test("MQTT and NATS only: Kafka is never re-typed, its clients often reaching a broker at a port published in the range", () => {
    expect(
      isObiReceivingSideMessagingSpan(
        withAttributes(MQTT_BROKER_PUBLISH, { "messaging.system": "nats" }),
      ),
    ).toBe(true);
    for (const system of ["kafka", "MQTT", "Nats", "amqp", "rabbitmq"]) {
      expect({
        system: system,
        receivingSide: isObiReceivingSideMessagingSpan(
          withAttributes(MQTT_BROKER_PUBLISH, { "messaging.system": system }),
        ),
      }).toEqual({ system: system, receivingSide: false });
    }

    // A Kafka client's produce and fetch through a Testcontainers mapping.
    for (const operation of [PUBLISH, PROCESS]) {
      for (const peerName of ["kafka", undefined]) {
        const span: Attributes = withAttributes(KAFKA_APP_PRODUCE_WITH_PORTS, {
          "server.port": "49154",
          "network.peer.port": "49154",
          "messaging.operation.name": operation.name,
          "messaging.operation.type": operation.type,
          "service.peer.name": peerName,
        });
        expect({
          operation: operation.name,
          peerName: peerName,
          stored: normalizeObiReceivingSideMessagingSpanKind({
            kind: SpanKind.Producer,
            attributes: span,
          }),
        }).toEqual({
          operation: operation.name,
          peerName: peerName,
          stored: SpanKind.Producer,
        });
      }
    }
    // A Kafka broker's spans are receiving-side by their unequal ports.
    expect(
      isObiReceivingSideMessagingSpan(KAFKA_BROKER_PRODUCE_WITH_PORTS),
    ).toBe(true);
  });

  test("still only OBI's spans", () => {
    for (const span of [MQTT_BROKER_PUBLISH, NATS_BROKER_CLIENT_TYPED_ACK]) {
      const sdkSpan: Attributes = withAttributes(span, {
        "resource.telemetry.distro.name": "opentelemetry-java-instrumentation",
      });
      expect(isObiReceivingSideMessagingSpan(sdkSpan)).toBe(false);
      expect(
        normalizeObiReceivingSideMessagingSpanKind({
          kind: SpanKind.Producer,
          attributes: sdkSpan,
        }),
      ).toBe(SpanKind.Producer);
    }
  });
});
