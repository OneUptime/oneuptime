import Column from "../Types/Column";
import Columns from "../Types/Columns";
import FieldType from "../../Types/FieldType";
import { VALUE_KINDS_KEPT_WHOLE } from "../CellClassName";
import {
  TABLE_NAME_FILL_FLOOR_IN_PX,
  TABLE_VALUE_GIVE_FLOOR_IN_PX,
} from "../TableLayout";
import GenericObject from "../../../../Types/GenericObject";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * A table's columns, as wide as the person reading it wants them.
 *
 * "I'm not able to resize columns, so I'm not able to drag and increase the
 * width of the columns or decrease the width of the columns." - the
 * maintainer, of every table in the Dashboard. A column's edge in the
 * header row can now be dragged (ColumnResizeHandle): wider, to read a long
 * name whole; narrower, to keep a column of short words out of the way.
 * Double-clicking the edge fits the column to what it holds, the keyboard
 * moves it too, and the widths are remembered per person and per table
 * (useColumnWidths).
 *
 * What this file holds is the arithmetic and the remembering, apart from
 * any React and any page, so its rules are pinned by unit tests:
 *
 *   - A column a person has not sized keeps the table's own width for it -
 *     a table that fits its card shares the room out among those columns,
 *     and gives way before it scrolls, as it always did (useTableScrollState).
 *     A sized column is that wide, exactly: its header cell carries the
 *     width as its width, least and most width (getHeaderCellWidthStyle), so
 *     neither its values nor the room left over move it.
 *   - Nothing is ever cut that must be read whole (getColumnWidthFloor):
 *     a header's words (they may break between words, never inside one),
 *     a short name, a date, a number. Long words give way down to the floors
 *     the table's own giving way stops at - 10rem for a row's name and a
 *     column of prose, 8rem for any other value - and show in full under
 *     the pointer, as any value cut short does.
 *   - The drag grip, the select box and the row's actions are not columns a
 *     person sizes: they are as wide as what they hold (isColumnResizable).
 *   - A width is remembered by the column's id, never its position, so a
 *     column that moves (the Columns picker) keeps it, one switched off and
 *     on again finds it again, and one the table no longer has is simply
 *     never drawn (readColumnWidths).
 *
 * React-free on purpose: App's tests may import it.
 */

// A column's id -> how wide a person made it, in CSS pixels, its padding in.
export type ColumnWidths = Readonly<Record<string, number>>;

/*
 * A record keyed by columns' ids that inherits nothing. An id is whatever a
 * table's columns are called - a log attribute's key, a query's column in
 * the admin's query console - so "constructor" or "__proto__" is a column
 * like any other: never a function every object has, read as a width, nor
 * the setter of the record's prototype.
 */
export const createColumnIdRecord: <V>() => Record<string, V> = <V>(): Record<
  string,
  V
> => {
  return Object.create(null) as Record<string, V>;
};

export const EMPTY_COLUMN_WIDTHS: ColumnWidths = Object.freeze(
  createColumnIdRecord<number>(),
);

/*
 * How a column's values may be cut short when a person narrows it - the
 * same kinds the table gives way by when it does not fit its card
 * (CellClassName's isFillingNameColumn / isGivingValueColumn).
 */
export enum ColumnWidthKind {
  // A date, a number, a tick, a colour: never cut, its column never narrower.
  Whole = "whole",
  // The row's name, its first column: cut short no further than 10rem.
  Name = "name",
  // Any other value on one line: cut short no further than 8rem.
  Text = "text",
  // A column of prose that wraps: never narrower than 10rem.
  Prose = "prose",
}

// The least any column is drawn: its edge can still be found and dragged.
export const COLUMN_MIN_WIDTH_IN_PX: number = 48;

// The most a column is drawn: a log line pasted into a cell has no end.
export const COLUMN_MAX_WIDTH_IN_PX: number = 1600;

/*
 * The most a double-click on a column's edge makes it, to show its widest
 * value whole: a 40rem column reads a long URL or a sentence at a glance,
 * and a cell holding a pasted log does not make its column a page wide.
 */
export const COLUMN_FIT_MAX_WIDTH_IN_PX: number = 640;

/*
 * The least a value gives way to, by kind: the floors the table's own
 * giving way stops at (TableLayout), so a person narrowing a column and a
 * table making room for its card cut a value short at the same place.
 */
