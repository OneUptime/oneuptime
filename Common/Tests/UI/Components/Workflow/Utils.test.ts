/*
 * Utils.ts imports the whole database-model registry for
 * loadComponentsAndCategories, which nothing here exercises. Stubbing it keeps
 * this suite from type-checking several hundred model files to test two pure
 * functions.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import {
  componentInputTypeToFormFieldType,
  parseStringDictionaryValue,
} from "../../../../UI/Components/Workflow/Utils";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../../Types/JSON";
import { ComponentInputType } from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

describe("parseStringDictionaryValue", () => {
  test("treats an unset value as an empty dictionary", () => {
    expect(parseStringDictionaryValue(undefined)).toEqual({});
    expect(parseStringDictionaryValue(null)).toEqual({});
    expect(parseStringDictionaryValue("")).toEqual({});
    expect(parseStringDictionaryValue("   ")).toEqual({});
  });

  test("parses the JSON string shape every existing workflow stores", () => {
    expect(
      parseStringDictionaryValue('{"Authorization": "Bearer abc"}'),
    ).toEqual({
      Authorization: "Bearer abc",
    });
  });

  test("accepts JSON5, which is what the components themselves accept", () => {
    expect(parseStringDictionaryValue("{header1: 'value1'}")).toEqual({
      header1: "value1",
    });
    expect(parseStringDictionaryValue('{"a": "b",}')).toEqual({ a: "b" });
  });

  test("passes an already-parsed object straight through", () => {
    const value: JSONObject = { "X-Key": "v" };

    expect(parseStringDictionaryValue(value)).toEqual({ "X-Key": "v" });
  });

  test("keeps numbers and booleans, which the row editor can represent", () => {
    expect(parseStringDictionaryValue('{"n": 1, "b": true}')).toEqual({
      n: 1,
      b: true,
    });
  });

  test("declines a whole-field template, which is not JSON as written", () => {
    expect(
      parseStringDictionaryValue(
        "{{local.components.api-get-1.returnValues.response-headers}}",
      ),
    ).toBeNull();
  });

  test("declines text that does not parse, so it stays visible and fixable", () => {
    expect(parseStringDictionaryValue('{"a": ')).toBeNull();
    expect(parseStringDictionaryValue("not json")).toBeNull();
  });

  test("declines nested values the row editor would silently discard", () => {
    expect(parseStringDictionaryValue('{"a": {"b": 1}}')).toBeNull();
    expect(parseStringDictionaryValue('{"a": ["b"]}')).toBeNull();
    expect(parseStringDictionaryValue('{"a": null}')).toBeNull();
  });

  test("declines arrays and scalars, which are not dictionaries", () => {
    expect(parseStringDictionaryValue("[1, 2]")).toBeNull();
    expect(parseStringDictionaryValue("42")).toBeNull();
  });

  test("keeps a value containing a template inside a string", () => {
    expect(
      parseStringDictionaryValue(
        '{"Authorization": "Bearer {{local.variables.token}}"}',
      ),
    ).toEqual({
      Authorization: "Bearer {{local.variables.token}}",
    });
  });
});

describe("componentInputTypeToFormFieldType — StringDictionary", () => {
  test("uses the key/value editor for a value it can represent", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.StringDictionary,
        '{"a": "b"}',
      ).fieldType,
    ).toBe(FormFieldSchemaType.Dictionary);
  });

  test("uses the key/value editor for an unset value", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.StringDictionary,
        null,
      ).fieldType,
    ).toBe(FormFieldSchemaType.Dictionary);
  });

  test("falls back to the JSON editor for a whole-field template", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.StringDictionary,
        "{{local.components.a.returnValues.response-headers}}",
      ).fieldType,
    ).toBe(FormFieldSchemaType.JSON);
  });

  test("falls back to the JSON editor for a value that does not parse", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.StringDictionary,
        '{"a": ',
      ).fieldType,
    ).toBe(FormFieldSchemaType.JSON);
  });

  test("agrees with parseStringDictionaryValue for every case", () => {
    const samples: Array<unknown> = [
      undefined,
      null,
      "",
      '{"a":"b"}',
      "{a:'b'}",
      "{{local.variables.x}}",
      '{"a":{"b":1}}',
      "[1,2]",
      "garbage",
      { a: "b" },
    ];

    for (const sample of samples) {
      const expected: FormFieldSchemaType =
        parseStringDictionaryValue(sample) === null
          ? FormFieldSchemaType.JSON
          : FormFieldSchemaType.Dictionary;

      expect(
        componentInputTypeToFormFieldType(
          ComponentInputType.StringDictionary,
          sample,
        ).fieldType,
      ).toBe(expected);
    }
  });
});

describe("componentInputTypeToFormFieldType — unchanged mappings", () => {
  test("JSON-document types still use the code editor", () => {
    const jsonTypes: Array<ComponentInputType> = [
      ComponentInputType.JSON,
      ComponentInputType.JSONArray,
      ComponentInputType.Query,
      ComponentInputType.Select,
      ComponentInputType.BaseModel,
      ComponentInputType.BaseModelArray,
    ];

    for (const type of jsonTypes) {
      expect(componentInputTypeToFormFieldType(type, null).fieldType).toBe(
        FormFieldSchemaType.JSON,
      );
    }
  });

  test("simple types are untouched", () => {
    expect(
      componentInputTypeToFormFieldType(ComponentInputType.Email, null)
        .fieldType,
    ).toBe(FormFieldSchemaType.Email);
    expect(
      componentInputTypeToFormFieldType(ComponentInputType.URL, null).fieldType,
    ).toBe(FormFieldSchemaType.URL);
    expect(
      componentInputTypeToFormFieldType(ComponentInputType.Boolean, null)
        .fieldType,
    ).toBe(FormFieldSchemaType.Toggle);
  });
});
