import { JSONObject } from "Common/Types/JSON";
import OtlpJson, {
  OTLP_SEVERITY_UNSPECIFIED,
  OtlpKeyValue,
  OtlpSeverity,
} from "./OtlpJson";

/*
 * Splunk HTTP Event Collector (HEC) requests, as OpenTelemetry logs and
 * metrics.
 *
 * Splunk's Docker logging driver, Fluent Bit's and Fluentd's splunk
 * outputs, Splunk Connect for Kubernetes, the OpenTelemetry Collector's
 * splunk_hec exporter and Splunk's logging libraries all post to HEC
 * (https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector),
 * so pointing one at OneUptime is a change of URL and token. Each request
 * is turned into an OTLP ExportLogsServiceRequest - and, for metric
 * events, an ExportMetricsServiceRequest - and goes through the same
 * pipeline as OTLP: drop filters, scrub rules, pipelines, services,
 * retention and billing.
 *
 * /services/collector/event is sent one or more JSON event objects,
 * concatenated, with or without whitespace between them (a JSON array of
 * them is read too, though HEC itself refuses one). Each event carries its
 * `event` - the log itself, a string or an object - and optional metadata:
 * `time` (seconds since the epoch, with a fraction), `host`, `source`,
 * `sourcetype`, `index`, and `fields` (Splunk's indexed fields). As HEC
 * does, a request with one invalid event is refused whole, naming the
 * event (invalid-event-number). /services/collector/raw is sent plain
 * text, one event a line.
 *
 * The metadata is the resource, under the names the OpenTelemetry
 * Collector's splunkhecreceiver gives it: host as host.name, and source,
 * sourcetype and index as com.splunk.source, com.splunk.sourcetype and
 * com.splunk.index; the request's query string fills in what an event
 * leaves out. HEC has no service: a `service.name` indexed field names
 * one (the OpenTelemetry Collector's exporter sends its resource's
 * service.name that way), and so does a log's `service` field - not a
 * metric event's, where `service` is a dimension. With none, service.name
 * is left unset, and OneUptime files the records by host or under its
 * unknown service - an ingestion key can be pinned to a service instead.
 * Events are grouped into one resource per distinct service and metadata.
 *
 * An event whose `event` is "metric" is in Splunk's metrics format: its
 * measurements are gauge points, never logs.
 *
 * Every value is copied as it is; nothing here runs a regular expression
 * over an event's text, which may be large.
 */

export type SplunkHecResponseName =
  | "success"
  | "tokenRequired"
  | "invalidAuthorization"
  | "invalidToken"
  | "noData"
  | "invalidDataFormat"
  | "internalServerError"
  | "serverBusy"
  | "eventFieldRequired"
  | "eventFieldBlank"
  | "healthy";

// A HEC answer's body: {"text":"Success","code":0}.
export type SplunkHecStatusBody = {
  text: string;
  code: number;
};

/*
 * HEC's answers, exactly as Splunk writes them (its table of HTTP Event
 * Collector status codes), with each one's HTTP status in HEC_HTTP_STATUS.
 * A refusal of one event in a batch also names it: refusalFor() writes
 * that body.
 */
export const HEC_RESPONSES: Readonly<
  Record<SplunkHecResponseName, SplunkHecStatusBody>
> = {
  success: { text: "Success", code: 0 },
  tokenRequired: { text: "Token is required", code: 2 },
  invalidAuthorization: { text: "Invalid authorization", code: 3 },
  invalidToken: { text: "Invalid token", code: 4 },
  noData: { text: "No data", code: 5 },
  invalidDataFormat: { text: "Invalid data format", code: 6 },
  internalServerError: { text: "Internal server error", code: 8 },
  serverBusy: { text: "Server is busy", code: 9 },
  eventFieldRequired: { text: "Event field is required", code: 12 },
  eventFieldBlank: { text: "Event field cannot be blank", code: 13 },
  healthy: { text: "HEC is healthy", code: 17 },
};

export const HEC_HTTP_STATUS: Readonly<Record<SplunkHecResponseName, number>> =
  {
    success: 200,
    tokenRequired: 401,
    invalidAuthorization: 401,
    invalidToken: 403,
    noData: 400,
    invalidDataFormat: 400,
    internalServerError: 500,
    serverBusy: 503,
    eventFieldRequired: 400,
    eventFieldBlank: 400,
    healthy: 200,
  };

/*
 * The most events read from one request. A body may decompress to 64 MiB
 * - millions of small events - and each becomes an OTLP record many times
 * its size, so the events past this are not read: they are counted
 * (droppedEventCount), for the route to log, and the ones before them are
 * kept. Real clients batch far below it: the OpenTelemetry Collector's
 * exporter sends at most 2 MiB of logs a request by default.
 */
export const MAX_HEC_EVENTS_PER_REQUEST: number = 100_000;

export type SplunkHecParseErrorName =
  | "noData"
  | "invalidDataFormat"
  | "eventFieldRequired"
  | "eventFieldBlank";

export interface SplunkHecParsedEvents {
  events: Array<JSONObject>;
  // Events past MAX_HEC_EVENTS_PER_REQUEST: counted, not read.
  droppedEventCount: number;
}

