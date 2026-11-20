import protobuf from "protobufjs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_JSON_MAX_VALUES,
  DATADOG_PROTOBUF_MAX_ELEMENTS,
} from "Common/Types/Telemetry/CompatibleIngest";
import { DatadogIntakeError } from "./DatadogIntake";
import JsonElementCounter, {
  JsonElementCount,
  JsonElementCountOutcome,
} from "./JsonElementCount";
import Msgpack, {
  MsgpackDecodeError,
  MsgpackElementCount,
  MsgpackElementCountOutcome,
  MsgpackValue,
} from "./Msgpack";
import OtlpJson, { OtlpKeyValue } from "./OtlpJson";
import ProtobufElementCounter, {
  ProtobufCountSchema,
  ProtobufElementCount,
  ProtobufElementCountOutcome,
} from "./ProtobufElementCount";

/*
 * DATADOG APM TRACES, AS OPENTELEMETRY SPANS.
 *
 * A team leaving Datadog keeps its tracing libraries (dd-trace-py,
 * dd-trace-js, dd-trace-java, dd-trace-go, ...) and the Agent they send to,
 * and points the Agent's apm_dd_url at OneUptime. What arrives becomes an
 * OTLP ExportTraceServiceRequest in OTLP's JSON encoding, queued exactly
 * like an OTLP/HTTP export, so drop filters, scrub rules, pipelines,
 * services, retention and billing apply to it:
 *
 *   /api/v0.2/traces   the Agent's AgentPayload (protobuf)   -> spans
 *   /v0.3/traces       a tracer's traces (MessagePack, JSON) -> spans
 *   /v0.4/traces       the same                              -> spans
 *   /v0.5/traces       the same, its strings in a dictionary -> spans
 *
 * An AgentPayload carries what each tracer sent the Agent: a TracerPayload
 * of trace chunks of spans, or - from a tracer that speaks the v1 protocol
 * (/v1.0/traces) - the same with every string a reference into a table of
 * its own (idxTracerPayloads). Both are read. A tracer posting to the
 * /v0.x endpoints itself says what it is in its headers (Datadog-Meta-Lang,
 * ...) instead. The mapping follows the OpenTelemetry Collector's
 * datadogreceiver, the reference for reading these formats as OpenTelemetry.
 *
 * WHAT A SPAN BECOMES
 *
 *   - Its trace ID: the 64-bit trace_id is the low half; the high half is
 *     the 16 hex digits of the _dd.p.tid tag, which only a trace's first
 *     span carries (or its chunk), so it is found across the whole request
 *     before any span is written. A v1 chunk carries all 128 bits itself.
 *     The span ID and parent ID are hex too; a parent of 0 is a root span.
 *     A span with no trace ID or span ID is dropped.
 *   - Its name is its resource - "GET /users/:id", a query, a queue's name:
 *     what Datadog's span list shows - else its operation name, kept too as
 *     datadog.operation_name, beside datadog.span_type (web, db, ...), and
 *     its IDs in decimal as datadog.trace_id and datadog.span_id, which a
 *     Datadog log's dd.trace_id is written in.
 *   - Its kind is its span.kind tag (server, client, producer, consumer,
 *     internal), a v1 span's own kind, or else what its type says: a web
 *     span is a server, an http, db or cache span a client.
 *   - Its times are start and start + duration, in nanoseconds.
 *   - Its service is its service, unless the tracer marked the service an
 *     integration named for it (_dd.base_service: a database span's
 *     "checkout-postgres" is the checkout service's call), kept then as
 *     datadog.service. The x-oneuptime-service-name header wins over both.
 *   - Its tags are attributes, under their own names. The HTTP, database
 *     and network tags OneUptime reads by their OpenTelemetry names
 *     (http.status_code, db.type, out.host, ...) are written under those
 *     too (http.response.status_code, db.system.name, server.address, ...),
 *     so a Datadog filter still matches and OneUptime's HTTP and database
 *     views see them. Datadog's own bookkeeping (_dd.*, sampling priority,
 *     _top_level) is not kept, nor are env, version, language and
 *     runtime-id, which name the resource.
 *   - An error (error = 1) is an ERROR status with its error.message, and
 *     an "exception" event of its error.type, error.message and
 *     error.stack - the tracer's own language's stack trace - so it
 *     reaches Exceptions as an OpenTelemetry SDK's exception does. One
 *     whose error says nothing is an ERROR status only.
 *   - Its links and events, as the tracer sent them: natively, or as the
 *     JSON tags _dd.span_links and events of a tracer the Agent did not
 *     tell it could.
 *
 * WHERE IT CAME FROM
 *
 * Spans are grouped into one resource per tracer and service, environment
 * and version: service.name, service.version (the tracer's version tag),
 * deployment.environment.name, host.name, container.id,
 * service.instance.id (the tracer's runtime ID), telemetry.sdk.language,
 * telemetry.sdk.version and process.runtime.version, and the Kubernetes and
 * container tags the Agent resolved for the tracer's container
 * (_dd.tags.container: kube_namespace is k8s.namespace.name, pod_name
 * k8s.pod.name, ...), under the scope "datadog".
 *
 * LIMITS
 *
 * A protobuf AgentPayload is counted before it is decoded
 * (ProtobufElementCount): one over DATADOG_PROTOBUF_MAX_ELEMENTS payloads,
 * chunks, spans, tags, links and events, or nested past
 * AGENT_PAYLOAD_MAX_DEPTH, is refused - 413 or 400. A MessagePack body is
 * counted the same way (Msgpack), and a JSON one (JsonElementCount),
 * against COMPATIBLE_JSON_MAX_VALUES values. A span's meta_struct (AppSec's
 * binary data) and the Agent's container-tag debug data are never decoded.
 * Spans past MAX_DATADOG_SPANS_PER_REQUEST are dropped and counted.
 */

export const MAX_DATADOG_SPANS_PER_REQUEST: number = 50_000;

/*
 * The deepest an AgentPayload's messages nest: payload, tracer payload,
 * chunk, span, attribute, then a v1 attribute's values within values.
 */
export const AGENT_PAYLOAD_MAX_DEPTH: number = 32;

// A JSON tag (a span's links or events) is parsed only when it holds at most this many values.
const MAX_JSON_TAG_VALUES: number = 10_000;

export type DatadogTracerProtocol = "v0.3" | "v0.4" | "v0.5";

export interface DatadogTracesOptions {
  // Now, in milliseconds since the epoch: a span that names no start starts then.
  nowInMs?: number | undefined;
  // The x-oneuptime-service-name header: the service of every span.
  serviceName?: string | undefined;
}

// What a tracer posting to /v0.x/traces says about itself, in its headers.
export interface DatadogTracerHeaders {
  // Datadog-Meta-Lang
  language?: string | undefined;
  // Datadog-Meta-Lang-Version
  languageVersion?: string | undefined;
  // Datadog-Meta-Tracer-Version
  tracerVersion?: string | undefined;
  // Datadog-Container-ID
  containerId?: string | undefined;
}

export interface DatadogTracerOptions extends DatadogTracesOptions {
  protocol: DatadogTracerProtocol;
  // A v0.3 or v0.4 body sent as JSON (Content-Type: application/json).
  isJson?: boolean | undefined;
  tracer?: DatadogTracerHeaders | undefined;
}

export interface DatadogTracesTranslation {
  // An ExportTraceServiceRequest, or null when no span was kept.
  traces: JSONObject | null;
  spanCount: number;
  // Spans with no trace or span ID, and spans past MAX_DATADOG_SPANS_PER_REQUEST.
  droppedSpanCount: number;
}

const PROTO_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "ProtoFiles",
  "Datadog",
  "trace_payload.proto",
);

/*
 * Field names as the .proto writes them (time_unix_nano, string_value), not
 * camel-cased: the names a tracer's MessagePack spans use too.
 */
const PARSE_OPTIONS: protobuf.IParseOptions = { keepCase: true };

const TraceProto: protobuf.Root = new protobuf.Root().loadSync(
  PROTO_PATH,
  PARSE_OPTIONS,
);

// The full payload, for what writes one.
export const DatadogAgentPayload: protobuf.Type = TraceProto.lookupType(
  "datadog.trace.AgentPayload",
);

/*
 * The payload as it is decoded: without a span's meta_struct (AppSec's and
 * IAST's binary data, up to megabytes a span) and the container-tag debug
 * data, which a decoder then steps over without making anything of them.
 */
const UNREAD_FIELDS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  ["datadog.trace.Span", ["meta_struct"]],
  ["datadog.trace.TracerPayload", ["containerDebug"]],
  ["datadog.trace.IdxTracerPayload", ["containerDebug"]],
];

const ReadingProto: protobuf.Root = new protobuf.Root().loadSync(
  PROTO_PATH,
  PARSE_OPTIONS,
);

