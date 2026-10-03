/*
 * Which control a column gets, decided from the model's own schema.
 *
 * This is the answer to "you already know the schema, why are you asking me?".
 * The editor used to show a Type dropdown next to every row — Text, Number,
 * Boolean — even though /model-schema/:tableName had already said that `color`
 * is a Color and `name` is a Name. Nothing good could come of that dropdown:
 * the builder could only agree with the schema or be wrong.
 */

import TableColumnType from "../../../../Types/Database/TableColumnType";
import { ModelSchemaColumn } from "../ModelSchema";
import { ModelColumnControl } from "./ColumnRow";
import { ColumnUse, canUseColumnFor, isSystemColumn } from "./ColumnUse";
import {
  translateText,
  translationKey,
} from "../../../Utils/TranslateTemplate";

/*
 * Spelled with the enum, never with string literals. The wire carries the
 * enum's *values* and several of them differ from the member name that reads
 * like the obvious literal: ShortText is "Text", ObjectID is "Object ID",
 * LongURL is "URL", PositiveNumber is "Positive Number" — and JavaScript is
 * "JavaSCript", capital S and all. ModelSchema.ts:160 documents the same trap;
 * a hand-written list here would classify the two most-declared column types
 * as unsupported and quietly send every one of them to a plain text box.
 */
const TEXT_COLUMN_TYPES: Array<string> = [
  TableColumnType.ShortText,
  TableColumnType.Slug,
  TableColumnType.Name,
  TableColumnType.Email,
  TableColumnType.Phone,
  TableColumnType.Domain,
  TableColumnType.IP,
  TableColumnType.Version,
  TableColumnType.LongURL,
  TableColumnType.ShortURL,
  TableColumnType.HashedString,
  TableColumnType.Password,
  TableColumnType.OTP,
  TableColumnType.MonitorType,
  TableColumnType.WorkflowStatus,
  TableColumnType.CustomFieldType,
  TableColumnType.Permission,
];

const LONG_TEXT_COLUMN_TYPES: Array<string> = [
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
  TableColumnType.Description,
  TableColumnType.Markdown,
  TableColumnType.HTML,
  TableColumnType.CSS,
  TableColumnType.JavaScript,
];

const NUMBER_COLUMN_TYPES: Array<string> = [
  TableColumnType.Number,
  TableColumnType.SmallNumber,
  TableColumnType.BigNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.BigPositiveNumber,
  TableColumnType.Port,
];

/*
 * Everything a row cannot hold. Entity/EntityArray are relations - pointing a
 * record at a related row means naming an existing record, which is what the
 * scalar foreign-key column next to it (currentIncidentStateId, and every other
 * "... ID" column) is for, and that column is offered normally.
 */
const UNSUPPORTED_COLUMN_TYPES: Array<string> = [
  TableColumnType.Entity,
  TableColumnType.EntityArray,
  TableColumnType.JSON,
  TableColumnType.Array,
  TableColumnType.Buffer,
  TableColumnType.File,
  TableColumnType.MonitorSteps,
];

export type ControlForColumnFunction = (
  column: ModelSchemaColumn | undefined,
) => ModelColumnControl;

/**
 * The control for a column, or Text when the schema has nothing to say.
 *
 * An unknown column — one the endpoint did not describe, or a key typed before
 * the schema loaded — gets Text rather than Unsupported, because the runner
 * accepts column names this endpoint does not surface and locking those rows
 * would be worse than letting them be typed.
 */
export const controlForColumn: ControlForColumnFunction = (
  column: ModelSchemaColumn | undefined,
): ModelColumnControl => {
  if (!column) {
    return ModelColumnControl.Text;
  }

  if (column.isRelation) {
    return ModelColumnControl.Unsupported;
  }

  if (UNSUPPORTED_COLUMN_TYPES.includes(column.type)) {
    return ModelColumnControl.Unsupported;
  }

  if (column.type === TableColumnType.Boolean) {
    return ModelColumnControl.Boolean;
  }

  if (column.type === TableColumnType.Date) {
    return ModelColumnControl.Date;
  }

  if (column.type === TableColumnType.ObjectID) {
    return ModelColumnControl.ObjectId;
  }

  if (column.type === TableColumnType.Color) {
    return ModelColumnControl.Color;
  }

  if (NUMBER_COLUMN_TYPES.includes(column.type)) {
    return ModelColumnControl.Number;
  }

  if (LONG_TEXT_COLUMN_TYPES.includes(column.type)) {
    return ModelColumnControl.LongText;
  }

  if (TEXT_COLUMN_TYPES.includes(column.type)) {
    return ModelColumnControl.Text;
  }

  return ModelColumnControl.Text;
};

export type ColumnTypeLabelFunction = (
  column: ModelSchemaColumn | undefined,
) => string;

