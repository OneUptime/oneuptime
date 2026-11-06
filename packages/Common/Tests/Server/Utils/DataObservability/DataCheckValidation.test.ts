import { describe, expect, test } from "@jest/globals";
import { DataAssetColumn } from "../../../../Types/DataObservability/DataAssetColumn";
import {
  DataCheckAlertCondition,
  DataCheckType,
} from "../../../../Types/DataObservability/DataCheckType";
import {
  DataCheckTableFacts,
  validateDataCheck,
} from "../../../../Server/Utils/DataObservability/DataCheckValidation";

/*
 * A check names only what the table's catalog holds - that is what keeps a
 * name in a check data, never SQL - and has what its kind needs before it
 * is saved, so a check never fails for a reason that was known up front.
 */

const COLUMNS: Array<DataAssetColumn> = [
  { name: "id", dataType: "bigint", isNullable: false, position: 1 },
  { name: "customer_id", dataType: "bigint", isNullable: true, position: 2 },
  { name: "status", dataType: "text", isNullable: true, position: 3 },
  { name: "tenant_id", dataType: "text", isNullable: true, position: 4 },
];

function facts(engine: string = "postgresql"): DataCheckTableFacts {
  return {
    engine,
    columns: COLUMNS,
    referenceColumns: (tableKey: string) => {
      return tableKey === "public.customers"
        ? [{ name: "id", dataType: "bigint", isNullable: false, position: 1 }]
        : null;
    },
  };
}

function refuses(
  draft: Parameters<typeof validateDataCheck>[0],
  engine?: string,
): void {
  expect(() => {
    validateDataCheck(draft, facts(engine));
  }).toThrow();
}

describe("validateDataCheck", () => {
  test("a column check on a column the table has, segmented by another", () => {
    expect(() => {
      validateDataCheck(
        {
          checkType: DataCheckType.NullPercent,
          columnName: "customer_id",
          segmentColumn: "tenant_id",
          intervalInMinutes: 60,
        },
        facts(),
      );
    }).not.toThrow();
  });

  test("no kind, no column, or a column the table does not have", () => {
    refuses({});
    refuses({ checkType: DataCheckType.NullPercent });
    refuses({ checkType: DataCheckType.NullPercent, columnName: "missing" });
    refuses({
      checkType: DataCheckType.RowCount,
      segmentColumn: "missing",
    });
  });

  test("what each kind needs: accepted values, a valid pattern, a referenced column", () => {
    refuses({
      checkType: DataCheckType.InvalidPercent,
      columnName: "status",
      acceptedValues: [],
    });
    refuses({
      checkType: DataCheckType.FormatMismatchPercent,
      columnName: "status",
      pattern: "([unclosed",
    });
    refuses(
      {
        checkType: DataCheckType.FormatMismatchPercent,
        columnName: "status",
        pattern: "^a",
      },
      "sqlserver",
    );
    refuses({
      checkType: DataCheckType.OrphanCount,
      columnName: "customer_id",
      referenceTableKey: "public.missing",
      referenceColumnName: "id",
    });
    refuses({
      checkType: DataCheckType.OrphanCount,
      columnName: "customer_id",
      referenceTableKey: "public.customers",
      referenceColumnName: "missing",
    });
    expect(() => {
      validateDataCheck(
        {
          checkType: DataCheckType.OrphanCount,
          columnName: "customer_id",
          referenceTableKey: "public.customers",
          referenceColumnName: "id",
        },
        facts(),
      );
    }).not.toThrow();
  });

  test("custom SQL must be one read", () => {
    refuses({ checkType: DataCheckType.CustomSql, customSql: "DELETE FROM t" });
    expect(() => {
      validateDataCheck(
        { checkType: DataCheckType.CustomSql, customSql: "SELECT 1" },
        facts(),
      );
    }).not.toThrow();
  });

  test("an interval outside the offered ones, or a threshold condition with no threshold", () => {
    refuses({ checkType: DataCheckType.RowCount, intervalInMinutes: 7 });
    refuses({
      checkType: DataCheckType.RowCount,
      alertCondition: DataCheckAlertCondition.Above,
    });
    expect(() => {
      validateDataCheck(
        {
          checkType: DataCheckType.RowCount,
          alertCondition: DataCheckAlertCondition.UnusuallyLow,
        },
        facts(),
      );
    }).not.toThrow();
    expect(() => {
      validateDataCheck(
        {
          checkType: DataCheckType.RowCount,
          alertCondition: DataCheckAlertCondition.Below,
          alertThreshold: 100,
        },
        facts(),
      );
    }).not.toThrow();
  });
});
