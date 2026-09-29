/*
 * Which control a column gets, and what values that control can hold without
 * changing them.
 *
 * Every `type` here is a TableColumnType *value*, because that is what the
 * /model-schema endpoint puts on the wire. Several values differ sharply from
 * the member name that reads like the obvious literal — ShortText is "Text",
 * ObjectID is "Object ID", LongURL is "URL", JavaScript is "JavaSCript" — and
 * a mapping written against the names would classify the two most-declared
 * column types as unknown while every test still passed.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import {
  columnTypeLabel,
  controlForColumn,
  isOfferableColumn,
  literalFitsControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnControl";
import { ModelColumnControl } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
): ModelSchemaColumn => {
  return {
    id: "name",
    title: "Name",
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

describe("controlForColumn — totality", () => {
  test("every column type the database can declare gets a control", () => {
    const allTypes: Array<string> = Object.values(TableColumnType);

    // Guards against the enum growing and a new type silently becoming a text box.
    expect(allTypes.length).toBeGreaterThan(0);

    for (const type of allTypes) {
      const control: ModelColumnControl = controlForColumn(
        makeColumn({ type: type }),
      );

      expect(Object.values(ModelColumnControl)).toContain(control);
    }
  });

  test("a column the schema does not describe still gets a usable control", () => {
    /*
     * The runner accepts column names this endpoint never surfaces, so an
     * unknown key is typed as text rather than locked as unsupported.
     */
    expect(controlForColumn(undefined)).toBe(ModelColumnControl.Text);
  });
});

describe("controlForColumn — the wire values, not the member names", () => {
  test('ShortText, whose value is "Text", is a text box', () => {
    expect(
      controlForColumn(makeColumn({ type: TableColumnType.ShortText })),
    ).toBe(ModelColumnControl.Text);
    expect(TableColumnType.ShortText).toBe("Text");
  });

  test('ObjectID, whose value is "Object ID", is an ID box', () => {
    expect(
      controlForColumn(makeColumn({ type: TableColumnType.ObjectID })),
    ).toBe(ModelColumnControl.ObjectId);
    expect(TableColumnType.ObjectID).toBe("Object ID");
  });

  test('LongURL, whose value is "URL", is a text box', () => {
    expect(
      controlForColumn(makeColumn({ type: TableColumnType.LongURL })),
    ).toBe(ModelColumnControl.Text);
    expect(TableColumnType.LongURL).toBe("URL");
  });

  test("JavaScript, whose value carries a capital S typo, is long text", () => {
    expect(
      controlForColumn(makeColumn({ type: TableColumnType.JavaScript })),
    ).toBe(ModelColumnControl.LongText);
    expect(TableColumnType.JavaScript).toBe("JavaSCript");
  });

  test("every numeric flavour is a number box", () => {
    const numericTypes: Array<string> = [
      TableColumnType.Number,
      TableColumnType.SmallNumber,
      TableColumnType.BigNumber,
      TableColumnType.PositiveNumber,
      TableColumnType.SmallPositiveNumber,
      TableColumnType.BigPositiveNumber,
      TableColumnType.Port,
    ];

    for (const type of numericTypes) {
      expect(controlForColumn(makeColumn({ type: type }))).toBe(
        ModelColumnControl.Number,
      );
    }
  });

  test("boolean, date and color each get their own control", () => {
    expect(
      controlForColumn(makeColumn({ type: TableColumnType.Boolean })),
    ).toBe(ModelColumnControl.Boolean);
    expect(controlForColumn(makeColumn({ type: TableColumnType.Date }))).toBe(
      ModelColumnControl.Date,
    );
    expect(controlForColumn(makeColumn({ type: TableColumnType.Color }))).toBe(
      ModelColumnControl.Color,
    );
  });

  test("the long-form text types share one textarea", () => {
    const longTypes: Array<string> = [
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.Description,
      TableColumnType.Markdown,
      TableColumnType.HTML,
      TableColumnType.CSS,
    ];

    for (const type of longTypes) {
      expect(controlForColumn(makeColumn({ type: type }))).toBe(
        ModelColumnControl.LongText,
      );
    }
  });

  test("blobs, nested structures and relations have no row that could hold them", () => {
    const unsupportedTypes: Array<string> = [
      TableColumnType.Entity,
      TableColumnType.EntityArray,
      TableColumnType.JSON,
      TableColumnType.Array,
      TableColumnType.Buffer,
      TableColumnType.File,
      TableColumnType.MonitorSteps,
    ];

    for (const type of unsupportedTypes) {
      expect(controlForColumn(makeColumn({ type: type }))).toBe(
        ModelColumnControl.Unsupported,
      );
    }
  });

  test("a relation is unsupported whatever its declared type says", () => {
    expect(
      controlForColumn(
        makeColumn({ type: TableColumnType.ShortText, isRelation: true }),
      ),
    ).toBe(ModelColumnControl.Unsupported);
  });

  test("a single-value enum column is a text box, not a blob", () => {
    /*
     * Permission, MonitorType, WorkflowStatus and CustomFieldType are stored as
     * short text with one enum value in them - TeamPermission.permission ships
     * example: "ProjectOwner".
     */
    const enumTypes: Array<string> = [
      TableColumnType.Permission,
      TableColumnType.MonitorType,
      TableColumnType.WorkflowStatus,
      TableColumnType.CustomFieldType,
    ];

    for (const type of enumTypes) {
      expect(controlForColumn(makeColumn({ type: type }))).toBe(
        ModelColumnControl.Text,
      );
    }
  });
});

