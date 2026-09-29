import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("StartsWith", () => {
  it("should create a StartsWith object with a valid value", () => {
    const value: string = "oneuptime";
    const obj: StartsWith<string> = new StartsWith<string>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: StartsWith<string> = new StartsWith<string>("oldValue");
    obj.value = "newValue";
    expect(obj.value).toBe("newValue");
  });

  it("should return the value using toString", () => {
    const obj: StartsWith<string> = new StartsWith<string>("oneuptime");
    expect(obj.toString()).toBe("oneuptime");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: StartsWith<string> = new StartsWith<string>("oneuptime");
    const expectedJSON: JSONObject = {
      _type: "StartsWith",
      value: "oneuptime",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a StartsWith object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "StartsWith",
      value: "oneuptime",
    };
    const obj: StartsWith<string> = StartsWith.fromJSON(jsonInput);
    expect(obj.value).toBe("oneuptime");
  });

  it("should default to an empty string when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "StartsWith",
    };
    const obj: StartsWith<string> = StartsWith.fromJSON(jsonInput);
    expect(obj.value).toBe("");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "oneuptime",
    };
    expect(() => {
      return StartsWith.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of StartsWith", () => {
    const obj: StartsWith<string> = new StartsWith<string>("oneuptime");
    expect(obj).toBeInstanceOf(StartsWith);
  });
});