// The type in English: the translation key columnTypeLabel looks up.
const englishColumnTypeLabel: ColumnTypeLabelFunction = (
  column: ModelSchemaColumn | undefined,
): string => {
  if (!column) {
    return translationKey("Unknown");
  }

  if (column.isRelation) {
    return translationKey("Relation");
  }

  switch (controlForColumn(column)) {
    case ModelColumnControl.Number:
      return translationKey("Number");
    case ModelColumnControl.Boolean:
      return translationKey("True or false");
    case ModelColumnControl.Date:
      return translationKey("Date and time");
    case ModelColumnControl.ObjectId:
      return translationKey("ID");
    case ModelColumnControl.Color:
      return translationKey("Color");
    case ModelColumnControl.LongText:
      return translationKey("Long text");
    case ModelColumnControl.Unsupported:
      /*
       * The raw column type is more use than the word "unsupported" here: it is
       * what the builder will have to write by hand in the JSON editor.
       */
      return column.type;
    default:
      return translationKey("Text");
  }
};

/**
 * The one-word type shown under a field's name, so the builder can see what
 * kind of value is expected without opening the model's documentation. In
 * the reader's language; a raw column type is a name and stays as it is.
 */
export const columnTypeLabel: ColumnTypeLabelFunction = (
  column: ModelSchemaColumn | undefined,
): string => {
  const label: string = englishColumnTypeLabel(column);

  return translateText(label) ?? label;
};

export type LiteralFitsControlFunction = (
  control: ModelColumnControl,
  value: unknown,
) => boolean;

/**
 * Can this stored value be shown in the typed control without changing it?
 *
 * A `false` here is not an error — it sends the row to ColumnValueMode.Raw,
 * where it is shown as text and re-emitted exactly as it was read. That is what
 * stops opening a workflow and saving it again from rewriting `{"port":"8080"}`
 * into `{"port":8080}` behind the builder's back.
 */
export const literalFitsControl: LiteralFitsControlFunction = (
  control: ModelColumnControl,
  value: unknown,
): boolean => {
  /*
   * An empty control holds "" and nothing else. undefined and "" are what an
   * untouched row is, so they fit; null does not, because an empty control
   * cannot say "null" - it emits "", which a record drops entirely. A stored
   * null therefore keeps its own value rather than being flattened into a
   * missing field.
   */
  if (value === undefined || value === "") {
    return true;
  }

  if (value === null) {
    return false;
  }

  switch (control) {
    case ModelColumnControl.Number:
      return typeof value === "number" && !isNaN(value);
    case ModelColumnControl.Boolean:
      return typeof value === "boolean";
    case ModelColumnControl.Date:
      /*
       * Dates travel as ISO strings. Anything else - a number of milliseconds,
       * an operator wrapper - is shown raw rather than reinterpreted.
       */
      return typeof value === "string" && !isNaN(Date.parse(value));
    default:
      return typeof value === "string";
  }
};

export type IsOfferableColumnFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
) => boolean;

/**
 * Should this column appear in the "add a field" picker for this use?
 *
 * Note this only gates what is *offered*. A column already stored on the
 * argument always gets its row, tenant column and system column alike,
 * because hiding a value that is really there is how an editor loses
 * someone's work.
 */
export const isOfferableColumn: IsOfferableColumnFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
): boolean => {
  if (column.isRelation) {
    return false;
  }

  /*
   * The workflow runner stamps the project column itself
   * (ModelArguments.applyTenantColumn) and overwrites whatever was typed, so
   * offering it would be offering a field that cannot work.
   */
  if (column.isTenantColumn) {
    return false;
  }

  // System columns on a write, create-only columns on an update, and so on.
  if (!canUseColumnFor(column, use)) {
    return false;
  }

  return controlForColumn(column) !== ModelColumnControl.Unsupported;
};

export type JsonOnlyColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  use: ColumnUse,
) => Array<ModelSchemaColumn>;

/**
 * Fields that belong in this list but cannot be a row: lists of related
 * records, JSON blobs, monitor steps.
 *
 * The record form names them under itself so the builder is not left
 * wondering where a column went. Left out are the fields that are not missing
 * at all: the ones OneUptime fills in, the project, and a relation whose
 * "... ID" column is offered instead - Current Incident State is set through
 * Current Incident State ID, so naming it as "JSON only" was wrong, and so was
 * naming Created by User, which nobody sets.
 */
export const jsonOnlyColumns: JsonOnlyColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  use: ColumnUse,
): Array<ModelSchemaColumn> => {
  return columns.filter((column: ModelSchemaColumn) => {
    if (isOfferableColumn(column, use)) {
      return false;
    }

    if (column.isTenantColumn || isSystemColumn(column)) {
      return false;
    }

    if (!canUseColumnFor(column, use)) {
      return false;
    }

    if (!column.isRelation) {
      return true;
    }

    const scalarSiblingId: string = `${column.id}Id`;
    const scalarSibling: ModelSchemaColumn | undefined = columns.find(
      (candidate: ModelSchemaColumn) => {
        return candidate.id === scalarSiblingId;
      },
    );

    return !(scalarSibling && isOfferableColumn(scalarSibling, use));
  });
};
