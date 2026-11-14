import crypto from "crypto";
import { JSONObject } from "Common/Types/JSON";
import OtlpJson, {
  OTLP_SEVERITY_ERROR,
  OtlpKeyValue,
  OtlpSeverity,
} from "./OtlpJson";

/*
 * SENTRY'S ENVELOPES AND STORE EVENTS, AS OPENTELEMETRY TRACES AND LOGS.
 *
 * Every Sentry SDK - sentry-python, @sentry/node and @sentry/browser,
 * sentry-java, sentry-dotnet, sentry-go, sentry-ruby, sentry-php - posts
 * envelopes to /api/<project>/envelope/, and the oldest ones post single
 * events to /api/<project>/store/. An envelope
 * (https://develop.sentry.dev/sdk/data-model/envelopes/) is a header line
 * of JSON, then items: an item header line, then its payload. What is kept
 * of it becomes an OTLP ExportTraceServiceRequest and an
 * ExportLogsServiceRequest, queued like any OTLP export.
 *
 * WHAT EACH ITEM BECOMES
 *
 *   - An error event is one span with one "exception" event on it - the
 *     raised exception's type and message, and a stack trace written as the
 *     event's platform writes one (a Python traceback, a Java trace with its
 *     "Caused by:" blocks, ...), so the Exceptions product groups it, parses
 *     its frames and shows it as it would show an OpenTelemetry SDK's. The
 *     span hangs under the span that was active when it was raised, in that
 *     trace (contexts.trace), else in a trace of its own.
 *   - A message event (captureMessage, a logging integration's record) is a
 *     log record.
 *   - A transaction is its root span and one span per child span.
 *   - A log item's records are log records; a span item's spans are spans.
 *
 * Sessions, client reports, attachments, profiles, replays, check-ins,
 * metrics and user feedback are skipped (ignoredItemTypes says which), and
 * so are breadcrumbs, debug images and the module list of an event: none is
 * telemetry OneUptime stores this way.
 *
 * WHERE IT CAME FROM
 *
 * Telemetry is grouped into one resource per distinct origin: the service
 * (an x-oneuptime-service-name header, else a "service.name" or "service"
 * tag, else the name part of a "name@version" release - Sentry's own
 * convention; with none, service.name is left out and OneUptime files it
 * under Unknown Service), the release as service.version, the environment,
 * the server name as host.name, and the SDK. An item that says none of
 * these takes the release, environment and SDK the envelope header names.
 *
 * Every time is the item's own: Sentry writes seconds since the epoch, as
 * a fraction or an RFC 3339 string. One that is missing or unreadable is
 * now - never a negative, a zero or NaN.
 */

export class SentryEnvelopeError extends Error {
  public readonly statusCode: number;

  public constructor(message: string) {
    super(message);
    this.name = "SentryEnvelopeError";
    this.statusCode = 400;
  }
}

export interface SentryEnvelopeItem {
  header: JSONObject;
  payload: Buffer;
}

export interface ParsedSentryEnvelope {
  header: JSONObject;
  items: Array<SentryEnvelopeItem>;
  // Items past MAX_ENVELOPE_ITEMS: read past, not kept.
  droppedItemCount: number;
}

export interface SentryTranslateOptions {
  nowInMs?: number | undefined;
  // The x-oneuptime-service-name header: the service, whatever the items say.
  serviceName?: string | undefined;
}

/*
 * What was translated. Each thing is counted once: an error event is one
 * span (counted in errors, not spans), a message event is one log record
 * (counted in messages, not logs).
 */
export interface SentryAcceptedCounts {
  errors: number;
  messages: number;
  transactions: number;
  // The spans transactions (their root spans included) and span items became.
  spans: number;
  // The records log items became.
  logs: number;
}

export interface SentryTranslation {
  // An ExportTraceServiceRequest in OTLP JSON, or null when there are no spans.
  traces: JSONObject | null;
  // An ExportLogsServiceRequest in OTLP JSON, or null when there are no records.
  logs: JSONObject | null;
  /*
   * What Sentry answers with ({"id": ...}): the envelope header's event_id,
   * else the first event's or transaction's (one an event came without is
   * made up, as Sentry makes one up). Null when the envelope held neither.
   */
  eventId: string | null;
  accepted: SentryAcceptedCounts;
  // Item types skipped as not telemetry kept here, each named once.
  ignoredItemTypes: Array<string>;
  // Items of a kept type whose payload was not a JSON object.
  malformedItemCount: number;
}

export const MAX_ENVELOPE_ITEMS: number = 100;
export const MAX_FRAMES_PER_EXCEPTION: number = 250;
export const MAX_EXCEPTIONS_PER_CHAIN: number = 10;
export const MAX_STACK_TRACE_BYTES: number = 64 * 1024;
export const MAX_SPANS_PER_TRANSACTION: number = 1000;
export const MAX_LOG_RECORDS_PER_ENVELOPE: number = 1000;

const SCOPE_NAME: string = "sentry";

const SPAN_KIND_INTERNAL: number = 1;
const SPAN_KIND_SERVER: number = 2;
const SPAN_KIND_CLIENT: number = 3;
const SPAN_KIND_PRODUCER: number = 4;
const SPAN_KIND_CONSUMER: number = 5;

const STATUS_CODE_UNSET: number = 0;
const STATUS_CODE_OK: number = 1;
const STATUS_CODE_ERROR: number = 2;

const NEWLINE: number = 0x0a;

// The body of an event with neither an exception nor a message, as Sentry titles one.
const UNLABELED_EVENT: string = "<unlabeled event>";

// An item type is at most this long where ignoredItemTypes names it.
const MAX_ITEM_TYPE_LENGTH: number = 64;

const TRUNCATED_STACK_TRACE_MARKER: string = "...(truncated)";

const PYTHON_DIRECT_CAUSE: string =
  "The above exception was the direct cause of the following exception:";
const PYTHON_DURING_HANDLING: string =
  "During handling of the above exception, another exception occurred:";

const DECIMAL_SECONDS: RegExp = /^\d+(\.\d+)?$/;
const RFC3339: RegExp =
  /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:?\d{2})?$/;
const ALL_ZEROS: RegExp = /^0+$/;
const DIGITS: RegExp = /^\d+$/;
const INTEGER_TEXT: RegExp = /^-?\d{1,19}$/;
const DECIMAL_TEXT: RegExp = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
// A module that names an assembly ("System.Private.CoreLib, Version=...").
const NOT_A_NAMESPACE: RegExp = /[\s,]/;

const INT64_MIN: bigint = BigInt("-9223372036854775808");
const INT64_MAX: bigint = BigInt("9223372036854775807");

/*
 * How a platform writes a stack trace. Each style is the one its runtime
 * prints, close enough that StackTraceParser reads its frames.
 */
type StackStyle = "python" | "v8" | "jvm" | "dotnet" | "go" | "ruby" | "php";

const STACK_STYLE_BY_PLATFORM: ReadonlyMap<string, StackStyle> = new Map<
  string,
  StackStyle
>([
  ["python", "python"],
  ["javascript", "v8"],
  ["node", "v8"],
  ["java", "jvm"],
  ["kotlin", "jvm"],
  ["scala", "jvm"],
  ["groovy", "jvm"],
  ["clojure", "jvm"],
  ["csharp", "dotnet"],
  ["go", "go"],
  ["ruby", "ruby"],
  ["php", "php"],
]);

/*
 * Sentry's platform as OpenTelemetry's telemetry.sdk.language, the values
 * OneUptime picks a service's runtime by (Common/Types/Service/
 * ServiceLanguage). A platform not listed is kept as it is.
 */
const LANGUAGE_BY_PLATFORM: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["python", "python"],
  ["node", "nodejs"],
  ["javascript", "webjs"],
  ["java", "java"],
  ["kotlin", "java"],
  ["scala", "java"],
  ["groovy", "java"],
  ["clojure", "java"],
  ["csharp", "dotnet"],
  ["go", "go"],
  ["ruby", "ruby"],
  ["php", "php"],
  ["elixir", "erlang"],
  ["cocoa", "swift"],
  ["objc", "swift"],
  ["native", "cpp"],
  ["rust", "rust"],
]);

/*
 * The SDK's name as the language, for what comes without a platform (log
 * and span items). A name matches itself and its dotted variants
 * ("sentry.java" is also "sentry.java.android", never "sentry.javascript").
 * The JavaScript meta-frameworks run on both sides and say nothing.
 */
