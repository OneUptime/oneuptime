import { describe, expect, test } from "@jest/globals";
import {
  COLUMN_FIT_MAX_WIDTH_IN_PX,
  COLUMN_MAX_WIDTH_IN_PX,
  COLUMN_MIN_WIDTH_IN_PX,
  COLUMN_NAME_FLOOR_IN_PX,
  COLUMN_PROSE_FLOOR_IN_PX,
  COLUMN_RESIZE_LARGE_STEP_IN_PX,
  COLUMN_RESIZE_STEP_IN_PX,
  COLUMN_VALUE_FLOOR_IN_PX,
  COLUMN_WIDTHS_ANONYMOUS_PERSON,
  COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  ColumnContentWidths,
  ColumnResizeKeyResult,
  ColumnWidthKind,
  ColumnWidths,
  EMPTY_COLUMN_WIDTHS,
  MAX_REMEMBERED_COLUMN_WIDTHS,
  clampColumnWidth,
  getColumnFitWidth,
  getColumnWidthFloor,
  getColumnWidthKind,
  getColumnWidthsPreferenceKey,
  getColumnWidthsScope,
  getHeaderCellWidthStyle,
  getKeyboardResizedWidth,
  getPointerResizedWidth,
  getSizedColumnsCss,
  getTableColumnIds,
  hasDrawnColumnWidths,
  isColumnResizable,
  readColumnWidths,
  toColumnWidthsJSON,
  withColumnWidth,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { VALUE_KINDS_KEPT_WHOLE } from "../../../../../UI/Components/Table/CellClassName";
import {
  TABLE_NAME_FILL_FLOOR_IN_PX,
  TABLE_VALUE_GIVE_FLOOR_IN_PX,
} from "../../../../../UI/Components/Table/TableLayout";
import Column from "../../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../../UI/Components/Types/FieldType";
import GenericObject from "../../../../../Types/GenericObject";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * "I'm not able to resize columns, so I'm not able to drag and increase the
 * width of the columns or decrease the width of the columns." The rules a
 * column is sized by, apart from any page: which columns a person may
 * size, the least each may be (a header, a short name, a date or a number
 * never cut), what fits it, how a pointer and the keyboard move its edge -
 * in both reading directions - and how its width is remembered, per person
 * and per table, whatever the browser hands back.
 */

// A rule's place in its row, as getSizedColumnsCss writes it.
const NTH_CHILD_RULE: RegExp = /td:nth-child\((\d+)\)/g;

type MakeColumnFunction = (
  type: FieldType,
  extra?: Partial<Column<GenericObject>>,
) => Column<GenericObject>;

const makeColumn: MakeColumnFunction = (
  type: FieldType,
  extra?: Partial<Column<GenericObject>>,
): Column<GenericObject> => {
  return { title: "Value", type: type, ...(extra || {}) };
};

const measured: (
  data: Partial<ColumnContentWidths>,
) => ColumnContentWidths = (
  data: Partial<ColumnContentWidths>,
): ColumnContentWidths => {
  return {
    headerMinContentWidth: 0,
    headerMaxContentWidth: 0,
    widestValueWidth: 0,
    cellPaddingWidth: 24,
    ...data,
  };
};

describe("which columns a person may size", () => {
  test("every column but the row's actions", () => {
    for (const type of Object.values(FieldType)) {
      expect([type, isColumnResizable(makeColumn(type as FieldType))]).toEqual(
        [type, type !== FieldType.Actions],
      );
    }
  });

  test("a column whose width a page depends on says so, and has no edge", () => {
    expect(
      isColumnResizable(makeColumn(FieldType.Text, { disableResize: true })),
    ).toBe(false);
    expect(
      isColumnResizable(makeColumn(FieldType.Text, { disableResize: false })),
    ).toBe(true);
  });
});

describe("how a column's values may be cut short", () => {
  test("dates, numbers, ticks, colours and icons are kept whole - the kinds the table never cuts", () => {
    for (const type of VALUE_KINDS_KEPT_WHOLE) {
      expect([type, getColumnWidthKind(makeColumn(type), false)]).toEqual([
        type,
        ColumnWidthKind.Whole,
      ]);
      // Even as the row's first column.
      expect(getColumnWidthKind(makeColumn(type), true)).toBe(
        ColumnWidthKind.Whole,
      );
    }

    expect(VALUE_KINDS_KEPT_WHOLE).toEqual(
      expect.arrayContaining([
        FieldType.Date,
        FieldType.DateTime,
        FieldType.Number,
        FieldType.Percent,
        FieldType.Minutes,
        FieldType.USDCents,
        FieldType.Port,
        FieldType.Boolean,
        FieldType.Color,
        FieldType.Icon,
      ]),
    );
  });

  test("a column of prose wraps; the row's first column is its name; any other is a line of text", () => {
    expect(
      getColumnWidthKind(makeColumn(FieldType.Text, { wrapContent: true }), true),
    ).toBe(ColumnWidthKind.Prose);
    expect(getColumnWidthKind(makeColumn(FieldType.Text), true)).toBe(
      ColumnWidthKind.Name,
    );
    expect(getColumnWidthKind(makeColumn(FieldType.Element), false)).toBe(
      ColumnWidthKind.Text,
    );
    expect(getColumnWidthKind(makeColumn(FieldType.URL), false)).toBe(
      ColumnWidthKind.Text,
    );
  });
});

describe("a column's id", () => {
  test("is the id a ModelTable gave it, else the field it reads, else its title", () => {
    expect(
      getTableColumnIds([
        makeColumn(FieldType.Text, { id: "name", key: "title" }),
        makeColumn(FieldType.Text, { key: "status" }),
        makeColumn(FieldType.Text, { title: "Last seen (UTC)" }),
        makeColumn(FieldType.Actions, { title: "" }),
      ]),
    ).toEqual(["name", "status", "last-seen-utc", "column"]);
  });

  test("never its position: a column added before another leaves the other's id as it was", () => {
    const status: Column<GenericObject> = makeColumn(FieldType.Text, {
      key: "status",
    });
    const before: Array<string> = getTableColumnIds([status]);
    const after: Array<string> = getTableColumnIds([
      makeColumn(FieldType.Text, { key: "owner" }),
      status,
    ]);

    expect(before[0]).toBe("status");
    expect(after[1]).toBe("status");
  });

  test("two columns read off one field are told apart by their titles, then by how many came before", () => {
    expect(
      getTableColumnIds([
        makeColumn(FieldType.Element, { key: "_id", title: "Owners" }),
        makeColumn(FieldType.Element, { key: "_id", title: "Labels" }),
        makeColumn(FieldType.Element, { key: "_id", title: "Labels" }),
      ]),
    ).toEqual(["_id:owners", "_id:labels", "_id:labels#2"]);
  });

  test("ids are unique even when two columns carry the same explicit id", () => {
    const ids: Array<string> = getTableColumnIds([
      makeColumn(FieldType.Text, { id: "same" }),
      makeColumn(FieldType.Text, { id: "same" }),
    ]);

    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(["same", "same#2"]);
  });
});

describe("the least a column may be", () => {
  test("its floors are the table's own give-way floors: 10rem for a name and prose, 8rem for a value", () => {
    expect(COLUMN_NAME_FLOOR_IN_PX).toBe(TABLE_NAME_FILL_FLOOR_IN_PX);
    expect(COLUMN_NAME_FLOOR_IN_PX).toBe(160);
    expect(COLUMN_VALUE_FLOOR_IN_PX).toBe(TABLE_VALUE_GIVE_FLOOR_IN_PX);
    expect(COLUMN_VALUE_FLOOR_IN_PX).toBe(128);
    expect(COLUMN_PROSE_FLOOR_IN_PX).toBe(160);
  });

  test("a header is never cut: its least width (its words broken between words) is a floor", () => {
    expect(
      getColumnWidthFloor({
        measured: measured({
          headerMinContentWidth: 131.2,
          widestValueWidth: 8,
        }),
        kind: ColumnWidthKind.Whole,
      }),
    ).toBe(132);
  });

  test("a date or a number is never cut: its widest value is a floor, however wide", () => {
    expect(
      getColumnWidthFloor({
        measured: measured({ widestValueWidth: 300, headerMinContentWidth: 40 }),
        kind: ColumnWidthKind.Whole,
      }),
    ).toBe(324);
  });

  test("a short name is never cut: a name narrower than 10rem is its own floor", () => {
    expect(
      getColumnWidthFloor({
        measured: measured({ widestValueWidth: 90, headerMinContentWidth: 50 }),
        kind: ColumnWidthKind.Name,
      }),
    ).toBe(114);
  });

  test("a long name gives way down to 10rem, a long value to 8rem, prose to 10rem - never further", () => {
    expect(
      getColumnWidthFloor({
        measured: measured({ widestValueWidth: 900 }),
        kind: ColumnWidthKind.Name,
      }),
    ).toBe(160 + 24);
    expect(
      getColumnWidthFloor({
        measured: measured({ widestValueWidth: 900 }),
        kind: ColumnWidthKind.Text,
      }),
    ).toBe(128 + 24);
    expect(
      getColumnWidthFloor({
        measured: measured({ widestValueWidth: 900 }),
        kind: ColumnWidthKind.Prose,
      }),
    ).toBe(160 + 24);
  });

  test("a column with no values on the page is held by its header, and never below the least any column is drawn", () => {
    expect(
      getColumnWidthFloor({
        measured: measured({ headerMinContentWidth: 20 }),
        kind: ColumnWidthKind.Text,
      }),
    ).toBe(COLUMN_MIN_WIDTH_IN_PX);
    expect(COLUMN_MIN_WIDTH_IN_PX).toBe(48);
  });

  test("a reading that went wrong (negative, missing) is no floor", () => {
    expect(
      getColumnWidthFloor({
        measured: {
          headerMinContentWidth: -50,
          headerMaxContentWidth: NaN,
          widestValueWidth: -10,
          cellPaddingWidth: -4,
        },
        kind: ColumnWidthKind.Whole,
      }),
    ).toBe(COLUMN_MIN_WIDTH_IN_PX);
  });
});

describe("what fits a column (a double-click on its edge)", () => {
  test("its header on one line and its widest value whole, its padding in", () => {
    expect(
      getColumnFitWidth({
        measured: measured({
          headerMaxContentWidth: 120,
          widestValueWidth: 210,
        }),
        floor: 100,
      }),
    ).toBe(234);

    expect(
      getColumnFitWidth({
        measured: measured({
          headerMaxContentWidth: 260,
          widestValueWidth: 80,
        }),
        floor: 100,
      }),
    ).toBe(260);
  });

  test("never wider than 40rem, however long a value is", () => {
    expect(COLUMN_FIT_MAX_WIDTH_IN_PX).toBe(640);
    expect(
      getColumnFitWidth({
        measured: measured({ widestValueWidth: 5000 }),
        floor: 100,
      }),
    ).toBe(COLUMN_FIT_MAX_WIDTH_IN_PX);
  });

  test("never narrower than its floor: a date wider than 40rem stays whole", () => {
    expect(
      getColumnFitWidth({
        measured: measured({ widestValueWidth: 700 }),
        floor: 724,
      }),
    ).toBe(724);
  });

  test("a column with nothing in it fits its floor", () => {
    expect(getColumnFitWidth({ measured: measured({}), floor: 60 })).toBe(60);
  });
});

describe("a width as a column is drawn", () => {
  test("whole pixels, between the column's floor and the most any column is", () => {
    expect(clampColumnWidth(201.6, 100)).toBe(202);
    expect(clampColumnWidth(40, 100)).toBe(100);
    expect(clampColumnWidth(10, 0)).toBe(COLUMN_MIN_WIDTH_IN_PX);
    expect(clampColumnWidth(99999, 100)).toBe(COLUMN_MAX_WIDTH_IN_PX);
    expect(COLUMN_MAX_WIDTH_IN_PX).toBe(1600);
  });

  test("a width that is no number is the floor", () => {
    expect(clampColumnWidth(NaN, 120)).toBe(120);
    expect(clampColumnWidth(Infinity, 120)).toBe(120);
  });

  test("a floor above the most a column is drawn wins", () => {
    expect(clampColumnWidth(10, 2000)).toBe(2000);
  });
});

describe("dragging an edge", () => {
  test("left to right, the column grows as the pointer moves right and shrinks as it moves left", () => {
    expect(
      getPointerResizedWidth({
        startWidth: 200,
        startX: 500,
        x: 560,
        isRightToLeft: false,
        floor: 100,
      }),
    ).toBe(260);
    expect(
      getPointerResizedWidth({
        startWidth: 200,
        startX: 500,
        x: 450,
        isRightToLeft: false,
        floor: 100,
      }),
    ).toBe(150);
  });

  test("right to left the edge is the column's left one, and the drag is mirrored", () => {
    expect(
      getPointerResizedWidth({
        startWidth: 200,
        startX: 500,
        x: 440,
        isRightToLeft: true,
        floor: 100,
      }),
    ).toBe(260);
    expect(
      getPointerResizedWidth({
        startWidth: 200,
        startX: 500,
        x: 550,
        isRightToLeft: true,
        floor: 100,
      }),
    ).toBe(150);
  });

  test("never past the floor, however far the pointer goes", () => {
    expect(
      getPointerResizedWidth({
        startWidth: 200,
        startX: 500,
        x: -2000,
        isRightToLeft: false,
        floor: 132,
      }),
    ).toBe(132);
  });
});

describe("the keyboard on an edge", () => {
  const press: (
    key: string,
    extra?: Partial<{
      shiftKey: boolean;
      width: number;
      isRightToLeft: boolean;
    }>,
  ) => ColumnResizeKeyResult = (
    key: string,
    extra?: Partial<{
      shiftKey: boolean;
      width: number;
      isRightToLeft: boolean;
    }>,
  ): ColumnResizeKeyResult => {
    return getKeyboardResizedWidth({
      key: key,
      shiftKey: Boolean(extra?.shiftKey),
      width: extra?.width ?? 200,
      floor: 120,
      fitWidth: 310,
      isRightToLeft: Boolean(extra?.isRightToLeft),
    });
  };

  test("the arrows move the edge the way they point, 16px a press", () => {
    expect(COLUMN_RESIZE_STEP_IN_PX).toBe(16);
    expect(press("ArrowRight")).toEqual({ kind: "width", width: 216 });
    expect(press("ArrowLeft")).toEqual({ kind: "width", width: 184 });
  });

  test("with Shift, 64px a press", () => {
    expect(COLUMN_RESIZE_LARGE_STEP_IN_PX).toBe(64);
    expect(press("ArrowRight", { shiftKey: true })).toEqual({
      kind: "width",
      width: 264,
    });
    expect(press("ArrowLeft", { shiftKey: true })).toEqual({
      kind: "width",
      width: 136,
    });
  });

  test("right to left the left arrow widens the column (its edge moves left, away from its start)", () => {
    expect(press("ArrowLeft", { isRightToLeft: true })).toEqual({
      kind: "width",
      width: 216,
    });
    expect(press("ArrowRight", { isRightToLeft: true })).toEqual({
      kind: "width",
      width: 184,
    });
  });

  test("never past the floor", () => {
    expect(press("ArrowLeft", { width: 125, shiftKey: true })).toEqual({
      kind: "width",
      width: 120,
    });
  });

  test("Home makes the column as narrow as it goes; End and Enter fit it to its content", () => {
    expect(press("Home")).toEqual({ kind: "width", width: 120 });
    expect(press("End")).toEqual({ kind: "width", width: 310 });
    expect(press("Enter")).toEqual({ kind: "width", width: 310 });
  });

  test("Delete and Backspace give the column back to the table", () => {
    expect(press("Delete")).toEqual({ kind: "automatic" });
    expect(press("Backspace")).toEqual({ kind: "automatic" });
  });

  test("any other key goes on to the page", () => {
    for (const key of ["Tab", "Escape", "a", " ", "ArrowUp", "ArrowDown"]) {
      expect([key, press(key)]).toEqual([key, null]);
    }
  });
});

describe("the width a header cell carries", () => {
  test("as wide as that, no narrower and no wider", () => {
    expect(getHeaderCellWidthStyle(240.4, ColumnWidthKind.Text)).toEqual({
      width: "240px",
      minWidth: "240px",
      maxWidth: "240px",
    });
    expect(getHeaderCellWidthStyle(240, ColumnWidthKind.Name)).toEqual({
      width: "240px",
      minWidth: "240px",
      maxWidth: "240px",
    });
  });

  test("a column of dates or numbers grows for a wider one rather than cut it", () => {
    expect(getHeaderCellWidthStyle(120, ColumnWidthKind.Whole)).toEqual({
      width: "120px",
      minWidth: "120px",
    });
  });
});

describe("the widths read back from the browser", () => {
  test("nothing, or anything that is not a plain object, is no widths", () => {
    for (const value of [null, undefined, "", "wide", 42, true, [], [120]]) {
      expect(readColumnWidths(value)).toBe(EMPTY_COLUMN_WIDTHS);
    }
  });

  test("only finite widths under string ids are kept, each held to what a column may be", () => {
    expect(
      readColumnWidths({
        name: 240,
        status: "wide",
        owner: -10,
        team: 0,
        created: NaN,
        updated: Infinity,
        labels: 20,
        notes: 99999,
        nested: { width: 100 },
        list: [100],
        nothing: null,
      }),
    ).toEqual({ name: 240, labels: COLUMN_MIN_WIDTH_IN_PX, notes: 1600 });
  });

  test("a hand-edited entry of thousands of widths is read only as far as a table remembers", () => {
    const value: Record<string, number> = {};

    for (let index: number = 0; index < 500; index++) {
      value[`column-${index}`] = 100 + index;
    }

    expect(Object.keys(readColumnWidths(value))).toHaveLength(
      MAX_REMEMBERED_COLUMN_WIDTHS,
    );
  });

  test("a width for a column the table no longer has is read, and never drawn: the table draws only its own columns' widths", () => {
    const widths: ColumnWidths = readColumnWidths({ gone: 300, name: 200 });

    expect(hasDrawnColumnWidths(widths, ["status", "created"])).toBe(false);
    expect(hasDrawnColumnWidths(widths, ["name", "status"])).toBe(true);
  });

  test("a new column the person never sized has no width: the table's own", () => {
    const widths: ColumnWidths = readColumnWidths({ name: 200 });

    expect(widths["owner"]).toBeUndefined();
  });
});

describe("keeping one column's width", () => {
  test("sets it, rounded and held to what a column may be, leaving the others", () => {
    expect(
      withColumnWidth({
        widths: { name: 200 },
        columnId: "status",
        width: 151.7,
      }),
    ).toEqual({ name: 200, status: 152 });
    expect(
      withColumnWidth({ widths: {}, columnId: "status", width: 2 }),
    ).toEqual({ status: COLUMN_MIN_WIDTH_IN_PX });
  });

  test("null takes it away: the column is the table's again", () => {
    expect(
      withColumnWidth({
        widths: { name: 200, status: 150 },
        columnId: "status",
        width: null,
      }),
    ).toEqual({ name: 200 });
    expect(
      withColumnWidth({ widths: { status: 150 }, columnId: "status", width: null }),
    ).toBe(EMPTY_COLUMN_WIDTHS);
  });

  test("a change that changes nothing hands back the same widths, so nothing is drawn again", () => {
    const widths: ColumnWidths = { name: 200 };

    expect(
      withColumnWidth({ widths: widths, columnId: "status", width: null }),
    ).toBe(widths);
    expect(
      withColumnWidth({ widths: widths, columnId: "name", width: 200.2 }),
    ).toBe(widths);
    expect(
      withColumnWidth({ widths: widths, columnId: "name", width: 201 }),
    ).not.toBe(widths);
  });

  test("does not change the widths it was handed", () => {
    const widths: ColumnWidths = Object.freeze({ name: 200 });

    withColumnWidth({ widths: widths, columnId: "name", width: 300 });

    expect(widths).toEqual({ name: 200 });
  });

  test("past what a table remembers, the column changed and the ones drawn now are kept first", () => {
    const widths: Record<string, number> = {};

    for (let index: number = 0; index < MAX_REMEMBERED_COLUMN_WIDTHS; index++) {
      widths[`old-${index}`] = 100;
    }

    widths["drawn"] = 220;

    const next: ColumnWidths = withColumnWidth({
      widths: widths,
      columnId: "new",
      width: 180,
      drawnIds: ["drawn", "new"],
    });

    expect(Object.keys(next)).toHaveLength(MAX_REMEMBERED_COLUMN_WIDTHS);
    expect(next["new"]).toBe(180);
    expect(next["drawn"]).toBe(220);
  });
});

describe("the widths a table stores", () => {
  test("nothing at all when there are none", () => {
    expect(toColumnWidthsJSON(EMPTY_COLUMN_WIDTHS)).toBeNull();
    expect(toColumnWidthsJSON({})).toBeNull();
  });

  test("every width under its column's id, read back the same", () => {
    const json: JSONObject | null = toColumnWidthsJSON({
      name: 240,
      status: 152,
    });

    expect(json).toEqual({ name: 240, status: 152 });
    expect(readColumnWidths(json)).toEqual({ name: 240, status: 152 });
  });
});

describe("where a table's widths are remembered", () => {
  test("one entry per person and per table", () => {
    expect(
      getColumnWidthsPreferenceKey({
        tableKey: "incidents-table",
        personId: "8a3b0c3e-0000-4000-8000-000000000001",
      }),
    ).toBe("8a3b0c3e-0000-4000-8000-000000000001.incidents-table");

    expect(
      getColumnWidthsPreferenceKey({ tableKey: "incidents-table", personId: "a" }),
    ).not.toBe(
      getColumnWidthsPreferenceKey({ tableKey: "incidents-table", personId: "b" }),
    );
    expect(
      getColumnWidthsPreferenceKey({ tableKey: "alerts-table", personId: "a" }),
    ).not.toBe(
      getColumnWidthsPreferenceKey({ tableKey: "incidents-table", personId: "a" }),
    );
  });

  test("a page with no one signed in keeps one for whoever reads it", () => {
    expect(COLUMN_WIDTHS_ANONYMOUS_PERSON).toBe("anyone");
    for (const personId of [undefined, null, "", "   "]) {
      expect(
        getColumnWidthsPreferenceKey({
          tableKey: "status-page-table",
          personId: personId,
        }),
      ).toBe("anyone.status-page-table");
    }
  });
});

describe("the rules a sized column's values are drawn by", () => {
  test("a table's scope is safe to write in a rule", () => {
    expect(getColumnWidthsScope(":r1f:")).toBe("r1f");
    expect(getColumnWidthsScope(':r1"] body { x }')).toBe("r1bodyx");
    expect(getColumnWidthsScope(":::")).toBe("table");
    expect(COLUMN_WIDTHS_SCOPE_ATTRIBUTE).toBe("data-column-widths-scope");
  });

  test("each sized column's values may use its width - no cap, no floor - and its header breaks its words", () => {
    const css: string = getSizedColumnsCss({ scope: "r1", cellNumbers: [3] });

    expect(css.split("\n")).toEqual([
      'table[data-column-widths-scope="r1"] > tbody > tr > td:nth-child(3) { max-width: none; }',
      'table[data-column-widths-scope="r1"] > tbody > tr > td:nth-child(3) > div { max-width: none; min-width: 0; }',
      'table[data-column-widths-scope="r1"] > thead > tr > th:nth-child(3) * { white-space: normal; }',
    ]);
  });

  test("one rule a column, in order, whatever it is handed", () => {
    const css: string = getSizedColumnsCss({
      scope: ":r9:",
      cellNumbers: [5, 2, 5, 0, -1, 1.5, NaN],
    });

    expect(css).toContain('table[data-column-widths-scope="r9"]');
    expect(css.match(NTH_CHILD_RULE)).toEqual([
      "td:nth-child(2)",
      "td:nth-child(2)",
      "td:nth-child(5)",
      "td:nth-child(5)",
    ]);
  });

  test("no sized column, no rules", () => {
    expect(getSizedColumnsCss({ scope: "r1", cellNumbers: [] })).toBe("");
  });
});
