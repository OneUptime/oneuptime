import EventLoop from "Common/Server/Utils/EventLoop";
import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import { JSONObject } from "Common/Types/JSON";
import {
  CLOUDWATCH_LOGS_DATA_MESSAGE,
  CloudWatchLogsMessage,
  DecodeBudget,
  LogGroupFacts,
  buildResourceLogs,
  isGzip,
  readCloudWatchLogsMessage,
  readConcatenatedJson,
  readRecordText,
} from "./CloudWatchLogs";
import {
  MetricResourceFacts,
  decodeJsonMetricRecord,
  decodeOpenTelemetryMetricRecord,
  readMetricResourceFacts,
  stampConnection,
} from "./CloudWatchMetricStream";

/*
 * WHAT ONE FIREHOSE DELIVERY CARRIES.
 *
 * Each record is read for what it is, whichever of the two endpoints it
 * came to - so a stream pointed at the wrong one still lands - in the order
 * that tells them apart:
 *
 *   1. a CloudWatch Logs subscription delivery: gzip, or the JSON document
 *      Firehose decompressed (messageType DATA_MESSAGE or CONTROL_MESSAGE);
 *   2. a metric stream's JSON format: one metric update a line;
 *   3. a metric stream's OpenTelemetry 1.0 format: length-delimited
 *      protobuf. Its first byte is a length, which can be "{", so it is
 *      tried when the record is no JSON either.
 *
 * A record that is none of them, or that breaks off, is counted and left
 * out: the rest of the delivery is taken, since Firehose would only send
 * the same record again. A delivery that decompresses to more than its
 * budget is refused whole (RangeError).
 */

// Records read between two yields to the event loop.
const RECORDS_PER_YIELD: number = 50;

export interface DeliverySightings {
  // "account|region": the namespaces its metrics carried.
  metrics: Map<
    string,
    { accountId: string; region: string; namespaces: Set<string> }
  >;
  // "account|region": the log groups its logs came from.
  logs: Map<
    string,
    { accountId: string; region: string; logGroups: Set<string> }
  >;
}

// One OTLP resource of the delivery, and how many datapoints or records it holds.
export interface DeliveredResource {
  resource: JSONObject;
  count: number;
}

export interface DecodedDelivery {
  resourceMetrics: Array<DeliveredResource>;
  resourceLogs: Array<DeliveredResource>;
  datapoints: number;
  logEvents: number;
  // CloudWatch Logs checking the destination: no event in them.
  controlMessages: number;
  // Records that were none of the formats, or broke off.
  unrecognized: number;
  sightings: DeliverySightings;
}

/*
 * The Region of the Firehose stream that sent a delivery, from its ARN
 * (arn:aws:firehose:<region>:<account>:deliverystream/<name>), or "".
 */
export function readRegionFromSourceArn(value: unknown): string {
  const arn: string = Array.isArray(value)
    ? String(value[0] ?? "")
    : typeof value === "string"
      ? value
      : "";

  if (arn.length > 2048) {
    return "";
  }

  const parts: Array<string> = arn.trim().split(":");

  if (parts.length < 6 || parts[0] !== "arn" || parts[2] !== "firehose") {
    return "";
  }

  const region: string = parts[3]!.toLowerCase();

  return isAwsRegion(region) ? region : "";
}

function startsWithBrace(data: Buffer): boolean {
  for (let index: number = 0; index < data.length && index < 64; index++) {
    const byte: number = data[index]!;

    // Whitespace before a JSON document.
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) {
      continue;
    }

    return byte === 0x7b;
  }

  return false;
}

type RecordReading =
  | { kind: "logs"; messages: Array<CloudWatchLogsMessage> }
  | { kind: "metrics"; resourceMetrics: Array<JSONObject> }
  | { kind: "unrecognized" };

function readJsonText(text: string): RecordReading | null {
  const messages: Array<CloudWatchLogsMessage> = [];

  for (const document of readConcatenatedJson(text)) {
    const message: CloudWatchLogsMessage | null =
      readCloudWatchLogsMessage(document);

    if (message) {
      messages.push(message);
    }
  }

  if (messages.length > 0) {
    return { kind: "logs", messages };
  }

  const resourceMetrics: Array<JSONObject> = decodeJsonMetricRecord(text);

  return resourceMetrics.length > 0
    ? { kind: "metrics", resourceMetrics }
    : null;
}

