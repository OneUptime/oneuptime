/*
 * Stored JSON <-> rows, in both directions.
 *
 * The last step out is always buildColumnValueJson, and the operator wrappers
 * are always built by buildDictionaryValue, so the bytes that reach the server
 * are produced by exactly the code that produced them before this editor
 * existed. Everything here decides *what* to hand those two functions.
 *
 * The rule that shapes the whole file: reading a value and writing it back
 * unchanged must produce the same bytes. An editor that quietly rewrites
 * {"port": "8080"} into {"port": 8080} the moment someone opens a workflow and
 * saves it is worse than one that asks a question it should not have needed to
 * ask.
 */

import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { getTemplateExpressionRegex } from "../../../../Types/Workflow/TemplateSyntax";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  buildDictionaryValue,
  detectOperatorFromValue,
  getOperatorOption,
} from "../../Dictionary/DictionaryFilterOperator";
import {
  ModelColumnEditorMode,
  buildColumnValueJson,
} from "../ModelColumnEditor";
import {
  ModelSchemaColumn,
  findColumn,
  requiredWritableColumns,
} from "../ModelSchema";
import { controlForColumn, literalFitsControl } from "./ColumnControl";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
  makeColumnRow,
} from "./ColumnRow";

export type ContainsTemplateExpressionFunction = (value: string) => boolean;

/**
 * Does this text hold a {{ }} reference?
 *
 * Uses the runtime's own matcher rather than a hand-rolled `/{{/`, so a value
 * this editor calls a reference is one the runner will actually substitute.
 */
export const containsTemplateExpression: ContainsTemplateExpressionFunction = (
  value: string,
): boolean => {
  return getTemplateExpressionRegex().test(value);
};

type UnwrapOperatorValueFunction = (value: unknown) => unknown;

/*
 * The scalar inside an operator wrapper, or the value itself when it is not
 * one. detectOperatorFromValue gives back a string for display; this keeps the
 * original JavaScript type so a stored number stays a number.
 */
const unwrapOperatorValue: UnwrapOperatorValueFunction = (
  value: unknown,
): unknown => {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value?: unknown }).value;
  }

  return value;
};

type LiteralTextForFunction = (
  control: ModelColumnControl,
  value: unknown,
) => string;

const literalTextFor: LiteralTextForFunction = (
  control: ModelColumnControl,
  value: unknown,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (control === ModelColumnControl.Boolean) {
    return value === true ? "true" : "false";
  }

  return String(value);
};

export type ClassifyRowValueFunction = (
  control: ModelColumnControl,
  value: unknown,
) => Pick<ModelColumnRow, "valueMode" | "text" | "rawValue">;

/**
 * Which of the three editing modes a stored value belongs in.
 *
 * Inferred once, when the value is read. Never guessed at render time - a cell
 * that decided for itself what it was holding would flip modes as the builder
 * typed.
 */
export const classifyRowValue: ClassifyRowValueFunction = (
  control: ModelColumnControl,
  value: unknown,
): Pick<ModelColumnRow, "valueMode" | "text" | "rawValue"> => {
  if (typeof value === "string" && containsTemplateExpression(value)) {
    return { valueMode: ColumnValueMode.Reference, text: value };
  }

  /*
   * null is a real stored value and no empty control can express it: an empty
   * control emits "", which a record drops entirely. So it is kept raw and
   * re-emitted verbatim until the builder types over it.
   */
  if (value === null) {
    return { valueMode: ColumnValueMode.Raw, text: "", rawValue: null };
  }

  if (literalFitsControl(control, value)) {
    return {
      valueMode: ColumnValueMode.Literal,
      text: literalTextFor(control, value),
    };
  }

  return {
    valueMode: ColumnValueMode.Raw,
    text: literalTextFor(control, value),
    rawValue: value,
  };
};

export type RowsFromParsedValueFunction = (
  parsed: JSONObject | null,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
) => Array<ModelColumnRow>;

/**
 * The stored object, as rows, in the order its keys were written.
 *
 * Order is never sorted. The picker is sorted (the endpoint does it by title),
 * but the rows are the document, and reordering them is rewriting the stored
 * bytes for nothing.
 */
