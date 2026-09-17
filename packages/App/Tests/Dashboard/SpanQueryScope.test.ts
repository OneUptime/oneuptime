import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import {
  EMPTY_SPAN_QUERY_SCOPE,
  SpanQueryScope,
  SpanScopeChip,
  buildSpanQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/SpanQueryScope";

/*
 * The Alert and Incident pages used to render a trace monitor's stored query
 * through a dense table that took the query verbatim. They now embed the
 * spans explorer, which needs the SAME query in three different vocabularies
 * at once — the list query, the histogram/facet aggregation payload, and the
 * read-only chips — plus the window for the picker.
 *
 * Splitting one filter across those three by hand is how a chart ends up
 * counting rows the list excludes, so the split is made once, here, and this
 * file is where the correspondences are pinned. The inputs are real
 * `MonitorStepTraceMonitorUtil.toQuery` output taken through the same
 * store/load round trip the pages perform, not hand-written objects, so a
 * change to what a monitor stores breaks this file rather than the pages.
 */

const SERVICE_ID_A: string = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
).toString();
const SERVICE_ID_B: string = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
).toString();

/** Persist the way the worker does; restore the way the pages do. */
function roundTrip(query: Query<Span>): Query<Span> {
  return JSONFunctions.deserialize(
    JSONFunctions.anyObjectToJSONObject(query as unknown as JSONObject),
  ) as unknown as Query<Span>;
}

/** Persist without deserializing — the shape a raw JSON consumer sees. */
function storedOnly(query: Query<Span>): JSONObject {
  return JSONFunctions.anyObjectToJSONObject(query as unknown as JSONObject);
}

function traceMonitorQuery(
  overrides: Partial<Parameters<typeof MonitorStepTraceMonitorUtil.toQuery>[0]>,
): Query<Span> {
  return MonitorStepTraceMonitorUtil.toQuery({
    ...MonitorStepTraceMonitorUtil.getDefault(),
    ...overrides,
  });
}

function chipFor(
  scope: SpanQueryScope,
  facetKey: string,
): Array<SpanScopeChip> {
  return scope.chips.filter((chip: SpanScopeChip): boolean => {
    return chip.facetKey === facetKey;
  });
}

describe("a real trace monitor's stored query", () => {
  const stored: Query<Span> = traceMonitorQuery({
    telemetryServiceIds: [
      new ObjectID(SERVICE_ID_A),
      new ObjectID(SERVICE_ID_B),
    ],
    entityKeys: ["service:checkout", "k8s.pod:checkout-abc"],
    attributes: { "http.route": "/checkout", "http.status_code": 500 },
    spanStatuses: [SpanStatus.Error],
    spanName: "POST /checkout",
    lastXSecondsOfSpans: 300,
  });

  test("every key a trace monitor emits is read into the scope", () => {
    /*
     * The list of keys is the contract. If MonitorStepTraceMonitorUtil grows
     * one, this test still passes but `notCarried` names it — see the
     * unknown-key test below — so the widening is at least visible.
     */
    expect(Object.keys(stored).sort()).toEqual([
      "attributes",
      "entityKeys",
      "name",
      "primaryEntityId",
      "startTime",
      "statusCode",
    ]);
  });

  test("reads identically whether or not the page deserialized it", () => {
    const deserialized: SpanQueryScope = buildSpanQueryScope(roundTrip(stored));
    const raw: SpanQueryScope = buildSpanQueryScope(storedOnly(stored));

    for (const scope of [deserialized, raw]) {
      expect(scope.serviceIds).toEqual([SERVICE_ID_A, SERVICE_ID_B]);
      expect(scope.entityKeys).toEqual([
        "service:checkout",
        "k8s.pod:checkout-abc",
      ]);
      /*
       * Stringified: the ClickHouse attributes column is Map(String, String),
       * and the aggregation endpoint's body parser drops a bare number
       * outright — a numeric attribute would have narrowed the list while the
       * chart above it silently ignored the filter.
       */
      expect(scope.attributes).toEqual({
        "http.route": "/checkout",
        "http.status_code": "500",
      });
      expect(scope.statusCodes).toEqual([SpanStatus.Error]);
      expect(scope.spanNameSearch).toBe("POST /checkout");
      expect(scope.hasScope).toBe(true);
    }
  });

  test("nothing is left over: no passthrough, no un-carried scope", () => {
    /*
     * Every key of a trace monitor's query has an exact counterpart in the
     * aggregation payload (parseTraceFilterBody accepts serviceIds,
     * entityKeys, statusCodes, spanNames/spanNameSearches, attributes), so a
     * trace snapshot must never report a widened chart.
     */
    const scope: SpanQueryScope = buildSpanQueryScope(roundTrip(stored));

    expect(scope.passthrough).toEqual({});
    expect(scope.notCarried).toEqual([]);
  });

  test("the window becomes a pin, not a filter", () => {
    const scope: SpanQueryScope = buildSpanQueryScope(roundTrip(stored));

    expect(scope.window).not.toBeNull();
    expect(
      scope.window!.endValue.getTime() - scope.window!.startValue.getTime(),
    ).toBe(300 * 1000);

    // It must not survive as a query filter — the picker owns the window.
    expect(scope.passthrough).not.toHaveProperty("startTime");

    // And it is the same window the pages badge the card with.
    const pageWindow: InBetween<Date> | null =
      TelemetryQueryTimeRange.getQueryWindow(
        roundTrip(stored),
        TelemetryType.Trace,
      );

    expect(scope.window!.startValue.getTime()).toBe(
      pageWindow!.startValue.getTime(),
    );
  });

  test("projectId is dropped — the viewer stamps its own", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      ...roundTrip(stored),
      projectId: new ObjectID(SERVICE_ID_A),
    } as Query<Span>);

    expect(scope.passthrough).not.toHaveProperty("projectId");
    expect(scope.notCarried).toEqual([]);
  });

  test("every scoped dimension surfaces as a chip", () => {
    /*
     * A snapshot that filters silently makes a short list look like the whole
     * truth, so each dimension has to be visible to the reader.
     */
    const scope: SpanQueryScope = buildSpanQueryScope(roundTrip(stored));

    expect(
      chipFor(scope, "primaryEntityId").map((c: SpanScopeChip) => {
        return c.value;
      }),
    ).toEqual([SERVICE_ID_A, SERVICE_ID_B]);
    expect(chipFor(scope, "entityKeys")).toHaveLength(2);
    expect(
      chipFor(scope, "name").map((c: SpanScopeChip) => {
        return c.value;
      }),
    ).toEqual(["POST /checkout"]);
    expect(chipFor(scope, "attributes.http.route")).toHaveLength(1);
    expect(chipFor(scope, "attributes.http.status_code")[0]!.value).toBe("500");

    // Status shows as its name, not the enum's number.
    expect(chipFor(scope, "statusCode")[0]!.displayValue).toBe("Error");
  });
});

