import {
  DATA_CHECK_INTERVALS_IN_MINUTES,
  DataCheckAlertCondition,
  DataCheckType,
  doesAlertConditionNeedThreshold,
  isColumnCheckType,
  MAX_ACCEPTED_VALUES,
} from "../../../Types/DataObservability/DataCheckType";
import { DataAssetColumn } from "../../../Types/DataObservability/DataAssetColumn";
import BadDataException from "../../../Types/Exception/BadDataException";
import { checkCustomSql } from "./DataCheckSql";
import { checkMongoPipeline } from "./MongoDbChecks";

/*
 * WHETHER A CHECK CAN RUN, BEFORE IT IS SAVED.
 *
 * Every name a check reads must be one the table's catalog holds: a column
 * of the table, a table of the same store and a column of it. That keeps a
 * check from naming anything the collection never saw - and is the reason a
 * name in a check is always data, quoted, never SQL.
 */

export interface DataCheckDraft {
  checkType?: DataCheckType | undefined;
  columnName?: string | null | undefined;
  segmentColumn?: string | null | undefined;
  acceptedValues?: Array<string> | null | undefined;
  pattern?: string | null | undefined;
  referenceTableKey?: string | null | undefined;
  referenceColumnName?: string | null | undefined;
  customSql?: string | null | undefined;
  intervalInMinutes?: number | null | undefined;
  alertCondition?: DataCheckAlertCondition | null | undefined;
  alertThreshold?: number | null | undefined;
}

export interface DataCheckTableFacts {
  engine: string;
  columns: Array<DataAssetColumn>;
  // Columns of the store's other tables, by "schema.table", for Orphan Count.
  referenceColumns: (tableKey: string) => Array<DataAssetColumn> | null;
}

function hasColumn(columns: Array<DataAssetColumn>, name: string): boolean {
  return columns.some((column: DataAssetColumn) => {
    return column.name === name;
  });
}

export function validateDataCheck(
  draft: DataCheckDraft,
  table: DataCheckTableFacts,
): void {
  const type: DataCheckType | undefined = draft.checkType;

  if (!type || !Object.values(DataCheckType).includes(type)) {
    throw new BadDataException("Choose what the check measures.");
  }

  if (isColumnCheckType(type)) {
    if (!draft.columnName) {
      throw new BadDataException(`A ${type} check needs a column.`);
    }

    if (!hasColumn(table.columns, draft.columnName)) {
      throw new BadDataException(
        `The table has no column "${draft.columnName}".`,
      );
    }
  }

  if (draft.segmentColumn && !hasColumn(table.columns, draft.segmentColumn)) {
    throw new BadDataException(
      `The table has no column "${draft.segmentColumn}" to segment by.`,
    );
  }

  if (type === DataCheckType.InvalidPercent) {
    const values: Array<string> = (draft.acceptedValues || []).filter(
      (value: unknown) => {
        return typeof value === "string";
      },
    );

    if (values.length === 0 || values.length > MAX_ACCEPTED_VALUES) {
      throw new BadDataException(
        `An Invalid Percent check needs between 1 and ${MAX_ACCEPTED_VALUES} accepted values.`,
      );
    }
  }

  if (type === DataCheckType.FormatMismatchPercent) {
    if (!draft.pattern) {
      throw new BadDataException(
        "A Format Mismatch Percent check needs a pattern.",
      );
    }

    if (table.engine === "sqlserver") {
      throw new BadDataException(
        "SQL Server has no regular expressions: use an Invalid Percent check, or Custom SQL with LIKE.",
      );
    }

    try {
      new RegExp(draft.pattern);
    } catch {
      throw new BadDataException("The pattern is not a regular expression.");
    }
  }

  if (type === DataCheckType.OrphanCount) {
    if (!draft.referenceTableKey || !draft.referenceColumnName) {
      throw new BadDataException(
        "An Orphan Count check needs the table and column it refers to.",
      );
    }

    const referenced: Array<DataAssetColumn> | null = table.referenceColumns(
      draft.referenceTableKey,
    );

    if (!referenced) {
      throw new BadDataException(
        `The database has no table "${draft.referenceTableKey}".`,
      );
    }

    if (!hasColumn(referenced, draft.referenceColumnName)) {
      throw new BadDataException(
        `"${draft.referenceTableKey}" has no column "${draft.referenceColumnName}".`,
      );
    }
  }

  if (type === DataCheckType.CustomSql) {
    if (table.engine === "mongodb") {
      checkMongoPipeline(draft.customSql || "");
    } else {
      checkCustomSql(draft.customSql || "");
    }
  }

  if (
    draft.intervalInMinutes !== undefined &&
    draft.intervalInMinutes !== null &&
    !DATA_CHECK_INTERVALS_IN_MINUTES.includes(draft.intervalInMinutes)
  ) {
    throw new BadDataException(
      `A check runs every ${DATA_CHECK_INTERVALS_IN_MINUTES.join(", ")} minutes.`,
    );
  }

  if (
    draft.alertCondition &&
    doesAlertConditionNeedThreshold(draft.alertCondition) &&
    (draft.alertThreshold === null ||
      draft.alertThreshold === undefined ||
      !Number.isFinite(Number(draft.alertThreshold)))
  ) {
    throw new BadDataException(
      `"${draft.alertCondition}" needs a threshold to compare with.`,
    );
  }
}