export const COLUMN_NAME_FLOOR_IN_PX: number = TABLE_NAME_FILL_FLOOR_IN_PX;
export const COLUMN_VALUE_FLOOR_IN_PX: number = TABLE_VALUE_GIVE_FLOOR_IN_PX;
// TableLayout's TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME, min-w-[10rem].
export const COLUMN_PROSE_FLOOR_IN_PX: number = 160;

/*
 * How far one press of an arrow key moves a column's edge: 16px, or 64px
 * with Shift - a column's width in a few presses, never a pixel at a time.
 */
export const COLUMN_RESIZE_STEP_IN_PX: number = 16;
export const COLUMN_RESIZE_LARGE_STEP_IN_PX: number = 64;

/*
 * How many widths one table remembers. A width outlives its column - one
 * switched off in the Columns picker, or hidden below a large screen, is
 * drawn again with it - so they are kept, but never without end: the
 * widths of the columns the table draws now are kept first.
 */
export const MAX_REMEMBERED_COLUMN_WIDTHS: number = 60;

/*
 * The kind of a table column's values (ColumnWidthKind). isPrimaryColumn is
 * whether it is the row's first column - its name, in almost every list.
 */
export const getColumnWidthKind: <T extends GenericObject>(
  column: Column<T>,
  isPrimaryColumn: boolean,
) => ColumnWidthKind = <T extends GenericObject>(
  column: Column<T>,
  isPrimaryColumn: boolean,
): ColumnWidthKind => {
  if (VALUE_KINDS_KEPT_WHOLE.includes(column.type)) {
    return ColumnWidthKind.Whole;
  }

  if (column.wrapContent) {
    return ColumnWidthKind.Prose;
  }

  return isPrimaryColumn ? ColumnWidthKind.Name : ColumnWidthKind.Text;
};

/*
 * Whether a person may size this column. The row's actions are as wide as
 * their buttons; a page whose layout depends on its widths says so
 * (Column.disableResize).
 */
export const isColumnResizable: <T extends GenericObject>(
  column: Column<T>,
) => boolean = <T extends GenericObject>(column: Column<T>): boolean => {
  return column.type !== FieldType.Actions && !column.disableResize;
};

type SlugifyFunction = (value: string) => string;

const NOT_A_SLUG_CHARACTER: RegExp = /[^a-z0-9]+/g;

const SLUG_DASH: string = "-";

/*
 * A title as an id: its letters and digits, lower case, each run of
 * anything else one dash, none at either end. The ends are trimmed by
 * walking in from each, not by a pattern: /-+$/ tries every dash it meets
 * as a start, which takes time with the square of a title's length.
 */
const slugify: SlugifyFunction = (value: string): string => {
  const dashed: string = value
    .toLowerCase()
    .replace(NOT_A_SLUG_CHARACTER, SLUG_DASH);
  let start: number = 0;
  let end: number = dashed.length;

  while (start < end && dashed.charAt(start) === SLUG_DASH) {
    start++;
  }

  while (end > start && dashed.charAt(end - 1) === SLUG_DASH) {
    end--;
  }

  return dashed.slice(start, end);
};

/*
 * Every column's id, in order and each one unique: the id a ModelTable gave
 * it (ColumnPreference's getColumnIds), else the field it reads, else its
 * title - never its position, which changes whenever a column is added
 * before it. Two columns with one base id are told apart by their titles,
 * then by how many came before.
 */
export const getTableColumnIds: <T extends GenericObject>(
  columns: Columns<T>,
) => Array<string> = <T extends GenericObject>(
  columns: Columns<T>,
): Array<string> => {
  const baseIds: Array<string> = columns.map((column: Column<T>): string => {
    if (column.id) {
      return column.id;
    }

    if (column.key) {
      return String(column.key);
    }

    return slugify(column.title || "") || "column";
  });

  const baseIdCounts: Record<string, number> = createColumnIdRecord<number>();

  for (const baseId of baseIds) {
    baseIdCounts[baseId] = (baseIdCounts[baseId] || 0) + 1;
  }

  const usedIds: Record<string, number> = createColumnIdRecord<number>();

  return columns.map((column: Column<T>, index: number): string => {
    const baseId: string = baseIds[index] as string;
    const titleSlug: string = slugify(column.title || "");
    const candidate: string =
      (baseIdCounts[baseId] || 0) > 1 && titleSlug && !column.id
        ? `${baseId}:${titleSlug}`
        : baseId;
    const timesUsed: number = usedIds[candidate] || 0;

    usedIds[candidate] = timesUsed + 1;

    return timesUsed === 0 ? candidate : `${candidate}#${timesUsed + 1}`;
  });
};

