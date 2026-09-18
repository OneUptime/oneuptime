import { describe, expect, test } from "@jest/globals";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
  evaluateFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { JSONObject } from "Common/Types/JSON";

/*
 * The log/span filter predicate engine (pipelines, drop filters, severity
 * categories). The two safety-critical properties pinned here:
 *
 *   - An UNPARSABLE query compiles to always-false and never matches — the
 *     legacy safe default. A drop filter that matched on a parse error would
 *     silently delete logs.
 *   - An EMPTY query's meaning is caller-chosen: always-true for pipelines
 *     (apply to every record) but always-false for drop filters (matching
 *     everything would delete everything). compileFilter's emptyQueryMatches
 *     option is the switch, and getting it backwards is a data-loss bug.
 *
 * Plus the operator semantics: `=`/`!=` are exact string compares, `LIKE`
 * without `%` is a case-insensitive "contains" (NOT SQL wildcard — `_` is
 * literal there), `LIKE` with `%` is an anchored SQL-wildcard regex, and `IN`
 * is set membership. Field paths resolve top-level fields, `attributes.<key>`,
 * bare keys as attributes, and the OTel `resource.` prefix fallback.
 */

function row(fields: JSONObject): JSONObject {
  return fields;
}

describe("compileFilter — empty and unparsable queries", () => {
  test("empty / whitespace query defaults to always-true (pipeline default)", () => {
    expect(compileFilter("")).toEqual({ kind: "always-true" });
    expect(compileFilter("   ")).toEqual({ kind: "always-true" });
    expect(compileFilter("\t\n")).toEqual({ kind: "always-true" });
  });

  test("empty query with emptyQueryMatches:false is always-false (drop-filter safety)", () => {
    expect(compileFilter("", { emptyQueryMatches: false })).toEqual({
      kind: "always-false",
    });
    expect(compileFilter("   ", { emptyQueryMatches: false })).toEqual({
      kind: "always-false",
    });
  });

  test("emptyQueryMatches:true is explicit always-true", () => {
    expect(compileFilter("", { emptyQueryMatches: true })).toEqual({
      kind: "always-true",
    });
  });

  test("an unparsable query compiles to always-false, never matches", () => {
    // A field with no operator/value cannot parse.
    expect(compileFilter("severityText")).toEqual({ kind: "always-false" });
    // An operator with no field.
    expect(compileFilter("= 'x'")).toEqual({ kind: "always-false" });
    // LIKE with no value.
    expect(compileFilter("body LIKE")).toEqual({ kind: "always-false" });
  });

  test("a well-formed query compiles to an expr", () => {
    const compiled: CompiledFilter = compileFilter("severityText = 'ERROR'");
    expect(compiled.kind).toBe("expr");
  });
});

describe("evaluateCompiledFilter — the three kinds", () => {
  test("always-true matches every row, always-false matches none", () => {
    const r: JSONObject = row({ body: "anything" });
    expect(evaluateCompiledFilter(r, { kind: "always-true" })).toBe(true);
    expect(evaluateCompiledFilter(r, { kind: "always-false" })).toBe(false);
  });

  test("compiling once and reusing evaluates like the one-shot helper", () => {
    const compiled: CompiledFilter = compileFilter("body LIKE 'error'");
    expect(evaluateCompiledFilter(row({ body: "an Error" }), compiled)).toBe(
      true,
    );
    expect(evaluateCompiledFilter(row({ body: "ok" }), compiled)).toBe(false);
  });
});

describe("evaluateFilter — equality and inequality", () => {
  test("= is an exact string compare after stringifying the field", () => {
    expect(
      evaluateFilter(row({ severityText: "ERROR" }), "severityText = 'ERROR'"),
    ).toBe(true);
    expect(
      evaluateFilter(row({ severityText: "INFO" }), "severityText = 'ERROR'"),
    ).toBe(false);
    // = is case-sensitive (unlike LIKE).
    expect(
      evaluateFilter(row({ severityText: "error" }), "severityText = 'ERROR'"),
    ).toBe(false);
  });

  test("numeric fields are stringified before comparison", () => {
    expect(evaluateFilter(row({ statusCode: 200 }), "statusCode = '200'")).toBe(
      true,
    );
    expect(evaluateFilter(row({ statusCode: 500 }), "statusCode = '200'")).toBe(
      false,
    );
  });

  test("!= is the negation of exact compare", () => {
    expect(
      evaluateFilter(row({ severityText: "INFO" }), "severityText != 'ERROR'"),
    ).toBe(true);
    expect(
      evaluateFilter(row({ severityText: "ERROR" }), "severityText != 'ERROR'"),
    ).toBe(false);
  });

  test("a missing field reads as empty string", () => {
    expect(evaluateFilter(row({}), "missing = ''")).toBe(true);
    expect(evaluateFilter(row({}), "missing != 'x'")).toBe(true);
    expect(evaluateFilter(row({}), "missing = 'x'")).toBe(false);
  });
});

