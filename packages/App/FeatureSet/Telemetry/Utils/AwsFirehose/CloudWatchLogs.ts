import zlib from "zlib";
import { promisify } from "util";
import { getAwsLogGroupAttributes } from "Common/Types/Cloud/CloudLogGroups";
import {
  CloudWatchLogSeverity,
  inferCloudWatchLogSeverity,
} from "Common/Types/Cloud/CloudWatchLogSeverity";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import { FIREHOSE_SCOPE_NAME, OtlpAttribute } from "./CloudWatchMetricStream";

/*
 * CLOUDWATCH LOGS SUBSCRIPTION DELIVERIES, AS OTLP LOGS.
 *
 * A CloudWatch Logs subscription filter (or an account-level subscription
 * policy) whose destination is a Firehose stream writes each Firehose
 * record as one gzip-compressed JSON document (Amazon CloudWatch Logs User
 * Guide, "Real-time processing of log data with subscriptions"):
 *
 *   { "messageType": "DATA_MESSAGE", "owner": "123456789012",
 *     "logGroup": "/aws/lambda/checkout", "logStream": "2024/01/01/[$LATEST]…",
 *     "subscriptionFilters": ["..."],
 *     "logEvents": [ { "id": "...", "timestamp": 1704067200000, "message": "..." } ] }
 *
 * A CONTROL_MESSAGE is CloudWatch Logs checking that the destination is
 * there - when a subscription is made - and its one event is that check
 * ("CWL CONTROL MESSAGE: Checking health of destination Firehose."), no
 * log line: it is counted, never stored. A stream that
 * decompresses its records itself (Firehose's own CloudWatch Logs
 * decompression) delivers the same document uncompressed, and more than
 * one may follow each other in one record: all of it is read.
 *
 * Each log group and account becomes one OTLP resource, under the
 * connection's telemetry service and id, with the account and Region
 * (cloud.account.id, cloud.region - the Firehose stream's, which a
 * subscription shares with its log group) and the group's name
 * (aws.log.group.name); when the group's name says the resource it is the
 * log of, that resource's id too (cloud.resource_id, CloudLogGroups), and
 * when it is an App Platforms platform's - an App Runner service, an
 * Elastic Beanstalk environment, an ECS cluster or task - cloud.platform,
 * which puts its logs on the platform's environment. Each
 * event is one log record: its time, its message as the body, its stream
 * and id as attributes, and the severity its message says when it says one
 * the way Lambda or a database engine writes it (inferCloudWatchLogSeverity).
 *
 * Read in one pass, without a regular expression; every record's gzip is
 * held to the budget its request was given.
 */

export const CLOUDWATCH_LOGS_DATA_MESSAGE: string = "DATA_MESSAGE";
export const CLOUDWATCH_LOGS_CONTROL_MESSAGE: string = "CONTROL_MESSAGE";

// The resource attributes a delivered log carries, and the record attributes.
export const AWS_LOG_GROUP_NAME_ATTRIBUTE: string = "aws.log.group.name";
export const AWS_LOG_STREAM_NAME_ATTRIBUTE: string = "aws.log.stream.name";
export const AWS_LOG_EVENT_ID_ATTRIBUTE: string = "aws.log.event.id";

const gunzipAsync: (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer> = promisify(zlib.gunzip) as unknown as (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer>;

export interface CloudWatchLogEvent {
  id: string;
  timestamp: number;
  message: string;
}

export interface CloudWatchLogsMessage {
  messageType: string;
  owner: string;
  logGroup: string;
  logStream: string;
  logEvents: Array<CloudWatchLogEvent>;
}

// What a request's records may decompress to, all of them together.
export interface DecodeBudget {
  bytesLeft: number;
  // The most one record may decompress to.
  perRecordBytes: number;
}

export function isGzip(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/*
 * Gunzipped, never past `maxBytes`: zlib stops there and rejects with
 * ERR_BUFFER_TOO_LARGE rather than hold more.
 */
export async function gunzipBounded(
  data: Buffer,
  maxBytes: number,
): Promise<Buffer> {
  return await gunzipAsync(data, { maxOutputLength: Math.max(1, maxBytes) });
}

/*
 * A record's bytes as text: gunzipped when they are gzip, within the
 * budget. Throws when the budget is spent or the gzip is broken.
 */
export async function readRecordText(
  data: Buffer,
  budget: DecodeBudget,
): Promise<string> {
  if (!isGzip(data)) {
    budget.bytesLeft -= data.length;

    if (budget.bytesLeft < 0) {
      throw new RangeError("The delivery decompresses to more than it may.");
    }

    return data.toString("utf8");
  }

  const limit: number = Math.max(
    0,
    Math.min(budget.perRecordBytes, budget.bytesLeft),
  );
  const decompressed: Buffer = await gunzipAsync(data, {
    maxOutputLength: Math.max(1, limit),
  });

  budget.bytesLeft -= decompressed.length;

  if (budget.bytesLeft < 0) {
    throw new RangeError("The delivery decompresses to more than it may.");
  }

  return decompressed.toString("utf8");
}

/*
 * Every JSON document in a text, one after another: "{...}{...}" or one a
 * line. A scan that counts braces outside strings tells where each ends,
 * so a document is parsed once, and the text is read once. A piece that is
 * not JSON is skipped.
 */
export function readConcatenatedJson(text: string): Array<unknown> {
  const documents: Array<unknown> = [];
  let depth: number = 0;
  let start: number = -1;
  let inString: boolean = false;
  let escaped: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = depth > 0;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        start = index;
      }

      depth++;
      continue;
    }

    if (character === "}" && depth > 0) {
      depth--;

      if (depth === 0 && start >= 0) {
        try {
          documents.push(JSON.parse(text.slice(start, index + 1)));
        } catch {
          // Not JSON: skipped.
        }

        start = -1;
      }
    }
  }

  return documents;
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A subscription delivery as the message it is, or null.
export function readCloudWatchLogsMessage(
  value: unknown,
): CloudWatchLogsMessage | null {
  const document: JSONObject = readObject(value);
  const messageType: string = readText(document["messageType"]);

  if (
    messageType !== CLOUDWATCH_LOGS_DATA_MESSAGE &&
    messageType !== CLOUDWATCH_LOGS_CONTROL_MESSAGE
  ) {
    return null;
  }

  const events: Array<CloudWatchLogEvent> = [];
  const rawEvents: JSONValue | undefined = document["logEvents"];

  if (Array.isArray(rawEvents)) {
    for (const rawEvent of rawEvents) {
      const event: JSONObject = readObject(rawEvent);
      const timestamp: JSONValue | undefined = event["timestamp"];

      if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
        continue;
      }

      events.push({
        id: readText(event["id"]),
        timestamp,
        message: readText(event["message"]),
      });
    }
  }

  return {
    messageType,
    owner: readText(document["owner"]).trim(),
    logGroup: readText(document["logGroup"]).trim(),
    logStream: readText(document["logStream"]).trim(),
    logEvents: events,
  };
}

