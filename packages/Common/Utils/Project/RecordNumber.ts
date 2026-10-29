import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Dictionary from "../../Types/Dictionary";
import NumberPrefixUtil from "./NumberPrefix";

/*
 * THE NUMBER A RECORD IS KNOWN BY.
 *
 * Incidents, alerts, scheduled maintenance events, both kinds of episode and
 * security cases are numbered in their project: INC-18, ALT-7, SM-3, IE-2,
 * AE-4, SC-12 - or #18 in a project without a prefix (NumberPrefix). Their
 * titles are not unique: two incidents declared by hand can both read
 * "Manually declared", and a monitor that fails again opens one more
 * "Checkout API p95 latency above 2s". The number is what tells them apart,
 * so wherever the product names one of them to someone moving between them -
 * the record's page heading, its breadcrumb, the browser tab, a dialog about
 * it, a search result - the number comes first: "INC-18 Manually declared".
 *
 * Each record keeps the number it was given, with the prefix it was given:
 * an incident numbered before the project changed its prefix is still known
 * by its old one, as everywhere else. A record from before numbers carried
 * their prefix has only the bare number, shown "#18"; one with no number at
 * all is named by its title alone, as before.
 *
 * React-free, so the server, the Dashboard and the tests share one rule.
 */

// The suffix that names the column holding a record's number with its prefix.
export const NUMBER_WITH_PREFIX_SUFFIX: string = "WithPrefix";

const NUMERIC_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.Number,
  TableColumnType.SmallNumber,
  TableColumnType.BigNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.BigPositiveNumber,
];

const TEXT_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
];

export interface RecordNumberColumns {
  // The record's number: incidentNumber.
  numberColumn: string;
  // The number with the prefix it was given: incidentNumberWithPrefix.
  numberWithPrefixColumn: string;
}

type GetRecordNumberColumnsFunction = (
  model: unknown,
) => RecordNumberColumns | null;

/**
 * The columns that hold a record's number, or null for a model whose records
 * have none: a numeric column with a "<column>WithPrefix" text column beside
 * it. Generic, so a model numbered later is named by its number without
 * anything here changing. Anything that is not a database model - an
 * analytics model, a plain object - numbers nothing.
 */
export const getRecordNumberColumns: GetRecordNumberColumnsFunction = (
  model: unknown,
): RecordNumberColumns | null => {
  if (!model || typeof model !== "object") {
    return null;
  }

  /*
   * A list names each of its rows by this (getRecordDisplayName), so the
   * answer is kept per class: a model's columns never change.
   */
  const constructorOfModel: unknown = (model as { constructor?: unknown })
    .constructor;
  const modelClass: ModelClass | null =
    typeof constructorOfModel === "function"
      ? (constructorOfModel as ModelClass)
      : null;

  if (modelClass && numberColumnsByClass.has(modelClass)) {
    return numberColumnsByClass.get(modelClass) || null;
  }

  const found: RecordNumberColumns | null = findRecordNumberColumns(model);

  if (found) {
    // Shared by every caller from now on: nobody may change it.
    Object.freeze(found);
  }

  if (modelClass) {
    numberColumnsByClass.set(modelClass, found);
  }

  return found;
};

// A model's class, which the answer is kept by.
type ModelClass = new () => unknown;

const numberColumnsByClass: WeakMap<ModelClass, RecordNumberColumns | null> =
  new WeakMap<ModelClass, RecordNumberColumns | null>();

function findRecordNumberColumns(model: unknown): RecordNumberColumns | null {
  let columns: Dictionary<TableColumnMetadata> = {};

  try {
    columns = getTableColumns(model as BaseModel);
  } catch {
    // Not a database model: nothing that numbers its records.
    return null;
  }

  for (const columnId of Object.keys(columns)) {
    const column: TableColumnMetadata | undefined = columns[columnId];

    if (!column || !NUMERIC_COLUMN_TYPES.includes(column.type)) {
      continue;
    }

    const withPrefixId: string = `${columnId}${NUMBER_WITH_PREFIX_SUFFIX}`;
    const withPrefix: TableColumnMetadata | undefined = columns[withPrefixId];

    if (withPrefix && TEXT_COLUMN_TYPES.includes(withPrefix.type)) {
      return {
        numberColumn: columnId,
        numberWithPrefixColumn: withPrefixId,
      };
    }
  }

  return null;
}

type FormatRecordNumberFunction = (data: {
  number: unknown;
  numberWithPrefix: unknown;
}) => string | undefined;

/**
 * A record's number as it is shown: "INC-18" as stored, else "#18" for a
 * record that has only the bare number, else nothing.
 */
export const formatRecordNumber: FormatRecordNumberFunction = (data: {
  number: unknown;
  numberWithPrefix: unknown;
}): string | undefined => {
  if (
    typeof data.numberWithPrefix === "string" &&
    data.numberWithPrefix.trim() !== ""
  ) {
    return data.numberWithPrefix.trim();
  }

  if (typeof data.number === "number" && Number.isFinite(data.number)) {
    return NumberPrefixUtil.formatNumber(null, data.number);
  }

  return undefined;
};

type GetRecordNumberFunction = (
  record: unknown,
  columns: RecordNumberColumns | null | undefined,
) => string | undefined;

/**
 * The number of one record, read from the columns its model numbers its
 * records by - "INC-18" - or nothing when the record does not carry it (a
 * list that did not select it, a model without numbers).
 */
export const getRecordNumber: GetRecordNumberFunction = (
  record: unknown,
  columns: RecordNumberColumns | null | undefined,
): string | undefined => {
  if (!columns || !record || typeof record !== "object") {
    return undefined;
  }

  const fields: Dictionary<unknown> = record as Dictionary<unknown>;

  return formatRecordNumber({
    number: fields[columns.numberColumn],
    numberWithPrefix: fields[columns.numberWithPrefixColumn],
  });
};

type GetNumberedRecordNameFunction = (data: {
  number: string | null | undefined;
  name: string | null | undefined;
}) => string;

/**
 * One record named by its number and its name, in one line of text: "INC-18
 * Manually declared". Either alone when the other is missing, "" when both
 * are. For text that has no markup to keep the two apart (a browser tab, a
 * search result, a sentence); a page draws them as two pieces
 * (Page's recordHeading, Breadcrumbs).
 */
export const getNumberedRecordName: GetNumberedRecordNameFunction = (data: {
  number: string | null | undefined;
  name: string | null | undefined;
}): string => {
  const number: string = (data.number || "").trim();
  const name: string = (data.name || "").trim();

  if (number && name) {
    return `${number} ${name}`;
  }

  return number || name;
};
