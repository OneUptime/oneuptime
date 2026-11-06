import http from "http";
import path from "path";
import zlib from "zlib";
import protobuf from "protobufjs";
import { JSONObject } from "Common/Types/JSON";

/*
 * WHAT AMAZON DATA FIREHOSE SENDS, FOR THE STREAM ENDPOINT'S TESTS.
 *
 * Builds Firehose's HTTP endpoint requests the way Firehose builds them -
 * the headers, the envelope, the base64 records, gzip on the wire - around
 * records in the shapes CloudWatch writes them (Amazon CloudWatch User
 * Guide: "Metric streams output in OpenTelemetry 1.0.0 format" and "in JSON
 * format"; CloudWatch Logs User Guide: "Subscription filters with Amazon
 * Data Firehose", whose example document the logs records copy), and sends
 * them over a real socket. Not a test file itself.
 */

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const MetricsData: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "metrics.proto"))
  .lookupType("MetricsData");

export const ACCOUNT_ID: string = "123456789012";
export const REGION: string = "us-east-1";
export const METRIC_STREAM_ARN: string = `arn:aws:cloudwatch:${REGION}:${ACCOUNT_ID}:metric-stream/OneUptime-6f1c3a2e`;
export const METRICS_FIREHOSE_ARN: string = `arn:aws:firehose:${REGION}:${ACCOUNT_ID}:deliverystream/OneUptime-6f1c3a2e-metrics`;
export const LOGS_FIREHOSE_ARN: string = `arn:aws:firehose:${REGION}:${ACCOUNT_ID}:deliverystream/OneUptime-6f1c3a2e-logs`;
// A minute of CloudWatch data: 2026-11-04 09:59 to 10:00 UTC.
export const MINUTE_START_MS: number = Date.UTC(2026, 10, 4, 9, 59, 0, 0);
export const MINUTE_END_MS: number = MINUTE_START_MS + 60 * 1000;

function stringAttribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

/*
 * One metric of a metric stream in OpenTelemetry 1.0: a summary of the
 * minute - count, sum, the minimum as quantile 0 and the maximum as
 * quantile 1 - with Namespace, MetricName and Dimensions on the datapoint.
 */
export function openTelemetryMetric(data: {
  namespace: string;
  metricName: string;
  dimensions: Record<string, string>;
  unit?: string;
  count: number;
  sum: number;
  min: number;
  max: number;
}): JSONObject {
  return {
    name: `amazonaws.com/${data.namespace}/${data.metricName}`,
    unit: data.unit || "%",
    summary: {
      dataPoints: [
        {
          startTimeUnixNano: `${MINUTE_START_MS}000000`,
          timeUnixNano: `${MINUTE_END_MS}000000`,
          count: data.count,
          sum: data.sum,
          quantileValues: [
            { quantile: 0, value: data.min },
            { quantile: 1, value: data.max },
          ],
          attributes: [
            stringAttribute("Namespace", data.namespace),
            stringAttribute("MetricName", data.metricName),
            {
              key: "Dimensions",
              value: {
                kvlistValue: {
                  values: Object.entries(data.dimensions).map(
                    ([key, value]: [string, string]) => {
                      return stringAttribute(key, value);
                    },
                  ),
                },
              },
            },
          ],
        },
      ],
    },
  };
}

// One ExportMetricsServiceRequest of a stream: an account and Region's metrics.
export function openTelemetryRequest(
  metrics: Array<JSONObject>,
  data: { accountId?: string; region?: string } = {},
): JSONObject {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            stringAttribute("cloud.provider", "aws"),
            stringAttribute("cloud.account.id", data.accountId || ACCOUNT_ID),
            stringAttribute("cloud.region", data.region || REGION),
            stringAttribute("aws.exporter.arn", METRIC_STREAM_ARN),
          ],
        },
        scopeMetrics: [{ scope: {}, metrics }],
      },
    ],
  };
}

// A record's bytes: each request led by its size as a varint.
export function openTelemetryRecord(requests: Array<JSONObject>): Buffer {
  const writer: protobuf.Writer = protobuf.Writer.create();

  for (const request of requests) {
    MetricsData.encodeDelimited(MetricsData.fromObject(request), writer);
  }

  return Buffer.from(writer.finish());
}

// A metric stream's JSON format: one update a line.
export function jsonMetricRecord(updates: Array<JSONObject>): Buffer {
  return Buffer.from(
    updates
      .map((update: JSONObject): string => {
        return `${JSON.stringify(update)}\n`;
      })
      .join(""),
    "utf8",
  );
}

export function jsonMetricUpdate(data: {
  namespace: string;
  metricName: string;
  dimensions: Record<string, string>;
  value: JSONObject;
  unit?: string;
  accountId?: string;
  region?: string;
}): JSONObject {
  return {
    metric_stream_name: "OneUptime-6f1c3a2e",
    account_id: data.accountId || ACCOUNT_ID,
    region: data.region || REGION,
    namespace: data.namespace,
    metric_name: data.metricName,
    dimensions: data.dimensions,
    timestamp: MINUTE_START_MS,
    value: data.value,
    unit: data.unit || "Percent",
  };
}

export interface LogEvent {
  id: string;
  timestamp: number;
  message: string;
}

