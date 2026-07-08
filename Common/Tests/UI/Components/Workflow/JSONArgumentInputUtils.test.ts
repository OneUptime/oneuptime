import {
  validateJson,
  containsToken,
  ValidationResult,
} from "../../../../UI/Components/Workflow/JSONArgumentInputUtils";
import { describe, expect, test } from "@jest/globals";

describe("JSONArgumentInputUtils.validateJson", () => {
  test("treats empty / whitespace-only content as empty (no error)", () => {
    expect(validateJson("").status).toBe("empty");
    expect(validateJson("   \n ").status).toBe("empty");
    expect(validateJson("").hasVariables).toBe(false);
  });

  test("accepts well-formed JSON objects and arrays", () => {
    expect(validateJson('{"a": 1}').status).toBe("valid");
    expect(validateJson("[1, 2, 3]").status).toBe("valid");
    expect(validateJson('{"nested": {"b": true}}').status).toBe("valid");
    expect(validateJson('{"a": 1}').hasVariables).toBe(false);
  });

  test("flags malformed JSON as invalid with a message (the runtime footgun)", () => {
    // Trailing comma: strict JSON.parse rejects it, and so does the runtime.
    const trailingComma: ValidationResult = validateJson('{"a": 1,}');
    expect(trailingComma.status).toBe("invalid");
    expect(typeof trailingComma.message).toBe("string");
    expect(trailingComma.message!.length).toBeGreaterThan(0);

    expect(validateJson('{"a": }').status).toBe("invalid");
    expect(validateJson("not json").status).toBe("invalid");
    expect(validateJson('{"missing": "quote}').status).toBe("invalid");
  });

  test("treats JSON containing {{ tokens }} as valid (quoted and unquoted)", () => {
    const quoted: ValidationResult = validateJson(
      '{"url": "{{local.components.x.returnValues.y}}"}',
    );
    expect(quoted.status).toBe("valid");
    expect(quoted.hasVariables).toBe(true);

    // A token standing in for a whole value (unquoted) is also valid.
    const unquoted: ValidationResult = validateJson(
      '{"id": {{local.components.x.returnValues.y}}}',
    );
    expect(unquoted.status).toBe("valid");
    expect(unquoted.hasVariables).toBe(true);

    // A token embedded inside a larger string value.
    expect(
      validateJson('{"auth": "Bearer {{local.variables.token}}"}').status,
    ).toBe("valid");
  });

  test("classifies a field that is exactly one token as a variable reference", () => {
    const result: ValidationResult = validateJson("{{local.variables.foo}}");
    expect(result.status).toBe("variable");
    expect(result.hasVariables).toBe(true);
  });

  test("classifies {{#each}} block helpers as template logic, not invalid", () => {
    const result: ValidationResult = validateJson(
      "{{#each local.components.x.returnValues.list}}{{this}}{{/each}}",
    );
    expect(result.status).toBe("template");
  });

  test("invalid JSON without tokens stays invalid even near a valid mask", () => {
    // Two bare concatenated tokens do not form valid JSON on their own.
    expect(validateJson("{{a}}{{b}}").status).toBe("invalid");
  });
});

describe("JSONArgumentInputUtils.containsToken", () => {
  test("detects the presence of a {{ token }}", () => {
    expect(containsToken('{"a": "{{x}}"}')).toBe(true);
    expect(containsToken('{"a": 1}')).toBe(false);
  });

  test("is stateless across repeated calls (global-regex lastIndex reset)", () => {
    const value: string = '{"a": "{{x}}"}';
    expect(containsToken(value)).toBe(true);
    expect(containsToken(value)).toBe(true);
    expect(containsToken(value)).toBe(true);
  });
});