for (const [typeName, fieldNames] of UNREAD_FIELDS) {
  const type: protobuf.Type = ReadingProto.lookupType(typeName);

  for (const fieldName of fieldNames) {
    type.remove(type.fields[fieldName]!);
  }

  // As DatadogIntake does: the constructor is made again for the fields left.
  type.ctor = protobuf.Type.generateConstructor(type)() as protobuf.Constructor<
    Record<string, unknown>
  >;
}

export const DatadogAgentPayloadAsRead: protobuf.Type = ReadingProto.lookupType(
  "datadog.trace.AgentPayload",
);

/*
 * What an AgentPayload, as read, decodes into an object, for the count taken
 * before it is decoded: each tracer payload with its tags, chunks and their
 * tags, spans with their meta and metrics entries, links and events; and
 * each v1 tracer payload with its strings, attributes, chunks and spans.
 * A v1 attribute's value may hold values, so its schema names itself.
 */
const ENTRY: ProtobufCountSchema = {};

const ATTRIBUTE_ANY_VALUE: ProtobufCountSchema = {
  messages: { 6: { messages: { 1: {} } } },
};

const SPAN_COUNT: ProtobufCountSchema = {
  messages: {
    10: ENTRY,
    11: ENTRY,
    14: { messages: { 4: ENTRY } },
    15: { messages: { 3: { messages: { 2: ATTRIBUTE_ANY_VALUE } } } },
  },
};

const IDX_ANY_VALUE: { messages: Record<number, ProtobufCountSchema> } = {
  messages: {},
};
IDX_ANY_VALUE.messages[6] = { messages: { 1: IDX_ANY_VALUE } };
IDX_ANY_VALUE.messages[7] = {
  messages: { 1: { messages: { 2: IDX_ANY_VALUE } } },
};

const IDX_ATTRIBUTE: ProtobufCountSchema = { messages: { 2: IDX_ANY_VALUE } };

export const DATADOG_AGENT_PAYLOAD_COUNT: ProtobufCountSchema = {
  messages: {
    5: {
      messages: {
        6: { messages: { 3: SPAN_COUNT, 4: ENTRY } },
        7: ENTRY,
      },
    },
    6: ENTRY,
    11: {
      strings: new Set<number>([1]),
      messages: {
        10: IDX_ATTRIBUTE,
        11: {
          messages: {
            3: IDX_ATTRIBUTE,
            4: {
              messages: {
                9: IDX_ATTRIBUTE,
                11: { messages: { 3: IDX_ATTRIBUTE } },
                12: { messages: { 3: IDX_ATTRIBUTE } },
              },
            },
          },
        },
      },
    },
  },
};

/*
 * 64-bit integers as decimal strings, so every ID and nanosecond is kept;
 * enums as numbers; a oneof's set member named (a v1 value); and proto3's
 * defaults written out.
 */
const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  longs: String,
  enums: Number,
  defaults: true,
  arrays: true,
  oneofs: true,
};

const SCOPE_NAME: string = "datadog";

const SPAN_KIND_INTERNAL: number = 1;
const SPAN_KIND_SERVER: number = 2;
const SPAN_KIND_CLIENT: number = 3;
const SPAN_KIND_PRODUCER: number = 4;
const SPAN_KIND_CONSUMER: number = 5;

const STATUS_CODE_UNSET: number = 0;
const STATUS_CODE_ERROR: number = 2;

const ZERO: bigint = BigInt(0);
const UINT64_RANGE: bigint = BigInt("18446744073709551616");
const UINT64_MAX: bigint = BigInt("18446744073709551615");
const INT64_MAX: bigint = BigInt("9223372036854775807");

const DIGITS: RegExp = /^-?\d{1,20}$/;
// A whole number written as text, small enough to be one exactly ("200").
const SMALL_INTEGER_TEXT: RegExp = /^\d{1,15}$/;
// A span ID written in decimal, as dd-trace writes one in a JSON link.
const DECIMAL_ID: RegExp = /^\d+$/;
const HEX_TRACE_ID_HIGH: RegExp = /^[0-9a-fA-F]{1,16}$/;

/*
 * The JSON fields that hold 64-bit integers, which JSON.parse would round:
 * written as strings before a JSON body (or a JSON tag) is parsed.
 */
const JSON_UINT64: RegExp =
  /"(trace_id|trace_id_high|span_id|parent_id|start|duration|time_unix_nano)"(\s*):(\s*)(-?\d{16,})(?![\d.eE])/g;

const SPAN_KINDS_BY_TAG: ReadonlyMap<string, number> = new Map<string, number>([
  ["server", SPAN_KIND_SERVER],
  ["client", SPAN_KIND_CLIENT],
  ["producer", SPAN_KIND_PRODUCER],
  ["consumer", SPAN_KIND_CONSUMER],
  ["internal", SPAN_KIND_INTERNAL],
]);

// A span type that calls out of the process, for a span with no span.kind.
const CLIENT_SPAN_TYPES: ReadonlySet<string> = new Set<string>([
  "http",
  "grpc",
  "sql",
  "db",
  "cache",
  "redis",
  "memcached",
  "cassandra",
  "mongodb",
  "elasticsearch",
  "opensearch",
  "leveldb",
  "aws",
]);

/*
 * The tags OneUptime reads under their OpenTelemetry names (its HTTP,
 * database and service map views), from Datadog's: written under both.
 */
const OTEL_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ["http.method", "http.request.method"],
  ["http.status_code", "http.response.status_code"],
  ["http.url", "url.full"],
  ["http.useragent", "user_agent.original"],
  ["http.client_ip", "client.address"],
  ["http.version", "network.protocol.version"],
  ["http.request.content_length", "http.request.body.size"],
  ["http.response.content_length", "http.response.body.size"],
  ["db.type", "db.system.name"],
  ["db.instance", "db.namespace"],
  ["db.statement", "db.query.text"],
  ["db.operation", "db.operation.name"],
  ["db.sql.table", "db.collection.name"],
  ["out.host", "server.address"],
  ["out.port", "server.port"],
  ["process_id", "process.pid"],
]);

// The OpenTelemetry names above whose values are integers.
const INTEGER_OTEL_NAMES: ReadonlySet<string> = new Set<string>([
  "http.response.status_code",
  "http.request.body.size",
  "http.response.body.size",
  "server.port",
  "process.pid",
]);

// Tags that name the resource, or say what else a span becomes: not span attributes.
const RESOURCE_TAGS: ReadonlySet<string> = new Set<string>([
  "env",
  "version",
  "language",
  "runtime-id",
  "span.kind",
  "events",
  "_sampling_priority_v1",
  "_top_level",
]);

// A failed span's error, which its status and exception event carry instead.
const ERROR_DETAIL_TAGS: ReadonlySet<string> = new Set<string>([
  "error.message",
  "error.msg",
  "error.stack",
  "error.stacktrace",
]);

/*
 * The container tags the Agent resolves for a tracer (_dd.tags.container),
 * as OpenTelemetry's resource attributes - the datadogreceiver's table.
 */
const CONTAINER_TAG_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["container_id", "container.id"],
  ["container_name", "container.name"],
  ["image_name", "container.image.name"],
  ["image_tag", "container.image.tag"],
  ["runtime", "container.runtime"],
  ["cloud_provider", "cloud.provider"],
  ["region", "cloud.region"],
  ["zone", "cloud.availability_zone"],
  ["task_family", "aws.ecs.task.family"],
  ["task_arn", "aws.ecs.task.arn"],
  ["task_version", "aws.ecs.task.revision"],
  ["kube_cluster_name", "k8s.cluster.name"],
  ["kube_namespace", "k8s.namespace.name"],
  ["pod_name", "k8s.pod.name"],
  ["kube_container_name", "k8s.container.name"],
  ["kube_deployment", "k8s.deployment.name"],
  ["kube_replica_set", "k8s.replicaset.name"],
  ["kube_stateful_set", "k8s.statefulset.name"],
  ["kube_daemon_set", "k8s.daemonset.name"],
  ["kube_job", "k8s.job.name"],
  ["kube_cronjob", "k8s.cronjob.name"],
]);

/*
 * A tracer's language (TracerPayload.languageName, Datadog-Meta-Lang) as
 * OpenTelemetry's telemetry.sdk.language, by which OneUptime picks the
 * stack trace parser and the service's runtime.
 */
const LANGUAGES: ReadonlyMap<string, string> = new Map<string, string>([
  ["python", "python"],
  ["nodejs", "nodejs"],
  ["node", "nodejs"],
  ["javascript", "nodejs"],
  ["java", "java"],
  ["jvm", "java"],
  ["go", "go"],
  ["golang", "go"],
  ["ruby", "ruby"],
  ["php", "php"],
  [".net", "dotnet"],
  ["dotnet", "dotnet"],
  ["cpp", "cpp"],
  ["c++", "cpp"],
  ["rust", "rust"],
  ["elixir", "erlang"],
  ["swift", "swift"],
]);