// A subscription's delivery, as CloudWatch Logs writes it into Firehose.
export function cloudWatchLogsDocument(data: {
  logGroup: string;
  logStream: string;
  events: Array<LogEvent>;
  owner?: string;
}): JSONObject {
  return {
    messageType: "DATA_MESSAGE",
    owner: data.owner || ACCOUNT_ID,
    logGroup: data.logGroup,
    logStream: data.logStream,
    subscriptionFilters: ["OneUptime-6f1c3a2e"],
    logEvents: data.events as unknown as Array<JSONObject>,
  } as unknown as JSONObject;
}

// The test message CloudWatch Logs sends a destination when a subscription is made.
export const CONTROL_MESSAGE_DOCUMENT: JSONObject = {
  messageType: "CONTROL_MESSAGE",
  owner: "CloudwatchLogs",
  logGroup: "",
  logStream: "",
  subscriptionFilters: [],
  logEvents: [
    {
      id: "",
      timestamp: MINUTE_START_MS,
      message: "CWL CONTROL MESSAGE: Checking health of destination Firehose.",
    },
  ],
};

// A logs record: the document gzipped, as CloudWatch Logs sends it.
export function cloudWatchLogsRecord(
  document: JSONObject,
  options: { gzip?: boolean } = {},
): Buffer {
  const text: Buffer = Buffer.from(JSON.stringify(document), "utf8");
  return options.gzip === false ? text : zlib.gzipSync(text);
}

export function firehoseEnvelope(data: {
  requestId: string;
  records: Array<Buffer>;
  timestamp?: number;
}): JSONObject {
  return {
    requestId: data.requestId,
    timestamp: data.timestamp || MINUTE_END_MS + 30_000,
    records: data.records.map((record: Buffer): JSONObject => {
      return { data: record.toString("base64") };
    }),
  };
}

export interface FirehoseReply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  body: JSONObject;
}

// How long a delivery that holds its body back waits for its answer.
const ANSWER_BEFORE_BODY_MS: number = 3_000;
// The pieces a delivery sent without a length is written in.
const CHUNK_BYTES: number = 64 * 1024;

/*
 * Sends one delivery the way Firehose does: POST, application/json, the
 * request id, the stream's ARN and the access key in their headers, the
 * body gzipped unless told not to.
 *
 * declaredLength sends the headers alone, saying the body is that long, and
 * holds the body back: the answer must come before it, within
 * ANSWER_BEFORE_BODY_MS. chunked sends the body without a length, in pieces,
 * as a sender that streams it would.
 */
export async function sendFirehoseDelivery(data: {
  port: number;
  path: string;
  accessKey?: string | undefined;
  requestId: string;
  sourceArn?: string | undefined;
  body: Buffer | JSONObject;
  gzip?: boolean | undefined;
  headers?: Record<string, string> | undefined;
  declaredLength?: number | undefined;
  chunked?: boolean | undefined;
}): Promise<FirehoseReply> {
  const raw: Buffer = Buffer.isBuffer(data.body)
    ? data.body
    : Buffer.from(JSON.stringify(data.body), "utf8");
  const payload: Buffer = data.gzip === false ? raw : zlib.gzipSync(raw);
  const isHeldBack: boolean = data.declaredLength !== undefined;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(data.chunked
      ? { "Transfer-Encoding": "chunked" }
      : { "Content-Length": String(data.declaredLength ?? payload.length) }),
    "X-Amz-Firehose-Protocol-Version": "1.0",
    "X-Amz-Firehose-Request-Id": data.requestId,
    ...(data.gzip === false ? {} : { "Content-Encoding": "gzip" }),
    ...(data.sourceArn ? { "X-Amz-Firehose-Source-Arn": data.sourceArn } : {}),
    ...(data.accessKey !== undefined
      ? { "X-Amz-Firehose-Access-Key": data.accessKey }
      : {}),
    ...(data.headers || {}),
  };

  return await new Promise<FirehoseReply>(
    (
      resolve: (reply: FirehoseReply) => void,
      reject: (error: Error) => void,
    ) => {
      let isSettled: boolean = false;
      let heldBackTimer: ReturnType<typeof setTimeout> | undefined = undefined;

      const settle: (outcome: () => void) => void = (
        outcome: () => void,
      ): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;

        if (heldBackTimer) {
          clearTimeout(heldBackTimer);
        }

        outcome();
      };

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "POST",
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject = {};

            try {
              body = JSON.parse(text) as JSONObject;
            } catch {
              body = {};
            }

            settle(() => {
              resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                text,
                body,
              });
            });

            if (isHeldBack) {
              // The body it held back is never sent.
              request.destroy();
            }
          });
        },
      );

      request.on("error", (error: Error) => {
        settle(() => {
          reject(error);
        });
      });

      if (isHeldBack) {
        heldBackTimer = setTimeout(() => {
          settle(() => {
            reject(
              new Error(
                `No answer within ${ANSWER_BEFORE_BODY_MS} ms while the body was held back.`,
              ),
            );
          });
          request.destroy();
        }, ANSWER_BEFORE_BODY_MS);
        request.flushHeaders();
        return;
      }

      if (data.chunked) {
        for (
          let offset: number = 0;
          offset < payload.length;
          offset += CHUNK_BYTES
        ) {
          request.write(payload.subarray(offset, offset + CHUNK_BYTES));
        }

        request.end();
        return;
      }

      request.end(payload);
    },
  );
}
