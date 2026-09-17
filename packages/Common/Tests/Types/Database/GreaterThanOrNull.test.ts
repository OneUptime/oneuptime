import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("GreaterThanOrNull", () => {
  it("should create a GreaterThanOrNull object with a valid value", () => {
    const value: number = 42;
    const obj: GreaterThanOrNull<number> = new GreaterThanOrNull<number>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: GreaterThanOrNull<number> = new GreaterThanOrNull<number>(1);
    obj.value = 2;
    expect(obj.value).toBe(2);
  });

  it("should return the correct string representation using toString", () => {
    const obj: GreaterThanOrNull<number> = new GreaterThanOrNull<number>(42);
    expect(obj.toString()).toBe("42");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: GreaterThanOrNull<number> = new GreaterThanOrNull<number>(42);
    /*
     * toJSON carries the RAW value (like InBetween), not a stringified one -
     * see the comment on toJSON. For numbers that means the number itself.
     */
    const expectedJSON: JSONObject = {
      _type: "GreaterThanOrNull",
      value: 42,
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("keeps the full timestamp when serializing a Date value", () => {
    const value: Date = new Date("2026-07-21T14:35:12.345Z");
    const obj: GreaterThanOrNull<Date> = new GreaterThanOrNull<Date>(value);

    /*
     * The raw Date is serialized, so JSON.stringify emits the full ISO
     * timestamp. The old toString()-based toJSON collapsed it to a
     * local-timezone date-only string, which shifted query bounds sent from
     * the browser by up to a day and silently dropped same-day rows.
     */
    expect(obj.toJSON()).toEqual({
      _type: "GreaterThanOrNull",
      value: value,
    });
    expect(JSON.parse(JSON.stringify(obj.toJSON()))["value"]).toBe(
      "2026-07-21T14:35:12.345Z",
    );
  });

  it("should create a GreaterThanOrNull object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "GreaterThanOrNull",
      value: "42",
    };
    const obj: GreaterThanOrNull<number> =
      GreaterThanOrNull.fromJSON(jsonInput);
    expect(obj.value).toBe("42");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "42",
    };
    expect(() => {
      return GreaterThanOrNull.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of GreaterThanOrNull", () => {
    const obj: GreaterThanOrNull<number> = new GreaterThanOrNull<number>(42);
    expect(obj).toBeInstanceOf(GreaterThanOrNull);
  });

  it("should handle date values", () => {
    const value: Date = new Date("2023-01-01");
    const obj: GreaterThanOrNull<Date> = new GreaterThanOrNull<Date>(value);
    expect(obj.value).toBe(value);
  });
});