// A tag's value: a string (meta), a number (metrics), or a v1 attribute's own type.
type TagValue = string | number | boolean | bigint;

interface SpanView {
  service: string;
  name: string;
  resource: string;
  type: string;
  // The trace ID's high half, when the format carries it (a v1 chunk).
  traceIdHigh: bigint | null;
  traceIdLow: bigint;
  spanId: bigint;
  parentId: bigint;
  start: bigint;
  duration: bigint;
  error: boolean;
  tags: Map<string, TagValue>;
  // OTLP JSON links and events, from the native fields.
  links: Array<JSONObject>;
  events: Array<JSONObject>;
  // A v1 span's own kind; 0 when the format has none.
  kind: number;
  // A v1 span's own environment and version; "" when the format has none.
  env: string;
  version: string;
}

interface ChunkView {
  spans: Array<SpanView>;
  tags: Map<string, TagValue>;
  // A v1 chunk's 128-bit trace ID's high half.
  traceIdHigh: bigint | null;
}

interface PayloadView {
  containerId: string;
  languageName: string;
  languageVersion: string;
  tracerVersion: string;
  runtimeId: string;
  env: string;
  hostname: string;
  appVersion: string;
  tags: Map<string, TagValue>;
  chunks: Array<ChunkView>;
}

// What the AgentPayload says for every tracer payload in it.
interface AgentDefaults {
  hostname: string;
  env: string;
}

/*
 * What a chunk's spans say of the process that made them: a tracer tags
 * only a trace's first span with env, version, language and runtime-id, so
 * the other spans of its chunk take them from there.
 */
interface ChunkProcess {
  env: string;
  version: string;
  language: string;
  runtimeId: string;
}

interface ResourceBucket {
  attributes: Array<OtlpKeyValue>;
  tracerVersion: string;
  spans: Array<JSONObject>;
}

interface TranslationState {
  nowUnixNano: bigint;
  serviceOverride: string;
  buckets: Map<string, ResourceBucket>;
  // Each trace ID's high half, by its low half, from _dd.p.tid.
  traceIdHighs: Map<bigint, bigint>;
  spanCount: number;
  droppedSpanCount: number;
}

// A v1 payload's string table, read safely: a reference out of range is "".
type StringTable = (reference: unknown) => string;

export default class DatadogTraces {
  /*
   * POST /api/v0.2/traces: the Agent's AgentPayload, decompressed. Throws a
   * DatadogIntakeError: 400 for a body that is not one, 413 for one over
   * DATADOG_PROTOBUF_MAX_ELEMENTS (counted before it is decoded).
   */
  public static agentPayloadToOtlp(
    body: Buffer | Uint8Array,
    options: DatadogTracesOptions = {},
  ): DatadogTracesTranslation {
    const payload: JSONObject = DatadogTraces.decodeAgentPayload(body);
    const defaults: AgentDefaults = {
      hostname: DatadogTraces.text(payload["hostName"]),
      env: DatadogTraces.text(payload["env"]),
    };
    const views: Array<PayloadView> = [];

    for (const tracerPayload of DatadogTraces.objects(
      payload["tracerPayloads"],
    )) {
      views.push(DatadogTraces.tracerPayloadView(tracerPayload));
    }

    for (const idxPayload of DatadogTraces.objects(
      payload["idxTracerPayloads"],
    )) {
      views.push(DatadogTraces.idxTracerPayloadView(idxPayload));
    }

    return DatadogTraces.translate(views, defaults, options);
  }

  /*
   * PUT or POST /v0.3/traces, /v0.4/traces, /v0.5/traces: what a tracer
   * sends the Agent. v0.3 and v0.4 are an array of traces, each an array of
   * spans, in MessagePack or JSON; v0.5 is [strings, traces], each span an
   * array of its twelve fields, its strings references into the first.
   * Throws a DatadogIntakeError: 400 for a body that is none of these, 413
   * for one over COMPATIBLE_JSON_MAX_VALUES values.
   */
  public static tracerTracesToOtlp(
    body: Buffer | Uint8Array,
    options: DatadogTracerOptions,
  ): DatadogTracesTranslation {
    const traces: Array<Array<SpanView>> =
      options.protocol === "v0.5"
        ? DatadogTraces.v05Traces(DatadogTraces.decodeMsgpack(body))
        : DatadogTraces.v04Traces(
            options.isJson
              ? DatadogTraces.parseJsonBody(body)
              : DatadogTraces.decodeMsgpack(body),
          );

    const tracer: DatadogTracerHeaders = options.tracer || {};

    const view: PayloadView = {
      containerId: DatadogTraces.trimmed(tracer.containerId),
      languageName: DatadogTraces.trimmed(tracer.language),
      languageVersion: DatadogTraces.trimmed(tracer.languageVersion),
      tracerVersion: DatadogTraces.trimmed(tracer.tracerVersion),
      runtimeId: "",
      env: "",
      hostname: "",
      appVersion: "",
      tags: new Map<string, TagValue>(),
      chunks: traces.map((spans: Array<SpanView>): ChunkView => {
        return {
          spans: spans,
          tags: new Map<string, TagValue>(),
          traceIdHigh: null,
        };
      }),
    };

    return DatadogTraces.translate([view], { hostname: "", env: "" }, options);
  }

  private static decodeAgentPayload(body: Buffer | Uint8Array): JSONObject {
    const notThePayload: DatadogIntakeError = new DatadogIntakeError(
      400,
      "The body is not a Datadog AgentPayload protobuf.",
    );

    const count: ProtobufElementCount = ProtobufElementCounter.count(
      body,
      DATADOG_AGENT_PAYLOAD_COUNT,
      DATADOG_PROTOBUF_MAX_ELEMENTS,
      AGENT_PAYLOAD_MAX_DEPTH,
    );

    if (count.outcome === ProtobufElementCountOutcome.OverLimit) {
      throw new DatadogIntakeError(
        413,
        `The AgentPayload holds more than ${DATADOG_PROTOBUF_MAX_ELEMENTS} spans, tags, links and events. Send smaller payloads.`,
      );
    }

    if (count.outcome === ProtobufElementCountOutcome.Malformed) {
      throw notThePayload;
    }

    try {
      const message: protobuf.Message = DatadogAgentPayloadAsRead.decode(
        body as Uint8Array,
      );

      return DatadogAgentPayloadAsRead.toObject(
        message,
        TO_OBJECT_OPTIONS,
      ) as JSONObject;
    } catch {
      throw notThePayload;
    }
  }

  private static decodeMsgpack(body: Buffer | Uint8Array): MsgpackValue {
    const count: MsgpackElementCount = Msgpack.count(
      body,
      COMPATIBLE_JSON_MAX_VALUES,
    );

    if (count.outcome === MsgpackElementCountOutcome.OverLimit) {
      throw DatadogTraces.tooManyValues();
    }

    if (count.outcome === MsgpackElementCountOutcome.Malformed) {
      throw new DatadogIntakeError(400, "The body is not MessagePack.");
    }

    try {
      return Msgpack.decode(body);
    } catch (error) {
      if (error instanceof MsgpackDecodeError) {
        throw new DatadogIntakeError(400, "The body is not MessagePack.");
      }

      throw error;
    }
  }

  // A JSON body, its 64-bit integers kept whole.
  private static parseJsonBody(body: Buffer | Uint8Array): unknown {
    const text: string = Buffer.from(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    ).toString("utf8");

    const values: JsonElementCount = JsonElementCounter.count(
      text,
      COMPATIBLE_JSON_MAX_VALUES,
    );

    if (values.outcome === JsonElementCountOutcome.OverLimit) {
      throw DatadogTraces.tooManyValues();
    }

    try {
      return JSON.parse(
        DatadogTraces.quoteUint64s(
          text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
        ),
      );
    } catch {
      throw new DatadogIntakeError(400, "The body is not valid JSON.");
    }
  }

  private static tooManyValues(): DatadogIntakeError {
    return new DatadogIntakeError(
      413,
      `${JsonElementCounter.tooManyValuesMessage(COMPATIBLE_JSON_MAX_VALUES)} Send smaller payloads.`,
    );
  }

  private static quoteUint64s(text: string): string {
    return text.replace(
      JSON_UINT64,
      (
        _match: string,
        key: string,
        before: string,
        after: string,
        digits: string,
      ): string => {
        return `"${key}"${before}:${after}"${digits}"`;
      },
    );
  }

