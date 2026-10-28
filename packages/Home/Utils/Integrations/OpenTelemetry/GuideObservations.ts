import { ExpectedLog, ExpectedSpan, GuideVerificationRun } from "./GuideTypes";

/*
 * What reached the receiver in a guide's end-to-end check, and whether it
 * is what the guide expects (Scripts/VerifyOpenTelemetryGuides.ts). The
 * collector writes each OTLP export request it gets as a line of JSON;
 * observedFrom reads those requests into spans, metric names and log
 * records, and checkObserved holds them to the run's expectations, giving
 * one line for each that failed.
 */

export interface ObservedSpan {
  name: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
  hasException: boolean;
  // The exception.message of each of its exception events.
  exceptionMessages: Array<string>;
}

export interface ObservedLog {
  body: string;
  traceId: string;
  // exception.* attributes: OneUptime files the record under Exceptions.
  hasException: boolean;
  attributes: Record<string, unknown>;
}

export interface Observed {
  spans: Array<ObservedSpan>;
  metrics: Array<string>;
  logs: Array<ObservedLog>;
  resources: Array<Record<string, unknown>>;
}

// The export requests the collector wrote, one parsed JSON line each.
export interface ExportRequests {
  traces: Array<JsonObject>;
  metrics: Array<JsonObject>;
  logs: Array<JsonObject>;
}

export type JsonObject = Record<string, unknown>;

const EXCEPTION_ATTRIBUTES: Array<string> = [
  "exception.type",
  "exception.message",
  "exception.stacktrace",
];

// An OTLP AnyValue as a plain value: its string, number or boolean.
function attributeValue(value: JsonObject | undefined): unknown {
  if (!value) {
    return undefined;
  }

  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (key in value) {
      return value[key];
    }
  }

  return value;
}

function attributesOf(items: unknown): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const item of (items as Array<JsonObject>) || []) {
    attributes[String(item["key"])] = attributeValue(
      item["value"] as JsonObject,
    );
  }

  return attributes;
}

function listOf(value: unknown): Array<JsonObject> {
  return (value as Array<JsonObject>) || [];
}

function resourceOf(resourceBlock: JsonObject): Record<string, unknown> {
  return attributesOf(
    (resourceBlock["resource"] as JsonObject | undefined)?.["attributes"],
  );
}

function spanOf(span: JsonObject): ObservedSpan {
  const exceptionEvents: Array<JsonObject> = listOf(span["events"]).filter(
    (event: JsonObject): boolean => {
      return event["name"] === "exception";
    },
  );

  return {
    name: String(span["name"]),
    spanId: String(span["spanId"] || ""),
    parentSpanId: String(span["parentSpanId"] || ""),
    attributes: attributesOf(span["attributes"]),
    hasException: exceptionEvents.length > 0,
    exceptionMessages: exceptionEvents.map((event: JsonObject): string => {
      return String(
        attributesOf(event["attributes"])["exception.message"] ?? "",
      );
    }),
  };
}

function logOf(record: JsonObject): ObservedLog {
  const body: unknown = attributeValue(record["body"] as JsonObject);
  const attributes: Record<string, unknown> = attributesOf(
    record["attributes"],
  );

  return {
    body: typeof body === "string" ? body : JSON.stringify(body),
    traceId: String(record["traceId"] || ""),
    hasException: EXCEPTION_ATTRIBUTES.some((key: string): boolean => {
      return attributes[key] !== undefined;
    }),
    attributes: attributes,
  };
}

export function observedFrom(requests: ExportRequests): Observed {
  const observed: Observed = {
    spans: [],
    metrics: [],
    logs: [],
    resources: [],
  };

  for (const request of requests.traces) {
    for (const resourceSpans of listOf(request["resourceSpans"])) {
      observed.resources.push(resourceOf(resourceSpans));
      for (const scopeSpans of listOf(resourceSpans["scopeSpans"])) {
        for (const span of listOf(scopeSpans["spans"])) {
          observed.spans.push(spanOf(span));
        }
      }
    }
  }

  for (const request of requests.metrics) {
    for (const resourceMetrics of listOf(request["resourceMetrics"])) {
      observed.resources.push(resourceOf(resourceMetrics));
      for (const scopeMetrics of listOf(resourceMetrics["scopeMetrics"])) {
        for (const metric of listOf(scopeMetrics["metrics"])) {
          observed.metrics.push(String(metric["name"]));
        }
      }
    }
  }

  for (const request of requests.logs) {
    for (const resourceLogs of listOf(request["resourceLogs"])) {
      observed.resources.push(resourceOf(resourceLogs));
      for (const scopeLogs of listOf(resourceLogs["scopeLogs"])) {
        for (const record of listOf(scopeLogs["logRecords"])) {
          observed.logs.push(logOf(record));
        }
      }
    }
  }

  return observed;
}

