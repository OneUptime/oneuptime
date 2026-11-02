import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import MutableMetric from "../../../../Models/AnalyticsModels/MutableMetric";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A create writes every value into its INSERT as its column's type: a value
 * of another type is written only where it means one of the column's own
 * ("42" for a number, "true" for a boolean), and otherwise the create is
 * refused with a 400 before anything is written.
 *
 * Each statement below is read back the way ClickHouse reads a VALUES row:
 * split into its fields (quotes and brackets kept together), and each field
 * held to the literal its column's type is written as.
 */

type ModelType = { new (): AnalyticsBaseModel };

const COLUMN_TYPES: Array<TableColumnType> = Object.values(TableColumnType);

// One column of each type: `column_<index of the type>`.
function columnKeyOf(type: TableColumnType): string {
  return `column_${COLUMN_TYPES.indexOf(type)}`;
}

class EveryColumnTypeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<every-column-type>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: COLUMN_TYPES.map(
        (type: TableColumnType): AnalyticsTableColumn => {
          return new AnalyticsTableColumn({
            key: columnKeyOf(type),
            title: type,
            description: type,
            required: false,
            type: type,
            aggregateFunctionDefinition:
              type === TableColumnType.AggregateFunction
                ? "sum, Float64"
                : undefined,
          });
        },
      ),
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

// The literals ClickHouse reads as a string, a number and a time.
const STRING_LITERAL_REGEX: RegExp = /'(?:[^'\\]|\\.)*'/;
const NUMBER_LITERAL_REGEX: RegExp =
  /-?(?:\d+(?:\.\d+)?(?:e[-+]\d+)?|Infinity)/;
const TIME_LITERAL_REGEX: RegExp =
  /parseDateTimeBestEffortOrNull\('[-+0-9T:. Z]+'\)/;

const STRING_LITERAL: string = STRING_LITERAL_REGEX.source;
const NUMBER_LITERAL: string = NUMBER_LITERAL_REGEX.source;
const TIME_LITERAL: string = TIME_LITERAL_REGEX.source;

function exactly(pattern: string): RegExp {
  return new RegExp(`^(?:NULL|${pattern})$`);
}

// What a field of each column type may hold: NULL, or a literal of its type.
const LITERAL_OF_TYPE: Record<TableColumnType, RegExp> = {
  [TableColumnType.ObjectID]: exactly(STRING_LITERAL),
  [TableColumnType.Text]: exactly(STRING_LITERAL),
  [TableColumnType.IP]: exactly(STRING_LITERAL),
  [TableColumnType.Port]: exactly(STRING_LITERAL),
  [TableColumnType.JSON]: exactly(STRING_LITERAL),
  [TableColumnType.JSONArray]: exactly(STRING_LITERAL),
  [TableColumnType.Boolean]: exactly("true|false"),
  [TableColumnType.Number]: exactly(NUMBER_LITERAL),
  [TableColumnType.BigNumber]: exactly(NUMBER_LITERAL),
  [TableColumnType.UInt8]: exactly(NUMBER_LITERAL),
  [TableColumnType.Decimal]: exactly(NUMBER_LITERAL),
  [TableColumnType.LongNumber]: exactly(
    `CAST\\('${NUMBER_LITERAL}' AS Int128\\)`,
  ),
  [TableColumnType.UInt64]: exactly(`CAST\\('${NUMBER_LITERAL}' AS UInt64\\)`),
  [TableColumnType.Date]: exactly(TIME_LITERAL),
  [TableColumnType.DateTime64]: exactly(TIME_LITERAL),
  [TableColumnType.ArrayNumber]: exactly(
    `\\[(?:(?:${NUMBER_LITERAL}|NULL)(?:, (?:${NUMBER_LITERAL}|NULL))*)?\\]`,
  ),
  [TableColumnType.ArrayBigNumber]: exactly(
    `\\[(?:(?:${NUMBER_LITERAL}|NULL)(?:, (?:${NUMBER_LITERAL}|NULL))*)?\\]`,
  ),
  [TableColumnType.ArrayDecimal]: exactly(
    `\\[(?:(?:${NUMBER_LITERAL}|NULL)(?:, (?:${NUMBER_LITERAL}|NULL))*)?\\]`,
  ),
  [TableColumnType.ArrayText]: exactly(
    `\\[(?:${STRING_LITERAL}(?:, ${STRING_LITERAL})*)?\\]`,
  ),
  [TableColumnType.MapStringString]: exactly(
    `map\\((?:${STRING_LITERAL}, ${STRING_LITERAL}(?:, ${STRING_LITERAL}, ${STRING_LITERAL})*)?\\)`,
  ),
  // Only ClickHouse writes an aggregate state: a create writes none.
  [TableColumnType.AggregateFunction]: /^NULL$/,
};

