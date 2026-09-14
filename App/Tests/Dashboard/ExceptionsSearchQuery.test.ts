import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import ObjectID from "Common/Types/ObjectID";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import {
  SearchQueryValue,
  SearchValueOperator,
  SearchValuePredicate,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ExceptionFieldFilters,
  ExceptionSearchFilters,
  ExceptionServiceOption,
  NO_MATCH_ENTITY_ID,
  ResolvedExceptionServices,
  hasSearchDsl,
  matchesSearchPredicate,
  parseExceptionSearch,
  resolveExceptionServiceChipId,
  resolveExceptionServiceIds,
  splitExceptionFieldPredicates,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery";
import {
  ExceptionInstanceScope,
  buildExceptionInstanceScopeQuery,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

const API_SERVICE_ID: string = "3f1b6b0e-0000-4000-8000-0000000000a1";
const BILLING_SERVICE_ID: string = "3f1b6b0e-0000-4000-8000-0000000000b2";

const SERVICES: Array<ExceptionServiceOption> = [
  { id: API_SERVICE_ID, name: "api-gateway" },
  { id: BILLING_SERVICE_ID, name: "billing" },
];

function attributePredicate(raw: string, key: string): SearchValuePredicate {
  const filters: ExceptionSearchFilters = parseExceptionSearch(raw);
  const predicates: Array<SearchValuePredicate> =
    filters.attributePredicates[key] || [];

  expect(predicates).toHaveLength(1);

  return predicates[0]!;
}

describe("parseExceptionSearch - attribute values", () => {
  test("a glob is a wildcard, not an exact match on a literal asterisk", () => {
    const predicate: SearchValuePredicate = attributePredicate(
      "@platform.team:a*",
      "platform.team",
    );

    expect(predicate.operator).toBe(SearchValueOperator.Wildcard);

    const compiled: SearchQueryValue = predicateToQueryValue(predicate);

    expect(compiled).toBeInstanceOf(Wildcard);
    expect((compiled as Wildcard<string>).toPatterns()).toEqual(["a%"]);
  });

  test("a minus negates the whole filter", () => {
    const predicate: SearchValuePredicate = attributePredicate(
      "-@http.method:GET",
      "http.method",
    );

    expect(predicate.operator).toBe(SearchValueOperator.NotEquals);
    expect(predicateToQueryValue(predicate)).toBeInstanceOf(NotEqual);
  });

  test("an any-of list is one membership filter", () => {
    const predicate: SearchValuePredicate = attributePredicate(
      "@http.method:(GET OR POST)",
      "http.method",
    );

    expect(predicate.operator).toBe(SearchValueOperator.In);

    const compiled: SearchQueryValue = predicateToQueryValue(predicate);

    expect(compiled).toBeInstanceOf(Includes);
    expect((compiled as Includes).values).toEqual(["GET", "POST"]);
  });

  test("an attribute key keeps the casing the data stores it in", () => {
    const filters: ExceptionSearchFilters =
      parseExceptionSearch("@requestId:abc");

    expect(Object.keys(filters.attributePredicates)).toEqual(["requestId"]);
  });
});

describe("parseExceptionSearch - field aliases", () => {
  test.each([
    ["@type:TypeError"],
    ["@Type:TypeError"],
    ["@TYPE:TypeError"],
    ["type:TypeError"],
    ["Type:TypeError"],
    ["exceptionType:TypeError"],
  ])(
    "%p is a filter on the exceptionType column, never an attribute",
    (raw: string) => {
      const filters: ExceptionSearchFilters = parseExceptionSearch(raw);

      expect(Object.keys(filters.attributePredicates)).toEqual([]);
      expect(filters.fieldPredicates["exceptionType"]).toHaveLength(1);
      expect(filters.fieldPredicates["exceptionType"]![0]!.value).toBe(
        "TypeError",
      );
    },
  );

  test("an unknown bare key is an attribute, the way it is on logs", () => {
    const filters: ExceptionSearchFilters = parseExceptionSearch(
      "http.status_code:500",
    );

    expect(filters.fieldPredicates).toEqual({});
    expect(filters.attributePredicates["http.status_code"]).toHaveLength(1);
  });

  test("prose that happens to contain a colon stays free text", () => {
    const filters: ExceptionSearchFilters = parseExceptionSearch(
      "failed at 12:30 on https://example.com",
    );

    expect(filters.fieldPredicates).toEqual({});
    expect(filters.attributePredicates).toEqual({});
    expect(filters.freeText).toBe("failed at 12:30 on https://example.com");
  });
});

describe("parseExceptionSearch - free text", () => {
  test("free text is the message search, never an exception type", () => {
    const filters: ExceptionSearchFilters =
      parseExceptionSearch("connection refused");

    expect(filters.freeText).toBe("connection refused");
    expect(filters.fieldPredicates["exceptionType"]).toBeUndefined();
  });

  test("quotes keep a phrase together", () => {
    const filters: ExceptionSearchFilters =
      parseExceptionSearch('"out of memory"');

    expect(filters.freeText).toBe("out of memory");
  });

  test("free text does NOT clobber an explicit type filter", () => {
    /*
     * The list used to assign free text to `exceptionType` AFTER the field
     * loop, so typing a word next to `@type:` silently replaced the type
     * filter the chart above was still applying.
     */
    const filters: ExceptionSearchFilters = parseExceptionSearch(
      "connection refused type:TypeError",
    );

    expect(filters.freeText).toBe("connection refused");
    expect(filters.fieldPredicates["exceptionType"]).toHaveLength(1);
    expect(filters.fieldPredicates["exceptionType"]![0]!.value).toBe(
      "TypeError",
    );
  });
});

describe("splitExceptionFieldPredicates", () => {
  test("literals stay literal — the histogram and facet endpoints take nothing else", () => {
    const filters: ExceptionFieldFilters = splitExceptionFieldPredicates(
      parseExceptionSearch("type:(TypeError OR RangeError) env:production")
        .fieldPredicates,
    );

    expect(filters.literals["exceptionType"]).toEqual([
      "TypeError",
      "RangeError",
    ]);
    expect(filters.literals["environment"]).toEqual(["production"]);
    expect(filters.operators).toEqual({});
  });

  test("an operator is compiled for the instance scope instead", () => {
    const filters: ExceptionFieldFilters = splitExceptionFieldPredicates(
      parseExceptionSearch("type:Type* -env:staging").fieldPredicates,
    );

    expect(filters.literals["exceptionType"]).toBeUndefined();
    expect(filters.operators["exceptionType"]![0]).toBeInstanceOf(Wildcard);
    expect(filters.operators["environment"]![0]).toBeInstanceOf(NotEqual);
  });

  test("a service token is never compiled against the id column", () => {
    /*
     * `@service:` carries a NAME. Compiled here it would ask for an exception
     * whose primaryEntityId is the literal string "api" — which is exactly
     * what it used to do, and no row has ever matched it.
     */
    const filters: ExceptionFieldFilters = splitExceptionFieldPredicates(
      parseExceptionSearch("service:api").fieldPredicates,
    );

    expect(filters.literals["primaryEntityId"]).toBeUndefined();
    expect(filters.operators["primaryEntityId"]).toBeUndefined();
  });
});

describe("resolveExceptionServiceIds", () => {
  function resolve(raw: string): ResolvedExceptionServices {
    return resolveExceptionServiceIds({
      predicates:
        parseExceptionSearch(raw).fieldPredicates["primaryEntityId"] || [],
      services: SERVICES,
    });
  }

  test("a name fragment resolves to the service id", () => {
    expect(resolve("service:api")).toEqual({
      serviceIds: [API_SERVICE_ID],
      excludedServiceIds: [],
      matchedNothing: false,
    });
  });

  test("a glob matches names, so `service:bill*` needs no exact spelling", () => {
    expect(resolve("service:bill*").serviceIds).toEqual([BILLING_SERVICE_ID]);
  });

  test("an id pasted from a shared link resolves to itself", () => {
    expect(resolve(`service:${BILLING_SERVICE_ID}`).serviceIds).toEqual([
      BILLING_SERVICE_ID,
    ]);
  });

  test("naming a service that does not exist shows nothing, not everything", () => {
    const resolved: ResolvedExceptionServices = resolve("service:nope");

    expect(resolved.serviceIds).toEqual([]);
    expect(resolved.matchedNothing).toBe(true);
    expect(ObjectID.isValidUUID(NO_MATCH_ENTITY_ID)).toBe(true);
  });

  test("a negation excludes what it matched rather than the complement", () => {
    const resolved: ResolvedExceptionServices = resolve("-service:api");

    expect(resolved.serviceIds).toEqual([]);
    expect(resolved.excludedServiceIds).toEqual([API_SERVICE_ID]);
    expect(resolved.matchedNothing).toBe(false);
  });
});

describe("resolveExceptionServiceChipId", () => {
  test("a name that identifies one service chips as that service's id", () => {
    expect(
      resolveExceptionServiceChipId({
        value: "billing",
        services: SERVICES,
      }),
    ).toBe(BILLING_SERVICE_ID);
  });

  test("an unknown name is not chipped — it goes back to the search string", () => {
    expect(
      resolveExceptionServiceChipId({ value: "nope", services: SERVICES }),
    ).toBeNull();
  });

  test("an ambiguous fragment is not chipped either", () => {
    expect(
      resolveExceptionServiceChipId({
        value: "i",
        services: SERVICES,
      }),
    ).toBeNull();
  });
});

describe("matchesSearchPredicate", () => {
  test.each([
    ["api-gateway", "@k:api-*", true],
    ["api-gateway", "@k:*gateway", true],
    ["api-gateway", "@k:api-gatewa?", true],
    ["api-gateway", "@k:api", false],
    ["api-gateway", "@k:~gate", true],
    ["api-gateway", "-@k:api-*", false],
  ])("%p against %p is %p", (value: string, raw: string, expected: boolean) => {
    const predicate: SearchValuePredicate = attributePredicate(raw, "k");

    expect(matchesSearchPredicate(value, predicate)).toBe(expected);
  });

  test("a literal asterisk is matched literally once escaped", () => {
    const predicate: SearchValuePredicate = attributePredicate(
      "@k:api\\*",
      "k",
    );

    expect(matchesSearchPredicate("api*", predicate)).toBe(true);
    expect(matchesSearchPredicate("api-gateway", predicate)).toBe(false);
  });
});

describe("hasSearchDsl", () => {
  test.each([
    ["a*", true],
    ["a?c", true],
    ["~foo", true],
    ["!foo", true],
    [">10", true],
    ["(a OR b)", true],
    ["-foo", true],
    ["api\\*", true],
    ["TypeError", false],
    ['"My Type"', false],
    ["", false],
  ])("%p carries DSL: %p", (value: string, expected: boolean) => {
    expect(hasSearchDsl(value)).toBe(expected);
  });
});

describe("buildExceptionInstanceScopeQuery", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "7c1b6b0e-0000-4000-8000-0000000000ee",
  );
  const WINDOW: InBetween<Date> = new InBetween<Date>(
    new Date("2026-08-20T10:00:00.000Z"),
    new Date("2026-08-20T11:00:00.000Z"),
  );

  function build(scope: ExceptionInstanceScope): Record<string, unknown> {
    return buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: WINDOW,
      scope,
    }) as Record<string, unknown>;
  }

  test("a chip and a typed predicate on one attribute AND together", () => {
    const query: Record<string, unknown> = build({
      attributeSelections: { "platform.team": ["a*"] },
      attributePredicates: {
        "platform.team": [
          predicateToQueryValue(
            attributePredicate("@platform.team:~core", "platform.team"),
          ),
        ],
      },
      columnPredicates: {},
    });

    const attributes: Record<string, unknown> = query["attributes"] as Record<
      string,
      unknown
    >;
    const merged: Array<unknown> = attributes[
      "platform.team"
    ] as Array<unknown>;

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBeInstanceOf(Wildcard);
  });

  test("a wildcard field filter reaches the instance query as an operator", () => {
    const query: Record<string, unknown> = build({
      attributeSelections: {},
      attributePredicates: {},
      columnPredicates: {
        exceptionType: [
          predicateToQueryValue(
            parseExceptionSearch("type:Type*").fieldPredicates[
              "exceptionType"
            ]![0]!,
          ),
        ],
      },
    });

    expect(query["exceptionType"]).toBeInstanceOf(Wildcard);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(WINDOW);
    expect(query["attributes"]).toBeUndefined();
  });

  test("an excluded service rides the same query", () => {
    const query: Record<string, unknown> = build({
      attributeSelections: {},
      attributePredicates: {},
      columnPredicates: {
        primaryEntityId: [new IncludesNone([API_SERVICE_ID])],
      },
    });

    expect(query["primaryEntityId"]).toBeInstanceOf(IncludesNone);
  });
});

