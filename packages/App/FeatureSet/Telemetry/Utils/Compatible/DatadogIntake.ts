import protobuf from "protobufjs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import OtlpJson, {
  OTLP_SEVERITY_DEBUG,
  OTLP_SEVERITY_ERROR,
  OTLP_SEVERITY_ERROR2,
  OTLP_SEVERITY_ERROR3,
  OTLP_SEVERITY_FATAL,
  OTLP_SEVERITY_INFO,
  OTLP_SEVERITY_INFO2,
  OTLP_SEVERITY_TRACE,
  OTLP_SEVERITY_UNSPECIFIED,
  OTLP_SEVERITY_WARN,
  OtlpKeyValue,
  OtlpSeverity,
} from "./OtlpJson";

/*
 * THE DATADOG AGENT'S INTAKE, AS OPENTELEMETRY LOGS AND METRICS.
 *
 * A team leaving Datadog points the Agents it already runs - and the
 * Datadog log libraries and API clients it already uses - at OneUptime.
 * Each intake payload becomes an OTLP export request in OTLP's JSON
 * encoding, queued exactly like an OTLP/HTTP export, so drop filters,
 * scrub rules, pipelines, services, retention and billing apply to it:
 *
 *   /api/v2/logs        JSON logs                     -> logs
 *   /api/v1/series      JSON series                   -> metrics
 *   /api/v2/series      JSON or protobuf series       -> metrics
 *   /api/beta/sketches  protobuf distributions        -> summaries
 *   /api/v1/check_run   JSON service checks           -> gauges
 *
 * Nothing here reads a request: the body arrives authenticated, read and
 * decompressed, and leaves as OTLP JSON.
 *
 * TAGS AND RESOURCES
 *
 * A tag "key:value" is the attribute key = value, split at the first
 * colon (so "url:http://a/b" keeps its URL). Tags with no key are kept
 * together, comma-joined, as datadog.tags; a key tagged twice keeps both
 * values, comma-joined (kube_service:a, kube_service:b). Datadog's
 * reserved tags also name the resource - service is service.name, env
 * deployment.environment.name, version service.version and host
 * host.name - and stay attributes as well, so a filter written against
 * Datadog's tags still matches. A series', check's or log's own host and
 * service win over its tags, and the x-oneuptime-service-name header
 * (options.serviceName) over both. Points and logs are grouped into one
 * resource per service, host, environment and version, under the scope
 * "datadog". Where two sources name the same attribute, the first wins:
 * the payload's own fields, then a log's other fields, then the tags.
 *
 * WHAT A SERIES BECOMES
 *
 * A gauge, and a series with no type, is an OTLP gauge. A count is a
 * delta sum that is not monotonic - a DogStatsD count can be decremented
 * below zero - starting one interval before its timestamp. A rate is
 * already per second (it is how the Agent sends a DogStatsD counter), so
 * it is a gauge too, marked datadog.metric.type = rate. Names and units
 * are kept as they are; every value is written as a double.
 *
 * A distribution arrives as DDSketches. Each becomes a summary point with
 * the sketch's exact count and sum, and its minimum and maximum as
 * quantiles 0 and 1. Its other quantiles are in the sketch's bins (k, n),
 * which are not read here. A service check becomes a gauge point named
 * after the check, valued at its status (0 OK, 1 WARNING, 2 CRITICAL,
 * 3 UNKNOWN).
 *
 * WHAT A LOG BECOMES
 *
 * Its message is the body, its status the severity (Datadog's words and
 * prefix rules, or a syslog number 0-7), its timestamp the time; its
 * hostname and service name its resource, its ddsource is datadog.source,
 * its ddtags are tags, and its dd.trace_id / dd.span_id - decimal, as
 * Datadog's tracers write them - its trace context. Each is looked for
 * under the names Datadog's own log preprocessing reads (msg and log for
 * the message, severity and level for the status, @timestamp and date for
 * the time, ...), flat ("dd.trace_id") or nested ({"dd": {"trace_id"}}).
 * Every other field is an attribute, and so is a field that was looked at
 * but could not be read - a status that is no level, a date that is no
 * date - rather than being lost.
 *
 * TIMES
 *
 * Datadog sends seconds since the epoch for metrics and milliseconds for
 * logs. A number of up to 11 digits is read as seconds, then up to 14 as
 * milliseconds, 17 as microseconds and 19 as nanoseconds, so a time sent
 * in the wrong unit still lands on the right day rather than centuries
 * away. Logs may also say an ISO 8601 / RFC 3339 time (UTC when it names
 * no zone). Anything that names no time is now.
 *
 * WHAT IS DROPPED
 *
 * A point whose value is null, NaN or infinite (OTLP JSON cannot carry
 * one) or whose time is no time; a series with no name; a check run with
 * no name or an unknown status; the logs of a request past the first
 * MAX_DATADOG_LOGS_PER_REQUEST. Each translation counts what it dropped.
 * A series' source_type_name and origin metadata are not kept.
 */

// The most logs one request is translated into; the rest are dropped.
export const MAX_DATADOG_LOGS_PER_REQUEST: number = 10_000;

export class DatadogIntakeError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "DatadogIntakeError";
    this.statusCode = statusCode;
  }
}

export interface DatadogTranslateOptions {
  /*
   * Now, in milliseconds since the epoch: every log's observed time, and
   * the time of a log or point that names none. Date.now() when absent.
   */
  nowInMs?: number | undefined;
  /*
   * The x-oneuptime-service-name header: when set, the service
   * (service.name) of everything translated, whatever its tags say.
   */
  serviceName?: string | undefined;
}

/*
 * The query parameters Datadog's log intake applies to every log in the
 * body (Datadog's winston and bunyan set-ups post to
 * /api/v2/logs?ddsource=nodejs&service=checkout). A log's own field wins
 * over each; ddtags are added to a log's own.
 */
export interface DatadogLogQuery {
  ddsource?: string | undefined;
  ddtags?: string | undefined;
  service?: string | undefined;
  hostname?: string | undefined;
}

export interface DatadogLogsOptions extends DatadogTranslateOptions {
  query?: DatadogLogQuery | undefined;
}

export interface DatadogLogsTranslation {
  // An ExportLogsServiceRequest, or null when no log was kept.
  logs: JSONObject | null;
  // Logs translated.
  count: number;
  /*
   * Entries that were no log (not a JSON object; an NDJSON line that is
   * not JSON) and logs past MAX_DATADOG_LOGS_PER_REQUEST.
   */
  droppedCount: number;
}

export interface DatadogMetricsTranslation {
  // An ExportMetricsServiceRequest, or null when no point was kept.
  metrics: JSONObject | null;
  pointCount: number;
  droppedPointCount: number;
}

const PROTO_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "ProtoFiles",
  "Datadog",
  "agent_payload.proto",
);

