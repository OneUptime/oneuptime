import {
  JsonSyntaxCheckResult,
  JsonSyntaxError,
  checkJsonSyntax,
  describeJsonSyntaxError,
  findJsonSyntaxError,
  formatJson,
  offsetToLineColumn,
} from "../../../Types/Code/JsonSyntax";
import {
  JSONSyntaxCheckResult,
  checkJSONSyntax,
} from "../../../Types/Workflow/TemplateSyntax";
import { describe, expect, test } from "@jest/globals";

/*
 * The code editor's JSON status bar and gutter marker come from this module,
 * and the form blocks Save with checkJSONSyntax. The two must give the same
 * verdict on every document, and this module must also say where a broken
 * one breaks. Characters that are awkward to type (a backslash before "u",
 * invisible characters, an emoji) are built from code points so the source
 * of the test cannot be mangled on the way in.
 */

const BACKSLASH: string = String.fromCharCode(92);
const NBSP: string = String.fromCharCode(0xa0);
const BOM: string = String.fromCharCode(0xfeff);
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const EMOJI: string = String.fromCodePoint(0x1f600);

type EscapeFunction = (hex: string) => string;

// A JSON \uXXXX escape, as text: six characters, starting with a backslash.
const unicodeEscape: EscapeFunction = (hex: string): string => {
  return BACKSLASH + "u" + hex;
};

type ControlFunction = (code: number) => string;

const control: ControlFunction = (code: number): string => {
  return String.fromCharCode(code);
};

type ParsesFunction = (text: string) => boolean;

const parses: ParsesFunction = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

interface ErrorCase {
  name: string;
  text: string;
  message: string;
  offset: number;
}

