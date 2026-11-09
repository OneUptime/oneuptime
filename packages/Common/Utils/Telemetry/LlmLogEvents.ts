import {
  LlmCompletionEventNames,
  LlmContentEventNames,
  LlmInferenceDetailsContentAttributeKeys,
  LlmInferenceDetailsEventName,
  LlmLogEventNameAttributeKey,
  LlmPromptEventNames,
} from "../../Types/Telemetry/LlmConventions";
import LlmMessageParser, {
  LLM_MESSAGE_MAX_JSON_LENGTH,
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
  LlmMessageParserOptions,
} from "./LlmMessageParser";

/*
 * WHAT AN AI CALL SAID, WHEN IT ARRIVED AS LOG RECORDS.
 *
 * The OpenTelemetry instrumentations for JavaScript and Java, and Python's
 * with `true` or `event_only`, record no prompt or answer on the call's span:
 * they send them as GenAI events on the logs signal, each record carrying
 * the trace and span id of the call it belongs to. Three shapes arrive:
 *
 *   - one record per message, the message in the body (an OTLP key/value
 *     list such as {content}, {tool_calls}, {id, content} or, for the
 *     answer, {index, finish_reason, message}), named gen_ai.system.message,
 *     gen_ai.user.message, gen_ai.assistant.message, gen_ai.tool.message or
 *     gen_ai.choice in the `event.name` attribute (JavaScript, Java, Python
 *     on an SDK with the Events API) or in the record's own event name
 *     field (Python on a newer SDK; ingest stamps it onto `event.name`);
 *   - one gen_ai.client.inference.operation.details record per call, the
 *     messages in its gen_ai.input.messages, gen_ai.output.messages and
 *     gen_ai.system_instructions attributes (Python's newer instrumentations);
 *   - the same event split over two records, one with the input and one
 *     with the output (JavaScript's Responses API).
 *
 * This module turns a call's records - read back from the Log table, where
 * the body is the stored text of the OTLP value and a structured attribute
 * the JSON text of its flattened value - into the span events
 * LlmMessageParser reads, so the conversation view and the span panel read
 * them exactly as they read a span's own events.
 *
 * Pure and shared: the conversations read (LlmConversationService) and the
 * span panel (the Dashboard's LlmSpanDisplay) both use it. Never throws -
 * a record of a shape it does not know reads as nothing recorded.
 */

type Dictionary = Record<string, unknown>;

// A log record as the Log table reads back.
export interface LlmLogEventRecord {
  traceId?: string | null | undefined;
  spanId?: string | null | undefined;
  // When it happened and when it was seen, in nanoseconds (text or number).
  timeUnixNano?: string | number | null | undefined;
  observedTimeUnixNano?: string | number | null | undefined;
  /*
   * Where the record sits in its storage part, from the read: what orders
   * two records of the same nanosecond (they arrive in the order they were
   * sent). Optional.
   */
  rowOffset?: string | number | null | undefined;
  // The attribute map: text values, a structured value as its JSON text.
  attributes?: unknown;
  // The stored body: the text, or the JSON text of a structured value.
  body?: unknown;
}

// A span event, as LlmMessageParser reads one.
export interface LlmEventLike {
  name: string;
  attributes: Dictionary;
}

// An AI call a record may belong to.
export interface LlmLogEventCall {
  spanId: string;
  traceId: string;
  startMs: number;
  endMs: number;
  /*
   * Whether the call asked a model (an answer). A record that names its
   * trace but no span is given only to such a call.
   */
  isModelCall: boolean;
}

/*
 * How long before a call's start, and after its end, its records are looked
 * for. A record carries the time it was emitted, within its call; but one
 * that sends no time of its own (Python on a newer SDK, the Java agent) is
 * stored at the time it arrived - after its export's batch delay and the
 * ingest queue.
 */
export const LLM_LOG_EVENT_BEFORE_CALL_MS: number = 60 * 1000;
export const LLM_LOG_EVENT_AFTER_CALL_MS: number = 10 * 60 * 1000;

