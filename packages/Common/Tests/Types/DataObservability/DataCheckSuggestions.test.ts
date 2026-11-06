import { describe, expect, test } from "@jest/globals";
import { DataAssetColumn } from "../../../Types/DataObservability/DataAssetColumn";
import {
  DataCheckFormat,
  getFormatPattern,
} from "../../../Types/DataObservability/DataCheckFormats";
import { DataColumnSensitivity } from "../../../Types/DataObservability/DataColumnSensitivity";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataCheckAlertCondition,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DataCheckSuggestion,
  EMAIL_PATTERN,
  MAX_SUGGESTIONS_PER_TABLE,
  suggestDataChecks,
  SuggestionTable,
} from "../../../Types/DataObservability/DataCheckSuggestions";

/*
 * A table with no checks is offered the ones its columns call for - from
 * names and types alone, never a row - and only those it does not have and
 * nobody dismissed.
 */

function column(
  name: string,
  dataType: string,
  isNullable: boolean = true,
): DataAssetColumn {
  return { name, dataType, isNullable, position: 1 };
}

const ORDERS: Array<DataAssetColumn> = [
  column("id", "bigint", false),
  column("customer_id", "bigint"),
  column("tenant_id", "text", false),
  column("contact_email", "varchar"),
  column("total", "numeric", false),
  column("status", "text", false),
  column("created_at", "timestamptz", false),
];

const CUSTOMERS: SuggestionTable = {
  tableKey: "public.customers",
  name: "customers",
  columns: [column("id", "bigint", false), column("name", "text")],
};

function suggest(
  overrides: Partial<Parameters<typeof suggestDataChecks>[0]> = {},
): Array<DataCheckSuggestion> {
  return suggestDataChecks({
    tableName: "orders",
    columns: ORDERS,
    otherTables: [CUSTOMERS],
    existing: [],
    dismissedIds: [],
    ...overrides,
  });
}

function byId(
  suggestions: Array<DataCheckSuggestion>,
  id: string,
): DataCheckSuggestion | undefined {
  return suggestions.find((suggestion: DataCheckSuggestion) => {
    return suggestion.id === id;
  });
}