const ERROR_CASES: Array<ErrorCase> = [
  // Trailing commas are blamed on the comma itself, not on the closer.
  {
    name: "a trailing comma in an object",
    text: '{"a": 1,}',
    message: "Trailing comma: remove the ',' before '}'",
    offset: 7,
  },
  {
    name: "a trailing comma in an object, spaced from the closer",
    text: '{"a": 1, }',
    message: "Trailing comma: remove the ',' before '}'",
    offset: 7,
  },
  {
    name: "a trailing comma in an array",
    text: "[1, 2,]",
    message: "Trailing comma: remove the ',' before ']'",
    offset: 5,
  },
  {
    name: "a trailing comma in a nested array",
    text: '{"a": [1,]}',
    message: "Trailing comma: remove the ',' before ']'",
    offset: 8,
  },
  {
    name: "a trailing comma after an object in an array",
    text: '[{"a": 1},]',
    message: "Trailing comma: remove the ',' before ']'",
    offset: 9,
  },
  {
    name: "an unquoted property name",
    text: "{a: 1}",
    message: "Property names must be wrapped in double quotes",
    offset: 1,
  },
  {
    name: "an unquoted property name after a comma",
    text: '{"a": 1, b: 2}',
    message: "Property names must be wrapped in double quotes",
    offset: 9,
  },
  {
    name: "a single-quoted property name",
    text: "{'a': 1}",
    message: "Strings must use double quotes, not single quotes",
    offset: 1,
  },
  {
    name: "a single-quoted string value",
    text: "{\"a\": 'b'}",
    message: "Strings must use double quotes, not single quotes",
    offset: 6,
  },
  {
    name: "a comma where a property name should be",
    text: "{,}",
    message: "Unexpected ',': expected a property name in double quotes",
    offset: 1,
  },
  {
    name: "two commas in a row in an object",
    text: '{"a": 1,,}',
    message: "Unexpected ',': expected a property name in double quotes",
    offset: 8,
  },
  {
    name: "a line comment after a value",
    text: '{"a": 1 // note\n}',
    message: "Comments are not allowed in JSON",
    offset: 8,
  },
  {
    name: "a block comment where a value should be",
    text: "[/* x */ 1]",
    message: "Comments are not allowed in JSON",
    offset: 1,
  },
  {
    name: "a block comment where a property name should be",
    text: "{/* x */}",
    message: "Comments are not allowed in JSON",
    offset: 1,
  },
  {
    name: "a comment before the document",
    text: "// c\n{}",
    message: "Comments are not allowed in JSON",
    offset: 0,
  },
  {
    name: "a missing comma between properties",
    text: '{"a": 1 "b": 2}',
    message: "Unexpected '\"': expected ',' or '}' after a property value",
    offset: 8,
  },
  {
    name: "a missing comma between array items",
    text: "[1 2]",
    message: "Unexpected '2': expected ',' or ']' after an array item",
    offset: 3,
  },
  {
    name: "a missing colon",
    text: '{"a" 1}',
    message: "Unexpected '1': expected ':' after the property name",
    offset: 5,
  },
  {
    name: "a string where the colon should be",
    text: '{"a" "b"}',
    message: "Unexpected '\"': expected ':' after the property name",
    offset: 5,
  },
  {
    name: "an unterminated string value, blamed on its opening quote",
    text: '{"a": "abc',
    message: "This string is never closed",
    offset: 6,
  },
  {
    name: "a string ending in a lone backslash",
    text: '"abc' + BACKSLASH,
    message: "This string is never closed",
    offset: 0,
  },
  {
    name: "a line break inside a string",
    text: '{"a": "ab\ncd"}',
    message:
      "A string cannot span lines: close it, or write the line break as " +
      BACKSLASH +
      "n",
    offset: 9,
  },
  {
    name: "a carriage return inside a string",
    text: '"ab\rcd"',
    message:
      "A string cannot span lines: close it, or write the line break as " +
      BACKSLASH +
      "n",
    offset: 3,
  },
  {
    name: "a raw tab inside a string",
    text: '"a\tb"',
    message: "A tab inside a string must be written as " + BACKSLASH + "t",
    offset: 2,
  },
  {
    name: "a raw control character inside a string",
    text: '"a' + control(1) + 'b"',
    message: "Control character U+0001 must be escaped inside a string",
    offset: 2,
  },
  {
    name: "the last control character inside a string",
    text: '"a' + control(0x1f) + '"',
    message: "Control character U+001F must be escaped inside a string",
    offset: 2,
  },
  {
    name: "an escape JSON does not have",
    text: '"a' + BACKSLASH + 'x"',
    message: "'" + BACKSLASH + "x' is not a valid escape in a JSON string",
    offset: 2,
  },
  {
    name: "a unicode escape with too few digits",
    text: '"' + unicodeEscape("12") + '"',
    message: "A " + BACKSLASH + "u escape needs exactly four hex digits",
    offset: 1,
  },
  {
    name: "a unicode escape with a non-hex digit",
    text: '"' + unicodeEscape("12G4") + '"',
    message: "A " + BACKSLASH + "u escape needs exactly four hex digits",
    offset: 1,
  },
  {
    name: "a leading zero",
    text: "[01]",
    message: "A number cannot have a leading zero",
    offset: 1,
  },
  {
    name: "a leading zero after a minus, blamed on the number's start",
    text: "-01",
    message: "A number cannot have a leading zero",
    offset: 0,
  },
  {
    name: "a minus with no digits",
    text: "[-]",
    message: "Expected a digit after '-'",
    offset: 2,
  },
  {
    name: "a minus before a letter",
    text: "-a",
    message: "Expected a digit after '-'",
    offset: 1,
  },
  {
    name: "-Infinity",
    text: "-Infinity",
    message: "Expected a digit after '-'",
    offset: 1,
  },
  {
    name: "a decimal point with no digits after it",
    text: "1.",
    message: "Expected a digit after the decimal point",
    offset: 2,
  },
  {
    name: "a decimal point followed by an exponent",
    text: "[1.e5]",
    message: "Expected a digit after the decimal point",
    offset: 3,
  },
  {
    name: "an exponent with no digits",
    text: "1e",
    message: "Expected a digit in the exponent",
    offset: 2,
  },
  {
    name: "a signed exponent with no digits",
    text: "1E+",
    message: "Expected a digit in the exponent",
    offset: 3,
  },
  {
    name: "a number with a plus sign",
    text: "+1",
    message: "A number must start with a digit or '-'",
    offset: 0,
  },
  {
    name: "a number starting at the decimal point",
    text: "[.5]",
    message: "A number must start with a digit or '-'",
    offset: 1,
  },
  {
    name: "a hexadecimal number",
    text: "0x1F",
    message: "Unexpected 'x' after the end of the JSON value",
    offset: 1,
  },
  {
    name: "a capitalised true",
    text: "True",
    message:
      "Unexpected 'True': JSON's literals are lowercase true, false and null",
    offset: 0,
  },
  {
    name: "an upper-case false",
    text: "FALSE",
    message:
      "Unexpected 'FALSE': JSON's literals are lowercase true, false and null",
    offset: 0,
  },
  {
    name: "an upper-case null as a value",
    text: '{"a": NULL}',
    message:
      "Unexpected 'NULL': JSON's literals are lowercase true, false and null",
    offset: 6,
  },
  {
    name: "Python's None",
    text: "[None]",
    message:
      "Unexpected 'None': JSON's literals are lowercase true, false and null",
    offset: 1,
  },
  {
    name: "undefined",
    text: "undefined",
    message: "'undefined' is not a JSON value",
    offset: 0,
  },
  {
    name: "NaN",
    text: "[NaN]",
    message: "'NaN' is not a JSON value",
    offset: 1,
  },
  {
    name: "Infinity",
    text: '{"a": Infinity}',
    message: "'Infinity' is not a JSON value",
    offset: 6,
  },
  {
    name: "a misspelt literal",
    text: '{"a": tru}',
    message: "Unexpected 'tru': expected a value",
    offset: 6,
  },
  {
    name: "a truncated null",
    text: "nul",
    message: "Unexpected 'nul': expected a value",
    offset: 0,
  },
  {
    name: "a no-break space where a property name should be",
    text: "{" + NBSP + "}",
    message:
      "Unexpected invisible character U+00A0: expected a property name in double quotes",
    offset: 1,
  },
  {
    name: "a byte order mark before the document",
    text: BOM + "{}",
    message: "Unexpected invisible character U+FEFF: expected a value",
    offset: 0,
  },
  {
    name: "a no-break space after the document",
    text: "{}" + NBSP,
    message:
      "Unexpected invisible character U+00A0 after the end of the JSON value",
    offset: 2,
  },
  {
    name: "a zero-width space between array items",
    text: "[1," + ZERO_WIDTH_SPACE + "2]",
    message: "Unexpected invisible character U+200B: expected a value",
    offset: 3,
  },
  {
    name: "a line separator between array items",
    text: "[1," + LINE_SEPARATOR + "2]",
    message: "Unexpected invisible character U+2028: expected a value",
    offset: 3,
  },
  {
    name: "an emoji where a value should be, named whole",
    text: "[" + EMOJI + "]",
    message: "Unexpected '" + EMOJI + "': expected a value",
    offset: 1,
  },
  {
    name: "an emoji after an array item, named whole",
    text: "[1" + EMOJI + "]",
    message:
      "Unexpected '" + EMOJI + "': expected ',' or ']' after an array item",
    offset: 2,
  },
  {
    name: "text after the document",
    text: '{"a": 1} x',
    message: "Unexpected 'x' after the end of the JSON value",
    offset: 9,
  },
  {
    name: "an extra closing bracket",
    text: "[1]]",
    message: "Unexpected ']' after the end of the JSON value",
    offset: 3,
  },
  {
    name: "letters straight after a literal",
    text: "truex",
    message: "Unexpected 'x' after the end of the JSON value",
    offset: 4,
  },
  {
    name: "a second document",
    text: "{} {}",
    message: "Unexpected '{' after the end of the JSON value",
    offset: 3,
  },
  {
    name: "an object that is never closed",
    text: '{"a": 1',
    message: "Unexpected end of JSON: a closing '}' is missing",
    offset: 7,
  },
  {
    name: "an array that is never closed",
    text: "[1, 2",
    message: "Unexpected end of JSON: a closing ']' is missing",
    offset: 5,
  },
  {
    name: "an outer object that is never closed",
    text: '{"a": [1, 2]',
    message: "Unexpected end of JSON: a closing '}' is missing",
    offset: 12,
  },
  {
    name: "an empty document",
    text: "",
    message: "Unexpected end of JSON: expected a value",
    offset: 0,
  },
  {
    name: "a document of only whitespace",
    text: "   ",
    message: "Unexpected end of JSON: expected a value",
    offset: 3,
  },
  {
    name: "a property with no value at the end",
    text: '{"a":',
    message: "Unexpected end of JSON: expected a value",
    offset: 5,
  },
  {
    name: "a property name with no colon at the end",
    text: '{"a"',
    message: "Unexpected end of JSON: expected ':' after the property name",
    offset: 4,
  },
  {
    name: "a lone opening brace",
    text: "{",
    message:
      "Unexpected end of JSON: expected a property name in double quotes",
    offset: 1,
  },
  {
    name: "a lone opening bracket",
    text: "[",
    message: "Unexpected end of JSON: expected a value",
    offset: 1,
  },
  {
    name: "a comma at the end of an unfinished object",
    text: '{"a": 1,',
    message:
      "Unexpected end of JSON: expected a property name in double quotes",
    offset: 8,
  },
  {
    name: "a comma at the end of an unfinished array",
    text: "[1,",
    message: "Unexpected end of JSON: expected a value",
    offset: 3,
  },
  {
    name: "a comma before the first array item",
    text: "[,1]",
    message: "Unexpected ',': expected a value",
    offset: 1,
  },
];