// How deep a body's nested values are read; deeper ones are left out.
const MAX_VALUE_DEPTH: number = 32;

// The fields an OTLP AnyValue sets, in the JSON and protobuf spellings.
const ANY_VALUE_FIELDS: ReadonlyArray<string> = [
  "stringValue",
  "string_value",
  "boolValue",
  "bool_value",
  "intValue",
  "int_value",
  "doubleValue",
  "double_value",
  "arrayValue",
  "array_value",
  "kvlistValue",
  "kvlist_value",
  "bytesValue",
  "bytes_value",
];

const PROMPT_EVENT_NAMES: ReadonlySet<string> = new Set<string>(
  LlmPromptEventNames,
);
const COMPLETION_EVENT_NAMES: ReadonlySet<string> = new Set<string>(
  LlmCompletionEventNames,
);
const CONTENT_EVENT_NAMES: ReadonlySet<string> = new Set<string>(
  LlmContentEventNames,
);

function asDictionary(value: unknown): Dictionary | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Dictionary;
  }

  return null;
}

// The stored text of a structured value that holds nothing.
const EMPTY_VALUE_TEXTS: ReadonlySet<string> = new Set<string>([
  "",
  "[]",
  "{}",
  '""',
  "null",
]);

// Whether a value says nothing: missing, blank, or an empty list or object.
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return EMPTY_VALUE_TEXTS.has(value.trim());
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

/*
 * A nanosecond count as digits without leading zeros, "" for anything that
 * is not a positive whole count. Text is read digit by digit, so a count
 * past 2^53 keeps every digit.
 */
function toNanoDigits(value: unknown): string {
  let text: string = "";

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return "";
    }

    text = Math.trunc(value).toFixed(0);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return "";
  }

  let start: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return "";
    }
  }

  while (start < text.length - 1 && text[start] === "0") {
    start++;
  }

  const digits: string = text.slice(start);

  return digits === "0" ? "" : digits;
}

// Two digit strings from toNanoDigits, as numbers; "" (no time) sorts last.
function compareNanoDigits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  if (left.length !== right.length) {
    return left.length - right.length;
  }

  return left < right ? -1 : 1;
}