export interface SplunkHecParseFailure {
  error: SplunkHecParseErrorName;
  /*
   * The 0-based number of the event that is not valid, as HEC answers it
   * (invalid-event-number). 0, and left out of the answer, for noData.
   */
  invalidEventNumber: number;
}

export type SplunkHecParseResult =
  | SplunkHecParsedEvents
  | SplunkHecParseFailure;

/*
 * The request's query string (?host=&source=&sourcetype=&index=&time=):
 * the metadata of every event that does not carry its own.
 */
export interface SplunkHecDefaults {
  host?: string | undefined;
  source?: string | undefined;
  sourcetype?: string | undefined;
  index?: string | undefined;
  time?: string | undefined;
}

export interface SplunkHecTranslateOptions {
  defaults?: SplunkHecDefaults | undefined;
  // Now, in milliseconds since the epoch; Date.now() when not given.
  nowInMs?: number | undefined;
  /*
   * The service every record is filed under, whatever the events say (the
   * x-oneuptime-service-name header).
   */
  serviceName?: string | undefined;
}

export interface SplunkHecEventsOtlp {
  // An ExportLogsServiceRequest, or null when no event was a log.
  logs: JSONObject | null;
  // An ExportMetricsServiceRequest, or null when no metric event had a value.
  metrics: JSONObject | null;
  logCount: number;
  metricPointCount: number;
  // Measurements whose value is no finite number ("NaN", "+Inf", "n/a").
  droppedMetricPointCount: number;
}

export interface SplunkHecRawOtlp {
  // An ExportLogsServiceRequest, or null when the body has no line.
  logs: JSONObject | null;
  logCount: number;
  // Lines past MAX_HEC_EVENTS_PER_REQUEST: counted, not kept.
  droppedEventCount: number;
}

interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: Array<OtlpKeyValue>;
  traceId?: string;
  spanId?: string;
}

// What a resource is: its service and the event's metadata ("" for none).
interface ResourceIdentity {
  serviceName: string;
  host: string;
  source: string;
  sourcetype: string;
  index: string;
}

interface LogResource {
  attributes: Array<OtlpKeyValue>;
  logRecords: Array<OtlpLogRecord>;
}

interface MetricResource {
  attributes: Array<OtlpKeyValue>;
  // Each metric's points, by name, in the order the names were first seen.
  dataPointsByName: Map<string, Array<JSONObject>>;
}

interface TranslateContext {
  nowUnixNano: string;
  // The time of an event without one: the query string's, or now.
  defaultTimeUnixNano: string;
  defaults: Omit<ResourceIdentity, "serviceName">;
  serviceName: string;
}

interface Measurement {
  name: string;
  value: unknown;
}

const SCOPE_NAME: string = "splunk-hec";

/*
 * Where a structured event keeps its message: the keys loggers and
 * shippers write it under (Splunk's Docker logging driver: line; Fluent
 * Bit: log; journald: MESSAGE; Serilog's Splunk sink: RenderedMessage).
 * The first holding a non-empty string is the body, and is not repeated as
 * an attribute.
 */
const BODY_KEYS: ReadonlyArray<string> = [
  "message",
  "msg",
  "log",
  "line",
  "text",
  "MESSAGE",
  "RenderedMessage",
];

/*
 * Where an event keeps its level, read in this order in its indexed fields
 * and then in the event itself; the first that is a level is its severity.
 * A level word ("warning", "err") or a syslog number (0 emergency .. 7
 * debug) is read - `status` only as a word ("error", "ok"), since a numeric
 * status is an HTTP or exit status, and status 0 is no emergency. Serilog's
 * Splunk sink writes Level, journald PRIORITY.
 */
const SEVERITY_KEYS: ReadonlyArray<string> = [
  "severity",
  "level",
  "log_level",
  "loglevel",
  "status",
  "Level",
  "PRIORITY",
];
const WORD_ONLY_SEVERITY_KEYS: ReadonlySet<string> = new Set<string>([
  "status",
]);

/*
 * The OpenTelemetry Collector's splunk_hec exporter keeps a record's
 * severity in these indexed fields by default: OpenTelemetry's own
 * severity number (1 .. 24), and its text. They are read before any level.
 */
const OTEL_SEVERITY_NUMBER_FIELD: string = "otel.log.severity.number";
const OTEL_SEVERITY_TEXT_FIELD: string = "otel.log.severity.text";
const OTEL_SEVERITY_NAMES: ReadonlyArray<string> = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
];

const TRACE_ID_KEYS: ReadonlyArray<string> = ["trace_id", "traceId"];
const SPAN_ID_KEYS: ReadonlyArray<string> = ["span_id", "spanId"];
const HEX_TRACE_ID_LENGTH: number = 32;
const HEX_SPAN_ID_LENGTH: number = 16;

/*
 * The indexed fields that name the service. service.name is the
 * resource's, never a record or point attribute; a log's service names it
 * too (when service.name does not), and is kept as an attribute as well.
 */
const SERVICE_NAME_FIELD: string = "service.name";
const SERVICE_FIELD: string = "service";
const RESOURCE_FIELDS: ReadonlySet<string> = new Set<string>([
  SERVICE_NAME_FIELD,
]);