export const rowsFromParsedValue: RowsFromParsedValueFunction = (
  parsed: JSONObject | null,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
): Array<ModelColumnRow> => {
  if (!parsed) {
    return [];
  }

  const isQuery: boolean = mode === ModelColumnEditorMode.Query;
  const rows: Array<ModelColumnRow> = [];

  for (const key of Object.keys(parsed)) {
    const value: unknown = parsed[key];
    const column: ModelSchemaColumn | undefined = findColumn(columns, key);
    const control: ModelColumnControl = controlForColumn(column);

    if (!isQuery) {
      rows.push(
        makeColumnRow({
          columnId: key,
          operator: DictionaryFilterOperator.EqualTo,
          ...classifyRowValue(control, value),
        }),
      );
      continue;
    }

    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(value);

    const option: DictionaryFilterOperatorOption = getOperatorOption(
      detected.operator,
    );

    if (option.expectsMultiValue) {
      rows.push(
        makeColumnRow({
          columnId: key,
          operator: detected.operator,
          values: detected.rawValues || [],
        }),
      );
      continue;
    }

    if (option.hidesValueInput) {
      rows.push(makeColumnRow({ columnId: key, operator: detected.operator }));
      continue;
    }

    rows.push(
      makeColumnRow({
        columnId: key,
        operator: detected.operator,
        ...classifyRowValue(control, unwrapOperatorValue(value)),
      }),
    );
  }

  return rows;
};

export type SeedRequiredRowsFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
) => Array<ModelColumnRow>;

/**
 * One blank row per column a create must be given a value for, appended after
 * whatever was stored.
 *
 * Appended, never inserted: the stored keys keep their order, so seeding cannot
 * change the bytes of a workflow that is only opened and closed. Seeded rows
 * hold "" and are dropped on the way out, so an untouched Create One still
 * reads as empty to form validation and to the graph linter.
 */
export const seedRequiredRows: SeedRequiredRowsFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
): Array<ModelColumnRow> => {
  const present: Set<string> = new Set(
    rows.map((row: ModelColumnRow) => {
      return row.columnId;
    }),
  );

  const seeded: Array<ModelColumnRow> = [];

  for (const column of requiredWritableColumns(columns)) {
    if (present.has(column.id)) {
      continue;
    }

    seeded.push(makeColumnRow({ columnId: column.id, isSeeded: true }));
  }

  return [...rows, ...seeded];
};

type EmitLiteralValueFunction = (
  control: ModelColumnControl,
  text: string,
) => DictionaryEntryValue;

/**
 * A row's text, as the JSON value it stands for.
 *
 * "" is returned as "" rather than as null or omitted, because that is the
 * marker buildColumnValueJson reads to drop a blank field from a record.
 */
const emitLiteralValue: EmitLiteralValueFunction = (
  control: ModelColumnControl,
  text: string,
): DictionaryEntryValue => {
  if (text === "") {
    return "";
  }

  if (control === ModelColumnControl.Number) {
    const asNumber: number = Number(text);

    /*
     * Text that is not a number is emitted as text, not dropped and not turned
     * into NaN. The row shows why it is wrong; throwing the value away would
     * take the builder's work with it.
     */
    if (text.trim() === "" || isNaN(asNumber)) {
      return text;
    }

    return asNumber;
  }

  if (control === ModelColumnControl.Boolean) {
    if (text === "true") {
      return true;
    }

    if (text === "false") {
      return false;
    }

    return text;
  }

  return text;
};

export type EmitRowValueFunction = (
  row: ModelColumnRow,
  control: ModelColumnControl,
) => DictionaryEntryValue;

/**
 * The value half of a row, before any operator wrapper is put around it.
 */
export const emitRowValue: EmitRowValueFunction = (
  row: ModelColumnRow,
  control: ModelColumnControl,
): DictionaryEntryValue => {
  if (row.valueMode === ColumnValueMode.Raw) {
    return row.rawValue as DictionaryEntryValue;
  }

  /*
   * A reference is always emitted as a string, on every column type. The
   * runner substitutes the text and the result is parsed as JSON, so an
   * unquoted substitution on a numeric column would be a gamble on what the
   * referenced value happens to look like. Postgres casts '5' to 5 on the way
   * into an integer column; it cannot rescue a document that does not parse.
   */
  if (row.valueMode === ColumnValueMode.Reference) {
    return row.text;
  }

  return emitLiteralValue(control, row.text);
};

type BuildComparisonWrapperFunction = (
  operator: DictionaryFilterOperator,
  value: string,
) => DictionaryEntryValue | null;

/*
 * The ordering operators built over a string rather than a number.
 *
 * buildDictionaryValue does `new GreaterThan(Number(text))`, which is right for
 * a number and silently destructive for anything else: a date or a {{ }}
 * reference becomes NaN, and JSON.stringify writes NaN as null - a query
 * against NULL that matches nothing and reports no error. These columns are
 * declared CompareType = number | Date | string, so the string form is a value
 * the wrapper was always able to hold.
 */
