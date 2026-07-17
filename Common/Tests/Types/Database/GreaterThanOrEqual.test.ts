import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("GreaterThanOrEqual", () => {
  it("should create a GreaterThanOrEqual object with a valid value", () => {
    const value: number = 42;
    const obj: GreaterThanOrEqual<number> = new GreaterThanOrEqual<number>(
      value,
    );
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: GreaterThanOrEqual<number> = new GreaterThanOrEqual<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: GreaterThanOrEqual<number> = new GreaterThanOrEqual<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: GreaterThanOrEqual<number> = new GreaterThanOrEqual<number>(42);
    const expectedJSON: JSONObject = {
      _type: "GreaterThanOrEqual",
      value: "42",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a GreaterThanOrEqual object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "GreaterThanOrEqual",
      value: "42",
    };
    const obj: GreaterThanOrEqual<number> =
      GreaterThanOrEqual.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return GreaterThanOrEqual.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of GreaterThanOrEqual", () => {
    const obj: GreaterThanOrEqual<number> = new GreaterThanOrEqual<number>(42);
    expect(obj).toBeInstanceOf(GreaterThanOrEqual);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: GreaterThanOrEqual<Date> = new GreaterThanOrEqual<Date>(value);
    expect(obj.value).toBe(value);
  });
});