const LANGUAGE_BY_SDK_NAME: ReadonlyArray<[name: string, language: string]> = [
  ["sentry.python", "python"],
  ["sentry.javascript.node", "nodejs"],
  ["sentry.javascript.bun", "nodejs"],
  ["sentry.javascript.deno", "nodejs"],
  ["sentry.javascript.browser", "webjs"],
  ["sentry.javascript.react", "webjs"],
  ["sentry.javascript.vue", "webjs"],
  ["sentry.javascript.angular", "webjs"],
  ["sentry.javascript.svelte", "webjs"],
  ["sentry.javascript.ember", "webjs"],
  ["sentry.java", "java"],
  ["sentry.dotnet", "dotnet"],
  ["sentry.go", "go"],
  ["sentry.ruby", "ruby"],
  ["sentry.php", "php"],
  ["sentry.cocoa", "swift"],
  ["sentry.native", "cpp"],
  ["sentry.rust", "rust"],
  ["sentry.elixir", "erlang"],
];

// Modules an exception type is never qualified with: Python's builtins and __main__.
const UNQUALIFIED_MODULES: ReadonlySet<string> = new Set<string>([
  "__main__",
  "builtins",
  "__builtin__",
  "exceptions",
]);

// An event's contexts, and the attribute each field becomes.
const CONTEXT_FIELDS: ReadonlyArray<
  [context: string, field: string, attribute: string]
> = [
  ["os", "name", "os.name"],
  ["os", "version", "os.version"],
  ["browser", "name", "browser.name"],
  ["browser", "version", "browser.version"],
  ["runtime", "name", "process.runtime.name"],
  ["runtime", "version", "process.runtime.version"],
  ["device", "model", "device.model"],
  ["device", "manufacturer", "device.manufacturer"],
];

// Child span ops that call out of the process, and the kind each is.
const CLIENT_OPS: ReadonlyArray<string> = [
  "http.client",
  "db",
  "cache",
  "grpc.client",
  "rpc",
];
const PRODUCER_OPS: ReadonlyArray<string> = ["queue.publish", "queue.submit"];
const CONSUMER_OPS: ReadonlyArray<string> = ["queue.process", "queue.receive"];
const SERVER_OPS: ReadonlyArray<string> = ["http.server", "grpc.server"];

const TRANSLATED_ITEM_TYPES: ReadonlySet<string> = new Set<string>([
  "event",
  "transaction",
  "log",
  "span",
]);

// What an item says about where it came from.
interface ResourceInfo {
  serviceName: string;
  release: string;
  environment: string;
  hostName: string;
  sdkName: string;
  sdkVersion: string;
  language: string;
}

// What the envelope header says, for items that do not say it themselves.
interface EnvelopeDefaults {
  eventId: string;
  release: string;
  environment: string;
  sdkName: string;
  sdkVersion: string;
}

interface ResourceBucket {
  attributes: Array<OtlpKeyValue>;
  spans: Array<JSONObject>;
  logRecords: Array<JSONObject>;
}

interface TranslationState {
  nowUnixNano: string;
  serviceName: string;
  resources: Map<string, ResourceBucket>;
  accepted: SentryAcceptedCounts;
  ignoredItemTypes: Array<string>;
  malformedItemCount: number;
  eventId: string | null;
  // Records from log items so far, against MAX_LOG_RECORDS_PER_ENVELOPE.
  logItemRecordCount: number;
}

// One frame, as a stack trace is written from it.
interface StackFrameText {
  function: string;
  module: string;
  file: string;
  lineno: number | null;
  colno: number | null;
  contextLine: string;
  native: boolean;
}

// One exception of a chain, as a stack trace is written from it.
interface ExceptionText {
  type: string;
  message: string;
  // "<Type>: <message>", or whichever of the two it has, or "Error".
  title: string;
  // Oldest (the caller) first, as Sentry orders them.
  frames: Array<StackFrameText>;
  // mechanism.source: how it relates to the exception after it (Python's __cause__ / __context__).
  source: string;
}

const NO_DEFAULTS: EnvelopeDefaults = {
  eventId: "",
  release: "",
  environment: "",
  sdkName: "",
  sdkVersion: "",
};

export default class SentryEnvelope {
  /*
   * An envelope: its header line and its items. An item whose header has a
   * length is exactly that many bytes (an attachment's may hold newlines or
   * be binary), then an optional newline; one without runs to the next
   * newline. Blank lines between items are skipped. A header that is not a
   * JSON object, or a length that is not one or runs past the end, is a
   * malformed envelope (SentryEnvelopeError, a 400). Items past
   * MAX_ENVELOPE_ITEMS are read past and counted, not kept - and a
   * malformed one there ends the envelope instead of failing it.
   */
  public static parseEnvelope(body: Buffer): ParsedSentryEnvelope {
    const headerEnd: number = body.indexOf(NEWLINE);
    const header: JSONObject | null = SentryEnvelope.parseHeaderLine(
      body,
      0,
      headerEnd === -1 ? body.length : headerEnd,
    );

    if (!header) {
      throw new SentryEnvelopeError(
        "The envelope header (its first line) is not a JSON object.",
      );
    }

    const items: Array<SentryEnvelopeItem> = [];
    let droppedItemCount: number = 0;
    let offset: number = headerEnd === -1 ? body.length : headerEnd + 1;

    while (offset < body.length) {
      const lineEnd: number = body.indexOf(NEWLINE, offset);
      const headerLineEnd: number = lineEnd === -1 ? body.length : lineEnd;

      if (SentryEnvelope.isBlank(body, offset, headerLineEnd)) {
        offset = headerLineEnd + 1;
        continue;
      }

      const isPastCap: boolean = items.length >= MAX_ENVELOPE_ITEMS;
      const itemHeader: JSONObject | null = SentryEnvelope.parseHeaderLine(
        body,
        offset,
        headerLineEnd,
      );

      if (!itemHeader) {
        if (isPastCap) {
          break;
        }

        throw new SentryEnvelopeError(
          `The header of item ${items.length + 1} is not a JSON object.`,
        );
      }

      const payloadStart: number =
        lineEnd === -1 ? body.length : headerLineEnd + 1;
      const declaredLength: unknown = itemHeader["length"];
      let payload: Buffer;

      if (declaredLength === undefined || declaredLength === null) {
        const payloadLineEnd: number = body.indexOf(NEWLINE, payloadStart);
        const payloadEnd: number =
          payloadLineEnd === -1 ? body.length : payloadLineEnd;

        payload = body.subarray(payloadStart, payloadEnd);
        offset = payloadEnd + 1;
      } else {
        const length: number | null =
          SentryEnvelope.nonNegativeInteger(declaredLength);

        if (length === null || payloadStart + length > body.length) {
          if (isPastCap) {
            break;
          }

          throw new SentryEnvelopeError(
            length === null
              ? `The length of item ${items.length + 1} is not a whole number of bytes.`
              : `Item ${items.length + 1} says it is ${length} bytes long, past the end of the envelope.`,
          );
        }

        payload = body.subarray(payloadStart, payloadStart + length);
        offset = payloadStart + length;

        if (body[offset] === NEWLINE) {
          offset++;
        }
      }

      if (isPastCap) {
        droppedItemCount++;
      } else {
        items.push({ header: itemHeader, payload: payload });
      }
    }

    return {
      header: header,
      items: items,
      droppedItemCount: droppedItemCount,
    };
  }

  public static fromEnvelope(
    envelope: ParsedSentryEnvelope,
    options: SentryTranslateOptions = {},
  ): SentryTranslation {
    const state: TranslationState = SentryEnvelope.newState(options);
    const trace: JSONObject = SentryEnvelope.objectOf(envelope.header["trace"]);
    const sdk: JSONObject = SentryEnvelope.objectOf(envelope.header["sdk"]);

    const defaults: EnvelopeDefaults = {
      eventId: OtlpJson.hexId(envelope.header["event_id"], 32),
      release: SentryEnvelope.readString(trace["release"]),
      environment: SentryEnvelope.readString(trace["environment"]),
      sdkName: SentryEnvelope.readString(sdk["name"]),
      sdkVersion: SentryEnvelope.readString(sdk["version"]),
    };

    state.eventId = defaults.eventId || null;

    for (const item of envelope.items) {
      SentryEnvelope.translateItem(state, item, defaults);
    }

    return SentryEnvelope.finish(state);
  }

  /*
   * The legacy store endpoint's body: one event - an error or message event,
   * or a transaction when its type says so.
   */
  public static fromStoreEvent(
    event: JSONObject,
    options: SentryTranslateOptions = {},
  ): SentryTranslation {
    const state: TranslationState = SentryEnvelope.newState(options);

    if (SentryEnvelope.isObject(event)) {
      SentryEnvelope.translateEvent(
        state,
        event,
        NO_DEFAULTS,
        SentryEnvelope.readString(event["type"]) === "transaction",
      );
    }

    return SentryEnvelope.finish(state);
  }