describe("findJsonSyntaxError — names the mistake and where it is", () => {
  test.each(ERROR_CASES)("$name", (errorCase: ErrorCase) => {
    const error: JsonSyntaxError | null = findJsonSyntaxError(errorCase.text);

    expect(error).toEqual({
      message: errorCase.message,
      offset: errorCase.offset,
    });

    // Every case here is one JSON.parse rejects too.
    expect(parses(errorCase.text)).toBe(false);
  });

  /*
   * Regression: the trailing-content path read a single UTF-16 unit, so an
   * emoji there was named by half of its surrogate pair - an unprintable
   * character in the status bar.
   */
  test("an emoji after the end of the document is named whole, not as half a surrogate pair", () => {
    const error: JsonSyntaxError | null = findJsonSyntaxError("{}" + EMOJI);

    expect(error).toEqual({
      message: "Unexpected '" + EMOJI + "' after the end of the JSON value",
      offset: 2,
    });
  });
});

const VALID_DOCUMENTS: Array<string> = [
  "{}",
  "[]",
  " \n\t\r{ } ",
  '"a string on its own"',
  "0",
  "-0",
  "42",
  "-3.25",
  "1E+2",
  "1e-7",
  "0.5e10",
  "true",
  "false",
  "null",
  '{"a": 1, "b": [true, false, null], "c": {"d": "e"}}',
  '[[[[[]]]], {}, {"": ""}]',
  '{"a":1,"a":2}',
  '"' +
    BACKSLASH +
    '"' +
    BACKSLASH +
    BACKSLASH +
    BACKSLASH +
    "/" +
    BACKSLASH +
    "b" +
    BACKSLASH +
    "f" +
    BACKSLASH +
    "n" +
    BACKSLASH +
    "r" +
    BACKSLASH +
    't"',
  '"' + unicodeEscape("00e9") + unicodeEscape("ABCD") + '"',
  // A lone surrogate is legal in JSON text, escaped or raw.
  '"' + unicodeEscape("d800") + '"',
  '"' + String.fromCharCode(0xd800) + '"',
  '"' + LINE_SEPARATOR + String.fromCharCode(0x2029) + '"',
  '"' + EMOJI + ' é ✓ 漢字"',
  '"' + String.fromCharCode(0x7f) + '"',
  "12345678901234567890",
  "1" + "0".repeat(400),
  "[1e999999]",
  '{"deep": {"er": {"est": [1, [2, [3, [4]]]]}}}',
];

