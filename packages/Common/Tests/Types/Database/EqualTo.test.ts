import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("EqualTo", () => {
  it("should create an EqualTo object with a valid value", () => {
    const value: string = "oneuptime";
    const equalObj: EqualTo<string> = new EqualTo<string>(value);
    expect(equalObj.value).toBe(value);
  });

  it("should get the value property of an EqualTo object", () => {
    const value: string = "oneuptime";
    const equalObj: EqualTo<string> = new EqualTo<string>(value);
    expect(equalObj.value).toBe(value);
  });

  it("should set the value property of an EqualTo object", () => {
    const equalObj: EqualTo<string> = new EqualTo<string>("oldValue");
    equalObj.value = "newValue";
    expect(equalObj.value).toBe("newValue");
  });

  it("should return the correct string representation using toString method", () => {
    const equalObj: EqualTo<string> = new EqualTo<string>("oneuptime");
    expect(equalObj.toString()).toBe("oneuptime");
  });

  it("should generate the correct JSON representation using toJSON method", () => {
    const equalObj: EqualTo<string> = new EqualTo<string>("oneuptime");
    const expectedJSON: JSONObject = {
      _type: "EqualTo",
      value: "oneuptime",
    };
    expect(equalObj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an EqualTo object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "EqualTo",
      value: "oneuptime",
    };
    const equalObj: EqualTo<string> = EqualTo.fromJSON(jsonInput);
    expect(equalObj.value).toBe("oneuptime");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "oneuptime",
    };
    expect(() => {
      return EqualTo.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be a type of EqualTo", () => {
    const equalObj: EqualTo<string> = new EqualTo("oneuptime");
    expect(equalObj).toBeInstanceOf(EqualTo);
  });

  it("should handle numeric values", () => {
    const value: number = 42;
    const equalObj: EqualTo<number> = new EqualTo<number>(value);
    expect(equalObj.value).toBe(value);
    expect(equalObj.toString()).toBe("42");
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const equalObj: EqualTo<Date> = new EqualTo<Date>(value);
    expect(equalObj.value).toBe(value);
  });
});
