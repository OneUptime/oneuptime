import { JSONArray, JSONObject } from "../../Types/JSON";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import JSONFunctions from "../../Types/JSONFunctions";

describe("JSONFunctions Class", () => {
  let baseModel: BaseModel;

  beforeEach(() => {
    baseModel = new BaseModel();
  });

  describe("isEmptyObject Method", () => {
    test("Returns true for an empty object", () => {
      const emptyObj: JSONObject = {};
      expect(JSONFunctions.isEmptyObject(emptyObj)).toBe(true);
    });

    test("Returns false for a non-empty object", () => {
      const nonEmptyObj: JSONObject = { key: "value" };
      expect(JSONFunctions.isEmptyObject(nonEmptyObj)).toBe(false);
    });

    test("Returns true for null or undefined", () => {
      expect(JSONFunctions.isEmptyObject(null)).toBe(true);
      expect(JSONFunctions.isEmptyObject(undefined)).toBe(true);
    });
  });

  describe("toJSON and fromJSON Methods", () => {
    test("toJSON returns a valid JSON object", () => {
      const json: JSONObject = BaseModel.toJSON(baseModel, BaseModel);
      expect(json).toEqual(expect.objectContaining({}));
    });

    test("toJSONObject returns a valid JSON object", () => {
      const json: JSONObject = BaseModel.toJSONObject(baseModel, BaseModel);
      expect(json).toEqual(expect.objectContaining({}));
    });

    test("fromJSON returns a BaseModel instance", () => {
      const json: JSONObject = { name: "oneuptime" };
      const result: BaseModel | BaseModel[] = BaseModel.fromJSON(
        json,
        BaseModel,
      );
      expect(result).toBeInstanceOf(BaseModel);
    });
  });

  describe("deepEqual Method", () => {
    test("Returns true for two structurally equal objects", () => {
      expect(
        JSONFunctions.deepEqual(
          { a: 1, b: { c: [1, 2] } },
          { a: 1, b: { c: [1, 2] } },
        ),
      ).toBe(true);
    });

    test("Returns false when a nested value differs", () => {
      expect(
        JSONFunctions.deepEqual({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 } }),
      ).toBe(false);
    });

    test("Returns false when keys differ", () => {
      expect(JSONFunctions.deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    test("Compares arrays element by element", () => {
      expect(JSONFunctions.deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(JSONFunctions.deepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    test("Compares Date instances by time value", () => {
      expect(JSONFunctions.deepEqual(new Date(0), new Date(0))).toBe(true);
      expect(JSONFunctions.deepEqual(new Date(0), new Date(1000))).toBe(false);
    });

    test("Returns false when comparing an object with null", () => {
      expect(JSONFunctions.deepEqual({ a: 1 }, null)).toBe(false);
      expect(JSONFunctions.deepEqual(null, null)).toBe(true);
    });
  });

  describe("isJSONObjectDifferent Method", () => {
    test("Returns false for equal objects", () => {
      expect(JSONFunctions.isJSONObjectDifferent({ a: 1 }, { a: 1 })).toBe(
        false,
      );
    });

    test("Returns true for different objects", () => {
      expect(JSONFunctions.isJSONObjectDifferent({ a: 1 }, { a: 2 })).toBe(
        true,
      );
    });
  });

  describe("isEqualObject Method", () => {
    test("Returns true for two objects with the same keys and values", () => {
      expect(JSONFunctions.isEqualObject({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(
        true,
      );
    });

    test("Returns false when a value differs", () => {
      expect(JSONFunctions.isEqualObject({ a: 1 }, { a: 2 })).toBe(false);
    });

    test("Returns false when the number of keys differs", () => {
      expect(JSONFunctions.isEqualObject({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    test("Returns true when both objects are undefined", () => {
      expect(JSONFunctions.isEqualObject(undefined, undefined)).toBe(true);
    });

    test("Returns false when only one object is undefined", () => {
      expect(JSONFunctions.isEqualObject({ a: 1 }, undefined)).toBe(false);
    });
  });

  describe("nestJson Method", () => {
    test("Expands dot-separated keys into nested objects", () => {
      const input: JSONObject = {
        "a.b.c": 1,
        "a.b.d": 2,
        x: 3,
      };
      expect(JSONFunctions.nestJson(input)).toEqual({
        a: { b: { c: 1, d: 2 } },
        x: 3,
      });
    });
  });

  describe("flattenObject and unflattenObject Methods", () => {
    test("flattenObject collapses nested objects into dot-separated keys", () => {
      const input: JSONObject = { a: { b: { c: 1 } }, d: 2 };
      expect(JSONFunctions.flattenObject(input)).toEqual({
        "a.b.c": 1,
        d: 2,
      });
    });

    test("unflattenObject is the inverse of flattenObject", () => {
      const flat: JSONObject = { "a.b.c": 1, d: 2 };
      expect(JSONFunctions.unflattenObject(flat)).toEqual({
        a: { b: { c: 1 } },
        d: 2,
      });
    });
  });

  describe("flattenArray and unflattenArray Methods", () => {
    test("flattenArray flattens each object in the array", () => {
      const input: JSONArray = [{ a: { b: 1 } }, { c: { d: 2 } }];
      expect(JSONFunctions.flattenArray(input)).toEqual([
        { "a.b": 1 },
        { "c.d": 2 },
      ]);
    });

    test("unflattenArray unflattens each object in the array", () => {
      const input: JSONArray = [{ "a.b": 1 }, { "c.d": 2 }];
      expect(JSONFunctions.unflattenArray(input)).toEqual([
        { a: { b: 1 } },
        { c: { d: 2 } },
      ]);
    });
  });

  describe("getJSONValueInPath Method", () => {
    test("Returns the value at the given dot-separated path", () => {
      const obj: JSONObject = { a: { b: { c: 5 } } };
      expect(JSONFunctions.getJSONValueInPath(obj, "a.b.c")).toBe(5);
    });

    test("Returns null when the path does not exist", () => {
      const obj: JSONObject = { a: { b: 1 } };
      expect(JSONFunctions.getJSONValueInPath(obj, "a.x")).toBeNull();
    });
  });

  describe("toString Method", () => {
    test("Returns the string unchanged when given a string", () => {
      expect(JSONFunctions.toString("hello")).toBe("hello");
    });

    test("Stringifies non-string values", () => {
      expect(JSONFunctions.toString(123)).toBe("123");
      expect(JSONFunctions.toString({ a: 1 })).toBe('{"a":1}');
      expect(JSONFunctions.toString(true)).toBe("true");
    });
  });

  describe("toCompressedString and toFormattedString Methods", () => {
    test("toCompressedString uses 2-space indentation", () => {
      expect(JSONFunctions.toCompressedString({ a: 1 })).toBe(
        JSON.stringify({ a: 1 }, null, 2),
      );
    });

    test("toFormattedString uses 4-space indentation", () => {
      expect(JSONFunctions.toFormattedString({ a: 1 })).toBe(
        JSON.stringify({ a: 1 }, null, 4),
      );
    });
  });

  describe("parse, parseJSONObject and parseJSONArray Methods", () => {
    test("parse handles JSON5 syntax with unquoted keys", () => {
      expect(JSONFunctions.parse("{ a: 1 }")).toEqual({ a: 1 });
    });

    test("parseJSONObject returns an object", () => {
      expect(JSONFunctions.parseJSONObject('{ "a": 1 }')).toEqual({ a: 1 });
    });

    test("parseJSONObject throws when given an array", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject("[1, 2]");
      }).toThrow("Expected JSONObject, but got JSONArray");
    });

    test("parseJSONArray returns an array", () => {
      expect(JSONFunctions.parseJSONArray("[1, 2]")).toEqual([1, 2]);
    });

    test("parseJSONArray throws when given an object", () => {
      expect(() => {
        return JSONFunctions.parseJSONArray('{ "a": 1 }');
      }).toThrow("Expected JSONArray, but got JSONObject");
    });
  });

  describe("anyObjectToJSONObject Method", () => {
    test("Converts an object to a plain JSON object", () => {
      expect(JSONFunctions.anyObjectToJSONObject({ a: 1, b: "two" })).toEqual({
        a: 1,
        b: "two",
      });
    });
  });

  describe("removeCircularReferences Method", () => {
    test("Removes circular references without throwing", () => {
      const obj: JSONObject = { a: 1 };
      (obj as Record<string, unknown>)["self"] = obj;

      const result: JSONObject = JSONFunctions.removeCircularReferences(obj);
      expect(result["a"]).toBe(1);
      expect(result["self"]).toBeUndefined();
    });
  });

  describe("getSizeOfJSONinGB Method", () => {
    test("Returns a non-negative number", () => {
      const size: number = JSONFunctions.getSizeOfJSONinGB({ a: 1 });
      expect(typeof size).toBe("number");
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });
});
