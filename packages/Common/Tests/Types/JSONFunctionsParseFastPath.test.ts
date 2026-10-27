import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import JSON5 from "json5";
import JSONFunctions from "../../Types/JSONFunctions";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { fastestRun, FastestRun } from "../Helpers/FastestRun";

/*
 * JSONFunctions.parse READS JSON WITH JSON.parse, AND THE REST WITH JSON5.
 *
 * Every signed-in API request reads its token's payload through
 * JSONFunctions.parse, and so does every GlobalCache read: JSON5's parser,
 * written in JavaScript, took 19 microseconds for a token's 175 characters,
 * the engine's own JSON.parse 0.7 (Node 26, 2026-10-27). Text that is JSON -
 * nearly all of it - now goes to JSON.parse; anything JSON.parse refuses
 * goes to JSON5.parse exactly as before, so JSON5's own syntax (comments,
 * unquoted keys, single quotes, trailing commas, hexadecimal, Infinity) and
 * its errors are what they were.
 *
 * That is only the same as before if JSON5 reads every JSON text the way
 * JSON.parse does - which JSON5's grammar, a superset of JSON's, says it
 * does. These tests hold the two to it, value by value: the same types,
 * the same own keys in the same order with the same flags (a "__proto__"
 * key is an ordinary own property in both, never the prototype), -0 kept
 * apart from 0, lone surrogates kept; for generated texts with duplicate
 * keys, every number form, escapes and whitespace, and for the installed
 * json5 rather than a copy of its rules. One thing does change: JSON5
 * printed a console warning for a raw U+2028 or U+2029 in a string, which
 * is valid JSON; JSON.parse reads it without one.
 */

// A value written out with everything a parse decides: no two differ unless the values do.
const canonical: (value: unknown) => string = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return Object.is(value, -0) ? "number:-0" : `number:${String(value)}`;
  }

  if (typeof value === "string") {
    return `string:${JSON.stringify(value)}`;
  }

  if (typeof value !== "object") {
    return `${typeof value}:${String(value)}`;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  const kind: string =
    prototype === Array.prototype
      ? "Array"
      : prototype === Object.prototype
        ? "Object"
        : "other";
  const members: Array<string> = Reflect.ownKeys(
    value as Record<string, unknown>,
  ).map((key: string | symbol): string => {
    const descriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
      value as Record<string, unknown>,
      key,
    ) as PropertyDescriptor;
    const flags: string = [
      descriptor.writable ? "w" : "-",
      descriptor.enumerable ? "e" : "-",
      descriptor.configurable ? "c" : "-",
    ].join("");

    return `${String(key)}[${flags}]=${
      "value" in descriptor ? canonical(descriptor.value) : "accessor"
    }`;
  });

  return `${kind}{${members.join(",")}}`;
};

