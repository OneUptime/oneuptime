import { describe, expect, test } from "@jest/globals";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ParsedTraceSearch,
  TraceAttributeFilters,
  TraceDurationFilter,
  TraceSearchChip,
  compileTraceAttributeFilters,
  parseTraceSearch,
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
