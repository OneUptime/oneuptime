/*
 * Stored JSON -> rows -> stored JSON.
 *
 * This is where the risk of the whole change lives. The editor is mounted every
 * time someone opens a step's settings, so a value that does not survive being
 * read and written back is a workflow silently rewritten by being looked at.
 * Most of what follows is about that: fixed points, and bytes that match what
 * the previous editor produced.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import GreaterThan from "../../../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../../Types/BaseDatabase/LessThan";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../../Types/BaseDatabase/Search";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  buildDictionaryValue,
} from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
  makeColumnRow,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import {
  buildOperatorValue,
  classifyRowValue,
  containsTemplateExpression,
  emitRowValue,
  rowIssue,
  rowsFromParsedValue,
  seedRequiredRows,
  serializeColumnRows,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRowSerialization";
import {
  ModelColumnEditorMode,
  buildColumnValueJson,
  normalizeInitialValue,
} from "../../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
): ModelSchemaColumn => {
  return {
    title: overrides.id,
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

const COLUMNS: Array<ModelSchemaColumn> = [
  makeColumn({ id: "_id", type: TableColumnType.ObjectID }),
  makeColumn({ id: "name", type: TableColumnType.Name, required: true }),
  makeColumn({ id: "color", type: TableColumnType.Color, required: true }),
  makeColumn({ id: "description", type: TableColumnType.LongText }),
  makeColumn({ id: "port", type: TableColumnType.Port }),
  makeColumn({ id: "isEnabled", type: TableColumnType.Boolean }),
  makeColumn({ id: "createdAt", type: TableColumnType.Date }),
  makeColumn({
    id: "projectId",
    type: TableColumnType.ObjectID,
    isTenantColumn: true,
    required: true,
  }),
  makeColumn({
    id: "order",
    type: TableColumnType.Number,
    required: true,
    hasDefault: true,
  }),
];

type ParseFunction = (
  text: string,
  mode: ModelColumnEditorMode,
) => Array<ModelColumnRow>;

const parse: ParseFunction = (
  text: string,
  mode: ModelColumnEditorMode,
): Array<ModelColumnRow> => {
  return rowsFromParsedValue(normalizeInitialValue(text).parsed, COLUMNS, mode);
};

type RoundTripFunction = (text: string, mode: ModelColumnEditorMode) => string;

/** Read the stored value and write it straight back out, touching nothing. */
const roundTrip: RoundTripFunction = (
  text: string,
  mode: ModelColumnEditorMode,
): string => {
  return serializeColumnRows(parse(text, mode), COLUMNS, mode);
};

describe("containsTemplateExpression", () => {
  test("uses the runtime's own matcher, so it agrees with what will be substituted", () => {
    expect(containsTemplateExpression("{{local.variables.apiKey}}")).toBe(true);
    expect(containsTemplateExpression("prefix {{a}} suffix")).toBe(true);
    expect(containsTemplateExpression("nothing here")).toBe(false);
    expect(containsTemplateExpression("{ not a reference }")).toBe(false);
  });

  test("is not confused by a previous call's match position", () => {
    /*
     * A global RegExp carries lastIndex between calls. Built fresh each time,
     * so the same string answers the same way twice.
     */
    expect(containsTemplateExpression("{{a}}")).toBe(true);
    expect(containsTemplateExpression("{{a}}")).toBe(true);
  });
});

