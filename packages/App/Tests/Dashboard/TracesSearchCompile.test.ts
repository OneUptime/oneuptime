import { describe, expect, test } from "@jest/globals";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ParsedTraceSearch,
  TRACE_EXCLUDABLE_FIELD_KEYS,
  TraceAttributeFilters,
  TraceDurationFilter,
  TraceExclusions,
  TraceSearchChip,
  applyTraceExclusionsToPayload,
  applyTraceExclusionsToQuery,
  compileTraceAttributeFilters,
  getTraceChipFacetKey,
  getTraceChosenFacetKeys,
  getTypedTraceAttributeExclusionChips,
  getTypedTraceExclusionChips,
  isTraceFieldOfFacet,
  isTypedTraceAttributeExclusion,
  parseTraceSearch,
  readTraceExclusions,
  resolveTraceSearchChip,
  toSpanKind,
  toSpanStatusCode,
  toTraceDurationFilter,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";

/*
 * The traces explorer runs on two transports — a Query<Span> for the list and
 * a JSON body for the histogram / facets — and used to build them from two
 * different readings of the search bar. These tests pin the property that
 * replaced that: one token list, compiled once, so a filter cannot narrow the
 * table under a chart that keeps counting the rows it hides.
 */

/** Compile a search string alone, with no chips and no page scope. */
function compileSearch(search: string): TraceAttributeFilters {
  const parsed: ParsedTraceSearch = parseTraceSearch(search);

  return compileTraceAttributeFilters({
    chipValues: {},
    parsed: parsed.attributeFilters,
    legacyContainsChips: {},
    scope: {},
  });
}

/** Compile one `attributes.<key>` chip, as a facet click would produce it. */
function compileChip(key: string, value: string): TraceAttributeFilters {
  return compileTraceAttributeFilters({
    chipValues: { [key]: [value] },
    parsed: [],
    legacyContainsChips: {},
    scope: {},
  });
}

describe("attribute operators reach BOTH transports", () => {
  test("@k:a* is a wildcard on the list query and on the wire", () => {
    const compiled: TraceAttributeFilters = compileSearch("@k:a*");

    expect(compiled.queryAttributes["k"]).toBeInstanceOf(Wildcard);
    expect((compiled.queryAttributes["k"] as Wildcard<string>).values).toEqual([
      "a*",
    ]);
    expect(compiled.payloadAttributes["k"]).toEqual({
      _type: ObjectType.Wildcard,
      value: ["a*"],
    });
  });

  test("-@k:v excludes rather than dropping the negation", () => {
    const compiled: TraceAttributeFilters = compileSearch("-@k:v");

    expect(compiled.queryAttributes["k"]).toBeInstanceOf(NotEqual);
    expect((compiled.queryAttributes["k"] as NotEqual<string>).value).toBe("v");
    expect(compiled.payloadAttributes["k"]).toEqual({
      _type: ObjectType.NotEqual,
      value: "v",
    });
  });

  test("@k:>100 compares numerically, not as the string '>100'", () => {
    const compiled: TraceAttributeFilters = compileSearch("@k:>100");

    expect(compiled.queryAttributes["k"]).toBeInstanceOf(GreaterThan);
    expect(
      (compiled.queryAttributes["k"] as GreaterThan<number | string>).value,
    ).toBe(100);
    expect(compiled.payloadAttributes["k"]).toEqual({
      _type: ObjectType.GreaterThan,
      value: 100,
    });
  });

  test("@k:(a OR b) is an any-of list", () => {
    const compiled: TraceAttributeFilters = compileSearch("@k:(a OR b)");

    expect(compiled.queryAttributes["k"]).toBeInstanceOf(Includes);
    expect((compiled.queryAttributes["k"] as Includes).values).toEqual([
      "a",
      "b",
    ]);
    expect(compiled.payloadAttributes["k"]).toEqual({
      _type: ObjectType.Includes,
      value: ["a", "b"],
    });
  });

  test("@k:~text still means contains, and no longer rides attributeSearches", () => {
    const compiled: TraceAttributeFilters = compileSearch("@k:~text");

    expect(compiled.queryAttributes["k"]).toBeInstanceOf(Search);
    expect(compiled.payloadAttributes["k"]).toEqual({
      _type: ObjectType.Search,
      value: "text",
    });
    expect(compiled.payloadAttributeSearches).toEqual({});
  });

  test("a plain value stays a plain equality on both transports", () => {
    const compiled: TraceAttributeFilters = compileSearch("@http.method:GET");

    expect(compiled.queryAttributes["http.method"]).toBe("GET");
    expect(compiled.payloadAttributes["http.method"]).toBe("GET");
  });
});

