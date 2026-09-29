import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  buildSearchTokenValue,
  compileAttributeChipValues,
  describeSearchValue,
  parseSearchQuery,
  parseSearchValue,
  predicateToQueryValue,
  predicateToSerializedValue,
  queryValueToChipValues,
  tokenizeSearchQuery,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { describe, expect, test } from "@jest/globals";

/*
 * The one grammar every telemetry explorer parses with. It replaces four
 * hand-copied tokenizers that disagreed about what the same keystrokes meant:
 * logs deleted `*` and searched for a substring, traces read `*` literally and
 * needed a bespoke `~` for contains, metrics and exceptions supported nothing
 * but equality.
 *
 * These tests pin the grammar itself. What each explorer does with a token is
 * pinned by that explorer's own suite; what the compilers emit as SQL is
 * pinned by StatementGeneratorWildcard.test.ts.
 */

type FirstPredicateFunction = (query: string) => SearchValuePredicate;

const firstPredicate: FirstPredicateFunction = (
  query: string,
): SearchValuePredicate => {
  const tokens: Array<SearchToken> = parseSearchQuery(query);

  return tokens[0]!.predicate;
};

describe("tokenizeSearchQuery", () => {
  test("splits on whitespace", () => {
    expect(tokenizeSearchQuery("a b c")).toEqual(["a", "b", "c"]);
  });

  test("collapses runs of whitespace", () => {
    expect(tokenizeSearchQuery("a    b")).toEqual(["a", "b"]);
  });

  test("keeps a quoted phrase together", () => {
    expect(tokenizeSearchQuery('"connection refused" severity:error')).toEqual([
      '"connection refused"',
      "severity:error",
    ]);
  });

  test("keeps a quoted field value together", () => {
    expect(tokenizeSearchQuery('name:"SELECT wp_options"')).toEqual([
      'name:"SELECT wp_options"',
    ]);
  });

  test("keeps a bracketed any-of list together despite its spaces", () => {
    expect(tokenizeSearchQuery("@http.method:(GET OR POST)")).toEqual([
      "@http.method:(GET OR POST)",
    ]);
  });

  test("a space after an attribute colon is absorbed", () => {
    expect(tokenizeSearchQuery("@http.method: GET")).toEqual([
      "@http.method:GET",
    ]);
  });

  test("a space after a KNOWN field colon is absorbed", () => {
    expect(
      tokenizeSearchQuery("severity: error", {
        knownFieldKeys: new Set(["severity"]),
      }),
    ).toEqual(["severity:error"]);
  });

  test("a space after an UNKNOWN field colon is not — prose stays prose", () => {
    /*
     * Without this gate "note: check the disk" would become a filter on a
     * field called "note" and silently return nothing.
     */
    expect(tokenizeSearchQuery("note: check")).toEqual(["note:", "check"]);
  });

  test("an escaped space does not split the token", () => {
    expect(tokenizeSearchQuery("@k:a\\ b")).toEqual(["@k:a\\ b"]);
  });

  test("an escaped quote does not open a quoted region", () => {
    expect(tokenizeSearchQuery('@k:\\" b')).toEqual(['@k:\\"', "b"]);
  });

  test("empty input yields no tokens", () => {
    expect(tokenizeSearchQuery("")).toEqual([]);
  });
});

describe("parseSearchValue - the customer's case", () => {
  test("a* is a prefix glob, not a substring search", () => {
    const predicate: SearchValuePredicate = parseSearchValue("a*");

    expect(predicate.operator).toBe(SearchValueOperator.Wildcard);
    expect(predicate.values).toEqual(["a*"]);
  });

  test("it compiles to a Wildcard, which the compilers turn into ILIKE 'a%'", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue("a*"));

    expect(value).toBeInstanceOf(Wildcard);
    expect((value as Wildcard<string>).toPatterns()).toEqual(["a%"]);
  });
});