describe("classifyRowValue — how a stored value is edited", () => {
  test("a reference is a reference on any column type", () => {
    for (const control of Object.values(ModelColumnControl)) {
      expect(classifyRowValue(control, "{{local.variables.x}}").valueMode).toBe(
        ColumnValueMode.Reference,
      );
    }
  });

  test("a value the control can hold is edited normally", () => {
    expect(classifyRowValue(ModelColumnControl.Number, 8080)).toEqual({
      valueMode: ColumnValueMode.Literal,
      text: "8080",
    });
    expect(classifyRowValue(ModelColumnControl.Boolean, false)).toEqual({
      valueMode: ColumnValueMode.Literal,
      text: "false",
    });
  });

  test("a value whose type disagrees with the column is kept raw", () => {
    expect(classifyRowValue(ModelColumnControl.Number, "8080")).toEqual({
      valueMode: ColumnValueMode.Raw,
      text: "8080",
      rawValue: "8080",
    });
  });

  test('a value a boolean column cannot hold keeps its own text, not "false"', () => {
    /*
     * Spelling every non-true value "false" put a stored "true" on screen as
     * the word false - the opposite of what the workflow does - and the same
     * function names the text of a raw row, where the value is by definition
     * not a boolean.
     */
    expect(classifyRowValue(ModelColumnControl.Boolean, "true")).toEqual({
      valueMode: ColumnValueMode.Raw,
      text: "true",
      rawValue: "true",
    });
    expect(classifyRowValue(ModelColumnControl.Boolean, "yes").text).toBe(
      "yes",
    );
    expect(classifyRowValue(ModelColumnControl.Boolean, 1).text).toBe("1");
  });

  test("a real boolean still reads as true or false", () => {
    expect(classifyRowValue(ModelColumnControl.Boolean, true).text).toBe(
      "true",
    );
    expect(classifyRowValue(ModelColumnControl.Boolean, false).text).toBe(
      "false",
    );
  });

  test("null is kept raw, because an empty box would mean something else", () => {
    expect(classifyRowValue(ModelColumnControl.Text, null)).toEqual({
      valueMode: ColumnValueMode.Raw,
      text: "",
      rawValue: null,
    });
  });
});

describe("rowsFromParsedValue — record mode", () => {
  test("keys keep the order they were written in", () => {
    const rows: Array<ModelColumnRow> = parse(
      '{"color":"#fff","name":"Acknowledged","_id":"1"}',
      ModelColumnEditorMode.Record,
    );

    expect(
      rows.map((row: ModelColumnRow) => {
        return row.columnId;
      }),
    ).toEqual(["color", "name", "_id"]);
  });

  test("every record row is an equality — a record cannot save a comparison", () => {
    const rows: Array<ModelColumnRow> = parse(
      '{"name":"Acknowledged"}',
      ModelColumnEditorMode.Record,
    );

    expect(rows[0]!.operator).toBe(DictionaryFilterOperator.EqualTo);
  });

  test("a column the model does not describe still gets a row", () => {
    const rows: Array<ModelColumnRow> = parse(
      '{"id":"1"}',
      ModelColumnEditorMode.Record,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.columnId).toBe("id");
  });

  test("nothing stored is no rows, not one blank one", () => {
    expect(parse("", ModelColumnEditorMode.Record)).toEqual([]);
  });
});

describe("rowsFromParsedValue — query mode", () => {
  test("an operator wrapper is recovered as its operator", () => {
    const rows: Array<ModelColumnRow> = parse(
      JSON.stringify({ name: new Search<string>("acme") }),
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]!.operator).toBe(DictionaryFilterOperator.Contains);
    expect(rows[0]!.text).toBe("acme");
  });

  test("a value-less operator keeps no value", () => {
    const rows: Array<ModelColumnRow> = parse(
      JSON.stringify({ name: new IsNull() }),
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]!.operator).toBe(DictionaryFilterOperator.IsEmpty);
    expect(rows[0]!.text).toBe("");
  });

  test("a membership list is recovered whole", () => {
    const rows: Array<ModelColumnRow> = parse(
      JSON.stringify({ name: new Includes(["a", "b"]) }),
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]!.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(rows[0]!.values).toEqual(["a", "b"]);
  });

  test("the scalar inside a wrapper keeps its own type", () => {
    /*
     * detectOperatorFromValue stringifies for display; a row has to see the
     * number so it does not decide the value is a mismatched string.
     */
    const rows: Array<ModelColumnRow> = parse(
      JSON.stringify({ port: new GreaterThan<number>(8080) }),
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]!.valueMode).toBe(ColumnValueMode.Literal);
    expect(rows[0]!.text).toBe("8080");
  });
});

