import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  LogFilter,
  queryStringToFilter,
} from "../../../Types/Log/LogQueryToFilter";
import { describe, expect, test } from "@jest/globals";

/*
 * The log-specific half of the search pipeline: which names are columns,
 * which alias to what, how severity is spelled in ClickHouse. The grammar
 * itself is pinned by Tests/Types/Telemetry/TelemetrySearchQuery.test.ts and
 * the SQL by Tests/Server/Utils/AnalyticsDatabase/StatementGeneratorWildcard.
 *
 * The wildcard cases are the customer-reported bug: `@platform.team:a*`
 * against a stored `platform.team = abc` returned "no logs found", because
 * this file used to compile a glob by DELETING the asterisks and searching
 * for the remaining substring.
 */

describe("queryStringToFilter - attribute wildcards", () => {
  test("a prefix glob compiles to a Wildcard, not a substring Search", () => {
    const filter: LogFilter = queryStringToFilter("@platform.team:a*");
    const value: unknown = filter.attributes!["platform.team"];

    expect(value).toBeInstanceOf(Wildcard);
    expect((value as Wildcard<string>).toPatterns()).toEqual(["a%"]);
  });

  test.each([
    ["@k:*a", ["%a"]],
    ["@k:a*b", ["a%b"]],
    ["@k:a?c", ["a_c"]],
  ])("%p compiles to %p", (query: string, patterns: Array<string>) => {
    const filter: LogFilter = queryStringToFilter(query);

    expect((filter.attributes!["k"] as Wildcard<string>).toPatterns()).toEqual(
      patterns,
    );
  });

  test("a bare star asks whether the attribute is present", () => {
    const filter: LogFilter = queryStringToFilter("@user.id:*");

    expect(filter.attributes!["user.id"]).toBeInstanceOf(NotNull);
  });

  test("a negated bare star asks whether it is absent", () => {
    const filter: LogFilter = queryStringToFilter("-@user.id:*");

    expect(filter.attributes!["user.id"]).toBeInstanceOf(IsNull);
  });

  test("a negated glob keeps the negation AND the glob", () => {
    /*
     * The old parser only flipped the operator for bare equality, so
     * `-@k:a*` compiled to a positive contains — the exact complement of the
     * filter, returning the rows the user asked to hide.
     */
    const filter: LogFilter = queryStringToFilter("-@platform.team:a*");
    const value: unknown = filter.attributes!["platform.team"];

    expect(value).toBeInstanceOf(NotWildcard);
    expect((value as NotWildcard<string>).toPatterns()).toEqual(["a%"]);
  });

  test("an escaped star is a literal, so equality is used", () => {
    const filter: LogFilter = queryStringToFilter("@k:a\\*b");

    expect(filter.attributes!["k"]).toBe("a*b");
  });
});

describe("queryStringToFilter - the rest of the attribute grammar", () => {
  test("a plain value stays a bare string, keeping the fast map-subscript path", () => {
    const filter: LogFilter = queryStringToFilter("@http.status_code:500");

    expect(filter.attributes).toEqual({ "http.status_code": "500" });
  });

  test("~ is an explicit contains", () => {
    const filter: LogFilter = queryStringToFilter("@url.host:~internal");

    expect(filter.attributes!["url.host"]).toBeInstanceOf(Search);
  });

  test("a negated contains is a NotContains", () => {
    const filter: LogFilter = queryStringToFilter("-@url.host:~internal");

    expect(filter.attributes!["url.host"]).toBeInstanceOf(NotContains);
  });

  test("numeric comparisons parse their value as a number", () => {
    const gt: LogFilter = queryStringToFilter("@duration:>1000");
    expect(gt.attributes!["duration"]).toBeInstanceOf(GreaterThan);
    expect((gt.attributes!["duration"] as GreaterThan<number>).value).toBe(
      1000,
    );

    const gte: LogFilter = queryStringToFilter("@duration:>=1000");
    expect(gte.attributes!["duration"]).toBeInstanceOf(GreaterThanOrEqual);

    const lt: LogFilter = queryStringToFilter("@duration:<50");
    expect((lt.attributes!["duration"] as LessThan<number>).value).toBe(50);
  });

  test("a non-numeric comparison value stays a string", () => {
    const filter: LogFilter = queryStringToFilter("@version:>abc");

    expect((filter.attributes!["version"] as GreaterThan<string>).value).toBe(
      "abc",
    );
  });

  test("an any-of list compiles to Includes", () => {
    const filter: LogFilter = queryStringToFilter("@http.method:(GET OR POST)");
    const value: unknown = filter.attributes!["http.method"];

    expect(value).toBeInstanceOf(Includes);
    expect((value as Includes).values).toEqual(["GET", "POST"]);
  });

  test("negation produces a NotEqual", () => {
    const filter: LogFilter = queryStringToFilter("-@http.method:GET");

    expect(filter.attributes!["http.method"]).toBeInstanceOf(NotEqual);
    expect((filter.attributes!["http.method"] as NotEqual<string>).value).toBe(
      "GET",
    );
  });

  test("two filters on one key AND rather than the second winning", () => {
    const filter: LogFilter = queryStringToFilter("@k:a* @k:*b");
    const value: unknown = filter.attributes!["k"];

    expect(Array.isArray(value)).toBe(true);
    expect((value as Array<Wildcard<string>>)[0]!.toPatterns()).toEqual(["a%"]);
    expect((value as Array<Wildcard<string>>)[1]!.toPatterns()).toEqual(["%b"]);
  });
});