describe("literalFitsControl", () => {
  test("an untouched value fits every control", () => {
    for (const control of Object.values(ModelColumnControl)) {
      expect(literalFitsControl(control, "")).toBe(true);
      expect(literalFitsControl(control, undefined)).toBe(true);
    }
  });

  test("null does not fit, because an empty box cannot say null", () => {
    /*
     * This is the whole reason stored nulls survive a round trip: an empty
     * control emits "", which a record drops, so a null has to be kept raw.
     */
    expect(literalFitsControl(ModelColumnControl.Text, null)).toBe(false);
    expect(literalFitsControl(ModelColumnControl.Number, null)).toBe(false);
  });

  test("a number fits a number box and the string spelling of one does not", () => {
    expect(literalFitsControl(ModelColumnControl.Number, 8080)).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Number, "8080")).toBe(false);
    expect(literalFitsControl(ModelColumnControl.Number, "08080")).toBe(false);
    expect(literalFitsControl(ModelColumnControl.Number, NaN)).toBe(false);
  });

  test("a boolean fits a boolean control and its string spelling does not", () => {
    expect(literalFitsControl(ModelColumnControl.Boolean, true)).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Boolean, false)).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Boolean, "true")).toBe(false);
  });

  test("a date fits only as a parseable string", () => {
    expect(
      literalFitsControl(ModelColumnControl.Date, "2026-08-15T00:00:00.000Z"),
    ).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Date, "not a date")).toBe(
      false,
    );
    expect(literalFitsControl(ModelColumnControl.Date, 1786818975367)).toBe(
      false,
    );
  });

  test("a text control takes strings and nothing else", () => {
    expect(literalFitsControl(ModelColumnControl.Text, "hello")).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Text, 12)).toBe(false);
    expect(literalFitsControl(ModelColumnControl.Text, true)).toBe(false);
  });
});

describe("isOfferableColumn", () => {
  test("an ordinary scalar column is offered", () => {
    expect(isOfferableColumn(makeColumn({}))).toBe(true);
  });

  test("a relation is not offered — its scalar ID sibling is", () => {
    expect(isOfferableColumn(makeColumn({ isRelation: true }))).toBe(false);
  });

  test("the project column is not offered, because the runner stamps it", () => {
    expect(isOfferableColumn(makeColumn({ isTenantColumn: true }))).toBe(false);
  });

  test("a column no row can hold is not offered", () => {
    expect(
      isOfferableColumn(makeColumn({ type: TableColumnType.MonitorSteps })),
    ).toBe(false);
  });
});

describe("columnTypeLabel", () => {
  test("says what kind of value the field wants, in words", () => {
    expect(columnTypeLabel(makeColumn({ type: TableColumnType.Boolean }))).toBe(
      "True or false",
    );
    expect(columnTypeLabel(makeColumn({ type: TableColumnType.Date }))).toBe(
      "Date and time",
    );
    expect(
      columnTypeLabel(makeColumn({ type: TableColumnType.ObjectID })),
    ).toBe("ID");
    expect(columnTypeLabel(makeColumn({ type: TableColumnType.Port }))).toBe(
      "Number",
    );
    expect(
      columnTypeLabel(makeColumn({ type: TableColumnType.ShortText })),
    ).toBe("Text");
  });

  test("a relation says so rather than naming its inner type", () => {
    expect(columnTypeLabel(makeColumn({ isRelation: true }))).toBe("Relation");
  });

  test("an unsupported column names its raw type, which is what has to be written by hand", () => {
    expect(
      columnTypeLabel(makeColumn({ type: TableColumnType.MonitorSteps })),
    ).toBe(TableColumnType.MonitorSteps);
  });

  test("an unknown column is labelled unknown rather than guessed at", () => {
    expect(columnTypeLabel(undefined)).toBe("Unknown");
  });
});