describe("serializeColumnRows — the value each control emits", () => {
  test("a number column emits a JSON number", () => {
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "port", text: "8080" })],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"port":8080}');
  });

  test("a boolean column emits a JSON boolean", () => {
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "isEnabled", text: "false" })],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"isEnabled":false}');
  });

  test("a date column emits its ISO string", () => {
    expect(
      serializeColumnRows(
        [
          makeColumnRow({
            columnId: "createdAt",
            text: "2026-08-15T09:30:00.000Z",
          }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"createdAt":"2026-08-15T09:30:00.000Z"}');
  });

  test("a text column emits a string", () => {
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "name", text: "Acknowledged" })],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"name":"Acknowledged"}');
  });

  test("text that is not a number is written as text, not dropped and not NaN", () => {
    /*
     * The row shows why it is wrong. Throwing the value away would take the
     * builder's work with it, and NaN would serialize to null.
     */
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "port", text: "eighty eighty" })],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"port":"eighty eighty"}');
  });

  test("a reference is emitted quoted, whatever the column type", () => {
    const reference: string = "{{local.variables.port}}";

    expect(
      serializeColumnRows(
        [
          makeColumnRow({
            columnId: "port",
            text: reference,
            valueMode: ColumnValueMode.Reference,
          }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe(`{"port":"${reference}"}`);
  });

  test("a raw value is written back exactly as it was read", () => {
    expect(
      serializeColumnRows(
        [
          makeColumnRow({
            columnId: "port",
            text: "8080",
            valueMode: ColumnValueMode.Raw,
            rawValue: "8080",
          }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"port":"8080"}');
  });
});

describe("serializeColumnRows — what is kept and what is dropped", () => {
  test("a record drops a field with nothing in it", () => {
    expect(
      serializeColumnRows(
        [
          makeColumnRow({ columnId: "name", text: "Acknowledged" }),
          makeColumnRow({ columnId: "color", text: "" }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"name":"Acknowledged"}');
  });

  test("a record keeps false, zero and null — they are values, not blanks", () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({ columnId: "isEnabled", text: "false" }),
        makeColumnRow({ columnId: "port", text: "0" }),
        makeColumnRow({
          columnId: "name",
          valueMode: ColumnValueMode.Raw,
          rawValue: null,
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Record,
    );

    expect(JSON.parse(stored)).toEqual({
      isEnabled: false,
      port: 0,
      name: null,
    });
  });

  test('a query keeps an empty condition — matching against "" is a real filter', () => {
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "name", text: "" })],
        COLUMNS,
        ModelColumnEditorMode.Query,
      ),
    ).toBe('{"name":""}');
  });

  test('a row with no column chosen is dropped rather than written as ""', () => {
    expect(
      serializeColumnRows(
        [
          makeColumnRow({ columnId: "", text: "orphan" }),
          makeColumnRow({ columnId: "name", text: "Acknowledged" }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe('{"name":"Acknowledged"}');
  });

  test("nothing at all collapses to the empty string, not to {}", () => {
    /*
     * Form validation and the graph linter both read "" as "this required
     * argument has not been filled in". "{}" would read as filled.
     */
    expect(serializeColumnRows([], COLUMNS, ModelColumnEditorMode.Record)).toBe(
      "",
    );
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "name", text: "" })],
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe("");
  });
});

describe("serializeColumnRows — byte-for-byte with the editor it replaces", () => {
  type CaseType = {
    operator: DictionaryFilterOperator;
    row: Partial<ModelColumnRow>;
    entry: DictionaryEntryValue;
  };

  /*
   * Each case is the same condition expressed twice: as a row, and as the
   * dictionary the previous editor would have handed buildColumnValueJson. The
   * two have to produce identical bytes, because the wire format is what the
   * server's deserializer is written against.
   */
  const cases: Array<CaseType> = [
    {
      operator: DictionaryFilterOperator.EqualTo,
      row: { text: "acme" },
      entry: "acme",
    },
    {
      operator: DictionaryFilterOperator.NotEqual,
      row: { text: "acme" },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.NotEqual,
        rawValue: "acme",
      }),
    },
    {
      operator: DictionaryFilterOperator.Contains,
      row: { text: "acme" },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.Contains,
        rawValue: "acme",
      }),
    },
    {
      operator: DictionaryFilterOperator.NotContains,
      row: { text: "acme" },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.NotContains,
        rawValue: "acme",
      }),
    },
    {
      operator: DictionaryFilterOperator.StartsWith,
      row: { text: "ac" },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.StartsWith,
        rawValue: "ac",
      }),
    },
    {
      operator: DictionaryFilterOperator.EndsWith,
      row: { text: "me" },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.EndsWith,
        rawValue: "me",
      }),
    },
    {
      operator: DictionaryFilterOperator.IsEmpty,
      row: {},
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.IsEmpty,
        rawValue: "",
      }),
    },
    {
      operator: DictionaryFilterOperator.IsNotEmpty,
      row: {},
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.IsNotEmpty,
        rawValue: "",
      }),
    },
    {
      operator: DictionaryFilterOperator.IsAnyOf,
      row: { values: ["a", "b"] },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.IsAnyOf,
        rawValue: "",
        rawValues: ["a", "b"],
      }),
    },
    {
      operator: DictionaryFilterOperator.IsNoneOf,
      row: { values: ["a", "b"] },
      entry: buildDictionaryValue({
        operator: DictionaryFilterOperator.IsNoneOf,
        rawValue: "",
        rawValues: ["a", "b"],
      }),
    },
  ];

  test.each(cases)(
    "$operator on a text column emits what the dictionary form emitted",
    (testCase: CaseType) => {
      const fromRows: string = serializeColumnRows(
        [
          makeColumnRow({
            columnId: "name",
            operator: testCase.operator,
            ...testCase.row,
          }),
        ],
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

      const fromDictionary: string = buildColumnValueJson(
        { name: testCase.entry } as Dictionary<DictionaryEntryValue>,
        ModelColumnEditorMode.Query,
      );

      expect(fromRows).toBe(fromDictionary);
    },
  );

  test("the numeric comparisons emit what the dictionary form emitted", () => {
    const numericOperators: Array<DictionaryFilterOperator> = [
      DictionaryFilterOperator.GreaterThan,
      DictionaryFilterOperator.GreaterThanOrEqual,
      DictionaryFilterOperator.LessThan,
      DictionaryFilterOperator.LessThanOrEqual,
    ];

    for (const operator of numericOperators) {
      const fromRows: string = serializeColumnRows(
        [makeColumnRow({ columnId: "port", operator: operator, text: "80" })],
        COLUMNS,
        ModelColumnEditorMode.Query,
      );

      const fromDictionary: string = buildColumnValueJson(
        {
          port: buildDictionaryValue({ operator: operator, rawValue: "80" }),
        } as Dictionary<DictionaryEntryValue>,
        ModelColumnEditorMode.Query,
      );

      expect(fromRows).toBe(fromDictionary);
    }
  });
});