  private static newState(options: SentryTranslateOptions): TranslationState {
    return {
      nowUnixNano: OtlpJson.nowUnixNano(options.nowInMs),
      serviceName: SentryEnvelope.readString(options.serviceName),
      resources: new Map<string, ResourceBucket>(),
      accepted: { errors: 0, messages: 0, transactions: 0, spans: 0, logs: 0 },
      ignoredItemTypes: [],
      malformedItemCount: 0,
      eventId: null,
      logItemRecordCount: 0,
    };
  }

  private static finish(state: TranslationState): SentryTranslation {
    const resourceSpans: Array<JSONObject> = [];
    const resourceLogs: Array<JSONObject> = [];

    for (const bucket of state.resources.values()) {
      const resource: JSONObject = {
        attributes: bucket.attributes,
      } as unknown as JSONObject;

      if (bucket.spans.length > 0) {
        resourceSpans.push({
          resource: resource,
          scopeSpans: [{ scope: { name: SCOPE_NAME }, spans: bucket.spans }],
        } as unknown as JSONObject);
      }

      if (bucket.logRecords.length > 0) {
        resourceLogs.push({
          resource: resource,
          scopeLogs: [
            { scope: { name: SCOPE_NAME }, logRecords: bucket.logRecords },
          ],
        } as unknown as JSONObject);
      }
    }

    return {
      traces:
        resourceSpans.length > 0 ? { resourceSpans: resourceSpans } : null,
      logs: resourceLogs.length > 0 ? { resourceLogs: resourceLogs } : null,
      eventId: state.eventId,
      accepted: state.accepted,
      ignoredItemTypes: state.ignoredItemTypes,
      malformedItemCount: state.malformedItemCount,
    };
  }

  private static translateItem(
    state: TranslationState,
    item: SentryEnvelopeItem,
    defaults: EnvelopeDefaults,
  ): void {
    const type: string =
      SentryEnvelope.readString(item.header["type"]) || "unknown";

    if (!TRANSLATED_ITEM_TYPES.has(type)) {
      const name: string = type.slice(0, MAX_ITEM_TYPE_LENGTH);

      if (!state.ignoredItemTypes.includes(name)) {
        state.ignoredItemTypes.push(name);
      }

      return;
    }

    const payload: JSONObject | null = SentryEnvelope.parseJsonObject(
      item.payload,
    );

    if (!payload) {
      state.malformedItemCount++;
      return;
    }

    if (type === "log") {
      SentryEnvelope.translateLogItem(state, payload, defaults);
    } else if (type === "span") {
      SentryEnvelope.translateSpanItem(state, payload, defaults);
    } else {
      SentryEnvelope.translateEvent(
        state,
        payload,
        defaults,
        type === "transaction" ||
          SentryEnvelope.readString(payload["type"]) === "transaction",
      );
    }
  }

  private static translateEvent(
    state: TranslationState,
    event: JSONObject,
    defaults: EnvelopeDefaults,
    isTransaction: boolean,
  ): void {
    const eventId: string =
      OtlpJson.hexId(event["event_id"], 32) ||
      defaults.eventId ||
      SentryEnvelope.newEventId();

    if (state.eventId === null) {
      state.eventId = eventId;
    }

    const resource: ResourceInfo = SentryEnvelope.eventResource(
      event,
      defaults,
    );

    if (isTransaction) {
      SentryEnvelope.translateTransaction(state, event, eventId, resource);
      return;
    }

    const exceptions: Array<JSONObject> =
      SentryEnvelope.exceptionValuesOf(event);

    if (exceptions.length > 0) {
      SentryEnvelope.translateError(
        state,
        event,
        exceptions,
        eventId,
        resource,
      );
    } else {
      SentryEnvelope.translateMessage(state, event, eventId, resource);
    }
  }

  /*
   * An error event: one span, carrying one "exception" event. Its trace is
   * the one contexts.trace names (under the span that was active), else one
   * of its own, named by the event ID; its own span ID is the event ID's
   * last 16 digits, so a retried event is the same span.
   */
  private static translateError(
    state: TranslationState,
    event: JSONObject,
    exceptions: Array<JSONObject>,
    eventId: string,
    resource: ResourceInfo,
  ): void {
    const time: string =
      SentryEnvelope.timeOf(event["timestamp"]) ?? state.nowUnixNano;
    const trace: JSONObject = SentryEnvelope.objectOf(
      SentryEnvelope.objectOf(event["contexts"])["trace"],
    );
    const contextTraceId: string = OtlpJson.hexId(trace["trace_id"], 32);
    const parentSpanId: string = contextTraceId
      ? OtlpJson.hexId(trace["span_id"], 16)
      : "";

    const chain: Array<JSONObject> = exceptions.slice(
      -MAX_EXCEPTIONS_PER_CHAIN,
    );
    const raised: JSONObject = chain[chain.length - 1]!;
    const style: StackStyle = SentryEnvelope.stackStyleOf(event, raised);
    const exceptionType: string = SentryEnvelope.exceptionTypeOf(raised, style);
    const exceptionMessage: string = SentryEnvelope.readText(raised["value"]);
    const mechanism: JSONObject = SentryEnvelope.objectOf(raised["mechanism"]);
    const handled: boolean | null = SentryEnvelope.handledOf(chain);
    const level: string = SentryEnvelope.readString(event["level"]);

    const exceptionAttributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      exceptionAttributes,
      OtlpJson.stringAttribute("exception.type", exceptionType),
      OtlpJson.stringAttribute("exception.message", exceptionMessage),
      OtlpJson.stringAttribute(
        "exception.stacktrace",
        SentryEnvelope.renderStackTrace(chain, style, {
          isPanic: level === "fatal" || handled === false,
        }),
      ),
      handled === null
        ? null
        : OtlpJson.attribute("exception.escaped", !handled),
      OtlpJson.stringAttribute(
        "sentry.mechanism.type",
        SentryEnvelope.readString(mechanism["type"]),
      ),
    );