describe("parseSearchValue - globs", () => {
  test.each([
    ["a*", ["a%"]],
    ["*a", ["%a"]],
    ["a*b", ["a%b"]],
    ["a?c", ["a_c"]],
    ["*a*", ["%a%"]],
  ])("%p compiles to %p", (glob: string, patterns: Array<string>) => {
    const value: unknown = predicateToQueryValue(parseSearchValue(glob));

    expect((value as Wildcard<string>).toPatterns()).toEqual(patterns);
  });

  test("a bare star means the key exists with a value", () => {
    expect(parseSearchValue("*").operator).toBe(SearchValueOperator.Exists);
    expect(predicateToQueryValue(parseSearchValue("*"))).toBeInstanceOf(
      NotNull,
    );
  });

  test("an escaped star is a literal, so equality is used", () => {
    const predicate: SearchValuePredicate = parseSearchValue("a\\*b");

    expect(predicate.operator).toBe(SearchValueOperator.Equals);
    expect(predicate.value).toBe("a*b");
  });

  test("quotes protect spaces but NOT wildcards", () => {
    const predicate: SearchValuePredicate = parseSearchValue('"a b*"');

    expect(predicate.operator).toBe(SearchValueOperator.Wildcard);
    expect(predicate.values).toEqual(["a b*"]);
  });
});

describe("parseSearchValue - the rest of the grammar", () => {
  test("~ is contains", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue("~text"));

    expect(value).toBeInstanceOf(Search);
    expect((value as Search<string>).toString()).toBe("text");
  });

  test("! is not-equals", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue("!text"));

    expect(value).toBeInstanceOf(NotEqual);
  });

  test.each([
    [">10", GreaterThan],
    [">=10", GreaterThanOrEqual],
    ["<10", LessThan],
    ["<=10", LessThanOrEqual],
  ])("%p is a numeric comparison", (raw: string, ctor: unknown) => {
    expect(predicateToQueryValue(parseSearchValue(raw))).toBeInstanceOf(
      ctor as never,
    );
  });

  test("a numeric comparison parses its value as a number", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue(">1000"));

    expect((value as GreaterThan<number>).value).toBe(1000);
  });

  test("a non-numeric comparison value stays a string", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue(">abc"));

    expect((value as GreaterThan<string>).value).toBe("abc");
  });

  test("(a OR b) is an any-of over literals", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue("(a OR b)"));

    expect(value).toBeInstanceOf(Includes);
    expect((value as Includes).values).toEqual(["a", "b"]);
  });

  test("[a, b] is the same any-of", () => {
    const value: unknown = predicateToQueryValue(parseSearchValue("[a, b]"));

    expect((value as Includes).values).toEqual(["a", "b"]);
  });

  test("an any-of that carries a glob becomes one multi-glob Wildcard", () => {
    const value: unknown = predicateToQueryValue(
      parseSearchValue("(a* OR bravo)"),
    );

    expect(value).toBeInstanceOf(Wildcard);
    expect((value as Wildcard<string>).toPatterns()).toEqual(["a%", "bravo"]);
  });

  test("a one-entry list is plain equality, not an IN of one", () => {
    expect(parseSearchValue("(only)").operator).toBe(
      SearchValueOperator.Equals,
    );
  });

  test("an empty list constrains nothing rather than matching nothing", () => {
    /*
     * `()` reaching equality would compare against the literal "()" and
     * return zero rows, which reads as "the product is broken" rather than
     * "you typed nothing".
     */
    expect(parseSearchValue("()").value).toBe("");
  });

  test("a plain value is equality", () => {
    const predicate: SearchValuePredicate = parseSearchValue("abc");

    expect(predicate.operator).toBe(SearchValueOperator.Equals);
    expect(predicateToQueryValue(predicate)).toBe("abc");
  });
});

