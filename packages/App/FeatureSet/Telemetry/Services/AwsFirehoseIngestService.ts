import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import CloudStreamActivity, {
  CloudStreamSighting,
} from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamAuthenticator, {
  CloudStreamAuthentication,
} from "Common/Server/Utils/CloudConnection/CloudStreamAuthentication";
import {
  ExpressRequest,
  ExpressResponse,
  headerValueToString,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import {
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_MAX_DECODED_BYTES,
  CLOUD_STREAM_MAX_RECORD_DECODED_BYTES,
  CLOUD_STREAM_MAX_REQUEST_BYTES,
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_REQUESTS_PER_MINUTE,
  CloudStreamRefusalReason,
  FIREHOSE_ACCESS_KEY_HEADER,
  FIREHOSE_SOURCE_ARN_HEADER,
} from "Common/Types/CloudConnection/CloudStream";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  DecodeBudget,
  gunzipBounded,
} from "../Utils/AwsFirehose/CloudWatchLogs";
import FirehoseDeliveryLedger from "../Utils/AwsFirehose/FirehoseDeliveryLedger";
import {
  FirehoseEnvelopeReading,
  readFirehoseEnvelope,
  readFirehoseRequestIdHeader,
  sendFirehoseResponse,
} from "../Utils/AwsFirehose/FirehoseContract";
import {
  DecodedDelivery,
  DeliveredResource,
  decodeFirehoseRecords,
  readRegionFromSourceArn,
} from "../Utils/AwsFirehose/FirehoseRecords";
import LogsQueueService from "./Queue/LogsQueueService";
import MetricsQueueService from "./Queue/MetricsQueueService";

/*
 * THE AMAZON DATA FIREHOSE ENDPOINT: AN AWS ACCOUNT'S METRICS AND LOGS,
 * STREAMED.
 *
 *   POST /aws-firehose/v1/metrics   (and under /telemetry)
 *   POST /aws-firehose/v1/logs
 *
 * A CloudWatch metric stream and CloudWatch Logs subscriptions deliver into
 * Firehose streams whose destination is this endpoint (CloudStream; the
 * CloudFormation template is CloudStreamTemplate). One delivery is:
 *
 *   1. its sender, from X-Amz-Firehose-Access-Key, before a byte of the body
 *      is read: a connection's stream key (CloudStreamAuthenticator), which
 *      names the project it is written to - nothing the records say does;
 *   2. its rate: at most CLOUD_STREAM_REQUESTS_PER_MINUTE deliveries a minute
 *      for one connection, past which Firehose is told 429 and sends the
 *      batch again later;
 *   3. its body, at most CLOUD_STREAM_MAX_REQUEST_BYTES as sent and
 *      CLOUD_STREAM_MAX_DECODED_BYTES once gunzipped, its records included
 *      (413, which Firehose does not send again);
 *   4. its envelope (FirehoseContract): a body that is not one is 400;
 *   5. a batch taken before, with the same request id, is answered 200 and
 *      not queued again (FirehoseDeliveryLedger);
 *   6. its records, read for what they are (FirehoseRecords): metric stream
 *      records - OpenTelemetry 1.0 or JSON - and CloudWatch Logs
 *      subscription records, whichever endpoint they came to;
 *   7. queued as OTLP metrics and logs - in jobs of at most
 *      MAX_DATAPOINTS_PER_JOB datapoints and MAX_LOG_RECORDS_PER_JOB log
 *      records - exactly as an OTLP export is, so drop filters, scrub rules,
 *      pipelines, retention, billing and finding each datapoint's cloud
 *      resource apply to them as to any other telemetry. A queue that
 *      cannot take them is 503, which Firehose sends again;
 *   8. noted on the connection (CloudStreamActivity) and answered 200.
 *
 * Every answer is in Firehose's own shape (sendFirehoseResponse), with the
 * request's id. A delivery that cannot be told apart - no key, a wrong one -
 * is answered alike, so the endpoint says nothing of which connections
 * exist; one whose key names a real connection is noted on it, so the person
 * setting the stream up sees why it was refused. One delivery costs a few
 * Redis operations, its decode and its queueing - linear in what it carries
 * and bounded - and is answered with under a kilobyte, whatever it holds.
 */