const AgentPayloadProto: protobuf.Root = protobuf.loadSync(PROTO_PATH);

export const DatadogMetricPayload: protobuf.Type = AgentPayloadProto.lookupType(
  "datadog.agentpayload.MetricPayload",
);
export const DatadogSketchPayload: protobuf.Type = AgentPayloadProto.lookupType(
  "datadog.agentpayload.SketchPayload",
);

/*
 * int64s as numbers (every Datadog timestamp, count and interval fits),
 * enums as their numbers, and proto3's defaults written out: a point the
 * Agent wrote with value 0 has no value on the wire, and is still 0.
 */
const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  longs: Number,
  enums: Number,
  defaults: true,
  arrays: true,
};

const SCOPE_NAME: string = "datadog";

// OTLP's AggregationTemporality.DELTA.
const AGGREGATION_TEMPORALITY_DELTA: number = 1;

const HEX_TRACE_ID_LENGTH: number = 32;
const HEX_SPAN_ID_LENGTH: number = 16;

/*
 * Where a log's reserved attributes are read from: the names Datadog's
 * log preprocessing reads each from, in the order it reads them (the
 * Agent itself sends message, status, timestamp, hostname, service,
 * ddsource and ddtags). "message" may hold any value; msg and log only a
 * string (ECS's "log" is an object of its own).
 */
const MESSAGE_FIELDS: ReadonlyArray<string> = ["message"];
const MESSAGE_ALIAS_FIELDS: ReadonlyArray<string> = ["msg", "log"];
const STATUS_FIELDS: ReadonlyArray<string> = [
  "status",
  "severity",
  "level",
  "syslog.severity",
];
const TIME_FIELDS: ReadonlyArray<string> = [
  "timestamp",
  "@timestamp",
  "date",
  "_timestamp",
  "Timestamp",
  "eventTime",
  "published_date",
  "syslog.timestamp",
];
const HOST_FIELDS: ReadonlyArray<string> = [
  "hostname",
  "host",
  "syslog.hostname",
];
const SERVICE_FIELDS: ReadonlyArray<string> = [
  "service",
  "syslog.appname",
  "dd.service",
];
const SOURCE_FIELDS: ReadonlyArray<string> = ["ddsource", "source"];
const TAG_FIELDS: ReadonlyArray<string> = ["ddtags"];
// Log4j 2's JSON layout keeps the MDC under contextMap.
const DATADOG_TRACE_ID_FIELDS: ReadonlyArray<string> = [
  "dd.trace_id",
  "contextMap.dd.trace_id",
];
const DATADOG_SPAN_ID_FIELDS: ReadonlyArray<string> = [
  "dd.span_id",
  "contextMap.dd.span_id",
];
// OpenTelemetry's log bridges write the trace context in hex.
const OTEL_TRACE_ID_FIELDS: ReadonlyArray<string> = ["trace_id"];
const OTEL_SPAN_ID_FIELDS: ReadonlyArray<string> = ["span_id"];

/*
 * Datadog's status remapper, for a status none of OtlpJson's level words
 * is: the first prefix that matches, case-insensitively. Datadog also
 * reads "trace" and "verbose" as debug; here they keep OpenTelemetry's
 * TRACE, as OtlpJson's words do.
 */
const STATUS_PREFIXES: ReadonlyArray<[prefix: string, severity: OtlpSeverity]> =
  [
    ["emerg", OTLP_SEVERITY_FATAL],
    ["f", OTLP_SEVERITY_FATAL],
    ["a", OTLP_SEVERITY_ERROR3],
    ["c", OTLP_SEVERITY_ERROR2],
    ["err", OTLP_SEVERITY_ERROR],
    ["w", OTLP_SEVERITY_WARN],
    ["n", OTLP_SEVERITY_INFO2],
    ["i", OTLP_SEVERITY_INFO],
    ["trace", OTLP_SEVERITY_TRACE],
    ["verbose", OTLP_SEVERITY_TRACE],
    ["d", OTLP_SEVERITY_DEBUG],
    ["o", OTLP_SEVERITY_INFO],
    ["s", OTLP_SEVERITY_INFO],
  ];

// A service check's status, by its number.
const CHECK_STATUS_NAMES: ReadonlyArray<string> = [
  "ok",
  "warning",
  "critical",
  "unknown",
];

const SYSLOG_SEVERITY_DIGIT: RegExp = /^[0-7]$/;

// Digits, with an optional fraction: no sign, no exponent.
const EPOCH_DIGITS: RegExp = /^(\d+)(?:\.(\d+))?$/;

const LEADING_ZEROS: RegExp = /^0+/;

// A decimal number, as a string; built so no input makes it backtrack.
const NUMBER_TEXT: RegExp = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/*
 * An ISO 8601 / RFC 3339 date and time: a "T" or a space between them,
 * seconds and their fraction optional, then Z, UTC, GMT or an offset
 * (+05:30, +0530, +05) - or no zone at all, which is read as UTC.
 */
const ISO_8601: RegExp =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(?:([Zz]|UTC|GMT)|([+-])(\d{2})(?::?(\d{2}))?)?$/;

enum DatadogMetricType {
  Gauge = "gauge",
  Count = "count",
  Rate = "rate",
}

enum OtlpMetricShape {
  Gauge = "gauge",
  DeltaSum = "sum",
  Summary = "summary",
}

interface ResourceIdentity {
  serviceName: string;
  hostName: string;
  environment: string;
  version: string;
}

interface DatadogTags {
  // Each key's values, in the order first seen, without repeats.
  values: Map<string, Array<string>>;
  // Tags with no key, in the order first seen, without repeats.
  bare: Array<string>;
}

interface DatadogPoint {
  timestamp: unknown;
  value: unknown;
}

// A series from any of the three series payloads, before it is checked.
interface DatadogSeries {
  metric: string;
  type: DatadogMetricType;
  unit: string;
  intervalSeconds: number;
  host: string;
  tags: Array<string>;
  // What the series' own fields say (its device, its other resources).
  attributes: Array<OtlpKeyValue>;
  points: Array<DatadogPoint>;
}

interface MetricAccumulator {
  name: string;
  unit: string;
  shape: OtlpMetricShape;
  dataPoints: Array<JSONObject>;
}

interface MetricsResourceAccumulator {
  attributes: Array<OtlpKeyValue>;
  // By name, shape and unit.
  metrics: Map<string, MetricAccumulator>;
}

interface MetricsAccumulator {
  resources: Map<string, MetricsResourceAccumulator>;
  pointCount: number;
  droppedPointCount: number;
  nowUnixNano: string;
  serviceOverride: string;
}

interface LogsResourceAccumulator {
  attributes: Array<OtlpKeyValue>;
  logRecords: Array<JSONObject>;
}

interface FoundField {
  value: unknown;
  // The keys that lead to it: ["dd.trace_id"], or ["dd", "trace_id"].
  path: Array<string>;
}

