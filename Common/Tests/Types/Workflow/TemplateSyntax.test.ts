import {
  JSONSyntaxCheckResult,
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  checkJSONSyntax,
  hasEachBlock,
  looksLikeReferencePath,
  maskTemplateExpressions,
  parseReferencePath,
  parseTemplateExpressions,
} from "../../../Types/Workflow/TemplateSyntax";
import { describe, expect, test } from "@jest/globals";

describe("parseTemplateExpressions", () => {
  test("finds nothing in text with no expressions", () => {
    expect(parseTemplateExpressions("just some text")).toEqual([]);
    expect(parseTemplateExpressions("")).toEqual([]);
  });

  test("is non-greedy, so adjacent expressions stay separate", () => {
    const found: Array<TemplateExpression> = parseTemplateExpressions(
      "{{local.variables.a}} and {{local.variables.b}}",
    );

    expect(found).toHaveLength(2);
    expect(found[0]?.inner).toBe("local.variables.a");
    expect(found[1]?.inner).toBe("local.variables.b");
  });

  test("records the exact source offsets", () => {
    const found: Array<TemplateExpression> =
      parseTemplateExpressions("ab{{x}}cd");

    expect(found[0]?.startIndex).toBe(2);
    expect(found[0]?.endIndex).toBe(7);
    expect(found[0]?.raw).toBe("{{x}}");
  });

  test("keeps the untrimmed capture alongside the trimmed one", () => {
    const found: Array<TemplateExpression> = parseTemplateExpressions(
      "{{ local.variables.a }}",
    );

    expect(found[0]?.inner).toBe("local.variables.a");
    expect(found[0]?.innerRaw).toBe(" local.variables.a ");
  });

  test("classifies each kind of expression", () => {
    const found: Array<TemplateExpression> = parseTemplateExpressions(
      "{{#each local.components.a.returnValues.items}}{{@index}}{{this}}{{name}}{{/each}}",
    );

    expect(
      found.map((expression: TemplateExpression) => {
        return expression.kind;
      }),
    ).toEqual([
      TemplateExpressionKind.EachOpen,
      TemplateExpressionKind.LoopIndex,
      TemplateExpressionKind.LoopThis,
      TemplateExpressionKind.Reference,
      TemplateExpressionKind.EachClose,
    ]);
  });

  test("marks loop bodies as inside a block, and the tags themselves as not", () => {
    const found: Array<TemplateExpression> = parseTemplateExpressions(
      "{{outer}}{{#each items}}{{inner}}{{/each}}{{after}}",
    );

    const byInner: Record<string, boolean> = {};

    for (const expression of found) {
      byInner[expression.inner] = expression.isInsideEachBlock;
    }

    expect(byInner["outer"]).toBe(false);
    expect(byInner["#each items"]).toBe(false);
    expect(byInner["inner"]).toBe(true);
    expect(byInner["/each"]).toBe(false);
    expect(byInner["after"]).toBe(false);
  });

  test("tracks nesting depth across nested loops", () => {
    const found: Array<TemplateExpression> = parseTemplateExpressions(
      "{{#each a}}{{one}}{{#each b}}{{two}}{{/each}}{{three}}{{/each}}{{four}}",
    );

    const byInner: Record<string, boolean> = {};

    for (const expression of found) {
      byInner[expression.inner] = expression.isInsideEachBlock;
    }

    expect(byInner["one"]).toBe(true);
    expect(byInner["two"]).toBe(true);
    expect(byInner["three"]).toBe(true);
    expect(byInner["four"]).toBe(false);
  });

  test("does not carry loop state between calls", () => {
    parseTemplateExpressions("{{#each a}}{{x}}");

    const found: Array<TemplateExpression> = parseTemplateExpressions("{{y}}");

    expect(found[0]?.isInsideEachBlock).toBe(false);
  });
});

describe("hasEachBlock", () => {
  test("detects opening and closing tags", () => {
    expect(hasEachBlock("{{#each items}}x{{/each}}")).toBe(true);
    expect(hasEachBlock("{{#each items}}")).toBe(true);
    expect(hasEachBlock("{{/each}}")).toBe(true);
  });

  test("is false for ordinary references and empty input", () => {
    expect(hasEachBlock("{{local.variables.a}}")).toBe(false);
    expect(hasEachBlock("")).toBe(false);
  });
});

