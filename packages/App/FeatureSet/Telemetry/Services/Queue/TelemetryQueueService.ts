import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import OtelPayloadDecoder, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../Utils/OtelPayloadDecoder";
import { headerValueToString } from "Common/Server/Utils/Express";
import TelemetryBodyStore from "../../Utils/TelemetryBodyStore";
import SessionReplayChunkStore from "../../Utils/SessionReplayChunkStore";
import IncomingRequestLatestPayloadStore from "../../Utils/IncomingRequestLatestPayloadStore";
import NetworkDevicePollLatestStore from "../../Utils/NetworkDevicePollLatestStore";
import SnmpTrapPendingStore from "../../Utils/SnmpTrapPendingStore";
import { INCOMING_REQUEST_INGEST_COALESCE_ENABLED } from "../../Config";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmission,
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
  TelemetryIngestionBudgetJobCharge,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import {
  measureParsedTelemetryIngestBody,
  measureRawTelemetryIngestBody,
  TelemetryIngestBodySize,
} from "Common/Server/Utils/Telemetry/TelemetryIngestBodySize";
import { TelemetryIngestionBudgetSignal } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import {
  ProductAnalyticsParsedEvent,
  ProductAnalyticsParsedMetric,
  ProductAnalyticsWireContext,
} from "Common/Types/Rum/ProductAnalyticsEvents";

export enum TelemetryType {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  Profiles = "profiles",
  Syslog = "syslog",
  FluentLogs = "fluentlogs",
  SecurityEvents = "security-events",
  ProbeIngest = "probe-ingest",
  ServerMonitorIngest = "server-monitor-ingest",
  IncomingRequestIngest = "incoming-request-ingest",
  TelemetryMonitorEvaluation = "telemetry-monitor-evaluation",
  KubernetesCostIngest = "kubernetes-cost-ingest",
  SessionReplay = "session-replay",
  ProductAnalyticsEvents = "product-analytics-events",
}

export type ProbeIngestJobType =
  | "probe-response"
  | "monitor-test"
  | "incoming-email"
  | "snmp-trap"
  | "network-device-walk"
  // A device's newest poll, from NetworkDevicePollLatestStore.
  | "network-device-poll"
  // A sender's waiting traps, from SnmpTrapPendingStore.
  | "snmp-trap-batch";

/*
 * Every kind of probe ingest this release processes. A kind a newer release
 * queues is then one this release cannot process, and is handed back to the
 * queue for a worker of that release (ProcessTelemetry), instead of being
 * read as a probe's monitor response. A Record, so a kind added to the type
 * above and not here does not compile.
 */
const PROBE_INGEST_JOB_TYPES: Record<ProbeIngestJobType, true> = {
  "probe-response": true,
  "monitor-test": true,
  "incoming-email": true,
  "snmp-trap": true,
  "network-device-walk": true,
  "network-device-poll": true,
  "snmp-trap-batch": true,
};

export function isKnownProbeIngestJobType(
  jobType: unknown,
): jobType is ProbeIngestJobType {
  return (
    typeof jobType === "string" &&
    Object.prototype.hasOwnProperty.call(PROBE_INGEST_JOB_TYPES, jobType)
  );
}

export function isKnownTelemetryType(type: unknown): type is TelemetryType {
  return Object.values(TelemetryType).includes(type as TelemetryType);
}

export interface IncomingEmailJobData {
  /*
   * Which monitor or workflow the mail is for, read from the recipient
   * address. Exactly one of the three is set: `secretKey` for a monitor's
   * generated `monitor-{secretKey}@` address, `customLocalPart` for a
   * monitor's custom one, `workflowSecretKey` for a workflow's Incoming Email
   * trigger, `workflow-{secretKey}@` (see IncomingEmailMonitorAddress). Jobs
   * queued before custom addresses existed carry `secretKey` only.
   */
  secretKey?: string | undefined;
  customLocalPart?: string | undefined;
  workflowSecretKey?: string | undefined;
  emailFrom: string;
  emailTo: string;
  /*
   * Every address in the To and Cc headers. A workflow is handed both lists;
   * a monitor evaluates `emailTo`, as it always has. Absent on jobs queued
   * before workflows received email.
   */
  emailToAddresses?: Array<string> | undefined;
  emailCcAddresses?: Array<string> | undefined;
  emailSubject: string;
  emailBody: string;
  emailBodyHtml: string | undefined;
  emailHeaders: Dictionary<string> | undefined;
  attachments:
    | Array<{
        filename: string;
        contentType: string;
        size: number;
      }>
    | undefined;
}

export interface ProbeIngestJobData {
  jobType: ProbeIngestJobType;
  ingestionTimestamp: Date;
  /*
   * For probe-response and monitor-test: { probeId, probeMonitorResponse },
   * where probeId is the probe that sent the result as it authenticated
   * (the route writes it from req.probe, never from the body) and
   * probeMonitorResponse the result as the probe put it on the wire. A job
   * queued before the route wrote it this way carries the whole request
   * body instead, whose top-level probeId is the one the probe
   * authenticated with - so it is read the same way.
   */
  probeMonitorResponse?: JSONObject | undefined;
  testId?: string | undefined;
  // For incoming-email
  incomingEmail?: IncomingEmailJobData | undefined;
  /*
   * For snmp-trap: { probeId, snmpTrap }, probeId being the probe that
   * received the trap as it authenticated. Jobs queued earlier carry the
   * whole request body, whose top-level probeId is that same probe.
   */
  snmpTrap?: JSONObject | undefined;
  /*
   * For network-device-walk: the raw request body
   * ({ probeId, networkDeviceId, isOnline?, pollMode?, pingResponse?,
   *    snmpResponse?, monitoredAt }).
   *
   * Two probe generations write this. A ping-first probe sends `isOnline`
   * (device reachability: ping OR walk), `pollMode` ("ping" | "snmp"),
   * `pingResponse`, and `snmpResponse` only when a walk actually ran. An
   * older probe sends only `snmpResponse`. The processor derives what is
   * missing (pollMode "snmp", isOnline from the walk), so at least one of
   * `isOnline` / `snmpResponse` is always present here.
   */
  networkDeviceWalk?: JSONObject | undefined;
  /*
   * For network-device-poll: whose newest poll to process. The poll itself
   * is in NetworkDevicePollLatestStore; `pollId` is the one that queued the
   * job, which a newer poll of the device may have replaced.
   */
  networkDevicePoll?:
    | {
        probeId: string;
        networkDeviceId: string;
        pollId: string;
      }
    | undefined;
  /*
   * For snmp-trap-batch: whose waiting traps to process. The traps are in
   * SnmpTrapPendingStore.
   */
  snmpTrapBatch?:
    | {
        probeId: string;
        sourceIpAddress: string;
      }
    | undefined;
}

