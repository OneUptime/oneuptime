import LessThan from "../../../Types/BaseDatabase/LessThan";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("LessThan", () => {
  it("should create a LessThan object with a valid value", () => {
    const value: number = 42;
    const obj: LessThan<number> = new LessThan<number>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: LessThan<number> = new LessThan<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: LessThan<number> = new LessThan<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: LessThan<number> = new LessThan<number>(42);
    const expectedJSON: JSONObject = {
      _type: "LessThan",
      /*
       * toJSON carries the RAW value (like InBetween), not a stringified one -
       * see the comment on toJSON. For numbers that means the number itself.
       */
      value: 42,
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a LessThan object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "LessThan",
      value: "42",
    };
    const obj: LessThan<number> = LessThan.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return LessThan.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of LessThan", () => {
    const obj: LessThan<number> = new LessThan<number>(42);
    expect(obj).toBeInstanceOf(LessThan);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: LessThan<Date> = new LessThan<Date>(value);
    expect(obj.value).toBe(value);
  });
});
