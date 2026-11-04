import zlib from "zlib";
import { promisify } from "util";
import {
  CloudLogGroupResource,
  getAwsLogGroupResource,
} from "Common/Types/Cloud/CloudLogGroups";
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
 * log of, that resource's id too (cloud.resource_id, CloudLogGroups). Each
 * event is one log record: its time, its message as the body, its stream
 * and id as attributes, and the severity its message says when it says one
 * the way Lambda writes it (inferCloudWatchLogSeverity).
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
 * The severity a message says the way Lambda's runtimes and loggers write
 * it - or null. Only the start of a message is read:
 *
 *   - a JSON message's "level" (Lambda's JSON log format, most loggers);
 *   - Node.js: "<time>\t<request id>\tERROR\t<message>";
 *   - Python: "[ERROR]\t<time>\t<request id>\t<message>";
 *   - a first word that is a level: "ERROR ...", "WARN: ...".
 */
const SEVERITIES: ReadonlyMap<string, { number: number; text: string }> =
  new Map<string, { number: number; text: string }>([
    ["trace", { number: 1, text: "TRACE" }],
    ["debug", { number: 5, text: "DEBUG" }],
    ["info", { number: 9, text: "INFO" }],
    ["notice", { number: 10, text: "INFO" }],
    ["warn", { number: 13, text: "WARN" }],
    ["warning", { number: 13, text: "WARN" }],
    ["error", { number: 17, text: "ERROR" }],
    ["err", { number: 17, text: "ERROR" }],
    ["fatal", { number: 21, text: "FATAL" }],
    ["critical", { number: 21, text: "FATAL" }],
  ]);

// The longest JSON message whose level is read: a longer one is not parsed.
const MAX_JSON_MESSAGE_FOR_LEVEL: number = 64 * 1024;
const HEAD_LENGTH: number = 200;

function severityOfWord(
  word: string,
): { number: number; text: string } | null {
  let text: string = word.trim();

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  if (text.endsWith(":")) {
    text = text.slice(0, -1);
  }

  return SEVERITIES.get(text.toLowerCase()) || null;
}

export function inferCloudWatchLogSeverity(
  message: string,
): { number: number; text: string } | null {
  const trimmed: string = message.trimStart();

  if (
    trimmed.startsWith("{") &&
    trimmed.length <= MAX_JSON_MESSAGE_FOR_LEVEL
  ) {
    try {
      const document: JSONObject = readObject(JSON.parse(trimmed));

      for (const key of ["level", "severity", "levelname", "log.level"]) {
        const value: unknown = document[key];

        if (typeof value === "string") {
          const severity: { number: number; text: string } | null =
            severityOfWord(value);

          if (severity) {
            return severity;
          }
        }
      }
    } catch {
      // Not JSON after all: read as text below.
    }
  }

  const head: string = trimmed.slice(0, HEAD_LENGTH);
  const fields: Array<string> = head.split("\t");

  // Python: "[LEVEL]\t...".
  if (fields.length > 1) {
    const first: { number: number; text: string } | null = severityOfWord(
      fields[0]!,
    );

    if (first && fields[0]!.trim().startsWith("[")) {
      return first;
    }

    // Node.js: "<time>\t<request id>\t<LEVEL>\t...".
    if (fields.length > 3) {
      const third: { number: number; text: string } | null = severityOfWord(
        fields[2]!,
      );

      if (third) {
        return third;
      }
    }
  }

  const space: number = head.indexOf(" ");
  const firstWord: string = space > 0 ? head.slice(0, space) : head;

  if (firstWord.length <= 10) {
    return severityOfWord(firstWord);
  }

  return null;
}

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
      const filed: CloudLogGroupResource | null = getAwsLogGroupResource({
        logGroup: message.logGroup,
        accountId: message.owner,
        region: data.region,
      });

      const attributes: Array<OtlpAttribute> = [
        stringAttribute("service.name", data.serviceName),
        stringAttribute("cloud.provider", "aws"),
        stringAttribute("oneuptime.cloud.connection.id", data.connectionId),
        ...(message.owner
          ? [stringAttribute("cloud.account.id", message.owner)]
          : []),
        ...(data.region ? [stringAttribute("cloud.region", data.region)] : []),
        ...(message.logGroup
          ? [stringAttribute(AWS_LOG_GROUP_NAME_ATTRIBUTE, message.logGroup)]
          : []),
        ...Object.keys(filed?.attributes || {}).map(
          (attributeKey: string): OtlpAttribute => {
            return stringAttribute(
              attributeKey,
              filed!.attributes[attributeKey]!,
            );
          },
        ),
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
      const severity: { number: number; text: string } | null =
        inferCloudWatchLogSeverity(event.message);
      const attributes: Array<OtlpAttribute> = [
        ...(message.logStream
          ? [stringAttribute(AWS_LOG_STREAM_NAME_ATTRIBUTE, message.logStream)]
          : []),
        ...(event.id ? [stringAttribute(AWS_LOG_EVENT_ID_ATTRIBUTE, event.id)] : []),
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
