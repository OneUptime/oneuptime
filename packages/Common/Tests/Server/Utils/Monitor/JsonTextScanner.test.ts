import JsonTextScanner, {
  JsonTextScan,
  JsonTextSpan,
} from "../../../../Server/Utils/Monitor/JsonTextScanner";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Reading a JSON response for what the evaluation details need from it: the
 * JSON path of the text a filter matched, and where the values of fields
 * whose names say secret sit in the text, so an excerpt cut from it masks
 * them. One pass, front to back, with no recursion.
 */

const SECRET_NAMES: ReadonlyArray<string> = ["token", "password", "session"];

function scan(text: string, index?: number): JsonTextScan | null {
  return JsonTextScanner.scan({
    text: text,
    isSensitiveName: (name: string): boolean => {
      return SECRET_NAMES.includes(name);
    },
    index: index,
  });
}

function spansText(text: string, spans: Array<JsonTextSpan>): Array<string> {
  return spans.map((span: JsonTextSpan): string => {
    return text.slice(span.start, span.end);
  });
}

describe("what is one JSON value", () => {
  test.each([
    "{}",
    "[]",
    '{"a":1}',
    ' { "a" : [ 1 , 2.5 , -3e2 , true , false , null ] } ',
    '[{"a":{"b":[[]]}}]',
    '"just a string"',
    "42",
    "null",
    '{"esc\\"aped":"quote \\" inside \\\\ and \\u00e9"}',
  ])("%s scans", (text: string) => {
    expect(scan(text)).not.toBeNull();
  });

  test.each([
    "",
    "   ",
    "{",
    "}",
    '{"a":1,}',
    "[1,]",
    '{"a"}',
    '{"a" 1}',
    "{a:1}",
    '{"a":1} trailing',
    '{"a":1}{"b":2}',
    '"unterminated',
    '"line\nbreak"',
    "NaN",
    "[1 2]",
    "<html>",
  ])("%s does not", (text: string) => {
    expect(scan(text)).toBeNull();
  });

  test("a root object or array is a container; a root value is not", () => {
    expect(scan('{"a":1}')!.isContainer).toBe(true);
    expect(scan("[1]")!.isContainer).toBe(true);
    expect(scan('"x"')!.isContainer).toBe(false);
  });
});

describe("where the secret values sit", () => {
  test("a secret field's primitive value is one span", () => {
    const text: string = '{"user":"jane","token":"abc123","count":2}';
    const result: JsonTextScan = scan(text)!;

    expect(spansText(text, result.sensitiveSpans)).toEqual(['"abc123"']);
  });

  test("a numeric, boolean or null secret is a span too", () => {
    const text: string = '{"password":123456,"session":null,"token":true}';

    expect(spansText(text, scan(text)!.sensitiveSpans)).toEqual([
      "123456",
      "null",
      "true",
    ]);
  });

  test("a secret field holding an object or a list is masked whole", () => {
    const text: string =
      '{"session":{"id":"s1","token":"t1","list":[1,{"x":2}]},"after":"kept"}';
    const result: JsonTextScan = scan(text)!;

    expect(spansText(text, result.sensitiveSpans)).toEqual([
      '{"id":"s1","token":"t1","list":[1,{"x":2}]}',
    ]);
  });

  test("secrets at every depth, in text order, never overlapping", () => {
    const text: string =
      '[{"token":"a"},{"nested":{"password":"b","ok":1}},{"token":["c","d"]}]';
    const spans: Array<JsonTextSpan> = scan(text)!.sensitiveSpans;

    expect(spansText(text, spans)).toEqual(['"a"', '"b"', '["c","d"]']);

    for (let index: number = 1; index < spans.length; index++) {
      expect(spans[index]!.start).toBeGreaterThanOrEqual(spans[index - 1]!.end);
    }
  });

  test("a key with an escape is read as it decodes", () => {
    const text: string = '{"\\u0074oken":"hidden"}';

    expect(spansText(text, scan(text)!.sensitiveSpans)).toEqual(['"hidden"']);
  });

  test("no secret names, no spans", () => {
    expect(scan('{"status":"down","items":[1,2]}')!.sensitiveSpans).toEqual([]);
  });
});

describe("the path of the text at an index", () => {
  const text: string =
    '{"data":{"items":[{"status":"ok"},{"status":"error: db down"}],"content-type":"json"}}';

  test("a value inside a list inside objects", () => {
    expect(scan(text, text.indexOf("error"))!.pathAtIndex).toBe(
      "data.items[1].status",
    );
  });

  test("a key names its own path", () => {
    expect(scan(text, text.indexOf('"items"') + 1)!.pathAtIndex).toBe(
      "data.items",
    );
  });

  test("a key that is no identifier is quoted in brackets", () => {
    expect(scan(text, text.indexOf('"json"') + 1)!.pathAtIndex).toBe(
      'data["content-type"]',
    );
  });

  test("an element of a top-level list", () => {
    const list: string = '["a","b","needle"]';

    expect(scan(list, list.indexOf("needle"))!.pathAtIndex).toBe("[2]");
  });

  test("a top-level value is the empty path", () => {
    expect(scan('"needle here"', 3)!.pathAtIndex).toBe("");
  });

  test("an index between tokens has no path", () => {
    expect(scan('{"a": 1}', 5)!.pathAtIndex).toBeUndefined();
  });

  test("formatPath writes a path as an expression reads it", () => {
    expect(
      JsonTextScanner.formatPath([
        { key: "data" },
        { key: "items" },
        { index: 0 },
        { key: "x-y" },
        { key: "$ok" },
      ]),
    ).toBe('data.items[0]["x-y"].$ok');
  });
});

describe("a response written to break it", () => {
  test("nesting past its depth is not scanned, and does not overflow", () => {
    const deep: string = "[".repeat(100000) + "]".repeat(100000);

    expect(scan(deep)).toBeNull();
  });

  test("takes time in line with the text", () => {
    const worstCases: Array<string> = [
      "[" + '"a",'.repeat(100000) + '"a"]',
      '{"token":"' + "\\\\".repeat(200000) + '"}',
      "[" + "{},".repeat(130000) + "{}]",
      '"' + "x".repeat(400000),
    ];

    for (const text of worstCases) {
      const run: FastestRun<JsonTextScan | null> = fastestRun({
        run: (): JsonTextScan | null => {
          return scan(text, text.length - 3);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});
