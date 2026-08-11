import LocalStorage from "../../../UI/Utils/LocalStorage";
import { readLegacySerializedArray } from "../../../Utils/LegacySerializedArray";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * LocalStorage.setItem hands the caller's value straight to
 * JSONFunctions.serializeValue rather than wrapping it in an object first, so
 * a TOP-LEVEL array took the same broken path as a nested one and came back as
 * { "0": ..., "1": ... }. This is not the saved-view case: the array is flat.
 *
 * It shipped. The logs explorer stores its selected columns here, read back
 * behind an Array.isArray guard, so the corruption showed up as the column
 * picker silently resetting to defaults on every reload — no error anywhere.
 */

describe("LocalStorage round-trips arrays", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("A flat string array comes back as an array", () => {
    LocalStorage.setItem("columns", ["time", "body", "severityText"]);

    const restored: unknown = LocalStorage.getItem("columns");

    expect(Array.isArray(restored)).toBe(true);
    expect(restored).toEqual(["time", "body", "severityText"]);
  });

  test("The stored JSON is an array, not a numeric-keyed object", () => {
    LocalStorage.setItem("columns", ["time", "body"]);

    expect(localStorage.getItem("columns")).toBe('["time","body"]');
  });

  test("An empty array round-trips", () => {
    LocalStorage.setItem("columns", []);

    expect(LocalStorage.getItem("columns")).toEqual([]);
  });

  test("An array of numbers round-trips", () => {
    LocalStorage.setItem("sizes", [10, 25, 50]);

    expect(LocalStorage.getItem("sizes")).toEqual([10, 25, 50]);
  });

  test("An array nested inside a stored object round-trips", () => {
    LocalStorage.setItem("state", { columns: ["time"], filters: [["a", "b"]] });

    expect(LocalStorage.getItem("state")).toEqual({
      columns: ["time"],
      filters: [["a", "b"]],
    });
  });

  test("A plain object is still stored as an object", () => {
    LocalStorage.setItem("prefs", { pageSize: 50 });

    expect(LocalStorage.getItem("prefs")).toEqual({ pageSize: 50 });
  });

  test("A value written by the old serializer still reads back as a list", () => {
    // What a pre-fix build left in the browser.
    localStorage.setItem("columns", '{"0":"time","1":"body"}');

    const restored: unknown = LocalStorage.getItem("columns");

    expect(Array.isArray(restored)).toBe(false);
    expect(readLegacySerializedArray(restored)).toEqual(["time", "body"]);
  });
});