// The most a queued job of a delivery holds; a bigger delivery is several jobs.
export const MAX_DATAPOINTS_PER_JOB: number = 10_000;
export const MAX_LOG_RECORDS_PER_JOB: number = 5_000;

export const STREAM_THROTTLED_MESSAGE: string =
  "This connection's streams sent more deliveries this minute than OneUptime takes. Firehose sends this batch again shortly.";
export const STREAM_TOO_LARGE_MESSAGE: string = `This delivery is larger than OneUptime takes: ${CLOUD_STREAM_MAX_REQUEST_BYTES / 1024 / 1024} MiB as sent and ${CLOUD_STREAM_MAX_DECODED_BYTES / 1024 / 1024} MiB decompressed. Set the Firehose stream's buffer size to 1 MiB and its content encoding to GZIP, as the OneUptime template does.`;
export const STREAM_UNSUPPORTED_ENCODING_MESSAGE: string =
  "Firehose compresses with GZIP or not at all: set the stream's content encoding to GZIP.";
export const STREAM_QUEUE_UNAVAILABLE_MESSAGE: string =
  "OneUptime could not queue this delivery right now. Firehose sends it again.";

export const STREAM_BROKEN_GZIP_MESSAGE: string =
  "The delivery says it is gzip, but it does not gunzip.";

class TooLarge extends Error {}
class MalformedBody extends Error {}

export default class AwsFirehoseIngestService {
  @CaptureSpan()
  public static async ingest(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const now: Date = new Date();
    let requestId: string = readFirehoseRequestIdHeader(
      req.headers as Record<string, string | Array<string> | undefined>,
    );

    const answer: (
      status: number,
      errorMessage?: string | undefined,
    ) => void = (status: number, errorMessage?: string | undefined): void => {
      sendFirehoseResponse({ res, status, requestId, now, errorMessage });
    };

    try {
      if (TelemetryIngestionDisabled.isDisabled()) {
        // Taken and dropped, as every ingest path does with ingestion off.
        AwsFirehoseIngestService.drain(req);
        return answer(200);
      }

      const authentication: CloudStreamAuthentication =
        await CloudStreamAuthenticator.authenticate({
          accessKey: req.headers[FIREHOSE_ACCESS_KEY_HEADER],
          now,
        });

      if (!authentication.isAuthorized) {
        AwsFirehoseIngestService.drain(req);

        if (authentication.connectionId) {
          CloudStreamActivity.noteRefusal({
            connectionId: authentication.connectionId,
            reason: authentication.reason,
            now,
          });
        }

        return answer(authentication.status, authentication.message);
      }

      const connectionId: ObjectID = authentication.connectionId;

      const decision: TelemetryIngestionKeyLimitDecision =
        await TelemetryIngestionKeyRateLimiter.consume({
          // The connection is the key here: one allowance for all its streams.
          ingestionKeyId: connectionId,
          limitPerMinute: CLOUD_STREAM_REQUESTS_PER_MINUTE,
        });

      if (decision.outcome === TelemetryIngestionKeyLimitOutcome.RateLimited) {
        AwsFirehoseIngestService.drain(req);

        if (decision.isFirstRejectionInWindow) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.Throttled,
            now,
          });
        }