  // An AgentPayload's TracerPayload, decoded.
  private static tracerPayloadView(payload: JSONObject): PayloadView {
    return {
      containerId: DatadogTraces.text(payload["containerID"]),
      languageName: DatadogTraces.text(payload["languageName"]),
      languageVersion: DatadogTraces.text(payload["languageVersion"]),
      tracerVersion: DatadogTraces.text(payload["tracerVersion"]),
      runtimeId: DatadogTraces.text(payload["runtimeID"]),
      env: DatadogTraces.text(payload["env"]),
      hostname: DatadogTraces.text(payload["hostname"]),
      appVersion: DatadogTraces.text(payload["appVersion"]),
      tags: DatadogTraces.stringTags(payload["tags"]),
      chunks: DatadogTraces.objects(payload["chunks"]).map(
        (chunk: JSONObject): ChunkView => {
          return {
            spans: DatadogTraces.objects(chunk["spans"]).map(
              (span: JSONObject): SpanView => {
                return DatadogTraces.protobufSpanView(span);
              },
            ),
            tags: DatadogTraces.stringTags(chunk["tags"]),
            traceIdHigh: null,
          };
        },
      ),
    };
  }

  private static protobufSpanView(span: JSONObject): SpanView {
    const tags: Map<string, TagValue> = DatadogTraces.stringTags(span["meta"]);

    for (const [key, value] of DatadogTraces.ownEntries(span["metrics"])) {
      if (typeof value === "number" && Number.isFinite(value)) {
        tags.set(key, value);
      }
    }

    return {
      service: DatadogTraces.text(span["service"]),
      name: DatadogTraces.text(span["name"]),
      resource: DatadogTraces.text(span["resource"]),
      type: DatadogTraces.text(span["type"]),
      traceIdHigh: null,
      traceIdLow: DatadogTraces.uint64(span["traceID"]),
      spanId: DatadogTraces.uint64(span["spanID"]),
      parentId: DatadogTraces.uint64(span["parentID"]),
      start: DatadogTraces.int64(span["start"]),
      duration: DatadogTraces.int64(span["duration"]),
      error: DatadogTraces.isError(span["error"]),
      tags: tags,
      links: DatadogTraces.objects(span["spanLinks"])
        .map((link: JSONObject): JSONObject | null => {
          return DatadogTraces.otlpLink({
            traceIdHigh: DatadogTraces.uint64(link["traceID_high"]),
            traceIdLow: DatadogTraces.uint64(link["traceID"]),
            spanId: DatadogTraces.uint64(link["spanID"]),
            traceState: DatadogTraces.text(link["tracestate"]),
            flags: DatadogTraces.uint64(link["flags"]),
            attributes: DatadogTraces.attributesOf(
              DatadogTraces.stringTags(link["attributes"]),
            ),
          });
        })
        .filter(DatadogTraces.isPresent),
      events: DatadogTraces.objects(span["spanEvents"]).map(
        (event: JSONObject): JSONObject => {
          return DatadogTraces.otlpEvent({
            timeUnixNano: DatadogTraces.uint64(event["time_unix_nano"]),
            name: DatadogTraces.text(event["name"]),
            attributes: DatadogTraces.anyValueAttributes(event["attributes"]),
          });
        },
      ),
      kind: 0,
      env: "",
      version: "",
    };
  }

  // A native span event's attributes (map<string, AttributeAnyValue>).
  private static anyValueAttributes(value: unknown): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    for (const [key, anyValue] of DatadogTraces.ownEntries(value)) {
      const tag: TagValue | null = DatadogTraces.attributeAnyValue(anyValue);

      if (tag !== null) {
        OtlpJson.pushAll(attributes, DatadogTraces.attribute(key, tag));
      }
    }

