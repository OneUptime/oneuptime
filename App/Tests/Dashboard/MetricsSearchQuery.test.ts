import { describe, expect, test } from "@jest/globals";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import {
  MetricsAttributeFilterValue,
  MetricNameFilter,
  ParsedMetricsSearch,
  mergeMetricsAttributeFilters,
  parseMetricsSearch,
  valueCarriesSearchSyntax,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/MetricsSearchQuery";

function attributeOf(
  raw: string,
  key: string = "k",
): MetricsAttributeFilterValue | undefined {
  return parseMetricsSearch(raw).attributes[key];
}

function globsOf(value: unknown): Array<string> {
  return (value as Wildcard<string>).values;
}

describe("MetricsSearchQuery attribute operators", () => {
  test("@k:a* compiles to a Wildcard, not to equality on the literal 'a*'", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("@k:a*");

    expect(compiled).toBeInstanceOf(Wildcard);
    expect(globsOf(compiled)).toEqual(["a*"]);
  });

  test("@k:*a and @k:a*b keep the glob exactly as typed", () => {
    expect(globsOf(attributeOf("@k:*a"))).toEqual(["*a"]);
    expect(globsOf(attributeOf("@k:a*b"))).toEqual(["a*b"]);
  });

  test("@k:a?c is a single-character glob", () => {
    expect(globsOf(attributeOf("@k:a?c"))).toEqual(["a?c"]);
  });

  test("-@k:v negates instead of dropping the minus", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("-@k:v");

    expect(compiled).toBeInstanceOf(NotEqual);
    expect((compiled as NotEqual<string>).value).toBe("v");
  });

  test("-@k:a* negates the glob", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("-@k:a*");

    expect(compiled).toBeInstanceOf(NotWildcard);
    expect((compiled as NotWildcard<string>).values).toEqual(["a*"]);
  });

  test("@k:~text is a contains match", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("@k:~text");

    expect(compiled).toBeInstanceOf(Search);
    expect((compiled as Search<string>).value).toBe("text");
  });

  test("@k:>10 is a numeric comparison, not a string", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("@k:>10");

    expect(compiled).toBeInstanceOf(GreaterThan);
    expect((compiled as GreaterThan<number>).value).toBe(10);
  });

  test("@k:(a OR b) is an any-of membership", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("@k:(a OR b)");

    expect(compiled).toBeInstanceOf(Includes);
    expect((compiled as Includes).values).toEqual(["a", "b"]);
  });

  test("@k:* means the attribute is present", () => {
    expect(attributeOf("@k:*")).toBeDefined();
    expect(attributeOf("@k:*")).not.toBeInstanceOf(Wildcard);
  });

  test("an escaped asterisk is a literal, not a pattern", () => {
    /*
     * A Kubernetes arg like `--foo=*` copied out of a row has to come back as
     * itself. `\*` is the escape the grammar produces for it, so the value
     * must land as plain equality on the three characters `a*b`.
     */
    expect(attributeOf("@k:a\\*b")).toBe("a*b");
  });

  test("a quoted value keeps its spaces and drops its quotes", () => {
    expect(attributeOf('@k:"a b"')).toBe("a b");
  });

  test("a bare key with no @ is an attribute, like it is on logs", () => {
    expect(parseMetricsSearch("k8s.pod:foo").attributes["k8s.pod"]).toBe("foo");
  });

  test("@name: filters the ATTRIBUTE called name, not the metric name column", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("@name:foo");

    expect(parsed.attributes["name"]).toBe("foo");
    expect(parsed.nameFilter).toBeNull();
  });
});