describe("findJsonSyntaxError — accepts exactly what JSON.parse accepts", () => {
  test.each(VALID_DOCUMENTS)("accepts %j", (text: string) => {
    expect(parses(text)).toBe(true);
    expect(findJsonSyntaxError(text)).toBeNull();
  });

  test("nesting 100000 levels deep does not overflow the stack", () => {
    const depth: number = 100000;

    expect(findJsonSyntaxError("[".repeat(depth) + "]".repeat(depth))).toBe(
      null,
    );
    expect(
      findJsonSyntaxError('{"a":'.repeat(depth) + "1" + "}".repeat(depth)),
    ).toBeNull();
  });

  test("an unclosed document 100000 levels deep is reported at its end", () => {
    const text: string = "[".repeat(100000);

    expect(findJsonSyntaxError(text)).toEqual({
      message: "Unexpected end of JSON: expected a value",
      offset: 100000,
    });
  });

  type RandomFunction = () => number;

  // mulberry32: small, seeded, and the same sequence on every run.
  type CreateRandomFunction = (seed: number) => RandomFunction;

  const createRandom: CreateRandomFunction = (seed: number): RandomFunction => {
    let state: number = seed >>> 0;

    return (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed: number = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  };

  type Json =
    | null
    | boolean
    | number
    | string
    | Array<Json>
    | { [key: string]: Json };

  const STRINGS: Array<string> = [
    "",
    "a",
    "hello world",
    'quote " inside',
    "back \\ slash",
    "tab\tand\nnewline",
    "unicode é ✓",
    EMOJI,
    LINE_SEPARATOR,
    "{[,:]}",
  ];

  const NUMBERS: Array<number> = [
    0,
    -1,
    3.25,
    1e21,
    Number.MAX_SAFE_INTEGER,
    0.5,
  ];

  type PickFunction = <T>(random: RandomFunction, items: Array<T>) => T;

  const pick: PickFunction = <T>(
    random: RandomFunction,
    items: Array<T>,
  ): T => {
    return items[Math.floor(random() * items.length)] as T;
  };

  type RandomValueFunction = (random: RandomFunction, depth: number) => Json;

  const randomValue: RandomValueFunction = (
    random: RandomFunction,
    depth: number,
  ): Json => {
    const roll: number = random();

    if (depth > 3 || roll < 0.35) {
      return pick<Json>(random, [
        pick(random, STRINGS),
        pick(random, NUMBERS),
        true,
        false,
        null,
      ]);
    }

    const size: number = Math.floor(random() * 5);

    if (roll < 0.7) {
      const items: Array<Json> = [];

      for (let index: number = 0; index < size; index++) {
        items.push(randomValue(random, depth + 1));
      }

      return items;
    }

    const object: { [key: string]: Json } = {};

    for (let index: number = 0; index < size; index++) {
      object[pick(random, STRINGS)] = randomValue(random, depth + 1);
    }

    return object;
  };

  const ALPHABET: Array<string> = [
    ..."{}[]\",:0123456789-+.eE tfnlrsuaxX'/",
    BACKSLASH,
    "\n",
    "\t",
    "\r",
    NBSP,
    EMOJI,
    control(2),
  ];

  type MutateFunction = (random: RandomFunction, text: string) => string;

  const mutate: MutateFunction = (
    random: RandomFunction,
    text: string,
  ): string => {
    let result: string = text;
    const mutations: number = 1 + Math.floor(random() * 3);

    for (let count: number = 0; count < mutations; count++) {
      const at: number = Math.floor(random() * (result.length + 1));
      const kind: number = random();

      if (kind < 0.34) {
        result =
          result.slice(0, at) + pick(random, ALPHABET) + result.slice(at);
      } else if (kind < 0.67) {
        result = result.slice(0, at) + result.slice(at + 1);
      } else {
        result =
          result.slice(0, at) + pick(random, ALPHABET) + result.slice(at + 1);
      }
    }

    return result;
  };

  test("agrees with JSON.parse on thousands of mutated documents", () => {
    const random: RandomFunction = createRandom(20260930);
    const disagreements: Array<string> = [];
    let validCount: number = 0;
    let invalidCount: number = 0;

    for (let iteration: number = 0; iteration < 4000; iteration++) {
      const indent: string | number = pick<string | number>(random, [
        0,
        2,
        "\t",
      ]);
      const original: string = JSON.stringify(
        randomValue(random, 0),
        null,
        indent,
      );
      const text: string = random() < 0.1 ? original : mutate(random, original);
      const expected: boolean = parses(text);
      const error: JsonSyntaxError | null = findJsonSyntaxError(text);

      if ((error === null) !== expected) {
        disagreements.push(JSON.stringify(text));
      }

      if (error) {
        invalidCount++;
        expect(error.offset).toBeGreaterThanOrEqual(0);
        expect(error.offset).toBeLessThanOrEqual(text.length);
        expect(error.message.length).toBeGreaterThan(0);
      } else {
        validCount++;
      }
    }

    expect(disagreements).toEqual([]);

    // Not vacuous: plenty of both verdicts were exercised.
    expect(validCount).toBeGreaterThan(300);
    expect(invalidCount).toBeGreaterThan(1000);
  });

  test("formatting never changes what a valid mutated document parses to", () => {
    const random: RandomFunction = createRandom(4153);
    let formattedCount: number = 0;

    for (let iteration: number = 0; iteration < 1500; iteration++) {
      const text: string = mutate(
        random,
        JSON.stringify(randomValue(random, 0)),
      );

      if (text.trim() === "" || !parses(text)) {
        expect(formatJson(text, "  ")).toBeNull();
        continue;
      }

      const formatted: string | null = formatJson(text, "  ");

      expect(formatted).not.toBeNull();
      expect(JSON.parse(formatted as string)).toEqual(JSON.parse(text));
      formattedCount++;
    }

    expect(formattedCount).toBeGreaterThan(100);
  });
});

describe("offsetToLineColumn", () => {
  const TEXT: string = "ab\ncd";

  test.each([
    [0, 1, 1],
    [1, 1, 2],
    [2, 1, 3],
    [3, 2, 1],
    [5, 2, 3],
  ])(
    "offset %i is line %i, column %i",
    (offset: number, line: number, column: number) => {
      expect(offsetToLineColumn(TEXT, offset)).toEqual({ line, column });
    },
  );

  test("clamps an offset before the start", () => {
    expect(offsetToLineColumn(TEXT, -4)).toEqual({ line: 1, column: 1 });
  });

  test("clamps an offset past the end", () => {
    expect(offsetToLineColumn(TEXT, 99)).toEqual({ line: 2, column: 3 });
  });

  test("counts empty lines", () => {
    expect(offsetToLineColumn("\n\n\nx", 3)).toEqual({ line: 4, column: 1 });
  });
});

describe("checkJsonSyntax — what it declines to judge", () => {
  test.each([undefined, null, 42, true, { a: 1 }, ["x"]])(
    "a non-string (%j) is skipped, valid",
    (value: unknown) => {
      expect(checkJsonSyntax(value)).toEqual({
        isValid: true,
        errorMessage: null,
        wasSkipped: true,
        line: null,
        column: null,
      });
    },
  );

  test.each(["", "   ", "\n\t\r\n"])(
    "an empty box (%j) is skipped",
    (value: string) => {
      const result: JsonSyntaxCheckResult = checkJsonSyntax(value);

      expect(result.isValid).toBe(true);
      expect(result.wasSkipped).toBe(true);
    },
  );

  test("a document with a {{#each}} loop is skipped, whatever else is wrong", () => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax(
      "[{{#each local.items}}{{this}},{{/each}}",
    );

    expect(result.isValid).toBe(true);
    expect(result.wasSkipped).toBe(true);
  });

  test("a valid document is checked, not skipped", () => {
    expect(checkJsonSyntax('{"a": [1, 2]}')).toEqual({
      isValid: true,
      errorMessage: null,
      wasSkipped: false,
      line: null,
      column: null,
    });
  });
});