    return attributes;
  }

  /*
   * An AttributeAnyValue, whatever it was decoded from: the protobuf message
   * (type, string_value, ...) or its MessagePack twin. An array is kept as
   * the JSON of its values.
   */
  private static attributeAnyValue(value: unknown): TagValue | null {
    const type: number = Number(DatadogTraces.field(value, "type") ?? 0);

    switch (type) {
      case 0:
        return DatadogTraces.text(DatadogTraces.field(value, "string_value"));
      case 1:
        return DatadogTraces.field(value, "bool_value") === true;
      case 2:
        return DatadogTraces.int64(DatadogTraces.field(value, "int_value"));
      case 3: {
        const number: number | null = DatadogTraces.number(
          DatadogTraces.field(value, "double_value"),
        );

        return number;
      }
      case 4: {
        const values: Array<unknown> = DatadogTraces.list(
          DatadogTraces.field(
            DatadogTraces.field(value, "array_value"),
            "values",
          ),
        ).map((item: unknown): unknown => {
          const scalar: TagValue | null = DatadogTraces.attributeAnyValue(item);

          return typeof scalar === "bigint" ? scalar.toString() : scalar;
        });

        return JSON.stringify(values);
      }
      default:
        return null;
    }
  }

  // An AgentPayload's v1 TracerPayload, decoded: every string a reference.
  private static idxTracerPayloadView(payload: JSONObject): PayloadView {
    const strings: Array<string> = DatadogTraces.list(payload["strings"]).map(
      (value: unknown): string => {
        return typeof value === "string" ? value : "";
      },
    );
    const lookup: StringTable = (reference: unknown): string => {
      const index: number = Number(reference);

      return Number.isSafeInteger(index) && index >= 0 && index < strings.length
        ? strings[index]!
        : "";
    };

    return {
      containerId: lookup(payload["containerIDRef"]),
      languageName: lookup(payload["languageNameRef"]),
      languageVersion: lookup(payload["languageVersionRef"]),
      tracerVersion: lookup(payload["tracerVersionRef"]),
      runtimeId: lookup(payload["runtimeIDRef"]),
      env: lookup(payload["envRef"]),
      hostname: lookup(payload["hostnameRef"]),
      appVersion: lookup(payload["appVersionRef"]),
      tags: DatadogTraces.idxTags(payload["attributes"], lookup),
      chunks: DatadogTraces.objects(payload["chunks"]).map(
        (chunk: JSONObject): ChunkView => {
          const traceId: Buffer | null = DatadogTraces.bytes(chunk["traceID"]);
          const halves: { high: bigint; low: bigint } =
            DatadogTraces.traceIdHalves(traceId);
          const origin: string = lookup(chunk["originRef"]);
          const tags: Map<string, TagValue> = DatadogTraces.idxTags(
            chunk["attributes"],
            lookup,
          );

          if (origin && !tags.has("_dd.origin")) {
            tags.set("_dd.origin", origin);
          }

          return {
            spans: DatadogTraces.objects(chunk["spans"]).map(
              (span: JSONObject): SpanView => {
                return DatadogTraces.idxSpanView(span, halves.low, lookup);
              },
            ),
            tags: tags,
            traceIdHigh: halves.high,
          };
        },
      ),
    };
  }

  private static idxSpanView(
    span: JSONObject,
    traceIdLow: bigint,
    lookup: StringTable,
  ): SpanView {
    const kind: number = Number(span["kind"] ?? 0);
    const component: string = lookup(span["componentRef"]);
    const tags: Map<string, TagValue> = DatadogTraces.idxTags(
      span["attributes"],
      lookup,
    );

    if (component && !tags.has("component")) {
      tags.set("component", component);
    }

    return {
      service: lookup(span["serviceRef"]),
      name: lookup(span["nameRef"]),
      resource: lookup(span["resourceRef"]),
      type: lookup(span["typeRef"]),
      traceIdHigh: null,
      traceIdLow: traceIdLow,
      spanId: DatadogTraces.uint64(span["spanID"]),
      parentId: DatadogTraces.uint64(span["parentID"]),
      start: DatadogTraces.int64(span["start"]),
      duration: DatadogTraces.int64(span["duration"]),
      error: span["error"] === true,
      tags: tags,
      links: DatadogTraces.objects(span["links"])
        .map((link: JSONObject): JSONObject | null => {
          const halves: { high: bigint; low: bigint } =
            DatadogTraces.traceIdHalves(DatadogTraces.bytes(link["traceID"]));

          return DatadogTraces.otlpLink({
            traceIdHigh: halves.high,
            traceIdLow: halves.low,
            spanId: DatadogTraces.uint64(link["spanID"]),
            traceState: lookup(link["tracestateRef"]),
            flags: DatadogTraces.uint64(link["flags"]),
            attributes: DatadogTraces.attributesOf(
              DatadogTraces.idxTags(link["attributes"], lookup),
            ),
          });
        })
        .filter(DatadogTraces.isPresent),
      events: DatadogTraces.objects(span["events"]).map(
        (event: JSONObject): JSONObject => {
          return DatadogTraces.otlpEvent({
            timeUnixNano: DatadogTraces.uint64(event["time"]),
            name: lookup(event["nameRef"]),
            attributes: DatadogTraces.attributesOf(
              DatadogTraces.idxTags(event["attributes"], lookup),
            ),
          });
        },
      ),
      kind: kind >= SPAN_KIND_INTERNAL && kind <= SPAN_KIND_CONSUMER ? kind : 0,
      env: lookup(span["envRef"]),
      version: lookup(span["versionRef"]),
    };
  }

  // A v1 attribute map (map<uint32, AnyValue>): keys and strings are references.
  private static idxTags(
    value: unknown,
    lookup: StringTable,
  ): Map<string, TagValue> {
    const tags: Map<string, TagValue> = new Map<string, TagValue>();

    for (const [reference, anyValue] of DatadogTraces.ownEntries(value)) {
      const key: string = lookup(reference);
      const tag: TagValue | null = DatadogTraces.idxValue(anyValue, lookup, 0);

      if (key && tag !== null) {
        tags.set(key, tag);
      }
    }

    return tags;
  }

  // A v1 AnyValue; an array or a key-value list is kept as its JSON.
  private static idxValue(
    value: unknown,
    lookup: StringTable,
    depth: number,
  ): TagValue | null {
    if (!DatadogTraces.isRecord(value)) {
      return null;
    }

    switch (value["value"]) {
      case "stringValueRef":
        return lookup(value["stringValueRef"]);
      case "boolValue":
        return value["boolValue"] === true;
      case "doubleValue":
        return DatadogTraces.number(value["doubleValue"]);
      case "intValue":
        return DatadogTraces.int64(value["intValue"]);
      case "bytesValue": {
        const bytes: Buffer | null = DatadogTraces.bytes(value["bytesValue"]);

        return bytes ? bytes.toString("base64") : null;
      }
      case "arrayValue":
      case "keyValueList":
        return JSON.stringify(DatadogTraces.idxJson(value, lookup, depth));
      default:
        return null;
    }
  }

  private static idxJson(
    value: unknown,
    lookup: StringTable,
    depth: number,
  ): unknown {
    if (!DatadogTraces.isRecord(value) || depth > AGENT_PAYLOAD_MAX_DEPTH) {
      return null;
    }

    if (value["value"] === "arrayValue") {
      return DatadogTraces.list(
        DatadogTraces.field(value["arrayValue"], "values"),
      ).map((item: unknown): unknown => {
        return DatadogTraces.idxJson(item, lookup, depth + 1);
      });
    }

    if (value["value"] === "keyValueList") {
      const object: Record<string, unknown> = {};

      for (const entry of DatadogTraces.list(
        DatadogTraces.field(value["keyValueList"], "keyValues"),
      )) {
        const key: string = lookup(DatadogTraces.field(entry, "key"));

        if (key) {
          Object.defineProperty(object, key, {
            value: DatadogTraces.idxJson(
              DatadogTraces.field(entry, "value"),
              lookup,
              depth + 1,
            ),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }

      return object;
    }

    const scalar: TagValue | null = DatadogTraces.idxValue(
      value,
      lookup,
      depth,
    );

    return typeof scalar === "bigint" ? scalar.toString() : scalar;
  }

  // A v0.3 or v0.4 body: an array of traces, each an array of span maps.
  private static v04Traces(body: unknown): Array<Array<SpanView>> {
    if (!Array.isArray(body)) {
      throw new DatadogIntakeError(
        400,
        "The body is not an array of traces, each an array of spans.",
      );
    }

    return body.map((trace: unknown): Array<SpanView> => {
      return DatadogTraces.list(trace)
        .filter((span: unknown): boolean => {
          return span instanceof Map || DatadogTraces.isRecord(span);
        })
        .map((span: unknown): SpanView => {
          return DatadogTraces.v04SpanView(span);
        });
    });
  }

  private static v04SpanView(span: unknown): SpanView {
    const tags: Map<string, TagValue> = new Map<string, TagValue>();

    for (const [key, value] of DatadogTraces.entries(
      DatadogTraces.field(span, "meta"),
    )) {
      const text: string | null = DatadogTraces.tagString(value);

      if (typeof key === "string" && key && text !== null) {
        tags.set(key, text);
      }
    }

    for (const [key, value] of DatadogTraces.entries(
      DatadogTraces.field(span, "metrics"),
    )) {
      const number: number | null = DatadogTraces.number(value);

      if (typeof key === "string" && key && number !== null) {
        tags.set(key, number);
      }
    }

    return {
      service: DatadogTraces.text(DatadogTraces.field(span, "service")),
      name: DatadogTraces.text(DatadogTraces.field(span, "name")),
      resource: DatadogTraces.text(DatadogTraces.field(span, "resource")),
      type: DatadogTraces.text(DatadogTraces.field(span, "type")),
      traceIdHigh: null,
      traceIdLow: DatadogTraces.uint64(DatadogTraces.field(span, "trace_id")),
      spanId: DatadogTraces.uint64(DatadogTraces.field(span, "span_id")),
      parentId: DatadogTraces.uint64(DatadogTraces.field(span, "parent_id")),
      start: DatadogTraces.int64(DatadogTraces.field(span, "start")),
      duration: DatadogTraces.int64(DatadogTraces.field(span, "duration")),
      error: DatadogTraces.isError(DatadogTraces.field(span, "error")),
      tags: tags,
      links: DatadogTraces.list(DatadogTraces.field(span, "span_links"))
        .map((link: unknown): JSONObject | null => {
          const attributes: Map<string, TagValue> = new Map<string, TagValue>();

          for (const [key, value] of DatadogTraces.entries(
            DatadogTraces.field(link, "attributes"),
          )) {
            const text: string | null = DatadogTraces.tagString(value);

            if (typeof key === "string" && key && text !== null) {
              attributes.set(key, text);
            }
          }

          return DatadogTraces.otlpLink({
            traceIdHigh: DatadogTraces.uint64(
              DatadogTraces.field(link, "trace_id_high"),
            ),
            traceIdLow: DatadogTraces.uint64(
              DatadogTraces.field(link, "trace_id"),
            ),
            spanId: DatadogTraces.uint64(DatadogTraces.field(link, "span_id")),
            traceState: DatadogTraces.text(
              DatadogTraces.field(link, "tracestate"),
            ),
            flags: DatadogTraces.uint64(DatadogTraces.field(link, "flags")),
            attributes: DatadogTraces.attributesOf(attributes),
          });
        })
        .filter(DatadogTraces.isPresent),
      events: DatadogTraces.list(DatadogTraces.field(span, "span_events")).map(
        (event: unknown): JSONObject => {
          const attributes: Array<OtlpKeyValue> = [];

          for (const [key, value] of DatadogTraces.entries(
            DatadogTraces.field(event, "attributes"),
          )) {
            const tag: TagValue | null = DatadogTraces.attributeAnyValue(value);

            if (typeof key === "string" && tag !== null) {
              OtlpJson.pushAll(attributes, DatadogTraces.attribute(key, tag));
            }
          }

          return DatadogTraces.otlpEvent({
            timeUnixNano: DatadogTraces.uint64(
              DatadogTraces.field(event, "time_unix_nano"),
            ),
            name: DatadogTraces.text(DatadogTraces.field(event, "name")),
            attributes: attributes,
          });
        },
      ),
      kind: 0,
      env: "",
      version: "",
    };
  }

  // A v0.5 body: [strings, traces], each span its twelve fields in order.
  private static v05Traces(body: MsgpackValue): Array<Array<SpanView>> {
    const notV05: () => DatadogIntakeError = (): DatadogIntakeError => {
      return new DatadogIntakeError(
        400,
        "The body is not a v0.5 payload: [strings, traces], each span an array of 12 fields.",
      );
    };

    if (!Array.isArray(body) || body.length !== 2 || !Array.isArray(body[0])) {
      throw notV05();
    }

    const strings: Array<string> = body[0].map(
      (value: MsgpackValue): string => {
        return Msgpack.toText(value);
      },
    );
    const lookup: (reference: MsgpackValue | undefined) => string = (
      reference: MsgpackValue | undefined,
    ): string => {
      const index: number | null = Msgpack.toNumber(reference);

      // The trace-agent refuses a payload that names a string it lacks.
      if (
        index === null ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= strings.length
      ) {
        throw notV05();
      }

      return strings[index]!;
    };

    return DatadogTraces.list(body[1]).map(
      (trace: unknown): Array<SpanView> => {
        return DatadogTraces.list(trace).map((span: unknown): SpanView => {
          if (!Array.isArray(span) || span.length !== 12) {
            throw notV05();
          }

          const fields: Array<MsgpackValue> = span as Array<MsgpackValue>;
          const tags: Map<string, TagValue> = new Map<string, TagValue>();

          for (const [key, value] of DatadogTraces.entries(fields[9])) {
            tags.set(
              lookup(key as MsgpackValue),
              lookup(value as MsgpackValue),
            );
          }

          for (const [key, value] of DatadogTraces.entries(fields[10])) {
            const number: number | null = Msgpack.toNumber(
              value as MsgpackValue,
            );

            if (number !== null) {
              tags.set(lookup(key as MsgpackValue), number);
            }
          }

          tags.delete("");

          return {
            service: lookup(fields[0]),
            name: lookup(fields[1]),
            resource: lookup(fields[2]),
            type: lookup(fields[11]),
            traceIdHigh: null,
            traceIdLow: DatadogTraces.uint64(fields[3]),
            spanId: DatadogTraces.uint64(fields[4]),
            parentId: DatadogTraces.uint64(fields[5]),
            start: DatadogTraces.int64(fields[6]),
            duration: DatadogTraces.int64(fields[7]),
            error: DatadogTraces.isError(fields[8]),
            tags: tags,
            links: [],
            events: [],
            kind: 0,
            env: "",
            version: "",
          };
        });
      },
    );
  }

  private static translate(
    payloads: Array<PayloadView>,
    defaults: AgentDefaults,
    options: DatadogTracesOptions,
  ): DatadogTracesTranslation {
    const state: TranslationState = {
      nowUnixNano: BigInt(OtlpJson.nowUnixNano(options.nowInMs)),
      serviceOverride: DatadogTraces.trimmed(options.serviceName),
      buckets: new Map<string, ResourceBucket>(),
      traceIdHighs: DatadogTraces.traceIdHighs(payloads),
      spanCount: 0,
      droppedSpanCount: 0,
    };

    for (const [payloadIndex, payload] of payloads.entries()) {
      for (const chunk of payload.chunks) {
        const process: ChunkProcess = DatadogTraces.chunkProcess(chunk);

        for (const span of chunk.spans) {
          if (state.spanCount >= MAX_DATADOG_SPANS_PER_REQUEST) {
            state.droppedSpanCount++;
            continue;
          }

          const otlpSpan: JSONObject | null = DatadogTraces.otlpSpan(
            state,
            span,
            chunk,
          );

          if (!otlpSpan) {
            state.droppedSpanCount++;
            continue;
          }

          DatadogTraces.bucketOf(
            state,
            payloadIndex,
            payload,
            span,
            process,
            defaults,
          ).spans.push(otlpSpan);
          state.spanCount++;
        }
      }
    }

    if (state.spanCount === 0) {
      return {
        traces: null,
        spanCount: 0,
        droppedSpanCount: state.droppedSpanCount,
      };
    }

    return {
      traces: {
        resourceSpans: Array.from(state.buckets.values()).map(
          (bucket: ResourceBucket): JSONObject => {
            return {
              resource: { attributes: bucket.attributes },
              scopeSpans: [
                {
                  scope: bucket.tracerVersion
                    ? { name: SCOPE_NAME, version: bucket.tracerVersion }
                    : { name: SCOPE_NAME },
                  spans: bucket.spans,
                },
              ],
            } as unknown as JSONObject;
          },
        ),
      } as unknown as JSONObject,
      spanCount: state.spanCount,
      droppedSpanCount: state.droppedSpanCount,
    };
  }

  /*
   * Each trace's high half, by its low half: a 128-bit trace is marked by
   * _dd.p.tid on its first span, or on its chunk, and its other spans carry
   * only the low half - in that chunk, or in another one.
   */
  private static traceIdHighs(
    payloads: Array<PayloadView>,
  ): Map<bigint, bigint> {
    const highs: Map<bigint, bigint> = new Map<bigint, bigint>();

    for (const payload of payloads) {
      for (const chunk of payload.chunks) {
        const chunkHigh: bigint | null = DatadogTraces.traceIdHighTag(
          chunk.tags,
        );

        for (const span of chunk.spans) {
          const high: bigint | null =
            DatadogTraces.traceIdHighTag(span.tags) ?? chunkHigh;

          if (high !== null && span.traceIdLow !== ZERO) {
            highs.set(span.traceIdLow, high);
          }
        }
      }
    }

    return highs;
  }

  private static traceIdHighTag(tags: Map<string, TagValue>): bigint | null {
    const value: TagValue | undefined = tags.get("_dd.p.tid");

    if (typeof value !== "string" || !HEX_TRACE_ID_HIGH.test(value.trim())) {
      return null;
    }

    return BigInt(`0x${value.trim()}`);
  }

  private static otlpSpan(
    state: TranslationState,
    span: SpanView,
    chunk: ChunkView,
  ): JSONObject | null {
    const traceIdHigh: bigint =
      span.traceIdHigh ??
      chunk.traceIdHigh ??
      state.traceIdHighs.get(span.traceIdLow) ??
      ZERO;
    const traceId: string = DatadogTraces.hexTraceId(
      traceIdHigh,
      span.traceIdLow,
    );
    const spanId: string = DatadogTraces.hexSpanId(span.spanId);

    if (!traceId || !spanId) {
      return null;
    }

    // The chunk's tags are its spans' too; a span's own win.
    const tags: Map<string, TagValue> = new Map<string, TagValue>(chunk.tags);

    for (const [key, value] of span.tags) {
      tags.set(key, value);
    }

    const start: bigint = span.start > ZERO ? span.start : state.nowUnixNano;
    const end: bigint = start + (span.duration > ZERO ? span.duration : ZERO);
    const kind: number = DatadogTraces.spanKind(span, tags);
    const parentSpanId: string = DatadogTraces.hexSpanId(span.parentId);

    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("datadog.operation_name", span.name),
      OtlpJson.stringAttribute("datadog.span_type", span.type),
      OtlpJson.stringAttribute("datadog.trace_id", span.traceIdLow.toString()),
      OtlpJson.stringAttribute("datadog.span_id", span.spanId.toString()),
    );

    const baseService: string = DatadogTraces.tagText(tags, "_dd.base_service");

    if (baseService && span.service && baseService !== span.service) {
      OtlpJson.pushAll(
        attributes,
        OtlpJson.stringAttribute("datadog.service", span.service),
      );
    }

    attributes.push(...DatadogTraces.tagAttributes(tags, span.error));

    // A call's peer, as OpenTelemetry names it, when the tracer named only its host.
    if (
      (kind === SPAN_KIND_CLIENT ||
        kind === SPAN_KIND_PRODUCER ||
        kind === SPAN_KIND_CONSUMER) &&
      !tags.has("server.address") &&
      !tags.has("out.host")
    ) {
      OtlpJson.pushAll(
        attributes,
        OtlpJson.stringAttribute(
          "server.address",
          DatadogTraces.tagText(tags, "peer.hostname"),
        ),
      );
    }

    const events: Array<JSONObject> =
      span.events.length > 0
        ? [...span.events]
        : DatadogTraces.jsonTagEvents(tags.get("events"));

    const errorMessage: string =
      DatadogTraces.tagText(tags, "error.message") ||
      DatadogTraces.tagText(tags, "error.msg");

    if (span.error) {
      const exception: JSONObject | null = DatadogTraces.exceptionEvent(
        tags,
        errorMessage,
        end,
      );

      if (
        exception &&
        !events.some((event: JSONObject): boolean => {
          return event["name"] === "exception";
        })
      ) {
        events.push(exception);
      }
    }

    const links: Array<JSONObject> =
      span.links.length > 0
        ? span.links
        : DatadogTraces.jsonTagLinks(tags.get("_dd.span_links"));

    const status: JSONObject = span.error
      ? {
          code: STATUS_CODE_ERROR,
          ...(errorMessage || DatadogTraces.tagText(tags, "error.type")
            ? {
                message:
                  errorMessage || DatadogTraces.tagText(tags, "error.type"),
              }
            : {}),
        }
      : { code: STATUS_CODE_UNSET };

    return {
      traceId: traceId,
      spanId: spanId,
      ...(parentSpanId ? { parentSpanId: parentSpanId } : {}),
      name: span.resource || span.name || span.type || "span",
      kind: kind,
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      attributes: DatadogTraces.uniqueByKey(attributes),
      ...(events.length > 0 ? { events: events } : {}),
      ...(links.length > 0 ? { links: links } : {}),
      status: status,
    } as unknown as JSONObject;
  }

  private static spanKind(span: SpanView, tags: Map<string, TagValue>): number {
    if (span.kind > 0) {
      return span.kind;
    }

    const tagged: number | undefined = SPAN_KINDS_BY_TAG.get(
      DatadogTraces.tagText(tags, "span.kind").toLowerCase(),
    );

    if (tagged !== undefined) {
      return tagged;
    }

    const type: string = span.type.toLowerCase();

    if (type === "web") {
      return SPAN_KIND_SERVER;
    }

    return CLIENT_SPAN_TYPES.has(type) ? SPAN_KIND_CLIENT : SPAN_KIND_INTERNAL;
  }

  /*
   * A failed span's "exception" event: its error.type, error.message and
   * error.stack, at its end. None when its error says nothing.
   */
  private static exceptionEvent(
    tags: Map<string, TagValue>,
    message: string,
    end: bigint,
  ): JSONObject | null {
    const type: string =
      DatadogTraces.tagText(tags, "error.type") ||
      DatadogTraces.tagText(tags, "error.kind");
    // As the tracer wrote it: a traceback's last line ends in a newline.
    const stackTrace: string =
      DatadogTraces.tagRaw(tags, "error.stack") ||
      DatadogTraces.tagRaw(tags, "error.stacktrace");

    if (!type && !message && !stackTrace) {
      return null;
    }

    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("exception.type", type),
      OtlpJson.stringAttribute("exception.message", message),
      OtlpJson.stringAttribute("exception.stacktrace", stackTrace),
    );

    return {
      timeUnixNano: end.toString(),
      name: "exception",
      attributes: attributes,
    } as unknown as JSONObject;
  }

  /*
   * A span's tags as attributes: under their own names, and those
   * OneUptime reads by their OpenTelemetry names under those too, unless the
   * span sent that name itself. Datadog's bookkeeping is left out, and so is
   * a failed span's error, which its exception event carries.
   */
  private static tagAttributes(
    tags: Map<string, TagValue>,
    isError: boolean,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    for (const [key, value] of tags) {
      if (
        DatadogTraces.isBookkeeping(key) ||
        RESOURCE_TAGS.has(key) ||
        (isError && ERROR_DETAIL_TAGS.has(key))
      ) {
        continue;
      }

      OtlpJson.pushAll(attributes, DatadogTraces.attribute(key, value));

      const otelName: string | undefined = OTEL_NAMES.get(key);

      if (otelName && !tags.has(otelName)) {
        OtlpJson.pushAll(
          attributes,
          DatadogTraces.attribute(
            otelName,
            INTEGER_OTEL_NAMES.has(otelName)
              ? DatadogTraces.asInteger(value)
              : value,
          ),
        );
      }
    }

    return attributes;
  }

  private static isBookkeeping(key: string): boolean {
    return key.startsWith("_dd.") || key.startsWith("_dd1.");
  }

  // A number written as text ("200") as the integer it is; anything else as it is.
  private static asInteger(value: TagValue): TagValue {
    if (typeof value === "string" && SMALL_INTEGER_TEXT.test(value.trim())) {
      return Number(value.trim());
    }

    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    return value;
  }

  private static attribute(key: string, value: TagValue): OtlpKeyValue | null {
    if (typeof value === "string") {
      return { key: key, value: { stringValue: value } };
    }

    return OtlpJson.attribute(key, value);
  }

  private static attributesOf(
    tags: Map<string, TagValue>,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    for (const [key, value] of tags) {
      OtlpJson.pushAll(attributes, DatadogTraces.attribute(key, value));
    }

    return attributes;
  }

  private static otlpLink(link: {
    traceIdHigh: bigint;
    traceIdLow: bigint;
    spanId: bigint;
    traceState: string;
    flags: bigint;
    attributes: Array<OtlpKeyValue>;
  }): JSONObject | null {
    const traceId: string = DatadogTraces.hexTraceId(
      link.traceIdHigh,
      link.traceIdLow,
    );
    const spanId: string = DatadogTraces.hexSpanId(link.spanId);

    if (!traceId || !spanId) {
      return null;
    }

    return {
      traceId: traceId,
      spanId: spanId,
      ...(link.traceState ? { traceState: link.traceState } : {}),
      ...(link.flags > ZERO && link.flags <= BigInt(0xffffffff)
        ? { flags: Number(link.flags) }
        : {}),
      attributes: link.attributes,
    } as unknown as JSONObject;
  }

  private static otlpEvent(event: {
    timeUnixNano: bigint;
    name: string;
    attributes: Array<OtlpKeyValue>;
  }): JSONObject {
    return {
      timeUnixNano: event.timeUnixNano.toString(),
      name: event.name || "event",
      attributes: event.attributes,
    } as unknown as JSONObject;
  }

  /*
   * The links a tracer wrote as JSON (_dd.span_links), when the Agent did
   * not tell it it could send them natively: IDs in decimal (trace_id and
   * trace_id_high, span_id), or in hex as the Agent writes an OpenTelemetry
   * span's.
   */
  private static jsonTagLinks(value: TagValue | undefined): Array<JSONObject> {
    const links: Array<JSONObject> = [];

    for (const link of DatadogTraces.parseJsonTag(value)) {
      const hexTraceId: string =
        typeof DatadogTraces.field(link, "trace_id") === "string" &&
        String(DatadogTraces.field(link, "trace_id")).length === 32
          ? OtlpJson.hexId(DatadogTraces.field(link, "trace_id"), 32)
          : "";
      const hexSpanId: string =
        typeof DatadogTraces.field(link, "span_id") === "string" &&
        String(DatadogTraces.field(link, "span_id")).length === 16 &&
        !DECIMAL_ID.test(String(DatadogTraces.field(link, "span_id")))
          ? OtlpJson.hexId(DatadogTraces.field(link, "span_id"), 16)
          : "";
      const traceIdHigh: bigint = hexTraceId
        ? BigInt(`0x${hexTraceId.slice(0, 16)}`)
        : DatadogTraces.uint64(DatadogTraces.field(link, "trace_id_high"));
      const traceIdLow: bigint = hexTraceId
        ? BigInt(`0x${hexTraceId.slice(16)}`)
        : DatadogTraces.uint64(DatadogTraces.field(link, "trace_id"));
      const attributes: Array<OtlpKeyValue> = DatadogTraces.isRecord(
        DatadogTraces.field(link, "attributes"),
      )
        ? OtlpJson.attributesFromObject(
            DatadogTraces.field(link, "attributes") as JSONObject,
          )
        : [];

      const otlp: JSONObject | null = DatadogTraces.otlpLink({
        traceIdHigh: traceIdHigh,
        traceIdLow: traceIdLow,
        spanId: hexSpanId
          ? BigInt(`0x${hexSpanId}`)
          : DatadogTraces.uint64(DatadogTraces.field(link, "span_id")),
        traceState: DatadogTraces.text(DatadogTraces.field(link, "tracestate")),
        flags: DatadogTraces.uint64(DatadogTraces.field(link, "flags")),
        attributes: attributes,
      });

      if (otlp) {
        links.push(otlp);
      }
    }

    return links;
  }

  // The events a tracer wrote as JSON (the events tag): name, time_unix_nano, attributes.
  private static jsonTagEvents(value: TagValue | undefined): Array<JSONObject> {
    return DatadogTraces.parseJsonTag(value).map(
      (event: unknown): JSONObject => {
        const attributes: unknown = DatadogTraces.field(event, "attributes");

        return DatadogTraces.otlpEvent({
          timeUnixNano: DatadogTraces.uint64(
            DatadogTraces.field(event, "time_unix_nano"),
          ),
          name: DatadogTraces.text(DatadogTraces.field(event, "name")),
          attributes: DatadogTraces.isRecord(attributes)
            ? OtlpJson.attributesFromObject(attributes as JSONObject)
            : [],
        });
      },
    );
  }

  // A JSON tag's array, counted before it is parsed; anything else is no entries.
  private static parseJsonTag(value: TagValue | undefined): Array<unknown> {
    if (typeof value !== "string" || !value.trim().startsWith("[")) {
      return [];
    }

    const count: JsonElementCount = JsonElementCounter.count(
      value,
      MAX_JSON_TAG_VALUES,
    );

    if (count.outcome === JsonElementCountOutcome.OverLimit) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(DatadogTraces.quoteUint64s(value));

      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /*
   * The resource a span belongs to, made once: its tracer's, and its
   * service, environment and version.
   */
  private static bucketOf(
    state: TranslationState,
    payloadIndex: number,
    payload: PayloadView,
    span: SpanView,
    process: ChunkProcess,
    defaults: AgentDefaults,
  ): ResourceBucket {
    const serviceName: string =
      state.serviceOverride ||
      DatadogTraces.tagText(span.tags, "_dd.base_service") ||
      span.service;
    const environment: string =
      span.env ||
      DatadogTraces.tagText(span.tags, "env") ||
      payload.env ||
      process.env ||
      defaults.env;
    const version: string =
      span.version ||
      payload.appVersion ||
      DatadogTraces.tagText(span.tags, "version") ||
      process.version;
    const language: string =
      payload.languageName ||
      DatadogTraces.tagText(span.tags, "language") ||
      process.language;
    const runtimeId: string =
      payload.runtimeId ||
      DatadogTraces.tagText(span.tags, "runtime-id") ||
      process.runtimeId;

    const key: string = [
      payloadIndex,
      serviceName,
      environment,
      version,
      language,
      runtimeId,
    ].join("\u0000");

    let bucket: ResourceBucket | undefined = state.buckets.get(key);

    if (bucket) {
      return bucket;
    }

    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("service.name", serviceName),
      OtlpJson.stringAttribute("service.version", version),
      OtlpJson.stringAttribute("deployment.environment.name", environment),
      OtlpJson.stringAttribute(
        "host.name",
        payload.hostname || defaults.hostname,
      ),
      OtlpJson.stringAttribute("container.id", payload.containerId),
      OtlpJson.stringAttribute("service.instance.id", runtimeId),
      OtlpJson.stringAttribute("telemetry.sdk.name", "datadog"),
      OtlpJson.stringAttribute(
        "telemetry.sdk.language",
        DatadogTraces.languageOf(language),
      ),
      OtlpJson.stringAttribute("telemetry.sdk.version", payload.tracerVersion),
      OtlpJson.stringAttribute(
        "process.runtime.version",
        payload.languageVersion,
      ),
    );

    attributes.push(...DatadogTraces.payloadTagAttributes(payload.tags));

    bucket = {
      attributes: DatadogTraces.uniqueByKey(attributes),
      tracerVersion: payload.tracerVersion,
      spans: [],
    };
    state.buckets.set(key, bucket);

    return bucket;
  }

  // The first of each of env, version, language and runtime-id a chunk's spans are tagged with.
  private static chunkProcess(chunk: ChunkView): ChunkProcess {
    const process: ChunkProcess = {
      env: "",
      version: "",
      language: "",
      runtimeId: "",
    };

    for (const span of chunk.spans) {
      process.env = process.env || DatadogTraces.tagText(span.tags, "env");
      process.version =
        process.version || DatadogTraces.tagText(span.tags, "version");
      process.language =
        process.language || DatadogTraces.tagText(span.tags, "language");
      process.runtimeId =
        process.runtimeId || DatadogTraces.tagText(span.tags, "runtime-id");
    }

    return process;
  }

  /*
   * A tracer payload's tags as resource attributes: the container tags the
   * Agent resolved (_dd.tags.container, "kube_namespace:shop,pod_name:...")
   * under OpenTelemetry's names, and any tag that is not Datadog's own.
   */
  private static payloadTagAttributes(
    tags: Map<string, TagValue>,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];
    const containerTags: string = DatadogTraces.tagText(
      tags,
      "_dd.tags.container",
    );

    for (const tag of containerTags.split(",")) {
      const separator: number = tag.indexOf(":");

      if (separator <= 0) {
        continue;
      }

      const name: string | undefined = CONTAINER_TAG_NAMES.get(
        tag.slice(0, separator).trim(),
      );

      if (name) {
        OtlpJson.pushAll(
          attributes,
          OtlpJson.stringAttribute(name, tag.slice(separator + 1).trim()),
        );
      }
    }

    for (const [key, value] of tags) {
      if (!DatadogTraces.isBookkeeping(key)) {
        OtlpJson.pushAll(attributes, DatadogTraces.attribute(key, value));
      }
    }

    return attributes;
  }

  private static languageOf(language: string): string {
    const normalized: string = language.trim().toLowerCase();

    return LANGUAGES.get(normalized) ?? normalized;
  }

  // 32 hex digits, or "" for a trace ID of zero.
  private static hexTraceId(high: bigint, low: bigint): string {
    if (high === ZERO && low === ZERO) {
      return "";
    }

    return (
      high.toString(16).padStart(16, "0") + low.toString(16).padStart(16, "0")
    );
  }

  // 16 hex digits, or "" for a span ID of zero.
  private static hexSpanId(id: bigint): string {
    return id === ZERO ? "" : id.toString(16).padStart(16, "0");
  }

  // A v1 trace ID (16 bytes, or fewer: the missing high-order bytes are zero) as its halves.
  private static traceIdHalves(bytes: Buffer | null): {
    high: bigint;
    low: bigint;
  } {
    if (!bytes || bytes.length === 0 || bytes.length > 16) {
      return { high: ZERO, low: ZERO };
    }

    const padded: Buffer = Buffer.alloc(16);
    bytes.copy(padded, 16 - bytes.length);

    return {
      high: padded.readBigUInt64BE(0),
      low: padded.readBigUInt64BE(8),
    };
  }

  /*
   * An unsigned 64-bit integer from whatever it was decoded as: a decimal
   * string (protobuf), a number or a bigint (MessagePack, JSON) - negative
   * when a tracer wrote it as an int64 - or 0.
   */
  private static uint64(value: unknown): bigint {
    if (typeof value === "string") {
      const text: string = value.trim();

      if (!DIGITS.test(text)) {
        return ZERO;
      }

      const id: bigint = BigInt(text);

      if (id < ZERO) {
        return id + UINT64_RANGE >= ZERO ? id + UINT64_RANGE : ZERO;
      }

      return id <= UINT64_MAX ? id : ZERO;
    }

    return Msgpack.toUint64(value as MsgpackValue) ?? ZERO;
  }

  // A signed 64-bit integer (a time, a duration), or 0.
  private static int64(value: unknown): bigint {
    if (typeof value === "string") {
      const text: string = value.trim();

      if (!DIGITS.test(text)) {
        return ZERO;
      }

      const number: bigint = BigInt(text);

      return number <= INT64_MAX ? number : ZERO;
    }

    return Msgpack.toInt64(value as MsgpackValue) ?? ZERO;
  }

  private static number(value: unknown): number | null {
    if (typeof value === "string" && value.trim() && !isNaN(Number(value))) {
      const number: number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    return Msgpack.toNumber(value as MsgpackValue);
  }

  private static isError(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value.trim() !== "" && value.trim() !== "0";
    }

    const number: bigint | null = Msgpack.toInt64(value as MsgpackValue);

    return number !== null && number !== ZERO;
  }

  private static text(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    return Buffer.isBuffer(value) ? value.toString("utf8") : "";
  }

  // A string tag's value: text, or a number or boolean a JSON body wrote bare.
  private static tagString(value: unknown): string | null {
    if (typeof value === "string") {
      return value;
    }

    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }

    if (
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }

    return null;
  }

  private static trimmed(value: string | undefined): string {
    return (value || "").trim();
  }

  private static tagText(tags: Map<string, TagValue>, key: string): string {
    const value: TagValue | undefined = tags.get(key);

    return typeof value === "string" ? value.trim() : "";
  }

  // A string tag as it was sent; "" when it is blank.
  private static tagRaw(tags: Map<string, TagValue>, key: string): string {
    const value: TagValue | undefined = tags.get(key);

    return typeof value === "string" && value.trim() ? value : "";
  }

  // A protobuf map<string, string>, decoded: its own entries only.
  private static stringTags(value: unknown): Map<string, TagValue> {
    const tags: Map<string, TagValue> = new Map<string, TagValue>();

    for (const [key, entry] of DatadogTraces.ownEntries(value)) {
      if (key && typeof entry === "string") {
        tags.set(key, entry);
      }
    }

    return tags;
  }

  private static bytes(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) {
      return value;
    }

    if (value instanceof Uint8Array) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }

    return null;
  }

  // A field of a span or a link, whether it was decoded as a Map (MessagePack) or an object (JSON, protobuf).
  private static field(record: unknown, key: string): unknown {
    if (record instanceof Map) {
      return record.get(key);
    }

    if (DatadogTraces.isRecord(record)) {
      return Object.prototype.hasOwnProperty.call(record, key)
        ? record[key]
        : undefined;
    }

    return undefined;
  }

  // A map's entries, whether it was decoded as a Map or an object; its own only.
  private static entries(value: unknown): Array<[unknown, unknown]> {
    if (value instanceof Map) {
      return Array.from(value.entries());
    }

    return DatadogTraces.ownEntries(value);
  }

  private static ownEntries(value: unknown): Array<[string, unknown]> {
    if (!DatadogTraces.isRecord(value)) {
      return [];
    }

    return Object.keys(value).map((key: string): [string, unknown] => {
      return [key, value[key]];
    });
  }

  private static objects(value: unknown): Array<JSONObject> {
    return DatadogTraces.list(value).filter(DatadogTraces.isRecord);
  }

  private static list(value: unknown): Array<unknown> {
    return Array.isArray(value) ? value : [];
  }

  private static isRecord(value: unknown): value is JSONObject {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Map) &&
      !Buffer.isBuffer(value)
    );
  }

  private static isPresent(value: JSONObject | null): value is JSONObject {
    return value !== null;
  }

  // Attributes with one value a key: the first written wins.
  private static uniqueByKey(
    attributes: Array<OtlpKeyValue>,
  ): Array<OtlpKeyValue> {
    const seen: Set<string> = new Set<string>();

    return attributes.filter((attribute: OtlpKeyValue): boolean => {
      if (seen.has(attribute.key)) {
        return false;
      }

      seen.add(attribute.key);
      return true;
    });
  }
}