export interface ServerMonitorIngestJobData {
  secretKey: string;
  serverMonitorResponse: JSONObject;
  ingestionTimestamp: Date;
}

export interface IncomingRequestIngestJobData {
  secretKey: string;
  requestHeaders: Dictionary<string>;
  requestBody: string | JSONObject;
  requestMethod: string;
  ingestionTimestamp: Date;
  receivedViaProbeId?: string | undefined;
  /*
   * Set only when the request was queued with same-monitor coalescing: its id
   * in IncomingRequestLatestPayloadStore. It tells the worker to evaluate the
   * monitor's newest stored request, which may be newer than this copy. The
   * copy stays on the job for workers that predate the store (a rolling
   * deploy) and for jobs queued with coalescing off.
   */
  coalescedPayloadId?: string | undefined;
}

export interface TelemetryMonitorEvaluationJobData {
  monitorId: string;
  projectId?: string | undefined;
  queuedAt: Date;
}

export interface KubernetesCostIngestJobData {
  projectId: string;
  /** KubernetesCostIngestPayload as posted by the agent's cost poller. */
  costPayload: JSONObject;
  ingestionTimestamp: Date;
}

export interface SessionReplayIngestJobData {
  projectId: string;

  /*
   * The x-oneuptime-app-identifier header value the request was gated
   * against. Carried explicitly rather than re-read from the envelope so
   * the worker resolves the SAME application the gate authorized.
   */
  appIdentifier: string;

  /*
   * Base64 of the raw request body, present only for bodies at or under
   * SESSION_REPLAY_INLINE_STAGING_MAX_BYTES. Larger bodies travel via the
   * top-level `bodyKey` instead. A typical chunk is a few KB, so this keeps
   * almost every chunk out of Redis staging entirely.
   */
  inlineBodyBase64?: string;

  /* Wall-clock time the app tier accepted the chunk. Server-authoritative. */
  serverReceiveUnixMs: number;

  /* Sample percentage in force at the gate, stored to un-bias analytics. */
  samplePercentageAtCapture: number;

  /* Best-effort viewer geography source. Never stored; only the country is. */
  countryCode: string;
}

/*
 * One product analytics batch (issue #6444, part two), already parsed and
 * judged by the route: its events and metric points on the server's clock,
 * the application it was gated against, and the signed-in user's key - the
 * one-way HMAC, never the reference, which does not leave the request.
 */
export interface ProductAnalyticsEventsJobData {
  projectId: string;
  rumApplicationId: string;
  batchId: string;
  receivedAtUnixMs: number;
  countryCode: string;
  sessionId: string;
  visitorId: string;
  identifiedUserKey: string;
  userProperties: Record<string, string>;
  context: ProductAnalyticsWireContext;
  events: Array<ProductAnalyticsParsedEvent>;
  metrics: Array<ProductAnalyticsParsedMetric>;
}

export interface TelemetryIngestJobData {
  type: TelemetryType;
  projectId?: string;
  /*
   * Parsed JSON body. Used ONLY by the non-OTel ingest paths
   * (Fluent, Syslog) whose worker cases read `requestBody`
   * directly. OTel-type jobs (logs / traces / metrics / profiles)
   * must never use this field — their worker cases resolve the
   * payload exclusively through `bodyKey` below and throw if it
   * is missing.
   */
  requestBody?: JSONObject;
  /*
   * Redis key for the raw request body, written out-of-band by
   * TelemetryBodyStore before the job is enqueued. The worker
   * fetches the raw buffer via TelemetryBodyStore.readBody (and
   * deletes it via deleteBody only after the job succeeds) and
   * decodes (gzip / deflate / zstd inflate + protobuf or JSON) per
   * `bodyFormat` / `bodyEncoding`. Every OTel-type job carries
   * `bodyKey` + `bodyFormat` + `productType` — raw HTTP bodies are
   * stored as-is, while producers that hand us an already-parsed
   * object (gRPC, Pyroscope conversion) are serialized to JSON
   * before storage so the worker has a single resolution path.
   */
  bodyKey?: string;
  bodyFormat?: OtelPayloadFormat;
  bodyEncoding?: OtelPayloadEncoding;
  productType?: ProductType;
  requestHeaders?: Record<string, string>;
  /*
   * The `pinnedServiceName` of the TelemetryIngestionKey that admitted this
   * request, when it has one. Carried ON THE JOB because the OTLP payload is
   * decoded in the WORKER, not here: the HTTP layer only ever sees the raw
   * (usually gzipped protobuf) bytes it stores via TelemetryBodyStore, so the
   * earliest point at which a `service.name` can be rewritten is after the
   * decode in ProcessTelemetry. See applyPinnedServiceName there.
   *
   * Absent on the overwhelming majority of jobs, and deliberately so: only a
   * key that actually has a pin configured (in practice a Browser key) sets
   * it, and an omitted field costs less in the per-job Redis payload than a
   * null on every single export.
   *
   * Safe to store here, unlike the ingestion token that is deliberately
   * projected OUT of `requestHeaders` below: this is not a credential.
   * It is a label the customer typed into the key's settings, and it is
   * stamped onto every resource that key writes — so it is already visible on
   * the ingested telemetry itself. Nothing can be authenticated with it, and
   * seeing it in a failed-job listing grants no access.
   */
  pinnedServiceName?: string;
  /*
   * Set only when the body was counted against an ingestion budget at an
   * estimate - a compressed OTLP/HTTP body, sized from its own header
   * (TelemetryIngestBodySize) - so the worker, once it has inflated the
   * body, adds the difference to the day it was counted on
   * (TelemetryIngestionBudget.reconcile). Absent on every other job.
   */
  ingestionBudgetCharge?: TelemetryIngestionBudgetJobCharge;
  ingestionTimestamp: Date;
  // ProbeIngest-specific
  probeIngest?: ProbeIngestJobData;
  // ServerMonitorIngest-specific
  serverMonitorIngest?: ServerMonitorIngestJobData;
  // IncomingRequestIngest-specific
  incomingRequestIngest?: IncomingRequestIngestJobData;
  // TelemetryMonitorEvaluation-specific
  telemetryMonitorEvaluation?: TelemetryMonitorEvaluationJobData;
  // KubernetesCostIngest-specific
  kubernetesCostIngest?: KubernetesCostIngestJobData;
  /*
   * SessionReplay-specific. Note the raw body reference is NOT in here: it
   * uses the top-level `bodyKey` above, because the post-success reclaim at
   * the bottom of ProcessTelemetry tests `jobData.bodyKey`. Nesting it would
   * leave every staged blob to expire on its own 6-hour TTL.
   */
  sessionReplayIngest?: SessionReplayIngestJobData;
  // ProductAnalyticsEvents-specific
  productAnalyticsEvents?: ProductAnalyticsEventsJobData;
}

