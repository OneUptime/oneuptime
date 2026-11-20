import { describe, expect, test } from "@jest/globals";
import JsonElementCounter, {
  JsonElementCount,
  JsonElementCountOutcome,
  JsonElementLimit,
  JsonElementLimits,
  JsonElementTally,
  JsonElementTallyCount,
  JsonValueBudget,
} from "../../Utils/JsonElementCount";

/*
 * A JSON body's values, counted before it is parsed: the count the
 * compatible endpoints hold a JSON body to, so a small body that parses
 * into millions of objects is refused before it takes the memory. The
 * count must be at least what JSON.parse makes - checked here against
 * JSON.parse's own result for generated documents, strings full of quotes,
 * escapes and brackets among them - and must stop at the limit.
 */

const MIB: number = 1024 * 1024;

const count: (text: string, limit?: number) => JsonElementCount = (
  text: string,
  limit?: number,
): JsonElementCount => {
  return JsonElementCounter.count(text, limit ?? Number.MAX_SAFE_INTEGER);
};

// What JSON.parse made of a document: every value, and every key.
const parsedValues: (value: unknown) => number = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item: unknown): number => {
      return sum + parsedValues(item);
    }, 1);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce(
      (sum: number, item: unknown): number => {
        return sum + 1 + parsedValues(item);
      },
      1,
    );
  }

  return 1;
};