describe("checkJsonSyntax — where a broken document breaks", () => {
  test("a trailing comma on its own line is placed by line and column", () => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax('{\n  "a": 1,\n}');

    expect(result).toEqual({
      isValid: false,
      errorMessage: "Trailing comma: remove the ',' before '}'",
      wasSkipped: false,
      line: 2,
      column: 9,
    });
  });

  /*
   * The placeholders are masked before the scan. The mask has to keep every
   * later character where it was, or the column would point at the wrong
   * place in the text the person is looking at.
   */
  test("a placeholder before the error on the same line does not shift the column", () => {
    const text: string = '{"name": "{{local.variables.name}}", "n": }';
    const result: JsonSyntaxCheckResult = checkJsonSyntax(text);
    const brace: number = text.lastIndexOf("}");

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBe("Unexpected '}': expected a value");
    expect(result.line).toBe(1);
    expect(result.column).toBe(brace + 1);
    expect(text[(result.column as number) - 1]).toBe("}");
  });

  test("a bare placeholder value before a trailing comma does not shift the column", () => {
    const text: string =
      '{\n  "retries": {{local.variables.retryCount}}, "list": [1,]\n}';
    const result: JsonSyntaxCheckResult = checkJsonSyntax(text);
    const comma: number = text.indexOf(",]");
    const lineStart: number = text.lastIndexOf("\n", comma) + 1;

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBe(
      "Trailing comma: remove the ',' before ']'",
    );
    expect(result.line).toBe(2);
    expect(result.column).toBe(comma - lineStart + 1);
  });

  test("an error on a later line is placed on that line", () => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax(
      '{\n  "a": 1,\n  "b": tru\n}',
    );

    expect(result).toEqual({
      isValid: false,
      errorMessage: "Unexpected 'tru': expected a value",
      wasSkipped: false,
      line: 3,
      column: 8,
    });
  });
});

