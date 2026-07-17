import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("IncludesNone", () => {
  it("should create an IncludesNone object with string values", () => {
    const values: Array<string> = ["a", "b"];
    const obj: IncludesNone = new IncludesNone(values);
    expect(obj.values).toEqual(values);
  });

  it("should get and set the values property", () => {
    const obj: IncludesNone = new IncludesNone(["a"]);
    obj.values = ["c", "d"];
    expect(obj.values).toEqual(["c", "d"]);
  });

  it("should handle numeric values", () => {
    const values: Array<number> = [1, 2, 3];
    const obj: IncludesNone = new IncludesNone(values);
    expect(obj.values).toEqual(values);
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: IncludesNone = new IncludesNone(["a", "b"]);
    const expectedJSON: JSONObject = {
      _type: "IncludesNone",
      value: ["a", "b"],
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an IncludesNone object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "IncludesNone",
      value: ["a", "b"],
    };
    const obj: IncludesNone = IncludesNone.fromJSON(jsonInput);
    expect(obj.values).toEqual(["a", "b"]);
  });

  it("should default to an empty array when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "IncludesNone",
    };
    const obj: IncludesNone = IncludesNone.fromJSON(jsonInput);
    expect(obj.values).toEqual([]);
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: [],
    };
    expect(() => {
      return IncludesNone.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of IncludesNone", () => {
    const obj: IncludesNone = new IncludesNone(["a"]);
    expect(obj).toBeInstanceOf(IncludesNone);
  });
});
