import NotNull from "../../../Types/BaseDatabase/NotNull";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("NotNull", () => {
  it("should create a NotNull object", () => {
    const obj: NotNull = new NotNull();
    expect(obj).toBeInstanceOf(NotNull);
  });

  it("should return an empty string using toString", () => {
    const obj: NotNull = new NotNull();
    expect(obj.toString()).toBe("");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: NotNull = new NotNull();
    const expectedJSON: JSONObject = {
      _type: "NotNull",
      value: null,
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a NotNull object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "NotNull",
      value: null,
    };
    const obj: NotNull = NotNull.fromJSON(jsonInput);
    expect(obj).toBeInstanceOf(NotNull);
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: null,
    };
    expect(() => {
      return NotNull.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });
});