describe("checkJsonSyntax — JSON5 fields are judged by JSON5's rules", () => {
  test.each([
    "{a: 1, b: [1, 2,], // a comment\n}",
    "{'a': 'b'}",
    "[1, 2, 3,]",
    "{a: Infinity, b: NaN, c: +1, d: .5, e: 0x1F}",
    "{a: {{local.variables.x}},}",
  ])("accepts %j", (text: string) => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax(text, {
      allowJSON5: true,
    });

    expect(result).toEqual({
      isValid: true,
      errorMessage: null,
      wasSkipped: false,
      line: null,
      column: null,
    });
    // ...which strict JSON would not.
    expect(checkJsonSyntax(text).isValid).toBe(false);
  });

  test("an error carries JSON5's line and column, without its framing", () => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax(
      "{\n  a: 1,\n  b: ]\n}",
      { allowJSON5: true },
    );

    expect(result).toEqual({
      isValid: false,
      errorMessage: "Invalid character ']'",
      wasSkipped: false,
      line: 3,
      column: 6,
    });
  });

  test("the end of input is reported where it is", () => {
    const result: JsonSyntaxCheckResult = checkJsonSyntax("{a: 1", {
      allowJSON5: true,
    });

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBe("Invalid end of input");
    expect(result.line).toBe(1);
    expect(result.column).toBe(6);
  });

  test("no message keeps JSON5's prefix or its position suffix", () => {
    for (const text of ["{a: }", "[1,,2]", "{", "{a:1}\nx", '"abc']) {
      const result: JsonSyntaxCheckResult = checkJsonSyntax(text, {
        allowJSON5: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).not.toMatch(/^JSON5/);
      expect(result.errorMessage).not.toMatch(/ at \d+:\d+$/);
      expect(result.errorMessage?.charAt(0)).toBe(
        result.errorMessage?.charAt(0).toUpperCase(),
      );
      expect(result.line).not.toBeNull();
      expect(result.column).not.toBeNull();
    }
  });
});