describe("attributeSearches is legacy-only", () => {
  test("a saved view's contains chip still travels as attributeSearches", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      parsed: [],
      legacyContainsChips: { "db.statement": "SELECT" },
      scope: {},
    });

    expect(compiled.queryAttributes["db.statement"]).toBeInstanceOf(Search);
    expect(compiled.payloadAttributeSearches).toEqual({
      "db.statement": "SELECT",
    });
    expect(compiled.payloadAttributes["db.statement"]).toBeUndefined();
  });

  test("the page's read-only scope wins over a contains chip on the same key", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      parsed: [],
      legacyContainsChips: { "resource.host.name": "prod" },
      scope: { "resource.host.name": "prod-01" },
    });

    expect(compiled.queryAttributes["resource.host.name"]).toBe("prod-01");
    expect(compiled.payloadAttributes["resource.host.name"]).toBe("prod-01");
    expect(compiled.payloadAttributeSearches).toEqual({});
  });
});

describe("a sidebar value keeps whatever the data holds", () => {
  test("a literal * in a facet value stays literal on both transports", () => {
    const chipValue: string = buildSearchTokenValue("/api/*");
    const compiled: TraceAttributeFilters = compileChip(
      "http.route",
      chipValue,
    );

    expect(compiled.queryAttributes["http.route"]).toBe("/api/*");
    expect(compiled.payloadAttributes["http.route"]).toBe("/api/*");
  });

  test("a facet value with spaces round-trips through the chip", () => {
    const chipValue: string = buildSearchTokenValue("SELECT wp_options");
    const compiled: TraceAttributeFilters = compileChip(
      "db.statement",
      chipValue,
    );

    expect(compiled.queryAttributes["db.statement"]).toBe("SELECT wp_options");
  });

  test("two chips on one key both apply instead of overwriting", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: { "http.method": ["GET", "POST"] },
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(
      (compiled.queryAttributes["http.method"] as Includes).values,
    ).toEqual(["GET", "POST"]);
  });
});

