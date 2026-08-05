import { ToolArgs } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ToolArgs.scopeServiceIds and getTimeRange already have dedicated suites.
 * This covers the remaining argument extractors — the coercion, trimming,
 * clamping and defaulting rules the AI toolbox relies on to turn loosely-typed
 * model-supplied JSON arguments into safe, typed values.
 */

describe("ToolArgs extractors", () => {
  describe("getString", () => {
    test("trims and returns a non-empty string", () => {
      expect(ToolArgs.getString({ q: "  hello  " }, "q")).toBe("hello");
    });

    test("returns undefined for empty or whitespace-only strings", () => {
      expect(ToolArgs.getString({ q: "" }, "q")).toBeUndefined();
      expect(ToolArgs.getString({ q: "   " }, "q")).toBeUndefined();
    });

    test("returns undefined for missing keys and non-string values", () => {
      expect(ToolArgs.getString({}, "q")).toBeUndefined();
      expect(ToolArgs.getString({ q: 5 }, "q")).toBeUndefined();
      expect(ToolArgs.getString({ q: null }, "q")).toBeUndefined();
      expect(ToolArgs.getString({ q: ["a"] }, "q")).toBeUndefined();
    });
  });

  describe("getStringArray", () => {
    test("keeps only non-empty strings, trimming them", () => {
      expect(
        ToolArgs.getStringArray({ ids: ["a", " b ", "", "  ", "c"] }, "ids"),
      ).toEqual(["a", " b ", "c"]);
    });

    test("filters out non-string members", () => {
      expect(
        ToolArgs.getStringArray(
          { ids: ["a", 1, true, null, "b"] as unknown as Array<string> },
          "ids",
        ),
      ).toEqual(["a", "b"]);
    });

    test("returns undefined when nothing survives filtering", () => {
      expect(
        ToolArgs.getStringArray({ ids: ["", "   "] }, "ids"),
      ).toBeUndefined();
      expect(ToolArgs.getStringArray({ ids: [] }, "ids")).toBeUndefined();
    });

    test("returns undefined for a non-array value", () => {
      expect(ToolArgs.getStringArray({ ids: "a,b" }, "ids")).toBeUndefined();
      expect(ToolArgs.getStringArray({}, "ids")).toBeUndefined();
    });
  });

  describe("getNumber", () => {
    const options: { defaultValue: number; min: number; max: number } = {
      defaultValue: 10,
      min: 1,
      max: 100,
    };

    test("passes finite numbers through, flooring fractionals", () => {
      expect(ToolArgs.getNumber({ n: 5 }, "n", options)).toBe(5);
      expect(ToolArgs.getNumber({ n: 5.9 }, "n", options)).toBe(5);
    });

    test("parses numeric strings", () => {
      expect(ToolArgs.getNumber({ n: "7" }, "n", options)).toBe(7);
      expect(ToolArgs.getNumber({ n: "7.8" }, "n", options)).toBe(7);
    });

    test("clamps to the configured min and max", () => {
      expect(ToolArgs.getNumber({ n: 1000 }, "n", options)).toBe(100);
      expect(ToolArgs.getNumber({ n: -5 }, "n", options)).toBe(1);
    });

    test("falls back to the default for missing or invalid values", () => {
      expect(ToolArgs.getNumber({}, "n", options)).toBe(10);
      expect(ToolArgs.getNumber({ n: "abc" }, "n", options)).toBe(10);
      expect(ToolArgs.getNumber({ n: NaN }, "n", options)).toBe(10);
      expect(ToolArgs.getNumber({ n: Infinity }, "n", options)).toBe(10);
      expect(ToolArgs.getNumber({ n: "" }, "n", options)).toBe(10);
    });

    test("still clamps the default value itself", () => {
      // Default below min is raised to min; default above max lowered to max.
      expect(
        ToolArgs.getNumber({}, "n", { defaultValue: 0, min: 5, max: 100 }),
      ).toBe(5);
    });
  });

  describe("getBoolean", () => {
    test("returns real booleans as-is", () => {
      expect(ToolArgs.getBoolean({ b: true }, "b")).toBe(true);
      expect(ToolArgs.getBoolean({ b: false }, "b")).toBe(false);
    });

    test("coerces the strings 'true' and 'false'", () => {
      expect(ToolArgs.getBoolean({ b: "true" }, "b")).toBe(true);
      expect(ToolArgs.getBoolean({ b: "false" }, "b")).toBe(false);
    });

    test("returns undefined for anything else", () => {
      expect(ToolArgs.getBoolean({ b: "TRUE" }, "b")).toBeUndefined();
      expect(ToolArgs.getBoolean({ b: 1 }, "b")).toBeUndefined();
      expect(ToolArgs.getBoolean({ b: "yes" }, "b")).toBeUndefined();
      expect(ToolArgs.getBoolean({}, "b")).toBeUndefined();
    });
  });

  describe("getObjectID", () => {
    test("wraps a non-empty string as an ObjectID", () => {
      const id: ObjectID | undefined = ToolArgs.getObjectID(
        { serviceId: "  abc123  " },
        "serviceId",
      );
      expect(id).toBeInstanceOf(ObjectID);
      // getString trims first, so the ObjectID carries the trimmed value.
      expect(id?.toString()).toBe("abc123");
    });

    test("returns undefined for missing or empty values", () => {
      expect(ToolArgs.getObjectID({}, "serviceId")).toBeUndefined();
      expect(
        ToolArgs.getObjectID({ serviceId: "   " }, "serviceId"),
      ).toBeUndefined();
      expect(
        ToolArgs.getObjectID(
          { serviceId: 5 as unknown as string } as JSONObject,
          "serviceId",
        ),
      ).toBeUndefined();
    });
  });
});
