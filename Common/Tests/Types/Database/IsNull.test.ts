import IsNull from "../../../Types/BaseDatabase/IsNull";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("IsNull", () => {
  it("should create an IsNull object", () => {
    const obj: IsNull = new IsNull();
    expect(obj).toBeInstanceOf(IsNull);
  });

  it("should return an empty string using toString", () => {
    const obj: IsNull = new IsNull();
    expect(obj.toString()).toBe("");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: IsNull = new IsNull();
    const expectedJSON: JSONObject = {
      _type: "IsNull",
      value: null,
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an IsNull object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "IsNull",
      value: null,
    };
    const obj: IsNull = IsNull.fromJSON(jsonInput);
    expect(obj).toBeInstanceOf(IsNull);
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: null,
    };
    expect(() => {
      return IsNull.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });
});