describe("typed and chipped known fields compile identically", () => {
  test("status:error is submitted as text, not chipped as a string", () => {
    const chip: TraceSearchChip | null = resolveTraceSearchChip(
      "status",
      "error",
    );
    const parsed: ParsedTraceSearch = parseTraceSearch("status:error");

    expect(chip).toBeNull();
    expect(parsed.fieldFilters).toEqual({ statusCode: ["error"] });
    expect(toSpanStatusCode("error")).toBe(SpanStatus.Error);
    // The facet sidebar hands back the numeric string ClickHouse returns.
    expect(toSpanStatusCode(String(SpanStatus.Error))).toBe(SpanStatus.Error);
  });

  test("kind:server is submitted as text and mapped to the OTel enum", () => {
    const chip: TraceSearchChip | null = resolveTraceSearchChip(
      "kind",
      "server",
    );
    const parsed: ParsedTraceSearch = parseTraceSearch("kind:server");

    expect(chip).toBeNull();
    expect(parsed.fieldFilters).toEqual({ kind: ["server"] });
    expect(toSpanKind("server")).toBe("SPAN_KIND_SERVER");
    // An already-mapped value (a facet click) survives unchanged.
    expect(toSpanKind("SPAN_KIND_SERVER")).toBe("SPAN_KIND_SERVER");
  });

  test("duration:>500 is submitted as text and read once for both transports", () => {
    const chip: TraceSearchChip | null = resolveTraceSearchChip(
      "duration",
      ">500",
    );
    const parsed: ParsedTraceSearch = parseTraceSearch("duration:>500");

    expect(chip).toBeNull();
    expect(parsed.fieldFilters).toEqual({ durationUnixNano: [">500"] });

    const duration: TraceDurationFilter = toTraceDurationFilter(">500");

    expect(duration).toEqual({ minDurationNano: 500 * 1_000_000 });
  });

  test("duration:<200 and duration:200 read as an upper bound and an exact", () => {
    expect(toTraceDurationFilter("<200")).toEqual({
      maxDurationNano: 200 * 1_000_000,
    });
    expect(toTraceDurationFilter("200")).toEqual({
      exactDurationNano: 200 * 1_000_000,
    });
  });

  test("a duration naming no number yields no bound at all", () => {
    expect(toTraceDurationFilter(">")).toEqual({});
    expect(toTraceDurationFilter("fast")).toEqual({});
  });

  test("an unmapped known field still chips, through its column alias", () => {
    expect(resolveTraceSearchChip("service", "651a0000000000000000")).toEqual({
      facetKey: "primaryEntityId",
      value: "651a0000000000000000",
    });
    expect(resolveTraceSearchChip("name", '"SELECT wp_options"')).toEqual({
      facetKey: "name",
      value: "SELECT wp_options",
    });
  });

  test("a value carrying grammar is never chipped, whatever the field", () => {
    expect(resolveTraceSearchChip("k", "a*")).toBeNull();
    expect(resolveTraceSearchChip("k", ">100")).toBeNull();
    expect(resolveTraceSearchChip("k", "~text")).toBeNull();
    expect(resolveTraceSearchChip("k", "(a OR b)")).toBeNull();
    expect(resolveTraceSearchChip("k", "*")).toBeNull();
  });

  test("an attribute chip is written back as a grammar token", () => {
    const chip: TraceSearchChip | null = resolveTraceSearchChip(
      "http.route",
      '"/api/v1"',
    );

    expect(chip).toEqual({
      facetKey: "attributes.http.route",
      value: "/api/v1",
    });
  });

  test("a typed @k:a* and a hand-written a* chip compile to the same filter", () => {
    const typed: TraceAttributeFilters = compileSearch("@k:a*");
    const chipped: TraceAttributeFilters = compileChip("k", "a*");

    expect(chipped.payloadAttributes["k"]).toEqual(
      typed.payloadAttributes["k"] as JSONObject,
    );
  });
});

describe("the rest of the search string", () => {
  test("free text is the span-name search, with quotes resolved", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      'checkout "SELECT wp_options"',
    );

    expect(parsed.freeText).toBe("checkout SELECT wp_options");
    expect(parsed.fieldFilters).toEqual({});
    expect(parsed.attributeFilters).toEqual([]);
  });

  test("an any-of list on a known field fans out into its values", () => {
    expect(parseTraceSearch("status:(ok OR error)").fieldFilters).toEqual({
      statusCode: ["ok", "error"],
    });
  });

  test("prose containing a colon stays prose", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      "timeout at 12:30 on https://example.com",
    );

    expect(parsed.fieldFilters).toEqual({});
    expect(parsed.freeText).toBe("timeout at 12:30 on https://example.com");
  });

  test("a field name followed by a space still finds its value", () => {
    expect(parseTraceSearch("name: POST").fieldFilters).toEqual({
      name: ["POST"],
    });
  });
});

/*
 * A facet with a value chosen is counted without its own selection
 * (FacetCountPlan). These say which facet a chip chooses in and whether a
 * typed field filters on it; the viewer's wiring is rendered in Common's
 * ExplorerFacetMultiSelect.
 */
