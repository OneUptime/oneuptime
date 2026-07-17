import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("MultiSearch", () => {
  it("should create a MultiSearch object with fields and value", () => {
    const obj: MultiSearch = new MultiSearch({
      fields: ["name", "email"],
      value: "demo",
    });
    expect(obj.fields).toEqual(["name", "email"]);
    expect(obj.value).toBe("demo");
  });

  it("should get and set the fields and value properties", () => {
    const obj: MultiSearch = new MultiSearch({ fields: ["a"], value: "x" });
    obj.fields = ["b", "c"];
    obj.value = "y";
    expect(obj.fields).toEqual(["b", "c"]);
    expect(obj.value).toBe("y");
  });

  it("should return the value using toString", () => {
    const obj: MultiSearch = new MultiSearch({
      fields: ["name"],
      value: "demo",
    });
    expect(obj.toString()).toBe("demo");
  });

  it("should generate the correct JSON representation using toJSON", () => {
    const obj: MultiSearch = new MultiSearch({
      fields: ["name"],
      value: "demo",
    });
    const expectedJSON: JSONObject = {
      _type: "MultiSearch",
      value: "demo",
      fields: ["name"],
    };
    expect(obj.toJSON()).toEqual(expectedJSON);
  });

  it("should create a MultiSearch object from valid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "MultiSearch",
      value: "demo",
      fields: ["name"],
    };
    const obj: MultiSearch = MultiSearch.fromJSON(jsonInput);
    expect(obj.value).toBe("demo");
    expect(obj.fields).toEqual(["name"]);
  });

  it("should default fields and value when missing in the JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "MultiSearch",
    };
    const obj: MultiSearch = MultiSearch.fromJSON(jsonInput);
    expect(obj.fields).toEqual([]);
    expect(obj.value).toBe("");
  });

  it("should throw a BadDataException when using invalid JSON input", () => {
    const jsonInput: JSONObject = {
      _type: "InvalidType",
    };
    expect(() => {
      return MultiSearch.fromJSON(jsonInput);
    }).toThrow(BadDataException);
  });

  it("should be an instance of MultiSearch", () => {
    const obj: MultiSearch = new MultiSearch({
      fields: ["name"],
      value: "demo",
    });
    expect(obj).toBeInstanceOf(MultiSearch);
  });
});
