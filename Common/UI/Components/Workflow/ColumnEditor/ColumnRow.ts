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

export type MakeColumnRowFunction = (
  row: Partial<ModelColumnRow> & { columnId: string },
) => ModelColumnRow;

export const makeColumnRow: MakeColumnRowFunction = (
  row: Partial<ModelColumnRow> & { columnId: string },
): ModelColumnRow => {
  return {
    columnId: row.columnId,
    operator: row.operator || DictionaryFilterOperator.EqualTo,
    valueMode: row.valueMode || ColumnValueMode.Literal,
    text: row.text === undefined ? "" : row.text,
    values: row.values || [],
    isSeeded: Boolean(row.isSeeded),
    ...(row.rawValue === undefined ? {} : { rawValue: row.rawValue }),
  };
};