export default class DatadogIntake {
  /*
   * A JSON body, for the endpoints that take one (series, check runs).
   * Throws a DatadogIntakeError (400) when it is not JSON.
   */
  public static parseJson(body: Buffer | string): unknown {
    try {
      return JSON.parse(DatadogIntake.bodyText(body));
    } catch {
      throw new DatadogIntakeError(400, "The body is not valid JSON.");
    }
  }

  /*
   * POST /api/v2/logs: a JSON array of logs (what the Agent sends), a
   * single log (what a winston or bunyan transport sends), or NDJSON - one
   * log, or one array of them, a line. Throws a DatadogIntakeError (400)
   * for a body that is none of these; an empty body or array is no logs.
   */
  public static logsToOtlp(
    body: Buffer | string,
    options: DatadogLogsOptions = {},
  ): DatadogLogsTranslation {
    const parsed: { entries: Array<unknown>; unreadable: number } =
      DatadogIntake.parseLogBody(body);
    const nowUnixNano: string = OtlpJson.nowUnixNano(options.nowInMs);

    const resources: Map<string, LogsResourceAccumulator> = new Map();
    let count: number = 0;
    let droppedCount: number = parsed.unreadable;

    for (const entry of parsed.entries) {
      if (
        !DatadogIntake.isRecord(entry) ||
        count >= MAX_DATADOG_LOGS_PER_REQUEST
      ) {
        droppedCount++;
        continue;
      }

      const log: { identity: ResourceIdentity; logRecord: JSONObject } =
        DatadogIntake.toLogRecord(entry, nowUnixNano, options);
      const key: string = DatadogIntake.resourceKey(log.identity);

      let resource: LogsResourceAccumulator | undefined = resources.get(key);

      if (!resource) {
        resource = {
          attributes: DatadogIntake.resourceAttributes(log.identity),
          logRecords: [],
        };
        resources.set(key, resource);
      }

      resource.logRecords.push(log.logRecord);
      count++;
    }

    if (count === 0) {
      return { logs: null, count: 0, droppedCount: droppedCount };
    }

    return {
      logs: {
        resourceLogs: Array.from(resources.values()).map(
          (resource: LogsResourceAccumulator): JSONObject => {
            return {
              resource: { attributes: resource.attributes },
              scopeLogs: [
                {
                  scope: { name: SCOPE_NAME },
                  logRecords: resource.logRecords,
                },
              ],
            } as unknown as JSONObject;
          },
        ),
      } as unknown as JSONObject,
      count: count,
      droppedCount: droppedCount,
    };
  }

  /*
   * POST /api/v1/series: {"series": [{"metric", "points": [[seconds,
   * value]], "type": "gauge" | "rate" | "count", "interval", "host",
   * "device", "tags"}]}. The device is the point's `device` attribute.
   */
  public static seriesV1ToOtlp(
    json: unknown,
    options: DatadogTranslateOptions = {},
  ): DatadogMetricsTranslation {
    const accumulator: MetricsAccumulator = DatadogIntake.newMetrics(options);

    for (const entry of DatadogIntake.seriesEntries(json)) {
      if (!DatadogIntake.isRecord(entry)) {
        continue;
      }

      const device: string = DatadogIntake.readText(entry["device"]);

      DatadogIntake.addSeries(accumulator, {
        metric: DatadogIntake.readText(entry["metric"]),
        type: DatadogIntake.metricTypeOf(entry["type"]),
        unit: "",
        intervalSeconds: DatadogIntake.readInterval(entry["interval"]),
        host: DatadogIntake.readText(entry["host"]),
        tags: DatadogIntake.readTagList(entry["tags"]),
        attributes: device
          ? [{ key: "device", value: { stringValue: device } }]
          : [],
        points: DatadogIntake.readArray(entry["points"]).map(
          (point: unknown): DatadogPoint => {
            return Array.isArray(point)
              ? { timestamp: point[0], value: point[1] }
              : { timestamp: undefined, value: undefined };
          },
        ),
      });
    }

    return DatadogIntake.metricsResult(accumulator);
  }

  /*
   * POST /api/v2/series as JSON: {"series": [{"metric", "type": 0-3 (or
   * its name), "points": [{"timestamp", "value"}], "resources": [{"type",
   * "name"}], "tags", "unit", "interval"}]}. The "host" resource is the
   * host; a "device" resource is the point's `device` attribute, as in
   * v1, and any other is datadog.resource.<type>.
   */
  public static seriesV2ToOtlp(
    json: unknown,
    options: DatadogTranslateOptions = {},
  ): DatadogMetricsTranslation {
    const accumulator: MetricsAccumulator = DatadogIntake.newMetrics(options);

    for (const entry of DatadogIntake.seriesEntries(json)) {
      if (DatadogIntake.isRecord(entry)) {
        DatadogIntake.addSeries(accumulator, DatadogIntake.v2Series(entry));
      }
    }

    return DatadogIntake.metricsResult(accumulator);
  }

  /*
   * POST /api/v2/series as the Agent sends it: a protobuf MetricPayload,
   * read exactly as its JSON twin. Throws a DatadogIntakeError (400) for a
   * body that is not one.
   */
  public static seriesV2ProtobufToOtlp(
    body: Buffer | Uint8Array,
    options: DatadogTranslateOptions = {},
  ): DatadogMetricsTranslation {
    return DatadogIntake.seriesV2ToOtlp(
      DatadogIntake.decode(DatadogMetricPayload, body, "MetricPayload"),
      options,
    );
  }

  /*
   * POST /api/beta/sketches: a protobuf SketchPayload, the Agent's
   * distribution metrics. Each Dogsketch (and each Distribution, the GK
   * sketch older Agents sent) is one summary point: its count, its sum, and
   * its minimum and maximum as quantiles 0 and 1, at its timestamp
   * (seconds). The quantiles in between would be read from the sketch's
   * bins, which this does not do. Throws a DatadogIntakeError (400) for a
   * body that is not a SketchPayload.
   */
  public static sketchesToOtlp(
    body: Buffer | Uint8Array,
    options: DatadogTranslateOptions = {},
  ): DatadogMetricsTranslation {
    const payload: JSONObject = DatadogIntake.decode(
      DatadogSketchPayload,
      body,
      "SketchPayload",
    );
    const accumulator: MetricsAccumulator = DatadogIntake.newMetrics(options);

    for (const sketch of DatadogIntake.readArray(payload["sketches"])) {
      if (!DatadogIntake.isRecord(sketch)) {
        continue;
      }

      const summaries: Array<unknown> = [
        ...DatadogIntake.readArray(sketch["dogsketches"]),
        ...DatadogIntake.readArray(sketch["distributions"]),
      ];
      const metric: string = DatadogIntake.readText(sketch["metric"]);

      if (!metric) {
        accumulator.droppedPointCount += summaries.length;
        continue;
      }

      const tags: DatadogTags = DatadogIntake.parseTags(
        DatadogIntake.readTagList(sketch["tags"]),
      );
      const attributes: Array<OtlpKeyValue> = DatadogIntake.tagAttributes(tags);
      let summary: MetricAccumulator | null = null;

      for (const sketchPoint of summaries) {
        const dataPoint: JSONObject | null = DatadogIntake.summaryDataPoint(
          sketchPoint,
          attributes,
          accumulator.nowUnixNano,
        );

        if (!dataPoint) {
          accumulator.droppedPointCount++;
          continue;
        }

        if (!summary) {
          summary = DatadogIntake.metricFor(
            DatadogIntake.resourceFor(
              accumulator,
              DatadogIntake.metricResource(
                DatadogIntake.readText(sketch["host"]),
                tags,
                accumulator.serviceOverride,
              ),
            ),
            metric,
            "",
            OtlpMetricShape.Summary,
          );
        }

        summary.dataPoints.push(dataPoint);
        accumulator.pointCount++;
      }
    }

    return DatadogIntake.metricsResult(accumulator);
  }

