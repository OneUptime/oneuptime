import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Text from "Common/Types/Text";
import { OBI_TELEMETRY_DISTRO_NAME } from "./ObiReceivingSideMessagingSpan";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * links a Node.js request to the calls it makes with a small agent it
 * injects through the process's inspector: SIGUSR1, then ONE TCP connection
 * from 127.0.0.1 to 127.0.0.1:9229 carrying GET /json/version (only when an
 * inspector was already listening), GET /json/list, and the WebSocket
 * upgrade to the debugger URL that list returned (GET /<target uuid>,
 * answered 101). The inspector's HTTP server runs inside the Node.js
 * process, so OBI's kprobes parse those requests as HTTP SERVER spans of
 * the application.
 *
 * Up to v0.13 that did not matter: the injection ran before the process was
 * admitted to OBI's PID filter. v0.14 queues it AFTER admission (OBI #3363,
 * commit 2752eb8e7), the way the Java agent's injection has been queued
 * since #2949, so every injected process reports, once per OBI start and
 * once per process start:
 *
 *   GET /json/list   SERVER, no parent, server.port 9229, client.address
 *                    127.0.0.1, with two INTERNAL children "in queue" and
 *                    "processing" that carry no attributes. OBI writes
 *                    those (tracesgen.go createSubSpans) into the same
 *                    ScopeSpans, AHEAD of their parent;
 *   GET /*           SERVER, no parent, the same connection, url.path
 *                    /<uuid>, status 101;
 *   GET /json/version, with its own children, for an app OBI found with
 *                    its inspector already open (--inspect).
 *
 * Each one is a trace of the application that nobody made: they are
 * dropped before the evaluation row is built, so no drop filter, scrub
 * rule, pipeline or exception row sees them, together with the children of
 * every dropped span found anywhere in the same request. The fix belongs in
 * OBI: its injector should keep its own connection out of what it reports.
 * Until an OBI release does, this drops what v0.14 sends. OBI before v0.14,
 * and one that is fixed, sends no such span, and then nothing here ever
 * matches: remove this once the agent chart pins a fixed OBI and older
 * agents have had time to upgrade.
 *
 * Every condition is exact, and all of them must hold:
 *   - the resource's telemetry.distro.name is OBI's;
 *   - SERVER, with no parent: the injector sends no traceparent;
 *   - server.port 9229: OBI dials 127.0.0.1:9229 and nothing else
 *     (pkg/internal/nodejs), so an app whose inspector listens elsewhere is
 *     never injected and never matched;
 *   - a loopback client (client.address, or network.peer.address when it
 *     is absent): the injector connects from 127.0.0.1 inside the pod's
 *     network namespace. It is IPv4-only; ::1 and IPv4-mapped forms are
 *     accepted too. Nothing that reaches 9229 from another pod or a node
 *     matches;
 *   - GET, and url.path /json/version or /json/list whatever the status (a
 *     probe answered by something that is not an inspector is still OBI's),
 *     or a single UUID segment answered 101 (the upgrade).
 * Neither http.route nor the span name is read: both follow the routes
 * settings (`unmatched`, `patterns`), url.path does not.
 *
 * What else matches: only a loopback GET of exactly those paths on 9229,
 * which is the Chrome DevTools protocol's own surface. The one real request
 * shaped like that is a developer's DevTools session against an inspector
 * (`kubectl port-forward`), and that is debugger traffic, not the app's.
 *
 * What is missed: the agent's collector batches by span count, and about 1%
 * of the time it sends the two children in one export and their parent in
 * the next. Those children then arrive without a dropped parent in their
 * request and are kept: two attribute-less INTERNAL spans that are not a
 * trace root, so no trace list shows them.
 */
export const OBI_NODEJS_INSPECTOR_PORT: number = 9229;

// What OBI's injector asks the inspector for, answered or not.
const OBI_INSPECTOR_DISCOVERY_PATHS: ReadonlySet<string> = new Set<string>([
  "/json/version",
  "/json/list",
]);

// The debugger URL /json/list returns: the inspector target's UUID.
const INSPECTOR_TARGET_PATH: RegExp =
  /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SWITCHING_PROTOCOLS_STATUS: number = 101;

// The INTERNAL spans OBI writes under a server span that waited to run.
const OBI_SUB_SPAN_NAMES: ReadonlySet<string> = new Set<string>([
  "in queue",
  "processing",
]);

const IPV4_LOOPBACK_ADDRESS: RegExp = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV4_MAPPED_IPV6_PREFIX: string = "::ffff:";
const IPV6_LOOPBACK_ADDRESS: string = "::1";