describe("evaluateFilter — LIKE", () => {
  test("without % it is a case-insensitive substring ('contains')", () => {
    expect(
      evaluateFilter(row({ body: "Database Error here" }), "body LIKE 'error'"),
    ).toBe(true);
    expect(evaluateFilter(row({ body: "all good" }), "body LIKE 'error'")).toBe(
      false,
    );
  });

  test("without % the underscore is literal, not a wildcard", () => {
    expect(evaluateFilter(row({ body: "a_c" }), "body LIKE 'a_c'")).toBe(true);
    // 'axc' does NOT contain the literal 'a_c'.
    expect(evaluateFilter(row({ body: "axc" }), "body LIKE 'a_c'")).toBe(false);
  });

  test("with % it is an anchored SQL-wildcard regex", () => {
    // %err% -> ^.*err.*$ (case-insensitive).
    expect(
      evaluateFilter(row({ body: "Fatal Error" }), "body LIKE '%err%'"),
    ).toBe(true);
    // Anchored: 'prod-api' fully matches 'prod%'.
    expect(
      evaluateFilter(
        row({ serviceName: "prod-api" }),
        "serviceName LIKE 'prod%'",
      ),
    ).toBe(true);
    expect(
      evaluateFilter(
        row({ serviceName: "staging-api" }),
        "serviceName LIKE 'prod%'",
      ),
    ).toBe(false);
  });

  test("with % present, _ becomes a single-character wildcard", () => {
    // 'a_c%' -> ^a.c.*$
    expect(
      evaluateFilter(row({ body: "aXcanything" }), "body LIKE 'a_c%'"),
    ).toBe(true);
    // Underscore matches exactly one char, so 'ac...' (missing the middle) fails.
    expect(
      evaluateFilter(row({ body: "acanything" }), "body LIKE 'a_c%'"),
    ).toBe(false);
  });

  test("regex metacharacters in the pattern are escaped, not interpreted", () => {
    // The '.' must match a literal dot, so 'aXb' must not match 'a.b%'.
    expect(evaluateFilter(row({ body: "a.b extra" }), "body LIKE 'a.b%'")).toBe(
      true,
    );
    expect(evaluateFilter(row({ body: "aXb extra" }), "body LIKE 'a.b%'")).toBe(
      false,
    );
  });
});

describe("evaluateFilter — IN", () => {
  test("matches when the field equals any listed value", () => {
    const q: string = "severityText IN ('ERROR', 'FATAL', 'WARN')";
    expect(evaluateFilter(row({ severityText: "FATAL" }), q)).toBe(true);
    expect(evaluateFilter(row({ severityText: "INFO" }), q)).toBe(false);
  });

  test("membership is exact (case-sensitive)", () => {
    const q: string = "severityText IN ('ERROR')";
    expect(evaluateFilter(row({ severityText: "error" }), q)).toBe(false);
  });
});

describe("evaluateFilter — boolean composition and precedence", () => {
  test("AND requires both sides", () => {
    const q: string = "severityText = 'ERROR' AND serviceName = 'api'";
    expect(
      evaluateFilter(row({ severityText: "ERROR", serviceName: "api" }), q),
    ).toBe(true);
    expect(
      evaluateFilter(row({ severityText: "ERROR", serviceName: "web" }), q),
    ).toBe(false);
  });

  test("OR requires either side", () => {
    const q: string = "severityText = 'ERROR' OR severityText = 'FATAL'";
    expect(evaluateFilter(row({ severityText: "FATAL" }), q)).toBe(true);
    expect(evaluateFilter(row({ severityText: "INFO" }), q)).toBe(false);
  });

  test("NOT negates its operand", () => {
    expect(
      evaluateFilter(
        row({ severityText: "INFO" }),
        "NOT severityText = 'INFO'",
      ),
    ).toBe(false);
    expect(
      evaluateFilter(
        row({ severityText: "ERROR" }),
        "NOT severityText = 'INFO'",
      ),
    ).toBe(true);
  });

  test("AND binds tighter than OR", () => {
    // Parses as: a='1' OR (b='2' AND c='3').
    const q: string = "a = '1' OR b = '2' AND c = '3'";
    // a matches alone -> true even though the AND branch is false.
    expect(evaluateFilter(row({ a: "1", b: "x", c: "x" }), q)).toBe(true);
    // a fails; AND branch fully satisfied -> true.
    expect(evaluateFilter(row({ a: "0", b: "2", c: "3" }), q)).toBe(true);
    // a fails; AND branch partially satisfied -> false.
    expect(evaluateFilter(row({ a: "0", b: "2", c: "x" }), q)).toBe(false);
  });

  test("parentheses override the default precedence", () => {
    // (a='1' OR b='2') AND c='3'
    const q: string = "(a = '1' OR b = '2') AND c = '3'";
    expect(evaluateFilter(row({ a: "1", b: "x", c: "3" }), q)).toBe(true);
    expect(evaluateFilter(row({ a: "1", b: "x", c: "x" }), q)).toBe(false);
  });
});

describe("evaluateFilter — field path resolution", () => {
  test("attributes.<key> reads a nested attribute", () => {
    const r: JSONObject = row({ attributes: { "http.method": "GET" } });
    expect(evaluateFilter(r, "attributes.http.method = 'GET'")).toBe(true);
    expect(evaluateFilter(r, "attributes.http.method = 'POST'")).toBe(false);
  });

  test("a bare key falls back to an attribute lookup", () => {
    const r: JSONObject = row({ attributes: { "url.full": "http://x/y" } });
    expect(evaluateFilter(r, "url.full LIKE 'http://x'")).toBe(true);
  });

  test("a bare key resolves the OTel resource. prefix", () => {
    const r: JSONObject = row({
      attributes: { "resource.service.name": "checkout" },
    });
    expect(evaluateFilter(r, "service.name = 'checkout'")).toBe(true);
  });

  test("top-level field wins over an attribute of the same name", () => {
    const r: JSONObject = row({
      body: "top",
      attributes: { body: "attr" },
    });
    expect(evaluateFilter(r, "body = 'top'")).toBe(true);
    expect(evaluateFilter(r, "body = 'attr'")).toBe(false);
  });

  test("an object-valued attribute is JSON-stringified before matching", () => {
    const r: JSONObject = row({ attributes: { tags: { env: "prod" } } });
    // stringify -> {"env":"prod"} ; substring 'env' is present.
    expect(evaluateFilter(r, "tags LIKE 'env'")).toBe(true);
    expect(evaluateFilter(r, 'tags = \'{"env":"prod"}\'')).toBe(true);
  });
});