describe("parseSearchValue - negation composes with every operator", () => {
  test.each([
    ["abc", NotEqual],
    ["a*", NotWildcard],
    ["~text", NotContains],
    ["(a OR b)", IncludesNone],
    ["*", IsNull],
  ])("negated %p compiles to the opposite", (raw: string, ctor: unknown) => {
    expect(predicateToQueryValue(parseSearchValue(raw, true))).toBeInstanceOf(
      ctor as never,
    );
  });

  test("a negated glob keeps the glob rather than dropping the negation", () => {
    /*
     * The old log parser only flipped the operator for bare equality, so
     * `-@k:a*` compiled to a POSITIVE contains — the exact complement of the
     * filter the user asked for, with nothing to indicate it.
     */
    const value: unknown = predicateToQueryValue(parseSearchValue("a*", true));

    expect(value).toBeInstanceOf(NotWildcard);
    expect((value as NotWildcard<string>).toPatterns()).toEqual(["a%"]);
  });

  test.each([
    [">10", LessThanOrEqual],
    [">=10", LessThan],
    ["<10", GreaterThanOrEqual],
    ["<=10", GreaterThan],
  ])("negating %p inverts the comparison", (raw: string, ctor: unknown) => {
    expect(predicateToQueryValue(parseSearchValue(raw, true))).toBeInstanceOf(
      ctor as never,
    );
  });

  test("negating twice is the identity", () => {
    const once: SearchValuePredicate = parseSearchValue("a*", true);
    const twice: SearchValuePredicate = parseSearchValue("a*", false);

    expect(once.operator).toBe(SearchValueOperator.NotWildcard);
    expect(twice.operator).toBe(SearchValueOperator.Wildcard);
  });
});

describe("parseSearchQuery - token routing", () => {
  test("@ marks an attribute", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("@http.method:GET");

    expect(tokens[0]!.type).toBe(SearchTokenType.Attribute);
    expect(tokens[0]!.key).toBe("http.method");
  });

  test("a bare key is a field", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("severity:error");

    expect(tokens[0]!.type).toBe(SearchTokenType.Field);
  });

  test("field aliases resolve case-insensitively", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("SEVERITY:error", {
      fieldAliases: { severity: "severityText" },
    });

    expect(tokens[0]!.key).toBe("severityText");
  });

  test("attribute keys are never aliased and keep their casing", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("@Severity:error", {
      fieldAliases: { severity: "severityText" },
    });

    expect(tokens[0]!.key).toBe("Severity");
  });

  test("a leading - negates the token", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("-@http.method:GET");

    expect(tokens[0]!.negated).toBe(true);
    expect(tokens[0]!.key).toBe("http.method");
    expect(tokens[0]!.predicate.operator).toBe(SearchValueOperator.NotEquals);
  });

  test("bare words are free text", () => {
    const tokens: Array<SearchToken> = parseSearchQuery("connection refused");

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe(SearchTokenType.FreeText);
    expect(tokens[0]!.predicate.value).toBe("connection refused");
  });

  test("a field filter ends the free-text phrase rather than joining it", () => {
    /*
     * `foo severity:error bar` must not search for the phrase "foo bar",
     * which never occurred in any log line.
     */
    const tokens: Array<SearchToken> = parseSearchQuery(
      "foo severity:error bar",
    );

    expect(
      tokens.map((t: SearchToken) => {
        return t.predicate.value;
      }),
    ).toEqual(["foo", "error", "bar"]);
  });

  test("a quoted token containing a colon stays free text", () => {
    const tokens: Array<SearchToken> = parseSearchQuery('"foo:bar"');

    expect(tokens[0]!.type).toBe(SearchTokenType.FreeText);
    expect(tokens[0]!.predicate.value).toBe("foo:bar");
  });

  test("AND is a no-op because tokens already AND", () => {
    expect(parseSearchQuery("a:1 AND b:2")).toHaveLength(2);
  });

  test("a field with no value is skipped — the user is mid-typing", () => {
    expect(parseSearchQuery("severity:")).toHaveLength(0);
  });

  test("a bare @key with no colon is not a filter", () => {
    expect(parseSearchQuery("@http.method")).toHaveLength(0);
  });

  test("empty and whitespace input yield no tokens", () => {
    expect(parseSearchQuery("")).toEqual([]);
    expect(parseSearchQuery("   ")).toEqual([]);
  });

  test("the raw token is preserved so a query can be rebuilt", () => {
    expect(parseSearchQuery("-@k:a*")[0]!.raw).toBe("-@k:a*");
  });
});