// A deterministic stream of numbers, so a failing case can be run again.
const random: (seed: number) => () => number = (
  seed: number,
): (() => number) => {
  let state: number = seed;

  return (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

// Text that is hard to step over: quotes, escapes, brackets, commas, colons.
const TRICKY_CHARACTERS: ReadonlyArray<string> = [
  '"',
  "\\",
  "{",
  "}",
  "[",
  "]",
  ",",
  ":",
  " ",
  "\n",
  "\t",
  "é",
  "😀",
  "a",
  "1",
  "\u0000",
  "\u2028",
];

const generate: (next: () => number, depth: number) => unknown = (
  next: () => number,
  depth: number,
): unknown => {
  const kind: number = Math.floor(next() * (depth > 3 ? 5 : 7));

  if (kind === 0) {
    let text: string = "";
    const length: number = Math.floor(next() * 12);

    for (let index: number = 0; index < length; index++) {
      text += TRICKY_CHARACTERS[Math.floor(next() * TRICKY_CHARACTERS.length)]!;
    }

    return text;
  }

  if (kind === 1) {
    return Math.floor(next() * 2000) - 1000;
  }

  if (kind === 2) {
    return (next() - 0.5) * 1e-30;
  }

  if (kind === 3) {
    return next() < 0.5;
  }

  if (kind === 4) {
    return null;
  }

  if (kind === 5) {
    return Array.from({ length: Math.floor(next() * 5) }, (): unknown => {
      return generate(next, depth + 1);
    });
  }

  const object: Record<string, unknown> = {};
  const keys: number = Math.floor(next() * 5);

  for (let index: number = 0; index < keys; index++) {
    object[`k${index}${String(generate(next, 99))}`] = generate(
      next,
      depth + 1,
    );
  }

  return object;
};

describe("JsonElementCounter.count", () => {
  test("counts every object, array, string, key, number, true, false and null", () => {
    // {} "a" [] 1 -2.5e3 "x" true false null {} [] "b" {}
    expect(
      count('{"a": [1, -2.5e3, "x", true, false, null, {}, []], "b": {}}'),
    ).toEqual({ outcome: JsonElementCountOutcome.Counted, elements: 13 });
    expect(count("[]").elements).toBe(1);
    expect(count('""').elements).toBe(1);
    expect(count("  7  ").elements).toBe(1);
  });

  test("equals what JSON.parse makes, over many generated documents, compact and indented", () => {
    const next: () => number = random(9001);

    for (let run: number = 0; run < 500; run++) {
      const document: unknown = generate(next, 0);
      const expected: number = parsedValues(
        JSON.parse(JSON.stringify(document)),
      );

      expect({
        run,
        elements: count(JSON.stringify(document)).elements,
      }).toEqual({ run, elements: expected });
      expect({
        run,
        elements: count(JSON.stringify(document, null, 2)).elements,
      }).toEqual({ run, elements: expected });
    }
  });

  test("a string's quotes, escapes and brackets end nothing", () => {
    for (const value of [
      'say "hi"',
      "C:\\logs\\",
      "\\",
      '\\"',
      '\\\\"',
      "{[,:]}",
      "}}}]]]",
      '"',
      "",
    ]) {
      const text: string = JSON.stringify([value, { [value]: value }]);

      expect({ value, elements: count(text).elements }).toEqual({
        value,
        elements: 5,
      });
    }
  });

  test("stops at the first value past the limit, without reading on", () => {
    expect(count("[1,2,3,4,5,6]", 3)).toEqual({
      outcome: JsonElementCountOutcome.OverLimit,
      elements: 4,
    });
    expect(count("[1,2,3]", 4)).toEqual({
      outcome: JsonElementCountOutcome.Counted,
      elements: 4,
    });
    // A string at the limit, too.
    expect(count('["a","b"]', 2).outcome).toBe(
      JsonElementCountOutcome.OverLimit,
    );
  });

  test("counts documents one after another - Splunk's concatenated events, NDJSON - as one body", () => {
    expect(count('{"a":1}{"b":2}').elements).toBe(6);
    expect(count('{"a":1}\n{"b":[2]}\n').elements).toBe(7);
  });

  test("counts only the range it is given", () => {
    const text: string = 'xxx["a",1]yyy';

    expect(JsonElementCounter.count(text, 100, 3, 10).elements).toBe(3);
  });

  test("text that is not JSON is counted as far as it looks like some", () => {
    // An unterminated string ends the count.
    expect(count('[1, "never closed, [[[[').elements).toBe(3);
    // A bare word is one value; JSON.parse refuses it afterwards.
    expect(count("not json").elements).toBe(2);
    expect(count("").elements).toBe(0);
  });

  test("32 MiB of empty arrays is counted to the limit in well under a second", () => {
    const bomb: string = "[" + "[],".repeat(Math.floor((32 * MIB) / 3)) + "[]]";
    const started: number = Date.now();

    const result: JsonElementCount = count(bomb, 1000000);

    expect(result).toEqual({
      outcome: JsonElementCountOutcome.OverLimit,
      elements: 1000001,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("an 8 MiB body of real log lines is counted whole in well under a second", () => {
    const entry: string = `["1700000000000000000","${"GET /checkout 200 ".repeat(5)}"],`;
    const body: string = `{"streams":[{"stream":{"app":"checkout"},"values":[${entry.repeat(
      Math.floor((8 * MIB) / entry.length),
    )}["1","a"]]}]}`;
    const started: number = Date.now();

    expect(count(body).elements).toBe(parsedValues(JSON.parse(body)));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("says what was refused", () => {
    expect(JsonElementCounter.tooManyValuesMessage(1000000)).toBe(
      "The request holds more than 1000000 JSON values (objects, arrays, strings and numbers).",
    );
  });
});

describe("JsonValueBudget", () => {
  test("is one limit for every document of a request", () => {
    const budget: JsonValueBudget = new JsonValueBudget(5);

    expect(budget.take('{"a":1}')).toBe(true);
    expect(budget.take("[1]")).toBe(true);
    // 3 + 2 taken: the next value is the sixth.
    expect(budget.take("1")).toBe(false);
    expect(budget.limit).toBe(5);
  });

  test("a single document over the limit is refused on its own", () => {
    expect(new JsonValueBudget(2).take("[1,2]")).toBe(false);
    expect(new JsonValueBudget(3).take("[1,2]")).toBe(true);
  });
});

/*
 * The same count over the UTF-8 bytes a body arrives as, fed whole or a
 * piece at a time (#10183): StartServer counts a body before body-parser
 * decodes it, and a gzip body as it inflates.
 */

const NO_LIMIT: JsonElementLimits = {
  values: Number.MAX_SAFE_INTEGER,
  objectsArraysAndStrings: Number.MAX_SAFE_INTEGER,
};

// What JSON.parse made of a document that is an object, array or string.
const parsedObjectsArraysAndStrings: (value: unknown) => number = (
  value: unknown,
): number => {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item: unknown): number => {
      return sum + parsedObjectsArraysAndStrings(item);
    }, 1);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce(
      (sum: number, item: unknown): number => {
        // The key is a string too.
        return sum + 1 + parsedObjectsArraysAndStrings(item);
      },
      1,
    );
  }

  return typeof value === "string" ? 1 : 0;
};

// The tally of bytes fed in pieces cut at the given offsets.
const tallyInPieces: (
  bytes: Buffer,
  cuts: Array<number>,
  limits?: JsonElementLimits,
) => JsonElementTallyCount = (
  bytes: Buffer,
  cuts: Array<number>,
  limits?: JsonElementLimits,
): JsonElementTallyCount => {
  const tally: JsonElementTally = new JsonElementTally(limits || NO_LIMIT);
  let start: number = 0;

  for (const cut of [...cuts, bytes.length]) {
    // Each piece its own Buffer, as a socket or an inflate hands them on.
    if (!tally.add(Buffer.from(bytes.subarray(start, cut)))) {
      break;
    }

    start = cut;
  }

  return tally.getCount();
};

describe("JsonElementTally over bytes", () => {
  test("counts what the text counts, over many generated documents with characters beyond ASCII", () => {
    const next: () => number = random(4242);

    for (let run: number = 0; run < 500; run++) {
      const document: unknown = generate(next, 0);

      for (const text of [
        JSON.stringify(document),
        JSON.stringify(document, null, 2),
      ]) {
        const bytes: Buffer = Buffer.from(text, "utf8");
        const count: JsonElementTallyCount = JsonElementCounter.countBytes(
          bytes,
          NO_LIMIT,
        );
        const parsed: unknown = JSON.parse(text);

        expect({ run, values: count.values }).toEqual({
          run,
          values: parsedValues(parsed),
        });
        expect({ run, values: count.objectsArraysAndStrings }).toEqual({
          run,
          values: parsedObjectsArraysAndStrings(parsed),
        });
        expect(count.passed).toBeNull();
        expect(JsonElementCounter.countText(text, NO_LIMIT)).toEqual(count);
      }
    }
  });

  test("gives the same count wherever the bytes are cut: in a string, an escape, a number or a character", () => {
    const text: string = JSON.stringify({
      quote: 'a "quoted" \\ word\\',
      escapes: '\\\\\\"\\\\',
      brackets: "{[,:]}",
      emoji: "😀é東京",
      numbers: [-12.5e3, 0, 7, true, false, null],
      nested: [{}, [], [[]], { a: [1, "2", { b: null }] }],
    });
    const bytes: Buffer = Buffer.from(text, "utf8");
    const whole: JsonElementTallyCount = JsonElementCounter.countBytes(
      bytes,
      NO_LIMIT,
    );

    expect(whole.values).toBe(parsedValues(JSON.parse(text)));

    // Cut once at every byte, and into pieces of every size up to 7.
    for (let cut: number = 0; cut <= bytes.length; cut++) {
      expect({ cut, count: tallyInPieces(bytes, [cut]) }).toEqual({
        cut,
        count: whole,
      });
    }

    for (let size: number = 1; size <= 7; size++) {
      const cuts: Array<number> = [];

      for (let at: number = size; at < bytes.length; at += size) {
        cuts.push(at);
      }

      expect({ size, count: tallyInPieces(bytes, cuts) }).toEqual({
        size,
        count: whole,
      });
    }
  });

  test("a run of backslashes cut between pieces escapes, or does not escape, the quote after it", () => {
    // "a\"b" is one string, a"b, then the number 1.
    const escaped: Buffer = Buffer.from('["a\\"b",1]');
    // "a\\" ends the string a\ : then a string b and the number 1.
    const notEscaped: Buffer = Buffer.from('["a\\\\","b",1]');

    for (let cut: number = 0; cut <= escaped.length; cut++) {
      expect({ cut, values: tallyInPieces(escaped, [cut]).values }).toEqual({
        cut,
        values: 3,
      });
    }

    for (let cut: number = 0; cut <= notEscaped.length; cut++) {
      expect({ cut, values: tallyInPieces(notEscaped, [cut]).values }).toEqual({
        cut,
        values: 4,
      });
    }

    // A long run, every backslash in a piece of its own.
    const longRun: Buffer = Buffer.from(`["${"\\\\".repeat(5)}",1]`);
    const cuts: Array<number> = [];

    for (let at: number = 1; at < longRun.length; at++) {
      cuts.push(at);
    }

    expect(parsedValues(JSON.parse(longRun.toString()))).toBe(3);
    expect(tallyInPieces(longRun, cuts).values).toBe(3);
  });

  test("stops at the first value past either limit, and reads nothing more", () => {
    const tally: JsonElementTally = new JsonElementTally({
      values: 5,
      objectsArraysAndStrings: 2,
    });

    // [ and "a" are two: {} is the third object, array or string.
    expect(tally.add(Buffer.from('[1,2,"a",{}]'))).toBe(false);
    expect(tally.getCount()).toEqual({
      values: 5,
      objectsArraysAndStrings: 3,
      passed: JsonElementLimit.ObjectsArraysAndStrings,
    });
    expect(tally.add(Buffer.from("[]"))).toBe(false);
    expect(tally.getCount().values).toBe(5);

    expect(
      JsonElementCounter.countBytes(Buffer.from("[1,2,3,4,5,6]"), {
        values: 5,
        objectsArraysAndStrings: 100,
      }),
    ).toEqual({
      values: 6,
      objectsArraysAndStrings: 1,
      passed: JsonElementLimit.Values,
    });
  });

  test("a file sent as JSON - one number a byte - holds millions of values but few objects, arrays and strings", () => {
    const file: Buffer = Buffer.alloc(2 * MIB);

    for (let index: number = 0; index < file.length; index++) {
      file[index] = (index * 7919) % 256;
    }

    // What BaseModel.toJSON and JSON.stringify make of a File's Buffer.
    const body: Buffer = Buffer.from(
      JSON.stringify({
        data: {
          name: "outage.png",
          file: { _type: "Buffer", value: file.toJSON() },
          fileType: "image/png",
        },
        miscDataProps: {},
      }),
    );

    const count: JsonElementTallyCount = JsonElementCounter.countBytes(body, {
      values: body.length,
      objectsArraysAndStrings: 1000,
    });

    expect(count.passed).toBeNull();
    expect(count.values).toBeGreaterThan(file.length);
    expect(count.objectsArraysAndStrings).toBeLessThan(20);
  });

  test("50 MiB of empty arrays is refused at a million values in milliseconds, before most of it is read", () => {
    const bomb: Buffer = Buffer.from(
      "[" + "[],".repeat(Math.floor((50 * MIB) / 3)) + "[]]",
    );
    const started: number = Date.now();

    const count: JsonElementTallyCount = JsonElementCounter.countBytes(bomb, {
      values: 1000000,
      objectsArraysAndStrings: 1000000,
    });

    expect(count.passed).toBe(JsonElementLimit.Values);
    expect(count.values).toBe(1000001);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("8 MiB of real log lines, as bytes, is counted whole in well under a second", () => {
    const entry: string = `["1700000000000000000","${"GET /checkout 200 ".repeat(5)}"],`;
    const body: string = `{"streams":[{"stream":{"app":"checkout"},"values":[${entry.repeat(
      Math.floor((8 * MIB) / entry.length),
    )}["1","a"]]}]}`;
    const started: number = Date.now();

    expect(
      JsonElementCounter.countBytes(Buffer.from(body), NO_LIMIT).values,
    ).toBe(parsedValues(JSON.parse(body)));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("bytes that are not JSON are counted as far as they look like some, never less", () => {
    // A byte order mark, outside a string, is counted as a value.
    expect(
      JsonElementCounter.countBytes(Buffer.from("﻿[]"), NO_LIMIT).values,
    ).toBe(2);
    expect(
      JsonElementCounter.countBytes(
        Buffer.from('[1, "never closed, [[['),
        NO_LIMIT,
      ).values,
    ).toBe(3);
    expect(
      JsonElementCounter.countBytes(Buffer.alloc(0), NO_LIMIT).values,
    ).toBe(0);
  });
});
