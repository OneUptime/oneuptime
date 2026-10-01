import { SpanKind } from "Common/Models/AnalyticsModels/Span";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * sees a Kafka, MQTT or NATS exchange from whichever process it instruments.
 * Up to v0.13 it exported the ones it saw on the RECEIVING side of a
 * connection (a broker handling a produce or a fetch, a subscriber handed a
 * delivery) as SERVER spans. v0.14 (OBI #3306) derives a messaging span's
 * kind from the operation alone, so those now arrive as PRODUCER or CONSUMER
 * (CLIENT for a receive or settle, INTERNAL for an operation it cannot
 * name), indistinguishable by kind from the application's own: the broker
 * would be a producer and a consumer of every topic it serves (Queues count
 * each publish and consume twice and list it under Producers / Consumers),
 * an MQTT subscriber's delivery a publish of its own, and every produce a
 * broker serves an outbound call to a "kafka" dependency on the Service Map.
 *
 * OBI marks no span with the side it saw it from. The address does. OBI's
 * `server.address` names the server end of the connection, and a
 * receiving-side span is one whose server end is the reporting process (a
 * delivery caught in a client connection's response buffer is reversed to
 * make it so). That end is named the way the process itself is: the
 * Kubernetes store names a pod IP with the same function that names the
 * instrumented pod's service, and the name resolver falls back to the
 * process's own service name when the address names nothing. So it equals
 * the resource's `service.name`. On the client side it names the broker.
 * OBI writes `service.peer.name` on client-typed spans only (v0.14 only
 * when `attributes.select` asks for it), so a span carrying it, or the
 * older `peer.service`, is never receiving-side. Without it, the address
 * alone decides.
 * Verified against OBI v0.13.0 and main fb91a2e: tracesgen.go (messaging
 * attributes, appendPeerService, spanKind), request/metric_attributes.go
 * (HostAsServer), transform/name_resolver.go (resolveNames) and
 * kube/store.go (ServiceNameNamespaceForIP).
 *
 * Such spans are stored as SERVER again, exactly as v0.13 delivered them —
 * the kind every consumer of span kinds here already treats as "not a
 * messaging client operation": MessagingEntityKeyResolver.isMessagingSpan,
 * the queue discovery query and the service dependency queries. Applied
 * before the evaluation row is built, so drop filters, scrub rules and
 * pipelines all see the stored kind, and a Span Kind Remapper keeps the last
 * word.
 *
 * Every comparison is exact — no trimming, no case folding. OBI writes both
 * names from one Go string and the system from a constant, so a receiving-
 * side span never needs it; each looser match could only ever hide an
 * application's client span (an app named `Kafka` publishing to a broker
 * named `kafka`). Where the rule cannot hold the span keeps OBI's kind,
 * which is v0.14's behaviour, never worse: a pipeline that rewrote
 * `server.address` or `service.name` before ingest, a host-network broker
 * (its pod IP is the node's), or a discovery entry that names the service
 * itself.
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
const MESSAGING_SYSTEM_ATTRIBUTE: string = "messaging.system";
const SERVER_ADDRESS_ATTRIBUTE: string = "server.address";
const PEER_SERVICE_ATTRIBUTES: ReadonlyArray<string> = [
  "service.peer.name",
  "peer.service",
];

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

/**
 * Whether a span's attributes — span keys bare, resource keys
 * `resource.`-prefixed, as the ingest service builds them — describe a Kafka,
 * MQTT or NATS exchange that OBI saw on the receiving side of a connection.
 * Reads one property for a span that is not OBI's.
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

  const serverAddress: unknown = attributes[SERVER_ADDRESS_ATTRIBUTE];
  if (
    typeof serverAddress !== "string" ||
    serverAddress.length === 0 ||
    serverAddress !== attributes[RESOURCE_SERVICE_NAME_ATTRIBUTE]
  ) {
    return false;
  }

  return !hasPeerService(attributes);
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