async function readRecord(
  base64: string,
  budget: DecodeBudget,
): Promise<RecordReading> {
  const data: Buffer = Buffer.from(base64, "base64");

  if (data.length === 0) {
    return { kind: "unrecognized" };
  }

  if (isGzip(data)) {
    let text: string | null = null;

    try {
      text = await readRecordText(data, budget);
    } catch (error) {
      if (error instanceof RangeError || isTooLarge(error)) {
        throw new RangeError("The delivery decompresses to more than it may.");
      }
    }

    const reading: RecordReading | null =
      text === null ? null : readJsonText(text);

    if (reading) {
      return reading;
    }
  } else if (startsWithBrace(data)) {
    const reading: RecordReading | null = readJsonText(
      await readRecordText(data, budget),
    );

    if (reading) {
      return reading;
    }
  } else {
    budget.bytesLeft -= data.length;

    if (budget.bytesLeft < 0) {
      throw new RangeError("The delivery decompresses to more than it may.");
    }
  }

  try {
    const resourceMetrics: Array<JSONObject> =
      decodeOpenTelemetryMetricRecord(data);

    return resourceMetrics.length > 0
      ? { kind: "metrics", resourceMetrics }
      : { kind: "unrecognized" };
  } catch {
    return { kind: "unrecognized" };
  }
}

function isTooLarge(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

export async function decodeFirehoseRecords(data: {
  records: Array<string>;
  serviceName: string;
  connectionId: string;
  // The Region of the stream that sent them: a log subscription's.
  region: string;
  now: Date;
  budget: DecodeBudget;
}): Promise<DecodedDelivery> {
  const delivery: DecodedDelivery = {
    resourceMetrics: [],
    resourceLogs: [],
    datapoints: 0,
    logEvents: 0,
    controlMessages: 0,
    unrecognized: 0,
    sightings: { metrics: new Map(), logs: new Map() },
  };
  const messages: Array<CloudWatchLogsMessage> = [];

  for (let index: number = 0; index < data.records.length; index++) {
    if (index > 0 && index % RECORDS_PER_YIELD === 0) {
      await EventLoop.yieldToEventLoop();
    }

    const reading: RecordReading = await readRecord(
      data.records[index]!,
      data.budget,
    );

    if (reading.kind === "unrecognized") {
      delivery.unrecognized++;
      continue;
    }

    if (reading.kind === "logs") {
      for (const message of reading.messages) {
        // CloudWatch Logs checking the stream is there: one event, no log line.
        if (
          message.messageType !== CLOUDWATCH_LOGS_DATA_MESSAGE ||
          message.logEvents.length === 0
        ) {
          delivery.controlMessages++;
          continue;
        }

        messages.push(message);
      }

      continue;
    }

    for (const resourceMetrics of reading.resourceMetrics) {
      const stamped: JSONObject = stampConnection({
        resourceMetrics,
        serviceName: data.serviceName,
        connectionId: data.connectionId,
      });
      const facts: MetricResourceFacts = readMetricResourceFacts(stamped);

      if (facts.datapoints === 0) {
        continue;
      }

      delivery.resourceMetrics.push({
        resource: stamped,
        count: facts.datapoints,
      });
      delivery.datapoints += facts.datapoints;

      if (facts.accountId) {
        const key: string = `${facts.accountId}|${facts.region}`;
        const sighting:
          | { accountId: string; region: string; namespaces: Set<string> }
          | undefined = delivery.sightings.metrics.get(key) || {
          accountId: facts.accountId,
          region: facts.region,
          namespaces: new Set<string>(),
        };

        for (const namespace of facts.namespaces) {
          sighting.namespaces.add(namespace);
        }

        delivery.sightings.metrics.set(key, sighting);
      }
    }
  }

  if (messages.length > 0) {
    const built: {
      resourceLogs: Array<JSONObject>;
      facts: Array<LogGroupFacts>;
    } = buildResourceLogs({
      messages,
      region: data.region,
      serviceName: data.serviceName,
      connectionId: data.connectionId,
      observedAtMs: data.now.getTime(),
    });

    built.facts.forEach((facts: LogGroupFacts, index: number): void => {
      delivery.resourceLogs.push({
        resource: built.resourceLogs[index]!,
        count: facts.events,
      });
    });

    for (const facts of built.facts) {
      delivery.logEvents += facts.events;

      if (!facts.accountId) {
        continue;
      }

      const key: string = `${facts.accountId}|${facts.region}`;
      const sighting:
        | { accountId: string; region: string; logGroups: Set<string> }
        | undefined = delivery.sightings.logs.get(key) || {
        accountId: facts.accountId,
        region: facts.region,
        logGroups: new Set<string>(),
      };

      if (facts.logGroup) {
        sighting.logGroups.add(facts.logGroup);
      }

      delivery.sightings.logs.set(key, sighting);
    }
  }

  return delivery;
}
