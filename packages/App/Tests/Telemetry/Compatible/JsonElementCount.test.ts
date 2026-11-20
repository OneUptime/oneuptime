import { describe, expect, test } from "@jest/globals";
import JsonElementCounter, {
  JsonElementCount,
  JsonElementCountOutcome,
  JsonValueBudget,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/JsonElementCount";

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