describe("the facet a traces chip chooses in", () => {
  const ATTRIBUTE_FACETS: ReadonlySet<string> = new Set<string>([
    "resource.host.name",
    "resource.service.instance.id",
  ]);

  test("a column chip counts its column's facet; a Service chip the Service facet", () => {
    expect(getTraceChipFacetKey("statusCode", ATTRIBUTE_FACETS)).toBe(
      "statusCode",
    );
    expect(getTraceChipFacetKey("kind", ATTRIBUTE_FACETS)).toBe("kind");
    expect(getTraceChipFacetKey("serviceId", ATTRIBUTE_FACETS)).toBe(
      "primaryEntityId",
    );
    expect(getTraceChipFacetKey("primaryEntityId", ATTRIBUTE_FACETS)).toBe(
      "primaryEntityId",
    );
  });

  test("an attribute chip counts its attribute facet only when the sidebar lists one", () => {
    expect(
      getTraceChipFacetKey("attributes.resource.host.name", ATTRIBUTE_FACETS),
    ).toBe("resource.host.name");
    expect(
      getTraceChipFacetKey("attributes.http.route", ATTRIBUTE_FACETS),
    ).toBeNull();
    expect(
      getTraceChipFacetKey("attributeSearches.http.route", ATTRIBUTE_FACETS),
    ).toBeNull();
  });

  test("the chosen facets: the reader's chips, each facet once, never the page's", () => {
    expect(
      getTraceChosenFacetKeys(
        [
          { facetKey: "statusCode" },
          { facetKey: "statusCode" },
          { facetKey: "attributes.resource.host.name" },
          { facetKey: "primaryEntityId", readOnly: true },
          { facetKey: "traceId" },
        ],
        ATTRIBUTE_FACETS,
      ).sort(),
    ).toEqual(["resource.host.name", "statusCode", "traceId"]);
  });

  test("a facet with one value to choose is not asked for on its own", () => {
    expect(
      getTraceChosenFacetKeys([{ facetKey: "hasException" }], ATTRIBUTE_FACETS),
    ).toEqual([]);
  });

  test("a typed field filters on its own facet; service: on the Service facet", () => {
    expect(isTraceFieldOfFacet("statusCode", "statusCode")).toBe(true);
    expect(isTraceFieldOfFacet("kind", "statusCode")).toBe(false);
    expect(isTraceFieldOfFacet("primaryEntityId", "primaryEntityId")).toBe(
      true,
    );
    expect(isTraceFieldOfFacet("serviceId", "primaryEntityId")).toBe(true);
    expect(isTraceFieldOfFacet("statusCode", "primaryEntityId")).toBe(false);
  });
});

/*
 * A status, a kind or "has exception" typed with a leading `-` leaves its
 * values out on BOTH transports - the span list's query and the histogram /
 * facets / analytics body, which have a field for each (excludedStatusCodes,
 * excludedSpanKinds) - through the very reading a facet row's minus goes
 * through. Before, `-status:error` was text to find in span names: it found
 * nothing, and the chart above the empty list kept counting.
 */