const buildComparisonWrapper: BuildComparisonWrapperFunction = (
  operator: DictionaryFilterOperator,
  value: string,
): DictionaryEntryValue | null => {
  switch (operator) {
    case DictionaryFilterOperator.GreaterThan:
      return new GreaterThan<string>(value);
    case DictionaryFilterOperator.GreaterThanOrEqual:
      return new GreaterThanOrEqual<string>(value);
    case DictionaryFilterOperator.LessThan:
      return new LessThan<string>(value);
    case DictionaryFilterOperator.LessThanOrEqual:
      return new LessThanOrEqual<string>(value);
    default:
      return null;
  }
};

export type BuildOperatorValueFunction = (
  row: ModelColumnRow,
  control: ModelColumnControl,
) => DictionaryEntryValue;

/**
 * A query row, wrapped in whatever its operator needs.
 *
 * Delegates to buildDictionaryValue for every case it handles correctly, so
 * each wrapper class's own toJSON() still produces the bytes and the key order
 * inside {_type, value} is unchanged.
 */
export const buildOperatorValue: BuildOperatorValueFunction = (
  row: ModelColumnRow,
  control: ModelColumnControl,
): DictionaryEntryValue => {
  const option: DictionaryFilterOperatorOption = getOperatorOption(
    row.operator,
  );

  if (option.hidesValueInput) {
    return buildDictionaryValue({ operator: row.operator, rawValue: "" });
  }

  if (option.expectsMultiValue) {
    return buildDictionaryValue({
      operator: row.operator,
      rawValue: "",
      rawValues: row.values,
    });
  }

  const emitted: DictionaryEntryValue = emitRowValue(row, control);

  /*
   * Equality carries no wrapper at all - it is stored as the bare value, which
   * is what every query written before operators existed looks like.
   */
  if (row.operator === DictionaryFilterOperator.EqualTo) {
    return emitted;
  }

  if (option.expectsNumericValue && typeof emitted !== "number") {
    const wrapper: DictionaryEntryValue | null = buildComparisonWrapper(
      row.operator,
      typeof emitted === "string" ? emitted : String(emitted ?? ""),
    );

    if (wrapper !== null) {
      return wrapper;
    }
  }

  return buildDictionaryValue({
    operator: row.operator,
    rawValue: typeof emitted === "string" ? emitted : String(emitted ?? ""),
  });
};

export type RowsToEntryDictionaryFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
) => Dictionary<DictionaryEntryValue>;

export const rowsToEntryDictionary: RowsToEntryDictionaryFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
): Dictionary<DictionaryEntryValue> => {
  const entries: Dictionary<DictionaryEntryValue> = {};
  const isQuery: boolean = mode === ModelColumnEditorMode.Query;

  for (const row of rows) {
    if (row.columnId.trim() === "") {
      continue;
    }

    const control: ModelColumnControl = controlForColumn(
      findColumn(columns, row.columnId),
    );

    entries[row.columnId] = isQuery
      ? buildOperatorValue(row, control)
      : emitRowValue(row, control);
  }

  return entries;
};

export type SerializeColumnRowsFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
) => string;

/**
 * The rows, as the string stored on the workflow argument.
 *
 * Ends in buildColumnValueJson, unchanged, which is what drops blank record
 * fields and collapses an empty editor to "" rather than to "{}".
 */
export const serializeColumnRows: SerializeColumnRowsFunction = (
  rows: Array<ModelColumnRow>,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
): string => {
  return buildColumnValueJson(rowsToEntryDictionary(rows, columns, mode), mode);
};

export type RowIssueFunction = (
  row: ModelColumnRow,
  column: ModelSchemaColumn | undefined,
) => string | null;

/**
 * What is wrong with what has been typed into this row, in one sentence, or
 * null when nothing is.
 *
 * Advisory only. Nothing here blocks saving: the value is still written, and
 * the builder can still be right about a column this endpoint describes badly.
 */
export const rowIssue: RowIssueFunction = (
  row: ModelColumnRow,
  column: ModelSchemaColumn | undefined,
): string | null => {
  if (row.valueMode !== ColumnValueMode.Literal || row.text === "") {
    return null;
  }

  const control: ModelColumnControl = controlForColumn(column);

  if (control === ModelColumnControl.Number && isNaN(Number(row.text))) {
    return "This column takes a number.";
  }

  if (control === ModelColumnControl.Date && isNaN(Date.parse(row.text))) {
    return "This column takes a date and time.";
  }

  return null;
};