describe("serializeColumnRows — the comparison that used to become NaN", () => {
  test('a reference under "is after" keeps the reference', () => {
    /*
     * buildDictionaryValue does Number(text) for the ordering operators, so a
     * reference became NaN and JSON.stringify wrote it as null - a query
     * against NULL that matches nothing and reports no error at all.
     */
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({
          columnId: "createdAt",
          operator: DictionaryFilterOperator.GreaterThan,
          valueMode: ColumnValueMode.Reference,
          text: "{{local.variables.since}}",
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(JSON.parse(stored)).toEqual({
      createdAt: {
        _type: "GreaterThan",
        value: "{{local.variables.since}}",
      },
    });
  });

  test('a date under "is before" keeps the date', () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({
          columnId: "createdAt",
          operator: DictionaryFilterOperator.LessThan,
          text: "2026-08-15T09:30:00.000Z",
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(JSON.parse(stored)).toEqual({
      createdAt: {
        _type: "LessThan",
        value: "2026-08-15T09:30:00.000Z",
      },
    });
  });

  test("a real number is still emitted as a number", () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({
          columnId: "port",
          operator: DictionaryFilterOperator.GreaterThan,
          text: "8080",
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(JSON.parse(stored)).toEqual({
      port: { _type: "GreaterThan", value: 8080 },
    });
  });
});

describe("what the editor writes, the server can read", () => {
  type DeserializeFunction = (stored: string) => JSONObject;

  /*
   * The path a real run takes: the runner JSON.parses the stored string and the
   * database component hands the result to JSONFunctions.deserialize.
   */
  const deserialize: DeserializeFunction = (stored: string): JSONObject => {
    return JSONFunctions.deserialize(JSON.parse(stored)) as JSONObject;
  };

  test("each operator comes back as its own query helper", () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({
          columnId: "name",
          operator: DictionaryFilterOperator.NotEqual,
          text: "acme",
        }),
        makeColumnRow({
          columnId: "description",
          operator: DictionaryFilterOperator.Contains,
          text: "down",
        }),
        makeColumnRow({
          columnId: "port",
          operator: DictionaryFilterOperator.LessThan,
          text: "9000",
        }),
        makeColumnRow({
          columnId: "createdAt",
          operator: DictionaryFilterOperator.IsEmpty,
        }),
        makeColumnRow({
          columnId: "_id",
          operator: DictionaryFilterOperator.IsNotEmpty,
        }),
        makeColumnRow({
          columnId: "color",
          operator: DictionaryFilterOperator.IsAnyOf,
          values: ["#fff", "#000"],
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    const result: JSONObject = deserialize(stored);

    expect(result["name"]).toBeInstanceOf(NotEqual);
    expect((result["name"] as NotEqual<string>).value).toBe("acme");
    expect(result["description"]).toBeInstanceOf(Search);
    expect(result["port"]).toBeInstanceOf(LessThan);
    expect((result["port"] as LessThan<number>).value).toBe(9000);
    expect(result["createdAt"]).toBeInstanceOf(IsNull);
    expect(result["_id"]).toBeInstanceOf(NotNull);
    expect(result["color"]).toBeInstanceOf(Includes);
    expect((result["color"] as Includes).values).toEqual(["#fff", "#000"]);
  });

  test("an exclusion list comes back as IncludesNone", () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({
          columnId: "name",
          operator: DictionaryFilterOperator.IsNoneOf,
          values: ["a"],
        }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(deserialize(stored)["name"]).toBeInstanceOf(IncludesNone);
  });

  test("a record of typed values deserializes to plain values", () => {
    const stored: string = serializeColumnRows(
      [
        makeColumnRow({ columnId: "name", text: "Acknowledged" }),
        makeColumnRow({ columnId: "port", text: "8080" }),
        makeColumnRow({ columnId: "isEnabled", text: "true" }),
      ],
      COLUMNS,
      ModelColumnEditorMode.Record,
    );

    expect(deserialize(stored)).toEqual({
      name: "Acknowledged",
      port: 8080,
      isEnabled: true,
    });
  });
});

describe("reading a stored value and writing it straight back changes nothing", () => {
  const fixtures: Array<{ text: string; mode: ModelColumnEditorMode }> = [
    { text: '{"name":"acme"}', mode: ModelColumnEditorMode.Record },
    { text: '{"port":8080}', mode: ModelColumnEditorMode.Record },
    { text: '{"port":"8080"}', mode: ModelColumnEditorMode.Record },
    { text: '{"isEnabled":false}', mode: ModelColumnEditorMode.Record },
    { text: '{"name":null}', mode: ModelColumnEditorMode.Record },
    {
      text: '{"createdAt":"2026-08-15T09:30:00.000Z"}',
      mode: ModelColumnEditorMode.Record,
    },
    {
      text: '{"name":"{{local.variables.name}}"}',
      mode: ModelColumnEditorMode.Record,
    },
    { text: '{"id":"legacy"}', mode: ModelColumnEditorMode.Record },
    {
      text: '{"color":"#ffffff","name":"a"}',
      mode: ModelColumnEditorMode.Record,
    },
    { text: '{"name":""}', mode: ModelColumnEditorMode.Query },
    {
      text: JSON.stringify({ name: new Search<string>("acme") }),
      mode: ModelColumnEditorMode.Query,
    },
    {
      text: JSON.stringify({ port: new GreaterThan<number>(8080) }),
      mode: ModelColumnEditorMode.Query,
    },
    {
      text: JSON.stringify({ createdAt: new IsNull() }),
      mode: ModelColumnEditorMode.Query,
    },
    {
      text: JSON.stringify({ color: new Includes(["#fff", "#000"]) }),
      mode: ModelColumnEditorMode.Query,
    },
    {
      text: JSON.stringify({ name: new IncludesNone(["a"]) }),
      mode: ModelColumnEditorMode.Query,
    },
  ];

  test.each(fixtures)(
    "$text survives being opened and written back",
    (fixture: { text: string; mode: ModelColumnEditorMode }) => {
      expect(roundTrip(fixture.text, fixture.mode)).toBe(fixture.text);
    },
  );

  test("and survives it a second time, so there is no slow drift", () => {
    for (const fixture of fixtures) {
      const once: string = roundTrip(fixture.text, fixture.mode);
      expect(roundTrip(once, fixture.mode)).toBe(once);
    }
  });

  test("key order is preserved rather than sorted into the picker's order", () => {
    const text: string = '{"port":1,"_id":"x","name":"a"}';

    expect(roundTrip(text, ModelColumnEditorMode.Record)).toBe(text);
  });
});

describe("seedRequiredRows", () => {
  test("adds a blank row for each column a create must be given", () => {
    const rows: Array<ModelColumnRow> = seedRequiredRows([], COLUMNS);

    expect(
      rows.map((row: ModelColumnRow) => {
        return row.columnId;
      }),
    ).toEqual(["name", "color"]);
  });

  test("leaves out anything with a default, and the column the runner stamps", () => {
    const seededIds: Array<string> = seedRequiredRows([], COLUMNS).map(
      (row: ModelColumnRow) => {
        return row.columnId;
      },
    );

    // `order` is required but carries a default; `projectId` is the tenant column.
    expect(seededIds).not.toContain("order");
    expect(seededIds).not.toContain("projectId");
  });

  test("appends after what was stored, so stored key order is untouched", () => {
    const stored: Array<ModelColumnRow> = [
      makeColumnRow({ columnId: "color", text: "#fff" }),
    ];

    expect(
      seedRequiredRows(stored, COLUMNS).map((row: ModelColumnRow) => {
        return row.columnId;
      }),
    ).toEqual(["color", "name"]);
  });

  test("never overwrites a value that is already there", () => {
    const stored: Array<ModelColumnRow> = [
      makeColumnRow({ columnId: "name", text: "Acknowledged" }),
    ];

    expect(seedRequiredRows(stored, COLUMNS)[0]!.text).toBe("Acknowledged");
  });

  test("seeded rows serialize away, so an untouched create still reads as empty", () => {
    /*
     * This is what stops a create that has only been looked at from passing the
     * form's required check and the graph linter's.
     */
    expect(
      serializeColumnRows(
        seedRequiredRows([], COLUMNS),
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toBe("");
  });
});

describe("emitRowValue and buildOperatorValue in isolation", () => {
  test("an empty literal is the marker a record drops", () => {
    expect(
      emitRowValue(
        makeColumnRow({ columnId: "name", text: "" }),
        ModelColumnControl.Text,
      ),
    ).toBe("");
  });

  test("a value-less operator carries no value at all", () => {
    const built: DictionaryEntryValue = buildOperatorValue(
      makeColumnRow({
        columnId: "name",
        operator: DictionaryFilterOperator.IsEmpty,
        text: "ignored",
      }),
      ModelColumnControl.Text,
    );

    expect(built).toBeInstanceOf(IsNull);
  });

  test("equality carries no wrapper, which is what every old query looks like", () => {
    expect(
      buildOperatorValue(
        makeColumnRow({ columnId: "name", text: "acme" }),
        ModelColumnControl.Text,
      ),
    ).toBe("acme");
  });
});

describe("rowIssue", () => {
  test("says so when a number column has been given words", () => {
    expect(
      rowIssue(makeColumnRow({ columnId: "port", text: "eighty" }), COLUMNS[4]),
    ).toBe("This column takes a number.");
  });

  test("says nothing when the number is a number", () => {
    expect(
      rowIssue(makeColumnRow({ columnId: "port", text: "8080" }), COLUMNS[4]),
    ).toBeNull();
  });

  test("says so when a date column has been given something unparseable", () => {
    expect(
      rowIssue(
        makeColumnRow({ columnId: "createdAt", text: "yesterday" }),
        COLUMNS[6],
      ),
    ).toBe("This column takes a date and time.");
  });

  test("a reference is never an issue, on any column", () => {
    expect(
      rowIssue(
        makeColumnRow({
          columnId: "port",
          text: "{{local.variables.port}}",
          valueMode: ColumnValueMode.Reference,
        }),
        COLUMNS[4],
      ),
    ).toBeNull();
  });

  test("an untouched row is never an issue", () => {
    expect(
      rowIssue(makeColumnRow({ columnId: "port", text: "" }), COLUMNS[4]),
    ).toBeNull();
  });

  test("a raw value is not reported as an issue — it is reported as raw", () => {
    expect(
      rowIssue(
        makeColumnRow({
          columnId: "port",
          text: "8080",
          valueMode: ColumnValueMode.Raw,
          rawValue: "8080",
        }),
        COLUMNS[4],
      ),
    ).toBeNull();
  });
});
