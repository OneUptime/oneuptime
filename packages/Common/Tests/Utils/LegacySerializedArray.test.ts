import { readLegacySerializedArray } from "../../Utils/LegacySerializedArray";
import { describe, expect, test } from "@jest/globals";

/*
 * The pre-fix serializer turned an array it received directly into a
 * numeric-keyed object. Values written that way are still in databases and in
 * browser local storage, so both shapes have to read back — while a genuine
 * object that merely happens to carry a "0" key must not be mistaken for one
 * of them.
 */

describe("readLegacySerializedArray", () => {
  describe("Values that are already arrays", () => {
    test("Returns an array unchanged", () => {
      expect(readLegacySerializedArray(["time", "body"])).toEqual([
        "time",
        "body",
      ]);
    });

    test("Returns an empty array unchanged", () => {
      expect(readLegacySerializedArray([])).toEqual([]);
    });

    test("Leaves element types alone", () => {
      const mixed: Array<unknown> = [1, "x", null, { a: 1 }, ["nested"]];

      expect(readLegacySerializedArray(mixed)).toEqual(mixed);
    });

    test("Returns the same reference, not a copy", () => {
      const original: Array<unknown> = ["time"];

      expect(readLegacySerializedArray(original)).toBe(original);
    });
  });

  describe("Values corrupted into numeric-keyed objects", () => {
    test("Rebuilds a two-element array", () => {
      expect(readLegacySerializedArray({ "0": "service", "1": "api" })).toEqual(
        ["service", "api"],
      );
    });

    test("Rebuilds a longer array in index order", () => {
      expect(
        readLegacySerializedArray({
          "0": "time",
          "1": "body",
          "2": "severityText",
        }),
      ).toEqual(["time", "body", "severityText"]);
    });

    test("Rebuilds in index order even when the keys are out of order", () => {
      expect(
        readLegacySerializedArray({
          "2": "third",
          "0": "first",
          "1": "second",
        }),
      ).toEqual(["first", "second", "third"]);
    });

    test("Rebuilds a single-element array", () => {
      expect(readLegacySerializedArray({ "0": "only" })).toEqual(["only"]);
    });

    test("Keeps null and empty-string elements", () => {
      expect(readLegacySerializedArray({ "0": null, "1": "" })).toEqual([
        null,
        "",
      ]);
    });

    test("Reads an empty object as an empty array", () => {
      // An empty array is exactly what the old serializer wrote as {}.
      expect(readLegacySerializedArray({})).toEqual([]);
    });

    test("The result is a real array, so it can be destructured", () => {
      const restored: Array<unknown> | null = readLegacySerializedArray({
        "0": "service",
        "1": "api",
      });

      expect(Array.isArray(restored)).toBe(true);
      expect(() => {
        const [first]: Array<unknown> = restored as Array<unknown>;
        return first;
      }).not.toThrow();
    });
  });

  describe("Values that are not arrays in any shape", () => {
    test("Rejects null and undefined", () => {
      expect(readLegacySerializedArray(null)).toBeNull();
      expect(readLegacySerializedArray(undefined)).toBeNull();
    });

    test("Rejects primitives", () => {
      expect(readLegacySerializedArray("time")).toBeNull();
      expect(readLegacySerializedArray(7)).toBeNull();
      expect(readLegacySerializedArray(true)).toBeNull();
    });

    test("Rejects a plain object with named keys", () => {
      expect(readLegacySerializedArray({ facetKey: "service" })).toBeNull();
    });

    test("Rejects an object that only partly looks like an array", () => {
      // "0" is there but "1" is not, so the run of indices is incomplete.
      expect(
        readLegacySerializedArray({ "0": "service", foo: "bar" }),
      ).toBeNull();
    });

    test("Rejects an object whose indices do not start at zero", () => {
      expect(readLegacySerializedArray({ "1": "a", "2": "b" })).toBeNull();
    });

    test("Rejects an object with a gap in its indices", () => {
      expect(readLegacySerializedArray({ "0": "a", "2": "b" })).toBeNull();
    });

    test("Rejects a real saved-view state object", () => {
      /*
       * Guards the boundary the other way: a JSON column's own object must
       * never be read as a list of its values.
       */
      expect(
        readLegacySerializedArray({
          search: "status:error",
          pageSize: 50,
        }),
      ).toBeNull();
    });
  });
});