// What a column's header and values take, read off the page (ColumnWidthMeasure).
export interface ColumnContentWidths {
  /*
   * The header's least width: its name broken between every two words it
   * may break between, with its sort arrow, its (i) and its padding.
   */
  headerMinContentWidth: number;
  // The header on one line, with everything beside it.
  headerMaxContentWidth: number;
  // The widest value on the page, whole, on one line, without the padding.
  widestValueWidth: number;
  // A cell's padding at its start and its end.
  cellPaddingWidth: number;
  /*
   * The least the page draws the column at once it is sized - its header
   * cell given no width, its values under the rules of a sized column
   * (getSizedColumnsCss) - padding in: what no width given to it can go
   * under (a word, a picture, a value drawn in no box of its own).
   */
  leastDrawnWidth?: number | undefined;
}

/*
 * The least a person may make a column (its padding in): its header whole,
 * and its values cut short no further than their kind allows - a value no
 * wider than its floor not at all, so a column of short names or short
 * words is never cut ("short names never set free" - their floor would only
 * widen the column) - and a date or a number never.
 */
export const getColumnWidthFloor: (data: {
  measured: ColumnContentWidths;
  kind: ColumnWidthKind;
}) => number = (data: {
  measured: ColumnContentWidths;
  kind: ColumnWidthKind;
}): number => {
  const measured: ColumnContentWidths = data.measured;
  const widest: number = Math.max(0, measured.widestValueWidth || 0);
  let valueFloor: number = widest;

  if (data.kind === ColumnWidthKind.Name) {
    valueFloor = Math.min(widest, COLUMN_NAME_FLOOR_IN_PX);
  } else if (data.kind === ColumnWidthKind.Text) {
    valueFloor = Math.min(widest, COLUMN_VALUE_FLOOR_IN_PX);
  } else if (data.kind === ColumnWidthKind.Prose) {
    valueFloor = Math.min(widest, COLUMN_PROSE_FLOOR_IN_PX);
  }

  const valueFloorWithPadding: number =
    widest > 0 ? valueFloor + Math.max(0, measured.cellPaddingWidth || 0) : 0;

  return Math.ceil(
    Math.max(
      COLUMN_MIN_WIDTH_IN_PX,
      Math.max(0, measured.headerMinContentWidth || 0),
      valueFloorWithPadding,
      // A width the page cannot draw would be kept, and never be drawn.
      Math.max(0, measured.leastDrawnWidth || 0),
    ),
  );
};

/*
 * As wide as a column needs to show its header on one line and its widest
 * value whole - what a double-click on its edge makes it - up to 40rem
 * (COLUMN_FIT_MAX_WIDTH_IN_PX), and never below its floor: a date wider
 * than 40rem stays whole.
 */
export const getColumnFitWidth: (data: {
  measured: ColumnContentWidths;
  floor: number;
}) => number = (data: {
  measured: ColumnContentWidths;
  floor: number;
}): number => {
  const measured: ColumnContentWidths = data.measured;
  const widest: number = Math.max(0, measured.widestValueWidth || 0);
  const wanted: number = Math.max(
    Math.max(0, measured.headerMaxContentWidth || 0),
    widest > 0 ? widest + Math.max(0, measured.cellPaddingWidth || 0) : 0,
  );

  return Math.ceil(
    Math.max(
      data.floor,
      Math.min(wanted, Math.max(data.floor, COLUMN_FIT_MAX_WIDTH_IN_PX)),
    ),
  );
};

/*
 * A width a person asked for, as the column is drawn: whole pixels, no
 * narrower than its floor, no wider than COLUMN_MAX_WIDTH_IN_PX.
 */
