import fs from "fs";
import path from "path";
import TelemetryUtil from "../../Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "../../Types/JSON";
import Text from "../../Types/Text";
import { LlmLogEventRecord } from "../../Utils/Telemetry/LlmLogEvents";

/*
 * WHAT THE OPENTELEMETRY GENAI INSTRUMENTATIONS REALLY SEND, FOR TESTS.
 *
 * Tests/Fixtures/GenAiLogEvents holds the OTLP requests (logs and the
 * matching traces) that the OpenAI instrumentations for JavaScript, Python
 * and Java sent to a capture receiver while an app called a fake OpenAI
 * server: a plain chat with a system prompt, a tool round trip, a request
 * for two choices, a streamed answer and - JavaScript only - a Responses
 * API call. Each file's "source" says which instrumentation, SDK and
 * setting produced it. The protobuf requests are decoded as OneUptime
 * decodes them (protobufjs toJSON over ProtoFiles/OTel/v1, with the
 * LogRecord event_name field); the resource is cut down to the service
 * name and the SDK, and only the GenAI spans are kept.
 *
 * The helpers turn a fixture into rows as OneUptime stores them: what log
 * ingest writes for a record (OtelLogsIngestService: the attribute map
 * flattened by TelemetryUtil, `event.name` stamped from the record's
 * event name field, the body kept as text or as the JSON text of its OTLP
 * value, hex ids), read back through a Map(String, String) column - a
 * structured value as its JSON text. LlmConversationsClickhouse and
 * LlmLogEventsClickhouse check the same rows against a real ClickHouse.
 */

export const GEN_AI_LOG_EVENT_FIXTURE_FOLDER: string = path.join(
  __dirname,
  "../Fixtures/GenAiLogEvents",
);

export enum GenAiLogEventFixture {
  JavaScriptContent = "javascript-instrumentation-openai-0.23.0-content.json",
  JavaScriptContentOtlpJson = "javascript-instrumentation-openai-0.23.0-content-otlp-json.json",
  JavaScriptNoContent = "javascript-instrumentation-openai-0.23.0-no-content.json",
  PythonOpenAiV2True = "python-instrumentation-openai-v2-2.4b0-true.json",
  PythonOpenAiV2EventOnly = "python-instrumentation-openai-v2-2.4b0-event-only.json",
  PythonOpenAiV2SpanAndEvent = "python-instrumentation-openai-v2-2.4b0-span-and-event.json",
  PythonOpenAiV2NoContent = "python-instrumentation-openai-v2-2.4b0-no-content.json",
  PythonOpenAiV2EventsApi = "python-instrumentation-openai-v2-2.1b0-true.json",
  PythonGenAiOpenAiEventOnly = "python-instrumentation-genai-openai-1.3b0-event-only.json",
  JavaContent = "java-agent-2.33.1-content.json",
  JavaNoContent = "java-agent-2.33.1-no-content.json",
}

export interface GenAiLogEventFixtureFile {
  source: Record<string, string>;
  logs: JSONObject;
  traces: JSONObject;
}

// A GenAI span as the Span table stores it, for the tests that need one.
export interface StoredGenAiSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startMs: number;
  endMs: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: JSONObject;
  events: Array<JSONObject>;
}

export function loadGenAiLogEventFixture(
  fixture: GenAiLogEventFixture,
): GenAiLogEventFixtureFile {
  return JSON.parse(
    fs.readFileSync(
      path.join(GEN_AI_LOG_EVENT_FIXTURE_FOLDER, fixture),
      "utf8",
    ),
  ) as GenAiLogEventFixtureFile;
}