describe("MetricsSearchQuery repeated attribute keys", () => {
  test("two operators on one key AND together instead of overwriting", () => {
    const compiled: MetricsAttributeFilterValue | undefined =
      attributeOf("@k:a* @k:*b");

    expect(Array.isArray(compiled)).toBe(true);

    const operators: Array<unknown> = compiled as Array<unknown>;

    expect(operators).toHaveLength(2);
    expect(globsOf(operators[0])).toEqual(["a*"]);
    expect(globsOf(operators[1])).toEqual(["*b"]);
  });

  test("a glob and a contains on one key both survive", () => {
    const operators: Array<unknown> = attributeOf(
      "@k:a* @k:~mid",
    ) as Array<unknown>;

    expect(operators).toHaveLength(2);
    expect(operators[0]).toBeInstanceOf(Wildcard);
    expect(operators[1]).toBeInstanceOf(Search);
  });

  test("two plain equalities keep the first — they can only contradict", () => {
    /*
     * A bare string cannot join an operator array (the analytics compiler
     * reads an array as operators), and a second exact value on a key already
     * pinned to one string matches nothing. Keeping the first is the same
     * reading the logs compiler takes.
     */
    expect(attributeOf("@k:a @k:b")).toBe("a");
  });
});

describe("MetricsSearchQuery name filter", () => {
  test("name: stays a fragment match on the metric name", () => {
    const filter: MetricNameFilter = parseMetricsSearch(
      "name:container.blockio",
    ).nameFilter!;

    expect(filter.queryValue).toBeInstanceOf(Search);
    expect((filter.queryValue as Search<string>).value).toBe(
      "container.blockio",
    );
    expect(filter.matches("container.blockio.io_service_bytes_recursive")).toBe(
      true,
    );
    expect(filter.matches("system.cpu.utilization")).toBe(false);
  });

  test("a glob on name: anchors instead of matching anywhere", () => {
    const filter: MetricNameFilter =
      parseMetricsSearch("name:http.server.*").nameFilter!;

    expect(filter.queryValue).toBeInstanceOf(Wildcard);
    expect(globsOf(filter.queryValue)).toEqual(["http.server.*"]);
    expect(filter.matches("http.server.request.duration")).toBe(true);
    // A fragment match would have accepted this one; the glob must not.
    expect(filter.matches("proxy.http.server.count")).toBe(false);
  });

  test("the SQL half and the browser half of a glob agree", () => {
    /*
     * The two halves meet in the same list: the column predicate runs when
     * there is no attribute filter, and the matcher runs over the names
     * ClickHouse resolved when there is one. `?` is one character to both.
     */
    const filter: MetricNameFilter = parseMetricsSearch("name:a?c").nameFilter!;

    expect(globsOf(filter.queryValue)).toEqual(["a?c"]);
    expect(filter.matches("abc")).toBe(true);
    expect(filter.matches("abbc")).toBe(false);
  });

  test("an escaped asterisk in name: is a literal, not a pattern", () => {
    const filter: MetricNameFilter =
      parseMetricsSearch("name:a\\*b").nameFilter!;

    expect(filter.queryValue).toBeInstanceOf(Search);
    expect(filter.matches("xa*by")).toBe(true);
    expect(filter.matches("axxxb")).toBe(false);
  });

  test("-name: excludes fragments, mirroring the positive form", () => {
    const filter: MetricNameFilter =
      parseMetricsSearch("-name:system").nameFilter!;

    expect(filter.matches("system.cpu.utilization")).toBe(false);
    expect(filter.matches("http.server.duration")).toBe(true);
  });

  test("free text is the name fragment when no name: was typed", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("http.server");

    expect(parsed.freeText).toBe("http.server");
    expect(parsed.nameFilter!.queryValue).toBeInstanceOf(Search);
    expect(parsed.nameFilter!.matches("http.server.duration")).toBe(true);
  });

  test("free text is taken literally — an asterisk in it is not a glob", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("http.*");

    expect(parsed.nameFilter!.queryValue).toBeInstanceOf(Search);
    expect((parsed.nameFilter!.queryValue as Search<string>).value).toBe(
      "http.*",
    );
  });

  test("an explicit name: wins over free text", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("cpu name:memory");

    expect(parsed.freeText).toBe("cpu");
    expect((parsed.nameFilter!.queryValue as Search<string>).value).toBe(
      "memory",
    );
  });

  test("no search means no name filter at all", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("   ");

    expect(parsed.nameFilter).toBeNull();
    expect(parsed.serviceMatcher).toBeNull();
    expect(parsed.attributes).toEqual({});
  });
});