  /*
   * POST /api/v1/check_run: [{"check", "host_name", "timestamp" (seconds),
   * "status" (0-3), "message", "tags"}], or one check run on its own. Each
   * is a gauge point named after the check, valued at its status, with
   * datadog.check.status (ok, warning, critical, unknown) and - when it
   * has one - datadog.check.message.
   */
  public static checkRunsToOtlp(
    json: unknown,
    options: DatadogTranslateOptions = {},
  ): DatadogMetricsTranslation {
    let runs: Array<unknown>;

    if (Array.isArray(json)) {
      runs = json;
    } else if (DatadogIntake.isRecord(json)) {
      runs = [json];
    } else {
      throw new DatadogIntakeError(
        400,
        "The body is not a Datadog check run, nor an array of them.",
      );
    }

    const accumulator: MetricsAccumulator = DatadogIntake.newMetrics(options);

    for (const run of runs) {
      if (!DatadogIntake.isRecord(run)) {
        accumulator.droppedPointCount++;
        continue;
      }

      const check: string = DatadogIntake.readText(run["check"]);
      const status: unknown = run["status"];
      const statusName: string | undefined =
        typeof status === "number" && Number.isInteger(status)
          ? CHECK_STATUS_NAMES[status]
          : undefined;
      const timeUnixNano: string | null = DatadogIntake.pointTime(
        run["timestamp"],
        accumulator.nowUnixNano,
      );

      if (!check || statusName === undefined || timeUnixNano === null) {
        accumulator.droppedPointCount++;
        continue;
      }

      const tags: DatadogTags = DatadogIntake.parseTags(
        DatadogIntake.readTagList(run["tags"]),
      );
      const ownAttributes: Array<OtlpKeyValue> = [
        { key: "datadog.check.status", value: { stringValue: statusName } },
      ];

      OtlpJson.pushAll(
        ownAttributes,
        OtlpJson.stringAttribute(
          "datadog.check.message",
          DatadogIntake.readText(run["message"]),
        ),
      );

      const resource: MetricsResourceAccumulator = DatadogIntake.resourceFor(
        accumulator,
        DatadogIntake.metricResource(
          DatadogIntake.readText(run["host_name"]),
          tags,
          accumulator.serviceOverride,
        ),
      );

      DatadogIntake.metricFor(
        resource,
        check,
        "",
        OtlpMetricShape.Gauge,
      ).dataPoints.push({
        timeUnixNano: timeUnixNano,
        asDouble: status as number,
        attributes: DatadogIntake.mergeAttributes(
          ownAttributes,
          DatadogIntake.tagAttributes(tags),
        ) as unknown as Array<JSONObject>,
      });
      accumulator.pointCount++;
    }

    return DatadogIntake.metricsResult(accumulator);
  }

  // LOGS

  /*
   * The entries of a log body. A body that is one JSON document must be an
   * array or an object; otherwise each line is read on its own, and lines
   * that are not JSON are counted as unreadable - unless no line is JSON,
   * which makes the body unreadable.
   */
  private static parseLogBody(body: Buffer | string): {
    entries: Array<unknown>;
    unreadable: number;
  } {
    const text: string = DatadogIntake.bodyText(body);

    if (!text.trim()) {
      return { entries: [], unreadable: 0 };
    }

    let parsedBody: unknown = undefined;
    let isOneDocument: boolean = false;

    try {
      parsedBody = JSON.parse(text);
      isOneDocument = true;
    } catch {
      isOneDocument = false;
    }

    if (isOneDocument) {
      if (Array.isArray(parsedBody)) {
        return { entries: parsedBody, unreadable: 0 };
      }

      if (DatadogIntake.isRecord(parsedBody)) {
        return { entries: [parsedBody], unreadable: 0 };
      }

      throw new DatadogIntakeError(
        400,
        "The body is JSON, but neither a log nor an array of logs.",
      );
    }

    const entries: Array<unknown> = [];
    let unreadable: number = 0;
    let readable: number = 0;

    for (const rawLine of text.split("\n")) {
      const line: string = rawLine.trim();

      if (!line) {
        continue;
      }

      let parsedLine: unknown = undefined;

      try {
        parsedLine = JSON.parse(line);
      } catch {
        unreadable++;
        continue;
      }

      if (Array.isArray(parsedLine)) {
        readable++;

        // One at a time: spreading a long array into push() overflows the stack.
        for (const entry of parsedLine) {
          entries.push(entry);
        }
      } else if (DatadogIntake.isRecord(parsedLine)) {
        readable++;
        entries.push(parsedLine);
      } else {
        unreadable++;
      }
    }

    if (readable === 0) {
      throw new DatadogIntakeError(
        400,
        "The body is not a JSON log, an array of logs, or NDJSON.",
      );
    }

    return { entries: entries, unreadable: unreadable };
  }

