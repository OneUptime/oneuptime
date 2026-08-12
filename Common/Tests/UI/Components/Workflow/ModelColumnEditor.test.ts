/*
 * The two pure decisions behind the column row editor: whether a stored value
 * can be shown as rows at all, and what the rows serialize back to.
 *
 * The serialization side matters most — the string this produces is handed
 * straight to the server, where JSONFunctions.deserialize has to turn the
 * operator wrappers back into the QueryHelper objects TypeORM understands.
 */

import {
  ModelColumnEditorMode,
  buildColumnValueJson,
  classifyColumnValueCompatibility,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../UI/Components/Workflow/ModelSchema";
import Dictionary from "../../../../Types/Dictionary";
import { DictionaryEntryValue } from "../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import { describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  id: string,
  type?: string | undefined,
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  id: string,
  type?: string | undefined,
): ModelSchemaColumn => {
  return {
    id: id,
    title: id,
    type: type || "ShortText",
    isRelation: false,
  };
};

const COLUMNS: Array<ModelSchemaColumn> = [
  makeColumn("_id", "ObjectID"),
  makeColumn("name"),
  makeColumn("createdAt", "Date"),
  makeColumn("isEnabled", "Boolean"),
];

describe("classifyColumnValueCompatibility — plain values", () => {
  test("an empty query is representable", () => {
    expect(
      classifyColumnValueCompatibility({}, COLUMNS, ModelColumnEditorMode.Query)
        .compatible,
    ).toBe(true);
  });

  test("scalar values are representable", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { name: "abc", isEnabled: true },
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("a null value is representable", () => {
    expect(
      classifyColumnValueCompatibility(
        { name: null } as unknown as JSONObject,
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(true);
  });

  test("text that is not a JSON object is not representable", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        null,
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toMatch(/isn't a JSON object/);
  });

  /*
   * An unknown column is exactly the "id" versus "_id" mistake. Say so, but
   * keep the rows — the builder needs to see the row to fix it.
   */
  test("an unknown column is reported without locking the editor", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { id: "abc" },
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(true);
    expect(result.reasons[0]).toMatch(/"id" isn't a known column/);
  });

  test("columns are not checked when the schema failed to load", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { anything: "abc" },
        [],
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe("classifyColumnValueCompatibility — operators", () => {
  test("a query shows the operators the rows support", () => {
    const supported: Array<string> = [
      ObjectType.EqualTo,
      ObjectType.NotEqual,
      ObjectType.Search,
      ObjectType.NotContains,
      ObjectType.StartsWith,
      ObjectType.EndsWith,
      ObjectType.GreaterThan,
      ObjectType.GreaterThanOrEqual,
      ObjectType.LessThan,
      ObjectType.LessThanOrEqual,
      ObjectType.IsNull,
      ObjectType.NotNull,
      ObjectType.Includes,
      ObjectType.IncludesNone,
    ];

    for (const objectType of supported) {
      const result: { compatible: boolean } = classifyColumnValueCompatibility(
        { name: { _type: objectType, value: "x" } },
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

      expect(result.compatible).toBe(true);
    }
  });

  test("an operator the rows cannot show keeps the JSON editor", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { createdAt: { _type: ObjectType.InBetween, value: "x" } },
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toMatch(/InBetween/);
  });

  /*
   * A record is a set of values to write. An operator there would be nonsense,
   * so it belongs in the JSON editor where the builder can see what they have.
   */
  test("an operator in a record is not representable", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { name: { _type: ObjectType.NotEqual, value: "x" } },
        COLUMNS,
        ModelColumnEditorMode.Record,
      );

    expect(result.compatible).toBe(false);
  });

  test("a nested relation query keeps the JSON editor", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { project: { _id: "abc" } },
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/nested record/);
  });

  test("a bare array keeps the JSON editor and suggests the operator", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { name: ["a", "b"] } as unknown as JSONObject,
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toMatch(/is any of/);
  });
});

describe("buildColumnValueJson", () => {
  test("an empty set collapses to empty text, so required still fires", () => {
    expect(buildColumnValueJson({})).toBe("");
  });

  test("a row with no column name is dropped", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      "": "orphan",
    } as Dictionary<DictionaryEntryValue>;

    expect(buildColumnValueJson(rows)).toBe("");
  });

  test("plain values serialize as plain JSON", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: "abc",
      isEnabled: true,
    } as Dictionary<DictionaryEntryValue>;

    expect(JSON.parse(buildColumnValueJson(rows))).toEqual({
      name: "abc",
      isEnabled: true,
    });
  });

  /*
   * The contract with the server: every operator wrapper has to come out as
   * {_type, value}, because that is the only shape JSONFunctions.deserialize
   * turns back into a QueryHelper object.
   */
  test("an operator serializes to the shape the server rehydrates", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: new NotEqual<string>("abc"),
    } as unknown as Dictionary<DictionaryEntryValue>;

    expect(JSON.parse(buildColumnValueJson(rows))).toEqual({
      name: { _type: ObjectType.NotEqual, value: "abc" },
    });
  });

  test("every operator the editor offers round-trips through JSON", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      a: new NotEqual<string>("x"),
      b: new Search("y"),
      c: new GreaterThan<number>(5),
      d: new IsNull(),
      e: new Includes(["p", "q"]),
    } as unknown as Dictionary<DictionaryEntryValue>;

    const parsed: JSONObject = JSON.parse(buildColumnValueJson(rows));

    expect((parsed["a"] as JSONObject)["_type"]).toBe(ObjectType.NotEqual);
    expect((parsed["b"] as JSONObject)["_type"]).toBe(ObjectType.Search);
    expect((parsed["c"] as JSONObject)["_type"]).toBe(ObjectType.GreaterThan);
    expect((parsed["d"] as JSONObject)["_type"]).toBe(ObjectType.IsNull);
    expect((parsed["e"] as JSONObject)["_type"]).toBe(ObjectType.Includes);
  });

  test("a template placeholder survives as an ordinary string value", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      _id: "{{local.components.api-get-1.returnValues.response-body}}",
    } as Dictionary<DictionaryEntryValue>;

    expect(JSON.parse(buildColumnValueJson(rows))).toEqual({
      _id: "{{local.components.api-get-1.returnValues.response-body}}",
    });
  });

  test("what it emits is readable again by the compatibility check", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: new NotEqual<string>("abc"),
      isEnabled: true,
    } as unknown as Dictionary<DictionaryEntryValue>;

    const roundTripped: JSONObject = JSON.parse(buildColumnValueJson(rows));

    expect(
      classifyColumnValueCompatibility(
        roundTripped,
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(true);
  });
});