describe("exceptions viewer wiring", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer.tsx",
    ),
    "utf8",
  );

  test("the viewer parses with the shared grammar", () => {
    expect(source).toContain("parseExceptionSearch(submittedSearch)");
    expect(source).toContain("splitExceptionFieldPredicates");
    expect(source).toContain("resolveExceptionServiceIds");
  });

  test("free text is a message contains-match on every transport", () => {
    // The Postgres list.
    expect(source).toContain(
      '(q as Record<string, unknown>)["message"] = new Search(',
    );
    // The histogram AND the facet counts.
    expect(
      source.match(/payload\["messageSearchText"\] = parsedSearch\.freeText;/g),
    ).toHaveLength(2);
  });

  test("free text can no longer be written to the exceptionType column", () => {
    expect(source).not.toContain('["exceptionType"] = freeText');
    expect(source).not.toContain('["exceptionType"] = parsedSearch.freeText');
  });

  test("a service name never chips as the value of the id column", () => {
    expect(source).toContain("resolveExceptionServiceChipId({");
  });

  test("a value carrying DSL stays in the search string", () => {
    /*
     * `false` is the contract TelemetrySearchBar reads as "not consumed as a
     * chip": it keeps the token in the input and submits, so the parser gets
     * the operator the user typed.
     */
    const normalized: string = source.replace(/\s+/g, " ");

    expect(normalized).toContain("if (hasSearchDsl(value)) { return false; }");
  });
});