/*
 * The status bar's verdict and the form's must never differ. Both are asked
 * about the same corpus, in both modes.
 */
const AGREEMENT_CORPUS: Array<unknown> = [
  undefined,
  null,
  42,
  true,
  { a: 1 },
  ["x"],
  "",
  "   ",
  "\n\t",
  "{}",
  "[]",
  '{"a": 1}',
  '{"a": 1,}',
  "{a: 1}",
  "[1, 2,]",
  "{'a': 1}",
  "// c\n{}",
  '{"n": {{x}}}',
  '{"s": "{{x}}"}',
  '{"{{x}}": 2}',
  '{"n": {{x}}5}',
  '{"n": 5{{x}}}',
  '{"n": -{{x}}}',
  '{"n": 1.{{x}}}',
  '{"n": {{x}}.5}',
  '{"n": 0{{x}}}',
  '{"n": 1e{{x}}}',
  "[{{a}}, {{b}}]",
  '{"n": {{x}}',
  "{{x}}",
  "{{x}} {{y}}",
  '"{{x}}"',
  "{{}}",
  "{{{x}}}",
  '{"a": {{x}} "b": 1}',
  '{"a": {{x}},}',
  "true{{x}}",
  "{{x}}true",
  '"' + BACKSLASH + '{{x}}"',
  '{{#each items}}{"a": 1},{{/each}}',
  "[{{#each local.items}}{{this}},{{/each}}]",
  '{"a": {{/each}}}',
  "{a: 1, b: [1, 2,], // c\n}",
  "{'a': 'b'}",
  "{a: Infinity}",
  "{a: .5}",
  "{a: +1}",
  "{a: 0x1F}",
  "{a: 0x{{x}}}",
  "[1, 2, 3,]",
  '{"a": "' + EMOJI + '"}',
  "{" + NBSP + "}",
];

describe("checkJsonSyntax agrees with the form's checkJSONSyntax", () => {
  for (const allowJSON5 of [false, true]) {
    test.each(AGREEMENT_CORPUS)(
      `on %j (allowJSON5: ${String(allowJSON5)})`,
      (value: unknown) => {
        const ours: JsonSyntaxCheckResult = checkJsonSyntax(value, {
          allowJSON5,
        });
        const theirs: JSONSyntaxCheckResult = checkJSONSyntax(value, {
          allowJSON5,
        });

        expect({ isValid: ours.isValid, wasSkipped: ours.wasSkipped }).toEqual({
          isValid: theirs.isValid,
          wasSkipped: theirs.wasSkipped,
        });

        // A verdict of invalid always says where.
        if (!ours.isValid) {
          expect(ours.errorMessage).not.toBeNull();
          expect(ours.line).not.toBeNull();
          expect(ours.column).not.toBeNull();
        }
      },
    );
  }

  /*
   * Regression: this module used to mask {{x}} as a run of "1"s as long as
   * the expression, where checkJSONSyntax uses one "1". Inside a \u escape
   * that run supplied the hex digits the single "1" does not, so the status
   * bar said "Valid JSON" while Save was blocked.
   */
  test.each(["{{code}}", "{{x}}", "{{}}"])(
    "a placeholder completing a \\u escape (%s) gets the form's verdict",
    (placeholder: string) => {
      for (const prefix of ["", "0", "00"]) {
        const text: string =
          '{"s": "' + BACKSLASH + "u" + prefix + placeholder + '"}';

        expect(checkJsonSyntax(text).isValid).toBe(
          checkJSONSyntax(text).isValid,
        );
      }
    },
  );
});

describe("describeJsonSyntaxError", () => {
  test("names the line and column when both are known", () => {
    expect(
      describeJsonSyntaxError({
        isValid: false,
        errorMessage: "Trailing comma: remove the ',' before '}'",
        wasSkipped: false,
        line: 4,
        column: 12,
      }),
    ).toBe("Trailing comma: remove the ',' before '}' (line 4, column 12)");
  });

  test("names only the line when the column is unknown", () => {
    expect(
      describeJsonSyntaxError({
        isValid: false,
        errorMessage: "Invalid character 'x'",
        wasSkipped: false,
        line: 3,
        column: null,
      }),
    ).toBe("Invalid character 'x' (line 3)");
  });

  test("is just the reason without a position", () => {
    expect(
      describeJsonSyntaxError({
        isValid: false,
        errorMessage: "Something",
        wasSkipped: false,
        line: null,
        column: null,
      }),
    ).toBe("Something");
  });

  test("falls back to a generic reason", () => {
    expect(
      describeJsonSyntaxError({
        isValid: false,
        errorMessage: null,
        wasSkipped: false,
        line: null,
        column: null,
      }),
    ).toBe("Invalid JSON");
  });

  test("describes a real check result end to end", () => {
    expect(describeJsonSyntaxError(checkJsonSyntax("[1,\n 2,\n]"))).toBe(
      "Trailing comma: remove the ',' before ']' (line 2, column 3)",
    );
  });
});