export const clampColumnWidth: (width: number, floor: number) => number = (
  width: number,
  floor: number,
): number => {
  const least: number = Math.max(COLUMN_MIN_WIDTH_IN_PX, floor || 0);
  const most: number = Math.max(least, COLUMN_MAX_WIDTH_IN_PX);

  if (!Number.isFinite(width)) {
    return least;
  }

  return Math.round(Math.min(most, Math.max(least, width)));
};

/*
 * Where a dragged edge puts its column: as much wider as the pointer moved
 * away from the column's start - to the right on a page that reads left to
 * right, to the left on one that reads right to left, whose columns end at
 * their left edge (the handle sits there: TailwindReadingDirection).
 */
export const getPointerResizedWidth: (data: {
  startWidth: number;
  startX: number;
  x: number;
  isRightToLeft: boolean;
  floor: number;
}) => number = (data: {
  startWidth: number;
  startX: number;
  x: number;
  isRightToLeft: boolean;
  floor: number;
}): number => {
  const moved: number = data.isRightToLeft
    ? data.startX - data.x
    : data.x - data.startX;

  return clampColumnWidth(data.startWidth + moved, data.floor);
};

// What a key pressed on a column's edge asks for.
export type ColumnResizeKeyResult =
  | { kind: "width"; width: number }
  // Back to the width the table gives the column itself.
  | { kind: "automatic" }
  // Not a key the edge answers: it goes on to the page (Tab, a shortcut).
  | null;

/*
 * The keyboard's way to size a column, on its focused edge (a separator, as
 * WAI-ARIA's window splitter): the arrow keys move the edge the way they
 * point - so on a right-to-left page the left arrow widens its column -
 * 16px a press, 64px with Shift; Home makes it as narrow as it goes and End
 * (or Enter, as a double-click does) fits it to its content; Delete or
 * Backspace gives it back to the table.
 */
export const getKeyboardResizedWidth: (data: {
  key: string;
  shiftKey: boolean;
  width: number;
  floor: number;
  fitWidth: number;
  isRightToLeft: boolean;
}) => ColumnResizeKeyResult = (data: {
  key: string;
  shiftKey: boolean;
  width: number;
  floor: number;
  fitWidth: number;
  isRightToLeft: boolean;
}): ColumnResizeKeyResult => {
  const step: number = data.shiftKey
    ? COLUMN_RESIZE_LARGE_STEP_IN_PX
    : COLUMN_RESIZE_STEP_IN_PX;

  switch (data.key) {
    case "ArrowRight":
    case "ArrowLeft": {
      const isWider: boolean =
        (data.key === "ArrowRight") !== Boolean(data.isRightToLeft);

      return {
        kind: "width",
        width: clampColumnWidth(
          data.width + (isWider ? step : -step),
          data.floor,
        ),
      };
    }
    case "Home":
      return { kind: "width", width: clampColumnWidth(data.floor, data.floor) };
    case "End":
    case "Enter":
      return {
        kind: "width",
        width: clampColumnWidth(data.fitWidth, data.floor),
      };
    case "Delete":
    case "Backspace":
      return { kind: "automatic" };
    default:
      return null;
  }
};

/*
 * The width of a column as its header cell carries it: as wide as that,
 * and no narrower or wider for anything its cells hold or the room the
 * table has left over - except a column of dates or numbers, which grows
 * for a wider one rather than cut it (a page further on can hold a longer
 * date than the one it was sized by).
 */
export interface HeaderCellWidthStyle {
  width: string;
  minWidth: string;
  maxWidth?: string | undefined;
}

export const getHeaderCellWidthStyle: (
  width: number,
  kind: ColumnWidthKind,
) => HeaderCellWidthStyle = (
  width: number,
  kind: ColumnWidthKind,
): HeaderCellWidthStyle => {
  const value: string = `${Math.round(width)}px`;

  if (kind === ColumnWidthKind.Whole) {
    return { width: value, minWidth: value };
  }

  return { width: value, minWidth: value, maxWidth: value };
};

/*
 * A stored layout read back. Anything on the way in is untrusted - written
 * by an older release, or edited by hand - so only finite widths under
 * string ids are kept, each held to what a column may be.
 */
