import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { EPHEMERAL_PORT_RANGE_START } from "Common/Types/DatabaseServer/DatabaseEndpoint";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * sees a Kafka, MQTT or NATS exchange from whichever process it instruments.
 * Up to v0.13 it exported the ones it saw on the RECEIVING side of a
 * connection (a broker handling a produce or a fetch, a subscriber handed a
 * delivery) as SERVER spans: every span of a `*Server` event type. v0.14
 * (OBI #3306) derives a messaging span's kind from the operation alone, so
 * those now arrive as PRODUCER or CONSUMER (CLIENT for a receive or settle,
 * INTERNAL for an operation it cannot name), indistinguishable by kind from
 * the application's own: the broker would be a producer and a consumer of
 * every topic it serves (Queues count each publish and consume twice and list
 * it under Producers / Consumers), an MQTT subscriber's delivery a publish of
 * its own, and every produce a broker serves an outbound call to a "kafka"
 * dependency on the Service Map.
 *
 * OBI marks no span with its event type, but two attributes still carry it
 * (export/otel/tracesgen/tracesgen.go, v0.13.0 and v0.14.0 alike):
 *
 *   - `service.peer.name` (or the older `peer.service`) is written on
 *     client-typed spans only (appendPeerService; v0.14 only when
 *     `attributes.select` asks for it, as the chart does).
 *   - `network.peer.port` is the very `HostPort` that `server.port` is written
 *     from on a client-typed span, and the connection's other end on a
 *     `*Server` one (networkPeerAttributes; on by default, for a peer OBI
 *     knows by IP). So with both ports there, equal ports are a client-typed
 *     span and different ports a receiving-side one — however the addresses
 *     resolved: a host-network broker (its pod IP is the node's, so
 *     `server.address` names the node), an IPv6 or unresolved peer, a
 *     pipeline that rewrote `server.address` or `service.name`, an install
 *     that does not select `service.peer.name`, an application whose service
 *     name is the broker's. (Two ends of a connection share a port number
 *     only when a client's ephemeral port happens to be the server's
 *     listening port; such a receiving-side span keeps OBI's kind.) Checked
 *     against OBI's own event type for 190,750 captured spans: no exception.
 *
 * Without both ports (an `attributes.select` that leaves out
 * network.peer.port, or network.peer.address, without which OBI writes
 * neither; a peer OBI knows by name only) the address decides: OBI's
 * `server.address` names the server end of the connection, and a
 * receiving-side span is one whose server end is the reporting process (a
 * delivery caught in a client connection's response buffer is reversed to
 * make it so), named the way the process itself is — the Kubernetes store
 * names a pod IP with the same function that names the instrumented pod's
 * service, and the name resolver falls back to the process's own service
 * name when the address names nothing. So it equals the resource's
 * `service.name`; on the client side it names the broker.
 *
 * NATS needs two corrections, because OBI's NATS spans do not always carry
 * the side of the connection they were seen from (ebpf/common/
 * nats_detect_transform.go and tcp_detect_transform.go matchNATS):
 *
 *   - A NATS MSG / HMSG frame is only ever written by a server. A `process`
 *     span OBI typed client-side (equal ports, or `service.peer.name`) was
 *     built from a MSG this process wrote: a broker that wrote first on a
 *     connection OBI joined midway, e.g. one open when OBI (re)started. It
 *     names the subscriber as its server and would list the broker as a
 *     consumer of the subject, in v0.13 as in v0.14. Stored as SERVER.
 *   - When a MSG and a PUB share one request/response pair (a JetStream ack
 *     or pull request answered by the next message, a request answered by
 *     its reply), OBI emits the MSG as an extra span it forces to NATSServer
 *     while keeping the unreversed connection: its `server.*` is the far end
 *     and its `network.peer.*` the reporting process itself, so its ports
 *     differ. On a broker (it wrote the MSG) `server.port` is the
 *     subscriber's ephemeral port and `network.peer.port` the broker's
 *     listening port: the broker's delivery, stored as SERVER (v0.13 sent it
 *     as SERVER). On a client (it was handed the MSG) the mirror image —
 *     `server.address` the broker, `server.port` its listening port,
 *     `network.peer.port` the client's ephemeral port — is the subscriber's,
 *     requester's or responder's own consumption of the subject. With an
 *     official nats-server (a Go program, which OBI traces with its Go
 *     tracer: OBI v0.13 and v0.14 recorded no NATS span of nats-server 2.11
 *     with it) these are the only consumer spans a NATS subject gets; they
 *     keep OBI's CONSUMER. The two differ only in which end is the
 *     listening port, so the ephemeral range tells them apart
 *     (EPHEMERAL_PORT_RANGE_START): a broker listening in that range, or
 *     a client whose kernel hands out ports below it, has the client's
 *     split delivery stored as SERVER — v0.13's kind for it — and only both
 *     at once leave the broker's split delivery with OBI's CONSUMER. A
 *     broker's ordinary delivery has the client's ports too, but names the
 *     broker itself (on the host network, its node) as every receiving-side
 *     span does, so for a NATS delivery the address still matters.
 *
 * Two more broker spans are typed client-side, by v0.13 and v0.14 alike: an
 * MQTT broker's PUBLISH to a subscriber, which the broker writes first
 * (ebpf/common/mqtt_detect_transform.go types an MQTT span by the direction
 * it was seen in), and the PUB a NATS broker read in the exchange whose MSG
 * OBI split off. Both are PRODUCER spans naming the subscriber, which list
 * the broker as a producer of the topics and subjects they carry (every
 * topic an MQTT broker delivers). Neither frame says who wrote it — clients
 * and brokers alike write an MQTT PUBLISH, and a PUB is a client's frame —
 * but the connection does. A client-typed span's `server.*` is the far end
 * of the connection: for a broker, a subscriber, at the ephemeral port it
 * connected from; for a client, the port it connected to: the broker's own
 * (1883, 8883, 4222), a Service's in front of it, or a NodePort (30000 to
 * 32767, below the range). So an MQTT or NATS publish typed client-side
 * whose `server.port` is in the ephemeral range (EPHEMERAL_PORT_RANGE_START)
 * — `network.peer.port` equal to it, or left out by an install that selects
 * service.peer.name — was seen on the listening end of its connection: the
 * broker's, stored as SERVER. On every captured span the ports agreed with
 * the workload: 13,594 such spans of brokers, at ports 34800 to 59896, and
 * 80,821 client-typed spans of clients, at 1883, 4222 and 4223.
 *
 * What that costs. A broker listening in the range (a port Docker published
 * at random, a hostPort picked there) has its clients' publishes stored as
 * SERVER too, so they no longer show as its topics' producers. A topic only
 * such clients use is then discovered from OBI's spans only through an MQTT
 * SUBSCRIBE that names it exactly, and a NATS subject not at all: a client's
 * split delivery from such a broker is SERVER already. A subscriber
 * whose port is below the range (an ip_local_port_range that starts lower, a
 * source port SNAT rewrote) leaves the broker's publish to it a PRODUCER, as
 * before, and so does an install that drops both network.peer.port and
 * service.peer.name (the address, naming the subscriber, decides). Kafka is
 * left out: a Kafka broker's span is typed client-side only where the broker
 * is itself a client — replicating from a partition leader, calling a
 * controller — at that one's listening port, while Kafka clients often reach
 * a broker at a port Docker or Testcontainers published in the range; no
 * capture has Kafka. So is every other operation: only a client writes an
 * MQTT SUBSCRIBE, and a NATS MSG has the rule above.
 *
 * Verified against OBI v0.13.0 and v0.14.0: tracesgen.go (messaging
 * attributes, appendPeerService, networkPeerAttributes, spanKind),
 * request/metric_attributes.go (HostAsServer), transform/name_resolver.go
 * (resolveNames), kube/store.go (ServiceNameNamespaceForIP),
 * ebpf/common/nats_detect_transform.go (ProcessPossibleNATSEvent,
 * TCPToNATSToSpan), mqtt_detect_transform.go (ProcessPossibleMQTTEvent,
 * TCPToMQTTToSpan) and tcp_detect_transform.go (matchNATS), and against
 * spans captured from a real nats-server (Go tracer and generic tracer),
 * mosquitto and a NATS-protocol test broker, labelled by OBI's own trace
 * printer.
 *
 * These spans are stored as SERVER — the kind v0.13 gave every
 * receiving-side one, the convention for a broker's own spans, and the
 * kind every consumer of span kinds here already treats as "not a
 * messaging client operation":
 * MessagingEntityKeyResolver.isMessagingSpan, the queue discovery query and
 * the service dependency queries. Applied before the evaluation row is
 * built, so drop filters, scrub rules and pipelines all see the stored
 * kind, and a Span Kind Remapper keeps the last word. For a broker's
 * publish typed client-side that moves a Service Map edge: as a PRODUCER
 * span nothing answered, it gave the broker a dependency on the subscriber
 * it named (or on an "mqtt" / "nats" remote service at its address); as a
 * SERVER span it is an entry span, and one whose parent is the subscriber's
 * own span (2,361 of mosquitto's 5,873 captured) gives the subscriber a
 * trace-linked dependency on the broker instead.
 *
 * Every comparison is exact — no trimming, no case folding. OBI writes both
 * names from one Go string, the system and operation from constants and both
 * ports from integers, so a receiving-side span never needs it; each looser
 * match could only ever hide an application's client span. Where no rule
 * holds the span keeps OBI's kind, which is v0.14's behaviour. An
 * application's own span is stored as SERVER only by the two rules that
 * read the ephemeral range, in the cases each names, and by the address
 * when there is no port evidence and the application is named like its
 * broker.
 */
export const OBI_TELEMETRY_DISTRO_NAME: string =
  "opentelemetry-ebpf-instrumentation";

/*
 * The systems OBI parses with a receiving-side (`*Server`) event type. AMQP
 * has a client event type only, and every other messaging system reaches
 * OBI through an SDK or an HTTP API (SQS, SNS), which it sees as a client.
 */
export const OBI_RECEIVING_SIDE_MESSAGING_SYSTEMS: ReadonlySet<string> =
  new Set<string>(["kafka", "mqtt", "nats"]);

/*
 * The kinds v0.14 gives a receiving-side messaging span (spanKind ←
 * request.MessagingSpanKind). SERVER needs no change, and a kind that is
 * none of these is not one OBI wrote: left as it is.
 */
const OBI_RECEIVING_SIDE_REPORTED_KINDS: ReadonlySet<SpanKind> =
  new Set<SpanKind>([
    SpanKind.Producer,
    SpanKind.Consumer,
    SpanKind.Client,
    SpanKind.Internal,
  ]);

// Keys as the ingest service's per-span attribute map holds them.
const OBI_DISTRO_ATTRIBUTE: string = "resource.telemetry.distro.name";
const RESOURCE_SERVICE_NAME_ATTRIBUTE: string = "resource.service.name";
const RESOURCE_NODE_NAME_ATTRIBUTE: string = "resource.k8s.node.name";
const MESSAGING_SYSTEM_ATTRIBUTE: string = "messaging.system";
const MESSAGING_OPERATION_TYPE_ATTRIBUTE: string = "messaging.operation.type";
const SERVER_ADDRESS_ATTRIBUTE: string = "server.address";
const SERVER_PORT_ATTRIBUTE: string = "server.port";
const NETWORK_PEER_PORT_ATTRIBUTE: string = "network.peer.port";
const PEER_SERVICE_ATTRIBUTES: ReadonlyArray<string> = [
  "service.peer.name",
  "peer.service",
];

// OBI's NATS system and the operation it gives a MSG / HMSG frame.
const NATS_SYSTEM: string = "nats";
const PROCESS_OPERATION_TYPE: string = "process";

/*
 * The systems whose broker has publishes OBI types client-side, and the
 * operation OBI gives a publish (an MQTT PUBLISH, a NATS PUB / HPUB).
 */
const BROKER_SIDE_PUBLISH_SYSTEMS: ReadonlySet<string> = new Set<string>([
  "mqtt",
  "nats",
]);
const SEND_OPERATION_TYPE: string = "send";

type SpanAttributeMap = Readonly<Record<string, unknown>>;

/*
 * A peer attribute that is absent, null or '' names no peer — the way the
 * dependency query reads a ClickHouse map. OBI never writes an empty one.
 */
function hasPeerService(attributes: SpanAttributeMap): boolean {
  for (const key of PEER_SERVICE_ATTRIBUTES) {
    const value: unknown = attributes[key];
    if (value !== undefined && value !== null && value !== "") {
      return true;
    }
  }
  return false;
}

/*
 * A TCP port as the ingest attribute map holds one. OTLP int attributes are
 * int64s, which reach it as a decimal string (OTLP/JSON, and the protobuf
 * and gRPC decoders' `longs: String`) or as a number. Anything else — 0, a
 * sign, a fraction, leading zeros, padding — is no port.
 */
const DECIMAL_PORT: RegExp = /^[1-9][0-9]{0,4}$/;

function toPort(value: unknown): number | null {
  let port: number;
  if (typeof value === "number") {
    port = value;
  } else if (typeof value === "string" && DECIMAL_PORT.test(value)) {
    port = Number(value);
  } else {
    return null;
  }
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/*
 * Whether `server.address` names the reporting process: its service name,
 * or — with `orNode` — the node it runs on, which is how OBI names the
 * address of a host-network pod (the Kubernetes store resolves a node IP to
 * the node). The node is only consulted for a span whose ports already show
 * it receiving-side: a client of a host-network broker on its own node,
 * reached at the node IP, names the node too.
 */
function namesItself(attributes: SpanAttributeMap, orNode: boolean): boolean {
  const serverAddress: unknown = attributes[SERVER_ADDRESS_ATTRIBUTE];
  if (typeof serverAddress !== "string" || serverAddress.length === 0) {
    return false;
  }
  return (
    serverAddress === attributes[RESOURCE_SERVICE_NAME_ATTRIBUTE] ||
    (orNode && serverAddress === attributes[RESOURCE_NODE_NAME_ATTRIBUTE])
  );
}

/*
 * Whether a client-typed MQTT or NATS publish is a broker's: the far end of
 * the connection, which OBI writes as `server.port`, is at an ephemeral
 * port — a subscriber that connected to this process. A client's is the
 * port its broker listens on. `network.peer.port` is the same port where
 * the install keeps it; one that drops it has service.peer.name saying the
 * span is client-typed instead.
 */
function isBrokerSidePublish(
  attributes: SpanAttributeMap,
  messagingSystem: string,
  serverPort: number | null,
  peerPort: number | null,
): boolean {
  return (
    BROKER_SIDE_PUBLISH_SYSTEMS.has(messagingSystem) &&
    attributes[MESSAGING_OPERATION_TYPE_ATTRIBUTE] === SEND_OPERATION_TYPE &&
    serverPort !== null &&
    serverPort >= EPHEMERAL_PORT_RANGE_START &&
    (peerPort === null || peerPort === serverPort)
  );
}

/**
 * Whether a span's attributes — span keys bare, resource keys
 * `resource.`-prefixed, as the ingest service builds them — describe a Kafka,
 * MQTT or NATS exchange that OBI saw on the receiving side of a connection,
 * a NATS delivery the reporting process wrote as the server, or a publish
 * OBI typed client-side on an MQTT or NATS broker. Reads one property for a
 * span that is not OBI's.
 */
export function isObiReceivingSideMessagingSpan(
  attributes: SpanAttributeMap | null | undefined,
): boolean {
  if (
    !attributes ||
    attributes[OBI_DISTRO_ATTRIBUTE] !== OBI_TELEMETRY_DISTRO_NAME
  ) {
    return false;
  }

  const messagingSystem: unknown = attributes[MESSAGING_SYSTEM_ATTRIBUTE];
  if (
    typeof messagingSystem !== "string" ||
    !OBI_RECEIVING_SIDE_MESSAGING_SYSTEMS.has(messagingSystem)
  ) {
    return false;
  }

  const natsDelivery: boolean =
    messagingSystem === NATS_SYSTEM &&
    attributes[MESSAGING_OPERATION_TYPE_ATTRIBUTE] === PROCESS_OPERATION_TYPE;
  const serverPort: number | null = toPort(attributes[SERVER_PORT_ATTRIBUTE]);
  const peerPort: number | null = toPort(
    attributes[NETWORK_PEER_PORT_ATTRIBUTE],
  );

  /*
   * Client-typed: a NATS delivery this process wrote (only a server writes
   * a MSG), or a publish on a broker, whose far end connected from an
   * ephemeral port; else never receiving-side.
   */
  if (
    hasPeerService(attributes) ||
    (serverPort !== null && serverPort === peerPort)
  ) {
    return (
      natsDelivery ||
      isBrokerSidePublish(attributes, messagingSystem, serverPort, peerPort)
    );
  }
  // No port evidence: the address decides.
  if (serverPort === null || peerPort === null) {
    return namesItself(attributes, false);
  }

  /*
   * Receiving-side (`*Server`): every one but the NATS delivery OBI split
   * off a client's own request — the far end named, a listening port as
   * `server.port`, an ephemeral one (this client's) as `network.peer.port`.
   */
  return !(
    natsDelivery &&
    !namesItself(attributes, true) &&
    serverPort < EPHEMERAL_PORT_RANGE_START &&
    peerPort >= EPHEMERAL_PORT_RANGE_START
  );
}

/**
 * The kind to store for a span: SERVER for an OBI receiving-side messaging
 * span reported with one of v0.14's messaging kinds, else the kind it came
 * with. SERVER spans and spans that are not OBI's return after a comparison
 * and one property read.
 */
export function normalizeObiReceivingSideMessagingSpanKind(data: {
  kind: SpanKind;
  attributes: SpanAttributeMap | null | undefined;
}): SpanKind {
  if (
    !OBI_RECEIVING_SIDE_REPORTED_KINDS.has(data.kind) ||
    !isObiReceivingSideMessagingSpan(data.attributes)
  ) {
    return data.kind;
  }
  return SpanKind.Server;
}