/*
 * Splunk's metrics format: an event "metric" whose fields hold one
 * measurement (metric_name and _value) or several (metric_name:<name>,
 * each with its value).
 */
const METRIC_EVENT: string = "metric";
const METRIC_NAME_FIELD: string = "metric_name";
const METRIC_VALUE_FIELD: string = "_value";
const METRIC_NAME_PREFIX: string = "metric_name:";

/*
 * Time units past seconds, by size: a value above 1e11 is no time in
 * seconds (that is the year 5138) but one in milliseconds, as some clients
 * send it; above 1e14 microseconds, above 1e17 nanoseconds. `places` is
 * how far the decimal point moves left to make the value seconds.
 */
const TIME_UNITS: ReadonlyArray<{ above: number; places: number }> = [
  { above: 1e17, places: 9 },
  { above: 1e14, places: 6 },
  { above: 1e11, places: 3 },
];

// The latest instant OTLP's int64 nanoseconds can hold.
const MAX_UNIX_NANO: string = "9223372036854775807";

/*
 * Text longer than this is no time and no metric value (the longest time,
 * in nanoseconds with a fraction, is about 30 characters): it is not read
 * as a number at all.
 */
const MAX_NUMBER_TEXT_LENGTH: number = 64;

const PLAIN_DECIMAL: RegExp = /^\d+(?:\.\d+)?$/;
const NUMERIC_TEXT: RegExp = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER_TEXT: RegExp = /^\d+$/;
const SYSLOG_DIGIT: RegExp = /^[0-7]$/;

const CHAR_SPACE: number = 0x20;
const CHAR_TAB: number = 0x09;
const CHAR_LINE_FEED: number = 0x0a;
const CHAR_VERTICAL_TAB: number = 0x0b;
const CHAR_FORM_FEED: number = 0x0c;
const CHAR_CARRIAGE_RETURN: number = 0x0d;
const CHAR_QUOTE: number = 0x22;
const CHAR_BACKSLASH: number = 0x5c;
const CHAR_OPEN_BRACE: number = 0x7b;
const CHAR_CLOSE_BRACE: number = 0x7d;
const CHAR_OPEN_BRACKET: number = 0x5b;
const CHAR_BYTE_ORDER_MARK: number = 0xfeff;

export default class SplunkHec {
  /*
   * The events of a /services/collector/event body: JSON objects one after
   * another, with or without whitespace between them, or a JSON array of
   * them. Each is split off by a scan that skips over strings - a brace or
   * an escaped quote inside one ends nothing - and then parsed on its own,
   * so a refusal can name the event, as HEC's does. An event needs an
   * `event` that is not blank (an empty or all-whitespace string, an empty
   * object or array, or null).
   */
  public static parseEvents(body: Buffer | string): SplunkHecParseResult {
    const text: string = SplunkHec.toText(body);
    let position: number = SplunkHec.skipWhitespace(text, 0);

    if (position >= text.length) {
      return { error: "noData", invalidEventNumber: 0 };
    }

    if (text.charCodeAt(position) === CHAR_OPEN_BRACKET) {
      return SplunkHec.parseEventArray(text);
    }

    const events: Array<JSONObject> = [];
    let droppedEventCount: number = 0;

    while (position < text.length) {
      const end: number = SplunkHec.endOfObject(text, position);

      if (events.length >= MAX_HEC_EVENTS_PER_REQUEST) {
        /*
         * Past the cap events are only counted. What cannot be split
         * into objects counts as one more, and ends the count.
         */
        droppedEventCount++;

        if (end === -1) {
          break;
        }

        position = SplunkHec.skipWhitespace(text, end + 1);
        continue;
      }

      const eventNumber: number = events.length;

      if (end === -1) {
        return { error: "invalidDataFormat", invalidEventNumber: eventNumber };
      }

      const event: JSONObject | null = SplunkHec.parseObject(
        text.substring(position, end + 1),
      );

      if (!event) {
        return { error: "invalidDataFormat", invalidEventNumber: eventNumber };
      }

      const problem: SplunkHecParseErrorName | null =
        SplunkHec.eventProblem(event);

      if (problem) {
        return { error: problem, invalidEventNumber: eventNumber };
      }

      events.push(event);
      position = SplunkHec.skipWhitespace(text, end + 1);
    }

    return { events: events, droppedEventCount: droppedEventCount };
  }