describe("queryStringToFilter - top-level fields", () => {
  test("severity:error normalizes to the title case stored in ClickHouse", () => {
    expect(queryStringToFilter("severity:error").severityText).toBe("Error");
  });

  test("level:warn aliases to severityText and normalizes warn to Warning", () => {
    expect(queryStringToFilter("level:warn").severityText).toBe("Warning");
  });

  test("the alias lookup is case-insensitive", () => {
    expect(queryStringToFilter("SEVERITY:error").severityText).toBe("Error");
  });

  test("severity normalization applies to every operator, not just equality", () => {
    const filter: LogFilter = queryStringToFilter("severity:(error OR warn)");

    expect((filter.severityText as unknown as Includes).values).toEqual([
      "Error",
      "Warning",
    ]);
  });

  test("service:api maps to primaryEntityId", () => {
    expect(queryStringToFilter("service:api").primaryEntityId).toBe("api");
  });

  test("negation produces a NotEqual with the normalized severity", () => {
    const filter: LogFilter = queryStringToFilter("-severity:debug");

    expect(filter.severityText).toBeInstanceOf(NotEqual);
    expect((filter.severityText as unknown as NotEqual<string>).value).toBe(
      "Debug",
    );
  });

  test("a glob on a top-level field is anchored, not a substring", () => {
    const filter: LogFilter = queryStringToFilter("service:api-*");
    const value: unknown = filter.primaryEntityId;

    expect(value).toBeInstanceOf(Wildcard);
    expect((value as Wildcard<string>).toPatterns()).toEqual(["api-%"]);
  });

  test("message / msg / log all alias to the body column", () => {
    for (const alias of ["message", "msg", "log"]) {
      expect(queryStringToFilter(`${alias}:timeout`).body).toBe("timeout");
    }
  });

  test("an unknown bare key is treated as an attribute", () => {
    const filter: LogFilter = queryStringToFilter("k8s.pod:api-0");

    expect(filter.attributes).toEqual({ "k8s.pod": "api-0" });
  });
});

describe("queryStringToFilter - @ always means attribute", () => {
  test.each(["body", "traceId", "spanId", "severityText"])(
    "@%s filters the attribute, not the column of the same name",
    (key: string) => {
      const filter: LogFilter = queryStringToFilter(`@${key}:x`);

      expect(filter.attributes).toEqual({ [key]: "x" });
      expect(filter[key]).toBeUndefined();
    },
  );
});

describe("queryStringToFilter - free text", () => {
  test("an empty query yields an empty filter", () => {
    expect(queryStringToFilter("")).toEqual({});
  });

  test("bare words become a body Search", () => {
    const filter: LogFilter = queryStringToFilter("connection refused");

    expect(filter.body).toBeInstanceOf(Search);
    expect((filter.body as Search<string>).toString()).toBe(
      "connection refused",
    );
  });

  test("phrases split by a field filter stay separate predicates", () => {
    /*
     * `foo severity:error bar` used to compile to `body ILIKE '%foo bar%'` —
     * a phrase that never occurred in any log line, so the search returned
     * nothing and looked like a data problem.
     */
    const filter: LogFilter = queryStringToFilter("foo severity:error bar");
    const body: unknown = filter.body;

    expect(Array.isArray(body)).toBe(true);
    expect(
      (body as Array<Search<string>>).map((s: Search<string>) => {
        return s.toString();
      }),
    ).toEqual(["foo", "bar"]);
  });

  test("a quoted phrase keeps its spaces", () => {
    const filter: LogFilter = queryStringToFilter('"out of memory"');

    expect((filter.body as Search<string>).toString()).toBe("out of memory");
  });

  test("a URL is free text, not a filter on a field called https", () => {
    const filter: LogFilter = queryStringToFilter("https://example.com/x");

    expect(filter.attributes).toBeUndefined();
    expect((filter.body as Search<string>).toString()).toBe(
      "https://example.com/x",
    );
  });
});

describe("queryStringToFilter - combinations", () => {
  test("a field filter plus trailing free text populate distinct slots", () => {
    const filter: LogFilter = queryStringToFilter("severity:error timeout");

    expect(filter.severityText).toBe("Error");
    expect((filter.body as Search<string>).toString()).toBe("timeout");
  });

  test("the customer's whole query", () => {
    const filter: LogFilter = queryStringToFilter(
      "severity:error @platform.team:a* -@http.method:GET timeout",
    );

    expect(filter.severityText).toBe("Error");
    expect(
      (filter.attributes!["platform.team"] as Wildcard<string>).toPatterns(),
    ).toEqual(["a%"]);
    expect(filter.attributes!["http.method"]).toBeInstanceOf(NotEqual);
    expect((filter.body as Search<string>).toString()).toBe("timeout");
  });
});
