import { describe, expect, test } from "@jest/globals";
import {
  JSON_TOKEN_CLASS_NAMES,
  JSONToken,
  JSONTokenKind,
  tokenizeJSONLine,
} from "../../../../UI/Components/AttributesJSON/JSONHighlight";
import { stringifyAttributesJSON } from "../../../../Utils/Telemetry/AttributesJSON";

/*
 * The JSON view colours each line of the pretty-printed attributes. The
 * tokens must add back up to the exact line (it is what gets selected and
 * copied), and a string must stay one token whatever it contains.
 */

function kinds(line: string): Array<[string, JSONTokenKind]> {
  return tokenizeJSONLine(line).map((token: JSONToken) => {
    return [token.text, token.kind];
  });
}

describe("tokenizeJSONLine", () => {
  test("splits a string entry into key, punctuation and value", () => {
    expect(kinds('  "http.request.method": "GET",')).toEqual([
      ["  ", "punctuation"],
      ['"http.request.method"', "key"],
      [":", "punctuation"],
      [" ", "punctuation"],
      ['"GET"', "string"],
      [",", "punctuation"],
    ]);
  });

  test("recognises numbers, including negative, decimal and exponent forms", () => {
    expect(kinds('  "a": -12.5e+3,')).toContainEqual(["-12.5e+3", "number"]);
    expect(kinds('  "b": 200')).toContainEqual(["200", "number"]);
    expect(kinds('  "c": 0.25,')).toContainEqual(["0.25", "number"]);
  });

  test("recognises booleans and null", () => {
    expect(kinds('  "ok": true,')).toContainEqual(["true", "boolean"]);
    expect(kinds('  "ok": false')).toContainEqual(["false", "boolean"]);
    expect(kinds('  "user": null')).toContainEqual(["null", "null"]);
  });

  test("never reads digits, literals or colons inside a string as tokens", () => {
    const tokens: Array<[string, JSONTokenKind]> = kinds(
      '  "note": "true: 42 null, {x}"',
    );

    expect(tokens).toContainEqual(['"true: 42 null, {x}"', "string"]);
    expect(
      tokens.filter(([, kind]: [string, JSONTokenKind]) => {
        return kind === "number" || kind === "boolean" || kind === "null";
      }),
    ).toEqual([]);
  });

  test("keeps escaped quotes and backslashes inside one string token", () => {
    const line: string = '  "msg": "say \\"hi\\" to C:\\\\temp"';

    expect(kinds(line)).toContainEqual([
      '"say \\"hi\\" to C:\\\\temp"',
      "string",
    ]);
  });

  test("treats a quoted string followed by a colon as a key even with spaces", () => {
    expect(kinds('"spaced"   : 1')).toEqual([
      ['"spaced"', "key"],
      ["   :", "punctuation"],
      [" ", "punctuation"],
      ["1", "number"],
    ]);
  });

  test("brackets and commas are punctuation", () => {
    expect(kinds("{")).toEqual([["{", "punctuation"]]);
    expect(kinds("  ],")).toEqual([["  ],", "punctuation"]]);
    expect(kinds("")).toEqual([]);
  });

  test("tokens always add back up to the original line", () => {
    const text: string = stringifyAttributesJSON(
      {
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "enduser.roles": ["admin", "billing"],
        "error.handled": false,
        "user.id": null,
        "exception.message": 'Unexpected "}" at 3:14',
        nested: { deep: { value: -1.5e-7 } },
      },
      "nested",
    );

    for (const line of text.split("\n")) {
      expect(
        tokenizeJSONLine(line)
          .map((token: JSONToken) => {
            return token.text;
          })
          .join(""),
      ).toBe(line);
    }
  });

  test("can be called repeatedly (the global pattern's position is reset)", () => {
    const first: Array<JSONToken> = tokenizeJSONLine('  "a": 1,');
    const second: Array<JSONToken> = tokenizeJSONLine('  "a": 1,');

    expect(second).toEqual(first);
  });
});

describe("JSON_TOKEN_CLASS_NAMES", () => {
  test("gives every token kind a colour", () => {
    const tokenKinds: Array<JSONTokenKind> = [
      "key",
      "string",
      "number",
      "boolean",
      "null",
      "punctuation",
    ];

    for (const kind of tokenKinds) {
      expect(JSON_TOKEN_CLASS_NAMES[kind]).toMatch(/text-/);
    }
  });
});