describe("span name and status message: substring vs exact", () => {
  test("a monitor's Search stays a substring match", () => {
    /*
     * `MonitorStepTraceMonitorUtil.toQuery` stores `new Search(spanName)`.
     * Reading it as an exact value would scope the list to spans whose WHOLE
     * name equals the fragment — usually none — and the incident would read
     * "No spans found".
     */
    const scope: SpanQueryScope = buildSpanQueryScope(
      roundTrip(traceMonitorQuery({ spanName: "checkout" })),
    );

    expect(scope.spanNameSearch).toBe("checkout");
    expect(scope.spanNames).toEqual([]);
  });

  test("a single exact value is still a substring, mirroring a chip", () => {
    // TEXT_CHIP_FIELDS in TracesViewer: one value → Search, several → Includes.
    const scope: SpanQueryScope = buildSpanQueryScope({
      name: "GET /api",
    } as unknown as Query<Span>);

    expect(scope.spanNameSearch).toBe("GET /api");
    expect(scope.spanNames).toEqual([]);
  });

  test("several values are matched exactly", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      name: new Includes(["GET /a", "GET /b"]),
    } as unknown as Query<Span>);

    expect(scope.spanNameSearch).toBeNull();
    expect(scope.spanNames).toEqual(["GET /a", "GET /b"]);
  });

  test("statusMessage follows the same rule", () => {
    const single: SpanQueryScope = buildSpanQueryScope({
      statusMessage: new Search<string>("timeout"),
    } as unknown as Query<Span>);
    const many: SpanQueryScope = buildSpanQueryScope({
      statusMessage: new Includes(["timeout", "refused"]),
    } as unknown as Query<Span>);

    expect(single.statusMessageSearch).toBe("timeout");
    expect(single.statusMessages).toEqual([]);
    expect(many.statusMessageSearch).toBeNull();
    expect(many.statusMessages).toEqual(["timeout", "refused"]);
  });
});

describe("the other span columns the aggregation payload can express", () => {
  test("trace / span ids, kind and hasException are read, not passed through", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      traceId: new Includes(["t1", "t2"]),
      spanId: "s1",
      kind: "SPAN_KIND_SERVER",
      hasException: true,
    } as unknown as Query<Span>);

    expect(scope.traceIds).toEqual(["t1", "t2"]);
    expect(scope.spanIds).toEqual(["s1"]);
    expect(scope.spanKinds).toEqual(["SPAN_KIND_SERVER"]);
    expect(scope.hasException).toBe(true);
    expect(scope.passthrough).toEqual({});
    expect(scope.notCarried).toEqual([]);
  });

  test("hasException is tri-state, so 'unfiltered' and 'false' differ", () => {
    expect(buildSpanQueryScope({} as Query<Span>).hasException).toBeNull();
    expect(
      buildSpanQueryScope({ hasException: false } as unknown as Query<Span>)
        .hasException,
    ).toBe(false);
    // A JSON round trip can leave it as a string.
    expect(
      buildSpanQueryScope({ hasException: "true" } as unknown as Query<Span>)
        .hasException,
    ).toBe(true);
  });

  test("isRootSpan becomes the root-only toggle rather than a raw filter", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      isRootSpan: true,
    } as unknown as Query<Span>);

    expect(scope.rootOnly).toBe(true);
    expect(scope.passthrough).not.toHaveProperty("isRootSpan");
  });
});

