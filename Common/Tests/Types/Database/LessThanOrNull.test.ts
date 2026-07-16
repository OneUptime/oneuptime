import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("LessThanOrNull", () => {
  it("should create a LessThanOrNull object with a valid value", () => {
    const value: number = 42;
    const obj: LessThanOrNull<number> = new LessThanOrNull<number>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: LessThanOrNull<number> = new LessThanOrNull<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: LessThanOrNull<number> = new LessThanOrNull<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: LessThanOrNull<number> = new LessThanOrNull<number>(42);
    const expectedJSON: JSONObject = {
      _type: "LessThanOrNull",
      value: "42",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a LessThanOrNull object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "LessThanOrNull",
      value: "42",
    };
    const obj: LessThanOrNull<number> = LessThanOrNull.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return LessThanOrNull.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of LessThanOrNull", () => {
    const obj: LessThanOrNull<number> = new LessThanOrNull<number>(42);
    expect(obj).toBeInstanceOf(LessThanOrNull);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: LessThanOrNull<Date> = new LessThanOrNull<Date>(value);
    expect(obj.value).toBe(value);
  });
});
