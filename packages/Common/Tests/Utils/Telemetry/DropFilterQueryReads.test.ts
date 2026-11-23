import { describe, expect, test } from "@jest/globals";
import {
  doesDropFilterReachQuery,
  doesDropFilterTakeAllOfQuery,
  DropFilterReading,
} from "../../../Utils/Telemetry/DropFilterQueryReads";
import {
  TelemetryFilterExpression,
  parseTelemetryFilterQuery,
} from "../../../Utils/Telemetry/TelemetryFilterQuery";
import { TelemetryReadQuery } from "../../../Utils/Telemetry/TelemetryFieldReferences";
import { TelemetryFieldSignal } from "../../../Types/Telemetry/TelemetryFieldReaders";

/*
 * WHETHER A DROP FILTER TAKES RECORDS A SAVED QUERY READS (#10436).
 *
 * A reader is left alone only when the filter's query is false under
 * everything the reader's query pins - its services, severities, span
 * statuses, an attribute's exact values. Anything it cannot rule out
 * counts as overlap, on the safe side.
 */

const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001043a1";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-0000001043a2";

// The fields a log row holds itself, as the server reads them from the Log table.
const LOG_ROW_FIELDS: ReadonlySet<string> = new Set<string>([
  "projectId",
  "primaryEntityId",
  "severityText",
  "severityNumber",
  "body",
  "traceId",
  "spanId",
  "attributes",
]);

const SPAN_ROW_FIELDS: ReadonlySet<string> = new Set<string>([
  "projectId",
  "primaryEntityId",
  "name",
  "kind",
  "statusCode",
  "statusMessage",
  "isEntrySpan",
  "isRootSpan",
  "hasException",
  "attributes",
]);

function filterOf(
  query: string,
  signal: TelemetryFieldSignal = "log",
): DropFilterReading {
  const expr: TelemetryFilterExpression | null =
    parseTelemetryFilterQuery(query);

  expect(expr).not.toBeNull();

  return {
    signal,
    expr: expr as TelemetryFilterExpression,
    rowFields: signal === "log" ? LOG_ROW_FIELDS : SPAN_ROW_FIELDS,
  };
}

function readerOf(data: {
  signal?: TelemetryFieldSignal;
  serviceIds?: Array<string> | null;
  pinned?: Record<string, Array<string>>;
}): TelemetryReadQuery {
  return {
    signal: data.signal || "log",
    serviceIds: data.serviceIds === undefined ? null : data.serviceIds,
    pinned: data.pinned || {},
    references: [],
  };
}

describe("a reader of another signal", () => {
  test("a log filter takes no span, and a trace filter no log", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'Debug'"),
        readerOf({ signal: "trace" }),
      ),
    ).toBe(false);
    expect(
      doesDropFilterReachQuery(
        filterOf("name = 'GET /health'", "trace"),
        readerOf({ signal: "log" }),
      ),
    ).toBe(false);
  });
});

describe("services", () => {
  test("a filter of one service leaves another service's monitor alone", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf(`primaryEntityId = '${CHECKOUT}'`),
        readerOf({ serviceIds: [PAYMENTS] }),
      ),
    ).toBe(false);
  });

  test("and reaches a monitor of that service, or of every service", () => {
    const filter: DropFilterReading = filterOf(
      `primaryEntityId = '${CHECKOUT}'`,
    );

    expect(
      doesDropFilterReachQuery(
        filter,
        readerOf({ serviceIds: [CHECKOUT, PAYMENTS] }),
      ),
    ).toBe(true);
    expect(doesDropFilterReachQuery(filter, readerOf({}))).toBe(true);
  });

  test("one of several services, as IN lists them", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf(`primaryEntityId IN ('${CHECKOUT}', '${PAYMENTS}')`),
        readerOf({ serviceIds: [PAYMENTS] }),
      ),
    ).toBe(true);
    expect(
      doesDropFilterReachQuery(
        filterOf(`primaryEntityId IN ('${CHECKOUT}')`),
        readerOf({ serviceIds: [PAYMENTS] }),
      ),
    ).toBe(false);
  });

  test("a filter of every service but one reaches only the others", () => {
    const filter: DropFilterReading = filterOf(
      `primaryEntityId != '${CHECKOUT}'`,
    );

    expect(
      doesDropFilterReachQuery(filter, readerOf({ serviceIds: [CHECKOUT] })),
    ).toBe(false);
    expect(
      doesDropFilterReachQuery(filter, readerOf({ serviceIds: [PAYMENTS] })),
    ).toBe(true);
  });
});

describe("severities", () => {
  test("a filter of Debug logs leaves a monitor of errors alone", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'Debug'"),
        readerOf({ pinned: { severityText: ["Error", "Fatal"] } }),
      ),
    ).toBe(false);
  });

  test("and takes every log of a monitor of Debug logs", () => {
    const filter: DropFilterReading = filterOf("severityText = 'Debug'");
    const reader: TelemetryReadQuery = readerOf({
      pinned: { severityText: ["Debug"] },
    });

    expect(doesDropFilterReachQuery(filter, reader)).toBe(true);
    expect(doesDropFilterTakeAllOfQuery(filter, reader)).toBe(true);
  });

  test("a monitor of every severity may lose some of its logs, not all", () => {
    const filter: DropFilterReading = filterOf("severityText = 'Debug'");

    expect(doesDropFilterReachQuery(filter, readerOf({}))).toBe(true);
    expect(doesDropFilterTakeAllOfQuery(filter, readerOf({}))).toBe(false);
  });

  test("= compares the case as written, as ingest does", () => {
    // The engine never matches DEBUG against a stored Debug: nor does this.
    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'DEBUG'"),
        readerOf({ pinned: { severityText: ["Debug"] } }),
      ),
    ).toBe(false);
  });
});

