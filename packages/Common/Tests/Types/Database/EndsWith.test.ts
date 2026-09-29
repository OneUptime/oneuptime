import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("EndsWith", () => {
  it("should create an EndsWith object with a valid value", () => {
    const value: string = "oneuptime";
    const obj: EndsWith<string> = new EndsWith<string>(value);
    expect(obj.value).toBe(value);
  });

  it("should get and set the value property", () => {
    const obj: EndsWith<string> = new EndsWith<string>("oldValue");
    obj.value = "newValue";
    expect(obj.value).toBe("newValue");
  });

  it("should return the value using toString", () => {
    const obj: EndsWith<string> = new EndsWith<string>("oneuptime");
    expect(obj.toString()).toBe("oneuptime");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: EndsWith<string> = new EndsWith<string>("oneuptime");
    const expectedJSON: JSONObject = {
      _type: "EndsWith",
      value: "oneuptime",
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create an EndsWith object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "EndsWith",
      value: "oneuptime",
    };
    const obj: EndsWith<string> = EndsWith.fromJSON(jsonInput);
    expect(obj.value).toBe("oneuptime");
  });

  it("should default to an empty string when the JSON value is missing", () => {
    const jsonInput: JSONObject = {
      _type: "EndsWith",
    };
    const obj: EndsWith<string> = EndsWith.fromJSON(jsonInput);
    expect(obj.value).toBe("");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
      value: "oneuptime",
    };
    expect(() => {
      return EndsWith.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of EndsWith", () => {
    const obj: EndsWith<string> = new EndsWith<string>("oneuptime");
    expect(obj).toBeInstanceOf(EndsWith);
  });
});
