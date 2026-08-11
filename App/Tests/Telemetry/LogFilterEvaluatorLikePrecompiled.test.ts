import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
  evaluateFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the LIKE operator of the shared log/span filter
 * evaluator (drop filters, pipeline filters, category processors).
 *
 * The evaluator is two-stage by design: compileFilter precomputes
 * likeSubstring / likeRegex once per rule load, and the per-record
 * evaluation must READ those precompiled forms instead of re-escaping the
 * pattern and constructing a fresh RegExp per record — that rebuild in the
 * hottest ingest loop is exactly what the compile stage exists to remove,
 * and it regressed once already (the fields were populated but never read).
 *
 * The tampering tests are the mutation-proof guard: they overwrite the
 * precompiled fields on a compiled AST and assert evaluation follows the
 * tampered values. If someone reverts the evaluator to recompiling from the
 * raw pattern, those tests fail immediately.
 */

function row(body: string, attributes?: JSONObject): JSONObject {
  return {
    body: body,
    severityText: "Info",
    attributes: attributes || {},
  };
}

function compile(query: string): CompiledFilter {
  return compileFilter(query);
}

describe("LIKE without % (contains semantics)", () => {
  test("substring match is case-insensitive", () => {
    const filter: CompiledFilter = compile("body LIKE 'health'");

    expect(evaluateCompiledFilter(row("GET /HEALTHZ 200"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("get /healthz 200"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("GET /metrics 200"), filter)).toBe(false);
  });

  test("matches anywhere in the field, not only exact", () => {
    const filter: CompiledFilter = compile("body LIKE 'time'");

    expect(evaluateCompiledFilter(row("oneuptime worker"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("time"), filter)).toBe(true);
  });

  test("empty pattern matches every record", () => {
    const filter: CompiledFilter = compile("body LIKE ''");

    expect(evaluateCompiledFilter(row("anything"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row(""), filter)).toBe(true);
  });
});

describe("LIKE with % (SQL wildcard semantics)", () => {
  test("anchored wildcard match", () => {
    const filter: CompiledFilter = compile("body LIKE 'GET %'");

    expect(evaluateCompiledFilter(row("GET /healthz"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("POST GET /x"), filter)).toBe(false);
  });

  test("is case-insensitive", () => {
    const filter: CompiledFilter = compile("body LIKE 'get %'");

    expect(evaluateCompiledFilter(row("GET /healthz"), filter)).toBe(true);
  });

  test("underscore matches exactly one character when % makes it a wildcard pattern", () => {
    // ^v..*$ — at least one character after 'v'.
    const filter: CompiledFilter = compile("body LIKE 'v_%'");

    expect(evaluateCompiledFilter(row("v1"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("v12"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("v"), filter)).toBe(false);
  });

  test("underscore stays a literal in contains mode (no %)", () => {
    const filter: CompiledFilter = compile("body LIKE 'v_'");

    expect(evaluateCompiledFilter(row("v_1"), filter)).toBe(true);
    expect(evaluateCompiledFilter(row("v1"), filter)).toBe(false);
  });

  test("regex metacharacters in the pattern are escaped, not interpreted", () => {
    // '.' must match a literal dot only — not any character.
    const filter: CompiledFilter = compile("body LIKE 'api.oneuptime.com%'");

    expect(
      evaluateCompiledFilter(row("api.oneuptime.com/v1/logs"), filter),
    ).toBe(true);
    expect(
      evaluateCompiledFilter(row("apiXoneuptimeXcom/v1/logs"), filter),
    ).toBe(false);
  });
});

describe("per-record evaluation reads the precompiled forms (mutation guard)", () => {
  type LikeComparison = {
    likeSubstring?: string;
    likeRegex?: RegExp | null;
  };

  function comparisonOf(filter: CompiledFilter): LikeComparison {
    return (filter as unknown as { expr: LikeComparison }).expr;
  }

  test("substring path uses comp.likeSubstring, not the raw pattern", () => {
    const filter: CompiledFilter = compile("body LIKE 'original'");

    // Sanity: compiled form behaves normally first.
    expect(evaluateCompiledFilter(row("has original text"), filter)).toBe(true);

    // Tamper with the precompiled substring; the raw value stays 'original'.
    comparisonOf(filter).likeSubstring = "tampered";

    expect(evaluateCompiledFilter(row("has original text"), filter)).toBe(
      false,
    );
    expect(evaluateCompiledFilter(row("has tampered text"), filter)).toBe(true);
  });

  test("wildcard path uses comp.likeRegex, not a per-record rebuild", () => {
    const filter: CompiledFilter = compile("body LIKE 'orig%'");

    expect(evaluateCompiledFilter(row("original"), filter)).toBe(true);

    // Tamper with the precompiled regex; the raw value still says 'orig%'.
    comparisonOf(filter).likeRegex = /^tampered$/i;

    expect(evaluateCompiledFilter(row("original"), filter)).toBe(false);
    expect(evaluateCompiledFilter(row("TAMPERED"), filter)).toBe(true);
  });
});

describe("legacy uncompiled path (evaluateFilter on a raw query)", () => {
  test("contains semantics still work without precompilation", () => {
    expect(evaluateFilter(row("GET /healthz 200"), "body LIKE 'health'")).toBe(
      true,
    );
    expect(evaluateFilter(row("GET /metrics 200"), "body LIKE 'health'")).toBe(
      false,
    );
  });

  test("wildcard semantics still work without precompilation", () => {
    expect(evaluateFilter(row("GET /healthz"), "body LIKE 'GET %'")).toBe(true);
    expect(evaluateFilter(row("POST /healthz"), "body LIKE 'GET %'")).toBe(
      false,
    );
  });

  test("compiled and uncompiled evaluation agree", () => {
    const queries: Array<string> = [
      "body LIKE 'health'",
      "body LIKE 'GET %'",
      "body LIKE 'v_'",
      "body LIKE 'api.oneuptime.com%'",
      "body LIKE ''",
    ];
    const bodies: Array<string> = [
      "GET /healthz",
      "get /HEALTHZ",
      "v1",
      "v12",
      "api.oneuptime.com/v1",
      "apiXoneuptimeXcom/v1",
      "",
    ];

    for (const query of queries) {
      const compiled: CompiledFilter = compile(query);
      for (const body of bodies) {
        expect(evaluateCompiledFilter(row(body), compiled)).toBe(
          evaluateFilter(row(body), query),
        );
      }
    }
  });
});