describe("attributes", () => {
  test("attributes.env = 'staging' leaves a monitor of env = 'prod' alone", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.env = 'staging'"),
        readerOf({ pinned: { "attributes.env": ["prod"] } }),
      ),
    ).toBe(false);
  });

  test("a bare key the row has no field of is the attribute", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("env = 'staging'"),
        readerOf({ pinned: { "attributes.env": ["prod"] } }),
      ),
    ).toBe(false);
    expect(
      doesDropFilterReachQuery(
        filterOf("env = 'prod'"),
        readerOf({ pinned: { "attributes.env": ["prod"] } }),
      ),
    ).toBe(true);
  });

  test("LIKE without % holds the text anywhere, in any case", () => {
    const reader: TelemetryReadQuery = readerOf({
      pinned: { "attributes.http.route": ["/api/Health/live"] },
    });

    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.http.route LIKE 'health'"),
        reader,
      ),
    ).toBe(true);
    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.http.route LIKE 'checkout'"),
        reader,
      ),
    ).toBe(false);
  });

  test("LIKE with % reads the whole value against the pattern", () => {
    const reader: TelemetryReadQuery = readerOf({
      pinned: { "attributes.http.route": ["/api/health"] },
    });

    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.http.route LIKE '/api/%'"),
        reader,
      ),
    ).toBe(true);
    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.http.route LIKE '/internal/%'"),
        reader,
      ),
    ).toBe(false);
  });

  test("an attribute the reader does not pin can be anything: overlap", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("attributes.env = 'staging'"),
        readerOf({ pinned: { "attributes.team": ["core"] } }),
      ),
    ).toBe(true);
  });

  test("the body, which no query pins, is never ruled out", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("body LIKE 'healthcheck'"),
        readerOf({ pinned: { severityText: ["Error"] } }),
      ),
    ).toBe(true);
  });
});

describe("AND, OR and NOT", () => {
  test("one condition ruled out rules out an AND", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'Debug' AND body LIKE 'healthcheck'"),
        readerOf({ pinned: { severityText: ["Error"] } }),
      ),
    ).toBe(false);
  });

  test("an OR reaches a reader when either side can", () => {
    const reader: TelemetryReadQuery = readerOf({
      pinned: { severityText: ["Error"] },
    });

    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'Debug' OR body LIKE 'timeout'"),
        reader,
      ),
    ).toBe(true);
    expect(
      doesDropFilterReachQuery(
        filterOf("severityText = 'Debug' OR severityText = 'Trace'"),
        reader,
      ),
    ).toBe(false);
  });

  test("NOT turns a sure answer round, and leaves an unknown unknown", () => {
    const reader: TelemetryReadQuery = readerOf({
      pinned: { severityText: ["Error"] },
    });

    expect(
      doesDropFilterReachQuery(filterOf("NOT severityText = 'Error'"), reader),
    ).toBe(false);
    expect(
      doesDropFilterReachQuery(filterOf("NOT severityText = 'Debug'"), reader),
    ).toBe(true);
    expect(
      doesDropFilterReachQuery(filterOf("NOT body LIKE 'x'"), reader),
    ).toBe(true);
  });

  test("parentheses group as written", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf(
          `(severityText = 'Debug' OR severityText = 'Trace') AND primaryEntityId = '${CHECKOUT}'`,
        ),
        readerOf({
          serviceIds: [CHECKOUT],
          pinned: { severityText: ["Trace"] },
        }),
      ),
    ).toBe(true);
  });
});

describe("spans", () => {
  test("a filter of successful spans leaves a monitor of errors alone", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("statusCode != '2'", "trace"),
        readerOf({ signal: "trace", pinned: { statusCode: ["2"] } }),
      ),
    ).toBe(false);
  });

  test("a filter of child spans leaves a request SLO, which reads entry spans, alone", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("isEntrySpan = 'false'", "trace"),
        readerOf({ signal: "trace", pinned: { isEntrySpan: ["true"] } }),
      ),
    ).toBe(false);
  });

  test("a span's name pinned by an SLO term", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("name = 'GET /health'", "trace"),
        readerOf({ signal: "trace", pinned: { name: ["POST /checkout"] } }),
      ),
    ).toBe(false);
  });
});

describe("a reader that keeps no record", () => {
  test("two conditions on one field with nothing in common, or no service", () => {
    expect(
      doesDropFilterReachQuery(
        filterOf("body LIKE 'x'"),
        readerOf({ pinned: { severityText: [] } }),
      ),
    ).toBe(false);
    expect(
      doesDropFilterReachQuery(
        filterOf("body LIKE 'x'"),
        readerOf({ serviceIds: [] }),
      ),
    ).toBe(false);
  });
});

describe("an operator the engine does not know", () => {
  test("never matches, so the filter takes nothing of the field", () => {
    expect(
      doesDropFilterReachQuery(
        {
          signal: "log",
          expr: {
            type: "comparison",
            field: "severityText",
            operator: ">",
            value: "Debug",
          } as TelemetryFilterExpression,
          rowFields: LOG_ROW_FIELDS,
        },
        readerOf({ pinned: { severityText: ["Error"] } }),
      ),
    ).toBe(false);
  });
});