// Legacy interfaces for backward compatibility
export interface LogsIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Logs;
}

export interface TracesIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Traces;
}

export interface MetricsIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Metrics;
}

export interface ProfilesIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Profiles;
}

export interface SyslogIngestJobData extends TelemetryIngestJobData {
  type: TelemetryType.Syslog;
}

/*
 * The OTel signal types whose worker cases resolve their payload via
 * `bodyKey` (see resolveOtelBody in ProcessTelemetry). Jobs of these
 * types MUST carry `bodyKey` + `bodyFormat` + `productType` or the
 * worker throws. Syslog / FluentLogs are exempt — their worker cases
 * read `requestBody` directly.
 */
const OTEL_TELEMETRY_TYPES: ReadonlyArray<TelemetryType> = [
  TelemetryType.Logs,
  TelemetryType.Traces,
  TelemetryType.Metrics,
  TelemetryType.Profiles,
];

/*
 * Fallback ProductType per OTel signal. The HTTP and gRPC entry points
 * stamp `req.productType` via middleware, but internal producers that
 * assemble a partial TelemetryRequest by hand (e.g. the Pyroscope
 * conversion path) may omit it — the worker needs it to pick the right
 * decoder, so derive it from the queue type when absent.
 */
const PRODUCT_TYPE_BY_TELEMETRY_TYPE: Partial<
  Record<TelemetryType, ProductType>
> = {
  [TelemetryType.Logs]: ProductType.Logs,
  [TelemetryType.Traces]: ProductType.Traces,
  [TelemetryType.Metrics]: ProductType.Metrics,
  [TelemetryType.Profiles]: ProductType.Profiles,
};

/*
 * The ingestion budget signal each queued telemetry type counts against.
 * Syslog and Fluent batches are logs; every type not listed (probe results,
 * monitor evaluations, Kubernetes cost, session replay, which has budgets of
 * its own) is not budgeted.
 */
const BUDGET_SIGNAL_BY_TELEMETRY_TYPE: Partial<
  Record<TelemetryType, TelemetryIngestionBudgetSignal>
> = {
  [TelemetryType.Logs]: ProductType.Logs,
  [TelemetryType.Syslog]: ProductType.Logs,
  [TelemetryType.FluentLogs]: ProductType.Logs,
  [TelemetryType.Traces]: ProductType.Traces,
  [TelemetryType.Metrics]: ProductType.Metrics,
  [TelemetryType.Profiles]: ProductType.Profiles,
  [TelemetryType.SecurityEvents]: ProductType.SecurityEvents,
};

export const getTelemetryIngestionBudgetSignalForTelemetryType: (
  type: TelemetryType,
) => TelemetryIngestionBudgetSignal | null = (
  type: TelemetryType,
): TelemetryIngestionBudgetSignal | null => {
  return BUDGET_SIGNAL_BY_TELEMETRY_TYPE[type] ?? null;
};

export interface TelemetryIngestionBudgetEnqueueDecision {
  // false: the budget is used up and the batch is dropped, not queued.
  isAdmitted: boolean;
  // What the job carries for the worker to settle, when anything.
  jobCharge?: TelemetryIngestionBudgetJobCharge | undefined;
}

/*
 * Count a batch against its project's ingestion budget as it is queued -
 * once, whoever produced it:
 *
 *   - a request the ingest middleware or the gRPC server already admitted
 *     carries its charge (null when nothing was counted), and is not
 *     counted again;
 *   - one they checked without sizing (Pyroscope) is counted now, at the
 *     size it is stored with;
 *   - one that passed no gate - MQTT, the cloud streams, OneUptime's own
 *     collectors - is decided here. Its sender cannot be answered, so over a
 *     used-up budget it is dropped (and counted as dropped), and no
 *     per-second rate applies: a burst over one would only be lost.
 *
 * Exported for tests.
 */
export async function admitToTelemetryIngestionBudget(data: {
  req: Partial<TelemetryRequest>;
  signal: TelemetryIngestionBudgetSignal;
  measure: () => TelemetryIngestBodySize;
}): Promise<TelemetryIngestionBudgetEnqueueDecision> {
  const charge: TelemetryIngestionBudgetCharge | null | undefined =
    data.req.telemetryIngestionBudgetCharge;

  // A gate already decided it and counted nothing: no budget was in force.
  if (charge === null) {
    return { isAdmitted: true };
  }

  const toDecision: (
    counted: TelemetryIngestionBudgetCharge | null | undefined,
  ) => TelemetryIngestionBudgetEnqueueDecision = (
    counted: TelemetryIngestionBudgetCharge | null | undefined,
  ): TelemetryIngestionBudgetEnqueueDecision => {
    return {
      isAdmitted: true,
      jobCharge:
        counted && !counted.isExact && !counted.isPending
          ? TelemetryIngestionBudget.toJobCharge(counted)
          : undefined,
    };
  };

  if (charge && !charge.isPending) {
    return toDecision(charge);
  }

  if (charge && charge.isPending) {
    return toDecision(
      await TelemetryIngestionBudget.chargePending({
        charge: charge,
        size: data.measure(),
      }),
    );
  }

  if (!data.req.projectId) {
    return { isAdmitted: true };
  }

  const admission: TelemetryIngestionBudgetAdmission =
    await TelemetryIngestionBudget.admit({
      projectId: data.req.projectId,
      signal: data.signal,
      ingestionKeyPolicy: data.req.ingestionKeyPolicy ?? null,
      mode: TelemetryIngestionBudgetAdmissionMode.Drop,
      measure: data.measure,
    });

  if (admission.refusal) {
    return { isAdmitted: false };
  }

  return toDecision(admission.charge);
}

