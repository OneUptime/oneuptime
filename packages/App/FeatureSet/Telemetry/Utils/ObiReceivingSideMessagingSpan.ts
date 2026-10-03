import { SpanKind } from "Common/Models/AnalyticsModels/Span";

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
 * Without both ports (an `attributes.select` without network.peer.port, a
 * peer OBI knows by name only) the address decides: OBI's `server.address`
 * names the server end of the connection, and a receiving-side span is one
 * whose server end is the reporting process (a delivery caught in a client
 * connection's response buffer is reversed to make it so), named the way
 * the process itself is — the Kubernetes store names a pod IP with the same
 * function that names the instrumented pod's service, and the name resolver
 * falls back to the process's own service name when the address names
 * nothing. So it equals the resource's `service.name`; on the client side
 * it names the broker.
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
 *     tracer and so records no NATS span of) these are the only consumer
 *     spans a NATS subject gets; they keep OBI's CONSUMER. The two differ
 *     only in which end is the listening port, so the ephemeral range tells
 *     them apart (EPHEMERAL_PORT_MIN): a broker listening in that range, or
 *     a client whose kernel hands out ports below it, has the client's
 *     split delivery stored as SERVER — v0.13's kind for it — and only both
 *     at once leave the broker's split delivery with OBI's CONSUMER. A
 *     broker's ordinary delivery has the client's ports too, but names the
 *     broker itself (on the host network, its node) as every receiving-side
 *     span does, so for a NATS delivery the address still matters.
 *
 * Two broker spans keep OBI's kind, as v0.13 sent them too, because nothing
 * in them tells the broker's from a client's: the PUB a NATS broker read in
 * the exchange whose MSG OBI split off (typed client-side, so a PRODUCER
 * naming the subscriber; its subject is mostly an ack or a reply inbox,
 * which queue discovery skips), and an MQTT broker's PUBLISH to a
 * subscriber, which OBI
 * types client-side because the broker writes it first — unlike a NATS MSG,
 * an MQTT PUBLISH is written by clients and brokers alike.
 *
 * Verified against OBI v0.13.0 and v0.14.0: tracesgen.go (messaging
 * attributes, appendPeerService, networkPeerAttributes, spanKind),
 * request/metric_attributes.go (HostAsServer), transform/name_resolver.go
 * (resolveNames), kube/store.go (ServiceNameNamespaceForIP),
 * ebpf/common/nats_detect_transform.go (ProcessPossibleNATSEvent,
 * TCPToNATSToSpan) and tcp_detect_transform.go (matchNATS), and against
 * spans captured from a real nats-server (Go tracer and generic tracer),
 * mosquitto and a NATS-protocol test broker, labelled by OBI's own trace
 * printer.
 *
 * These spans are stored as SERVER — the kind v0.13 gave every
 * receiving-side one, and the kind every consumer of span kinds here
 * already treats as "not a messaging client operation":
 * MessagingEntityKeyResolver.isMessagingSpan, the queue discovery query and
 * the service dependency queries. Applied before the evaluation row is
 * built, so drop filters, scrub rules and pipelines all see the stored
 * kind, and a Span Kind Remapper keeps the last word.
 *
 * Every comparison is exact — no trimming, no case folding. OBI writes both
 * names from one Go string, the system and operation from constants and both
 * ports from integers, so a receiving-side span never needs it; each looser
 * match could only ever hide an application's client span. Where no rule
 * holds the span keeps OBI's kind, which is v0.14's behaviour, never worse.
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
 * The first port of Linux's default ephemeral range
 * (net.ipv4.ip_local_port_range = 32768 60999; the IANA range, 49152 and
 * up, lies inside it). Only used to tell a NATS broker's split delivery from
 * a client's: see above.
 */
export const EPHEMERAL_PORT_MIN: number = 32768;

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

/**
 * Whether a span's attributes — span keys bare, resource keys
 * `resource.`-prefixed, as the ingest service builds them — describe a Kafka,
 * MQTT or NATS exchange that OBI saw on the receiving side of a connection,
 * or a NATS delivery the reporting process wrote as the server. Reads one
 * property for a span that is not OBI's.
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
   * a MSG), else never receiving-side.
   */
  if (hasPeerService(attributes)) {
    return natsDelivery;
  }
  // No port evidence: the address decides.
  if (serverPort === null || peerPort === null) {
    return namesItself(attributes, false);
  }
  if (serverPort === peerPort) {
    return natsDelivery;
  }

  /*
   * Receiving-side (`*Server`): every one but the NATS delivery OBI split
   * off a client's own request — the far end named, a listening port as
   * `server.port`, an ephemeral one (this client's) as `network.peer.port`.
   */
  return !(
    natsDelivery &&
    !namesItself(attributes, true) &&
    serverPort < EPHEMERAL_PORT_MIN &&
    peerPort >= EPHEMERAL_PORT_MIN
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
