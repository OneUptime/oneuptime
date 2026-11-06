import { describe, expect, test } from "@jest/globals";
import {
  DataColumnSensitivity,
  describeNewPersonalDataColumn,
  findDataTypeOfColumnName,
  findNewPersonalDataColumns,
  getFindingColumn,
  MAX_NEW_PERSONAL_DATA_COLUMNS,
  mergeNewPersonalDataColumns,
  NewPersonalDataColumn,
  readColumnSensitivities,
  readNewPersonalDataColumns,
} from "../../../Types/DataObservability/DataColumnSensitivity";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";

/*
 * What a column holds: what a scan found in it, or until one reads it, what
 * its name says. A new column whose name says it holds personal data is Data
 * Security's to judge, for two weeks from the day it appeared.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("a column's name", () => {
  test("says what it holds however it is written", () => {
    expect(findDataTypeOfColumnName("email_address")?.id).toBe("email-address");
    expect(findDataTypeOfColumnName("customerEmail")?.id).toBe("email-address");
    expect(findDataTypeOfColumnName("last_name")?.id).toBe("person-name");
  });

  test("says nothing when it is not about a person", () => {
    expect(findDataTypeOfColumnName("product_name")).toBeNull();
    expect(findDataTypeOfColumnName("created_at")).toBeNull();
    expect(findDataTypeOfColumnName("total")).toBeNull();
  });
});

describe("a finding's location", () => {
  test("names a column of this table, in any case", () => {
    expect(
      getFindingColumn({
        location: "Public.Customers.Email",
        schemaName: "public",
        tableName: "customers",
      }),
    ).toBe("email");
  });

  test("a field inside a column counts for the column", () => {
    expect(
      getFindingColumn({
        location: "public.customers.profile.email",
        schemaName: "public",
        tableName: "customers",
      }),
    ).toBe("profile");
  });

  test("a document store's location has no schema", () => {
    expect(
      getFindingColumn({
        location: "customers.contact.email",
        schemaName: "shop",
        tableName: "customers",
      }),
    ).toBe("contact");
  });

  test("another table with the same start does not count", () => {
    expect(
      getFindingColumn({
        location: "public.customers_old.email",
        schemaName: "public",
        tableName: "customers",
      }),
    ).toBeNull();
    expect(
      getFindingColumn({
        location: "other.customers.email",
        schemaName: "public",
        tableName: "customers",
      }),
    ).toBeNull();
  });
});

describe("what each column of a table holds", () => {
  const columns: Array<{ name: string }> = [
    { name: "id" },
    { name: "Email" },
    { name: "notes" },
    { name: "first_name" },
  ];

  test("a scan's answer beats the name, and the most sensitive finding wins", () => {
    const found: Array<DataColumnSensitivity> = readColumnSensitivities({
      schemaName: "public",
      tableName: "customers",
      columns,
      findings: [
        {
          location: "public.customers.notes",
          dataTypeId: "person-name",
          dataTypeName: "Person name",
          sensitivity: DataSensitivity.Confidential,
        },
        {
          location: "public.customers.notes",
          dataTypeId: "credit-card-number",
          dataTypeName: "Credit card number",
          sensitivity: DataSensitivity.Restricted,
        },
        {
          location: "public.customers.email",
          dataTypeId: "email-address",
          dataTypeName: "Email address",
          sensitivity: DataSensitivity.Confidential,
        },
      ],
    });

    expect(found).toEqual([
      {
        column: "Email",
        dataTypeId: "email-address",
        dataTypeName: "Email address",
        sensitivity: DataSensitivity.Confidential,
        isFromName: false,
      },
      {
        column: "notes",
        dataTypeId: "credit-card-number",
        dataTypeName: "Credit card number",
        sensitivity: DataSensitivity.Restricted,
        isFromName: false,
      },
      {
        column: "first_name",
        dataTypeId: "person-name",
        dataTypeName: "Person name",
        sensitivity: DataSensitivity.Confidential,
        isFromName: true,
      },
    ]);
  });

  test("a table no scan has read still answers from its names", () => {
    const found: Array<DataColumnSensitivity> = readColumnSensitivities({
      schemaName: null,
      tableName: "customers",
      columns,
      findings: [],
    });

    expect(
      found.map((item: DataColumnSensitivity) => {
        return [item.column, item.isFromName];
      }),
    ).toEqual([
      ["Email", true],
      ["first_name", true],
    ]);
  });
});

describe("a new column that holds personal data", () => {
  test("only a person's data counts", () => {
    expect(
      findNewPersonalDataColumns({
        tableKey: "public.customers",
        columnNames: ["email", "created_at", "api_key"],
        seenAt: NOW,
      }),
    ).toEqual([
      {
        column: "public.customers.email",
        dataType: "Email address",
        seenAt: NOW.toISOString(),
      },
    ]);
  });

  test("it stays for two weeks, the newest first", () => {
    const read: Array<NewPersonalDataColumn> = readNewPersonalDataColumns(
      [
        { column: "a.b.old", dataType: "Email address", seenAt: daysAgo(15) },
        { column: "a.b.day", dataType: "Email address", seenAt: daysAgo(1) },
        { column: "a.b.week", dataType: "Email address", seenAt: daysAgo(7) },
        { column: "a.b.bad" },
      ],
      NOW,
    );

    expect(
      read.map((item: NewPersonalDataColumn) => {
        return item.column;
      }),
    ).toEqual(["a.b.day", "a.b.week"]);
  });

  test("a store that never said is an empty list", () => {
    expect(readNewPersonalDataColumns(null, NOW)).toEqual([]);
    expect(readNewPersonalDataColumns("nope", NOW)).toEqual([]);
  });

  test("a column seen again keeps the day it first appeared", () => {
    const first: NewPersonalDataColumn = {
      column: "a.b.email",
      dataType: "Email address",
      seenAt: daysAgo(3),
    };
    const merged: Array<NewPersonalDataColumn> = mergeNewPersonalDataColumns({
      previous: [first],
      found: [{ ...first, seenAt: NOW.toISOString() }],
      now: NOW,
    });

    expect(merged).toEqual([first]);
  });

  test("the newest are kept when there are too many", () => {
    const merged: Array<NewPersonalDataColumn> = mergeNewPersonalDataColumns({
      previous: Array.from({ length: MAX_NEW_PERSONAL_DATA_COLUMNS }).map(
        (_: unknown, index: number): NewPersonalDataColumn => {
          return {
            column: `a.b.old${index}`,
            dataType: "Email address",
            seenAt: daysAgo(2),
          };
        },
      ),
      found: [
        {
          column: "a.b.new",
          dataType: "Email address",
          seenAt: NOW.toISOString(),
        },
      ],
      now: NOW,
    });

    expect(merged).toHaveLength(MAX_NEW_PERSONAL_DATA_COLUMNS);
    expect(merged[0]?.column).toBe("a.b.new");
  });

  test("an issue names the column and what it holds", () => {
    expect(
      describeNewPersonalDataColumn({
        column: "public.customers.email",
        dataType: "Email address",
        seenAt: NOW.toISOString(),
      }),
    ).toBe("public.customers.email (Email address)");
  });
});