/*
 * The complete set of request headers that worker-side telemetry code
 * reads back off a queued job's `requestHeaders`. Everything stored on a
 * job is JSON-serialized into Redis PER JOB (and surfaces verbatim in
 * failed-job listings), so the enqueue path must project the incoming
 * headers down to exactly this set instead of copying the whole header
 * object — which would ship the raw ingestion token (x-oneuptime-token)
 * plus cookies / user-agent noise into Redis on every export.
 *
 * How this set was derived (re-verify when adding a consumer):
 *   - OtelIngestBaseService reads `x-oneuptime-service-name` as the
 *     service-name fallback (getServiceNameFromAttributes and
 *     getServiceNameFromHeaders) — the ONLY header any worker case
 *     reads from `jobData.requestHeaders` today.
 *   - SyslogIngestService / FluentLogsIngestService / the Common
 *     OpenTelemetryIngestService read no headers at all from the
 *     reconstructed request.
 *   - `content-type` / `content-encoding` are consumed at ENQUEUE time
 *     into `bodyFormat` / `bodyEncoding` (see addTelemetryIngestJob) and
 *     the worker decodes via those fields, never via headers — so they
 *     deliberately do not appear here.
 */
export const WORKER_CONSUMED_REQUEST_HEADERS: ReadonlyArray<string> = [
  "x-oneuptime-service-name",
];

/*
 * Project an incoming header map (Express `req.headers`, or the gRPC
 * metadata map flattened to strings) down to the worker-consumed
 * whitelist above. Keys are matched and emitted lowercased — Express and
 * grpc-js both lowercase header/metadata names already, but internal
 * producers (Pyroscope conversion, tests) build these objects by hand.
 * Values pass through UNCHANGED: `req.headers` can legally hold string
 * arrays and the worker's reader (getServiceNameFromHeaders) accepts
 * both shapes, exactly as it did when the whole header object was
 * carried verbatim.
 */
export function pickWorkerConsumedRequestHeaders(
  headers: Record<string, string | Array<string> | undefined>,
): Record<string, string> {
  const projectedHeaders: Record<string, string> = {};

  for (const headerName in headers) {
    const lowercasedHeaderName: string = headerName.toLowerCase();

    if (!WORKER_CONSUMED_REQUEST_HEADERS.includes(lowercasedHeaderName)) {
      continue;
    }

    const headerValue: string | Array<string> | undefined = headers[headerName];

    if (headerValue === undefined) {
      continue;
    }

    /*
     * The cast mirrors the previous `req.headers as Record<string,
     * string>` at the enqueue site: array values survive as arrays at
     * runtime and the worker-side reader handles them.
     */
    projectedHeaders[lowercasedHeaderName] = headerValue as string;
  }

  return projectedHeaders;
}

/*
 * JSON.stringify replacer that rewrites binary values to base64
 * strings. The gRPC entry point hands us proto-loader output where
 * `bytes` fields (traceId / spanId / profileId / ...) are Buffers;
 * a plain stringify would serialize those as `{"type":"Buffer",
 * "data":[...]}` which the downstream ingest services cannot read.
 * protobufjs' `.toJSON()` (the deferred-decode path) emits base64
 * for bytes fields, so converting here keeps both producer paths
 * byte-for-byte compatible for the worker.
 *
 * Exported for tests. Must be a `function` (not an arrow function):
 * JSON.stringify invokes the replacer with `this` bound to the object
 * or array holding the property, which is what lets us reach the
 * pre-toJSON value below.
 */
export function binaryToBase64Replacer(
  this: unknown,
  key: string,
  value: unknown,
): unknown {
  /*
   * JSON.stringify calls Buffer.prototype.toJSON BEFORE the replacer,
   * so by the time `value` arrives a Buffer has already been reshaped
   * into { type: "Buffer", data: [one JS number per byte] }. The
   * ORIGINAL value is still reachable as this[key], so detect binary
   * there and emit base64 straight from the original bytes. That skips
   * ever touching the per-byte number array — previously every
   * traceId / spanId was reshaped into that array and then
   * re-materialized into a second Buffer just to emit the same base64.
   */
  const originalValue: unknown = (this as Record<string, unknown>)?.[key];

  if (Buffer.isBuffer(originalValue)) {
    return originalValue.toString("base64");
  }

  /*
   * Plain Uint8Arrays have no toJSON (so `value` here IS the original)
   * and would serialize as index maps. Wrap as a zero-copy Buffer VIEW
   * over the same memory to emit base64 — Buffer.from(u8) would copy.
   */
  if (originalValue instanceof Uint8Array) {
    return Buffer.from(
      originalValue.buffer,
      originalValue.byteOffset,
      originalValue.byteLength,
    ).toString("base64");
  }

  /*
   * Legacy fallback, kept for exact behavior parity: a producer-supplied
   * PLAIN object already shaped like Buffer JSON ({ type: "Buffer",
   * data: [...] }) was converted to base64 by the previous
   * implementation even though it never was a real Buffer. Real Buffers
   * never reach this check — they returned above — so this costs the
   * hot path nothing.
   */
  if (
    value &&
    typeof value === "object" &&
    (value as JSONObject)["type"] === "Buffer" &&
    Array.isArray((value as JSONObject)["data"])
  ) {
    return Buffer.from((value as { data: Array<number> }).data).toString(
      "base64",
    );
  }

  /*
   * Second half of the parity fallback: a value can also REACH here as a
   * Uint8Array/Buffer without the holder having held one — when a custom
   * toJSON on the original returned binary (JSON.stringify calls toJSON
   * once and does not re-invoke it on the result). The legacy replacer
   * base64'd that too. Ordinary Buffers / Uint8Arrays never get here —
   * they matched `originalValue` above.
   */
  if (value instanceof Uint8Array) {
    return Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).toString("base64");
  }

  return value;
}

