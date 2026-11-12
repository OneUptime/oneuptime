import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../DataSecurity/DataTypeCatalog";
import {
  ComposedValue,
  composedValue,
  fillTemplate,
  TemplateValues,
  translationKey,
  Translator,
} from "../Translator";
import { DataAssetColumn } from "./DataAssetColumn";
import { getFormatOfDataType, getFormatPattern } from "./DataCheckFormats";
import { DataCheckAlertCondition, DataCheckType } from "./DataCheckType";
import { DataColumnSensitivity } from "./DataColumnSensitivity";

/*
 * THE CHECKS A TABLE SHOULD PROBABLY HAVE.
 *
 * Writing checks by hand for hundreds of tables is why teams under-watch
 * their data, so a table's Checks tab offers the ones its own columns call
 * for, from their names and types alone - no row is read to suggest them:
 *
 *  - an id must be unique;
 *  - a reference (customer_id) must point at a row that exists, when the
 *    database has the table it names;
 *  - an email must look like one;
 *  - an amount, price or total must not go below zero;
 *  - a status, state or type should not suddenly take new values;
 *  - a reference that is sometimes empty should not become empty more
 *    often than usual;
 *  - a table split by tenant, organization or account should not stop
 *    receiving rows for one of them;
 *  - a column Data Security knows holds an email address, a phone number or an
 *    IP address, whatever it is called, should look like one.
 *
 * A suggestion the table already has a check for, or one dismissed, is not
 * offered again. Each has a stable id, so dismissing it sticks.
 *
 * Its name and why it is suggested are each one whole sentence of the
 * Dashboard's (#7221), with the column, table and data type it names as
 * values: the Dashboard words the sentence in the reader's language and
 * puts the names in as they are. `name` and `reason` are the same
 * sentences in English, exactly as they always read.
 */

/*
 * A suggestion's words: a sentence that is a key of the Dashboard's locale
 * files, and the names that go into it.
 */
export interface DataCheckSuggestionWords {
  template: string;
  values: TemplateValues;
}

/*
 * The sentences a suggestion is worded with, by what they are. Each is
 * worded in every language the Dashboard is read in; a column's, a table's
 * or a segment's name goes in as it is, and a data type in the reader's
 * words when it is one of Data Security's own (getDataTypeValue).
 */
export const DATA_CHECK_SUGGESTION_SENTENCES: {
  uniqueName: string;
  uniqueReason: string;
  orphansName: string;
  orphansReason: string;
  nullsName: string;
  nullsReason: string;
  volumeByName: string;
  volumeByReason: string;
  emailFormatName: string;
  emailFormatReason: string;
  notNegativeName: string;
  notNegativeReason: string;
  valuesName: string;
  valuesReason: string;
  sensitiveFormatName: string;
  sensitiveFormatReason: string;
} = {
  uniqueName: translationKey("{{column}} is unique"),
  uniqueReason: translationKey(
    "An id that repeats breaks every join and lookup on it.",
  ),
  orphansName: translationKey("Every {{column}} has a {{table}} row"),
  orphansReason: translationKey(
    "Rows whose {{column}} has no match in {{table}} are orphans: a delete that did not cascade, or a load out of order.",
  ),
  nullsName: translationKey("{{column}} is filled in as usual"),
  nullsReason: translationKey(
    "A deploy that stops setting {{column}} shows as more empty values than usual.",
  ),
  volumeByName: translationKey("Rows per {{segment}}"),
  volumeByReason: translationKey(
    "One {{segment}} that stops sending data is lost in the table's total: counted per {{column}}, it alerts on its own.",
  ),
  emailFormatName: translationKey("{{column}} looks like an email address"),
  emailFormatReason: translationKey(
    "Values that are not email addresses are bad input, or a column filled from the wrong field.",
  ),
  notNegativeName: translationKey("{{column}} is not negative"),
  notNegativeReason: translationKey(
    "A negative {{column}} is usually a sign or unit error.",
  ),
  valuesName: translationKey("{{column}} takes its usual values"),
  valuesReason: translationKey(
    "A {{column}} that suddenly has more different values than usual is a new, unexpected value being written.",
  ),
  sensitiveFormatName: translationKey("{{column}} looks like {{dataType}}"),
  sensitiveFormatReason: translationKey(
    "Data Security says this column holds {{dataType}}. Values that do not look like it are bad input, or a column filled from the wrong field.",
  ),
};