/*
 * The fields of the one row an INSERT writes, split where ClickHouse splits
 * them: at a comma outside a string literal and outside any brackets.
 */
function insertedFields(statement: string): Array<string> {
  const row: string = statement.slice(statement.indexOf("VALUES") + 6).trim();

  expect(row.startsWith("(")).toBe(true);
  expect(row.endsWith(")")).toBe(true);

  const fields: Array<string> = [];
  let field: string = "";
  let depth: number = 0;
  let inString: boolean = false;

  for (let index: number = 1; index < row.length - 1; index++) {
    const character: string = row[index]!;

    if (inString) {
      field += character;

      if (character === "\\") {
        field += row[index + 1]!;
        index++;
      } else if (character === "'") {
        inString = false;
      }

      continue;
    }

    if (character === "'") {
      inString = true;
    } else if (character === "(" || character === "[") {
      depth++;
    } else if (character === ")" || character === "]") {
      depth--;
    } else if (character === "," && depth === 0) {
      fields.push(field.trim());
      field = "";
      continue;
    }

    field += character;
  }

  fields.push(field.trim());

  // A row that closes every string and bracket it opens.
  expect([inString, depth]).toEqual([false, 0]);

  return fields;
}

type CreateOutcome =
  | { refused: BadDataException }
  | { refused: null; field: string };

// A table's generator, and a row of it that holds one value at a time.
type CreateCase = {
  generator: StatementGenerator<AnalyticsBaseModel>;
  item: AnalyticsBaseModel;
  columns: Array<AnalyticsTableColumn>;
};

function createCaseOf(modelType: ModelType): CreateCase {
  const item: AnalyticsBaseModel = new modelType();

  return {
    generator: new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    }),
    item: item,
    columns: item.getTableColumns(),
  };
}

/*
 * The INSERT a create of `value` in `columnKey` writes, read back: the
 * column's field, or the refusal.
 */
function createOf(data: {
  createCase: CreateCase;
  columnKey: string;
  value: unknown;
  through: "setColumnValue" | "raw";
}): CreateOutcome {
  const { generator, item, columns } = data.createCase;
  const values: JSONObject = (item as unknown as { data: JSONObject }).data;

  if (data.through === "setColumnValue") {
    // As the API reads a create's body (fromJSON).
    item.setColumnValue(data.columnKey, data.value as never);
  } else {
    // The value as it is, whatever wrote it.
    values[data.columnKey] = data.value as never;
  }

  let statement: string;

  try {
    statement = generator.toCreateStatement({ item: [item] });
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).code).toBe(400);

    return { refused: error as BadDataException };
  } finally {
    delete values[data.columnKey];
  }

  const fields: Array<string> = insertedFields(statement);

  expect(fields).toHaveLength(columns.length);

  return {
    refused: null,
    field:
      fields[
        columns.findIndex((column: AnalyticsTableColumn): boolean => {
          return column.key === data.columnKey;
        })
      ]!,
  };
}

const EVERY_COLUMN_TYPE_CASE: CreateCase = createCaseOf(EveryColumnTypeModel);

// The literal a value is written as in a column of `type`, or the refusal.
function writtenAs(
  type: TableColumnType,
  value: unknown,
  through: "setColumnValue" | "raw" = "raw",
): string {
  const outcome: CreateOutcome = createOf({
    createCase: EVERY_COLUMN_TYPE_CASE,
    columnKey: columnKeyOf(type),
    value: value,
    through: through,
  });

  if (outcome.refused) {
    return `refused: ${outcome.refused.message}`;
  }

  return outcome.field;
}

const A_TIME: Date = new Date("2026-07-01T00:00:00.000Z");

/*
 * Values of every shape: strings for numbers, booleans and times, numbers
 * and booleans for text, lists and objects for single values, and the
 * objects a JavaScript caller may hold.
 */
const VALUES_OF_EVERY_SHAPE: Array<unknown> = [
  "not a number",
  "42",
  "-7",
  "1.5",
  "1e3",
  "0x1A",
  "true",
  "FALSE",
  "yes",
  "it's",
  "back\\slash",
  "quote ' and \\' together",
  "  ",
  "2026-07-01T00:00:00.000Z",
  "1".repeat(80),
  42,
  -1.5,
  0,
  1,
  255,
  1e21,
  Infinity,
  -Infinity,
  NaN,
  true,
  false,
  [],
  ["text"],
  ["it's"],
  [1, 2],
  ["4", "5.5"],
  [true],
  [null],
  [["nested"]],
  [{ key: "value" }],
  {},
  { key: "value" },
  { key: "it's" },
  { key: 1 },
  { key: { nested: "value" } },
  { _type: "DateTime", value: "2026-07-01T00:00:00.000Z" },
  A_TIME,
  new Date(NaN),
  ObjectID.generate(),
];

