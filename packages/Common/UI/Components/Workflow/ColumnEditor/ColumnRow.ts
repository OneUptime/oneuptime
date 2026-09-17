/*
 * The row model shared by the record form and the query builder.
 *
 * A row is one column of the model plus the value the builder typed for it.
 * Everything the editor knows about a row that is not the schema lives here,
 * and the two React bodies hold no state of their own — ModelColumnEditor owns
 * the array and hands it down, so a row can never disagree with the JSON the
 * argument is stored as.
 */

import { DictionaryFilterOperator } from "../../Dictionary/DictionaryFilterOperator";

/**
 * The kind of control a column's value is typed into.
 *
 * Deliberately much smaller than TableColumnType: the builder does not need a
 * different box for Email than for Slug, and every extra control is another
 * thing that can render the wrong way round. What matters is the shape of the
 * value that comes out — string, number, boolean, ISO date — because that is
 * what ends up in the JSON the server parses.
 */
export enum ModelColumnControl {
  Text = "Text",
  LongText = "LongText",
  Number = "Number",
  Boolean = "Boolean",
  Date = "Date",
  ObjectId = "ObjectId",
  Color = "Color",
  /** Buffers, files, nested JSON, monitor steps — no row can hold one. */
  Unsupported = "Unsupported",
}

/**
 * How the value in a row is being edited.
 *
 * Literal is the type-appropriate control. Reference is the {{ }} autocomplete,
 * available on every column type because most creates are assembled out of an
 * earlier step's return values. Raw is the escape hatch for a stored scalar
 * whose JavaScript type disagrees with the column's — `{"port": "8080"}` on a
 * numeric column — which is re-emitted exactly as it was read until the builder
 * edits that one cell. Without Raw, opening a workflow and saving it again
 * would quietly rewrite the stored bytes.
 */
export enum ColumnValueMode {
  Literal = "Literal",
  Reference = "Reference",
  Raw = "Raw",
}

/**
 * One row of the editor.
 *
 * `text` is what the control shows and is always a string, whatever the column
 * type — the conversion to a JSON number/boolean/null happens once, on the way
 * out, in ColumnRowSerialization. `values` is only used by the multi-value
 * operators (is any of / is none of), which Record mode never offers.
 */
export interface ModelColumnRow {
  /**
   * This row's identity for React, fixed when the row is created.
   *
   * It cannot be the column name: an unknown column is edited in a text box, so
   * keying on the name would give the row a new identity on every keystroke,
   * unmount it mid-word and take the focused input with it.
   */
  key: string;
  /** The column name as it will be written into the JSON object. */
  columnId: string;
  operator: DictionaryFilterOperator;
  valueMode: ColumnValueMode;
  text: string;
  values: Array<string>;
  /**
   * True for a blank row the editor opened with because the model says a create
   * must supply this column. Seeded rows serialize away while they are empty,
   * so an untouched Create One still reads as "nothing set" to form validation
   * and to the graph linter.
   */
  isSeeded: boolean;
  /**
   * The value exactly as it was read from storage, kept only for
   * ColumnValueMode.Raw so that round-tripping is byte-for-byte.
   */
  rawValue?: unknown;
}

/*
 * A counter rather than a random id, so a row's identity is reproducible and
 * two editors mounted in the same page can never collide.
 */
let nextRowKey: number = 0;

export type MakeColumnRowFunction = (
  row: Partial<ModelColumnRow> & { columnId: string },
) => ModelColumnRow;

export const makeColumnRow: MakeColumnRowFunction = (
  row: Partial<ModelColumnRow> & { columnId: string },
): ModelColumnRow => {
  nextRowKey = nextRowKey + 1;

  return {
    key: row.key || `row-${nextRowKey}`,
    columnId: row.columnId,
    operator: row.operator || DictionaryFilterOperator.EqualTo,
    valueMode: row.valueMode || ColumnValueMode.Literal,
    text: row.text === undefined ? "" : row.text,
    values: row.values || [],
    isSeeded: Boolean(row.isSeeded),
    ...(row.rawValue === undefined ? {} : { rawValue: row.rawValue }),
  };
};

/**
 * A row with some of its fields changed.
 *
 * Every edit goes through here rather than through several separate callbacks,
 * because two callbacks fired from one event both close over the same render's
 * row and the second silently discards the first. That is how editing a raw
 * cell came to change the box on screen without changing what was stored.
 *
 * Leaving Raw drops the stored original: from that point the builder's own
 * value is what the row means, in the column's own type.
 */
export type ChangeColumnRowFunction = (
  row: ModelColumnRow,
  change: Partial<
    Pick<
      ModelColumnRow,
      "columnId" | "operator" | "valueMode" | "text" | "values"
    >
  >,
) => ModelColumnRow;

export const changeColumnRow: ChangeColumnRowFunction = (
  row: ModelColumnRow,
  change: Partial<
    Pick<
      ModelColumnRow,
      "columnId" | "operator" | "valueMode" | "text" | "values"
    >
  >,
): ModelColumnRow => {
  const next: ModelColumnRow = {
    ...row,
    ...change,
    // Any edit means the row is no longer just a blank the editor opened with.
    isSeeded: false,
  };

  if (next.valueMode !== ColumnValueMode.Raw) {
    delete next.rawValue;
  }

  return next;
};
