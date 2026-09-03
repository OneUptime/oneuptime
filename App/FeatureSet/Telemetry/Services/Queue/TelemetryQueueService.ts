import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../Utils/OtelPayloadDecoder";
import { headerValueToString } from "Common/Server/Utils/Express";
import TelemetryBodyStore from "../../Utils/TelemetryBodyStore";
import SessionReplayChunkStore from "../../Utils/SessionReplayChunkStore";
import { INCOMING_REQUEST_INGEST_COALESCE_ENABLED } from "../../Config";

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
}

export type ProbeIngestJobType =
  | "probe-response"
  | "monitor-test"
  | "incoming-email"
  | "snmp-trap"
  | "network-device-walk";

export interface IncomingEmailJobData {
  secretKey: string;
  emailFrom: string;
  emailTo: string;
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
  // For probe-response and monitor-test
  probeMonitorResponse?: JSONObject | undefined;
  testId?: string | undefined;
  // For incoming-email
  incomingEmail?: IncomingEmailJobData | undefined;
  // For snmp-trap: the raw request body ({ probeId, probeKey, snmpTrap })
  snmpTrap?: JSONObject | undefined;
  /*
   * For network-device-walk: the raw request body
   * ({ probeId, networkDeviceId, snmpResponse, monitoredAt })
   */
  networkDeviceWalk?: JSONObject | undefined;
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
   * decodes (gunzip + protobuf or JSON) per `bodyFormat` /
   * `bodyEncoding`. Every OTel-type job carries
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
        const contentEncoding: string | undefined = headerValueToString(
          req.headers["content-encoding"],
        );
        const contentType: string | undefined = headerValueToString(
          req.headers["content-type"],
        );
        const isProtobuf: boolean =
          !contentType ||
          contentType.includes("application/x-protobuf") ||
          contentType.includes("application/protobuf");

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
        jobData.bodyEncoding = contentEncoding?.includes("gzip")
          ? "gzip"
          : "none";
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
        jobData.bodyKey = await TelemetryBodyStore.storeBody(buffer);
        jobData.bodyFormat = OtelPayloadFormat.Json;
        jobData.bodyEncoding = "none";
        jobData.productType =
          req.productType ?? PRODUCT_TYPE_BY_TELEMETRY_TYPE[type];
      } else {
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

  public static async addProbeIngestJob(data: {
    probeMonitorResponse: JSONObject;
    jobType: "probe-response" | "monitor-test";
    testId?: string;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        probeMonitorResponse: data.probeMonitorResponse,
        jobType: data.jobType,
        testId: data.testId,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
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

  public static async addSnmpTrapIngestJob(data: {
    snmpTrapRequestBody: JSONObject;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "snmp-trap",
        snmpTrap: data.snmpTrapRequestBody,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

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

  public static async addNetworkDeviceWalkJob(data: {
    walkRequestBody: JSONObject;
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "network-device-walk",
        networkDeviceWalk: data.walkRequestBody,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const jobData: TelemetryIngestJobData = {
        type: TelemetryType.ProbeIngest,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        probeIngest: probeData,
      };

      const jobId: string = `probe-network-device-walk-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

      await Queue.addJob(
        QueueName.Telemetry,
        jobId,
        "ProcessTelemetry",
        jobData as unknown as JSONObject,
        {
          skipExistenceCheck: true,
        },
      );

      logger.debug(`Added network device walk ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding network device walk ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async addIncomingEmailJob(data: {
    secretKey: string;
    emailFrom: string;
    emailTo: string;
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
  }): Promise<void> {
    try {
      const probeData: ProbeIngestJobData = {
        jobType: "incoming-email",
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        incomingEmail: {
          secretKey: data.secretKey,
          emailFrom: data.emailFrom,
          emailTo: data.emailTo,
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

      const jobId: string = `incoming-email-${data.secretKey}-${OneUptimeDate.getCurrentDateAsUnixNano()}-${ObjectID.generate().toString()}`;

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
  }): Promise<void> {
    try {
      const serverMonitorData: ServerMonitorIngestJobData = {
        secretKey: data.secretKey,
        serverMonitorResponse: data.serverMonitorResponse,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
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
  }): Promise<void> {
    try {
      const incomingRequestData: IncomingRequestIngestJobData = {
        secretKey: data.secretKey,
        requestHeaders: data.requestHeaders,
        requestBody: data.requestBody,
        requestMethod: data.requestMethod,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
        receivedViaProbeId: data.receivedViaProbeId,
      };

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
           * per monitor and preserves the latest payload, so same-monitor
           * processing is serialized at enqueue time (no worker slots, no lock
           * contention) while liveness stays fresh. Keyed by secretKey because
           * the monitorId is only resolved later in the worker; the secret key
           * is 1:1 with the monitor. Gated so ops can disable without a deploy.
           */
          ...(INCOMING_REQUEST_INGEST_COALESCE_ENABLED
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

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.Telemetry);
  }

  /*
   * Telemetry queue BACKLOG (waiting + delayed) for autoscaling signals.
   * Active jobs are excluded on purpose: telemetry jobs park in the active
   * state for the fan-in writer's flush window while awaiting their
   * ClickHouse ack, so counting them makes a scaler read busy-but-healthy
   * capacity as demand — see Queue.getQueueBacklogSize. getQueueSize above
   * stays active-inclusive for the ingest backpressure checks, where
   * in-flight work genuinely counts against capacity.
   */
  public static async getQueueBacklogSize(): Promise<number> {
    return Queue.getQueueBacklogSize(QueueName.Telemetry);
  }

  public static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    return Queue.getQueueStats(QueueName.Telemetry);
  }

  public static getFailedJobs(options?: {
    start?: number;
    end?: number;
  }): Promise<
    Array<{
      id: string;
      name: string;
      data: JSONObject;
      failedReason: string;
      stackTrace?: string;
      processedOn: Date | null;
      finishedOn: Date | null;
      attemptsMade: number;
    }>
  > {
    return Queue.getFailedJobs(QueueName.Telemetry, options);
  }
}