    const attributes: Array<OtlpKeyValue> = SentryEnvelope.eventAttributes(
      event,
      eventId,
    );

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute(
        "sentry.message",
        SentryEnvelope.messageOf(event),
      ),
    );

    const title: string = SentryEnvelope.titleOf(
      exceptionType,
      exceptionMessage,
    );

    SentryEnvelope.addSpan(state, resource, {
      traceId: contextTraceId || eventId,
      spanId: SentryEnvelope.spanIdFromEventId(eventId),
      ...(parentSpanId ? { parentSpanId: parentSpanId } : {}),
      name:
        SentryEnvelope.readString(event["transaction"]) ||
        exceptionType ||
        "error",
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: time,
      endTimeUnixNano: time,
      attributes: SentryEnvelope.uniqueByKey(attributes),
      events: [
        {
          timeUnixNano: time,
          name: "exception",
          attributes: exceptionAttributes,
        },
      ],
      status: title
        ? { code: STATUS_CODE_ERROR, message: title }
        : { code: STATUS_CODE_ERROR },
    } as unknown as JSONObject);

    state.accepted.errors++;
  }

  /*
   * A message event (captureMessage, a logging integration's record): a log
   * record, at the event's level - Sentry's default, error, when it names
   * none.
   */
  private static translateMessage(
    state: TranslationState,
    event: JSONObject,
    eventId: string,
    resource: ResourceInfo,
  ): void {
    const level: string = SentryEnvelope.readString(event["level"]);
    const severity: OtlpSeverity = level
      ? OtlpJson.severityFromWord(level)
      : OTLP_SEVERITY_ERROR;
    const trace: JSONObject = SentryEnvelope.objectOf(
      SentryEnvelope.objectOf(event["contexts"])["trace"],
    );
    const traceId: string = OtlpJson.hexId(trace["trace_id"], 32);
    const spanId: string = OtlpJson.hexId(trace["span_id"], 16);

    SentryEnvelope.addLogRecord(state, resource, {
      timeUnixNano:
        SentryEnvelope.timeOf(event["timestamp"]) ?? state.nowUnixNano,
      observedTimeUnixNano: state.nowUnixNano,
      severityNumber: severity.number,
      severityText: severity.text || level.toUpperCase(),
      body: {
        stringValue: SentryEnvelope.messageOf(event) || UNLABELED_EVENT,
      },
      attributes: SentryEnvelope.uniqueByKey(
        SentryEnvelope.eventAttributes(event, eventId),
      ),
      ...(traceId ? { traceId: traceId } : {}),
      ...(traceId && spanId ? { spanId: spanId } : {}),
    } as unknown as JSONObject);

    state.accepted.messages++;
  }

  /*
   * A transaction: its root span, from contexts.trace, and one span per
   * child span (at most MAX_SPANS_PER_TRANSACTION; one without a span ID, a
   * start or an end is left out). A child without a valid parent hangs under
   * the root.
   */
  private static translateTransaction(
    state: TranslationState,
    event: JSONObject,
    eventId: string,
    resource: ResourceInfo,
  ): void {
    const trace: JSONObject = SentryEnvelope.objectOf(
      SentryEnvelope.objectOf(event["contexts"])["trace"],
    );
    const traceId: string = OtlpJson.hexId(trace["trace_id"], 32) || eventId;
    const spanId: string =
      OtlpJson.hexId(trace["span_id"], 16) ||
      SentryEnvelope.spanIdFromEventId(eventId);
    const parentSpanId: string = OtlpJson.hexId(trace["parent_span_id"], 16);
    const end: string | null = SentryEnvelope.timeOf(event["timestamp"]);
    const start: string =
      SentryEnvelope.timeOf(event["start_timestamp"]) ??
      end ??
      state.nowUnixNano;
    const op: string = SentryEnvelope.readString(trace["op"]).toLowerCase();

    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(attributes, OtlpJson.stringAttribute("sentry.op", op));

    const data: unknown = trace["data"];

    if (SentryEnvelope.isObject(data)) {
      attributes.push(...OtlpJson.attributesFromObject(data));
    }

    const measurements: JSONObject = SentryEnvelope.objectOf(
      event["measurements"],
    );

    for (const name of Object.keys(measurements)) {
      OtlpJson.pushAll(
        attributes,
        OtlpJson.attribute(
          `sentry.measurement.${name}`,
          SentryEnvelope.objectOf(measurements[name])["value"],
        ),
      );
    }

    attributes.push(...SentryEnvelope.eventAttributes(event, eventId));

    SentryEnvelope.addSpan(state, resource, {
      traceId: traceId,
      spanId: spanId,
      ...(parentSpanId ? { parentSpanId: parentSpanId } : {}),
      name:
        SentryEnvelope.readString(event["transaction"]) || op || "transaction",
      kind: SentryEnvelope.rootSpanKind(op),
      startTimeUnixNano: start,
      endTimeUnixNano: SentryEnvelope.notBefore(end ?? start, start),
      attributes: SentryEnvelope.uniqueByKey(attributes),
      status: SentryEnvelope.spanStatus(trace["status"]),
    } as unknown as JSONObject);

    state.accepted.transactions++;
    state.accepted.spans++;

    const children: Array<unknown> = Array.isArray(event["spans"])
      ? (event["spans"] as Array<unknown>).slice(0, MAX_SPANS_PER_TRANSACTION)
      : [];

    for (const child of children) {
      if (!SentryEnvelope.isObject(child)) {
        continue;
      }

      const span: JSONObject | null = SentryEnvelope.childSpan(child, {
        traceId: traceId,
        parentSpanId: spanId,
      });

      if (span) {
        SentryEnvelope.addSpan(state, resource, span);
        state.accepted.spans++;
      }
    }
  }

  /*
   * A span as a transaction's spans and a standalone span item write it.
   * `fallback` is what a transaction's child takes when it names no trace or
   * parent: its root's trace, and the root as its parent.
   */
  private static childSpan(
    span: JSONObject,
    fallback: { traceId: string; parentSpanId: string },
  ): JSONObject | null {
    const spanId: string = OtlpJson.hexId(span["span_id"], 16);
    const traceId: string =
      OtlpJson.hexId(span["trace_id"], 32) || fallback.traceId;
    const start: string | null = SentryEnvelope.timeOf(span["start_timestamp"]);
    const end: string | null = SentryEnvelope.timeOf(span["timestamp"]);

    if (!spanId || !traceId || start === null || end === null) {
      return null;
    }

    const parentSpanId: string =
      OtlpJson.hexId(span["parent_span_id"], 16) || fallback.parentSpanId;
    const op: string = SentryEnvelope.readString(span["op"]).toLowerCase();
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(attributes, OtlpJson.stringAttribute("sentry.op", op));

    const data: unknown = span["data"];

    if (SentryEnvelope.isObject(data)) {
      attributes.push(...OtlpJson.attributesFromObject(data));
    }

    attributes.push(...SentryEnvelope.tagAttributes(span["tags"]));

    return {
      traceId: traceId,
      spanId: spanId,
      ...(parentSpanId && parentSpanId !== spanId
        ? { parentSpanId: parentSpanId }
        : {}),
      name:
        SentryEnvelope.readString(span["description"]) ||
        op ||
        SentryEnvelope.readString(span["name"]) ||
        "span",
      kind:
        span["is_segment"] === true
          ? SentryEnvelope.rootSpanKind(op)
          : SentryEnvelope.childSpanKind(op),
      startTimeUnixNano: start,
      endTimeUnixNano: SentryEnvelope.notBefore(end, start),
      attributes: SentryEnvelope.uniqueByKey(attributes),
      status: SentryEnvelope.spanStatus(span["status"]),
    } as unknown as JSONObject;
  }

  /*
   * A span item: one span, as a transaction's children write them, or - in
   * the newer protocol - {"items": [...]}, each with its attributes typed as
   * a log item's are.
   */
  private static translateSpanItem(
    state: TranslationState,
    payload: JSONObject,
    defaults: EnvelopeDefaults,
  ): void {
    if (!Array.isArray(payload["items"])) {
      const data: JSONObject = SentryEnvelope.objectOf(payload["data"]);
      const span: JSONObject | null = SentryEnvelope.childSpan(payload, {
        traceId: "",
        parentSpanId: "",
      });

      if (!span) {
        state.malformedItemCount++;
        return;
      }

      SentryEnvelope.addSpan(
        state,
        SentryEnvelope.attributeResource((key: string): string => {
          return SentryEnvelope.readScalar(data[key]);
        }, defaults),
        span,
      );
      state.accepted.spans++;
      return;
    }

    for (const item of payload["items"] as Array<unknown>) {
      if (!SentryEnvelope.isObject(item)) {
        continue;
      }

      const typed: unknown = item["attributes"];
      const spanId: string = OtlpJson.hexId(item["span_id"], 16);
      const traceId: string = OtlpJson.hexId(item["trace_id"], 32);
      const start: string | null = SentryEnvelope.timeOf(
        item["start_timestamp"],
      );
      const end: string | null = SentryEnvelope.timeOf(item["end_timestamp"]);

      if (!spanId || !traceId || start === null || end === null) {
        continue;
      }

      const parentSpanId: string = OtlpJson.hexId(item["parent_span_id"], 16);
      const op: string = SentryEnvelope.typedValue(
        typed,
        "sentry.op",
      ).toLowerCase();

      SentryEnvelope.addSpan(
        state,
        SentryEnvelope.typedResource(typed, defaults),
        {
          traceId: traceId,
          spanId: spanId,
          ...(parentSpanId && parentSpanId !== spanId
            ? { parentSpanId: parentSpanId }
            : {}),
          name: SentryEnvelope.readString(item["name"]) || op || "span",
          kind:
            item["is_segment"] === true
              ? SentryEnvelope.rootSpanKind(op)
              : SentryEnvelope.childSpanKind(op),
          startTimeUnixNano: start,
          endTimeUnixNano: SentryEnvelope.notBefore(end, start),
          attributes: SentryEnvelope.uniqueByKey(
            SentryEnvelope.typedAttributes(typed),
          ),
          status: SentryEnvelope.spanStatus(item["status"]),
        } as unknown as JSONObject,
      );
      state.accepted.spans++;
    }
  }

  /*
   * A log item: {"items": [...]}, each a record with a time, a level, a body
   * and typed attributes ({"key": {"value": ..., "type": "string" |
   * "boolean" | "integer" | "double"}}), kept under their own names. Its
   * sentry.release, sentry.environment and sentry.sdk.* attributes also say
   * where it came from. At most MAX_LOG_RECORDS_PER_ENVELOPE records an
   * envelope.
   */
  private static translateLogItem(
    state: TranslationState,
    payload: JSONObject,
    defaults: EnvelopeDefaults,
  ): void {
    const items: Array<unknown> = Array.isArray(payload["items"])
      ? (payload["items"] as Array<unknown>)
      : [payload];

    for (const item of items) {
      if (state.logItemRecordCount >= MAX_LOG_RECORDS_PER_ENVELOPE) {
        return;
      }

      if (!SentryEnvelope.isObject(item)) {
        continue;
      }

      const typed: unknown = item["attributes"];
      const level: string = SentryEnvelope.readString(item["level"]);
      const severity: OtlpSeverity = SentryEnvelope.logSeverity(
        item["severity_number"],
        level,
      );
      const traceId: string = OtlpJson.hexId(item["trace_id"], 32);
      const spanId: string =
        OtlpJson.hexId(item["span_id"], 16) ||
        OtlpJson.hexId(
          SentryEnvelope.typedValue(typed, "sentry.trace.parent_span_id"),
          16,
        );

      SentryEnvelope.addLogRecord(
        state,
        SentryEnvelope.typedResource(typed, defaults),
        {
          timeUnixNano:
            SentryEnvelope.timeOf(item["timestamp"]) ?? state.nowUnixNano,
          observedTimeUnixNano: state.nowUnixNano,
          severityNumber: severity.number,
          severityText: severity.text || level.toUpperCase(),
          body: { stringValue: SentryEnvelope.readText(item["body"]) },
          attributes: SentryEnvelope.uniqueByKey(
            SentryEnvelope.typedAttributes(typed),
          ),
          ...(traceId ? { traceId: traceId } : {}),
          ...(traceId && spanId ? { spanId: spanId } : {}),
        } as unknown as JSONObject,
      );

      state.logItemRecordCount++;
      state.accepted.logs++;
    }
  }

  // A log record's severity: its severity_number when it is OpenTelemetry's (1-24), else its level.
  private static logSeverity(
    severityNumber: unknown,
    level: string,
  ): OtlpSeverity {
    const fromLevel: OtlpSeverity = OtlpJson.severityFromWord(level);

    if (
      typeof severityNumber === "number" &&
      Number.isInteger(severityNumber) &&
      severityNumber >= 1 &&
      severityNumber <= 24
    ) {
      return {
        number: severityNumber,
        text:
          fromLevel.number > 0
            ? fromLevel.text
            : SentryEnvelope.severityTextOfNumber(severityNumber),
      };
    }

    return fromLevel;
  }

  private static severityTextOfNumber(severityNumber: number): string {
    const texts: Array<string> = [
      "TRACE",
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
      "FATAL",
    ];

    return texts[Math.floor((severityNumber - 1) / 4)] || "";
  }

  private static addSpan(
    state: TranslationState,
    info: ResourceInfo,
    span: JSONObject,
  ): void {
    SentryEnvelope.bucketOf(state, info).spans.push(span);
  }

  private static addLogRecord(
    state: TranslationState,
    info: ResourceInfo,
    logRecord: JSONObject,
  ): void {
    SentryEnvelope.bucketOf(state, info).logRecords.push(logRecord);
  }

  private static bucketOf(
    state: TranslationState,
    info: ResourceInfo,
  ): ResourceBucket {
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute(
        "service.name",
        state.serviceName ||
          info.serviceName ||
          SentryEnvelope.serviceNameOfRelease(info.release),
      ),
      OtlpJson.stringAttribute("service.version", info.release),
      OtlpJson.stringAttribute("deployment.environment.name", info.environment),
      OtlpJson.stringAttribute("host.name", info.hostName),
      OtlpJson.stringAttribute("telemetry.sdk.name", info.sdkName),
      OtlpJson.stringAttribute("telemetry.sdk.version", info.sdkVersion),
      OtlpJson.stringAttribute("telemetry.sdk.language", info.language),
    );

    const key: string = JSON.stringify(attributes);
    let bucket: ResourceBucket | undefined = state.resources.get(key);

    if (!bucket) {
      bucket = { attributes: attributes, spans: [], logRecords: [] };
      state.resources.set(key, bucket);
    }

    return bucket;
  }

  // "checkout@1.4.2" names the service "checkout"; a release without a name part names none.
  private static serviceNameOfRelease(release: string): string {
    const at: number = release.lastIndexOf("@");

    if (at <= 0 || at === release.length - 1) {
      return "";
    }

    return release.slice(0, at).trim();
  }

  private static eventResource(
    event: JSONObject,
    defaults: EnvelopeDefaults,
  ): ResourceInfo {
    const tags: Array<[string, string]> = SentryEnvelope.tagsOf(event["tags"]);
    const sdk: JSONObject = SentryEnvelope.objectOf(event["sdk"]);
    const sdkName: string = SentryEnvelope.readString(sdk["name"]);
    const platform: string = SentryEnvelope.readString(
      event["platform"],
    ).toLowerCase();

    const tag: (name: string) => string = (name: string): string => {
      for (const [key, value] of tags) {
        if (key === name) {
          return value;
        }
      }

      return "";
    };

    return {
      serviceName: tag("service.name") || tag("service"),
      release: SentryEnvelope.readString(event["release"]) || defaults.release,
      environment:
        SentryEnvelope.readString(event["environment"]) || defaults.environment,
      hostName: SentryEnvelope.readString(event["server_name"]),
      sdkName: sdkName || defaults.sdkName,
      sdkVersion: sdkName
        ? SentryEnvelope.readString(sdk["version"])
        : defaults.sdkVersion,
      language: SentryEnvelope.languageOf(
        platform,
        sdkName || defaults.sdkName,
      ),
    };
  }

  // Where a log record or a span item came from, read from its attributes.
  private static attributeResource(
    read: (key: string) => string,
    defaults: EnvelopeDefaults,
  ): ResourceInfo {
    const sdkName: string = read("sentry.sdk.name");

    return {
      serviceName: read("service.name"),
      release: read("sentry.release") || defaults.release,
      environment: read("sentry.environment") || defaults.environment,
      hostName: read("server.address"),
      sdkName: sdkName || defaults.sdkName,
      sdkVersion: sdkName ? read("sentry.sdk.version") : defaults.sdkVersion,
      language: SentryEnvelope.languageOf("", sdkName || defaults.sdkName),
    };
  }

  private static typedResource(
    typed: unknown,
    defaults: EnvelopeDefaults,
  ): ResourceInfo {
    return SentryEnvelope.attributeResource((key: string): string => {
      return SentryEnvelope.typedValue(typed, key);
    }, defaults);
  }

  private static languageOf(platform: string, sdkName: string): string {
    if (platform && platform !== "other") {
      return LANGUAGE_BY_PLATFORM.get(platform) || platform;
    }

    const name: string = sdkName.toLowerCase();

    for (const [sdk, language] of LANGUAGE_BY_SDK_NAME) {
      if (name === sdk || name.startsWith(`${sdk}.`)) {
        return language;
      }
    }

    return "";
  }

  /*
   * What an event says beyond its exception or message: its ID, level,
   * platform and logger; its user, request and contexts under OpenTelemetry's
   * names; its tags as they are; its fingerprint and extra data under
   * sentry.*. Breadcrumbs, debug images and the module list are left out.
   */
  private static eventAttributes(
    event: JSONObject,
    eventId: string,
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute("sentry.event_id", eventId),
      OtlpJson.stringAttribute(
        "sentry.level",
        SentryEnvelope.readString(event["level"]),
      ),
      OtlpJson.stringAttribute(
        "sentry.platform",
        SentryEnvelope.readString(event["platform"]),
      ),
      OtlpJson.stringAttribute(
        "sentry.logger",
        SentryEnvelope.readString(event["logger"]),
      ),
    );

    const user: JSONObject = SentryEnvelope.objectOf(
      event["user"] ?? event["sentry.interfaces.User"],
    );
    const ipAddress: string = SentryEnvelope.readString(user["ip_address"]);

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute(
        "user.id",
        SentryEnvelope.readScalar(user["id"]),
      ),
      OtlpJson.stringAttribute(
        "user.email",
        SentryEnvelope.readString(user["email"]),
      ),
      OtlpJson.stringAttribute(
        "user.name",
        SentryEnvelope.readString(user["username"]) ||
          SentryEnvelope.readString(user["name"]),
      ),
      // "{{auto}}" asks Sentry to fill in the address the report came from.
      OtlpJson.stringAttribute(
        "client.address",
        ipAddress.startsWith("{{") ? "" : ipAddress,
      ),
    );

    const request: JSONObject = SentryEnvelope.objectOf(
      event["request"] ?? event["sentry.interfaces.Http"],
    );
    const queryString: string = SentryEnvelope.readString(
      request["query_string"],
    );

    OtlpJson.pushAll(
      attributes,
      OtlpJson.stringAttribute(
        "url.full",
        SentryEnvelope.readString(request["url"]),
      ),
      OtlpJson.stringAttribute(
        "url.query",
        queryString.startsWith("?") ? queryString.slice(1) : queryString,
      ),
      OtlpJson.stringAttribute(
        "http.request.method",
        SentryEnvelope.readString(request["method"]),
      ),
      OtlpJson.stringAttribute(
        "user_agent.original",
        SentryEnvelope.headerValue(request["headers"], "user-agent"),
      ),
    );

    const contexts: JSONObject = SentryEnvelope.objectOf(event["contexts"]);

    for (const [context, field, attribute] of CONTEXT_FIELDS) {
      OtlpJson.pushAll(
        attributes,
        OtlpJson.stringAttribute(
          attribute,
          SentryEnvelope.readScalar(
            SentryEnvelope.objectOf(contexts[context])[field],
          ),
        ),
      );
    }

    attributes.push(...SentryEnvelope.tagAttributes(event["tags"]));

    if (Array.isArray(event["fingerprint"])) {
      OtlpJson.pushAll(
        attributes,
        OtlpJson.stringAttribute(
          "sentry.fingerprint",
          JSON.stringify(event["fingerprint"]),
        ),
      );
    }

    const extra: unknown = event["extra"];

    if (SentryEnvelope.isObject(extra)) {
      attributes.push(
        ...OtlpJson.attributesFromObject(extra, { prefix: "sentry.extra" }),
      );
    }

    return attributes;
  }

  // Tags - an object, or an array of [key, value] pairs - as string attributes.
  private static tagAttributes(tags: unknown): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    for (const [key, value] of SentryEnvelope.tagsOf(tags)) {
      attributes.push({ key: key, value: { stringValue: value } });
    }

    return attributes;
  }

  private static tagsOf(tags: unknown): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];

    const add: (key: unknown, value: unknown) => void = (
      key: unknown,
      value: unknown,
    ): void => {
      const name: string = SentryEnvelope.readString(key);
      const text: string = SentryEnvelope.readScalar(value);

      if (name && text) {
        pairs.push([name, text]);
      }
    };

    if (Array.isArray(tags)) {
      for (const pair of tags as Array<unknown>) {
        if (Array.isArray(pair) && pair.length >= 2) {
          add(pair[0], pair[1]);
        }
      }
    } else if (SentryEnvelope.isObject(tags)) {
      for (const key of Object.keys(tags)) {
        add(key, tags[key]);
      }
    }

    return pairs;
  }

  // A request header, from headers written as an object or as [key, value] pairs.
  private static headerValue(headers: unknown, name: string): string {
    if (Array.isArray(headers)) {
      for (const pair of headers as Array<unknown>) {
        if (
          Array.isArray(pair) &&
          pair.length >= 2 &&
          SentryEnvelope.readString(pair[0]).toLowerCase() === name
        ) {
          return SentryEnvelope.readScalar(pair[1]);
        }
      }

      return "";
    }

    if (SentryEnvelope.isObject(headers)) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name) {
          return SentryEnvelope.readScalar(headers[key]);
        }
      }
    }

    return "";
  }

  /*
   * An event's message: its logentry or message - a string, or
   * {formatted, message, params}, formatted preferred.
   */
  private static messageOf(event: JSONObject): string {
    for (const candidate of [
      event["logentry"],
      event["message"],
      event["sentry.interfaces.Message"],
    ]) {
      if (typeof candidate === "string" && candidate) {
        return candidate;
      }

      if (SentryEnvelope.isObject(candidate)) {
        const text: string =
          SentryEnvelope.readText(candidate["formatted"]) ||
          SentryEnvelope.readText(candidate["message"]);

        if (text) {
          return text;
        }
      }
    }

    return "";
  }

  /*
   * An event's exceptions, oldest first as Sentry orders them (the last one
   * was raised): exception.values, or the older forms - an array, or a
   * single exception. One with no type, no value and no frames says nothing
   * and is left out.
   */
  private static exceptionValuesOf(event: JSONObject): Array<JSONObject> {
    const raw: unknown =
      event["exception"] ?? event["sentry.interfaces.Exception"];
    let values: Array<unknown> = [];

    if (Array.isArray(raw)) {
      values = raw as Array<unknown>;
    } else if (SentryEnvelope.isObject(raw)) {
      if (Array.isArray(raw["values"])) {
        values = raw["values"] as Array<unknown>;
      } else if (raw["type"] !== undefined || raw["value"] !== undefined) {
        values = [raw];
      }
    }

    return values.filter((value: unknown): value is JSONObject => {
      return (
        SentryEnvelope.isObject(value) &&
        Boolean(
          SentryEnvelope.readString(value["type"]) ||
            SentryEnvelope.readText(value["value"]) ||
            SentryEnvelope.rawFramesOf(value).length > 0,
        )
      );
    });
  }

  private static rawFramesOf(exception: JSONObject): Array<JSONObject> {
    const frames: unknown = SentryEnvelope.objectOf(exception["stacktrace"])[
      "frames"
    ];

    return Array.isArray(frames)
      ? (frames as Array<unknown>).filter(SentryEnvelope.isObject)
      : [];
  }

  /*
   * Whether the raised exception was handled (mechanism.handled), else
   * whether any in the chain says; null when none does.
   */
  private static handledOf(chain: Array<JSONObject>): boolean | null {
    for (let index: number = chain.length - 1; index >= 0; index--) {
      const handled: unknown = SentryEnvelope.objectOf(
        chain[index]!["mechanism"],
      )["handled"];

      if (typeof handled === "boolean") {
        return handled;
      }
    }

    return null;
  }

  // The event's platform, else the first frame's that names one.
  private static stackStyleOf(
    event: JSONObject,
    raised: JSONObject,
  ): StackStyle {
    let platform: string = SentryEnvelope.readString(
      event["platform"],
    ).toLowerCase();

    if (!platform) {
      for (const frame of SentryEnvelope.rawFramesOf(raised)) {
        platform = SentryEnvelope.readString(frame["platform"]).toLowerCase();

        if (platform) {
          break;
        }
      }
    }

    return STACK_STYLE_BY_PLATFORM.get(platform) || "v8";
  }

  /*
   * The exception's type, with its module where the platform names a type
   * by both: Java's java.lang + IllegalStateException, Python's
   * myapp.errors + PaymentError (not builtins or __main__, as Python
   * prints them). .NET's type is already full and its module is an
   * assembly; Ruby's type is already Module::Class.
   */
  private static exceptionTypeOf(
    exception: JSONObject,
    style: StackStyle,
  ): string {
    const type: string = SentryEnvelope.readString(exception["type"]);
    const module: string = SentryEnvelope.readString(exception["module"]);

    if (
      !type ||
      !module ||
      style === "dotnet" ||
      style === "ruby" ||
      UNQUALIFIED_MODULES.has(module) ||
      NOT_A_NAMESPACE.test(module) ||
      type.startsWith(`${module}.`)
    ) {
      return type;
    }

    return `${module}.${type}`;
  }

  private static titleOf(type: string, message: string): string {
    if (type && message) {
      return `${type}: ${message}`;
    }

    return type || message;
  }

  /*
   * THE STACK TRACE, AS THE PLATFORM WRITES ONE.
   *
   * Sentry sends frames oldest (the caller) first and an exception chain
   * oldest (the root cause) first. Python is written as Python prints it:
   * oldest first, a traceback per exception, joined by "The above exception
   * was the direct cause of the following exception:" (or "During handling
   * ...", for an implicit __context__). Every other platform is written
   * newest first - the raised exception, then each cause as a "Caused by:"
   * block - in its own frame format: V8's "at fn (file:line:col)" (also for
   * platforms without one of their own), the JVM's "at pkg.Class.fn(File:
   * line)" with Java's "... N more" for the frames a cause shares with the
   * exception it caused, .NET's "at Ns.Type.Fn() in file:line N", Go's
   * goroutine dump, Ruby's backtrace lines ("file:line:in 'fn'", under a
   * "Type: message" line - Ruby's own output puts the message on the top
   * frame's line and "from " before the rest, which StackTraceParser
   * misreads) and PHP's "#N file(line): fn()".
   *
   * At most MAX_FRAMES_PER_EXCEPTION frames an exception (the newest kept),
   * MAX_EXCEPTIONS_PER_CHAIN exceptions (the raised one and its nearest
   * causes; the caller cuts the chain) and MAX_STACK_TRACE_BYTES in all,
   * cut at a line.
   */
  private static renderStackTrace(
    values: Array<JSONObject>,
    style: StackStyle,
    options: { isPanic: boolean },
  ): string {
    const chain: Array<ExceptionText> = [];

    for (const value of values) {
      const type: string = SentryEnvelope.exceptionTypeOf(value, style);
      const message: string = SentryEnvelope.readText(value["value"]);
      const frames: Array<StackFrameText> = SentryEnvelope.framesOf(
        value,
        style,
      );

      if (!type && !message && frames.length === 0) {
        continue;
      }

      chain.push({
        type: type,
        message: message,
        title: SentryEnvelope.titleOf(type, message) || "Error",
        frames: frames,
        source: SentryEnvelope.readString(
          SentryEnvelope.objectOf(value["mechanism"])["source"],
        ),
      });
    }

    if (chain.length === 0) {
      return "";
    }

    const lines: Array<string> =
      style === "python"
        ? SentryEnvelope.pythonLines(chain)
        : SentryEnvelope.newestFirstLines(chain, style, options.isPanic);

    return SentryEnvelope.joinWithinBytes(lines, MAX_STACK_TRACE_BYTES);
  }

  /*
   * An exception's frames, oldest first. A frame with neither a file nor a
   * function says nothing and is left out; Sentry's "?" is no function.
   */
  private static framesOf(
    exception: JSONObject,
    style: StackStyle,
  ): Array<StackFrameText> {
    const frames: Array<StackFrameText> = [];

    for (const frame of SentryEnvelope.rawFramesOf(exception)) {
      const functionName: string = SentryEnvelope.readString(frame["function"]);
      const absPath: string = SentryEnvelope.readString(frame["abs_path"]);
      const filename: string = SentryEnvelope.readString(frame["filename"]);

      // The JVM names a frame's file by its name alone, as Java prints it.
      const file: string =
        style === "jvm"
          ? filename || absPath
          : absPath ||
            filename ||
            (style === "v8" ? SentryEnvelope.readString(frame["package"]) : "");
      const name: string = functionName === "?" ? "" : functionName;

      if (!name && !file) {
        continue;
      }

      frames.push({
        function: name,
        module: SentryEnvelope.readString(frame["module"]),
        file: file,
        lineno: SentryEnvelope.positiveInteger(frame["lineno"]),
        colno: SentryEnvelope.positiveInteger(frame["colno"]),
        contextLine: SentryEnvelope.readString(frame["context_line"]),
        native: frame["native"] === true,
      });
    }

    return frames;
  }

  private static pythonLines(chain: Array<ExceptionText>): Array<string> {
    const lines: Array<string> = [];

    for (let index: number = 0; index < chain.length; index++) {
      const exception: ExceptionText = chain[index]!;

      if (index > 0) {
        lines.push(
          "",
          chain[index - 1]!.source === "__context__"
            ? PYTHON_DURING_HANDLING
            : PYTHON_DIRECT_CAUSE,
          "",
        );
      }

      if (exception.frames.length > 0) {
        const kept: Array<StackFrameText> = exception.frames.slice(
          -MAX_FRAMES_PER_EXCEPTION,
        );
        const omitted: number = exception.frames.length - kept.length;

        lines.push("Traceback (most recent call last):");

        if (omitted > 0) {
          lines.push(`  [${omitted} earlier frames not shown]`);
        }

        for (const frame of kept) {
          let line: string = `  File "${frame.file || "<unknown>"}"`;

          if (frame.lineno !== null) {
            line += `, line ${frame.lineno}`;
          }

          if (frame.function) {
            line += `, in ${frame.function}`;
          }

          lines.push(line);

          if (frame.contextLine) {
            lines.push(`    ${frame.contextLine}`);
          }
        }
      }

      lines.push(exception.title);
    }

    return lines;
  }

  private static newestFirstLines(
    chain: Array<ExceptionText>,
    style: StackStyle,
    isPanic: boolean,
  ): Array<string> {
    const lines: Array<string> = [];
    let enclosing: Array<StackFrameText> | null = null;

    for (let index: number = chain.length - 1; index >= 0; index--) {
      const exception: ExceptionText = chain[index]!;
      const isRaised: boolean = index === chain.length - 1;
      const frames: Array<StackFrameText> = exception.frames.slice().reverse();

      if (!isRaised) {
        lines.push(`Caused by: ${exception.title}`);
      } else if (style === "go") {
        lines.push(
          isPanic
            ? `panic: ${exception.message || exception.title}`
            : exception.title,
        );

        if (frames.length > 0) {
          lines.push("", "goroutine 1 [running]:");
        }
      } else {
        lines.push(exception.title);
      }

      const inCommon: number =
        style === "jvm" && enclosing
          ? SentryEnvelope.framesInCommon(frames, enclosing)
          : 0;
      const shown: number = Math.min(
        frames.length - inCommon,
        MAX_FRAMES_PER_EXCEPTION,
      );

      for (let frameIndex: number = 0; frameIndex < shown; frameIndex++) {
        lines.push(
          ...SentryEnvelope.frameLines(frames[frameIndex]!, style, frameIndex),
        );
      }

      const notShown: number = frames.length - shown;

      if (notShown > 0) {
        lines.push(SentryEnvelope.notShownLine(style, notShown));
      }

      enclosing = frames;
    }

    return lines;
  }

  /*
   * How many frames, from the oldest, a cause shares with the exception it
   * caused (both newest first) - what Java writes as "... N more".
   */
  private static framesInCommon(
    frames: Array<StackFrameText>,
    enclosing: Array<StackFrameText>,
  ): number {
    let ours: number = frames.length - 1;
    let theirs: number = enclosing.length - 1;

    while (ours >= 0 && theirs >= 0) {
      const a: StackFrameText = frames[ours]!;
      const b: StackFrameText = enclosing[theirs]!;

      if (
        a.function !== b.function ||
        a.module !== b.module ||
        a.file !== b.file ||
        a.lineno !== b.lineno
      ) {
        break;
      }

      ours--;
      theirs--;
    }

    return frames.length - 1 - ours;
  }

  private static frameLines(
    frame: StackFrameText,
    style: StackStyle,
    index: number,
  ): Array<string> {
    const qualified: string = frame.module
      ? `${frame.module}.${frame.function || "<unknown>"}`
      : frame.function || "<unknown>";

    if (style === "jvm") {
      let location: string = "Unknown Source";

      if (frame.native) {
        location = "Native Method";
      } else if (frame.file) {
        location =
          frame.lineno !== null ? `${frame.file}:${frame.lineno}` : frame.file;
      }

      return [`\tat ${qualified}(${location})`];
    }

    if (style === "dotnet") {
      // sentry-dotnet's enhanced frames already carry the whole signature.
      const signature: string = frame.function.includes("(")
        ? frame.function
        : `${qualified}()`;

      return [
        frame.file && frame.lineno !== null
          ? `   at ${signature} in ${frame.file}:line ${frame.lineno}`
          : `   at ${signature}`,
      ];
    }

    if (style === "go") {
      const lines: Array<string> = [`${qualified}()`];

      if (frame.file) {
        lines.push(
          frame.lineno !== null
            ? `\t${frame.file}:${frame.lineno}`
            : `\t${frame.file}`,
        );
      }

      return lines;
    }

    if (style === "ruby") {
      const location: string =
        frame.lineno !== null
          ? `${frame.file || "<unknown>"}:${frame.lineno}`
          : frame.file || "<unknown>";

      return [
        frame.function
          ? `\t${location}:in '${frame.function}'`
          : `\t${location}`,
      ];
    }

    if (style === "php") {
      let location: string = "[internal function]";

      if (frame.file && frame.file !== "[internal]") {
        location =
          frame.lineno !== null ? `${frame.file}(${frame.lineno})` : frame.file;
      }

      return [
        `#${index} ${location}: ${frame.function ? `${frame.function}()` : "{main}"}`,
      ];
    }

    let location: string = "<anonymous>";

    if (frame.file) {
      location = frame.file;

      if (frame.lineno !== null) {
        location += `:${frame.lineno}`;

        if (frame.colno !== null) {
          location += `:${frame.colno}`;
        }
      }
    }

    return [
      frame.function
        ? `    at ${frame.function} (${location})`
        : `    at ${location}`,
    ];
  }

  // The line that stands for the frames left out, as each runtime writes one.
  private static notShownLine(style: StackStyle, count: number): string {
    if (style === "jvm") {
      return `\t... ${count} more`;
    }

    if (style === "go") {
      return "...additional frames elided...";
    }

    if (style === "ruby") {
      return `\t ... ${count} levels...`;
    }

    if (style === "dotnet") {
      return `   ... ${count} more frames`;
    }

    if (style === "php") {
      return `... ${count} more frames`;
    }

    return `    ... ${count} more frames`;
  }

  /*
   * The lines, joined, in at most maxBytes of UTF-8: whole lines, then a
   * marker when the rest does not fit (a first line too long on its own is
   * cut at a character).
   */
  private static joinWithinBytes(
    lines: Array<string>,
    maxBytes: number,
  ): string {
    const kept: Array<string> = [];
    const markerBytes: number = TRUNCATED_STACK_TRACE_MARKER.length + 1;
    let used: number = 0;

    for (let index: number = 0; index < lines.length; index++) {
      const line: string = lines[index]!;
      const bytes: number =
        Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
      const isLast: boolean = index === lines.length - 1;

      if (
        used + bytes <= maxBytes &&
        (isLast || used + bytes + markerBytes <= maxBytes)
      ) {
        kept.push(line);
        used += bytes;
        continue;
      }

      if (kept.length === 0) {
        kept.push(SentryEnvelope.truncateUtf8(line, maxBytes - markerBytes));
      }

      kept.push(TRUNCATED_STACK_TRACE_MARKER);
      break;
    }

    return kept.join("\n");
  }

  // At most maxBytes of the text's UTF-8, never splitting a character.
  private static truncateUtf8(text: string, maxBytes: number): string {
    const buffer: Buffer = Buffer.from(text, "utf8");

    if (buffer.length <= maxBytes) {
      return text;
    }

    let end: number = maxBytes;

    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) {
      end--;
    }

    return buffer.subarray(0, end).toString("utf8");
  }

  /*
   * Attributes as Sentry's log and span items type them: {"value": ...,
   * "type": "string" | "boolean" | "integer" | "double"}. A value of no
   * known type is typed as OTLP types it; an object or array is kept as its
   * JSON.
   */
  private static typedAttributes(attributes: unknown): Array<OtlpKeyValue> {
    const result: Array<OtlpKeyValue> = [];

    if (!SentryEnvelope.isObject(attributes)) {
      return result;
    }

    for (const key of Object.keys(attributes)) {
      const entry: unknown = attributes[key];
      const attribute: OtlpKeyValue | null =
        SentryEnvelope.isObject(entry) &&
        Object.prototype.hasOwnProperty.call(entry, "value")
          ? SentryEnvelope.typedAttribute(
              key,
              SentryEnvelope.readString(entry["type"]),
              entry["value"],
            )
          : SentryEnvelope.typedAttribute(key, "", entry);

      if (attribute) {
        result.push(attribute);
      }
    }

    return result;
  }

  private static typedAttribute(
    key: string,
    type: string,
    value: unknown,
  ): OtlpKeyValue | null {
    if (!key) {
      return null;
    }

    if (type === "integer") {
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return { key: key, value: { intValue: String(value) } };
      }

      if (typeof value === "string" && INTEGER_TEXT.test(value.trim())) {
        const integer: bigint = BigInt(value.trim());

        if (integer >= INT64_MIN && integer <= INT64_MAX) {
          return { key: key, value: { intValue: integer.toString() } };
        }
      }
    } else if (type === "double") {
      let number: number | null = null;

      if (typeof value === "number") {
        number = value;
      } else if (typeof value === "string" && DECIMAL_TEXT.test(value.trim())) {
        number = Number(value.trim());
      }

      if (number !== null && Number.isFinite(number)) {
        return { key: key, value: { doubleValue: number } };
      }
    } else if (type === "boolean") {
      if (typeof value === "boolean") {
        return { key: key, value: { boolValue: value } };
      }

      if (value === "true" || value === "false") {
        return { key: key, value: { boolValue: value === "true" } };
      }
    } else if (type === "string") {
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        return { key: key, value: { stringValue: String(value) } };
      }
    }

    const attribute: OtlpKeyValue | null = OtlpJson.attribute(key, value);

    if (attribute || value === null || typeof value !== "object") {
      return attribute;
    }

    return { key: key, value: { stringValue: JSON.stringify(value) } };
  }

  // A typed attribute's value as a string, for reading where an item came from.
  private static typedValue(attributes: unknown, key: string): string {
    if (!SentryEnvelope.isObject(attributes)) {
      return "";
    }

    const entry: unknown = attributes[key];

    return SentryEnvelope.readScalar(
      SentryEnvelope.isObject(entry) ? entry["value"] : entry,
    );
  }

  private static rootSpanKind(op: string): number {
    if (SentryEnvelope.matchesOp(op, SERVER_OPS)) {
      return SPAN_KIND_SERVER;
    }

    // A transaction a queue's task runs in is that message's consumer.
    if (
      op.startsWith("queue.") &&
      !SentryEnvelope.matchesOp(op, PRODUCER_OPS)
    ) {
      return SPAN_KIND_CONSUMER;
    }

    return SPAN_KIND_INTERNAL;
  }

  private static childSpanKind(op: string): number {
    if (SentryEnvelope.matchesOp(op, CLIENT_OPS)) {
      return SPAN_KIND_CLIENT;
    }

    if (SentryEnvelope.matchesOp(op, PRODUCER_OPS)) {
      return SPAN_KIND_PRODUCER;
    }

    if (SentryEnvelope.matchesOp(op, CONSUMER_OPS)) {
      return SPAN_KIND_CONSUMER;
    }

    return SPAN_KIND_INTERNAL;
  }

  // An op is one of `ops`, or a dotted refinement of one ("db" is also "db.query").
  private static matchesOp(op: string, ops: ReadonlyArray<string>): boolean {
    for (const prefix of ops) {
      if (op === prefix || op.startsWith(`${prefix}.`)) {
        return true;
      }
    }

    return false;
  }

  // Sentry's span status as OTLP's: "ok" is OK, none is unset, anything else an error.
  private static spanStatus(status: unknown): JSONObject {
    const text: string = SentryEnvelope.readString(status).toLowerCase();

    if (!text) {
      return { code: STATUS_CODE_UNSET };
    }

    if (text === "ok") {
      return { code: STATUS_CODE_OK };
    }

    return { code: STATUS_CODE_ERROR, message: text };
  }

  /*
   * A Sentry time - seconds since the epoch as a number, a decimal string or
   * an RFC 3339 string - as OTLP's nanoseconds, or null for one that is
   * none of these, or is not after the epoch.
   */
  private static timeOf(value: unknown): string | null {
    let nanoseconds: string | null = null;

    if (typeof value === "number") {
      nanoseconds = OtlpJson.secondsToUnixNano(value);
    } else if (typeof value === "string") {
      const text: string = value.trim();

      nanoseconds = DECIMAL_SECONDS.test(text)
        ? OtlpJson.secondsToUnixNano(text)
        : SentryEnvelope.rfc3339ToUnixNano(text);
    }

    return nanoseconds !== null && !ALL_ZEROS.test(nanoseconds)
      ? nanoseconds
      : null;
  }

  /*
   * "2024-01-15T10:30:00.123456Z" (or with an offset, or with none - UTC, as
   * Sentry reads it), every digit of the fraction kept to the nanosecond.
   */
  private static rfc3339ToUnixNano(text: string): string | null {
    const match: RegExpExecArray | null = RFC3339.exec(text);

    if (!match) {
      return null;
    }

    let zone: string = match[4] || "Z";

    if (zone === "z") {
      zone = "Z";
    } else if (zone.length === 5) {
      zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    }

    const milliseconds: number = Date.parse(`${match[1]}T${match[2]}${zone}`);

    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return null;
    }

    const fraction: string = (match[3] || "").slice(0, 9).padEnd(9, "0");

    return (
      BigInt(milliseconds) * BigInt(1_000_000) +
      BigInt(fraction)
    ).toString();
  }

  // `end`, or `start` when `end` comes before it: a span never ends before it starts.
  private static notBefore(end: string, start: string): string {
    return BigInt(end) < BigInt(start) ? start : end;
  }

  private static newEventId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  // The event ID's last 16 hex digits (its first 16 when those are all zeros).
  private static spanIdFromEventId(eventId: string): string {
    return (
      OtlpJson.hexId(eventId.slice(16), 16) ||
      OtlpJson.hexId(eventId.slice(0, 16), 16) ||
      crypto.randomBytes(8).toString("hex")
    );
  }

  private static parseHeaderLine(
    body: Buffer,
    start: number,
    end: number,
  ): JSONObject | null {
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8", start, end));
      return SentryEnvelope.isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private static parseJsonObject(payload: Buffer): JSONObject | null {
    try {
      const parsed: unknown = JSON.parse(payload.toString("utf8"));
      return SentryEnvelope.isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private static isBlank(body: Buffer, start: number, end: number): boolean {
    for (let index: number = start; index < end; index++) {
      const byte: number = body[index]!;

      if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) {
        return false;
      }
    }

    return true;
  }

  private static nonNegativeInteger(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    if (typeof value === "string" && DIGITS.test(value)) {
      const parsed: number = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }

    return null;
  }

  private static positiveInteger(value: unknown): number | null {
    const parsed: number | null = SentryEnvelope.nonNegativeInteger(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  }

  // Attributes with each key once, the first kept: OTLP keys are unique.
  private static uniqueByKey(
    attributes: Array<OtlpKeyValue>,
  ): Array<OtlpKeyValue> {
    const seen: Set<string> = new Set<string>();

    return attributes.filter((attribute: OtlpKeyValue): boolean => {
      if (seen.has(attribute.key)) {
        return false;
      }

      seen.add(attribute.key);
      return true;
    });
  }

  private static objectOf(value: unknown): JSONObject {
    return SentryEnvelope.isObject(value) ? value : {};
  }

  private static isObject(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // A string, trimmed; "" for anything else.
  private static readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  // A message as written; a number or boolean as its text.
  private static readText(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return String(value);
    }

    return "";
  }

  // A tag's or an ID's value: a string trimmed, a number or boolean as its text.
  private static readScalar(value: unknown): string {
    return SentryEnvelope.readText(value).trim();
  }
}