// What a Map(String, String) column gives back: text, a value's JSON text.
export function toStoredMap(attributes: JSONObject): JSONObject {
  const stored: JSONObject = {};

  for (const key of Object.keys(attributes)) {
    const value: unknown = attributes[key];

    if (value === undefined || value === null) {
      continue;
    }

    stored[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  return stored;
}

// The body as log ingest stores it (OtelLogsIngestService).
export function toStoredBody(body: unknown): string {
  const logBody: JSONObject = body as JSONObject;

  if (
    logBody &&
    typeof logBody === "object" &&
    (logBody["stringValue"] || logBody["string_value"])
  ) {
    return (logBody["stringValue"] || logBody["string_value"]) as string;
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body || "");
}

function forEachLogRecord(
  logs: JSONObject,
  visit: (data: {
    record: JSONObject;
    resourceAttributes: JSONObject;
    scope: JSONObject | undefined;
  }) => void,
): void {
  for (const resourceLog of (logs["resourceLogs"] as JSONArray) || []) {
    const resource: JSONObject =
      ((resourceLog as JSONObject)["resource"] as JSONObject) || {};
    const resourceAttributes: JSONObject = TelemetryUtil.getAttributes({
      items: (resource["attributes"] as JSONArray) || [],
      prefixKeysWithString: "resource",
    }) as JSONObject;

    for (const scopeLog of ((resourceLog as JSONObject)[
      "scopeLogs"
    ] as JSONArray) || []) {
      for (const record of ((scopeLog as JSONObject)[
        "logRecords"
      ] as JSONArray) || []) {
        visit({
          record: record as JSONObject,
          resourceAttributes: resourceAttributes,
          scope: (scopeLog as JSONObject)["scope"] as JSONObject | undefined,
        });
      }
    }
  }
}

/*
 * The fixture's log records as the Log table stores them. `stampEventName:
 * false` stores them as ingest did before it read the event name field.
 * A record that sends no time of its own is stored at `arrivedAtNano`, as
 * ingest stores it at the time it arrived.
 */
export function toStoredLogRecords(
  fixture: GenAiLogEventFixtureFile,
  options?: {
    stampEventName?: boolean | undefined;
    arrivedAtNano?: string | undefined;
  },
): Array<LlmLogEventRecord> {
  const records: Array<LlmLogEventRecord> = [];
  const stampEventName: boolean = options?.stampEventName !== false;

  forEachLogRecord(
    fixture.logs,
    (data: {
      record: JSONObject;
      resourceAttributes: JSONObject;
      scope: JSONObject | undefined;
    }): void => {
      const attributes: JSONObject = Object.assign(
        {},
        data.resourceAttributes,
        TelemetryUtil.getAttributes({
          items: (data.record["attributes"] as JSONArray) || [],
          prefixKeysWithString: "",
        }),
        TelemetryUtil.getPrefixedScopeAttributes(data.scope),
      ) as JSONObject;

      const eventName: unknown =
        data.record["eventName"] ?? data.record["event_name"];

      if (
        stampEventName &&
        typeof eventName === "string" &&
        eventName.trim() &&
        attributes["event.name"] === undefined
      ) {
        attributes["event.name"] = eventName;
      }

      const time: unknown = data.record["timeUnixNano"];

      records.push({
        traceId: Text.convertOtlpIdToHex(
          data.record["traceId"] as string | undefined,
        ),
        spanId: Text.convertOtlpIdToHex(
          data.record["spanId"] as string | undefined,
        ),
        timeUnixNano:
          typeof time === "string" || typeof time === "number"
            ? String(time)
            : options?.arrivedAtNano || "0",
        observedTimeUnixNano: String(
          data.record["observedTimeUnixNano"] || "0",
        ),
        attributes: toStoredMap(attributes),
        body: toStoredBody(data.record["body"]),
      });
    },
  );

  return records;
}

// The fixture's GenAI spans as the Span table stores them.
export function toStoredSpans(
  fixture: GenAiLogEventFixtureFile,
): Array<StoredGenAiSpan> {
  const spans: Array<StoredGenAiSpan> = [];

  for (const resourceSpan of (fixture.traces["resourceSpans"] as JSONArray) ||
    []) {
    for (const scopeSpan of ((resourceSpan as JSONObject)[
      "scopeSpans"
    ] as JSONArray) || []) {
      for (const span of ((scopeSpan as JSONObject)["spans"] as JSONArray) ||
        []) {
        const row: JSONObject = span as JSONObject;
        const start: string = String(row["startTimeUnixNano"] || "0");
        const end: string = String(row["endTimeUnixNano"] || "0");

        spans.push({
          traceId: Text.convertOtlpIdToHex(row["traceId"] as string),
          spanId: Text.convertOtlpIdToHex(row["spanId"] as string),
          parentSpanId: Text.convertOtlpIdToHex(
            row["parentSpanId"] as string | undefined,
          ),
          name: String(row["name"] || ""),
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          startMs: Number(start.slice(0, -6) || "0"),
          endMs: Number(end.slice(0, -6) || "0"),
          attributes: toStoredMap(
            TelemetryUtil.getAttributes({
              items: (row["attributes"] as JSONArray) || [],
              prefixKeysWithString: "",
            }) as JSONObject,
          ),
          events: ((row["events"] as JSONArray) || []).map(
            (event: unknown): JSONObject => {
              const spanEvent: JSONObject = event as JSONObject;

              return {
                name: String(spanEvent["name"] || ""),
                time: "",
                timeUnixNano: String(spanEvent["timeUnixNano"] || "0"),
                attributes: TelemetryUtil.getAttributes({
                  items: (spanEvent["attributes"] as JSONArray) || [],
                  prefixKeysWithString: "",
                }) as JSONObject,
              };
            },
          ),
        });
      }
    }
  }

  return spans.sort((left: StoredGenAiSpan, right: StoredGenAiSpan) => {
    return left.startTimeUnixNano.length !== right.startTimeUnixNano.length
      ? left.startTimeUnixNano.length - right.startTimeUnixNano.length
      : left.startTimeUnixNano < right.startTimeUnixNano
        ? -1
        : left.startTimeUnixNano > right.startTimeUnixNano
          ? 1
          : 0;
  });
}