describe("attributes", () => {
  test("a boolean scope value is stringified too", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      attributes: { "error.escaped": true },
    } as unknown as Query<Span>);

    expect(scope.attributes).toEqual({ "error.escaped": "true" });
  });

  test("an unmodelled entry still filters the list, and says the chart is wider", () => {
    /*
     * A partially readable attributes map is the dangerous case: dropping the
     * half we cannot model would widen the LIST under an event's heading with
     * nothing on screen saying so.
     */
    const contains: unknown = { _type: "Search", value: "checkout" };
    const scope: SpanQueryScope = buildSpanQueryScope({
      attributes: { "http.route": contains, "http.method": "GET" },
    } as unknown as Query<Span>);

    expect(scope.attributes).toEqual({ "http.method": "GET" });
    expect(scope.attributesPassthrough).toEqual({ "http.route": contains });
    expect(scope.notCarried).toContain("attribute filter on http.route");
    expect(scope.hasScope).toBe(true);
  });

  test("an attributes value that is not a record at all is reported", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      attributes: "nonsense",
    } as unknown as Query<Span>);

    expect(scope.notCarried).toContain("attribute filter");
  });
});

describe("scope the payload cannot express is reported, never dropped", () => {
  test("an unknown key still filters the list and names itself in the hint", () => {
    /*
     * The alternative — dropping it — widens the list under an event's
     * heading with nothing on screen saying so. A narrower list plus a hint
     * that the chart above is wider is the honest failure mode.
     */
    const scope: SpanQueryScope = buildSpanQueryScope({
      durationUnixNano: new Includes([1, 2]),
      someFutureColumn: "x",
    } as unknown as Query<Span>);

    expect(scope.passthrough).toHaveProperty("durationUnixNano");
    expect(scope.passthrough).toHaveProperty("someFutureColumn");
    expect(scope.notCarried).toContain("span duration filter");
    expect(scope.notCarried).toContain("someFutureColumn");
    expect(scope.hasScope).toBe(true);
  });

  test("an unreadable value on a known column is forwarded and reported", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      statusCode: { weird: true },
    } as unknown as Query<Span>);

    expect(scope.statusCodes).toEqual([]);
    expect(scope.passthrough).toHaveProperty("statusCode");
    expect(scope.notCarried).toContain("span status filter");
  });

  test("an EMPTY membership is silent — it filters nothing", () => {
    /*
     * A monitor with no services selected stores `Includes([])`. Reporting
     * that as un-carried scope would put a hint on every such incident.
     */
    const scope: SpanQueryScope = buildSpanQueryScope({
      primaryEntityId: new Includes([]),
    } as unknown as Query<Span>);

    expect(scope.serviceIds).toEqual([]);
    expect(scope.notCarried).toEqual([]);
    expect(scope.passthrough).toEqual({});
    expect(scope.hasScope).toBe(false);
  });
});

describe("absent and degenerate queries", () => {
  test("null / undefined / non-object yield the empty scope", () => {
    for (const value of [null, undefined, [], "nope", 7]) {
      const scope: SpanQueryScope = buildSpanQueryScope(
        value as unknown as Query<Span>,
      );

      expect(scope.hasScope).toBe(false);
      expect(scope.window).toBeNull();
      expect(scope.chips).toEqual([]);
    }
  });

  test("a window-only query pins the picker but scopes nothing", () => {
    /*
     * A monitor with no filters at all still stores its evaluation window.
     * The viewer must adopt the window and otherwise behave exactly as the
     * standalone explorer does.
     */
    const scope: SpanQueryScope = buildSpanQueryScope(
      roundTrip(traceMonitorQuery({ lastXSecondsOfSpans: 60 })),
    );

    expect(scope.window).not.toBeNull();
    expect(scope.hasScope).toBe(false);
    expect(scope.chips).toEqual([]);
  });

  test("the exported empty scope is inert", () => {
    expect(EMPTY_SPAN_QUERY_SCOPE.hasScope).toBe(false);
    expect(EMPTY_SPAN_QUERY_SCOPE.window).toBeNull();
    expect(EMPTY_SPAN_QUERY_SCOPE.hasException).toBeNull();
    expect(EMPTY_SPAN_QUERY_SCOPE.rootOnly).toBe(false);
  });

  test("reading a query twice does not mutate the shared empty scope", () => {
    // The builder spreads EMPTY_SPAN_QUERY_SCOPE; a shallow copy would leak.
    buildSpanQueryScope({
      primaryEntityId: SERVICE_ID_A,
      traceId: "t1",
    } as unknown as Query<Span>);

    expect(EMPTY_SPAN_QUERY_SCOPE.serviceIds).toEqual([]);
    expect(EMPTY_SPAN_QUERY_SCOPE.traceIds).toEqual([]);
    expect(EMPTY_SPAN_QUERY_SCOPE.chips).toEqual([]);
    expect(EMPTY_SPAN_QUERY_SCOPE.passthrough).toEqual({});
  });
});