const INTEGER_TEXT: RegExp = /^-?\d+$/;

// Keys as the ingest service's per-span attribute map holds them.
const OBI_DISTRO_ATTRIBUTE: string = "resource.telemetry.distro.name";
const SERVER_PORT_ATTRIBUTE: string = "server.port";
const CLIENT_ADDRESS_ATTRIBUTE: string = "client.address";
const NETWORK_PEER_ADDRESS_ATTRIBUTE: string = "network.peer.address";
const HTTP_REQUEST_METHOD_ATTRIBUTE: string = "http.request.method";
const URL_PATH_ATTRIBUTE: string = "url.path";
const HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE: string = "http.response.status_code";

// The span attributes the request-level pre-pass reads off the wire.
const INSPECTOR_REQUEST_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  SERVER_PORT_ATTRIBUTE,
  CLIENT_ADDRESS_ATTRIBUTE,
  NETWORK_PEER_ADDRESS_ATTRIBUTE,
  HTTP_REQUEST_METHOD_ATTRIBUTE,
  URL_PATH_ATTRIBUTE,
  HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE,
]);

type SpanAttributeMap = Readonly<Record<string, unknown>>;

type LongLike = { toNumber: () => number };

/*
 * An int64 attribute as it can reach ingest: a decimal string (OTLP/JSON,
 * and protobufjs' toJSON() on the protobuf path), a number (an encoder that
 * writes one), a bigint or a protobufjs Long (a decoder that keeps 64-bit
 * precision). Anything else is no integer.
 */
function toInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "string") {
    return INTEGER_TEXT.test(value) ? Number(value) : null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Partial<LongLike>).toNumber === "function"
  ) {
    const asNumber: number = (value as LongLike).toNumber();
    return Number.isInteger(asNumber) ? asNumber : null;
  }

  return null;
}

// 127.0.0.0/8, ::1, or 127.0.0.0/8 written as an IPv4-mapped IPv6 address.
function isLoopbackAddress(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (value === IPV6_LOOPBACK_ADDRESS) {
    return true;
  }

  const ipv4: string = value.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)
    ? value.slice(IPV4_MAPPED_IPV6_PREFIX.length)
    : value;
  return IPV4_LOOPBACK_ADDRESS.test(ipv4);
}

export function obiNodeInspectorSpanKey(
  traceId: string,
  spanId: string,
): string {
  return `${traceId}/${spanId}`;
}

/**
 * Whether a span — attributes as the ingest service builds them: span keys
 * bare, resource keys `resource.`-prefixed — is one of OBI's own requests to
 * a Node.js inspector while it injects its agent. See the rule above.
 */
export function isObiNodeInspectorRequestSpan(data: {
  kind: SpanKind;
  parentSpanId: string;
  attributes: SpanAttributeMap | null | undefined;
}): boolean {
  const attributes: SpanAttributeMap | null | undefined = data.attributes;
  if (
    data.kind !== SpanKind.Server ||
    data.parentSpanId !== "" ||
    !attributes ||
    attributes[OBI_DISTRO_ATTRIBUTE] !== OBI_TELEMETRY_DISTRO_NAME
  ) {
    return false;
  }

  if (
    toInteger(attributes[SERVER_PORT_ATTRIBUTE]) !== OBI_NODEJS_INSPECTOR_PORT
  ) {
    return false;
  }

  if (
    !isLoopbackAddress(
      attributes[CLIENT_ADDRESS_ATTRIBUTE] ??
        attributes[NETWORK_PEER_ADDRESS_ATTRIBUTE],
    )
  ) {
    return false;
  }

  if (attributes[HTTP_REQUEST_METHOD_ATTRIBUTE] !== "GET") {
    return false;
  }

  const urlPath: unknown = attributes[URL_PATH_ATTRIBUTE];
  if (typeof urlPath !== "string") {
    return false;
  }

  if (OBI_INSPECTOR_DISCOVERY_PATHS.has(urlPath)) {
    return true;
  }

  return (
    INSPECTOR_TARGET_PATH.test(urlPath) &&
    toInteger(attributes[HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE]) ===
      SWITCHING_PROTOCOLS_STATUS
  );
}

/**
 * Whether the ingest service drops a span: one of the request's inspector
 * request spans (collectObiNodeInspectorRequestSpans), or the "in queue" /
 * "processing" child OBI wrote under one. Ids are hex, as
 * Text.convertOtlpIdToHex returns them; parentSpanId is the one on the
 * wire. Returns at once while the request has no inspector request span.
 */