export default class TelemetryQueueService {
  public static async addTelemetryIngestJob(
    req: TelemetryRequest,
    type: TelemetryType,
  ): Promise<void> {
    try {
      const jobData: TelemetryIngestJobData = {
        type,
        projectId: req.projectId.toString(),
        /*
         * Whitelist projection, NOT the raw header object: the job data
         * is JSON-serialized into Redis per job, and the raw headers
         * carry the ingestion token (x-oneuptime-token) — which would
         * otherwise sit in Redis and surface in failed-job listings —
         * plus cookies / user-agent noise the worker never reads. The
         * content-type / content-encoding reads further down use
         * `req.headers` directly, so they are unaffected by this.
         */
        requestHeaders: pickWorkerConsumedRequestHeaders(
          req.headers as Record<string, string | Array<string> | undefined>,
        ),
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const isRawBuffer: boolean =
        Buffer.isBuffer(req.body) || req.body instanceof Uint8Array;
      const isOtelType: boolean = OTEL_TELEMETRY_TYPES.includes(type);

      /*
       * Read through Partial<> rather than straight off `req`, because the
       * policy can genuinely be absent at runtime even though the type says
       * it is always there: the gRPC (GrpcServer.buildTelemetryRequest) and
       * MQTT (MqttServer) producers assemble a TelemetryRequest by hand after
       * authenticating the token themselves, so they never run the ingest
       * middleware that resolves and attaches a policy. The HTTP producers
       * (the four OTel routes, Syslog, Fluent, security events, and the
       * Pyroscope conversion path, which all forward the real Express
       * request) do carry one.
       */
      const ingestionKeyPolicy: TelemetryIngestionKeyPolicy | undefined = (
        req as Partial<TelemetryRequest>
      ).ingestionKeyPolicy;

      /*
       * Trimmed here as well as in PinServiceName: the worker trims before
       * stamping regardless, so normalizing at enqueue keeps the value in the
       * job payload byte-identical to the one that ends up on the telemetry,
       * and makes the "is there anything to pin" test below the same question
       * the worker will ask.
       */
      const pinnedServiceName: string = (
        ingestionKeyPolicy?.pinnedServiceName ?? ""
      ).trim();

      /*
       * Only the OTel signals carry the field. They are the only payloads
       * with a `service.name` to rewrite — PinServiceName walks resourceSpans
       * / resourceLogs / resourceMetrics — while Syslog and Fluent bodies are
       * not OTLP resource-shaped, and a Browser key cannot reach those
       * surfaces in the first place (BROWSER_ALLOWED_INGEST_SURFACES). Adding
       * it to those jobs would be dead weight in Redis AND would imply an
       * enforcement that does not happen in their worker cases.
       */
      if (isOtelType && pinnedServiceName) {
        jobData.pinnedServiceName = pinnedServiceName;
      }

      const budgetSignal: TelemetryIngestionBudgetSignal | null =
        getTelemetryIngestionBudgetSignalForTelemetryType(type);

      /*
       * Count the batch against its ingestion budget before anything is
       * stored for it, so a batch dropped over a used-up budget costs no
       * Redis body and no job. Measured lazily: a project without a budget
       * is never measured at all.
       */
      const admitToBudget: (
        measure: () => TelemetryIngestBodySize,
      ) => Promise<boolean> = async (
        measure: () => TelemetryIngestBodySize,
      ): Promise<boolean> => {
        if (!budgetSignal) {
          return true;
        }

        const decision: TelemetryIngestionBudgetEnqueueDecision =
          await admitToTelemetryIngestionBudget({
            req: req as Partial<TelemetryRequest>,
            signal: budgetSignal,
            measure: measure,
          });

        if (decision.jobCharge) {
          jobData.ingestionBudgetCharge = decision.jobCharge;
        }

        if (!decision.isAdmitted) {
          logger.debug(
            `Dropped a ${type} batch for project ${req.projectId?.toString()}: its ingestion budget is used up.`,
          );
        }

        return decision.isAdmitted;
      };

      if (isRawBuffer) {
        /*
         * Deferred-decode path: the OTel middleware leaves `req.body`
         * as a raw Buffer, so we ship the bytes + format metadata and
         * the worker runs the protobuf decode and JSON normalization
         * off the HTTP request thread.
         */
        const buffer: Buffer = Buffer.isBuffer(req.body)
          ? (req.body as Buffer)
          : Buffer.from(req.body as Uint8Array);
        /*
         * Every coding in the header is read, not just the first array
         * element - "gzip, zstd" must not pass as gzip.
         */
        const bodyEncoding: OtelPayloadEncoding | null =
          OtelPayloadDecoder.encodingFromContentEncoding(
            req.headers["content-encoding"],
          );

        /*
         * Backstop for OtelRequestMiddleware.parseBody, which answers 415
         * for these on every OTLP/HTTP route before the handler runs, so a
         * throw here means a new raw-body OTel producer skipped that check
         * (the ingest handlers turn it into a 503, so it fails loudly).
         * Refuse before storing anything: the worker cannot decode the
         * body, and falling back to "none" is the silent drop GH#3978 was.
         * Syslog / Fluent / security-event jobs never decode a stored body
         * (their worker cases read `requestBody`), so they keep being
         * accepted as before.
         */
        if (bodyEncoding === null && isOtelType) {
          throw new Error(
            `TelemetryQueueService: refusing ${type} body with unsupported Content-Encoding; OTLP/HTTP admission must answer 415 for it`,
          );
        }

        const contentType: string | undefined = headerValueToString(
          req.headers["content-type"],
        );
        const isProtobuf: boolean =
          !contentType ||
          contentType.includes("application/x-protobuf") ||
          contentType.includes("application/protobuf");

        const isBudgetAdmitted: boolean = await admitToBudget(
          (): TelemetryIngestBodySize => {
            return measureRawTelemetryIngestBody({
              body: buffer,
              contentEncoding: req.headers["content-encoding"],
            });
          },
        );

        if (!isBudgetAdmitted) {
          return;
        }

        /*
         * Store the raw bytes out-of-band via TelemetryBodyStore
         * (binary Redis SET). The worker reads them back through
         * the same store. We only carry a small key reference in
         * the BullMQ job payload, which:
         *   - removes the synchronous base64 encode that used to
         *     burn ~150 ms on a 50 MB payload on the Express thread,
         *   - removes the ~33 % inflation from base64 in the BullMQ
         *     job state stored in Redis,
         *   - removes the matching base64 decode on the worker side.
         * The body SET completes before the BullMQ enqueue so a
         * worker can never pick up a job whose body hasn't landed.
         */
        jobData.bodyKey = await TelemetryBodyStore.storeBody(buffer);
        jobData.bodyFormat = isProtobuf
          ? OtelPayloadFormat.Protobuf
          : OtelPayloadFormat.Json;
        jobData.bodyEncoding = bodyEncoding ?? "none";
        jobData.productType =
          req.productType ?? PRODUCT_TYPE_BY_TELEMETRY_TYPE[type];
      } else if (isOtelType) {
        /*
         * Parsed-object producers (gRPC OTLP exports, Pyroscope's
         * pprof->OTLP conversion) hand us a decoded JS object. The
         * worker resolves OTel payloads exclusively through
         * `bodyKey` (resolveOtelBody throws without it), so
         * serialize the object back to JSON and store it the same
         * way as a raw body — every OTel-type job then carries
         * `bodyKey` + `bodyFormat` + `productType`, regardless of
         * which producer enqueued it.
         */
        const buffer: Buffer = Buffer.from(
          JSON.stringify(req.body, binaryToBase64Replacer),
        );

        // Counted at the size it is stored with, unless a gate counted it.
        const isBudgetAdmitted: boolean = await admitToBudget(
          (): TelemetryIngestBodySize => {
            return { bytes: buffer.length, isExact: true };
          },
        );

        if (!isBudgetAdmitted) {
          return;
        }

        jobData.bodyKey = await TelemetryBodyStore.storeBody(buffer);
        jobData.bodyFormat = OtelPayloadFormat.Json;
        jobData.bodyEncoding = "none";
        jobData.productType =
          req.productType ?? PRODUCT_TYPE_BY_TELEMETRY_TYPE[type];
      } else {
        const isBudgetAdmitted: boolean = await admitToBudget(
          (): TelemetryIngestBodySize => {
            return measureParsedTelemetryIngestBody({
              body: req.body,
              rawBody: (req as { rawBody?: string | undefined }).rawBody,
            });
          },
        );

        if (!isBudgetAdmitted) {
          return;
        }

        // Syslog / FluentLogs — their worker cases read `requestBody` directly.
        jobData.requestBody = req.body;
      }

      const jobId: string = `${type}-${req.projectId?.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added ${type} ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding ${type} ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addLogIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Logs);
  }

  public static async addTraceIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Traces);
  }

  public static async addMetricIngestJob(req: TelemetryRequest): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Metrics);
  }

  public static async addProfileIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.Profiles);
  }

  public static async addFluentLogIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.FluentLogs);
  }

  public static async addSecurityEventsIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return this.addTelemetryIngestJob(req, TelemetryType.SecurityEvents);
  }

  /*
   * Queues one probe's check result (or monitor test result). `probeId` is
   * the probe that sent it, as it authenticated: the worker records the
   * result as that probe's and nobody else's (ProbeReportIdentity). Only
   * the result itself is queued with it - never the request body, which
   * carries the probe's key.
   */
  public static async addProbeIngestJob(data: {
    probeId: ObjectID;
    probeMonitorResponse: JSONObject;
    jobType: "probe-response" | "monitor-test";
    testId?: string;
    /*
     * When the ingest API received it, before any queueing: the worker
     * times a page its evaluation starts from then (OnCallPageTiming).
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        probeMonitorResponse: {
          probeId: data.probeId.toString(),
          probeMonitorResponse: data.probeMonitorResponse,
        },
        jobType: data.jobType,
        testId: data.testId,
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      const jobId: string = `probe-${data.jobType}-${data.testId || "general"}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added probe ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding probe ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  /*
   * Queues one trap a probe received. `probeId` is that probe, as it
   * authenticated: traps are matched only to the devices it polls.
   *
   * At most one job per sender waits in a backlog: the trap is pushed onto
   * its sender's list (SnmpTrapPendingStore) and the sender's job, keyed by
   * (probe, source address) with BullMQ deduplication, works through the
   * list in order. No trap is skipped - traps are events, and the order of
   * a linkDown and the linkUp after it matters. A trap with no source
   * address to key it by is queued on its own, as before (the worker
   * refuses it).
   */
  public static async addSnmpTrapIngestJob(data: {
    probeId: ObjectID;
    snmpTrap: JSONObject;
    /*
     * When the ingest API received it, before any queueing: the worker
     * times a page its evaluation starts from then (OnCallPageTiming).
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "snmp-trap",
        snmpTrap: {
          probeId: data.probeId.toString(),
          snmpTrap: data.snmpTrap,
        },
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
      };

      const sourceIpAddress: string | undefined =
        TelemetryQueueService.getTrapSender(data.snmpTrap);

      if (sourceIpAddress) {
        await SnmpTrapPendingStore.push({
          probeId: data.probeId.toString(),
          sourceIpAddress: sourceIpAddress,
          payload: probeData,
        });

        await TelemetryQueueService.addSnmpTrapBatchJob({
          probeId: data.probeId.toString(),
          sourceIpAddress: sourceIpAddress,
        });

        return;
      }

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      const jobId: string = `probe-snmp-trap-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added SNMP trap ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding SNMP trap ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  /*
   * Queues the job that processes a sender's waiting traps - unless one is
   * waiting already, which will process them. Added while the sender's job
   * is running, it is queued after it (keepLastIfActive), so a trap pushed
   * while a job drains the list is never left behind.
   */
  public static async addSnmpTrapBatchJob(data: {
    probeId: string;
    sourceIpAddress: string;
  }): Promise<void> {
    const jobData: TelemetryIngestJobData = {
      type: TelemetryType.ProbeIngest,
      ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      probeIngest: {
        jobType: "snmp-trap-batch",
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        snmpTrapBatch: {
          probeId: data.probeId,
          sourceIpAddress: data.sourceIpAddress,
        },
      },
    };

    const jobId: string = `probe-snmp-trap-batch-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

    await Queue.addJob(
      QueueName.Telemetry,
      jobId,
      "ProcessTelemetry",
      jobData as unknown as JSONObject,
      {
        skipExistenceCheck: true,
        deduplication: {
          id: TelemetryQueueService.getSnmpTrapDeduplicationId(data),
          keepLastIfActive: true,
        },
      },
    );

    logger.debug(`Added SNMP trap batch job: ${jobId}`);
  }

  public static getSnmpTrapDeduplicationId(data: {
    probeId: string;
    sourceIpAddress: string;
  }): string {
    return `snmp-trap-${data.probeId}-${data.sourceIpAddress}`;
  }

  // The address a trap came from, as its sender's key; undefined when none.
  public static getTrapSender(snmpTrap: JSONObject): string | undefined {
    const source: unknown = snmpTrap["sourceIpAddress"];

    if (typeof source !== "string") {
      return undefined;
    }

    const trimmed: string = source.trim();

    return trimmed && trimmed.length <= 100 ? trimmed : undefined;
  }

  /*
   * Queues one device poll. At most one per device waits in a backlog: the
   * poll is stored as the device's newest (NetworkDevicePollLatestStore) and
   * the device's job, keyed by (probe, device) with BullMQ deduplication,
   * processes whatever is newest when it runs. What a poll skipped that way
   * loses - and what it does not - is written up in
   * NetworkDevicePollLatestStore. A poll with no ids to key it by is queued
   * on its own, as before (the worker refuses it).
   */
  public static async addNetworkDeviceWalkJob(data: {
    walkRequestBody: JSONObject;
    /*
     * When the ingest API received it, before any queueing: the worker
     * times a page its evaluation starts from then (OnCallPageTiming).
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "network-device-walk",
        networkDeviceWalk: data.walkRequestBody,
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
      };

      const probeId: unknown = data.walkRequestBody["probeId"];
      const networkDeviceId: unknown = data.walkRequestBody["networkDeviceId"];

      const canCoalesce: boolean =
        typeof probeId === "string" &&
        typeof networkDeviceId === "string" &&
        ObjectID.isValidUUID(probeId) &&
        ObjectID.isValidUUID(networkDeviceId);

      let jobData: TelemetryIngestJobData;

      if (canCoalesce) {
        const pollId: string = ObjectID.generate().toString();

        // Stored BEFORE the job is added: the job that runs finds it.
        await NetworkDevicePollLatestStore.store({
          probeId: probeId as string,
          networkDeviceId: networkDeviceId as string,
          pollId: pollId,
          payload: probeData,
        });

        jobData = {
          type: TelemetryType.ProbeIngest,
          ingestionTimestamp: OneUptimeDate.getCurrentDate(),
          probeIngest: {
            jobType: "network-device-poll",
            ingestionTimestamp: probeData.ingestionTimestamp,
            networkDevicePoll: {
              probeId: probeId as string,
              networkDeviceId: networkDeviceId as string,
              pollId: pollId,
            },
          },
        };
      } else {
        jobData = {
          type: TelemetryType.ProbeIngest,
          ingestionTimestamp: OneUptimeDate.getCurrentDate(),
          probeIngest: probeData,
        };
      }

      const jobId: string = `probe-network-device-walk-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          skipExistenceCheck: true,
          ...(canCoalesce
            ? {
                deduplication: {
                  id: TelemetryQueueService.getNetworkDevicePollDeduplicationId(
                    {
                      probeId: probeId as string,
                      networkDeviceId: networkDeviceId as string,
                    },
                  ),
                  keepLastIfActive: true,
                },
              }
            : {}),
        },
      );

      logger.debug(`Added network device walk ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding network device walk ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static getNetworkDevicePollDeduplicationId(data: {
    probeId: string;
    networkDeviceId: string;
  }): string {
    return `network-device-poll-${data.probeId}-${data.networkDeviceId}`;
  }

  public static async addIncomingEmailJob(data: {
    secretKey?: string | undefined;
    customLocalPart?: string | undefined;
    workflowSecretKey?: string | undefined;
    emailFrom: string;
    emailTo: string;
    emailToAddresses?: Array<string> | undefined;
    emailCcAddresses?: Array<string> | undefined;
    emailSubject: string;
    emailBody: string;
    emailBodyHtml?: string | undefined;
    emailHeaders?: Dictionary<string> | undefined;
    attachments?:
      | Array<{
          filename: string;
          contentType: string;
          size: number;
        }>
      | undefined;
    /*
     * When the ingest API received it, before any queueing: the worker
     * times a page its evaluation starts from then (OnCallPageTiming).
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "incoming-email",
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
        incomingEmail: {
          secretKey: data.secretKey,
          customLocalPart: data.customLocalPart,
          workflowSecretKey: data.workflowSecretKey,
          emailFrom: data.emailFrom,
          emailTo: data.emailTo,
          emailToAddresses: data.emailToAddresses,
          emailCcAddresses: data.emailCcAddresses,
          emailSubject: data.emailSubject,
          emailBody: data.emailBody,
          emailBodyHtml: data.emailBodyHtml,
          emailHeaders: data.emailHeaders,
          attachments: data.attachments,
        },
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      /*
       * The recipient is deliberately not part of the id: it is the monitor's
       * or the workflow's credential, and job ids end up in queue dashboards
       * and logs.
       */
      const jobId: string = `incoming-email-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added incoming email ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming email ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addServerMonitorIngestJob(data: {
    secretKey: string;
    serverMonitorResponse: JSONObject;
    /*
     * When the ingest API received it, before any queueing: the worker
     * times a page its evaluation starts from then (OnCallPageTiming).
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const serverMonitorData: ServerMonitorIngestJobData = {
        secretKey: data.secretKey,
        serverMonitorResponse: data.serverMonitorResponse,
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ServerMonitorIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        serverMonitorIngest: serverMonitorData,
      };

      const jobId: string = `server-monitor-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added server monitor ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding server monitor ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addIncomingRequestIngestJob(data: {
    secretKey: string;
    requestHeaders: Dictionary<string>;
    requestBody: string | JSONObject;
    requestMethod: string;
    receivedViaProbeId?: string | undefined;
    /*
     * When the endpoint received the request. Carried on the job so the
     * worker records the heartbeat at its arrival time, not at the time the
     * queue got around to it.
     */
    receivedAt?: Date | undefined;
  }): Promise<void> {
    try {
      const incomingRequestData: IncomingRequestIngestJobData = {
        secretKey: data.secretKey,
        requestHeaders: data.requestHeaders,
        requestBody: data.requestBody,
        requestMethod: data.requestMethod,
        ingestionTimestamp: data.receivedAt || OneUptimeDate.getCurrentDate(),
        receivedViaProbeId: data.receivedViaProbeId,
      };

      /*
       * Read once: whether the request is stored for coalescing and whether
       * its job is deduplicated must agree.
       */
      const coalesce: boolean = INCOMING_REQUEST_INGEST_COALESCE_ENABLED;

      if (coalesce) {
        /*
         * BullMQ's deduplication below keeps the newest payload only while
         * the monitor's job is ACTIVE. A request that arrives while the job is
         * still WAITING is discarded and the older waiting payload is the one
         * evaluated - under a backlog, most requests. So the request is also
         * stored as the monitor's newest, and a coalesced job evaluates that
         * when it runs (see IncomingRequestLatestPayloadStore). Stored BEFORE
         * the job is added, so the job that ends up evaluating this request
         * always finds it.
         */
        incomingRequestData.coalescedPayloadId = ObjectID.generate().toString();

        await IncomingRequestLatestPayloadStore.store({
          secretKey: data.secretKey,
          payloadId: incomingRequestData.coalescedPayloadId,
          payload: incomingRequestData,
        });
      }

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.IncomingRequestIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        incomingRequestIngest: incomingRequestData,
      };

      const jobId: string = `incoming-request-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
          /*
           * Coalesce same-monitor incoming requests. An external sender can
           * hammer one monitor's incoming-request URL at an arbitrary rate;
           * without coalescing each call becomes its own job and they fan out
           * into many concurrent monitorResource() calls all contending on the
           * same per-monitor Redis lock ("Acquire mutex ... timeout"). With
           * keepLastIfActive BullMQ keeps at most one active + one waiting job
           * per monitor, so same-monitor processing is serialized at enqueue
           * time (no worker slots, no lock contention). Keyed by secretKey
           * because the monitorId is only resolved later in the worker; the
           * secret key is 1:1 with the monitor. Gated so ops can disable
           * without a deploy.
           *
           * Which request gets evaluated is not left to BullMQ, which keeps
           * the latest payload only for a request that arrives while the
           * monitor's job is ACTIVE: the job evaluates the monitor's newest
           * request from IncomingRequestLatestPayloadStore, stored above, so
           * the newest one is evaluated whichever job runs. Liveness does not
           * depend on it either: the endpoint records every arrival in
           * IncomingRequestReceivedAtStore before enqueueing.
           */
          ...(coalesce
            ? {
                deduplication: {
                  id: `incoming-request-${data.secretKey}`,
                  keepLastIfActive: true,
                },
              }
            : {}),
        },
      );

      logger.debug(`Added incoming request ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming request ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addTelemetryMonitorEvaluationJob(data: {
    monitorId: ObjectID;
    projectId?: ObjectID | undefined;
  }): Promise<void> {
    try {
      const monitorId: string = data.monitorId.toString();
      const projectId: string | undefined = data.projectId?.toString();
      const telemetryMonitorEvaluation: TelemetryMonitorEvaluationJobData = {
        monitorId,
        queuedAt: OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.TelemetryMonitorEvaluation,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        telemetryMonitorEvaluation,
      };

      if (projectId) {
        telemetryMonitorEvaluation.projectId = projectId;
        jobData.projectId = projectId;
      }

      const jobId: string = `telemetry-monitor-evaluation-${monitorId}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          skipExistenceCheck: true,
          /*
           * Serialize evaluations per monitor at enqueue time. If one evaluation
           * is active and another tick arrives, BullMQ keeps the latest waiting
           * job instead of letting same-monitor ClickHouse reads pile up.
           */
          deduplication: {
            id: `telemetry-monitor-evaluation-${monitorId}`,
            keepLastIfActive: true,
          },
        },
      );

      logger.debug(`Added telemetry monitor evaluation job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding telemetry monitor evaluation job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addKubernetesCostIngestJob(data: {
    projectId: ObjectID;
    costPayload: JSONObject;
  }): Promise<void> {
    try {
      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.KubernetesCostIngest,
        projectId: data.projectId.toString(),
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        kubernetesCostIngest: {
          projectId: data.projectId.toString(),
          costPayload: data.costPayload,
          ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        },
      };

      const jobId: string = `kubernetes-cost-${data.projectId.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added kubernetes cost ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding kubernetes cost ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  /*
   * Stage and enqueue one session-replay chunk POST.
   *
   * The caller MUST await this before answering the recorder, and must
   * answer 503 if it throws. The trace path does the opposite - it sends 200
   * and then awaits the enqueue - which loses the payload behind a success
   * response when Redis is down (StartServer's error handler bails out once
   * headersSent). For a recording that cannot be re-derived, the recorder
   * has to be able to learn that its chunk did not land so it can retry.
   *
   * Staging is inline as base64 under the threshold and out-of-band above
   * it. The out-of-band key goes at the TOP level of the job data so
   * ProcessTelemetry's existing post-success reclaim finds it.
   */
  public static async addSessionReplayIngestJob(data: {
    projectId: ObjectID;
    appIdentifier: string;
    body: Buffer;
    serverReceiveUnixMs: number;
    samplePercentageAtCapture: number;
    countryCode: string;
    inlineStagingMaxBytes: number;
  }): Promise<void> {
    try {
      const sessionReplayIngest: SessionReplayIngestJobData = {
        projectId: data.projectId.toString(),
        appIdentifier: data.appIdentifier,
        serverReceiveUnixMs: data.serverReceiveUnixMs,
        samplePercentageAtCapture: data.samplePercentageAtCapture,
        countryCode: data.countryCode,
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.SessionReplay,
        projectId: data.projectId.toString(),
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        sessionReplayIngest,
      };

      if (data.body.length <= data.inlineStagingMaxBytes) {
        sessionReplayIngest.inlineBodyBase64 = data.body.toString("base64");
      } else {
        /*
         * The body SET completes before the BullMQ enqueue, so a worker can
         * never pick up a job whose body has not landed yet.
         */
        jobData.bodyKey = await SessionReplayChunkStore.storeBody(data.body);
      }

      const jobId: string = `session-replay-${data.projectId.toString()}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /*
           * Job ids carry a random UUID suffix and are therefore unique
           * (the unix-nano prefix alone is millisecond-precision and
           * collides under concurrency) — skip the duplicate-id
           * existence check (2 Redis round trips).
           */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added session replay ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding session replay ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  /*
   * Enqueue one product analytics batch. Like the replay chunk, the caller
   * awaits this before answering the recorder and answers 503 if it throws,
   * so a batch that never reached the queue is sent again. The batch is
   * small (a hundred events at most) and already parsed, so it travels in
   * the job itself.
   */
  public static async addProductAnalyticsEventsJob(
    data: ProductAnalyticsEventsJobData,
  ): Promise<void> {
    try {
      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProductAnalyticsEvents,
        projectId: data.projectId,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        productAnalyticsEvents: data,
      };

      const jobId: string = `product-analytics-events-${data.projectId}-${data.batchId}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          /* The random suffix makes the id unique; see the replay job. */
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added product analytics events job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding product analytics events job:`);
      logger.error(error);
      throw error;
    }
  }

  /*
   * Telemetry queue BACKLOG (waiting + delayed) for autoscaling signals.
   * Active jobs are excluded on purpose: telemetry jobs park in the active
   * state for the fan-in writer's flush window while awaiting their
   * ClickHouse ack, so counting them makes a scaler read busy-but-healthy
   * capacity as demand — see Queue.getQueueBacklogSize. Queue.getQueueSize
   * stays active-inclusive for the ingest backpressure checks, where
   * in-flight work genuinely counts against capacity.
   */
  public static async getQueueBacklogSize(): Promise<number> {
    return Queue.getQueueBacklogSize(QueueName.Telemetry);
  }
}