describe("predicateToSerializedValue - the aggregation wire shape", () => {
  test("equality travels as a bare string, keeping the map-subscript fast path", () => {
    expect(predicateToSerializedValue(parseSearchValue("abc"))).toBe("abc");
  });

  test("a glob travels as the operator's own JSON", () => {
    expect(predicateToSerializedValue(parseSearchValue("a*"))).toEqual({
      _type: "Wildcard",
      value: ["a*"],
    });
  });

  test("a negated glob travels as NotWildcard", () => {
    expect(predicateToSerializedValue(parseSearchValue("a*", true))).toEqual({
      _type: "NotWildcard",
      value: ["a*"],
    });
  });

  test("the wire shape and the list-query operator come from one predicate", () => {
    /*
     * The chart and the table diverging on the same typed filter is the bug
     * class this pairing exists to prevent, so the two compilations must be
     * driven by the same parse.
     */
    const predicate: SearchValuePredicate = parseSearchValue("(a* OR b)");
    const listValue: unknown = predicateToQueryValue(predicate);
    const wireValue: unknown = predicateToSerializedValue(predicate);

    expect((listValue as Wildcard<string>).values).toEqual(["a*", "b"]);
    expect(wireValue).toEqual({ _type: "Wildcard", value: ["a*", "b"] });
  });
});

describe("compileAttributeChipValues", () => {
  test("one typed chip value carries its operator", () => {
    expect(compileAttributeChipValues(["a*"])).toBeInstanceOf(Wildcard);
  });

  test("several literals become an IN, which the database can hash", () => {
    const value: unknown = compileAttributeChipValues(["a", "b"]);

    expect(value).toBeInstanceOf(Includes);
    expect((value as Includes).values).toEqual(["a", "b"]);
  });

  test("several globs become one disjunction", () => {
    const value: unknown = compileAttributeChipValues(["a*", "b*"]);

    expect((value as Wildcard<string>).toPatterns()).toEqual(["a%", "b%"]);
  });

  test("a literal joins a glob list as an inert glob", () => {
    const value: unknown = compileAttributeChipValues(["a*", "100%"]);

    expect((value as Wildcard<string>).toPatterns()).toEqual(["a%", "100\\%"]);
  });

  test("unlike operators AND, the only reading one map slot can express", () => {
    const value: unknown = compileAttributeChipValues(["~foo", ">10"]);

    expect(Array.isArray(value)).toBe(true);
    expect((value as Array<unknown>)[0]).toBeInstanceOf(Search);
    expect((value as Array<unknown>)[1]).toBeInstanceOf(GreaterThan);
  });

  test("no values means no filter", () => {
    expect(compileAttributeChipValues([])).toBeUndefined();
    expect(compileAttributeChipValues([""])).toBeUndefined();
  });
});

describe("buildSearchTokenValue - data going back into a search string", () => {
  test("a value containing a star round-trips as itself", () => {
    const token: string = buildSearchTokenValue("/api/*");
    const predicate: SearchValuePredicate = parseSearchValue(token);

    expect(predicate.operator).toBe(SearchValueOperator.Equals);
    expect(predicate.value).toBe("/api/*");
  });

  test("a value with spaces is quoted", () => {
    expect(buildSearchTokenValue("a b")).toBe('"a b"');
  });

  test.each(["~foo", "!foo", ">foo", "(foo)", "[foo]", '"foo"', "-foo"])(
    "a value that starts like an operator (%p) round-trips as a literal",
    (literal: string) => {
      expect(parseSearchValue(buildSearchTokenValue(literal)).value).toBe(
        literal,
      );
    },
  );

  test("an escaped value parses back with the right operator too", () => {
    const token: string = buildSearchTokenValue("100%");

    expect(parseSearchValue(token).operator).toBe(SearchValueOperator.Equals);
    expect(parseSearchValue(token).value).toBe("100%");
  });
});

describe("describeSearchValue", () => {
  test("a literal reads as itself, escapes resolved", () => {
    expect(describeSearchValue("a\\*b")).toBe("a*b");
  });

  test("a glob keeps its star so the chip says what it does", () => {
    expect(describeSearchValue("a*")).toBe("a*");
  });

  test("an any-of reads as a disjunction", () => {
    expect(describeSearchValue("(a OR b)")).toBe("a OR b");
  });

  test("a bare star reads as words, not punctuation", () => {
    expect(describeSearchValue("*")).toBe("any value");
  });
});

