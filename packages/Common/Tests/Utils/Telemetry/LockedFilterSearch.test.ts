import { describe, expect, test } from "@jest/globals";
import {
  SearchValuePredicate,
  SearchValueOperator,
  parseSearchValue,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import {
  TELEMETRY_EXPLORER_LABELS,
  TelemetrySignal,
  buildSearchTokenForFilter,
  buildSearchTokenForOperatorValue,
  isSearchTokenSafeKey,
} from "../../../Utils/Telemetry/LockedFilterSearch";
import queryStringToFilter, {
  LogFilter,
} from "../../../Types/Log/LogQueryToFilter";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
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
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import { JSONObject } from "../../../Types/JSON";

/*
 * A locked chip's search syntax must reproduce the chip on the explorer
 * for the same signal when pasted into its search bar — nothing more (a token
 * the explorer reads as something else) and nothing less (a filter silently
 * left out of the copy). These pin which columns have a token per signal and
 * that data values ride the grammar's escaping.
 */

const SIGNALS: Array<TelemetrySignal> = ["logs", "traces", "metrics"];

function roundTrip(token: string): SearchValuePredicate {
  // The value part of `@key:value` / `field:value`.
  const colon: number = token.indexOf(":");
  return parseSearchValue(token.substring(colon + 1));
}

describe("isSearchTokenSafeKey", () => {
  test("accepts dotted OTel resource keys", () => {
    expect(isSearchTokenSafeKey("resource.k8s.cluster.name")).toBe(true);
    expect(isSearchTokenSafeKey("http.status_code")).toBe(true);
    expect(isSearchTokenSafeKey("networkDevice.id")).toBe(true);
  });

  test.each([
    ["", "empty"],
    ["a b", "whitespace"],
    ["a\tb", "tab"],
    ['a"b', "double quote"],
    ["a:b", "colon"],
    ["@key", "leading @"],
    ["-key", "leading -"],
  ])("rejects %j (%s)", (key: string) => {
    expect(isSearchTokenSafeKey(key)).toBe(false);
  });
});

describe("buildSearchTokenForFilter — attribute chips", () => {
  test.each(SIGNALS)(
    "%s: an attributes.<key> chip becomes @<key>:<value>",
    (signal: TelemetrySignal) => {
      expect(
        buildSearchTokenForFilter(
          signal,
          "attributes.resource.k8s.cluster.name",
          "prod-eks-01",
        ),
      ).toBe("@resource.k8s.cluster.name:prod-eks-01");
    },
  );

  test("keeps the whole dotted key — only the first attributes. prefix is stripped", () => {
    expect(
      buildSearchTokenForFilter("logs", "attributes.attributes.nested", "v"),
    ).toBe("@attributes.nested:v");
  });

  test.each([
    ["/api/*", "wildcard"],
    ["a?b", "single-character wildcard"],
    ['say "hi"', "quotes"],
    ["web 01", "spaces"],
    ["-foo", "leading minus"],
    ["~foo", "leading tilde"],
    ["!foo", "leading bang"],
    [">5", "leading comparison"],
    ["(a OR b)", "wrapped list"],
    ["*", "bare asterisk"],
  ])(
    "escapes %j (%s) so the token means the literal value",
    (value: string) => {
      const token: string | null = buildSearchTokenForFilter(
        "logs",
        "attributes.k",
        value,
      );

      expect(token).not.toBeNull();
      expect(token!.startsWith("@k:")).toBe(true);

      const parsed: SearchValuePredicate = roundTrip(token!);

      expect(parsed.operator).toBe(SearchValueOperator.Equals);
      expect(parsed.value).toBe(value);
    },
  );

  test("a value with spaces is quoted, one without is bare", () => {
    expect(buildSearchTokenForFilter("logs", "attributes.k", "web 01")).toBe(
      '@k:"web 01"',
    );
    expect(buildSearchTokenForFilter("logs", "attributes.k", "web-01")).toBe(
      "@k:web-01",
    );
  });

  test("an unsafe attribute key has no token", () => {
    expect(buildSearchTokenForFilter("logs", "attributes.a b", "v")).toBeNull();
    expect(buildSearchTokenForFilter("logs", "attributes.a:b", "v")).toBeNull();
    expect(buildSearchTokenForFilter("logs", "attributes.", "v")).toBeNull();
  });

  test("an empty or non-string value has no token", () => {
    expect(buildSearchTokenForFilter("logs", "attributes.k", "")).toBeNull();
    expect(
      buildSearchTokenForFilter(
        "logs",
        "attributes.k",
        undefined as unknown as string,
      ),
    ).toBeNull();
    expect(
      buildSearchTokenForFilter("logs", "attributes.k", {
        _values: ["a"],
      } as unknown as string),
    ).toBeNull();
  });
});

describe("buildSearchTokenForFilter — column chips", () => {
  const entityId: string = "651a000000000000000000aa";

  test("logs: trace, span, severity and the entity id all have tokens", () => {
    expect(buildSearchTokenForFilter("logs", "traceId", "abc123")).toBe(
      "trace:abc123",
    );
    expect(buildSearchTokenForFilter("logs", "spanId", "span-1")).toBe(
      "span:span-1",
    );
    expect(buildSearchTokenForFilter("logs", "severityText", "Error")).toBe(
      "severity:Error",
    );
    expect(buildSearchTokenForFilter("logs", "primaryEntityId", entityId)).toBe(
      `service:${entityId}`,
    );
    expect(buildSearchTokenForFilter("logs", "serviceId", entityId)).toBe(
      `service:${entityId}`,
    );
  });

  test("traces: trace, span and the entity id have tokens; severity does not", () => {
    expect(buildSearchTokenForFilter("traces", "traceId", "abc123")).toBe(
      "trace:abc123",
    );
    expect(buildSearchTokenForFilter("traces", "spanId", "span-1")).toBe(
      "span:span-1",
    );
    expect(
      buildSearchTokenForFilter("traces", "primaryEntityId", entityId),
    ).toBe(`service:${entityId}`);
    expect(buildSearchTokenForFilter("traces", "serviceId", entityId)).toBe(
      `service:${entityId}`,
    );
    expect(
      buildSearchTokenForFilter("traces", "severityText", "Error"),
    ).toBeNull();
  });

  test("traces: the span columns a stored query pins have tokens that take the chip's raw value verbatim", () => {
    /*
     * The values are what SpanQueryScope puts on the chip: the numeric
     * status code, the OTel kind enum, "true"/"false", the stored text. Each
     * is what the traces search compiler accepts for that field (see
     * toSpanStatusCode / toSpanKind / the hasException and TEXT_CHIP_FIELDS
     * branches of the query builder).
     */
    expect(buildSearchTokenForFilter("traces", "statusCode", "2")).toBe(
      "status:2",
    );
    expect(
      buildSearchTokenForFilter("traces", "kind", "SPAN_KIND_SERVER"),
    ).toBe("kind:SPAN_KIND_SERVER");
    expect(buildSearchTokenForFilter("traces", "hasException", "true")).toBe(
      "hasexception:true",
    );
    expect(
      buildSearchTokenForFilter("traces", "name", "POST /checkout submit"),
    ).toBe('name:"POST /checkout submit"');
    expect(buildSearchTokenForFilter("traces", "statusMessage", "boom")).toBe(
      "statusmessage:boom",
    );
  });

  test("logs: the span columns are not log columns and have no token", () => {
    for (const facetKey of [
      "statusCode",
      "kind",
      "hasException",
      "name",
      "statusMessage",
    ]) {
      expect(buildSearchTokenForFilter("logs", facetKey, "x")).toBeNull();
      expect(buildSearchTokenForFilter("metrics", facetKey, "x")).toBeNull();
    }
  });

  test("metrics: no column has a token — its service: token matches by NAME, so an id would match nothing", () => {
    expect(
      buildSearchTokenForFilter("metrics", "primaryEntityId", entityId),
    ).toBeNull();
    expect(
      buildSearchTokenForFilter("metrics", "serviceId", entityId),
    ).toBeNull();
    expect(buildSearchTokenForFilter("metrics", "traceId", "abc")).toBeNull();
    expect(buildSearchTokenForFilter("metrics", "spanId", "abc")).toBeNull();
    expect(
      buildSearchTokenForFilter("metrics", "severityText", "Error"),
    ).toBeNull();
  });

  test.each(SIGNALS)(
    "%s: a session id, a resource facet and an unknown column have no token",
    (signal: TelemetrySignal) => {
      expect(buildSearchTokenForFilter(signal, "sessionId", "s-1")).toBeNull();
      expect(
        buildSearchTokenForFilter(signal, "kubernetesClusterId", "id"),
      ).toBeNull();
      expect(buildSearchTokenForFilter(signal, "hostId", "id")).toBeNull();
      expect(buildSearchTokenForFilter(signal, "body", "text")).toBeNull();
      expect(buildSearchTokenForFilter(signal, "entityKeys", "k")).toBeNull();
    },
  );

  test("column values are escaped too", () => {
    expect(buildSearchTokenForFilter("logs", "traceId", "a b")).toBe(
      'trace:"a b"',
    );
  });
});

describe("TELEMETRY_EXPLORER_LABELS", () => {
  test("names every explorer", () => {
    expect(TELEMETRY_EXPLORER_LABELS).toEqual({
      logs: "Logs",
      traces: "Traces",
      metrics: "Metrics",
    });
  });
});

describe("buildSearchTokenForOperatorValue", () => {
  const KEY: string = "k8s.ns";

  type RoundTripCase = {
    name: string;
    value: unknown;
    token: string;
    /*
     * What the logs explorer compiles the token back to. StartsWith /
     * EndsWith are spelled as globs, and the grammar compiles a glob to a
     * Wildcard — the same ILIKE the form's operator produces.
     */
    expectedClass: string;
    expectedWire: unknown;
  };

  const CASES: Array<RoundTripCase> = [
    {
      name: "equality",
      value: "web-01",
      token: "@k8s.ns:web-01",
      expectedClass: "String",
      expectedWire: "web-01",
    },
    {
      name: "not equal",
      value: new NotEqual("debug"),
      token: "@k8s.ns:!debug",
      expectedClass: "NotEqual",
      expectedWire: { _type: "NotEqual", value: "debug" },
    },
    {
      name: "contains",
      value: new Search("/checkout"),
      token: "@k8s.ns:~/checkout",
      expectedClass: "Search",
      expectedWire: { _type: "Search", value: "/checkout" },
    },
    {
      name: "contains a value with a space",
      value: new Search("a b"),
      token: '@k8s.ns:~"a b"',
      expectedClass: "Search",
      expectedWire: { _type: "Search", value: "a b" },
    },
    {
      name: "contains a value that starts with the contains marker",
      value: new Search("~x"),
      token: "@k8s.ns:~\\~x",
      expectedClass: "Search",
      expectedWire: { _type: "Search", value: "~x" },
    },
    {
      name: "not contains",
      value: new NotContains("x"),
      token: "-@k8s.ns:~x",
      expectedClass: "NotContains",
      expectedWire: { _type: "NotContains", value: "x" },
    },
    {
      name: "starts with",
      value: new StartsWith("api"),
      token: "@k8s.ns:api*",
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["api*"] },
    },
    {
      name: "starts with a literal that carries a star",
      value: new StartsWith("a*b"),
      token: "@k8s.ns:a\\*b*",
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["a\\*b*"] },
    },
    {
      name: "ends with",
      value: new EndsWith(".internal"),
      token: "@k8s.ns:*.internal",
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["*.internal"] },
    },
    {
      name: "matches one glob",
      value: new Wildcard(["api-*"]),
      token: "@k8s.ns:api-*",
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["api-*"] },
    },
    {
      name: "matches several globs",
      value: new Wildcard(["api-*", "web-?"]),
      token: "@k8s.ns:(api-* OR web-?)",
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["api-*", "web-?"] },
    },
    {
      name: "matches a glob with a space — quotes protect the space, not the star",
      value: new Wildcard(["a b*"]),
      token: '@k8s.ns:"a b*"',
      expectedClass: "Wildcard",
      expectedWire: { _type: "Wildcard", value: ["a b*"] },
    },
    {
      name: "not matches",
      value: new NotWildcard(["tmp-*"]),
      token: "-@k8s.ns:tmp-*",
      expectedClass: "NotWildcard",
      expectedWire: { _type: "NotWildcard", value: ["tmp-*"] },
    },
    {
      name: "is any of",
      value: new Includes(["payments", "checkout"]),
      token: "@k8s.ns:(payments OR checkout)",
      expectedClass: "Includes",
      expectedWire: { _type: "Includes", value: ["payments", "checkout"] },
    },
    {
      name: "is any of one value is plain equality",
      value: new Includes(["payments"]),
      token: "@k8s.ns:payments",
      expectedClass: "String",
      expectedWire: "payments",
    },
    {
      name: "is any of values with spaces",
      value: new Includes(["a b", "c"]),
      token: '@k8s.ns:("a b" OR c)',
      expectedClass: "Includes",
      expectedWire: { _type: "Includes", value: ["a b", "c"] },
    },
    {
      name: "is none of",
      value: new IncludesNone(["x", "y"]),
      token: "-@k8s.ns:(x OR y)",
      expectedClass: "IncludesNone",
      expectedWire: { _type: "IncludesNone", value: ["x", "y"] },
    },
    {
      name: "is empty",
      value: new IsNull(),
      token: "-@k8s.ns:*",
      expectedClass: "IsNull",
      expectedWire: { _type: "IsNull", value: null },
    },
    {
      name: "is not empty",
      value: new NotNull(),
      token: "@k8s.ns:*",
      expectedClass: "NotNull",
      expectedWire: { _type: "NotNull", value: null },
    },
    {
      name: "greater than",
      value: new GreaterThan(500),
      token: "@k8s.ns:>500",
      expectedClass: "GreaterThan",
      expectedWire: { _type: "GreaterThan", value: 500 },
    },
    {
      name: "greater than or equal",
      value: new GreaterThanOrEqual(5),
      token: "@k8s.ns:>=5",
      expectedClass: "GreaterThanOrEqual",
      expectedWire: { _type: "GreaterThanOrEqual", value: 5 },
    },
    {
      name: "less than",
      value: new LessThan(3),
      token: "@k8s.ns:<3",
      expectedClass: "LessThan",
      expectedWire: { _type: "LessThan", value: 3 },
    },
    {
      name: "less than or equal",
      value: new LessThanOrEqual(10),
      token: "@k8s.ns:<=10",
      expectedClass: "LessThanOrEqual",
      expectedWire: { _type: "LessThanOrEqual", value: 10 },
    },
  ];

  test.each(CASES)(
    "$name: the token round-trips through the logs explorer to the same predicate",
    (roundTrip: RoundTripCase) => {
      const token: string | null = buildSearchTokenForOperatorValue(
        KEY,
        roundTrip.value,
      );

      expect(token).toBe(roundTrip.token);

      const filter: LogFilter = queryStringToFilter(token as string);
      const compiled: unknown = filter.attributes?.[KEY];

      expect(compiled).toBeDefined();

      if (typeof compiled === "string") {
        expect(roundTrip.expectedClass).toBe("String");
        expect(compiled).toBe(roundTrip.expectedWire);
        return;
      }

      expect(
        (compiled as { constructor: { name: string } }).constructor.name,
      ).toBe(roundTrip.expectedClass);
      expect((compiled as { toJSON: () => JSONObject }).toJSON()).toEqual(
        roundTrip.expectedWire,
      );
    },
  );

  test("shapes the grammar cannot spell have no token", () => {
    // Several operators AND-ed on one key: the grammar has one value per key.
    expect(
      buildSearchTokenForOperatorValue(KEY, [
        new Search("a"),
        new NotEqual("b"),
      ]),
    ).toBeNull();
    // A list entry the list grammar would split in two.
    expect(
      buildSearchTokenForOperatorValue(KEY, new Includes(["a,b", "c"])),
    ).toBeNull();
    expect(
      buildSearchTokenForOperatorValue(KEY, new Includes(["a OR b", "c"])),
    ).toBeNull();
    // Nothing to filter on.
    expect(buildSearchTokenForOperatorValue(KEY, "")).toBeNull();
    expect(buildSearchTokenForOperatorValue(KEY, new Search(""))).toBeNull();
    expect(buildSearchTokenForOperatorValue(KEY, new Includes([]))).toBeNull();
    expect(buildSearchTokenForOperatorValue(KEY, undefined)).toBeNull();
    expect(buildSearchTokenForOperatorValue(KEY, null)).toBeNull();
    // A key the tokenizer would split.
    expect(
      buildSearchTokenForOperatorValue("weird key", new Search("x")),
    ).toBeNull();
  });

  test("a stored operator that arrived as its JSON wire shape is spelled too", () => {
    expect(
      buildSearchTokenForOperatorValue(KEY, {
        _type: "Includes",
        value: ["a", "b"],
      }),
    ).toBe("@k8s.ns:(a OR b)");
    expect(
      buildSearchTokenForOperatorValue(KEY, { _type: "Search", value: "x" }),
    ).toBe("@k8s.ns:~x");
  });
});
