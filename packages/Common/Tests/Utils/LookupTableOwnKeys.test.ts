import { describe, expect, test } from "@jest/globals";
import {
  assignOwnValues,
  copyOwnValues,
  mergeOwnValues,
  readOwnValue,
  writeOwnValue,
} from "../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../Helpers/InheritedNames";
import { seededRandom } from "../Helpers/SeededRandom";

/*
 * Copying and merging a record keyed by what a sender wrote (issue #8025).
 *
 * `{ ...record }` and Object.assign assign each key, so a key named
 * "__proto__" - an attribute an exporter sent, a label a query wrote - was
 * dropped at every copy, and an object or array under it became the copy's
 * prototype. copyOwnValues and assignOwnValues copy it as the copy's own
 * key, and copy every other key as Object.assign does.
 */

// A record holding every name an object inherits as its own key.
const everyInheritedName: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const record: Record<string, string> = {};

  for (const name of INHERITED_PROPERTY_NAMES) {
    writeOwnValue(record, name, `the value of ${name}`);
  }

  return record;
};

// The record's own keys and values, in order: what a copy must keep.
const ownEntries: (
  record: Record<string, unknown>,
) => Array<[string, unknown]> = (
  record: Record<string, unknown>,
): Array<[string, unknown]> => {
  return Object.keys(record).map((key: string): [string, unknown] => {
    return [key, readOwnValue(record, key)];
  });
};

describe("copyOwnValues", () => {
  test("keeps every name an object inherits as the copy's own key, __proto__ included, in order", () => {
    const record: Record<string, string> = everyInheritedName();
    const copy: Record<string, string> = copyOwnValues(record);

    expect(copy).not.toBe(record);
    expect(Object.keys(copy)).toEqual([...INHERITED_PROPERTY_NAMES]);
    expect(ownEntries(copy)).toEqual(ownEntries(record));
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(record));
    expect(JSON.stringify(copy)).toContain(
      '"__proto__":"the value of __proto__"',
    );
  });

  test("keeps a __proto__ key a JSON text carries, between the keys around it", () => {
    const record: Record<string, string> = JSON.parse(
      '{"service":"api","__proto__":"x","zone":"eu"}',
    );
    const copy: Record<string, string> = copyOwnValues(record);

    expect(Object.keys(copy)).toEqual(["service", "__proto__", "zone"]);
    expect(readOwnValue(copy, "__proto__")).toBe("x");
    expect(JSON.stringify(copy)).toBe(
      '{"service":"api","__proto__":"x","zone":"eu"}',
    );
  });

  test("never takes an object or an array under __proto__ as the copy's prototype", () => {
    for (const value of [{ polluted: "yes" }, ["a", "b"]]) {
      const record: Record<string, unknown> = { word: "x" };
      writeOwnValue(record, "__proto__", value);

      const copy: Record<string, unknown> = copyOwnValues(record);

      expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
      expect(readOwnValue(copy, "__proto__")).toBe(value);
      expect(readOwnValue(copy, "polluted")).toBeUndefined();
      expect((copy as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.keys(copy)).toEqual(["word", "__proto__"]);
    }
  });

  test("is a copy: changing it leaves the record as it was", () => {
    const record: Record<string, string> = everyInheritedName();
    const copy: Record<string, string> = copyOwnValues(record);

    writeOwnValue(copy, "__proto__", "changed");
    writeOwnValue(copy, "added", "new");
    delete copy["constructor"];

    expect(readOwnValue(record, "__proto__")).toBe("the value of __proto__");
    expect(readOwnValue(record, "added")).toBeUndefined();
    expect(readOwnValue(record, "constructor")).toBe(
      "the value of constructor",
    );
  });

  test("copies nothing of null or undefined, and nothing a record inherits", () => {
    expect(copyOwnValues(null)).toEqual({});
    expect(copyOwnValues(undefined)).toEqual({});

    const inheriting: Record<string, string> = Object.create({
      inherited: "no",
    });
    inheriting["own"] = "yes";

    expect(ownEntries(copyOwnValues(inheriting))).toEqual([["own", "yes"]]);
  });

  test("copies a record without __proto__ exactly as a spread does", () => {
    const records: Array<Record<string, unknown>> = [
      {},
      { a: 1 },
      { b: "2", a: null, c: [1, 2], d: { e: "f" } },
      { 10: "ten", 2: "two", name: "n" },
      JSON.parse('{"constructor":"c","toString":"t","valueOf":"v"}'),
    ];

    for (const record of records) {
      const copy: Record<string, unknown> = copyOwnValues(record);

      expect(ownEntries(copy)).toEqual(ownEntries({ ...record }));
      expect(JSON.stringify(copy)).toBe(JSON.stringify({ ...record }));
    }
  });
});

