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
  ParsedQuery,
  buildColumnValueJson,
  classifyColumnValueCompatibility,
  normalizeInitialValue,
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
    expect(buildColumnValueJson({}, ModelColumnEditorMode.Query)).toBe("");
  });

  test("a row with no column name is dropped", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      "": "orphan",
    } as Dictionary<DictionaryEntryValue>;

    expect(buildColumnValueJson(rows, ModelColumnEditorMode.Query)).toBe("");
  });

  test("plain values serialize as plain JSON", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: "abc",
      isEnabled: true,
    } as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Query)),
    ).toEqual({
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

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Query)),
    ).toEqual({
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

    const parsed: JSONObject = JSON.parse(
      buildColumnValueJson(rows, ModelColumnEditorMode.Query),
    );

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

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Query)),
    ).toEqual({
      _id: "{{local.components.api-get-1.returnValues.response-body}}",
    });
  });

  test("what it emits is readable again by the compatibility check", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: new NotEqual<string>("abc"),
      isEnabled: true,
    } as unknown as Dictionary<DictionaryEntryValue>;

    const roundTripped: JSONObject = JSON.parse(
      buildColumnValueJson(rows, ModelColumnEditorMode.Query),
    );

    expect(
      classifyColumnValueCompatibility(
        roundTripped,
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(true);
  });
});

/*
 * Record mode drives the create and update payloads, which is the half of this
 * editor that never actually rendered: ArgumentsForm selected it only for
 * ComponentInputType.BaseModel, and no component declares an argument of that
 * type. These pin the behaviour that half needs now that it is reachable.
 */
describe("buildColumnValueJson — record mode", () => {
  test("drops a row whose value is still empty", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: "acme",
      secretValue: "",
    } as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Record)),
    ).toEqual({ name: "acme" });
  });

  /*
   * The editor opens with a blank row for every column a create must be given.
   * Serialized, those rows are "" — a non-empty string, which both
   * validateRequired and GraphLint's isEmptyArgumentValue read as "filled in".
   * Keeping them would let an untouched Create One save as if it were complete.
   */
  test("a form of nothing but seeded blank rows still reads as empty", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: "",
      secretValue: "",
    } as Dictionary<DictionaryEntryValue>;

    expect(buildColumnValueJson(rows, ModelColumnEditorMode.Record)).toBe("");
  });

  test("false and zero are values, not emptiness", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      isEnabled: false,
      count: 0,
    } as unknown as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Record)),
    ).toEqual({ isEnabled: false, count: 0 });
  });

  /*
   * Query mode must keep them: matching a column against "" is a real
   * condition, and silently dropping it would change which records a step acts
   * on.
   */
  test("query mode keeps an empty value, because matching on it is a real filter", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      name: "",
    } as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Query)),
    ).toEqual({ name: "" });
  });

  test("a row with no column name is dropped in record mode too", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      "": "orphan",
      name: "acme",
    } as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Record)),
    ).toEqual({ name: "acme" });
  });

  test("a reference typed into a row survives as an ordinary string", () => {
    const rows: Dictionary<DictionaryEntryValue> = {
      monitorId:
        "{{local.components.monitor-find-one-1.returnValues.model._id}}",
    } as Dictionary<DictionaryEntryValue>;

    expect(
      JSON.parse(buildColumnValueJson(rows, ModelColumnEditorMode.Record)),
    ).toEqual({
      monitorId:
        "{{local.components.monitor-find-one-1.returnValues.model._id}}",
    });
  });
});