export interface DataCheckSuggestion {
  // Stable across visits: what a dismissal remembers.
  id: string;
  // The name and the reason in English: what they always were.
  name: string;
  reason: string;
  // The same two, as sentences to word in the reader's language.
  nameWords: DataCheckSuggestionWords;
  reasonWords: DataCheckSuggestionWords;
  checkType: DataCheckType;
  columnName?: string | undefined;
  segmentColumn?: string | undefined;
  pattern?: string | undefined;
  referenceTableKey?: string | undefined;
  referenceColumnName?: string | undefined;
  alertCondition: DataCheckAlertCondition;
  alertThreshold?: number | undefined;
}

// A check the table has: enough to tell whether a suggestion is already covered.
export interface ExistingDataCheck {
  checkType: DataCheckType | string;
  columnName?: string | null | undefined;
  segmentColumn?: string | null | undefined;
}

// A table of the same store, for references.
export interface SuggestionTable {
  tableKey: string;
  name: string;
  columns: Array<DataAssetColumn>;
}

export const EMAIL_PATTERN: string = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

// The most suggestions one table is offered at once.
export const MAX_SUGGESTIONS_PER_TABLE: number = 12;

const NUMERIC_TYPE: RegExp =
  /int|numeric|decimal|real|double|float|money|number/i;
const TEXT_TYPE: RegExp = /char|text|string|varchar|citext/i;
const MONEY_NAME: RegExp =
  /(^|_)(amount|price|total|cost|balance|fee|subtotal)(_|$)/i;
const CATEGORY_NAME: RegExp = /(^|_)(status|state|type|kind|category|stage)$/i;
const EMAIL_NAME: RegExp = /(^|_)e?mail(_address)?$/i;
const TENANT_NAME: RegExp =
  /^(tenant|org|organization|organisation|account|workspace|team|customer)_id$/i;

// A suggestion's name and reason: each sentence with its names, and its English.
function worded(data: {
  name: string;
  reason: string;
  values: TemplateValues;
}): {
  name: string;
  reason: string;
  nameWords: DataCheckSuggestionWords;
  reasonWords: DataCheckSuggestionWords;
} {
  return {
    name: fillTemplate(data.name, data.values),
    reason: fillTemplate(data.reason, data.values),
    nameWords: { template: data.name, values: data.values },
    reasonWords: { template: data.reason, values: data.values },
  };
}

/*
 * A data type in a sentence: one of Data Security's own (Email address,
 * Phone number, IP address) in the reader's words, by its catalog name;
 * otherwise, and in English, as Data Security named it.
 */
function getDataTypeValue(sensitive: DataColumnSensitivity): ComposedValue {
  return composedValue((translator: Translator): string => {
    const builtIn: DataTypeInfo | undefined = getBuiltInDataType(
      sensitive.dataTypeId,
    );

    return builtIn && translator.hasTranslation(builtIn.name)
      ? translator.translateTerm(builtIn.name, { inSentence: true })
      : sensitive.dataTypeName;
  });
}

function isNumeric(column: DataAssetColumn): boolean {
  return NUMERIC_TYPE.test(column.dataType);
}

function isText(column: DataAssetColumn): boolean {
  return TEXT_TYPE.test(column.dataType);
}

