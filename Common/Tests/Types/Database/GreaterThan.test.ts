import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("GreaterThan", () => {
  it("should create a GreaterThan object with a valid value", () => {
    const value: number = 42;
    const obj: GreaterThan<number> = new GreaterThan<number>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: GreaterThan<number> = new GreaterThan<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: GreaterThan<number> = new GreaterThan<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: GreaterThan<number> = new GreaterThan<number>(42);
    const expectedJSON: JSONObject = {
      _type: "GreaterThan",
      value: "42",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a GreaterThan object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "GreaterThan",
      value: "42",
    };
    const obj: GreaterThan<number> = GreaterThan.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return GreaterThan.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of GreaterThan", () => {
    const obj: GreaterThan<number> = new GreaterThan<number>(42);
    expect(obj).toBeInstanceOf(GreaterThan);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: GreaterThan<Date> = new GreaterThan<Date>(value);
    expect(obj.value).toBe(value);
  });
});