  private static toLogRecord(
    record: JSONObject,
    nowUnixNano: string,
    options: DatadogLogsOptions,
  ): { identity: ResourceIdentity; logRecord: JSONObject } {
    // The fields read below, left out of the attributes.
    const used: Array<Array<string>> = [];
    const query: DatadogLogQuery = options.query || {};
    const serviceOverride: string = DatadogIntake.trimmed(options.serviceName);

    const message: string | null =
      DatadogIntake.takeField(
        record,
        MESSAGE_FIELDS,
        DatadogIntake.readMessage,
        used,
      ) ??
      DatadogIntake.takeField(
        record,
        MESSAGE_ALIAS_FIELDS,
        DatadogIntake.readString,
        used,
      );

    const severity: OtlpSeverity =
      DatadogIntake.takeField(
        record,
        STATUS_FIELDS,
        DatadogIntake.severityOf,
        used,
      ) || OTLP_SEVERITY_UNSPECIFIED;

    const timeUnixNano: string | null = DatadogIntake.takeField(
      record,
      TIME_FIELDS,
      DatadogIntake.timeOf,
      used,
    );

    const host: string | null = DatadogIntake.takeField(
      record,
      HOST_FIELDS,
      DatadogIntake.readName,
      used,
    );

    /*
     * With the service named by the header, the log's own service is not
     * read, so it stays an attribute.
     */
    const service: string | null = serviceOverride
      ? null
      : DatadogIntake.takeField(
          record,
          SERVICE_FIELDS,
          DatadogIntake.readName,
          used,
        );

    const source: string | null = DatadogIntake.takeField(
      record,
      SOURCE_FIELDS,
      DatadogIntake.readName,
      used,
    );

    const recordTags: Array<string> | null = DatadogIntake.takeField(
      record,
      TAG_FIELDS,
      DatadogIntake.readTags,
      used,
    );

    const traceId: string | null =
      DatadogIntake.takeField(
        record,
        DATADOG_TRACE_ID_FIELDS,
        DatadogIntake.datadogTraceId,
        used,
      ) ??
      DatadogIntake.takeField(
        record,
        OTEL_TRACE_ID_FIELDS,
        DatadogIntake.otelTraceId,
        used,
      );

    const spanId: string | null =
      DatadogIntake.takeField(
        record,
        DATADOG_SPAN_ID_FIELDS,
        DatadogIntake.datadogSpanId,
        used,
      ) ??
      DatadogIntake.takeField(
        record,
        OTEL_SPAN_ID_FIELDS,
        DatadogIntake.otelSpanId,
        used,
      );

    const tags: DatadogTags = DatadogIntake.parseTags([
      ...(recordTags || []),
      ...DatadogIntake.readTagList(query.ddtags),
    ]);

    const identity: ResourceIdentity = {
      serviceName:
        serviceOverride ||
        service ||
        DatadogIntake.trimmed(query.service) ||
        DatadogIntake.firstTagValue(tags, "service"),
      hostName:
        host ||
        DatadogIntake.trimmed(query.hostname) ||
        DatadogIntake.firstTagValue(tags, "host"),
      environment: DatadogIntake.firstTagValue(tags, "env"),
      version: DatadogIntake.firstTagValue(tags, "version"),
    };

    const ownAttributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      ownAttributes,
      OtlpJson.stringAttribute(
        "datadog.source",
        source || DatadogIntake.trimmed(query.ddsource),
      ),
    );

    const attributes: Array<OtlpKeyValue> = DatadogIntake.mergeAttributes(
      ownAttributes,
      OtlpJson.attributesFromObject(DatadogIntake.withoutFields(record, used)),
      DatadogIntake.tagAttributes(tags),
    );