/*
 * The severity a line says, as Lambda's runtimes, the loggers and RDS's
 * database engines write it - or null (CloudWatchLogSeverity, which the
 * offline fixtures that show these rows read too).
 */
export { inferCloudWatchLogSeverity };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

// Milliseconds since the epoch as OTLP nanoseconds.
function toUnixNano(milliseconds: number): string {
  return `${Math.trunc(milliseconds)}000000`;
}

export interface LogGroupFacts {
  accountId: string;
  region: string;
  logGroup: string;
  events: number;
}

/*
 * The messages' events as OTLP resourceLogs: one resource per account and
 * log group. Control messages hold no event and are left out.
 */
export function buildResourceLogs(data: {
  messages: Array<CloudWatchLogsMessage>;
  region: string;
  serviceName: string;
  connectionId: string;
  observedAtMs: number;
}): { resourceLogs: Array<JSONObject>; facts: Array<LogGroupFacts> } {
  const observedTimeUnixNano: string = toUnixNano(data.observedAtMs);
  const groups: Map<
    string,
    { facts: LogGroupFacts; resource: JSONObject; records: Array<JSONObject> }
  > = new Map();

  for (const message of data.messages) {
    if (
      message.messageType !== CLOUDWATCH_LOGS_DATA_MESSAGE ||
      message.logEvents.length === 0
    ) {
      continue;
    }

    const key: string = `${message.owner}|${message.logGroup}`;
    let group:
      | {
          facts: LogGroupFacts;
          resource: JSONObject;
          records: Array<JSONObject>;
        }
      | undefined = groups.get(key);

    if (!group) {
      const filed: Record<string, string> = getAwsLogGroupAttributes({
        logGroup: message.logGroup,
        accountId: message.owner,
        region: data.region,
      });

      const attributes: Array<OtlpAttribute> = [
        stringAttribute("service.name", data.serviceName),
        stringAttribute("cloud.provider", "aws"),
        stringAttribute(CLOUD_CONNECTION_ID_ATTRIBUTE, data.connectionId),
        ...(message.owner
          ? [stringAttribute("cloud.account.id", message.owner)]
          : []),
        ...(data.region ? [stringAttribute("cloud.region", data.region)] : []),
        ...(message.logGroup
          ? [stringAttribute(AWS_LOG_GROUP_NAME_ATTRIBUTE, message.logGroup)]
          : []),
        ...Object.keys(filed).map((attributeKey: string): OtlpAttribute => {
          return stringAttribute(attributeKey, filed[attributeKey]!);
        }),
      ];

      group = {
        facts: {
          accountId: message.owner,
          region: data.region,
          logGroup: message.logGroup,
          events: 0,
        },
        resource: { attributes: attributes as unknown as JSONArray },
        records: [],
      };
      groups.set(key, group);
    }

    for (const event of message.logEvents) {
      const severity: CloudWatchLogSeverity | null = inferCloudWatchLogSeverity(
        event.message,
      );
      const attributes: Array<OtlpAttribute> = [
        ...(message.logStream
          ? [stringAttribute(AWS_LOG_STREAM_NAME_ATTRIBUTE, message.logStream)]
          : []),
        ...(event.id
          ? [stringAttribute(AWS_LOG_EVENT_ID_ATTRIBUTE, event.id)]
          : []),
      ];

      group.records.push({
        timeUnixNano: toUnixNano(event.timestamp),
        observedTimeUnixNano,
        severityNumber: severity ? severity.number : 0,
        severityText: severity ? severity.text : "",
        body: { stringValue: event.message },
        attributes: attributes as unknown as JSONArray,
      });
      group.facts.events++;
    }
  }

  const resourceLogs: Array<JSONObject> = [];
  const facts: Array<LogGroupFacts> = [];

  for (const group of groups.values()) {
    resourceLogs.push({
      resource: group.resource,
      scopeLogs: [
        {
          scope: { name: FIREHOSE_SCOPE_NAME },
          logRecords: group.records as unknown as JSONArray,
        },
      ] as unknown as JSONArray,
    });
    facts.push(group.facts);
  }

  return { resourceLogs, facts };
}
