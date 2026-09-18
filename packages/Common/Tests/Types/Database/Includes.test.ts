import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("Includes", () => {
  it("should create an Includes object with string values", () => {
    const values: Array<string> = ["a", "b"];
    const obj: Includes = new Includes(values);
    expect(obj.values).toEqual(values);
  });

  it("should get and set the values property", () => {
    const obj: Includes = new Includes(["a"]);
    obj.values = ["c", "d"];
    expect(obj.values).toEqual(["c", "d"]);
  });

  it("should handle numeric values", () => {
    const values: Array<number> = [1, 2, 3];
    const obj: Includes = new Includes(values);
    expect(obj.values).toEqual(values);
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: Includes = new Includes(["a", "b"]);
    const expectedJSON: JSONObject = {
      _type: "Includes",
      value: ["a", "b"],
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an Includes object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "Includes",
      value: ["a", "b"],
    };
    const obj: Includes = Includes.fromJSON(jsonInput);
    expect(obj.values).toEqual(["a", "b"]);
  });

  it("should default to an empty array when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "Includes",
    };
    const obj: Includes = Includes.fromJSON(jsonInput);
    expect(obj.values).toEqual([]);
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: [],
    };
    expect(() => {
      return Includes.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of Includes", () => {
    const obj: Includes = new Includes(["a"]);
    expect(obj).toBeInstanceOf(Includes);
  });
});