describe("StatementGenerator.toCreateStatement values", () => {
  test("writes a value of each column type as before", () => {
    const id: ObjectID = ObjectID.generate();

    expect(writtenAs(TableColumnType.ObjectID, id)).toBe(`'${id.toString()}'`);
    expect(writtenAs(TableColumnType.Text, "it's a back\\slash")).toBe(
      "'it\\'s a back\\\\slash'",
    );
    expect(writtenAs(TableColumnType.Boolean, true)).toBe("true");
    expect(writtenAs(TableColumnType.Boolean, false)).toBe("false");
    expect(writtenAs(TableColumnType.Number, 7)).toBe("7");
    expect(writtenAs(TableColumnType.Number, 0)).toBe("0");
    expect(writtenAs(TableColumnType.Decimal, 1.25)).toBe("1.25");
    expect(writtenAs(TableColumnType.BigNumber, 9007199254740991)).toBe(
      "9007199254740991",
    );
    expect(writtenAs(TableColumnType.UInt8, 255)).toBe("255");
    expect(writtenAs(TableColumnType.LongNumber, -5)).toBe(
      "CAST('-5' AS Int128)",
    );
    expect(writtenAs(TableColumnType.UInt64, "18446744073709551615")).toBe(
      "CAST('18446744073709551615' AS UInt64)",
    );
    expect(writtenAs(TableColumnType.Date, A_TIME)).toBe(
      "parseDateTimeBestEffortOrNull('2026-07-01T00:00:00.000Z')",
    );
    expect(writtenAs(TableColumnType.DateTime64, A_TIME)).toBe(
      "parseDateTimeBestEffortOrNull('2026-07-01 00:00:00.000000000')",
    );
    expect(writtenAs(TableColumnType.JSON, { key: "it's" })).toBe(
      `'{"key":"it\\'s"}'`,
    );
    expect(writtenAs(TableColumnType.JSONArray, [{ key: 1 }])).toBe(
      `'[{"key":1}]'`,
    );
    expect(writtenAs(TableColumnType.ArrayNumber, [1, -2, 0])).toBe(
      "[1, -2, 0]",
    );
    expect(writtenAs(TableColumnType.ArrayBigNumber, [])).toBe("[]");
    expect(writtenAs(TableColumnType.ArrayDecimal, [1.5, 2])).toBe("[1.5, 2]");
    expect(writtenAs(TableColumnType.ArrayText, ["a", "it's"])).toBe(
      "['a', 'it\\'s']",
    );
    expect(
      writtenAs(TableColumnType.MapStringString, {
        "service.name": "api",
        "it's": "a\\b",
      }),
    ).toBe("map('service.name', 'api', 'it\\'s', 'a\\\\b')");
  });

  test("writes NULL for a missing value, in every column type", () => {
    for (const type of COLUMN_TYPES) {
      for (const value of [undefined, null, ""]) {
        expect([type, writtenAs(type, value)]).toEqual([type, "NULL"]);
      }
    }
  });

  test("writes a string of a number as the number, and refuses any other string", () => {
    expect(writtenAs(TableColumnType.Number, "42")).toBe("42");
    expect(writtenAs(TableColumnType.Number, "-7")).toBe("-7");
    expect(writtenAs(TableColumnType.BigNumber, "42")).toBe("42");
    expect(writtenAs(TableColumnType.UInt8, "42")).toBe("42");
    expect(writtenAs(TableColumnType.Decimal, "1.5")).toBe("1.5");
    expect(writtenAs(TableColumnType.Decimal, "1e3")).toBe("1000");
    expect(writtenAs(TableColumnType.LongNumber, "-42")).toBe(
      "CAST('-42' AS Int128)",
    );
    expect(writtenAs(TableColumnType.UInt64, "42")).toBe(
      "CAST('42' AS UInt64)",
    );

    for (const type of [
      TableColumnType.Number,
      TableColumnType.BigNumber,
      TableColumnType.UInt8,
      TableColumnType.Decimal,
      TableColumnType.LongNumber,
      TableColumnType.UInt64,
    ]) {
      for (const value of ["not a number", "0x1A", "  ", "1".repeat(80)]) {
        expect([type, value, writtenAs(type, value)]).toEqual([
          type,
          value,
          expect.stringMatching(/^refused: /),
        ]);
      }
    }

    // Whole-number columns take whole numbers; unsigned ones, no sign.
    expect(writtenAs(TableColumnType.Number, "1.5")).toMatch(/^refused: /);
    expect(writtenAs(TableColumnType.LongNumber, "1.5")).toMatch(/^refused: /);
    expect(writtenAs(TableColumnType.UInt8, "-7")).toMatch(/^refused: /);
    expect(writtenAs(TableColumnType.UInt64, "-7")).toMatch(/^refused: /);
  });

  test("writes true or false for a boolean, and refuses anything else", () => {
    for (const value of [true, 1, "true", "TRUE", " true ", "1"]) {
      expect([value, writtenAs(TableColumnType.Boolean, value)]).toEqual([
        value,
        "true",
      ]);
    }

    for (const value of [false, 0, "false", "False", "0"]) {
      expect([value, writtenAs(TableColumnType.Boolean, value)]).toEqual([
        value,
        "false",
      ]);
    }

    for (const value of [
      "yes",
      "not a boolean",
      2,
      -1,
      [true],
      { key: true },
      A_TIME,
    ]) {
      expect([value, writtenAs(TableColumnType.Boolean, value)]).toEqual([
        value,
        `refused: Invalid value for ${columnKeyOf(TableColumnType.Boolean)}. It must be true or false.`,
      ]);
    }
  });

  test("refuses a list or an object for a single value", () => {
    const singleValueTypes: Array<TableColumnType> = [
      TableColumnType.ObjectID,
      TableColumnType.Text,
      TableColumnType.IP,
      TableColumnType.Port,
      TableColumnType.Boolean,
      TableColumnType.Number,
      TableColumnType.BigNumber,
      TableColumnType.UInt8,
      TableColumnType.Decimal,
      TableColumnType.LongNumber,
      TableColumnType.UInt64,
      TableColumnType.Date,
      TableColumnType.DateTime64,
      TableColumnType.AggregateFunction,
    ];

    for (const type of singleValueTypes) {
      for (const value of [
        [],
        ["text"],
        [1, 2],
        {},
        { key: "value" },
        { _type: "DateTime", value: "2026-07-01T00:00:00.000Z" },
      ]) {
        expect([type, value, writtenAs(type, value)]).toEqual([
          type,
          value,
          expect.stringMatching(
            new RegExp(
              `^refused: Invalid value for ${columnKeyOf(type)}\\. It must be `,
            ),
          ),
        ]);
      }
    }
  });

  test("writes text, an ID, a number or a boolean as text in a text column", () => {
    expect(writtenAs(TableColumnType.Text, 42)).toBe("'42'");
    expect(writtenAs(TableColumnType.Text, true)).toBe("'true'");
    expect(writtenAs(TableColumnType.IP, "10.0.0.1")).toBe("'10.0.0.1'");
    expect(writtenAs(TableColumnType.Port, 443)).toBe("'443'");
    expect(writtenAs(TableColumnType.Port, "it's")).toBe("'it\\'s'");
  });

  test("writes a time, and refuses what is not one", () => {
    expect(
      writtenAs(TableColumnType.DateTime64, "2026-07-01T00:00:00.000Z"),
    ).toBe("parseDateTimeBestEffortOrNull('2026-07-01 00:00:00.000000000')");

    for (const type of [TableColumnType.Date, TableColumnType.DateTime64]) {
      for (const value of [new Date(NaN), "not a time", 42, true]) {
        expect([type, value, writtenAs(type, value)]).toEqual([
          type,
          value,
          `refused: Invalid value for ${columnKeyOf(type)}. It must be a date and time.`,
        ]);
      }
    }

    // As the API reads it: a string is a Date before the INSERT is written.
    expect(
      writtenAs(TableColumnType.Date, "not a time", "setColumnValue"),
    ).toMatch(/^refused: /);
  });

  test("writes lists and maps of their element type, and refuses other elements", () => {
    for (const type of [
      TableColumnType.ArrayNumber,
      TableColumnType.ArrayBigNumber,
      TableColumnType.ArrayDecimal,
    ]) {
      expect(writtenAs(type, ["4", "5.5", 6])).toBe("[4, 5.5, 6]");
      expect(writtenAs(type, [null, NaN, Infinity])).toBe("[NULL, NULL, NULL]");

      for (const value of [
        "1, 2",
        42,
        { key: 1 },
        ["not a number"],
        [true],
        [["nested"]],
        [{ key: 1 }],
      ]) {
        expect([type, value, writtenAs(type, value)]).toEqual([
          type,
          value,
          `refused: Invalid value for ${columnKeyOf(type)}. It must be a list of numbers.`,
        ]);
      }
    }

    expect(writtenAs(TableColumnType.ArrayText, [null, undefined])).toBe(
      "['', '']",
    );

    for (const value of ["text", { key: "value" }, [1], [true], [["nested"]]]) {
      expect([value, writtenAs(TableColumnType.ArrayText, value)]).toEqual([
        value,
        `refused: Invalid value for ${columnKeyOf(TableColumnType.ArrayText)}. It must be a list of text values.`,
      ]);
    }

    expect(
      writtenAs(TableColumnType.MapStringString, {
        key: "value",
        missing: null,
      }),
    ).toBe("map('key', 'value')");

    for (const value of [
      "text",
      ["key", "value"],
      { key: 1 },
      { key: true },
      { key: { nested: "value" } },
      { key: ["value"] },
    ]) {
      expect([
        value,
        writtenAs(TableColumnType.MapStringString, value),
      ]).toEqual([
        value,
        `refused: Invalid value for ${columnKeyOf(TableColumnType.MapStringString)}. It must be an object whose values are text.`,
      ]);
    }
  });

  test("refuses a value of any kind for an aggregate state", () => {
    for (const value of [42, "42", true, [1], { key: "value" }, A_TIME]) {
      expect(writtenAs(TableColumnType.AggregateFunction, value)).toBe(
        `refused: Invalid value for ${columnKeyOf(TableColumnType.AggregateFunction)}. It must be left out, as the database computes it.`,
      );
    }
  });

  test("a value of every shape, in every column type, is written as the column's type or refused with a 400", () => {
    let written: number = 0;
    let refused: number = 0;

    for (const type of COLUMN_TYPES) {
      for (const value of VALUES_OF_EVERY_SHAPE) {
        for (const through of ["setColumnValue", "raw"] as const) {
          const outcome: CreateOutcome = createOf({
            createCase: EVERY_COLUMN_TYPE_CASE,
            columnKey: columnKeyOf(type),
            value: value,
            through: through,
          });

          if (outcome.refused) {
            refused++;
            continue;
          }

          expect([type, value, through, outcome.field]).toEqual([
            type,
            value,
            through,
            expect.stringMatching(LITERAL_OF_TYPE[type]),
          ]);
          written++;
        }
      }
    }

    expect(written).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(200);
  });

  test("so does every table's create, as the API reads its body", () => {
    const modelTypes: Array<ModelType> = [...AnalyticsModels, MutableMetric];
    let checked: number = 0;

    for (const modelType of modelTypes) {
      const createCase: CreateCase = createCaseOf(modelType);
      const tableName: string = createCase.item.tableName;

      for (const column of createCase.columns) {
        for (const value of VALUES_OF_EVERY_SHAPE) {
          const outcome: CreateOutcome = createOf({
            createCase: createCase,
            columnKey: column.key,
            value: value,
            through: "setColumnValue",
          });

          if (!outcome.refused) {
            expect([tableName, column.key, value, outcome.field]).toEqual([
              tableName,
              column.key,
              value,
              expect.stringMatching(LITERAL_OF_TYPE[column.type]),
            ]);
          }

          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(10000);
  });

  test("refuses the whole create when one row holds a value of another type", () => {
    const valid: EveryColumnTypeModel = new EveryColumnTypeModel();
    valid.setColumnValue(columnKeyOf(TableColumnType.Number), 1);

    const invalid: EveryColumnTypeModel = new EveryColumnTypeModel();
    invalid.setColumnValue(columnKeyOf(TableColumnType.Number), [1, 2]);

    const generator: StatementGenerator<EveryColumnTypeModel> =
      new StatementGenerator<EveryColumnTypeModel>({
        modelType: EveryColumnTypeModel,
        database: ClickhouseAppInstance,
      });

    expect(() => {
      return generator.toCreateStatement({ item: [valid, invalid] });
    }).toThrow(
      new BadDataException(
        `Invalid value for ${columnKeyOf(TableColumnType.Number)}. It must be a number.`,
      ),
    );

    const statement: string = generator.toCreateStatement({
      item: [valid, valid],
    });

    expect(statement).toContain("VALUES");
    expect(statement.split("VALUES")[1]!.trim()).toMatch(/^\(.*\), \(.*\)$/s);
  });
});
