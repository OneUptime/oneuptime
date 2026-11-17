import JsonBudget, {
  JsonBudgetResult,
  MIN_PARTIAL_BUDGET_IN_BYTES,
} from "../../../Server/Utils/JsonBudget";
import { describe, expect, test } from "@jest/globals";

/*
 * A JSON value cut to a size: what a stored check is cut to (#9189). The
 * size is that of its JSON text, in bytes, and measuring never reads past
 * the limit it is asked about.
 */

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("JsonBudget.measure", () => {
  test.each([
    ["a number", 12.5],
    ["a negative number", -3],
    ["true", true],
    ["false", false],
    ["null", null],
    ["a string with escapes", 'line\n"quoted"\\'],
    ["a string of wide characters", "Größe 東京 🙂"],
    ["an empty object", {}],
    ["an empty array", []],
    [
      "nested values",
      {
        a: [1, 2, { b: "c", d: [null, true] }],
        e: { f: "g" },
        "key with \"quotes\"": 1,
      },
    ],
    ["a date", { at: new Date("2026-11-17T10:00:00.000Z") }],
  ])("is the JSON size of %s", (_name: string, value: unknown) => {
    expect(JsonBudget.measure(value, Number.MAX_SAFE_INTEGER)).toBe(
      bytes(value),
    );
  });

  test("leaves out what JSON leaves out, and writes null for it in a list", () => {
    const value: unknown = {
      kept: 1,
      missing: undefined,
      fn: (): void => {},
      list: [undefined, 1],
    };

    expect(JsonBudget.measure(value, Number.MAX_SAFE_INTEGER)).toBe(
      bytes(value),
    );
  });

  test("stops counting once past the limit", () => {
    const big: Array<number> = new Array(1_000_000).fill(1);
    const size: number = JsonBudget.measure(big, 1000);

    expect(size).toBeGreaterThan(1000);
    // Never anywhere near the whole: it stopped at the limit.
    expect(size).toBeLessThan(1100);
  });
});

describe("JsonBudget.fit", () => {
  test("hands back what fits as it is, not a copy", () => {
    const value: Record<string, unknown> = { a: [1, 2, 3], b: "text" };
    const result: JsonBudgetResult = JsonBudget.fit(value, 1000, {
      cutStrings: true,
    });

    expect(result.isTrimmed).toBe(false);
    expect(result.value).toBe(value);
  });

  test("keeps the small fields whole beside a field that does not fit", () => {
    const value: Record<string, unknown> = {
      id: "abc",
      list: new Array(10_000).fill("xxxxxxxxxx"),
      status: 500,
      at: "2026-11-17T10:00:00.000Z",
    };
    const result: JsonBudgetResult = JsonBudget.fit(value, 2048, {
      cutStrings: true,
    });
    const kept: Record<string, unknown> = result.value as Record<
      string,
      unknown
    >;

    expect(result.isTrimmed).toBe(true);
    expect(bytes(kept)).toBeLessThanOrEqual(2048);
    expect(kept["id"]).toBe("abc");
    expect(kept["status"]).toBe(500);
    expect(kept["at"]).toBe("2026-11-17T10:00:00.000Z");
    // The list keeps its first items, as many as fit.
    expect(Array.isArray(kept["list"])).toBe(true);
    expect((kept["list"] as Array<string>).length).toBeGreaterThan(10);
    // The fields stay in their order.
    expect(Object.keys(kept)).toEqual(["id", "list", "status", "at"]);
  });

  test("cuts a string at its end when strings may be cut", () => {
    const text: string = "a".repeat(10_000);
    const result: JsonBudgetResult = JsonBudget.fit({ body: text }, 500, {
      cutStrings: true,
    });
    const body: string = (result.value as Record<string, string>)["body"]!;

    expect(result.isTrimmed).toBe(true);
    expect(bytes(result.value)).toBeLessThanOrEqual(500);
    expect(text.startsWith(body)).toBe(true);
    expect(body.length).toBeGreaterThan(400);
  });

  test("never cuts a character written as two in half, or past the budget in bytes", () => {
    const text: string = "🙂é東".repeat(2000);
    const result: JsonBudgetResult = JsonBudget.fit(text, 333, {
      cutStrings: true,
    });
    const head: string = result.value as string;

    expect(bytes(head)).toBeLessThanOrEqual(333);
    expect(text.startsWith(head)).toBe(true);
    expect(Buffer.from(head, "utf8").toString("utf8")).toBe(head);
  });

  test("keeps a string whole when strings may not be cut", () => {
    const text: string = "secret=" + "s".repeat(5000);
    const result: JsonBudgetResult = JsonBudget.fit(text, 100, {
      cutStrings: false,
    });

    expect(result.value).toBe(text);
  });

  test("still drops list items that do not fit when strings may not be cut", () => {
    const value: Array<string> = new Array(1000).fill("x".repeat(100));
    const result: JsonBudgetResult = JsonBudget.fit(value, 5000, {
      cutStrings: false,
    });

    expect(result.isTrimmed).toBe(true);
    expect((result.value as Array<string>).length).toBeLessThan(60);
  });

  test("keeps a typed value whole or leaves it out", () => {
    const typed: Record<string, unknown> = {
      _type: "ObjectID",
      value: "x".repeat(500),
    };
    const result: JsonBudgetResult = JsonBudget.fit(
      { id: typed, n: 1 },
      200,
      { cutStrings: true },
    );

    expect(result.value).toEqual({ n: 1 });
  });

  test("leaves out a field whose share is too small to be worth cutting", () => {
    const result: JsonBudgetResult = JsonBudget.fit(
      { a: "x".repeat(1000) },
      MIN_PARTIAL_BUDGET_IN_BYTES / 2,
      { cutStrings: true },
    );

    expect(result.isTrimmed).toBe(true);
    expect(result.value).toEqual({});
  });

  test("never changes what it was handed", () => {
    const value: Record<string, unknown> = {
      list: new Array(1000).fill({ a: "b".repeat(50) }),
      body: "c".repeat(5000),
    };
    const before: string = JSON.stringify(value);

    JsonBudget.fit(value, 1000, { cutStrings: true });

    expect(JSON.stringify(value)).toBe(before);
  });

  test.each([256, 1024, 4096, 65536])(
    "fits a deep, wide value into %i bytes",
    (budget: number) => {
      const value: Record<string, unknown> = {
        series: new Array(500).fill(0).map((_: number, i: number) => {
          return {
            fingerprint: `fp-${i}`,
            labels: { host: `host-${i}`, container: `c-${i}` },
            points: new Array(20).fill({ t: "2026-11-17T10:00:00Z", v: i }),
          };
        }),
        body: "z".repeat(100_000),
        code: 200,
      };
      const result: JsonBudgetResult = JsonBudget.fit(value, budget, {
        cutStrings: true,
      });

      expect(result.isTrimmed).toBe(true);
      expect(bytes(result.value)).toBeLessThanOrEqual(budget);
      expect(JsonBudget.measure(result.value, Number.MAX_SAFE_INTEGER)).toBe(
        bytes(result.value),
      );
    },
  );
});
