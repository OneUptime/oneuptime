/*
 * The contract that matters: what the row editor writes into a workflow
 * argument has to survive the trip to the server and come back out as the
 * QueryHelper objects TypeORM understands.
 *
 * The builder writes a JSON string. RunWorkflow.getComponentArguments parses
 * it, and FindManyBaseModel (and every other database component) hands the
 * result to JSONFunctions.deserialize before it reaches the query builder.
 * This walks that whole path, so a change to either end that breaks the other
 * fails here rather than at run time.
 */

import {
  ModelColumnEditorMode,
  buildColumnValueJson,
  classifyColumnValueCompatibility,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import Dictionary from "../../../../Types/Dictionary";
import { DictionaryEntryValue } from "../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import { describe, expect, test } from "@jest/globals";

type RoundTripFunction = (rows: Dictionary<DictionaryEntryValue>) => JSONObject;

/**
 * Builder rows -> stored string -> parsed by the runner -> deserialized by the
 * component. Exactly the path a real run takes.
 */
const roundTrip: RoundTripFunction = (
  rows: Dictionary<DictionaryEntryValue>,
): JSONObject => {
  const stored: string = buildColumnValueJson(
    rows,
    ModelColumnEditorMode.Query,
  );
  const parsedByRunner: JSONObject = JSON.parse(stored);

  return JSONFunctions.deserialize(parsedByRunner) as JSONObject;
};

describe("row editor output survives the server's deserialization", () => {
  test("a plain equality stays a plain value", () => {
    const result: JSONObject = roundTrip({
      name: "acme",
    } as Dictionary<DictionaryEntryValue>);

    expect(result["name"]).toBe("acme");
  });

  test("a not-equal comes back as a NotEqual", () => {
    const result: JSONObject = roundTrip({
      name: new NotEqual<string>("acme"),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["name"]).toBeInstanceOf(NotEqual);
    expect((result["name"] as NotEqual<string>).value).toBe("acme");
  });

  test("a contains comes back as a Search", () => {
    const result: JSONObject = roundTrip({
      name: new Search("acm"),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["name"]).toBeInstanceOf(Search);
  });

  test("a starts-with comes back as a StartsWith", () => {
    const result: JSONObject = roundTrip({
      name: new StartsWith("ac"),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["name"]).toBeInstanceOf(StartsWith);
  });

  test("numeric comparisons keep their type and their number", () => {
    const result: JSONObject = roundTrip({
      a: new GreaterThan<number>(5),
      b: new GreaterThanOrEqual<number>(6),
      c: new LessThan<number>(7),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["a"]).toBeInstanceOf(GreaterThan);
    expect((result["a"] as GreaterThan<number>).value).toBe(5);
    expect(result["b"]).toBeInstanceOf(GreaterThanOrEqual);
    expect(result["c"]).toBeInstanceOf(LessThan);
  });

  test("the null checks come back as IsNull and NotNull", () => {
    const result: JSONObject = roundTrip({
      a: new IsNull(),
      b: new NotNull(),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["a"]).toBeInstanceOf(IsNull);
    expect(result["b"]).toBeInstanceOf(NotNull);
  });

  test("membership operators keep their whole list", () => {
    const result: JSONObject = roundTrip({
      a: new Includes(["x", "y"]),
      b: new IncludesNone(["z"]),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["a"]).toBeInstanceOf(Includes);
    expect((result["a"] as Includes).values).toEqual(["x", "y"]);
    expect(result["b"]).toBeInstanceOf(IncludesNone);
  });

  test("equal-to-or-null survives", () => {
    const result: JSONObject = roundTrip({
      a: new EqualToOrNull<string>("x"),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(result["a"]).toBeInstanceOf(EqualToOrNull);
  });

  test("several conditions in one query all survive together", () => {
    const result: JSONObject = roundTrip({
      name: new Search("acme"),
      isEnabled: true,
      count: new GreaterThan<number>(3),
      deletedAt: new IsNull(),
    } as unknown as Dictionary<DictionaryEntryValue>);

    expect(Object.keys(result).sort()).toEqual([
      "count",
      "deletedAt",
      "isEnabled",
      "name",
    ]);
    expect(result["isEnabled"]).toBe(true);
    expect(result["name"]).toBeInstanceOf(Search);
  });

  /*
   * A template is substituted before the component ever sees the value, so at
   * this point it is just a string — it must not be mistaken for structure.
   */
  test("a template placeholder passes through untouched", () => {
    const result: JSONObject = roundTrip({
      _id: "{{local.components.api-get-1.returnValues.response-body}}",
    } as Dictionary<DictionaryEntryValue>);

    expect(result["_id"]).toBe(
      "{{local.components.api-get-1.returnValues.response-body}}",
    );
  });

  test("a record of values to write deserializes to plain values", () => {
    const stored: string = buildColumnValueJson(
      {
        name: "acme",
        isEnabled: true,
        count: 4,
      } as Dictionary<DictionaryEntryValue>,
      ModelColumnEditorMode.Record,
    );

    expect(JSONFunctions.deserialize(JSON.parse(stored))).toEqual({
      name: "acme",
      isEnabled: true,
      count: 4,
    });
  });

  test("what the editor emits, the editor can read back", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: new Search("acme"),
      count: new GreaterThan<number>(3),
    } as unknown as Dictionary<DictionaryEntryValue>;

    const stored: JSONObject = JSON.parse(
      buildColumnValueJson(rows, ModelColumnEditorMode.Query),
    );

    expect(
      classifyColumnValueCompatibility(stored, [], ModelColumnEditorMode.Query)
        .compatible,
    ).toBe(true);
  });
});