function isCovered(
  existing: ReadonlyArray<ExistingDataCheck>,
  suggestion: DataCheckSuggestion,
): boolean {
  return existing.some((check: ExistingDataCheck) => {
    return (
      check.checkType === suggestion.checkType &&
      (check.columnName || undefined) === suggestion.columnName &&
      (check.segmentColumn || undefined) === suggestion.segmentColumn
    );
  });
}

// "customer_id" -> the table it most likely refers to, by name: customers, customer.
function findReferencedTable(
  column: string,
  tables: ReadonlyArray<SuggestionTable>,
): SuggestionTable | undefined {
  const stem: string = column.toLowerCase().replace(/_id$/, "");

  if (!stem || stem === column.toLowerCase()) {
    return undefined;
  }

  const candidates: Array<string> = [
    `${stem}s`,
    stem,
    `${stem}es`,
    stem.endsWith("y") ? `${stem.slice(0, -1)}ies` : "",
  ].filter(Boolean);

  return tables.find((table: SuggestionTable) => {
    return (
      candidates.includes(table.name.toLowerCase()) &&
      table.columns.some((candidate: DataAssetColumn) => {
        return candidate.name.toLowerCase() === "id";
      })
    );
  });
}

export function suggestDataChecks(data: {
  tableName: string;
  columns: ReadonlyArray<DataAssetColumn>;
  otherTables: ReadonlyArray<SuggestionTable>;
  existing: ReadonlyArray<ExistingDataCheck>;
  dismissedIds: ReadonlyArray<string>;
  // What Data Security knows the columns hold.
  sensitiveColumns?: ReadonlyArray<DataColumnSensitivity> | undefined;
}): Array<DataCheckSuggestion> {
  const suggestions: Array<DataCheckSuggestion> = [];

  for (const column of data.columns) {
    const name: string = column.name;
    const lower: string = name.toLowerCase();

    if (lower === "id") {
      suggestions.push({
        id: `unique:${name}`,
        ...worded({
          name: DATA_CHECK_SUGGESTION_SENTENCES.uniqueName,
          reason: DATA_CHECK_SUGGESTION_SENTENCES.uniqueReason,
          values: { column: name },
        }),
        checkType: DataCheckType.DuplicatePercent,
        columnName: name,
        alertCondition: DataCheckAlertCondition.Above,
        alertThreshold: 0,
      });
      continue;
    }

    if (lower.endsWith("_id")) {
      const referenced: SuggestionTable | undefined = findReferencedTable(
        name,
        data.otherTables,
      );

      if (referenced) {
        suggestions.push({
          id: `orphans:${name}:${referenced.tableKey}`,
          name: fillTemplate(DATA_CHECK_SUGGESTION_SENTENCES.orphansName, {
            column: name,
            table: referenced.name,
          }),
          reason: fillTemplate(DATA_CHECK_SUGGESTION_SENTENCES.orphansReason, {
            column: name,
            table: referenced.tableKey,
          }),
          // Its name says the table's name; why, the table as a query writes it.
          nameWords: {
            template: DATA_CHECK_SUGGESTION_SENTENCES.orphansName,
            values: { column: name, table: referenced.name },
          },
          reasonWords: {
            template: DATA_CHECK_SUGGESTION_SENTENCES.orphansReason,
            values: { column: name, table: referenced.tableKey },
          },
          checkType: DataCheckType.OrphanCount,
          columnName: name,
          referenceTableKey: referenced.tableKey,
          referenceColumnName:
            referenced.columns.find((candidate: DataAssetColumn) => {
              return candidate.name.toLowerCase() === "id";
            })?.name || "id",
          alertCondition: DataCheckAlertCondition.Above,
          alertThreshold: 0,
        });
      }

      if (column.isNullable) {
        suggestions.push({
          id: `nulls:${name}`,
          ...worded({
            name: DATA_CHECK_SUGGESTION_SENTENCES.nullsName,
            reason: DATA_CHECK_SUGGESTION_SENTENCES.nullsReason,
            values: { column: name },
          }),
          checkType: DataCheckType.NullPercent,
          columnName: name,
          alertCondition: DataCheckAlertCondition.UnusuallyHigh,
        });
      }
    }

    if (TENANT_NAME.test(lower)) {
      suggestions.push({
        id: `volume-by:${name}`,
        ...worded({
          name: DATA_CHECK_SUGGESTION_SENTENCES.volumeByName,
          reason: DATA_CHECK_SUGGESTION_SENTENCES.volumeByReason,
          // "tenant_id" counts per tenant: the segment is the name without its _id.
          values: { segment: name.replace(/_id$/i, ""), column: name },
        }),
        checkType: DataCheckType.RowCount,
        segmentColumn: name,
        alertCondition: DataCheckAlertCondition.UnusuallyLow,
      });
    }

    if (EMAIL_NAME.test(lower) && isText(column)) {
      suggestions.push({
        id: `email-format:${name}`,
        ...worded({
          name: DATA_CHECK_SUGGESTION_SENTENCES.emailFormatName,
          reason: DATA_CHECK_SUGGESTION_SENTENCES.emailFormatReason,
          values: { column: name },
        }),
        checkType: DataCheckType.FormatMismatchPercent,
        columnName: name,
        pattern: EMAIL_PATTERN,
        alertCondition: DataCheckAlertCondition.Above,
        alertThreshold: 1,
      });
    }

    if (MONEY_NAME.test(lower) && isNumeric(column)) {
      suggestions.push({
        id: `not-negative:${name}`,
        ...worded({
          name: DATA_CHECK_SUGGESTION_SENTENCES.notNegativeName,
          reason: DATA_CHECK_SUGGESTION_SENTENCES.notNegativeReason,
          values: { column: name },
        }),
        checkType: DataCheckType.Minimum,
        columnName: name,
        alertCondition: DataCheckAlertCondition.Below,
        alertThreshold: 0,
      });
    }

    if (CATEGORY_NAME.test(lower)) {
      suggestions.push({
        id: `values:${name}`,
        ...worded({
          name: DATA_CHECK_SUGGESTION_SENTENCES.valuesName,
          reason: DATA_CHECK_SUGGESTION_SENTENCES.valuesReason,
          values: { column: name },
        }),
        checkType: DataCheckType.DistinctCount,
        columnName: name,
        alertCondition: DataCheckAlertCondition.UnusuallyHigh,
      });
    }
  }

  for (const sensitive of data.sensitiveColumns || []) {
    const column: DataAssetColumn | undefined = data.columns.find(
      (candidate: DataAssetColumn) => {
        return candidate.name === sensitive.column;
      },
    );
    const format: string | null = getFormatOfDataType(sensitive.dataTypeId);
    const pattern: string | null = getFormatPattern(format);

    if (
      !column ||
      !pattern ||
      !isText(column) ||
      suggestions.some((suggestion: DataCheckSuggestion) => {
        return (
          suggestion.checkType === DataCheckType.FormatMismatchPercent &&
          suggestion.columnName === column.name
        );
      })
    ) {
      continue;
    }

    suggestions.push({
      id: `sensitive-format:${column.name}`,
      ...worded({
        name: DATA_CHECK_SUGGESTION_SENTENCES.sensitiveFormatName,
        reason: DATA_CHECK_SUGGESTION_SENTENCES.sensitiveFormatReason,
        values: { column: column.name, dataType: getDataTypeValue(sensitive) },
      }),
      checkType: DataCheckType.FormatMismatchPercent,
      columnName: column.name,
      pattern,
      alertCondition: DataCheckAlertCondition.Above,
      alertThreshold: 1,
    });
  }

  return suggestions
    .filter((suggestion: DataCheckSuggestion) => {
      return (
        !data.dismissedIds.includes(suggestion.id) &&
        !isCovered(data.existing, suggestion)
      );
    })
    .slice(0, MAX_SUGGESTIONS_PER_TABLE);
}