describe("assignOwnValues", () => {
  test("merges in order, a later source's value winning, as Object.assign does", () => {
    const merged: Record<string, string> = assignOwnValues<string>(
      {},
      { a: "resource", b: "resource" },
      { b: "record", c: "record" },
      { c: "scope" },
    );

    expect(ownEntries(merged)).toEqual([
      ["a", "resource"],
      ["b", "record"],
      ["c", "scope"],
    ]);
  });

  test("keeps __proto__ from whichever source holds it, a later one's value winning", () => {
    const first: Record<string, string> = JSON.parse(
      '{"service":"api","__proto__":"from the resource"}',
    );
    const second: Record<string, string> = JSON.parse(
      '{"__proto__":"from the record","level":"error"}',
    );
    const third: Record<string, string> = { "scope.name": "lib" };

    const merged: Record<string, string> = assignOwnValues<string>(
      {},
      first,
      third,
    );

    expect(Object.keys(merged)).toEqual(["service", "__proto__", "scope.name"]);
    expect(readOwnValue(merged, "__proto__")).toBe("from the resource");

    assignOwnValues(merged, second);

    expect(Object.keys(merged)).toEqual([
      "service",
      "__proto__",
      "scope.name",
      "level",
    ]);
    expect(readOwnValue(merged, "__proto__")).toBe("from the record");
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  test("writes onto the target it was given, and returns it", () => {
    const target: Record<string, string> = { kept: "yes" };

    const returned: Record<string, string> = assignOwnValues(
      target,
      everyInheritedName(),
    );

    expect(returned).toBe(target);
    expect(Object.keys(target)).toEqual(["kept", ...INHERITED_PROPERTY_NAMES]);
  });

  test("keeps the target's own __proto__ when a later source has none", () => {
    const target: Record<string, string> = {};
    writeOwnValue(target, "__proto__", "kept");

    assignOwnValues(target, { other: "x" }, null, undefined, {});

    expect(ownEntries(target)).toEqual([
      ["__proto__", "kept"],
      ["other", "x"],
    ]);
  });

  test("merges sources without __proto__ exactly as Object.assign does", () => {
    const sources: Array<Record<string, unknown>> = [
      { a: 1, b: 2 },
      { b: "two", 5: "five", c: null },
      JSON.parse('{"hasOwnProperty":"h","a":"again"}'),
    ];

    const merged: Record<string, unknown> = assignOwnValues<unknown>(
      {},
      ...sources,
    );
    const assigned: Record<string, unknown> = Object.assign({}, ...sources);

    expect(ownEntries(merged)).toEqual(ownEntries(assigned));
  });
});

/*
 * mergeOwnValues is assignOwnValues({}, ...) by object spread - what every
 * ingested record's attribute map is built with (#6086) - and must give the
 * very same object: the same own keys in the same order, the same values,
 * __proto__ kept as a key, Object.prototype as the prototype.
 */
describe("mergeOwnValues", () => {
  // Keys for maps drawn from the shared seeded generator (seededRandom).
  const KEYS: Array<string> = [
    ...INHERITED_PROPERTY_NAMES,
    "service.name",
    "http.route",
    "scope.name",
    "0",
    "7",
    "42",
    "-1",
    "1.5",
    "",
    "日本",
  ];

  const VALUES: Array<unknown> = [
    "text",
    "",
    0,
    -1.5,
    true,
    null,
    ["a", 1],
    { nested: "map" },
    { polluted: "yes" },
  ];

  function randomRecord(random: () => number): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    const count: number = Math.floor(random() * 8);

    for (let i: number = 0; i < count; i++) {
      writeOwnValue(
        record,
        KEYS[Math.floor(random() * KEYS.length)]!,
        VALUES[Math.floor(random() * VALUES.length)],
      );
    }

    return record;
  }

  test("gives assignOwnValues({}, ...)'s object for 5,000 random triples of records", () => {
    const random: () => number = seededRandom(6086);

    for (let i: number = 0; i < 5000; i++) {
      const first: Record<string, unknown> | null =
        random() < 0.1 ? null : randomRecord(random);
      const second: Record<string, unknown> | undefined =
        random() < 0.1 ? undefined : randomRecord(random);
      const third: Record<string, unknown> = randomRecord(random);

      const merged: Record<string, unknown> = mergeOwnValues<unknown>(
        first,
        second,
        third,
      );
      const assigned: Record<string, unknown> = assignOwnValues<unknown>(
        {},
        first,
        second,
        third,
      );

      expect(ownEntries(merged)).toEqual(ownEntries(assigned));
      expect(JSON.stringify(merged)).toBe(JSON.stringify(assigned));
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    }
  });

  test("keeps every inherited name as the merge's own key, __proto__ included, the later value winning", () => {
    const merged: Record<string, string> = mergeOwnValues<string>(
      { "service.name": "checkout" },
      everyInheritedName(),
      JSON.parse('{"__proto__":"from the scope"}'),
    );

    expect(Object.keys(merged)).toEqual([
      "service.name",
      ...INHERITED_PROPERTY_NAMES,
    ]);
    expect(readOwnValue(merged, "__proto__")).toBe("from the scope");
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  test("never takes an object under __proto__ as the merge's prototype", () => {
    const merged: Record<string, unknown> = mergeOwnValues<unknown>(
      JSON.parse('{"__proto__":{"polluted":"yes"},"team":"payments"}'),
    );

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged["polluted"]).toBeUndefined();
    expect(Object.keys(merged)).toEqual(["__proto__", "team"]);
  });

  test("is a new object: changing it leaves every record as it was", () => {
    const first: Record<string, string> = { a: "1" };
    const merged: Record<string, string> = mergeOwnValues<string>(first);

    merged["a"] = "changed";
    merged["b"] = "added";

    expect(first).toEqual({ a: "1" });
    expect(mergeOwnValues<string>(first)).not.toBe(
      mergeOwnValues<string>(first),
    );
  });
});