const ORDINARY_DOCUMENTS: Array<string> = [
  '{"name":"api","retries":3,"tags":["a","b"],"nested":{"on":true,"off":false,"none":null},"list":[{"x":1},{"y":[]}],"empty":{}}',
  '[1,2,[3,[4,{}]],"five"]',
  '{ "a" : { } , "b" : [ ] }',
  '"just a string"',
  "42",
  "true",
  "null",
  "[]",
  "{}",
  '{\n\n  "spaced"  :\t[ 1 ,\r\n 2 ]\n}',
  '{"text":"with, commas: and {braces} [brackets]","quote":"a ' +
    BACKSLASH +
    '"b' +
    BACKSLASH +
    '" c"}',
  '[[],[[]],{"a":{"b":{}}}]',
];

describe("formatJson — pretty-prints like JSON.stringify", () => {
  for (const indent of ["  ", "    ", "\t"]) {
    test.each(ORDINARY_DOCUMENTS)(
      `formats %j with ${JSON.stringify(indent)}`,
      (text: string) => {
        expect(formatJson(text, indent)).toBe(
          JSON.stringify(JSON.parse(text), null, indent),
        );
      },
    );
  }

  test("keeps empty containers on one line, even with whitespace inside", () => {
    expect(formatJson('{"a": {  }, "b": [\n]}', "  ")).toBe(
      '{\n  "a": {},\n  "b": []\n}',
    );
  });

  test("is idempotent", () => {
    for (const text of ORDINARY_DOCUMENTS) {
      const once: string = formatJson(text, "  ") as string;

      expect(formatJson(once, "  ")).toBe(once);
    }
  });

  test("formats a document nested a thousand levels deep", () => {
    const text: string = "[".repeat(1000) + "1" + "]".repeat(1000);
    const formatted: string | null = formatJson(text, " ");

    expect(formatted).not.toBeNull();
    expect(JSON.parse(formatted as string)).toEqual(JSON.parse(text));
  });
});

describe("formatJson — never changes what the document says", () => {
  const DOCUMENT: string =
    '{"id":12345678901234567890,"ratio":1.0,"big":1e3,"zero":-0,"s":"' +
    unicodeEscape("00e9") +
    '","slash":"a' +
    BACKSLASH +
    '/b","d":1,"d":2}';

  test("every scalar survives byte for byte", () => {
    expect(formatJson(DOCUMENT, "  ")).toBe(
      "{\n" +
        '  "id": 12345678901234567890,\n' +
        '  "ratio": 1.0,\n' +
        '  "big": 1e3,\n' +
        '  "zero": -0,\n' +
        '  "s": "' +
        unicodeEscape("00e9") +
        '",\n' +
        '  "slash": "a' +
        BACKSLASH +
        '/b",\n' +
        '  "d": 1,\n' +
        '  "d": 2\n' +
        "}",
    );
  });

  // The round trip Format deliberately avoids, for contrast.
  test("which JSON.stringify(JSON.parse()) would not have kept", () => {
    const roundTrip: string = JSON.stringify(JSON.parse(DOCUMENT), null, 2);

    expect(roundTrip).not.toContain("12345678901234567890");
    expect(roundTrip).not.toContain("1.0");
    expect(roundTrip).not.toContain(unicodeEscape("00e9"));
    expect(roundTrip.match(/"d"/g)?.length).toBe(1);

    const formatted: string = formatJson(DOCUMENT, "  ") as string;

    expect(formatted).toContain("12345678901234567890");
    expect(formatted).toContain("1.0");
    expect(formatted).toContain(unicodeEscape("00e9"));
    expect(formatted.match(/"d"/g)?.length).toBe(2);
  });

  test("placeholders inside strings survive", () => {
    expect(formatJson('{"to":"{{local.variables.email}}"}', "  ")).toBe(
      '{\n  "to": "{{local.variables.email}}"\n}',
    );
  });

  test.each([
    ["an empty document", ""],
    ["a document of whitespace", "  \n "],
    ["a trailing comma", '{"a": 1,}'],
    ["JSON5 that strict JSON rejects", "{a: 1}"],
    ["an unquoted placeholder", '{"n": {{x}}}'],
    ["a truncated document", '{"a": [1, 2'],
  ])("returns null for %s", (_name: string, text: string) => {
    expect(formatJson(text, "  ")).toBeNull();
  });
});