  /*
   * Events, as parseEvents reads them, as OTLP logs and metrics. An event
   * parseEvents would refuse (no event, or a blank one) is skipped, and
   * keys beside HEC's own (time, host, source, sourcetype, index, event,
   * fields) are not read.
   *
   * A log's time is its own, else the query string's, else now; its body
   * is its event - a string as it is, a number or boolean as its text, an
   * object's message (BODY_KEYS) or, when it has none, the object's JSON.
   * Its attributes are its indexed fields, under their own names (arrays
   * as their JSON; a nested object, which Splunk refuses in fields, is
   * flattened rather than refused), then an object event's other keys,
   * flattened ("kubernetes.pod_name"); a key in both is the field's. Its
   * severity and trace context are read from its fields, then its event.
   *
   * A metric event's measurements are gauge points at its time, its other
   * fields their attributes (the exporter's metric_type among them), one
   * metric per name in a resource. A value that is no finite number is
   * dropped, and counted.
   */
  public static eventsToOtlp(
    events: Array<JSONObject>,
    options?: SplunkHecTranslateOptions,
  ): SplunkHecEventsOtlp {
    const context: TranslateContext = SplunkHec.contextOf(options);

    const logResources: Map<string, LogResource> = new Map<
      string,
      LogResource
    >();
    const metricResources: Map<string, MetricResource> = new Map<
      string,
      MetricResource
    >();

    let logCount: number = 0;
    let metricPointCount: number = 0;
    let droppedMetricPointCount: number = 0;

    for (const event of events) {
      if (!SplunkHec.isRecord(event) || SplunkHec.eventProblem(event)) {
        continue;
      }

      const fields: JSONObject | null = SplunkHec.isRecord(event["fields"])
        ? (event["fields"] as JSONObject)
        : null;
      const identity: ResourceIdentity = SplunkHec.identityOf(
        event,
        fields,
        context,
        event["event"] === METRIC_EVENT,
      );
      const timeUnixNano: string =
        SplunkHec.readTime(event["time"]) ?? context.defaultTimeUnixNano;

      if (event["event"] === METRIC_EVENT) {
        const measurements: Array<Measurement> =
          SplunkHec.measurementsOf(fields);

        if (measurements.length === 0) {
          continue;
        }

        const attributes: Array<OtlpKeyValue> = fields
          ? OtlpJson.attributesFromObject(fields, {
              skip: SplunkHec.metricFieldsToSkip(fields),
            })
          : [];

        // Made on the first value, so no resource is left without a metric.
        let resource: MetricResource | null = null;

        for (const measurement of measurements) {
          const value: number | null = SplunkHec.readMetricValue(
            measurement.value,
          );

          if (value === null) {
            droppedMetricPointCount++;
            continue;
          }

          resource =
            resource || SplunkHec.metricResourceOf(metricResources, identity);

          SplunkHec.addDataPoint(resource, measurement.name, {
            timeUnixNano: timeUnixNano,
            asDouble: value,
            attributes: attributes.slice(),
          } as unknown as JSONObject);
          metricPointCount++;
        }

        continue;
      }

      SplunkHec.logResourceOf(logResources, identity).logRecords.push(
        SplunkHec.toLogRecord(
          event["event"],
          fields,
          timeUnixNano,
          context.nowUnixNano,
        ),
      );
      logCount++;
    }

    return {
      logs: SplunkHec.logsPayload(Array.from(logResources.values())),
      metrics: SplunkHec.metricsPayload(Array.from(metricResources.values())),
      logCount: logCount,
      metricPointCount: metricPointCount,
      droppedMetricPointCount: droppedMetricPointCount,
    };
  }

  /*
   * A /services/collector/raw body as OTLP logs: each line that is not
   * blank is a record, its text as it is (only the line ending is taken
   * off). A raw event has no metadata of its own: its time is the query
   * string's, or now - a timestamp written in the line is not read out (a
   * pipeline can) - its resource the query string's, and its severity
   * unspecified.
   */
  public static rawToOtlp(
    body: Buffer | string,
    options?: SplunkHecTranslateOptions,
  ): SplunkHecRawOtlp {
    const text: string = SplunkHec.toText(body);
    const context: TranslateContext = SplunkHec.contextOf(options);
    const logRecords: Array<OtlpLogRecord> = [];
    let droppedEventCount: number = 0;
    let lineStart: number = 0;

    while (lineStart < text.length) {
      let lineEnd: number = text.indexOf("\n", lineStart);

      if (lineEnd === -1) {
        lineEnd = text.length;
      }

      const contentStart: number = lineStart;
      const contentEnd: number =
        lineEnd > lineStart &&
        text.charCodeAt(lineEnd - 1) === CHAR_CARRIAGE_RETURN
          ? lineEnd - 1
          : lineEnd;

      lineStart = lineEnd + 1;

      if (SplunkHec.isBlank(text, contentStart, contentEnd)) {
        continue;
      }

      if (logRecords.length >= MAX_HEC_EVENTS_PER_REQUEST) {
        droppedEventCount++;
        continue;
      }

      logRecords.push({
        timeUnixNano: context.defaultTimeUnixNano,
        observedTimeUnixNano: context.nowUnixNano,
        severityNumber: OTLP_SEVERITY_UNSPECIFIED.number,
        severityText: OTLP_SEVERITY_UNSPECIFIED.text,
        body: { stringValue: text.substring(contentStart, contentEnd) },
        attributes: [],
      });
    }

    if (logRecords.length === 0) {
      return {
        logs: null,
        logCount: 0,
        droppedEventCount: droppedEventCount,
      };
    }

    const identity: ResourceIdentity = {
      serviceName: context.serviceName,
      ...context.defaults,
    };

    return {
      logs: SplunkHec.logsPayload([
        {
          attributes: SplunkHec.resourceAttributes(identity),
          logRecords: logRecords,
        },
      ]),
      logCount: logRecords.length,
      droppedEventCount: droppedEventCount,
    };
  }