export function isObiNodeInspectorSpan(
  data: {
    kind: SpanKind;
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId: string;
    attributes: SpanAttributeMap | null | undefined;
  },
  inspectorRequestSpans: ReadonlySet<string>,
): boolean {
  if (inspectorRequestSpans.size === 0) {
    return false;
  }

  if (
    inspectorRequestSpans.has(
      obiNodeInspectorSpanKey(data.traceId, data.spanId),
    )
  ) {
    return true;
  }

  return (
    data.kind === SpanKind.Internal &&
    OBI_SUB_SPAN_NAMES.has(data.name) &&
    data.attributes?.[OBI_DISTRO_ATTRIBUTE] === OBI_TELEMETRY_DISTRO_NAME &&
    inspectorRequestSpans.has(
      obiNodeInspectorSpanKey(data.traceId, data.parentSpanId),
    )
  );
}

/*
 * A scalar OTLP AnyValue the way TelemetryUtil.getAttributeValues reads
 * it: camelCase (JSON, protobufjs) or snake_case keys.
 */
function attributeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const anyValue: JSONObject = value as JSONObject;
  return (
    anyValue["stringValue"] ??
    anyValue["string_value"] ??
    anyValue["intValue"] ??
    anyValue["int_value"] ??
    anyValue["doubleValue"] ??
    anyValue["double_value"]
  );
}

function resourceDistroName(resourceSpan: JSONObject): unknown {
  const attributes: unknown = (
    resourceSpan["resource"] as JSONObject | undefined
  )?.["attributes"];
  if (!Array.isArray(attributes)) {
    return undefined;
  }

  for (const attribute of attributes as JSONArray) {
    if (attribute?.["key"] === "telemetry.distro.name") {
      return attributeValue(attribute["value"]);
    }
  }
  return undefined;
}

// SPAN_KIND_SERVER as OTLP/JSON (2) or a protobuf / gRPC body (its name).
function isServerKind(kind: unknown): boolean {
  return kind === 2 || kind === "2" || kind === SpanKind.Server;
}

/**
 * The keys (obiNodeInspectorSpanKey, hex ids) of every OBI inspector request
 * span in an OTLP request. Runs before the span loop: OBI writes the
 * children ahead of their parent, so the loop could not drop them on its
 * own. A resource that is not OBI's costs one attribute scan, and only the
 * parentless SERVER spans of OBI's have their attributes read. Never throws
 * on a malformed request: what it cannot read is not collected.
 */
export function collectObiNodeInspectorRequestSpans(
  resourceSpans: JSONArray,
): Set<string> {
  const inspectorRequestSpans: Set<string> = new Set<string>();
  if (!Array.isArray(resourceSpans)) {
    return inspectorRequestSpans;
  }

  for (const resourceSpan of resourceSpans) {
    if (
      !resourceSpan ||
      typeof resourceSpan !== "object" ||
      resourceDistroName(resourceSpan) !== OBI_TELEMETRY_DISTRO_NAME
    ) {
      continue;
    }

    const scopeSpans: unknown = resourceSpan["scopeSpans"];
    if (!Array.isArray(scopeSpans)) {
      continue;
    }

    for (const scopeSpan of scopeSpans as JSONArray) {
      const spans: unknown = scopeSpan?.["spans"];
      if (!Array.isArray(spans)) {
        continue;
      }

      for (const span of spans as JSONArray) {
        if (
          !span ||
          !isServerKind(span["kind"]) ||
          Text.convertOtlpIdToHex(
            span["parentSpanId"] as string | undefined,
          ) !== ""
        ) {
          continue;
        }

        const attributes: Record<string, unknown> = {
          [OBI_DISTRO_ATTRIBUTE]: OBI_TELEMETRY_DISTRO_NAME,
        };
        const spanAttributes: unknown = span["attributes"];
        if (Array.isArray(spanAttributes)) {
          for (const attribute of spanAttributes as JSONArray) {
            const key: unknown = attribute?.["key"];
            if (
              typeof key === "string" &&
              INSPECTOR_REQUEST_ATTRIBUTES.has(key)
            ) {
              attributes[key] = attributeValue(attribute["value"]);
            }
          }
        }

        if (
          isObiNodeInspectorRequestSpan({
            kind: SpanKind.Server,
            parentSpanId: "",
            attributes: attributes,
          })
        ) {
          inspectorRequestSpans.add(
            obiNodeInspectorSpanKey(
              Text.convertOtlpIdToHex(span["traceId"] as string | undefined),
              Text.convertOtlpIdToHex(span["spanId"] as string | undefined),
            ),
          );
        }
      }
    }
  }

  return inspectorRequestSpans;
}
