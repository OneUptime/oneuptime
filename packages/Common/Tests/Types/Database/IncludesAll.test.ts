import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("IncludesAll", () => {
  it("should create an IncludesAll object with string values", () => {
    const values: Array<string> = ["a", "b"];
    const obj: IncludesAll = new IncludesAll(values);
    expect(obj.values).toEqual(values);
  });

  it("should get and set the values property", () => {
    const obj: IncludesAll = new IncludesAll(["a"]);
    obj.values = ["c", "d"];
    expect(obj.values).toEqual(["c", "d"]);
  });

  it("should handle numeric values", () => {
    const values: Array<number> = [1, 2, 3];
    const obj: IncludesAll = new IncludesAll(values);
    expect(obj.values).toEqual(values);
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: IncludesAll = new IncludesAll(["a", "b"]);
    const expectedJSON: JSONObject = {
      _type: "IncludesAll",
      value: ["a", "b"],
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an IncludesAll object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "IncludesAll",
      value: ["a", "b"],
    };
    const obj: IncludesAll = IncludesAll.fromJSON(jsonInput);
    expect(obj.values).toEqual(["a", "b"]);
  });

  it("should default to an empty array when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "IncludesAll",
    };
    const obj: IncludesAll = IncludesAll.fromJSON(jsonInput);
    expect(obj.values).toEqual([]);
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: [],
    };
    expect(() => {
      return IncludesAll.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of IncludesAll", () => {
    const obj: IncludesAll = new IncludesAll(["a"]);
    expect(obj).toBeInstanceOf(IncludesAll);
  });
});