describe("maskTemplateExpressions", () => {
  test("substitutes a token that is legal as a value, in a string, and as a key", () => {
    expect(maskTemplateExpressions('{"n": {{a}}}')).toBe('{"n": 1}');
    expect(maskTemplateExpressions('{"s": "{{a}}"}')).toBe('{"s": "1"}');
    expect(maskTemplateExpressions('{"{{a}}": 2}')).toBe('{"1": 2}');
  });

  test("leaves text without expressions alone", () => {
    expect(maskTemplateExpressions('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe("checkJSONSyntax", () => {
  test("accepts ordinary JSON", () => {
    expect(checkJSONSyntax('{"a": 1}').isValid).toBe(true);
    expect(checkJSONSyntax("[1, 2, 3]").isValid).toBe(true);
  });

  test("rejects the mistakes it exists to catch", () => {
    const trailingComma: JSONSyntaxCheckResult = checkJSONSyntax('{"a": 1,}');

    expect(trailingComma.isValid).toBe(false);
    expect(trailingComma.wasSkipped).toBe(false);
    expect(trailingComma.errorMessage).toBeTruthy();

    expect(checkJSONSyntax('{"a": 1').isValid).toBe(false);
    expect(checkJSONSyntax("{a: 1}").isValid).toBe(false);
    expect(checkJSONSyntax("{'a': 1}").isValid).toBe(false);
    expect(checkJSONSyntax("not json at all").isValid).toBe(false);
  });

  test("carries the parser's own message, unframed", () => {
    const result: JSONSyntaxCheckResult = checkJSONSyntax('{"a": 1,}');

    expect(result.errorMessage).not.toMatch(/is not valid JSON/);
    expect(result.errorMessage).toMatch(/JSON|token|position/i);
  });

  /*
   * The false-positive cases. Each of these is something a workflow author
   * legitimately writes, and flagging any of them would disable Save on a
   * workflow that runs correctly.
   */
  test("accepts a whole-field reference, which is not JSON as written", () => {
    expect(
      checkJSONSyntax("{{local.components.api-get-1.returnValues.body}}")
        .isValid,
    ).toBe(true);
  });

  test("accepts a reference standing in for a bare JSON value", () => {
    expect(
      checkJSONSyntax('{"retries": {{local.variables.count}}}').isValid,
    ).toBe(true);
  });

  test("accepts a reference inside a string literal", () => {
    expect(
      checkJSONSyntax('{"token": "Bearer {{local.variables.apiKey}}"}').isValid,
    ).toBe(true);
  });

  test("accepts a reference used as an object key", () => {
    expect(checkJSONSyntax('{"{{local.variables.k}}": 1}').isValid).toBe(true);
  });

  test("accepts a reference inside an array", () => {
    expect(checkJSONSyntax('[{{local.variables.a}}, "b"]').isValid).toBe(true);
  });

  test("declines to judge anything containing a loop", () => {
    const looped: JSONSyntaxCheckResult = checkJSONSyntax(
      '[{{#each local.components.a.returnValues.items}}{"id":"{{this}}"},{{/each}}]',
    );

    expect(looped.isValid).toBe(true);
    expect(looped.wasSkipped).toBe(true);
  });

  test("skips values that are not strings", () => {
    expect(checkJSONSyntax({ a: 1 }).wasSkipped).toBe(true);
    expect(checkJSONSyntax(["a"]).wasSkipped).toBe(true);
    expect(checkJSONSyntax(12).wasSkipped).toBe(true);
    expect(checkJSONSyntax(true).wasSkipped).toBe(true);
    expect(checkJSONSyntax(null).wasSkipped).toBe(true);
    expect(checkJSONSyntax(undefined).wasSkipped).toBe(true);
  });

  test("skips empty values, leaving the required-field message to stand", () => {
    expect(checkJSONSyntax("").wasSkipped).toBe(true);
    expect(checkJSONSyntax("   ").wasSkipped).toBe(true);
    expect(checkJSONSyntax("\n").wasSkipped).toBe(true);
  });

  test("judges by JSON5's rules when asked, matching the lenient parsers", () => {
    expect(checkJSONSyntax("{a: 1}", { allowJSON5: true }).isValid).toBe(true);
    expect(checkJSONSyntax("{'a': 1}", { allowJSON5: true }).isValid).toBe(
      true,
    );
    expect(checkJSONSyntax('{"a": 1,}', { allowJSON5: true }).isValid).toBe(
      true,
    );
  });

  test("still rejects unparseable text under JSON5", () => {
    expect(checkJSONSyntax("{oops", { allowJSON5: true }).isValid).toBe(false);
  });

  test("keeps templates working under JSON5 too", () => {
    expect(
      checkJSONSyntax('{a: "{{local.variables.x}}"}', { allowJSON5: true })
        .isValid,
    ).toBe(true);
  });
});

describe("looksLikeReferencePath", () => {
  test("accepts real reference paths", () => {
    expect(looksLikeReferencePath("local.variables.apiKey")).toBe(true);
    expect(
      looksLikeReferencePath(
        "local.components.api-get-1.returnValues.response-body",
      ),
    ).toBe(true);
    expect(looksLikeReferencePath("global.variables.My Key")).toBe(true);
    expect(looksLikeReferencePath("local.componets.x.returnValues.y")).toBe(
      true,
    );
  });

  test("accepts array accessors", () => {
    expect(looksLikeReferencePath("a.items[0].name")).toBe(true);
    expect(looksLikeReferencePath("a.items[last]")).toBe(true);
  });

  test("rejects captures that are really JavaScript", () => {
    expect(looksLikeReferencePath(" return 1; ")).toBe(false);
    expect(looksLikeReferencePath("a = b")).toBe(false);
    expect(looksLikeReferencePath('x: "y"')).toBe(false);
    expect(looksLikeReferencePath("f(x)")).toBe(false);
    expect(looksLikeReferencePath("a + b")).toBe(false);
  });

  test("rejects an empty capture", () => {
    expect(looksLikeReferencePath("")).toBe(false);
    expect(looksLikeReferencePath("   ")).toBe(false);
  });
});

describe("parseReferencePath", () => {
  test("reads a local variable", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local.variables.apiKey",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.LocalVariable);
    expect(parsed.variableName).toBe("apiKey");
  });

  test("reads a global variable", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "global.variables.region",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.GlobalVariable);
    expect(parsed.variableName).toBe("region");
  });

  test("reads a component return value, exactly as the picker writes it", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local.components.api-get-1.returnValues.response-body",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.ComponentReturnValue);
    expect(parsed.componentId).toBe("api-get-1");
    expect(parsed.returnValueId).toBe("response-body");
  });

  test("stops at the return value and ignores the drill-in below it", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local.components.api-get-1.returnValues.response-body.data.items[0].id",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.ComponentReturnValue);
    expect(parsed.componentId).toBe("api-get-1");
    expect(parsed.returnValueId).toBe("response-body");
  });

  test("strips array accessors when naming the parts", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local.components.api-get-1.returnValues.items[last]",
    );

    expect(parsed.returnValueId).toBe("items");
  });

  test("rejects an unknown root", () => {
    const parsed: ParsedReferencePath = parseReferencePath("componets.x");

    expect(parsed.rootType).toBe(ReferenceRootType.Unknown);
    expect(parsed.reason).toMatch(/local|global/);
  });

  test("rejects a misspelled second segment", () => {
    expect(
      parseReferencePath("local.component.x.returnValues.y").rootType,
    ).toBe(ReferenceRootType.Unknown);
    expect(parseReferencePath("global.variable.x").rootType).toBe(
      ReferenceRootType.Unknown,
    );
  });

  test("rejects a component path that does not say returnValues", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local.components.api-get-1.body",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.Unknown);
    expect(parsed.reason).toMatch(/returnValues/);
  });

  test("rejects truncated paths", () => {
    expect(parseReferencePath("local.variables").rootType).toBe(
      ReferenceRootType.Unknown,
    );
    expect(parseReferencePath("local.components").rootType).toBe(
      ReferenceRootType.Unknown,
    );
    expect(
      parseReferencePath("local.components.api-get-1.returnValues").rootType,
    ).toBe(ReferenceRootType.Unknown);
  });

  test("rejects an empty part between two dots, which resolves to nothing", () => {
    const parsed: ParsedReferencePath = parseReferencePath(
      "local..variables.apiKey",
    );

    expect(parsed.rootType).toBe(ReferenceRootType.Unknown);
    expect(parsed.reason).toMatch(/empty part/);
  });

  test("rejects an empty path", () => {
    expect(parseReferencePath("").rootType).toBe(ReferenceRootType.Unknown);
  });

  test("allows spaces and hyphens inside a name, since only dots are structural", () => {
    expect(parseReferencePath("global.variables.My Key").variableName).toBe(
      "My Key",
    );
    expect(parseReferencePath("local.variables.api-key").variableName).toBe(
      "api-key",
    );
  });
});