  /*
   * HEC's answer to a request parseEvents refused: its HTTP status, and
   * its body - naming the invalid event as HEC does
   * ({"text":"Invalid data format","code":6,"invalid-event-number":2}),
   * except for an empty request, which has none.
   */
  public static refusalFor(failure: SplunkHecParseFailure): {
    httpStatus: number;
    body: JSONObject;
  } {
    const status: SplunkHecStatusBody = HEC_RESPONSES[failure.error];
    const body: JSONObject = { text: status.text, code: status.code };

    if (failure.error !== "noData") {
      body["invalid-event-number"] = failure.invalidEventNumber;
    }

    return { httpStatus: HEC_HTTP_STATUS[failure.error], body: body };
  }

  /*
   * A body that is a JSON array of events. It is parsed whole, so one
   * that is not valid JSON is refused as event 0.
   */
  private static parseEventArray(text: string): SplunkHecParseResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "invalidDataFormat", invalidEventNumber: 0 };
    }

    if (!Array.isArray(parsed)) {
      return { error: "invalidDataFormat", invalidEventNumber: 0 };
    }

    if (parsed.length === 0) {
      return { error: "noData", invalidEventNumber: 0 };
    }

    const items: Array<unknown> = parsed;
    const count: number = Math.min(items.length, MAX_HEC_EVENTS_PER_REQUEST);
    const events: Array<JSONObject> = [];

    for (let eventNumber: number = 0; eventNumber < count; eventNumber++) {
      const item: unknown = items[eventNumber];

      if (!SplunkHec.isRecord(item)) {
        return { error: "invalidDataFormat", invalidEventNumber: eventNumber };
      }

      const problem: SplunkHecParseErrorName | null =
        SplunkHec.eventProblem(item);

      if (problem) {
        return { error: problem, invalidEventNumber: eventNumber };
      }

      events.push(item);
    }

    return { events: events, droppedEventCount: items.length - count };
  }

  // Why HEC would refuse an event, or null when it would not.
  private static eventProblem(
    event: JSONObject,
  ): "eventFieldRequired" | "eventFieldBlank" | null {
    const value: unknown = event["event"];

    if (value === undefined) {
      return "eventFieldRequired";
    }

    if (value === null) {
      return "eventFieldBlank";
    }

    if (typeof value === "string") {
      return value.trim().length === 0 ? "eventFieldBlank" : null;
    }

    if (Array.isArray(value)) {
      return value.length === 0 ? "eventFieldBlank" : null;
    }

    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length === 0
        ? "eventFieldBlank"
        : null;
    }

    return null;
  }

  /*
   * The index of the brace that closes the object opening at `start`, or
   * -1 when no object opens there or it never closes. Only braces outside
   * strings count; whether the object is valid JSON is JSON.parse's to say.
   */
  private static endOfObject(text: string, start: number): number {
    if (text.charCodeAt(start) !== CHAR_OPEN_BRACE) {
      return -1;
    }

    let depth: number = 0;

    for (let index: number = start; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code === CHAR_QUOTE) {
        index = SplunkHec.endOfString(text, index);

        if (index === -1) {
          return -1;
        }
      } else if (code === CHAR_OPEN_BRACE) {
        depth++;
      } else if (code === CHAR_CLOSE_BRACE) {
        depth--;

        if (depth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  /*
   * The index of the quote that closes the string opening at `start`, or
   * -1: the first quote after it that an even run of backslashes (none,
   * or escaped backslashes) comes before. A string is jumped over, not
   * walked a character at a time.
   */
  private static endOfString(text: string, start: number): number {
    let quote: number = text.indexOf('"', start + 1);

    while (quote !== -1) {
      let backslashes: number = 0;

      for (
        let index: number = quote - 1;
        text.charCodeAt(index) === CHAR_BACKSLASH;
        index--
      ) {
        backslashes++;
      }

      if (backslashes % 2 === 0) {
        return quote;
      }

      quote = text.indexOf('"', quote + 1);
    }

    return -1;
  }

  // Whether text[start, end) holds nothing but spaces, tabs, CR, VT and FF.
  private static isBlank(text: string, start: number, end: number): boolean {
    for (let index: number = start; index < end; index++) {
      const code: number = text.charCodeAt(index);

      if (
        code !== CHAR_SPACE &&
        code !== CHAR_TAB &&
        code !== CHAR_CARRIAGE_RETURN &&
        code !== CHAR_VERTICAL_TAB &&
        code !== CHAR_FORM_FEED
      ) {
        return false;
      }
    }

    return true;
  }

  private static skipWhitespace(text: string, from: number): number {
    let index: number = from;

    while (index < text.length) {
      const code: number = text.charCodeAt(index);

      if (
        code !== CHAR_SPACE &&
        code !== CHAR_LINE_FEED &&
        code !== CHAR_CARRIAGE_RETURN &&
        code !== CHAR_TAB
      ) {
        break;
      }

      index++;
    }

    return index;
  }

  private static parseObject(json: string): JSONObject | null {
    try {
      const parsed: unknown = JSON.parse(json);
      return SplunkHec.isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // The body as text, without the byte order mark some Windows clients write.
  private static toText(body: Buffer | string): string {
    const text: string =
      typeof body === "string" ? body : body.toString("utf8");

    return text.charCodeAt(0) === CHAR_BYTE_ORDER_MARK ? text.slice(1) : text;
  }

  private static contextOf(
    options: SplunkHecTranslateOptions | undefined,
  ): TranslateContext {
    const nowUnixNano: string = OtlpJson.nowUnixNano(options?.nowInMs);
    const defaults: SplunkHecDefaults = options?.defaults || {};

    return {
      nowUnixNano: nowUnixNano,
      defaultTimeUnixNano: SplunkHec.readTime(defaults.time) ?? nowUnixNano,
      defaults: {
        host: SplunkHec.readText(defaults.host),
        source: SplunkHec.readText(defaults.source),
        sourcetype: SplunkHec.readText(defaults.sourcetype),
        index: SplunkHec.readText(defaults.index),
      },
      serviceName: SplunkHec.readText(options?.serviceName),
    };
  }

  /*
   * An event's resource: the service the route names, else its
   * service.name field, else - for a log - its service field; its own
   * metadata, else the query string's. A metric event's `service` is a
   * dimension like any other (Splunk's own metrics examples send
   * "service": "6"), so only service.name names a metric's service.
   */
  private static identityOf(
    event: JSONObject,
    fields: JSONObject | null,
    context: TranslateContext,
    isMetric: boolean,
  ): ResourceIdentity {
    return {
      serviceName:
        context.serviceName ||
        SplunkHec.readText(fields?.[SERVICE_NAME_FIELD]) ||
        (isMetric ? "" : SplunkHec.readText(fields?.[SERVICE_FIELD])),
      host: SplunkHec.readText(event["host"]) || context.defaults.host,
      source: SplunkHec.readText(event["source"]) || context.defaults.source,
      sourcetype:
        SplunkHec.readText(event["sourcetype"]) || context.defaults.sourcetype,
      index: SplunkHec.readText(event["index"]) || context.defaults.index,
    };
  }

  private static resourceAttributes(
    identity: ResourceIdentity,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("service.name", identity.serviceName),
      OtlpJson.stringAttribute("host.name", identity.host),
      OtlpJson.stringAttribute("com.splunk.source", identity.source),
      OtlpJson.stringAttribute("com.splunk.sourcetype", identity.sourcetype),
      OtlpJson.stringAttribute("com.splunk.index", identity.index),
    );

    return attributes;
  }

  private static resourceKey(identity: ResourceIdentity): string {
    return JSON.stringify([
      identity.serviceName,
      identity.host,
      identity.source,
      identity.sourcetype,
      identity.index,
    ]);
  }

  private static logResourceOf(
    resources: Map<string, LogResource>,
    identity: ResourceIdentity,
  ): LogResource {
    const key: string = SplunkHec.resourceKey(identity);
    let resource: LogResource | undefined = resources.get(key);

    if (!resource) {
      resource = {
        attributes: SplunkHec.resourceAttributes(identity),
        logRecords: [],
      };
      resources.set(key, resource);
    }

    return resource;
  }

  private static metricResourceOf(
    resources: Map<string, MetricResource>,
    identity: ResourceIdentity,
  ): MetricResource {
    const key: string = SplunkHec.resourceKey(identity);
    let resource: MetricResource | undefined = resources.get(key);

    if (!resource) {
      resource = {
        attributes: SplunkHec.resourceAttributes(identity),
        dataPointsByName: new Map<string, Array<JSONObject>>(),
      };
      resources.set(key, resource);
    }

    return resource;
  }

  // Files a point under its metric: a resource has one metric per name.
  private static addDataPoint(
    resource: MetricResource,
    name: string,
    dataPoint: JSONObject,
  ): void {
    const dataPoints: Array<JSONObject> | undefined =
      resource.dataPointsByName.get(name);

    if (dataPoints) {
      dataPoints.push(dataPoint);
    } else {
      resource.dataPointsByName.set(name, [dataPoint]);
    }
  }

  private static toLogRecord(
    value: unknown,
    fields: JSONObject | null,
    timeUnixNano: string,
    observedTimeUnixNano: string,
  ): OtlpLogRecord {
    const eventObject: JSONObject | null = SplunkHec.isRecord(value)
      ? value
      : null;
    const bodyKey: string | null = eventObject
      ? SplunkHec.bodyKeyOf(eventObject)
      : null;

    const attributes: Array<OtlpKeyValue> = SplunkHec.mergeAttributes(
      fields
        ? OtlpJson.attributesFromObject(fields, { skip: RESOURCE_FIELDS })
        : [],
      eventObject
        ? OtlpJson.attributesFromObject(eventObject, {
            skip: bodyKey ? new Set<string>([bodyKey]) : undefined,
          })
        : [],
    );

    const severity: OtlpSeverity = SplunkHec.severityOf(fields, eventObject);

    const logRecord: OtlpLogRecord = {
      timeUnixNano: timeUnixNano,
      observedTimeUnixNano: observedTimeUnixNano,
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: SplunkHec.bodyOf(value, eventObject, bodyKey) },
      attributes: attributes,
    };

    const traceId: string = SplunkHec.firstHexId(
      fields,
      eventObject,
      TRACE_ID_KEYS,
      HEX_TRACE_ID_LENGTH,
    );
    const spanId: string = SplunkHec.firstHexId(
      fields,
      eventObject,
      SPAN_ID_KEYS,
      HEX_SPAN_ID_LENGTH,
    );

    if (traceId) {
      logRecord.traceId = traceId;
    }

    if (spanId) {
      logRecord.spanId = spanId;
    }

    return logRecord;
  }

  /*
   * The record's body. Never empty: a blank event is refused, and an object
   * without a message is written whole.
   */
  private static bodyOf(
    value: unknown,
    eventObject: JSONObject | null,
    bodyKey: string | null,
  ): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (eventObject && bodyKey) {
      return eventObject[bodyKey] as string;
    }

    return SplunkHec.toJson(value);
  }

  private static bodyKeyOf(eventObject: JSONObject): string | null {
    for (const key of BODY_KEYS) {
      const candidate: unknown = eventObject[key];

      if (typeof candidate === "string" && candidate.length > 0) {
        return key;
      }
    }

    return null;
  }

  // The attributes of both lists, a key once: the first list's wins.
  private static mergeAttributes(
    first: Array<OtlpKeyValue>,
    second: Array<OtlpKeyValue>,
  ): Array<OtlpKeyValue> {
    const merged: Array<OtlpKeyValue> = [];
    const keys: Set<string> = new Set<string>();

    for (const attribute of first.concat(second)) {
      if (!keys.has(attribute.key)) {
        keys.add(attribute.key);
        merged.push(attribute);
      }
    }

    return merged;
  }

  private static severityOf(
    fields: JSONObject | null,
    eventObject: JSONObject | null,
  ): OtlpSeverity {
    if (fields) {
      const otelSeverity: OtlpSeverity | null =
        SplunkHec.otelSeverityOf(fields);

      if (otelSeverity) {
        return otelSeverity;
      }
    }

    for (const source of [fields, eventObject]) {
      if (!source) {
        continue;
      }

      for (const key of SEVERITY_KEYS) {
        const severity: OtlpSeverity = SplunkHec.severityOfValue(
          source[key],
          !WORD_ONLY_SEVERITY_KEYS.has(key),
        );

        if (severity.number !== OTLP_SEVERITY_UNSPECIFIED.number) {
          return severity;
        }
      }
    }

    return OTLP_SEVERITY_UNSPECIFIED;
  }

  // The OpenTelemetry Collector exporter's severity fields, when they say one.
  private static otelSeverityOf(fields: JSONObject): OtlpSeverity | null {
    const severityNumber: number | null = SplunkHec.readInteger(
      fields[OTEL_SEVERITY_NUMBER_FIELD],
    );

    if (
      severityNumber !== null &&
      severityNumber >= 1 &&
      severityNumber <= 24
    ) {
      // 1 TRACE .. 4 TRACE4, 5 DEBUG .. 8 DEBUG4, and so on to 24 FATAL4.
      const offset: number = (severityNumber - 1) % 4;

      return {
        number: severityNumber,
        text: `${OTEL_SEVERITY_NAMES[Math.floor((severityNumber - 1) / 4)]!}${
          offset === 0 ? "" : String(offset + 1)
        }`,
      };
    }

    const fromText: OtlpSeverity = OtlpJson.severityFromWord(
      fields[OTEL_SEVERITY_TEXT_FIELD],
    );

    return fromText.number !== OTLP_SEVERITY_UNSPECIFIED.number
      ? fromText
      : null;
  }

  // A level word, or (when allowed) a syslog number or digit.
  private static severityOfValue(
    value: unknown,
    allowNumber: boolean,
  ): OtlpSeverity {
    if (typeof value === "string") {
      const fromWord: OtlpSeverity = OtlpJson.severityFromWord(value);

      if (
        fromWord.number !== OTLP_SEVERITY_UNSPECIFIED.number ||
        !allowNumber
      ) {
        return fromWord;
      }

      const text: string = value.trim();

      return SYSLOG_DIGIT.test(text)
        ? OtlpJson.severityFromSyslogNumber(Number(text))
        : OTLP_SEVERITY_UNSPECIFIED;
    }

    if (typeof value === "number" && allowNumber) {
      return OtlpJson.severityFromSyslogNumber(value);
    }

    return OTLP_SEVERITY_UNSPECIFIED;
  }

  // The first of `keys` that is an ID, in the fields and then the event.
  private static firstHexId(
    fields: JSONObject | null,
    eventObject: JSONObject | null,
    keys: ReadonlyArray<string>,
    length: number,
  ): string {
    for (const source of [fields, eventObject]) {
      if (!source) {
        continue;
      }

      for (const key of keys) {
        const id: string = OtlpJson.hexId(source[key], length);

        if (id) {
          return id;
        }
      }
    }

    return "";
  }

  // A metric event's measurements, each named; values are read later.
  private static measurementsOf(fields: JSONObject | null): Array<Measurement> {
    const measurements: Array<Measurement> = [];

    if (!fields) {
      return measurements;
    }

    const singleName: unknown = fields[METRIC_NAME_FIELD];

    if (typeof singleName === "string" && singleName.trim()) {
      measurements.push({
        name: singleName.trim(),
        value: fields[METRIC_VALUE_FIELD],
      });
    }

    for (const key of Object.keys(fields)) {
      if (!key.startsWith(METRIC_NAME_PREFIX)) {
        continue;
      }

      const name: string = key.slice(METRIC_NAME_PREFIX.length).trim();

      if (name) {
        measurements.push({ name: name, value: fields[key] });
      }
    }

    return measurements;
  }

  /*
   * The fields that are not a metric point's attributes: its name and
   * value fields, and service.name, which is its resource's.
   */
  private static metricFieldsToSkip(fields: JSONObject): ReadonlySet<string> {
    const skip: Set<string> = new Set<string>([
      METRIC_NAME_FIELD,
      METRIC_VALUE_FIELD,
      SERVICE_NAME_FIELD,
    ]);

    for (const key of Object.keys(fields)) {
      if (key.startsWith(METRIC_NAME_PREFIX)) {
        skip.add(key);
      }
    }

    return skip;
  }

  /*
   * A measurement's value: a finite number, or text that is one ("42",
   * "0.5", "1e3"). The OpenTelemetry Collector's exporter writes NaN and
   * the infinities as "NaN", "+Inf" and "-Inf": they, like anything else,
   * are no value.
   */
  private static readMetricValue(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const text: string = value.trim();

      if (text.length > MAX_NUMBER_TEXT_LENGTH || !NUMERIC_TEXT.test(text)) {
        return null;
      }

      const parsed: number = Number(text);

      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  /*
   * Splunk's time - seconds since the epoch, whole or with a fraction, a
   * number or a decimal string ("1426279439.123") - as nanoseconds; a value
   * too large to be seconds in the unit it must be in (TIME_UNITS). The
   * digits are moved, not multiplied, so a string keeps all nine places of
   * its fraction. Null for no time: anything else, 0, or past what int64
   * nanoseconds can hold.
   */
  private static readTime(value: unknown): string | null {
    let text: string;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) {
        return null;
      }

      text = String(value);
    } else if (typeof value === "string") {
      text = value.trim();
    } else {
      return null;
    }

    // Also refuses what String() writes in exponent form: no time either.
    if (text.length > MAX_NUMBER_TEXT_LENGTH || !PLAIN_DECIMAL.test(text)) {
      return null;
    }

    const magnitude: number = Number(text);
    let places: number = 0;

    for (const unit of TIME_UNITS) {
      if (magnitude > unit.above) {
        places = unit.places;
        break;
      }
    }

    const [whole, fraction] = text.split(".") as [string, string | undefined];
    const seconds: string =
      places === 0
        ? text
        : `${whole.slice(0, -places)}.${whole.slice(-places)}${fraction || ""}`;

    const unixNano: string | null = OtlpJson.secondsToUnixNano(seconds);

    if (unixNano === null || unixNano === "0") {
      return null;
    }

    if (
      unixNano.length > MAX_UNIX_NANO.length ||
      (unixNano.length === MAX_UNIX_NANO.length && unixNano > MAX_UNIX_NANO)
    ) {
      return null;
    }

    return unixNano;
  }

  // Text metadata, trimmed ("" for none); a number as its digits.
  private static readText(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    return "";
  }

  private static readInteger(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : null;
    }

    if (typeof value === "string" && INTEGER_TEXT.test(value.trim())) {
      return Number(value.trim());
    }

    return null;
  }

  private static logsPayload(resources: Array<LogResource>): JSONObject | null {
    if (resources.length === 0) {
      return null;
    }

    return {
      resourceLogs: resources.map((resource: LogResource): JSONObject => {
        return {
          resource: { attributes: resource.attributes },
          scopeLogs: [
            {
              scope: { name: SCOPE_NAME },
              logRecords: resource.logRecords,
            },
          ],
        } as unknown as JSONObject;
      }),
    } as unknown as JSONObject;
  }

  private static metricsPayload(
    resources: Array<MetricResource>,
  ): JSONObject | null {
    if (resources.length === 0) {
      return null;
    }

    return {
      resourceMetrics: resources.map((resource: MetricResource): JSONObject => {
        const metrics: Array<JSONObject> = [];

        for (const [name, dataPoints] of resource.dataPointsByName) {
          metrics.push({
            name: name,
            gauge: { dataPoints: dataPoints },
          } as unknown as JSONObject);
        }

        return {
          resource: { attributes: resource.attributes },
          scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics: metrics }],
        } as unknown as JSONObject;
      }),
    } as unknown as JSONObject;
  }

  private static toJson(value: unknown): string {
    try {
      const json: string | undefined = JSON.stringify(value);
      return typeof json === "string" ? json : String(value);
    } catch {
      return String(value);
    }
  }

  private static isRecord(value: unknown): value is JSONObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
