import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("LessThanOrEqual", () => {
  it("should create a LessThanOrEqual object with a valid value", () => {
    const value: number = 42;
    const obj: LessThanOrEqual<number> = new LessThanOrEqual<number>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: LessThanOrEqual<number> = new LessThanOrEqual<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: LessThanOrEqual<number> = new LessThanOrEqual<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: LessThanOrEqual<number> = new LessThanOrEqual<number>(42);
    /*
     * toJSON carries the RAW value (like InBetween), not a stringified one -
     * see the comment on toJSON. For numbers that means the number itself.
     */
    const expectedJSON: JSONObject = {
      _type: "LessThanOrEqual",
      value: 42,
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("keeps the full timestamp when serializing a Date value", () => {
    const value: Date = new Date("2026-07-21T14:35:12.345Z");
    const obj: LessThanOrEqual<Date> = new LessThanOrEqual<Date>(value);

    /*
     * The raw Date is serialized, so JSON.stringify emits the full ISO
     * timestamp. The old toString()-based toJSON collapsed it to a
     * local-timezone date-only string, which shifted query bounds sent from
     * the browser by up to a day and silently dropped same-day rows.
     */
    expect(obj.toJSON()).toEqual({
      _type: "LessThanOrEqual",
      value: value,
    });
    expect(JSON.parse(JSON.stringify(obj.toJSON()))["value"]).toBe(
      "2026-07-21T14:35:12.345Z",
    );
  });

  it("should create a LessThanOrEqual object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "LessThanOrEqual",
      value: "42",
    };
    const obj: LessThanOrEqual<number> = LessThanOrEqual.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return LessThanOrEqual.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of LessThanOrEqual", () => {
    const obj: LessThanOrEqual<number> = new LessThanOrEqual<number>(42);
    expect(obj).toBeInstanceOf(LessThanOrEqual);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: LessThanOrEqual<Date> = new LessThanOrEqual<Date>(value);
    expect(obj.value).toBe(value);
  });
});
