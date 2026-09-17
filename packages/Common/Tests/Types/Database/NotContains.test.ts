import NotContains from "../../../Types/BaseDatabase/NotContains";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("NotContains", () => {
  it("should create a NotContains object with a valid value", () => {
    const value: string = "oneuptime";
    const obj: NotContains<string> = new NotContains<string>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: NotContains<string> = new NotContains<string>("oldValue");
    obj.value = "newValue";
    expect(obj.value).toBe("newValue");
  });

  it("should return the value using toString", () => {
    const obj: NotContains<string> = new NotContains<string>("oneuptime");
    expect(obj.toString()).toBe("oneuptime");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: NotContains<string> = new NotContains<string>("oneuptime");
    const expectedJSON: JSONObject = {
      _type: "NotContains",
      value: "oneuptime",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a NotContains object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "NotContains",
      value: "oneuptime",
    };
    const obj: NotContains<string> = NotContains.fromJSON(jsonInput);
    expect(obj.value).toBe("oneuptime");
  });

  it("should default to an empty string when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "NotContains",
    };
    const obj: NotContains<string> = NotContains.fromJSON(jsonInput);
    expect(obj.value).toBe("");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "oneuptime",
    };
    expect(() => {
      return NotContains.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of NotContains", () => {
    const obj: NotContains<string> = new NotContains<string>("oneuptime");
    expect(obj).toBeInstanceOf(NotContains);
  });
});