export const readColumnWidths: (value: unknown) => ColumnWidths = (
  value: unknown,
): ColumnWidths => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_COLUMN_WIDTHS;
  }

  const widths: Record<string, number> = createColumnIdRecord<number>();
  let count: number = 0;

  for (const [id, width] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_REMEMBERED_COLUMN_WIDTHS) {
      break;
    }

    if (
      !id ||
      typeof width !== "number" ||
      !Number.isFinite(width) ||
      width <= 0
    ) {
      continue;
    }

    widths[id] = clampColumnWidth(width, COLUMN_MIN_WIDTH_IN_PX);
    count++;
  }

  return Object.keys(widths).length > 0 ? widths : EMPTY_COLUMN_WIDTHS;
};

/*
 * The widths with one column's set - or taken away (null), the column back
 * at the table's own width. The column changed and the ones in drawnIds
 * (those the table draws now) are kept first when there are more than a
 * table remembers. A change that changes nothing hands back the same
 * widths, so nothing that draws them is drawn again.
 */
export const withColumnWidth: (data: {
  widths: ColumnWidths;
  columnId: string;
  width: number | null;
  drawnIds?: ReadonlyArray<string> | undefined;
}) => ColumnWidths = (data: {
  widths: ColumnWidths;
  columnId: string;
  width: number | null;
  drawnIds?: ReadonlyArray<string> | undefined;
}): ColumnWidths => {
  const isRemoved: boolean =
    data.width === null ||
    !Number.isFinite(data.width) ||
    (data.width as number) <= 0;

  if (isRemoved && data.widths[data.columnId] === undefined) {
    return data.widths;
  }

  if (
    !isRemoved &&
    data.widths[data.columnId] ===
      clampColumnWidth(data.width as number, COLUMN_MIN_WIDTH_IN_PX)
  ) {
    return data.widths;
  }

  const next: Record<string, number> = Object.assign(
    createColumnIdRecord<number>(),
    data.widths,
  );

  delete next[data.columnId];

  if (data.width !== null && Number.isFinite(data.width) && data.width > 0) {
    next[data.columnId] = clampColumnWidth(data.width, COLUMN_MIN_WIDTH_IN_PX);
  }

  const ids: Array<string> = Object.keys(next);

  if (ids.length <= MAX_REMEMBERED_COLUMN_WIDTHS) {
    return ids.length > 0 ? next : EMPTY_COLUMN_WIDTHS;
  }

  const drawn: Set<string> = new Set(data.drawnIds || []);
  const kept: Array<string> = [
    ...ids.filter((id: string): boolean => {
      return id === data.columnId;
    }),
    ...ids.filter((id: string): boolean => {
      return id !== data.columnId && drawn.has(id);
    }),
    ...ids.filter((id: string): boolean => {
      return id !== data.columnId && !drawn.has(id);
    }),
  ].slice(0, MAX_REMEMBERED_COLUMN_WIDTHS);

  const trimmed: Record<string, number> = createColumnIdRecord<number>();

  for (const id of kept) {
    trimmed[id] = next[id] as number;
  }

  return trimmed;
};

// The widths a table stores: nothing when it has none.
export const toColumnWidthsJSON: (widths: ColumnWidths) => JSONObject | null = (
  widths: ColumnWidths,
): JSONObject | null => {
  const ids: Array<string> = Object.keys(widths);

  if (ids.length === 0) {
    return null;
  }

  const json: JSONObject = createColumnIdRecord<JSONValue>();

  for (const id of ids) {
    json[id] = widths[id] as number;
  }

  return json;
};

// Whether any of the columns a table draws has a width of a person's own.
export const hasDrawnColumnWidths: (
  widths: ColumnWidths,
  drawnIds: ReadonlyArray<string>,
) => boolean = (
  widths: ColumnWidths,
  drawnIds: ReadonlyArray<string>,
): boolean => {
  return drawnIds.some((id: string): boolean => {
    return widths[id] !== undefined;
  });
};

/*
 * Where a table's widths are remembered: one entry per person and per
 * table (UserPreferences' TableColumnWidths), so two people who share a
 * browser - an on-call laptop, a screen in the office - keep their own. A
 * page with no one signed in (a status page, a public dashboard) keeps one
 * for whoever reads it.
 */
export const COLUMN_WIDTHS_ANONYMOUS_PERSON: string = "anyone";