function readIndex(value: unknown): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export default class LlmLogEventsUtil {
  /*
   * The record's GenAI event name: its `event.name` attribute, or "" when
   * it names none.
   */
  public static getEventName(record: LlmLogEventRecord): string {
    const attributes: Dictionary | null = asDictionary(record.attributes);
    const name: unknown = attributes
      ? attributes[LlmLogEventNameAttributeKey]
      : undefined;

    return typeof name === "string" ? name.trim() : "";
  }

  /*
   * The event a record carries what was said in, or "" when it carries
   * none: a message event, a choice, or the inference details event - by
   * name, or by the details event's own attributes when it has no name.
   */
  public static getContentEventName(record: LlmLogEventRecord): string {
    const name: string = LlmLogEventsUtil.getEventName(record);

    if (name) {
      return CONTENT_EVENT_NAMES.has(name) ? name : "";
    }

    const attributes: Dictionary | null = asDictionary(record.attributes);

    if (
      attributes &&
      LlmInferenceDetailsContentAttributeKeys.some((key: string): boolean => {
        return !isBlank(attributes[key]);
      })
    ) {
      return LlmInferenceDetailsEventName;
    }

    return "";
  }

  public static isContentEvent(record: LlmLogEventRecord): boolean {
    return LlmLogEventsUtil.getContentEventName(record) !== "";
  }

  /*
   * A log record's attribute map, at ingest, with the messages of an
   * inference details event held as their JSON text - in place. They
   * arrive as structured values (an OTLP list), which scrub rules pass
   * over since they mask text; a span holds the same messages as JSON
   * text, and the Log table stores a structured value as its JSON text
   * anyway, so nothing stored changes but that the logs' scrub rules now
   * mask what was said as the traces' rules do on a span. Returns how many
   * values it held as text.
   */
  public static holdContentAsText(attributes: Dictionary): number {
    let held: number = 0;

    for (const key of LlmInferenceDetailsContentAttributeKeys) {
      const value: unknown = attributes[key];

      if (value === null || typeof value !== "object") {
        continue;
      }

      try {
        attributes[key] = JSON.stringify(value);
        held++;
      } catch {
        // A value JSON cannot write stays as it came.
      }
    }

    return held;
  }

  /*
   * An OTLP AnyValue - as OTLP/JSON, protobufjs or the gRPC loader write it
   * (camelCase or snake_case, with or without the loader's `value` field
   * naming the one set) - as a plain value: text, a number, a boolean, a
   * list or an object. An AnyValue with nothing set reads as undefined.
   */
  public static readAnyValue(value: unknown, depth: number = 0): unknown {
    if (depth > MAX_VALUE_DEPTH) {
      return undefined;
    }

    const object: Dictionary | null = asDictionary(value);

    if (!object) {
      return value;
    }

    if ("stringValue" in object || "string_value" in object) {
      const text: unknown = object["stringValue"] ?? object["string_value"];
      return typeof text === "string" ? text : String(text ?? "");
    }

    if ("boolValue" in object || "bool_value" in object) {
      const flag: unknown = object["boolValue"] ?? object["bool_value"];
      return flag === true || flag === "true";
    }

    if ("intValue" in object || "int_value" in object) {
      const whole: unknown = object["intValue"] ?? object["int_value"];

      if (typeof whole === "number") {
        return whole;
      }

      const parsed: number = Number(whole);

      // Past 2^53 a number loses digits: the text keeps them.
      return Number.isSafeInteger(parsed) ? parsed : String(whole ?? "");
    }

    if ("doubleValue" in object || "double_value" in object) {
      const real: unknown = object["doubleValue"] ?? object["double_value"];
      return typeof real === "number" ? real : Number(real);
    }

    if ("arrayValue" in object || "array_value" in object) {
      const list: Dictionary | null = asDictionary(
        object["arrayValue"] ?? object["array_value"],
      );
      const values: unknown = list ? list["values"] : undefined;

      if (!Array.isArray(values)) {
        return [];
      }

      return values
        .map((element: unknown): unknown => {
          return LlmLogEventsUtil.readAnyValue(element, depth + 1);
        })
        .filter((element: unknown): boolean => {
          return element !== undefined;
        });
    }

    if ("kvlistValue" in object || "kvlist_value" in object) {
      const list: Dictionary | null = asDictionary(
        object["kvlistValue"] ?? object["kvlist_value"],
      );
      const values: unknown = list ? list["values"] : undefined;
      const result: Dictionary = {};

      if (!Array.isArray(values)) {
        return result;
      }

      for (const entry of values) {
        const pair: Dictionary | null = asDictionary(entry);
        const key: unknown = pair ? pair["key"] : undefined;

        if (!pair || typeof key !== "string" || !key) {
          continue;
        }

        const read: unknown = LlmLogEventsUtil.readAnyValue(
          pair["value"],
          depth + 1,
        );

        if (read !== undefined) {
          result[key] = read;
        }
      }

      return result;
    }

    if ("bytesValue" in object || "bytes_value" in object) {
      const bytes: unknown = object["bytesValue"] ?? object["bytes_value"];
      return typeof bytes === "string" ? bytes : undefined;
    }

    return undefined;
  }

  // Whether a parsed body is an OTLP AnyValue rather than a plain object.
  public static isAnyValue(value: unknown): boolean {
    const object: Dictionary | null = asDictionary(value);

    if (!object) {
      return false;
    }

    const keys: Array<string> = Object.keys(object);

    // Nothing set: an empty AnyValue, as the SDKs send a body-less event.
    if (keys.length === 0 || (keys.length === 1 && keys[0] === "value")) {
      return true;
    }

    return ANY_VALUE_FIELDS.some((field: string): boolean => {
      return field in object;
    });
  }

  /*
   * A stored body as a value. Log ingest keeps a text body as the text and
   * any other body as the JSON text of its OTLP value; a missing body is
   * stored as "" or as the two characters "". A body longer than
   * maxJsonLength is left out, as an over-long prompt on a span is.
   */
  public static readBody(
    body: unknown,
    maxJsonLength: number = LLM_MESSAGE_MAX_JSON_LENGTH,
  ): unknown {
    if (body === undefined || body === null) {
      return undefined;
    }

    if (typeof body === "object") {
      return LlmLogEventsUtil.isAnyValue(body)
        ? LlmLogEventsUtil.readAnyValue(body)
        : body;
    }

    if (typeof body !== "string") {
      return body;
    }

    const trimmed: string = body.trim();

    if (!trimmed || trimmed.length > maxJsonLength) {
      return undefined;
    }

    const first: string = trimmed[0] as string;

    if (first !== "{" && first !== "[" && first !== '"') {
      return body;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Text that only looks like JSON is still the text.
      return body;
    }

    if (typeof parsed === "string") {
      return parsed.length > 0 ? parsed : undefined;
    }

    return LlmLogEventsUtil.isAnyValue(parsed)
      ? LlmLogEventsUtil.readAnyValue(parsed)
      : parsed;
  }

  /*
   * When a record happened, for ordering and matching: the earlier of its
   * own time and the time it was observed. A record that sends no time of
   * its own (Python on a newer SDK, the Java agent) is stored at the time it
   * arrived, later than it happened; its observed time says when it did.
   */
  public static getTimeDigits(record: LlmLogEventRecord): string {
    const time: string = toNanoDigits(record.timeUnixNano);
    const observed: string = toNanoDigits(record.observedTimeUnixNano);

    if (!time) {
      return observed;
    }

    if (!observed) {
      return time;
    }

    return compareNanoDigits(time, observed) <= 0 ? time : observed;
  }

  // The same, in milliseconds; null when the record has no time.
  public static getTimeMs(record: LlmLogEventRecord): number | null {
    const digits: string = LlmLogEventsUtil.getTimeDigits(record);

    if (!digits) {
      return null;
    }

    const millis: string = digits.length > 6 ? digits.slice(0, -6) : "0";
    const parsed: number = Number(millis);

    return Number.isFinite(parsed) ? parsed : null;
  }

  /*
   * The records in the order they were sent: by time, then the time they
   * were observed, then where the read found them. Stable, and a new list.
   */
  public static sortRecords(
    records: ReadonlyArray<LlmLogEventRecord>,
  ): Array<LlmLogEventRecord> {
    return records
      .map((record: LlmLogEventRecord, index: number) => {
        return {
          record: record,
          index: index,
          time: LlmLogEventsUtil.getTimeDigits(record),
          observed: toNanoDigits(record.observedTimeUnixNano),
          offset: toNanoDigits(record.rowOffset),
        };
      })
      .sort(
        (
          left: {
            time: string;
            observed: string;
            offset: string;
            index: number;
          },
          right: {
            time: string;
            observed: string;
            offset: string;
            index: number;
          },
        ): number => {
          return (
            compareNanoDigits(left.time, right.time) ||
            compareNanoDigits(left.observed, right.observed) ||
            compareNanoDigits(left.offset, right.offset) ||
            left.index - right.index
          );
        },
      )
      .map((entry: { record: LlmLogEventRecord }): LlmLogEventRecord => {
        return entry.record;
      });
  }

  /*
   * A call's records as span events, for LlmMessageParser: the messages in
   * the order they were sent, then the answers by their choice index, then
   * one details event - a call that split its details over records (the
   * input on one, the output on another) reads as one.
   */
  public static toEvents(
    records: ReadonlyArray<LlmLogEventRecord>,
    options?: LlmMessageParserOptions,
  ): Array<LlmEventLike> {
    const maxJsonLength: number =
      options?.maxJsonLength ?? LLM_MESSAGE_MAX_JSON_LENGTH;

    const prompts: Array<LlmEventLike> = [];
    const choices: Array<{ event: LlmEventLike; index: number }> = [];
    let details: Dictionary | null = null;

    for (const record of LlmLogEventsUtil.sortRecords(records)) {
      const name: string = LlmLogEventsUtil.getContentEventName(record);

      if (!name) {
        continue;
      }

      const attributes: Dictionary = {
        ...(asDictionary(record.attributes) || {}),
      };
      delete attributes[LlmLogEventNameAttributeKey];

      const body: unknown = LlmLogEventsUtil.readBody(
        record.body,
        maxJsonLength,
      );
      const bodyObject: Dictionary | null = asDictionary(body);

      if (name === LlmInferenceDetailsEventName) {
        /*
         * The record's attributes, and what its body holds when an
         * instrumentation put the messages there; the first record that
         * says a thing says it.
         */
        details = details || {};

        for (const source of [attributes, bodyObject || {}]) {
          for (const key of Object.keys(source)) {
            if (isBlank(details[key]) && !isBlank(source[key])) {
              details[key] = source[key];
            }
          }
        }

        continue;
      }

      /*
       * The message is the body: its fields over the record's attributes.
       * A text body (or a list of parts) is the message's content.
       */
      const message: Dictionary = bodyObject
        ? { ...attributes, ...bodyObject }
        : body === undefined
          ? attributes
          : { ...attributes, content: body };

      const event: LlmEventLike = { name: name, attributes: message };

      if (COMPLETION_EVENT_NAMES.has(name)) {
        choices.push({ event: event, index: readIndex(message["index"]) });
      } else if (PROMPT_EVENT_NAMES.has(name)) {
        prompts.push(event);
      }
    }

    const events: Array<LlmEventLike> = [
      ...prompts,
      ...choices
        .map(
          (entry: { event: LlmEventLike; index: number }, position: number) => {
            return { ...entry, position: position };
          },
        )
        .sort(
          (
            left: { index: number; position: number },
            right: { index: number; position: number },
          ): number => {
            return left.index - right.index || left.position - right.position;
          },
        )
        .map((entry: { event: LlmEventLike }): LlmEventLike => {
          return entry.event;
        }),
    ];

    if (details) {
      events.push({ name: LlmInferenceDetailsEventName, attributes: details });
    }

    return events;
  }

  /*
   * What a call's records say: the parts with something in them, and the
   * messages left with a part. An instrumentation with content capture off
   * still sends its events - with empty bodies, parts that name only their
   * type, and tool calls that name only the tool - and those say nothing:
   * a call they belong to reads as not recorded rather than as an empty
   * answer or a bare tool name.
   */
  public static readContent(
    records: ReadonlyArray<LlmLogEventRecord>,
    options?: LlmMessageParserOptions,
  ): LlmCallContent {
    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: {},
      events: LlmLogEventsUtil.toEvents(records, options),
      options: options,
    });

    const said: (messages: Array<LlmMessage>) => Array<LlmMessage> = (
      messages: Array<LlmMessage>,
    ): Array<LlmMessage> => {
      return messages
        .map((message: LlmMessage): LlmMessage => {
          return {
            ...message,
            parts: message.parts.filter(LlmLogEventsUtil.partSaysSomething),
          };
        })
        .filter((message: LlmMessage): boolean => {
          return message.parts.length > 0;
        });
    };

    return {
      ...content,
      input: said(content.input),
      output: said(content.output),
    };
  }

  /*
   * Whether a message part says something: text, a tool call's arguments,
   * a tool's result, or a media part's address. A tool call that names
   * only the tool, or a part that names only its type, says nothing.
   */
  public static partSaysSomething(part: LlmMessagePart): boolean {
    switch (part.type) {
      case LlmMessagePartType.ToolCall:
        return (part.arguments || "").trim().length > 0;
      case LlmMessagePartType.Media:
        return Boolean(
          (part.uri || "").trim() ||
            (part.mimeType || "").trim() ||
            (part.text || "").trim(),
        );
      default:
        return (part.text || "").trim().length > 0;
    }
  }

  /*
   * A call's content from its span and from its log records, each part read
   * once: what the span records wins, and the records fill in only what the
   * span leaves out. So a call whose instrumentation records both (Python's
   * `span_and_event`) shows each message once.
   */
  public static mergeContent(
    span: LlmCallContent,
    logs: LlmCallContent,
  ): LlmCallContent {
    return {
      systemInstructions: span.systemInstructions || logs.systemInstructions,
      input: span.input.length > 0 ? span.input : logs.input,
      output: span.output.length > 0 ? span.output : logs.output,
      finishReasons:
        span.finishReasons.length > 0 ? span.finishReasons : logs.finishReasons,
      tool: span.tool || logs.tool,
      evaluations: span.evaluations,
      errorType: span.errorType || logs.errorType,
    };
  }

  // Whether a call's content says anything.
  public static hasContent(content: LlmCallContent): boolean {
    return (
      content.input.length > 0 ||
      content.output.length > 0 ||
      content.systemInstructions.length > 0 ||
      Boolean(content.tool && (content.tool.arguments || content.tool.result))
    );
  }

  /*
   * Whether a call's span leaves out something its log records could say:
   * its prompt or its answer. Only such calls have their records read.
   */
  public static lacksContent(content: LlmCallContent): boolean {
    return content.input.length === 0 || content.output.length === 0;
  }

  /*
   * The content records of each call, by span id. A record goes to the call
   * with its span id (in its trace, when it names one). A record that names
   * its trace but no span goes to the trace's one model call, or - among
   * several - to the one it happened during; when that is still not one
   * call, it is left out rather than shown under the wrong call. A record
   * with neither id belongs to no call.
   */
  public static assignToCalls(
    calls: ReadonlyArray<LlmLogEventCall>,
    records: ReadonlyArray<LlmLogEventRecord>,
  ): Map<string, Array<LlmLogEventRecord>> {
    const bySpan: Map<string, LlmLogEventCall> = new Map<
      string,
      LlmLogEventCall
    >();
    const modelCallsByTrace: Map<string, Array<LlmLogEventCall>> = new Map<
      string,
      Array<LlmLogEventCall>
    >();

    for (const call of calls) {
      const spanId: string = (call.spanId || "").toLowerCase();

      if (spanId) {
        bySpan.set(spanId, call);
      }

      if (call.isModelCall) {
        const traceId: string = (call.traceId || "").toLowerCase();
        const traceCalls: Array<LlmLogEventCall> =
          modelCallsByTrace.get(traceId) || [];
        traceCalls.push(call);
        modelCallsByTrace.set(traceId, traceCalls);
      }
    }

    const result: Map<string, Array<LlmLogEventRecord>> = new Map<
      string,
      Array<LlmLogEventRecord>
    >();

    for (const record of records) {
      if (!LlmLogEventsUtil.isContentEvent(record)) {
        continue;
      }

      const spanId: string = (record.spanId || "").toLowerCase();
      const traceId: string = (record.traceId || "").toLowerCase();
      let call: LlmLogEventCall | undefined = undefined;

      if (spanId) {
        call = bySpan.get(spanId);

        // The same span id in another trace is another span.
        if (call && traceId && call.traceId.toLowerCase() !== traceId) {
          call = undefined;
        }
      } else if (traceId) {
        call = LlmLogEventsUtil.findCallOfRecord(
          modelCallsByTrace.get(traceId) || [],
          record,
        );
      }

      if (!call) {
        continue;
      }

      const callRecords: Array<LlmLogEventRecord> =
        result.get(call.spanId) || [];
      callRecords.push(record);
      result.set(call.spanId, callRecords);
    }

    return result;
  }

  private static findCallOfRecord(
    candidates: ReadonlyArray<LlmLogEventCall>,
    record: LlmLogEventRecord,
  ): LlmLogEventCall | undefined {
    if (candidates.length === 1) {
      return candidates[0];
    }

    const atMs: number | null = LlmLogEventsUtil.getTimeMs(record);

    if (atMs === null) {
      return undefined;
    }

    const during: Array<LlmLogEventCall> = candidates.filter(
      (call: LlmLogEventCall): boolean => {
        return (
          call.startMs <= atMs && atMs <= Math.max(call.endMs, call.startMs)
        );
      },
    );

    return during.length === 1 ? during[0] : undefined;
  }
}