        if (decision.retryAfterSeconds) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }

        return answer(429, STREAM_THROTTLED_MESSAGE);
      }

      const encoding: string = (
        headerValueToString(req.headers["content-encoding"]) || ""
      )
        .trim()
        .toLowerCase();

      if (encoding && encoding !== "gzip" && encoding !== "identity") {
        AwsFirehoseIngestService.drain(req);
        return answer(400, STREAM_UNSUPPORTED_ENCODING_MESSAGE);
      }

      let body: Buffer;

      try {
        body = await AwsFirehoseIngestService.readBody(req);

        if (encoding === "gzip") {
          body = await gunzipBounded(
            body,
            CLOUD_STREAM_MAX_DECODED_BYTES,
          ).catch((error: unknown): never => {
            throw AwsFirehoseIngestService.isTooLarge(error)
              ? new TooLarge()
              : new MalformedBody();
          });
        }
      } catch (error) {
        if (error instanceof TooLarge) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.TooLarge,
            now,
          });
          return answer(413, STREAM_TOO_LARGE_MESSAGE);
        }

        if (error instanceof MalformedBody) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.Malformed,
            now,
          });
          return answer(400, STREAM_BROKEN_GZIP_MESSAGE);
        }

        throw error;
      }

      const reading: FirehoseEnvelopeReading = readFirehoseEnvelope(body);

      if ("problem" in reading) {
        CloudStreamActivity.noteRefusal({
          connectionId,
          reason: CloudStreamRefusalReason.Malformed,
          now,
        });
        return answer(400, reading.problem);
      }

      requestId = requestId || reading.envelope.requestId;

      if (await FirehoseDeliveryLedger.wasTaken({ connectionId, requestId })) {
        return answer(200);
      }

      const budget: DecodeBudget = {
        bytesLeft: CLOUD_STREAM_MAX_DECODED_BYTES,
        perRecordBytes: CLOUD_STREAM_MAX_RECORD_DECODED_BYTES,
      };
      let delivery: DecodedDelivery;

      try {
        delivery = await decodeFirehoseRecords({
          records: reading.envelope.records,
          serviceName: authentication.serviceName,
          connectionId: connectionId.toString(),
          region: readRegionFromSourceArn(
            req.headers[FIREHOSE_SOURCE_ARN_HEADER],
          ),
          now,
          budget,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.TooLarge,
            now,
          });
          return answer(413, STREAM_TOO_LARGE_MESSAGE);
        }

        throw error;
      }

      try {
        await AwsFirehoseIngestService.queue({
          projectId: authentication.projectId,
          delivery,
        });
      } catch (error) {
        logger.warn(
          `Cloud stream ${connectionId.toString()}: a delivery could not be queued: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return answer(503, STREAM_QUEUE_UNAVAILABLE_MESSAGE);
      }

      await FirehoseDeliveryLedger.markTaken({ connectionId, requestId });

      CloudStreamActivity.noteDelivery({
        connectionId,
        now,
        sightings: AwsFirehoseIngestService.getSightings(delivery),
      });

      return answer(200);
    } catch (error) {
      logger.error(
        `Cloud stream delivery ${requestId || "(no request id)"} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Firehose sends a 500 again; the message says nothing of the server.
      return answer(
        500,
        "OneUptime could not take this delivery. Firehose sends it again.",
      );
    }
  }

  // What a delivery was from: each account and Region, its namespaces and log groups.
  public static getSightings(
    delivery: DecodedDelivery,
  ): Array<CloudStreamSighting> {
    const sightings: Map<string, CloudStreamSighting> = new Map();

    for (const [key, metrics] of delivery.sightings.metrics) {
      sightings.set(key, {
        accountId: metrics.accountId,
        region: metrics.region,
        namespaces: Array.from(metrics.namespaces),
      });
    }

    for (const [key, logs] of delivery.sightings.logs) {
      const existing: CloudStreamSighting | undefined = sightings.get(key);

      sightings.set(key, {
        accountId: logs.accountId,
        region: logs.region,
        ...(existing?.namespaces ? { namespaces: existing.namespaces } : {}),
        logGroups: Array.from(logs.logGroups),
      });
    }

    return Array.from(sightings.values());
  }

  /*
   * Whole resources in each job, up to its limit: a resource with more than
   * that is a job of its own.
   */
  public static chunk(
    resources: Array<DeliveredResource>,
    limit: number,
  ): Array<Array<JSONObject>> {
    const chunks: Array<Array<JSONObject>> = [];
    let current: Array<JSONObject> = [];
    let count: number = 0;

    for (const delivered of resources) {
      if (current.length > 0 && count + delivered.count > limit) {
        chunks.push(current);
        current = [];
        count = 0;
      }

      current.push(delivered.resource);
      count += delivered.count;
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  private static async queue(data: {
    projectId: ObjectID;
    delivery: DecodedDelivery;
  }): Promise<void> {
    for (const resourceMetrics of AwsFirehoseIngestService.chunk(
      data.delivery.resourceMetrics,
      MAX_DATAPOINTS_PER_JOB,
    )) {
      const job: Partial<TelemetryRequest> = {
        body: { resourceMetrics: resourceMetrics as unknown as JSONArray },
        headers: {},
        projectId: data.projectId,
        productType: ProductType.Metrics,
        path: CLOUD_STREAM_METRICS_PATH,
        url: CLOUD_STREAM_METRICS_PATH,
      };

      await MetricsQueueService.addMetricIngestJob(job as TelemetryRequest);
    }

    for (const resourceLogs of AwsFirehoseIngestService.chunk(
      data.delivery.resourceLogs,
      MAX_LOG_RECORDS_PER_JOB,
    )) {
      const job: Partial<TelemetryRequest> = {
        body: { resourceLogs: resourceLogs as unknown as JSONArray },
        headers: {},
        projectId: data.projectId,
        productType: ProductType.Logs,
        path: CLOUD_STREAM_LOGS_PATH,
        url: CLOUD_STREAM_LOGS_PATH,
      };

      await LogsQueueService.addLogIngestJob(job as TelemetryRequest);
    }
  }

  /*
   * The body as sent, at most CLOUD_STREAM_MAX_REQUEST_BYTES: a declared
   * length over it is refused before a byte is read, and a body that grows
   * past it is let go of as it does (TooLarge).
   */
  private static async readBody(req: ExpressRequest): Promise<Buffer> {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > CLOUD_STREAM_MAX_REQUEST_BYTES) {
        throw new TooLarge();
      }

      return req.body;
    }

    const declared: number = parseInt(
      headerValueToString(req.headers["content-length"]) || "",
      10,
    );

    if (
      Number.isFinite(declared) &&
      declared > CLOUD_STREAM_MAX_REQUEST_BYTES
    ) {
      AwsFirehoseIngestService.drain(req);
      throw new TooLarge();
    }

    return await new Promise<Buffer>(
      (resolve: (body: Buffer) => void, reject: (error: Error) => void) => {
        const chunks: Array<Uint8Array> = [];
        let received: number = 0;
        let isDone: boolean = false;

        const onData: (chunk: Buffer | string) => void = (
          chunk: Buffer | string,
        ): void => {
          if (isDone) {
            return;
          }

          const buffer: Buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk, "utf8");
          received += buffer.length;

          if (received > CLOUD_STREAM_MAX_REQUEST_BYTES) {
            isDone = true;
            chunks.length = 0;
            req.removeListener("data", onData);
            req.resume();
            reject(new TooLarge());
            return;
          }

          chunks.push(new Uint8Array(buffer));
        };

        req.on("data", onData);
        req.on("end", () => {
          if (!isDone) {
            isDone = true;
            resolve(Buffer.concat(chunks));
          }
        });
        req.on("error", (error: Error) => {
          if (!isDone) {
            isDone = true;
            reject(error);
          }
        });
      },
    );
  }

  // An unread body is let go of, so the connection can carry the next one.
  private static drain(req: ExpressRequest): void {
    if (typeof req.resume === "function") {
      req.resume();
    }
  }

  private static isTooLarge(error: unknown): boolean {
    return (
      error instanceof RangeError ||
      (Boolean(error) &&
        typeof error === "object" &&
        (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE")
    );
  }
}