// What a parse gave: its value written out, or its error's class and message.
const outcomeOf: (parse: () => unknown) => string = (
  parse: () => unknown,
): string => {
  try {
    return `value ${canonical(parse())}`;
  } catch (error) {
    return `throws ${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
};

const NUMBERS: Array<string> = [
  "0",
  "-0",
  "1",
  "-1",
  "0.1",
  "1.5",
  "-2.25e-3",
  "1e400",
  "-1e400",
  "1e-400",
  "-0.0",
  "1E5",
  "1e+5",
  "123456789012345678901234567890",
  "9007199254740993",
  "2.2250738585072014e-308",
  "5e-324",
  "1.7976931348623157e308",
  "0.30000000000000004",
];

const STRING_PIECES: Array<string> = [
  "a",
  "Z",
  " ",
  "é",
  "ключ",
  "😀",
  '\\"',
  "\\\\",
  "\\/",
  "\\b",
  "\\f",
  "\\n",
  "\\r",
  "\\t",
  "\\u0000",
  "\\u00e9",
  "\\ud83d\\ude00",
  "\\ud800",
  "\\udfff",
  "\\u2028",
  "\u2028",
  "\u2029",
  "\u00a0",
  "\ufeff",
];

const KEYS: Array<string> = [
  "a",
  "b",
  "",
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "0",
  "1",
  "10",
  "-1",
  "01",
  "4294967295",
  "length",
  "ключ",
  "😀",
  "\\u005f_proto__",
];

const WHITESPACE: Array<string> = ["", "", " ", "\t", "\n", "\r", "  \n "];

const pick: <T>(random: SeededRandom, items: Array<T>) => T = <T>(
  random: SeededRandom,
  items: Array<T>,
): T => {
  return items[random(items.length)] as T;
};

const stringText: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  const pieces: Array<string> = [];
  const count: number = random(5);

  for (let index: number = 0; index < count; index++) {
    pieces.push(pick(random, STRING_PIECES));
  }

  return `"${pieces.join("")}"`;
};

// A JSON text, built as text so it can hold what JSON.stringify never writes: duplicate keys, -0, 1e400, odd whitespace.
const jsonText: (random: SeededRandom, depth: number) => string = (
  random: SeededRandom,
  depth: number,
): string => {
  const space: () => string = (): string => {
    return pick(random, WHITESPACE);
  };
  const choice: number = random(depth > 0 ? 8 : 5);

  if (choice === 0) {
    return pick(random, NUMBERS);
  }

  if (choice === 1) {
    return stringText(random);
  }

  if (choice === 2) {
    return pick(random, ["true", "false", "null"]);
  }

  if (choice === 3) {
    return String((random() - 0.5) * 10 ** random(12));
  }

  if (choice === 4) {
    return String(random(1000000) - 500000);
  }

  if (choice === 5) {
    const items: Array<string> = [];
    const count: number = random(5);

    for (let index: number = 0; index < count; index++) {
      items.push(space() + jsonText(random, depth - 1) + space());
    }

    return `[${items.join(",")}${count === 0 ? space() : ""}]`;
  }

  const members: Array<string> = [];
  const count: number = random(6);

  for (let index: number = 0; index < count; index++) {
    const key: string =
      random(4) === 0 ? stringText(random) : `"${pick(random, KEYS)}"`;
    members.push(
      `${space()}${key}${space()}:${space()}${jsonText(random, depth - 1)}${space()}`,
    );
  }

  return `{${members.join(",")}${count === 0 ? space() : ""}}`;
};

describe("JSONFunctions.parse reads JSON with JSON.parse and the rest with JSON5", () => {
  let warn: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  test("every generated JSON text reads as JSON5 read it, without JSON5", () => {
    const random: SeededRandom = seededRandom(5381);
    const json5Parse: jest.SpiedFunction<typeof JSON5.parse> = jest.spyOn(
      JSON5,
      "parse",
    );
    let compared: number = 0;

    for (let index: number = 0; index < 4000; index++) {
      const text: string =
        pick(random, WHITESPACE) +
        jsonText(random, 4) +
        pick(random, WHITESPACE);

      // Each text is JSON: the new path reads it with JSON.parse alone.
      expect((): unknown => {
        return JSON.parse(text);
      }).not.toThrow();

      json5Parse.mockClear();
      const parsed: string = outcomeOf((): unknown => {
        return JSONFunctions.parse(text);
      });
      expect(json5Parse).not.toHaveBeenCalled();

      // The spy calls JSON5's own parse through.
      const expected: string = outcomeOf((): unknown => {
        return JSON5.parse(text);
      });

      if (parsed !== expected) {
        // The text that differs, in the failure.
        expect({ text, parsed }).toEqual({ text, parsed: expected });
      }

      compared++;
    }

    expect(compared).toBe(4000);
  });

  test("the cases that tell parsers apart read the same", () => {
    const texts: Array<string> = [
      '{"__proto__":{"polluted":true}}',
      '{"__proto__":1,"__proto__":2}',
      '{"a":1,"b":2,"a":3}',
      '{"b":1,"a":2,"1":3,"0":4}',
      '{"constructor":{"prototype":{"x":1}}}',
      "-0",
      "[-0,0,-0.0]",
      "1e400",
      '"\\ud800"',
      '"\\udc00\\ud800"',
      '"\u2028\u2029"',
      '{"a":[{"b":[{"c":[]}]}]}',
      "[" + "[".repeat(2000) + "]".repeat(2000) + "]",
      '"' + "x".repeat(100000) + '"',
      '{"exp":1767225600,"iat":1767222000,"userId":"0d2f3e6b-1c3f-4b6a-9f0e-0b5a7f1e2c3d","email":"a@example.com","isMasterAdmin":false}',
    ];

    for (const text of texts) {
      expect(
        outcomeOf((): unknown => {
          return JSONFunctions.parse(text);
        }),
      ).toBe(
        outcomeOf((): unknown => {
          return JSON5.parse(text);
        }),
      );
    }

    // "__proto__" stays an own key and never becomes the prototype.
    const parsed: unknown = JSONFunctions.parse(
      '{"__proto__":{"polluted":true}}',
    );
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed as Record<string, unknown>)).toEqual([
      "__proto__",
    ]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("JSON5's own syntax still reads with JSON5, to the same values", () => {
    const json5Parse: jest.SpiedFunction<typeof JSON5.parse> = jest.spyOn(
      JSON5,
      "parse",
    );
    const texts: Array<string> = [
      "{ a: 1 }",
      "{ 'a': 'b' }",
      "[1, 2, 3,]",
      '{ "a": 1, }',
      '// a comment\n{ "a": 1 }',
      "/* a comment */ [1]",
      "0x1F",
      "+1",
      ".5",
      "5.",
      "Infinity",
      "-Infinity",
      "NaN",
      "'multi\\\nline'",
      "'\\x41\\v'",
      "\u00a0{\ufeff}",
      "{ $id: 1, _x: 2, ünï: 3 }",
      "{ a: { b: [ { c: 'd', }, ], }, }",
    ];

    for (const text of texts) {
      json5Parse.mockClear();
      const parsed: string = outcomeOf((): unknown => {
        return JSONFunctions.parse(text);
      });
      expect(json5Parse).toHaveBeenCalledTimes(1);

      expect(parsed).toBe(
        outcomeOf((): unknown => {
          return JSON5.parse(text);
        }),
      );
      expect(parsed.startsWith("value ")).toBe(true);
    }
  });

  test("what neither reads fails with JSON5's error, as before", () => {
    const texts: Array<string> = [
      "",
      " ",
      "{",
      "[1,",
      "{a:}",
      "undefined",
      "'abc",
      "/* unterminated",
      '{"a" 1}',
      '"\\x"',
      "01",
      "[1 2]",
      "\u0000",
      '"line\nbreak"',
    ];

    for (const text of texts) {
      const parsed: string = outcomeOf((): unknown => {
        return JSONFunctions.parse(text);
      });

      expect(parsed).toBe(
        outcomeOf((): unknown => {
          return JSON5.parse(text);
        }),
      );
      expect(parsed.startsWith("throws ")).toBe(true);
    }
  });

  test("a value that is not a string reads as JSON5 read it", () => {
    const values: Array<unknown> = [
      42,
      -0,
      null,
      undefined,
      true,
      {},
      [],
      [1, 2],
      Buffer.from('{"a":1}'),
      new String('{"a":1}'),
    ];

    for (const value of values) {
      expect(
        outcomeOf((): unknown => {
          return JSONFunctions.parse(value as string);
        }),
      ).toBe(
        outcomeOf((): unknown => {
          return JSON5.parse(value as string);
        }),
      );
    }
  });

  test("a raw line or paragraph separator in a string no longer prints JSON5's warning", () => {
    expect(JSONFunctions.parse('{"a":"x\u2028y\u2029z"}')).toEqual({
      a: "x\u2028y\u2029z",
    });
    expect(warn).not.toHaveBeenCalled();

    JSON5.parse('{"a":"x\u2028y"}');
    expect(warn).toHaveBeenCalled();
  });

  test("a token payload reads faster than JSON5 read it", () => {
    const payloads: Array<string> = [];

    for (let index: number = 0; index < 2000; index++) {
      payloads.push(
        JSON.stringify({
          userId: `0d2f3e6b-1c3f-4b6a-9f0e-${String(index).padStart(12, "0")}`,
          email: `person-${index}@example.com`,
          name: `Person ${index}`,
          isMasterAdmin: false,
          sessionId: `5b1c-${index}`,
          iat: 1767222000 + index,
          exp: 1767225600 + index,
        }),
      );
    }

    const read: (parse: (text: string) => unknown) => number = (
      parse: (text: string) => unknown,
    ): number => {
      let keys: number = 0;

      for (let round: number = 0; round < 4; round++) {
        for (const payload of payloads) {
          keys += Object.keys(parse(payload) as Record<string, unknown>).length;
        }
      }

      return keys;
    };

    // Warm both up first, then time the two against each other.
    read((text: string): unknown => {
      return JSONFunctions.parse(text);
    });
    read((text: string): unknown => {
      return JSON5.parse(text);
    });

    const fast: FastestRun<number> = fastestRun({
      run: (): number => {
        return read((text: string): unknown => {
          return JSONFunctions.parse(text);
        });
      },
      limitInMs: 0,
    });
    const slow: FastestRun<number> = fastestRun({
      run: (): number => {
        return read((text: string): unknown => {
          return JSON5.parse(text);
        });
      },
      limitInMs: 0,
    });

    expect(fast.result).toBe(slow.result);
    expect(fast.inMs).toBeLessThan(slow.inMs / 2);
  });
});