export const getColumnWidthsPreferenceKey: (data: {
  tableKey: string;
  personId?: string | null | undefined;
}) => string = (data: {
  tableKey: string;
  personId?: string | null | undefined;
}): string => {
  const personId: string =
    (data.personId || "").trim() || COLUMN_WIDTHS_ANONYMOUS_PERSON;

  return `${personId}.${data.tableKey}`;
};

/*
 * A sized column's values use the width it is given: the table caps a
 * value at 20rem and floors some (a row's name, a column of prose) at
 * 10rem, so a column made wider would show them no wider, and one made
 * narrower would have them run over the column beside it; a table a page
 * draws itself may cap a cell itself (max-w-xs on a logs list's trace id),
 * and its words on one line would run on over the next column: a sized
 * column's cell clips what it holds, sideways only, ending a line of words
 * in "..." (a ring or a lifted avatar above and below still shows).
 * The rules that lift them are written for the column's place in the row -
 * one rule a column, read by every row at once, rather than a class on each
 * of a table's cells - inside the table that carries the scope attribute.
 * A sized column's header breaks its words where they may break, so a
 * column narrower than its name keeps the name whole.
 *
 * A table gives a column at least the widest of its values on one line,
 * whatever width its header cell asks for: a list of resources whose names
 * do not wrap held its column at 454px when a person dragged it to 224, and
 * the width kept was never drawn. So the box a sized column's cell draws
 * its value in asks the table for no width of its own (contain:
 * inline-size): it is as wide as the column, and its value is cut short
 * inside it. Not a column kept whole (dates, numbers): it still grows for a
 * wider value rather than cut one (getHeaderCellWidthStyle).
 *
 * The shared Table's value boxes cut their own words short, each ending in
 * "..." (CellClassName). A table a page draws itself often draws a value in
 * a box of no truncation of its own - a Postgres table's name over its
 * share of the database - whose words ran on past the box and were cut
 * mid-letter at the cell's edge; so a page's own table (clipsValueBoxes)
 * has its sized column's value boxes clip their words too, ending them in
 * "...".
 */
export const COLUMN_WIDTHS_SCOPE_ATTRIBUTE: string = "data-column-widths-scope";

const NOT_A_SCOPE_CHARACTER: RegExp = /[^A-Za-z0-9_-]/g;

// A table's scope, safe to write in a rule: React's ids hold colons.
export const getColumnWidthsScope: (id: string) => string = (
  id: string,
): string => {
  return id.replace(NOT_A_SCOPE_CHARACTER, "") || "table";
};

export const getSizedColumnsCss: (data: {
  scope: string;
  // Each sized column's place among its row's cells, from 1.
  cellNumbers: ReadonlyArray<number>;
  // ...and the places of those whose values are kept whole.
  wholeCellNumbers?: ReadonlyArray<number> | undefined;
  /*
   * A table a page draws itself: a value box that is cut short ends its
   * words in "..." (the shared Table's boxes do it themselves).
   */
  clipsValueBoxes?: boolean | undefined;
}) => string = (data: {
  scope: string;
  cellNumbers: ReadonlyArray<number>;
  wholeCellNumbers?: ReadonlyArray<number> | undefined;
  clipsValueBoxes?: boolean | undefined;
}): string => {
  const whole: Set<number> = new Set<number>(data.wholeCellNumbers || []);
  const scope: string = getColumnWidthsScope(data.scope);
  const table: string = `table[${COLUMN_WIDTHS_SCOPE_ATTRIBUTE}="${scope}"]`;
  const numbers: Array<number> = Array.from(new Set(data.cellNumbers))
    .filter((cellNumber: number): boolean => {
      return Number.isInteger(cellNumber) && cellNumber > 0;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  return numbers
    .map((cellNumber: number): string => {
      return [
        `${table} > tbody > tr > td:nth-child(${cellNumber}) { max-width: none; overflow-x: clip; text-overflow: ellipsis; }`,
        `${table} > tbody > tr > td:nth-child(${cellNumber}) > div { max-width: none; min-width: 0;${
          whole.has(cellNumber)
            ? ""
            : data.clipsValueBoxes
              ? " contain: inline-size; overflow-x: clip; text-overflow: ellipsis;"
              : " contain: inline-size;"
        } }`,
        `${table} > thead > tr > th:nth-child(${cellNumber}) * { white-space: normal; }`,
      ].join("\n");
    })
    .join("\n");
};