    const logRecord: JSONObject = {
      timeUnixNano: timeUnixNano ?? nowUnixNano,
      observedTimeUnixNano: nowUnixNano,
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: message ?? "" },
      attributes: attributes as unknown as Array<JSONObject>,
    };

    if (traceId) {
      logRecord["traceId"] = traceId;
    }

    if (spanId) {
      logRecord["spanId"] = spanId;
    }

    return { identity: identity, logRecord: logRecord };
  }

  /*
   * The first of `names` that the record has and `read` can read; its
   * path is added to `used`. A field `read` cannot read is passed over,
   * and so stays an attribute.
   */
  private static takeField<T>(
    record: JSONObject,
    names: ReadonlyArray<string>,
    read: (value: unknown) => T | null,
    used: Array<Array<string>>,
  ): T | null {
    for (const name of names) {
      const field: FoundField | null = DatadogIntake.findPath(
        record,
        name.split("."),
        0,
      );

      if (!field) {
        continue;
      }

      const value: T | null = read(field.value);

      if (value !== null) {
        used.push(field.path);
        return value;
      }
    }

    return null;
  }

  /*
   * A dotted name in a record, flat or nested in any mix: "dd.trace_id"
   * is record["dd.trace_id"] or record["dd"]["trace_id"]. Null when it is
   * absent or null.
   */
  private static findPath(
    object: JSONObject,
    parts: Array<string>,
    start: number,
  ): FoundField | null {
    for (let end: number = parts.length; end > start; end--) {
      const key: string = parts.slice(start, end).join(".");

      if (!Object.prototype.hasOwnProperty.call(object, key)) {
        continue;
      }

      const value: unknown = object[key];

      if (end === parts.length) {
        if (value !== null && value !== undefined) {
          return { value: value, path: [key] };
        }

        continue;
      }

      if (DatadogIntake.isRecord(value)) {
        const nested: FoundField | null = DatadogIntake.findPath(
          value,
          parts,
          end,
        );

        if (nested) {
          return { value: nested.value, path: [key, ...nested.path] };
        }
      }
    }

    return null;
  }

  /*
   * The record without the fields at `paths`, copying only the objects on
   * the way to each; an object a removal empties goes too. The record
   * itself is never changed.
   */
  private static withoutFields(
    record: JSONObject,
    paths: Array<Array<string>>,
  ): JSONObject {
    if (paths.length === 0) {
      return record;
    }

    const copy: JSONObject = { ...record };

    for (const fieldPath of paths) {
      DatadogIntake.removePath(copy, fieldPath, 0);
    }

    return copy;
  }

  private static removePath(
    object: JSONObject,
    fieldPath: Array<string>,
    index: number,
  ): void {
    const key: string | undefined = fieldPath[index];

    if (key === undefined) {
      return;
    }

    if (index === fieldPath.length - 1) {
      delete object[key];
      return;
    }

    const child: unknown = object[key];

    if (!DatadogIntake.isRecord(child)) {
      return;
    }

    const childCopy: JSONObject = { ...child };

    DatadogIntake.removePath(childCopy, fieldPath, index + 1);

    if (Object.keys(childCopy).length === 0) {
      delete object[key];
    } else {
      object[key] = childCopy;
    }
  }

  // A message as the body: a string as it is, anything else as its JSON.
  private static readMessage(value: unknown): string | null {
    if (typeof value === "string") {
      return value;
    }

    try {
      const json: string | undefined = JSON.stringify(value);
      return typeof json === "string" ? json : null;
    } catch {
      return null;
    }
  }

  private static readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  // A host, service or source: a string with something in it.
  private static readName(value: unknown): string | null {
    const text: string = DatadogIntake.readText(value);
    return text ? text : null;
  }

  // ddtags: "env:prod,team:checkout", or an array of tags.
  private static readTags(value: unknown): Array<string> | null {
    return typeof value === "string" || Array.isArray(value)
      ? DatadogIntake.readTagList(value)
      : null;
  }

  /*
   * A status as a severity: a syslog number (0 emergency .. 7 debug), one
   * of OtlpJson's level words (Datadog's emergency, alert, critical,
   * error, warning, notice, info, debug, ok and success among them), or -
   * as Datadog's status remapper reads anything else - by its first
   * letters. Null for anything else.
   */
  private static severityOf(value: unknown): OtlpSeverity | null {
    if (typeof value === "number") {
      const severity: OtlpSeverity = OtlpJson.severityFromSyslogNumber(value);
      return severity.number > 0 ? severity : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const word: string = value.trim().toLowerCase();

    if (!word) {
      return null;
    }

    if (SYSLOG_SEVERITY_DIGIT.test(word)) {
      return OtlpJson.severityFromSyslogNumber(Number(word));
    }

    const severity: OtlpSeverity = OtlpJson.severityFromWord(word);

    if (severity.number > 0) {
      return severity;
    }

    for (const [prefix, prefixSeverity] of STATUS_PREFIXES) {
      if (word.startsWith(prefix)) {
        return prefixSeverity;
      }
    }

    return null;
  }

  // A log's time: an epoch number (see TIMES above) or an ISO 8601 string.
  private static timeOf(value: unknown): string | null {
    if (typeof value === "number") {
      return DatadogIntake.epochToUnixNano(value);
    }

    if (typeof value !== "string") {
      return null;
    }

    const text: string = value.trim();

    return EPOCH_DIGITS.test(text)
      ? DatadogIntake.epochToUnixNano(text)
      : DatadogIntake.isoToUnixNano(text);
  }

  /*
   * dd.trace_id: the low 64 bits of the trace ID in decimal, as Datadog's
   * tracers inject it (padded to OTLP's 128 bits), or all 128 in hex, as
   * they do with 128-bit trace ID logging on.
   */
  private static datadogTraceId(value: unknown): string | null {
    const decimal: string = OtlpJson.decimalIdToHex(value);

    if (decimal) {
      return decimal.padStart(HEX_TRACE_ID_LENGTH, "0");
    }

    if (
      typeof value === "string" &&
      value.trim().length === HEX_TRACE_ID_LENGTH
    ) {
      return OtlpJson.hexId(value, HEX_TRACE_ID_LENGTH) || null;
    }

    return null;
  }

  private static datadogSpanId(value: unknown): string | null {
    const decimal: string = OtlpJson.decimalIdToHex(value);

    if (decimal) {
      return decimal;
    }

    if (
      typeof value === "string" &&
      value.trim().length === HEX_SPAN_ID_LENGTH
    ) {
      return OtlpJson.hexId(value, HEX_SPAN_ID_LENGTH) || null;
    }

    return null;
  }

  private static otelTraceId(value: unknown): string | null {
    return OtlpJson.hexId(value, HEX_TRACE_ID_LENGTH) || null;
  }

  private static otelSpanId(value: unknown): string | null {
    return OtlpJson.hexId(value, HEX_SPAN_ID_LENGTH) || null;
  }

  // SERIES

  private static seriesEntries(json: unknown): Array<unknown> {
    if (Array.isArray(json)) {
      return json;
    }

    if (DatadogIntake.isRecord(json) && Array.isArray(json["series"])) {
      return json["series"] as Array<unknown>;
    }

    throw new DatadogIntakeError(
      400,
      'The body is not a Datadog series payload ({"series": [...]}).',
    );
  }

  private static v2Series(entry: JSONObject): DatadogSeries {
    let host: string = "";
    const attributes: Array<OtlpKeyValue> = [];

    for (const resource of DatadogIntake.readArray(entry["resources"])) {
      if (!DatadogIntake.isRecord(resource)) {
        continue;
      }

      const type: string = DatadogIntake.readText(resource["type"]);
      const name: string = DatadogIntake.readText(resource["name"]);

      if (!type || !name) {
        continue;
      }

      if (type.toLowerCase() === "host") {
        host = host || name;
        continue;
      }

      attributes.push({
        key:
          type.toLowerCase() === "device"
            ? "device"
            : `datadog.resource.${type}`,
        value: { stringValue: name },
      });
    }

    return {
      metric: DatadogIntake.readText(entry["metric"]),
      type: DatadogIntake.metricTypeOf(entry["type"]),
      unit: DatadogIntake.readText(entry["unit"]),
      intervalSeconds: DatadogIntake.readInterval(entry["interval"]),
      host: host,
      tags: DatadogIntake.readTagList(entry["tags"]),
      attributes: DatadogIntake.mergeAttributes(attributes),
      points: DatadogIntake.readArray(entry["points"]).map(
        (point: unknown): DatadogPoint => {
          return DatadogIntake.isRecord(point)
            ? { timestamp: point["timestamp"], value: point["value"] }
            : { timestamp: undefined, value: undefined };
        },
      ),
    };
  }

  /*
   * A series' type: gauge, count or rate, by name (v1, and v2 JSON that
   * names it) or by MetricPayload's number (1 count, 2 rate, 3 gauge).
   * Unspecified, absent or unknown is a gauge.
   */
  private static metricTypeOf(value: unknown): DatadogMetricType {
    let type: string = "";

    if (typeof value === "number") {
      type = String(value);
    } else if (typeof value === "string") {
      type = value.trim().toLowerCase();
    }

    if (type === "count" || type === "1") {
      return DatadogMetricType.Count;
    }

    if (type === "rate" || type === "2") {
      return DatadogMetricType.Rate;
    }

    return DatadogMetricType.Gauge;
  }

  private static addSeries(
    accumulator: MetricsAccumulator,
    series: DatadogSeries,
  ): void {
    if (!series.metric) {
      accumulator.droppedPointCount += series.points.length;
      return;
    }

    const tags: DatadogTags = DatadogIntake.parseTags(series.tags);
    const ownAttributes: Array<OtlpKeyValue> = [...series.attributes];

    if (series.type === DatadogMetricType.Rate) {
      ownAttributes.push({
        key: "datadog.metric.type",
        value: { stringValue: DatadogMetricType.Rate },
      });
    }

    // One list for every point of the series: they share their attributes.
    const attributes: Array<JSONObject> = DatadogIntake.mergeAttributes(
      ownAttributes,
      DatadogIntake.tagAttributes(tags),
    ) as unknown as Array<JSONObject>;
    const shape: OtlpMetricShape =
      series.type === DatadogMetricType.Count
        ? OtlpMetricShape.DeltaSum
        : OtlpMetricShape.Gauge;

    // Found on the first point kept, so a series with none adds nothing.
    let metric: MetricAccumulator | null = null;

    for (const point of series.points) {
      const timeUnixNano: string | null = DatadogIntake.pointTime(
        point.timestamp,
        accumulator.nowUnixNano,
      );
      const value: number | null = DatadogIntake.pointValue(point.value);

      if (timeUnixNano === null || value === null) {
        accumulator.droppedPointCount++;
        continue;
      }

      if (!metric) {
        metric = DatadogIntake.metricFor(
          DatadogIntake.resourceFor(
            accumulator,
            DatadogIntake.metricResource(
              series.host,
              tags,
              accumulator.serviceOverride,
            ),
          ),
          series.metric,
          series.unit,
          shape,
        );
      }

      metric.dataPoints.push(
        shape === OtlpMetricShape.DeltaSum
          ? {
              startTimeUnixNano: DatadogIntake.startTime(
                timeUnixNano,
                series.intervalSeconds,
              ),
              timeUnixNano: timeUnixNano,
              asDouble: value,
              attributes: attributes,
            }
          : {
              timeUnixNano: timeUnixNano,
              asDouble: value,
              attributes: attributes,
            },
      );
      accumulator.pointCount++;
    }
  }

  /*
   * A sketch's Dogsketch or Distribution as a summary point, or null when
   * its count or sum is no number (or its time no time). Its minimum and
   * maximum are left out when it counted nothing.
   */
  private static summaryDataPoint(
    sketchPoint: unknown,
    attributes: Array<OtlpKeyValue>,
    nowUnixNano: string,
  ): JSONObject | null {
    if (!DatadogIntake.isRecord(sketchPoint)) {
      return null;
    }

    const timeUnixNano: string | null = DatadogIntake.pointTime(
      sketchPoint["ts"],
      nowUnixNano,
    );
    const count: unknown = sketchPoint["cnt"];
    const sum: unknown = sketchPoint["sum"];

    if (
      timeUnixNano === null ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      typeof sum !== "number" ||
      !Number.isFinite(sum)
    ) {
      return null;
    }

    const quantileValues: Array<JSONObject> = [];

    if (count > 0) {
      const min: unknown = sketchPoint["min"];
      const max: unknown = sketchPoint["max"];

      if (typeof min === "number" && Number.isFinite(min)) {
        quantileValues.push({ quantile: 0, value: min });
      }

      if (typeof max === "number" && Number.isFinite(max)) {
        quantileValues.push({ quantile: 1, value: max });
      }
    }

    return {
      timeUnixNano: timeUnixNano,
      count: String(count),
      sum: sum,
      quantileValues: quantileValues,
      attributes: attributes as unknown as Array<JSONObject>,
    };
  }

  /*
   * A point's time: seconds since the epoch (see TIMES above). None - or
   * 0, which is how proto3 writes none - is now; anything else that is no
   * time drops the point.
   */
  private static pointTime(
    timestamp: unknown,
    nowUnixNano: string,
  ): string | null {
    if (timestamp === undefined || timestamp === null || timestamp === 0) {
      return nowUnixNano;
    }

    if (typeof timestamp === "number" || typeof timestamp === "string") {
      return DatadogIntake.epochToUnixNano(timestamp);
    }

    return null;
  }

  // A point's value: a finite number, or a string that is one.
  private static pointValue(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string" && NUMBER_TEXT.test(value.trim())) {
      const parsed: number = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private static readInterval(value: unknown): number {
    const interval: number | null = DatadogIntake.pointValue(value);
    return interval !== null && interval > 0 ? interval : 0;
  }

  // A count's start: one interval before its time, or its time without one.
  private static startTime(
    timeUnixNano: string,
    intervalSeconds: number,
  ): string {
    if (intervalSeconds <= 0) {
      return timeUnixNano;
    }

    const intervalUnixNano: string | null =
      OtlpJson.secondsToUnixNano(intervalSeconds);

    if (intervalUnixNano === null) {
      return timeUnixNano;
    }

    const start: bigint = BigInt(timeUnixNano) - BigInt(intervalUnixNano);

    return start > BigInt(0) ? start.toString() : timeUnixNano;
  }

  // RESOURCES, METRICS AND TAGS

  private static newMetrics(
    options: DatadogTranslateOptions,
  ): MetricsAccumulator {
    return {
      resources: new Map(),
      pointCount: 0,
      droppedPointCount: 0,
      nowUnixNano: OtlpJson.nowUnixNano(options.nowInMs),
      serviceOverride: DatadogIntake.trimmed(options.serviceName),
    };
  }

  private static metricResource(
    host: string,
    tags: DatadogTags,
    serviceOverride: string,
  ): ResourceIdentity {
    return {
      serviceName:
        serviceOverride || DatadogIntake.firstTagValue(tags, "service"),
      hostName: host || DatadogIntake.firstTagValue(tags, "host"),
      environment: DatadogIntake.firstTagValue(tags, "env"),
      version: DatadogIntake.firstTagValue(tags, "version"),
    };
  }

  private static resourceFor(
    accumulator: MetricsAccumulator,
    identity: ResourceIdentity,
  ): MetricsResourceAccumulator {
    const key: string = DatadogIntake.resourceKey(identity);
    let resource: MetricsResourceAccumulator | undefined =
      accumulator.resources.get(key);

    if (!resource) {
      resource = {
        attributes: DatadogIntake.resourceAttributes(identity),
        metrics: new Map(),
      };
      accumulator.resources.set(key, resource);
    }

    return resource;
  }

  private static metricFor(
    resource: MetricsResourceAccumulator,
    name: string,
    unit: string,
    shape: OtlpMetricShape,
  ): MetricAccumulator {
    const key: string = JSON.stringify([name, shape, unit]);
    let metric: MetricAccumulator | undefined = resource.metrics.get(key);

    if (!metric) {
      metric = { name: name, unit: unit, shape: shape, dataPoints: [] };
      resource.metrics.set(key, metric);
    }

    return metric;
  }

  private static metricsResult(
    accumulator: MetricsAccumulator,
  ): DatadogMetricsTranslation {
    if (accumulator.pointCount === 0) {
      return {
        metrics: null,
        pointCount: 0,
        droppedPointCount: accumulator.droppedPointCount,
      };
    }

    return {
      metrics: {
        resourceMetrics: Array.from(accumulator.resources.values()).map(
          (resource: MetricsResourceAccumulator): JSONObject => {
            return {
              resource: { attributes: resource.attributes },
              scopeMetrics: [
                {
                  scope: { name: SCOPE_NAME },
                  metrics: Array.from(resource.metrics.values()).map(
                    (metric: MetricAccumulator): JSONObject => {
                      return DatadogIntake.metricJson(metric);
                    },
                  ),
                },
              ],
            } as unknown as JSONObject;
          },
        ),
      } as unknown as JSONObject,
      pointCount: accumulator.pointCount,
      droppedPointCount: accumulator.droppedPointCount,
    };
  }

  private static metricJson(metric: MetricAccumulator): JSONObject {
    const json: JSONObject = { name: metric.name };

    if (metric.unit) {
      json["unit"] = metric.unit;
    }

    if (metric.shape === OtlpMetricShape.DeltaSum) {
      json["sum"] = {
        aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
        isMonotonic: false,
        dataPoints: metric.dataPoints,
      };
    } else if (metric.shape === OtlpMetricShape.Summary) {
      json["summary"] = { dataPoints: metric.dataPoints };
    } else {
      json["gauge"] = { dataPoints: metric.dataPoints };
    }

    return json;
  }

  private static resourceKey(identity: ResourceIdentity): string {
    return JSON.stringify([
      identity.serviceName,
      identity.hostName,
      identity.environment,
      identity.version,
    ]);
  }

  private static resourceAttributes(
    identity: ResourceIdentity,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("service.name", identity.serviceName),
      OtlpJson.stringAttribute("host.name", identity.hostName),
      OtlpJson.stringAttribute(
        "deployment.environment.name",
        identity.environment,
      ),
      OtlpJson.stringAttribute("service.version", identity.version),
    );

    return attributes;
  }

  /*
   * Tags, by key: "key:value" splits at its first colon; a tag with no
   * colon, or nothing before it, has no key.
   */
  private static parseTags(list: Array<string>): DatadogTags {
    const tags: DatadogTags = { values: new Map(), bare: [] };

    for (const rawTag of list) {
      const tag: string = rawTag.trim();

      if (!tag) {
        continue;
      }

      const separator: number = tag.indexOf(":");
      const key: string = separator > 0 ? tag.slice(0, separator).trim() : "";

      if (!key) {
        if (!tags.bare.includes(tag)) {
          tags.bare.push(tag);
        }

        continue;
      }

      const value: string = tag.slice(separator + 1).trim();
      const values: Array<string> | undefined = tags.values.get(key);

      if (!values) {
        tags.values.set(key, [value]);
      } else if (!values.includes(value)) {
        values.push(value);
      }
    }

    return tags;
  }

  // A tag's first value with something in it, or "".
  private static firstTagValue(tags: DatadogTags, key: string): string {
    const values: Array<string> | undefined = tags.values.get(key);

    if (!values) {
      return "";
    }

    for (const value of values) {
      if (value) {
        return value;
      }
    }

    return "";
  }

  private static tagAttributes(tags: DatadogTags): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    tags.values.forEach((values: Array<string>, key: string): void => {
      attributes.push({ key: key, value: { stringValue: values.join(",") } });
    });

    if (tags.bare.length > 0) {
      attributes.push({
        key: "datadog.tags",
        value: { stringValue: tags.bare.join(",") },
      });
    }

    // A tag keyed datadog.tags keeps its place; the bare tags give way.
    return DatadogIntake.mergeAttributes(attributes);
  }

  // The lists' attributes in order; a key already written is skipped.
  private static mergeAttributes(
    ...lists: Array<Array<OtlpKeyValue>>
  ): Array<OtlpKeyValue> {
    const keys: Set<string> = new Set();
    const merged: Array<OtlpKeyValue> = [];

    for (const list of lists) {
      for (const attribute of list) {
        if (!keys.has(attribute.key)) {
          keys.add(attribute.key);
          merged.push(attribute);
        }
      }
    }

    return merged;
  }

  // TIMES

  /*
   * An epoch time - a number, or a string of digits - as nanoseconds. Its
   * whole part's digits say its unit (see TIMES above); its fraction is
   * kept to the nanosecond. Null for zero, a negative, an exponent or
   * anything longer than nanoseconds.
   */
  private static epochToUnixNano(value: number | string): string | null {
    let text: string;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) {
        return null;
      }

      text = String(value);
    } else {
      text = value.trim();
    }

    const match: RegExpExecArray | null = EPOCH_DIGITS.exec(text);

    if (!match) {
      return null;
    }

    const whole: string = (match[1] || "").replace(LEADING_ZEROS, "");
    const fraction: string = match[2] || "";

    if (whole.length <= 11) {
      const seconds: string | null = OtlpJson.secondsToUnixNano(
        fraction ? `${whole || "0"}.${fraction}` : whole || "0",
      );

      return seconds === "0" ? null : seconds;
    }

    // Digits of a nanosecond each unit's fraction carries.
    let fractionDigits: number;

    if (whole.length <= 14) {
      fractionDigits = 6;
    } else if (whole.length <= 17) {
      fractionDigits = 3;
    } else if (whole.length <= 19) {
      fractionDigits = 0;
    } else {
      return null;
    }

    return (
      BigInt(whole) * BigInt(10 ** fractionDigits) +
      BigInt(fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0") || 0)
    ).toString();
  }

  private static isoToUnixNano(text: string): string | null {
    const match: RegExpExecArray | null = ISO_8601.exec(text);

    if (!match) {
      return null;
    }

    const year: number = Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);
    const hour: number = Number(match[4] || 0);
    const minute: number = Number(match[5] || 0);
    const second: number = Number(match[6] || 0);

    if (
      year < 1970 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 60
    ) {
      return null;
    }

    let offsetMinutes: number = 0;

    if (match[9]) {
      const offsetHours: number = Number(match[10]);
      const offsetRestMinutes: number = Number(match[11] || 0);

      if (offsetHours > 23 || offsetRestMinutes > 59) {
        return null;
      }

      offsetMinutes =
        (offsetHours * 60 + offsetRestMinutes) * (match[9] === "-" ? -1 : 1);
    }

    const milliseconds: number =
      Date.UTC(year, month - 1, day, hour, minute, second) -
      offsetMinutes * 60_000;

    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return null;
    }

    const nanoseconds: string = (match[7] || "").slice(0, 9).padEnd(9, "0");

    return (
      BigInt(milliseconds) * BigInt(1_000_000) +
      BigInt(nanoseconds)
    ).toString();
  }

  // VALUES

  private static decode(
    type: protobuf.Type,
    body: Buffer | Uint8Array,
    name: string,
  ): JSONObject {
    let message: protobuf.Message;

    try {
      message = type.decode(body as Uint8Array);
    } catch {
      throw new DatadogIntakeError(
        400,
        `The body is not a Datadog ${name} protobuf.`,
      );
    }

    return type.toObject(message, TO_OBJECT_OPTIONS) as JSONObject;
  }

  private static bodyText(body: Buffer | string): string {
    const text: string =
      typeof body === "string" ? body : body.toString("utf8");

    // A byte order mark is not JSON.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // A tag list: an array (series, sketches, check runs) or "a:b,c" (ddtags).
  private static readTagList(value: unknown): Array<string> {
    if (typeof value === "string") {
      return value.split(",");
    }

    if (Array.isArray(value)) {
      return value.filter((tag: unknown): tag is string => {
        return typeof tag === "string";
      });
    }

    return [];
  }

  private static readText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private static trimmed(value: string | undefined): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private static readArray(value: unknown): Array<unknown> {
    return Array.isArray(value) ? value : [];
  }

  private static isRecord(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