// Whether a span that arrived is the one the guide expects.
function spanMatches(
  expected: ExpectedSpan,
  span: ObservedSpan,
  spans: Array<ObservedSpan>,
): boolean {
  if (span.name !== expected.name) {
    return false;
  }
  if (
    expected.hasException !== undefined &&
    expected.hasException !== span.hasException
  ) {
    return false;
  }
  if (
    expected.exceptionMessage !== undefined &&
    !span.exceptionMessages.some((message: string): boolean => {
      return message.includes(expected.exceptionMessage || "");
    })
  ) {
    return false;
  }
  if (
    expected.parent !== undefined &&
    !spans.some((candidate: ObservedSpan): boolean => {
      return (
        candidate.name === expected.parent &&
        candidate.spanId.length > 0 &&
        candidate.spanId === span.parentSpanId
      );
    })
  ) {
    return false;
  }
  if (
    (expected.absentAttributes || []).some((key: string): boolean => {
      return span.attributes[key] !== undefined;
    })
  ) {
    return false;
  }
  if (
    expected.parentSpanId !== undefined &&
    span.parentSpanId !== expected.parentSpanId
  ) {
    return false;
  }

  return Object.entries(expected.attributes || {}).every(
    ([key, value]: [string, string]): boolean => {
      return String(span.attributes[key]) === value;
    },
  );
}

function logMatches(expected: ExpectedLog, record: ObservedLog): boolean {
  return (
    record.body.includes(expected.body) &&
    (!expected.hasTraceContext || record.traceId.length > 0) &&
    (expected.hasException === undefined ||
      expected.hasException === record.hasException) &&
    Object.entries(expected.attributes || {}).every(
      ([key, value]: [string, string]): boolean => {
        return String(record.attributes[key]) === value;
      },
    )
  );
}

// What the run expected and did not get: none when everything arrived.
export function checkObserved(
  run: GuideVerificationRun,
  observed: Observed,
): Array<string> {
  const failures: Array<string> = [];

  for (const expected of run.expect.spans) {
    if (
      !observed.spans.some((span: ObservedSpan): boolean => {
        return spanMatches(expected, span, observed.spans);
      })
    ) {
      failures.push(`no span ${JSON.stringify(expected)}`);
    }
  }

  for (const metric of run.expect.metrics) {
    if (!observed.metrics.includes(metric)) {
      failures.push(`no metric ${metric}`);
    }
  }

  for (const expected of run.expect.logs) {
    if (
      !observed.logs.some((record: ObservedLog): boolean => {
        return logMatches(expected, record);
      })
    ) {
      failures.push(`no log ${JSON.stringify(expected)}`);
    }
  }

  for (const [key, value] of Object.entries(run.expect.resource || {})) {
    if (
      !observed.resources.some((resource: Record<string, unknown>): boolean => {
        return String(resource[key]) === value;
      })
    ) {
      failures.push(`no resource with ${key}=${value}`);
    }
  }

  for (const untraced of run.expect.untracedPaths || []) {
    const traced: ObservedSpan | undefined = observed.spans.find(
      (span: ObservedSpan): boolean => {
        return (
          span.attributes["url.path"] === untraced ||
          span.attributes["http.target"] === untraced
        );
      },
    );

    if (traced) {
      failures.push(
        `a span for ${untraced}, which the guide leaves out: ${traced.name}`,
      );
    }
  }

  for (const absent of run.expect.absentSpans || []) {
    if (
      observed.spans.some((span: ObservedSpan): boolean => {
        return span.name === absent;
      })
    ) {
      failures.push(`a span named ${absent}, which the guide turns off`);
    }
  }

  for (const absent of run.expect.absentMetrics || []) {
    if (observed.metrics.includes(absent)) {
      failures.push(`a metric named ${absent}, which the guide leaves out`);
    }
  }

  for (const absent of run.expect.absentLogs || []) {
    const found: ObservedLog | undefined = observed.logs.find(
      (record: ObservedLog): boolean => {
        return record.body.includes(absent);
      },
    );

    if (found) {
      failures.push(
        `a log line with ${absent}, which the guide leaves out: ${found.body}`,
      );
    }
  }

  return failures;
}