describe("regression - shapes that used to be silently misread", () => {
  test("a URL is free text, not a filter on a field called https", () => {
    const tokens: Array<SearchToken> = parseSearchQuery(
      "https://example.com/x",
    );

    expect(tokens[0]!.type).toBe(SearchTokenType.FreeText);
  });

  test("a clock time is free text, not a filter on a field called 12", () => {
    expect(parseSearchQuery("12:30")[0]!.type).toBe(SearchTokenType.FreeText);
  });

  test("a percent beside a wildcard stays a literal percent", () => {
    /*
     * `100%*` means "starts with the four characters 1 0 0 %". Escaping the
     * user's own `%` is what stops it reading as a second match-anything.
     */
    const value: unknown = predicateToQueryValue(parseSearchValue("100%*"));

    expect((value as Wildcard<string>).toPatterns()).toEqual(["100\\%%"]);
  });

  test("an underscore in a value does not become a single-character wildcard", () => {
    expect(firstPredicate("@k:req_id*").values).toEqual(["req_id*"]);
    expect(
      (
        predicateToQueryValue(firstPredicate("@k:req_id*")) as Wildcard<string>
      ).toPatterns(),
    ).toEqual(["req\\_id%"]);
  });
});

describe("queryValueToChipValues - saved views round-trip", () => {
  test("a bare string comes back as one chip", () => {
    expect(queryValueToChipValues("abc")).toEqual(["abc"]);
  });

  test("a wildcard comes back as the glob the user typed", () => {
    expect(queryValueToChipValues(new Wildcard("a*"))).toEqual(["a*"]);
  });

  test("a multi-glob wildcard comes back as one chip per glob", () => {
    expect(queryValueToChipValues(new Wildcard(["a*", "b*"]))).toEqual([
      "a*",
      "b*",
    ]);
  });

  test("a negated wildcard keeps its minus", () => {
    expect(queryValueToChipValues(new NotWildcard("a*"))).toEqual(["-a*"]);
  });

  test("an any-of comes back as one chip per value", () => {
    expect(queryValueToChipValues(new Includes(["a", "b"]))).toEqual([
      "a",
      "b",
    ]);
  });

  test("contains keeps its tilde", () => {
    expect(queryValueToChipValues(new Search("foo"))).toEqual(["~foo"]);
  });

  test("presence and absence come back as the star forms", () => {
    expect(queryValueToChipValues(new NotNull())).toEqual(["*"]);
    expect(queryValueToChipValues(new IsNull())).toEqual(["-*"]);
  });

  test("a numeric comparison keeps its operator", () => {
    expect(queryValueToChipValues(new GreaterThan(10))).toEqual([">10"]);
    expect(queryValueToChipValues(new LessThanOrEqual(10))).toEqual(["<=10"]);
  });

  test("several AND-ed operators come back as several chips", () => {
    expect(
      queryValueToChipValues([new Wildcard("a*"), new Search("b")]),
    ).toEqual(["a*", "~b"]);
  });

  test("nothing is dropped or invented for an empty value", () => {
    expect(queryValueToChipValues(undefined)).toEqual([]);
    expect(queryValueToChipValues("")).toEqual([]);
  });

  test.each([
    ["abc"],
    ["a*"],
    ["*a"],
    ["a*b"],
    ["~foo"],
    ["!foo"],
    [">10"],
    ["<=10"],
    ["*"],
  ])("chip → query → chip is stable for %p", (chipValue: string) => {
    /*
     * The round trip is what makes a saved view survive being reopened and
     * edited: the viewer recompiles its query from the chips it can read
     * back, so anything lost here is a filter that silently disappears on
     * the user's next click.
     */
    const compiled: unknown = compileAttributeChipValues([chipValue]);

    expect(queryValueToChipValues(compiled)).toEqual([chipValue]);
  });

  test("a value with a literal asterisk survives the round trip", () => {
    const chipValue: string = buildSearchTokenValue("/api/*");
    const compiled: unknown = compileAttributeChipValues([chipValue]);

    expect(describeSearchValue(queryValueToChipValues(compiled)[0]!)).toBe(
      "/api/*",
    );
  });
});