describe("suggestDataChecks", () => {
  test("an id must be unique", () => {
    expect(byId(suggest(), "unique:id")).toMatchObject({
      checkType: DataCheckType.DuplicatePercent,
      columnName: "id",
      alertCondition: DataCheckAlertCondition.Above,
      alertThreshold: 0,
    });
  });

  test("a reference must have a row in the table it names, when the database has it", () => {
    expect(
      byId(suggest(), "orphans:customer_id:public.customers"),
    ).toMatchObject({
      checkType: DataCheckType.OrphanCount,
      columnName: "customer_id",
      referenceTableKey: "public.customers",
      referenceColumnName: "id",
    });
    expect(
      suggest({ otherTables: [] }).some((suggestion: DataCheckSuggestion) => {
        return suggestion.checkType === DataCheckType.OrphanCount;
      }),
    ).toBe(false);
  });

  test("a nullable reference should not go empty more than usual; a required one needs no check", () => {
    expect(byId(suggest(), "nulls:customer_id")).toMatchObject({
      checkType: DataCheckType.NullPercent,
      alertCondition: DataCheckAlertCondition.UnusuallyHigh,
    });
    expect(byId(suggest(), "nulls:tenant_id")).toBeUndefined();
  });

  test("a table split by tenant is counted per tenant, alerting when one goes quiet", () => {
    expect(byId(suggest(), "volume-by:tenant_id")).toMatchObject({
      checkType: DataCheckType.RowCount,
      segmentColumn: "tenant_id",
      alertCondition: DataCheckAlertCondition.UnusuallyLow,
    });
  });

  test("an email looks like one, an amount is not negative, a status keeps its values", () => {
    expect(byId(suggest(), "email-format:contact_email")).toMatchObject({
      checkType: DataCheckType.FormatMismatchPercent,
      pattern: EMAIL_PATTERN,
    });
    expect(byId(suggest(), "not-negative:total")).toMatchObject({
      checkType: DataCheckType.Minimum,
      alertCondition: DataCheckAlertCondition.Below,
      alertThreshold: 0,
    });
    expect(byId(suggest(), "values:status")).toMatchObject({
      checkType: DataCheckType.DistinctCount,
      alertCondition: DataCheckAlertCondition.UnusuallyHigh,
    });
  });

  test("a check the table has, or a dismissed suggestion, is not offered again", () => {
    const suggestions: Array<DataCheckSuggestion> = suggest({
      existing: [
        { checkType: DataCheckType.DuplicatePercent, columnName: "id" },
      ],
      dismissedIds: ["values:status"],
    });

    expect(byId(suggestions, "unique:id")).toBeUndefined();
    expect(byId(suggestions, "values:status")).toBeUndefined();
    expect(byId(suggestions, "not-negative:total")).toBeDefined();
  });

  test("ids are unique and stable, and a wide table is offered a bounded few", () => {
    const ids: Array<string> = suggest().map(
      (suggestion: DataCheckSuggestion) => {
        return suggestion.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      suggest().map((suggestion: DataCheckSuggestion) => {
        return suggestion.id;
      }),
    ).toEqual(ids);

    const wide: Array<DataAssetColumn> = [];

    for (let index: number = 0; index < 40; index++) {
      wide.push(column(`thing_${index}_status`, "text"));
    }

    expect(suggest({ columns: wide }).length).toBe(MAX_SUGGESTIONS_PER_TABLE);
  });

  test("a column whose name only looks right, with the wrong type, is left alone", () => {
    expect(
      suggest({
        columns: [column("email", "integer"), column("total", "text")],
      }),
    ).toEqual([]);
  });
});

describe("a column Data Security knows about", () => {
  const COLUMNS: Array<DataAssetColumn> = [
    column("contact", "varchar"),
    column("login_ip", "text"),
    column("name", "text"),
    column("email", "varchar"),
    column("counter", "bigint"),
  ];

  function suggest(
    sensitiveColumns: Array<DataColumnSensitivity>,
  ): Array<DataCheckSuggestion> {
    return suggestDataChecks({
      tableName: "people",
      columns: COLUMNS,
      otherTables: [],
      existing: [],
      dismissedIds: [],
      sensitiveColumns,
    });
  }

  function sensitive(
    columnName: string,
    dataTypeId: string,
    dataTypeName: string,
  ): DataColumnSensitivity {
    return {
      column: columnName,
      dataTypeId,
      dataTypeName,
      sensitivity: DataSensitivity.Confidential,
      isFromName: false,
    };
  }

  test("is held to the format of what it holds, whatever it is called", () => {
    const found: Array<DataCheckSuggestion> = suggest([
      sensitive("contact", "email-address", "Email address"),
      sensitive("login_ip", "ip-address", "IP address"),
    ]).filter((suggestion: DataCheckSuggestion) => {
      return suggestion.id.startsWith("sensitive-format:");
    });

    expect(
      found.map((suggestion: DataCheckSuggestion) => {
        return [suggestion.columnName, suggestion.pattern];
      }),
    ).toEqual([
      ["contact", getFormatPattern(DataCheckFormat.Email)],
      ["login_ip", getFormatPattern(DataCheckFormat.IpAddress)],
    ]);
  });

  test("a column already suggested by its name is not offered twice", () => {
    const found: Array<DataCheckSuggestion> = suggest([
      sensitive("email", "email-address", "Email address"),
    ]);

    expect(
      found.filter((suggestion: DataCheckSuggestion) => {
        return suggestion.columnName === "email";
      }),
    ).toHaveLength(1);
  });

  test("a type with no format, or a column that is not text, is left alone", () => {
    expect(
      suggest([
        sensitive("name", "person-name", "Person name"),
        sensitive("counter", "phone-number", "Phone number"),
        sensitive("gone", "email-address", "Email address"),
      ]).filter((suggestion: DataCheckSuggestion) => {
        return suggestion.id.startsWith("sensitive-format:");
      }),
    ).toEqual([]);
  });
});
