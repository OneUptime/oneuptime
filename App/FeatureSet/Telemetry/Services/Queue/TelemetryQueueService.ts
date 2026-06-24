import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../Utils/OtelPayloadDecoder";
import { headerValueToString } from "Common/Server/Utils/Express";
import TelemetryBodyStore from "../../Utils/TelemetryBodyStore";

export enum TelemetryType {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  Profiles = "profiles",
  Syslog = "syslog",
  FluentLogs = "fluentlogs",
  ProbeIngest = "probe-ingest",
  ServerMonitorIngest = "server-monitor-ingest",
  IncomingRequestIngest = "incoming-request-ingest",
}

export type ProbeIngestJobType =
  | "probe-response"
  | "monitor-test"
  | "incoming-email";

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
  ingestionTimestamp: Date;
  // ProbeIngest-specific
  probeIngest?: ProbeIngestJobData;
  // ServerMonitorIngest-specific
  serverMonitorIngest?: ServerMonitorIngestJobData;
  // IncomingRequestIngest-specific
  incomingRequestIngest?: IncomingRequestIngestJobData;
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
 * JSON.stringify replacer that rewrites binary values to base64
 * strings. The gRPC entry point hands us proto-loader output where
 * `bytes` fields (traceId / spanId / profileId / ...) are Buffers;
 * a plain stringify would serialize those as `{"type":"Buffer",
 * "data":[...]}` which the downstream ingest services cannot read.
 * protobufjs' `.toJSON()` (the deferred-decode path) emits base64
 * for bytes fields, so converting here keeps both producer paths
 * byte-for-byte compatible for the worker.
 */
function binaryToBase64Replacer(_key: string, value: unknown): unknown {
  /*
   * Buffer.prototype.toJSON runs before the replacer, so Buffers
   * arrive here already reshaped as { type: "Buffer", data: [...] }.
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

  // Plain Uint8Arrays have no toJSON and would serialize as index maps.
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
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
        requestHeaders: req.headers as Record<string, string>,
        ingestionTimestamp: OneUptimeDate.getCurrentDate(),
      };

      const isRawBuffer: boolean =
        Buffer.isBuffer(req.body) || req.body instanceof Uint8Array;
      const isOtelType: boolean = OTEL_TELEMETRY_TYPES.includes(type);

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
        },
      );

      logger.debug(`Added incoming request ingestion job: ${jobId}`);
    } catch (error) {
      logger.error(`Error adding incoming request ingestion job:`);
      logger.error(error);
      throw error;
    }
  }

  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.Telemetry);
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