describe("a status, kind or exception flag typed with a leading - leaves its values out", () => {
  const NO_ATTRIBUTE_FACETS: ReadonlySet<string> = new Set<string>();

  // The reading both transports are compiled from, for a search alone.
  const readTyped: (
    search: string,
    omitFacetKey?: string,
  ) => TraceExclusions = (
    search: string,
    omitFacetKey?: string,
  ): TraceExclusions => {
    return readTraceExclusions({
      chips: getTypedTraceExclusionChips(parseTraceSearch(search)),
      attributeFacetKeys: NO_ATTRIBUTE_FACETS,
      omitFacetKey: omitFacetKey,
    });
  };

  const listQueryOf: (search: string) => Record<string, unknown> = (
    search: string,
  ): Record<string, unknown> => {
    const query: Record<string, unknown> = {};
    applyTraceExclusionsToQuery(query, readTyped(search));
    return query;
  };

  const payloadOf: (search: string) => JSONObject = (
    search: string,
  ): JSONObject => {
    const payload: JSONObject = {};
    applyTraceExclusionsToPayload(payload, readTyped(search));
    return payload;
  };

  test("the fields a leading - leaves out are status, kind and has exception", () => {
    expect(Array.from(TRACE_EXCLUDABLE_FIELD_KEYS).sort()).toEqual([
      "hasException",
      "kind",
      "statusCode",
    ]);
  });

  test("-status:error is a status left out, not text to find in span names", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch("-status:error");

    expect(parsed.excludedFieldFilters).toEqual({ statusCode: ["error"] });
    expect(parsed.fieldFilters).toEqual({});
    expect(parsed.freeText).toBe("");
  });

  test("the list leaves the stored code out; the chart leaves the same code out", () => {
    const query: Record<string, unknown> = listQueryOf("-status:error");

    expect(query["statusCode"]).toBeInstanceOf(NotEqual);
    expect((query["statusCode"] as NotEqual<number>).value).toBe(
      SpanStatus.Error,
    );
    expect(payloadOf("-status:error")).toEqual({
      excludedStatusCodes: [SpanStatus.Error],
    });
  });

  test("-kind:client leaves the stored OTel kind out of both", () => {
    expect(parseTraceSearch("-kind:client").excludedFieldFilters).toEqual({
      kind: ["client"],
    });
    expect(
      (listQueryOf("-kind:client")["kind"] as NotEqual<string>).value,
    ).toBe("SPAN_KIND_CLIENT");
    expect(payloadOf("-kind:client")).toEqual({
      excludedSpanKinds: ["SPAN_KIND_CLIENT"],
    });
  });

  test("-hasException:true is the spans without one, in both", () => {
    expect(listQueryOf("-hasException:true")["hasException"]).toBe(false);
    expect(payloadOf("-hasException:true")).toEqual({ hasException: false });
    expect(listQueryOf("-hasexception:false")["hasException"]).toBe(true);
  });

  test("an any-of list left out is one NOT IN of every value", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      "-status:(ok OR unset) -kind:(client OR producer)",
    );

    expect(parsed.excludedFieldFilters).toEqual({
      statusCode: ["ok", "unset"],
      kind: ["client", "producer"],
    });

    const query: Record<string, unknown> = listQueryOf(
      "-status:(ok OR unset) -kind:(client OR producer)",
    );

    expect(query["statusCode"]).toBeInstanceOf(IncludesNone);
    expect((query["statusCode"] as IncludesNone).values).toEqual([
      SpanStatus.Ok,
      SpanStatus.Unset,
    ]);
    expect((query["kind"] as IncludesNone).values).toEqual([
      "SPAN_KIND_CLIENT",
      "SPAN_KIND_PRODUCER",
    ]);
    expect(
      payloadOf("-status:(ok OR unset) -kind:(client OR producer)"),
    ).toEqual({
      excludedStatusCodes: [SpanStatus.Ok, SpanStatus.Unset],
      excludedSpanKinds: ["SPAN_KIND_CLIENT", "SPAN_KIND_PRODUCER"],
    });
  });

  test("the same value typed twice is left out once", () => {
    expect(
      parseTraceSearch("-status:error -STATUS:error").excludedFieldFilters,
    ).toEqual({ statusCode: ["error"] });
  });

  test("a value typed and the same value clicked in the sidebar are one status", () => {
    const exclusions: TraceExclusions = readTraceExclusions({
      chips: [
        { facetKey: "!statusCode", value: String(SpanStatus.Error) },
        ...getTypedTraceExclusionChips(parseTraceSearch("-status:error")),
      ],
      attributeFacetKeys: NO_ATTRIBUTE_FACETS,
    });
    const payload: JSONObject = {};
    applyTraceExclusionsToPayload(payload, exclusions);

    expect(payload).toEqual({ excludedStatusCodes: [SpanStatus.Error] });
  });

  test("the typed exclusions are the chips the facet rows' minus writes", () => {
    expect(
      getTypedTraceExclusionChips(
        parseTraceSearch("-status:error -kind:(client OR server) checkout"),
      ),
    ).toEqual([
      { facetKey: "!statusCode", value: "error" },
      { facetKey: "!kind", value: "client" },
      { facetKey: "!kind", value: "server" },
    ]);
    expect(
      getTypedTraceExclusionChips(parseTraceSearch("status:error")),
    ).toEqual([]);
  });

  test("the Status facet, counted without its own selection, is counted without a typed -status: too", () => {
    expect(
      readTyped("-status:error -kind:client", "statusCode").columns,
    ).toEqual({ kind: ["client"] });
  });

  test("a negated name, status message, duration or id stays text: no request can leave a part of it out", () => {
    for (const typed of [
      "-name:GET",
      "-statusMessage:timeout",
      "-duration:>500",
      "-trace:abc123",
      "-span:def456",
    ]) {
      const parsed: ParsedTraceSearch = parseTraceSearch(typed);

      expect(parsed.excludedFieldFilters).toEqual({});
      expect(parsed.fieldFilters).toEqual({});
      expect(parsed.freeText).toBe(typed);
    }
  });

  test("a pattern left out of a status stays text: the requests leave out values, not patterns", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch("-status:err*");

    expect(parsed.excludedFieldFilters).toEqual({});
    expect(parsed.freeText).toBe("-status:err*");
  });

  test("asked for and left out in one search: the values asked for that are not left out", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      "status:(ok OR error) -status:error",
    );

    expect(parsed.fieldFilters).toEqual({ statusCode: ["ok"] });
    expect(parsed.excludedFieldFilters).toEqual({});

    // A typed spelling and the stored code are one value here too.
    expect(
      parseTraceSearch(`kind:(server OR client) -kind:SPAN_KIND_CLIENT`)
        .fieldFilters,
    ).toEqual({ kind: ["server"] });
  });

  test("when nothing asked for would be left, the values asked for stand, as a kept chip's do", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      "status:error -status:error",
    );

    expect(parsed.fieldFilters).toEqual({ statusCode: ["error"] });
    expect(parsed.excludedFieldFilters).toEqual({});
  });

  test("a value kept by a chip wins over a typed one left out of its column, as a chip left out does", () => {
    const query: Record<string, unknown> = { statusCode: SpanStatus.Ok };
    applyTraceExclusionsToQuery(query, readTyped("-status:error"));

    expect(query).toEqual({ statusCode: SpanStatus.Ok });
  });
});

/*
 * A typed attribute left out (`-@k:v`) is compiled with the rest of the
 * search for the list and the chart (above). For the cross-signal pivots it
 * is also read as the `!attributes.<key>` chips the pivot carries, holding
 * the literal each leaves out.
 */
describe("a typed attribute left out, for the pivots", () => {
  test("-@k:v and -@k:(a OR b) are literals left out; a pattern is not", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      '-@http.method:GET -@http.route:("/health" OR "/ready") -@k:a* @kept:yes',
    );

    expect(
      parsed.attributeFilters.map(
        (filter: ParsedTraceSearch["attributeFilters"][number]): boolean => {
          return isTypedTraceAttributeExclusion(filter);
        },
      ),
    ).toEqual([true, true, false, false]);

    expect(getTypedTraceAttributeExclusionChips(parsed)).toEqual([
      { facetKey: "!attributes.http.method", value: "GET" },
      { facetKey: "!attributes.http.route", value: "/health" },
      { facetKey: "!attributes.http.route", value: "/ready" },
    ]);
  });

  test("a search with nothing left out has no chips", () => {
    expect(
      getTypedTraceAttributeExclusionChips(parseTraceSearch("@k:v checkout")),
    ).toEqual([]);
  });
});