describe("MetricsSearchQuery service filter", () => {
  test("service: resolves client-side by fragment", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("service:api");

    expect(parsed.serviceMatcher!("API Gateway")).toBe(true);
    expect(parsed.serviceMatcher!("web")).toBe(false);
    // It must not leak into the attributes map or the name filter.
    expect(parsed.attributes).toEqual({});
    expect(parsed.nameFilter).toBeNull();
  });

  test("service: honours a glob too", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch("service:api-*");

    expect(parsed.serviceMatcher!("api-gateway")).toBe(true);
    expect(parsed.serviceMatcher!("legacy-api-gateway")).toBe(false);
  });

  test("name and service can be combined with attributes", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch(
      "service:api name:http.server @container.name:postgres",
    );

    expect(parsed.serviceMatcher!("api")).toBe(true);
    expect((parsed.nameFilter!.queryValue as Search<string>).value).toBe(
      "http.server",
    );
    expect(parsed.attributes["container.name"]).toBe("postgres");
  });
});

describe("mergeMetricsAttributeFilters", () => {
  test("a chip compiles through the same grammar as the typed token", () => {
    const merged: Record<string, MetricsAttributeFilterValue> =
      mergeMetricsAttributeFilters({
        parsed: {},
        chips: [{ facetKey: "attributes.platform.team", value: "a*" }],
      });

    expect(merged["platform.team"]).toBeInstanceOf(Wildcard);
    expect(globsOf(merged["platform.team"])).toEqual(["a*"]);
  });

  test("several chips on one key become one any-of", () => {
    const merged: Record<string, MetricsAttributeFilterValue> =
      mergeMetricsAttributeFilters({
        parsed: {},
        chips: [
          { facetKey: "attributes.k", value: "a" },
          { facetKey: "attributes.k", value: "b" },
        ],
      });

    expect(merged["k"]).toBeInstanceOf(Includes);
    expect((merged["k"] as Includes).values).toEqual(["a", "b"]);
  });

  test("non-attribute chips are left to the facet path", () => {
    const merged: Record<string, MetricsAttributeFilterValue> =
      mergeMetricsAttributeFilters({
        parsed: {},
        chips: [{ facetKey: "primaryEntityId", value: "some-id" }],
      });

    expect(merged).toEqual({});
  });

  test("a pinned host scope stays literal even when it looks like a glob", () => {
    const merged: Record<string, MetricsAttributeFilterValue> =
      mergeMetricsAttributeFilters({
        parsed: {},
        chips: [],
        pinned: { "resource.service.name": "api-*" },
      });

    expect(merged["resource.service.name"]).toBe("api-*");
  });

  test("the typed token survives when another key is chipped", () => {
    const merged: Record<string, MetricsAttributeFilterValue> =
      mergeMetricsAttributeFilters({
        parsed: parseMetricsSearch("@k:a*").attributes,
        chips: [{ facetKey: "attributes.other", value: "b" }],
      });

    expect(merged["k"]).toBeInstanceOf(Wildcard);
    expect(merged["other"]).toBe("b");
  });
});

describe("valueCarriesSearchSyntax", () => {
  test("a plain value is chippable", () => {
    expect(valueCarriesSearchSyntax("postgres")).toBe(false);
    expect(valueCarriesSearchSyntax("a\\*b")).toBe(false);
  });

  test("anything carrying grammar declines the chip", () => {
    /*
     * The search bar resolves a typed value against the suggestion list
     * before handing it over, so a glob with one matching suggestion would
     * arrive already replaced by that literal value.
     */
    expect(valueCarriesSearchSyntax("a*")).toBe(true);
    expect(valueCarriesSearchSyntax("~text")).toBe(true);
    expect(valueCarriesSearchSyntax(">10")).toBe(true);
    expect(valueCarriesSearchSyntax("(a OR b)")).toBe(true);
    expect(valueCarriesSearchSyntax("*")).toBe(true);
    expect(valueCarriesSearchSyntax("!v")).toBe(true);
  });
});