describe("classifyColumnValueCompatibility — mode-specific wording", () => {
  /*
   * Record mode renders with enableOperators={false}, so telling its reader to
   * use the "is any of" operator was pointing at a control that is not on their
   * screen.
   */
  test("a list in a record does not suggest an operator", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { name: ["a", "b"] } as unknown as JSONObject,
        COLUMNS,
        ModelColumnEditorMode.Record,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).not.toMatch(/is any of/);
    expect(result.reasons[0]).toMatch(/Keep editing as JSON/);
  });

  test("a list in a query still suggests the operator", () => {
    const result: { reasons: Array<string> } = classifyColumnValueCompatibility(
      { name: ["a", "b"] } as unknown as JSONObject,
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(result.reasons[0]).toMatch(/is any of/);
  });

  /*
   * A bare {{ }} reference where a value goes is not JSON, so it cannot be
   * rows — but it is a perfectly good workflow value, and both GraphLint and
   * form validation accept it because they mask references before parsing.
   * Calling it "not a JSON object" told the builder something the canvas
   * contradicted.
   */
  test("a template reference is explained as such, not called broken", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        null,
        COLUMNS,
        ModelColumnEditorMode.Record,
        true,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toMatch(/\{\{ \}\} reference/);
    expect(result.reasons[0]).not.toMatch(/isn't a JSON object/);
  });

  test("genuinely broken text is still called that", () => {
    const result: { reasons: Array<string> } = classifyColumnValueCompatibility(
      null,
      COLUMNS,
      ModelColumnEditorMode.Record,
      false,
    );

    expect(result.reasons[0]).toMatch(/isn't a JSON object/);
  });
});

describe("normalizeInitialValue", () => {
  test("an absent value is an empty, representable record", () => {
    for (const empty of [null, undefined, ""]) {
      const parsed: ParsedQuery = normalizeInitialValue(empty);

      expect(parsed.parsed).toEqual({});
      expect(parsed.text).toBe("");
      expect(parsed.hasTemplateExpressions).toBe(false);
    }
  });

  test("an object is taken as-is and pretty-printed for the JSON editor", () => {
    const parsed: ParsedQuery = normalizeInitialValue({ name: "acme" });

    expect(parsed.parsed).toEqual({ name: "acme" });
    expect(JSON.parse(parsed.text)).toEqual({ name: "acme" });
  });

  test("a stored JSON string parses into rows", () => {
    const parsed: ParsedQuery = normalizeInitialValue('{"name":"acme"}');

    expect(parsed.parsed).toEqual({ name: "acme" });
    expect(parsed.hasTemplateExpressions).toBe(false);
  });

  /*
   * The case that was misreported. checkJSONSyntax masks {{...}} before
   * parsing, so GraphLint and Validation both consider this valid; the editor
   * used bare JSON.parse and so disagreed with them silently.
   */
  test("a bare reference where a value goes is flagged as a reference", () => {
    const parsed: ParsedQuery = normalizeInitialValue(
      '{"retries": {{local.variables.retryCount}}}',
    );

    expect(parsed.parsed).toBeNull();
    expect(parsed.hasTemplateExpressions).toBe(true);
    // The stored text is preserved exactly, for the JSON editor to show.
    expect(parsed.text).toBe('{"retries": {{local.variables.retryCount}}}');
  });

  /*
   * A reference inside a string is ordinary JSON and must stay editable as
   * rows — that is the common case, and locking it would be a regression.
   */
  test("a quoted reference is ordinary JSON and stays as rows", () => {
    const parsed: ParsedQuery = normalizeInitialValue(
      '{"name": "{{local.variables.name}}"}',
    );

    expect(parsed.parsed).toEqual({ name: "{{local.variables.name}}" });
    expect(parsed.hasTemplateExpressions).toBe(false);
  });

  test("text that is broken with or without references is not excused", () => {
    const parsed: ParsedQuery = normalizeInitialValue(
      '{"name": {{local.variables.x}}',
    );

    expect(parsed.parsed).toBeNull();
    expect(parsed.hasTemplateExpressions).toBe(false);
  });

  test("a JSON array is not a record", () => {
    const parsed: ParsedQuery = normalizeInitialValue('[{"name":"acme"}]');

    expect(parsed.parsed).toBeNull();
    expect(parsed.hasTemplateExpressions).toBe(false);
  });

  test("a JSON scalar is not a record either", () => {
    expect(normalizeInitialValue('"just a string"').parsed).toBeNull();
    expect(normalizeInitialValue("42").parsed).toBeNull();
  });
});
