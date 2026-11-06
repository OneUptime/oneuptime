import { describe, expect, test } from "@jest/globals";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import {
  buildDataCheckStatement,
  checkCustomSql,
  DataCheckStatement,
  quoteIdentifier,
} from "../../../../Server/Utils/DataObservability/DataCheckSql";

/*
 * A check runs one statement against a customer's database. Names are
 * quoted, values are bound, and only aggregates come back: each rule is
 * pinned here for every engine.
 */

describe("quoteIdentifier", () => {
  test("quotes each engine's way, doubling the quote inside a name", () => {
    expect(quoteIdentifier("postgresql", 'we"ird')).toBe('"we""ird"');
    expect(quoteIdentifier("mysql", "we`ird")).toBe("`we``ird`");
    expect(quoteIdentifier("sqlserver", "we]ird")).toBe("[we]]ird]");
  });

  test("refuses an empty name, a NUL, or a name no catalog holds", () => {
    expect(() => {
      return quoteIdentifier("postgresql", "");
    }).toThrow();
    expect(() => {
      return quoteIdentifier("postgresql", "a\u0000b");
    }).toThrow();
    expect(() => {
      return quoteIdentifier("postgresql", "x".repeat(300));
    }).toThrow();
  });
});

describe("buildDataCheckStatement", () => {
  test("a null percent on one column, unsegmented", () => {
    const statement: DataCheckStatement = buildDataCheckStatement(
      "postgresql",
      {
        type: DataCheckType.NullPercent,
        schemaName: "public",
        tableName: "orders",
        columnName: "customer_id",
      },
    );

    expect(statement).toEqual({
      sql: 'SELECT 100.0 * SUM(CASE WHEN "customer_id" IS NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS value FROM "public"."orders"',
      params: [],
      isSegmented: false,
    });
  });

  test("a segmented row count reads the largest segments, each engine's way", () => {
    const target: Parameters<typeof buildDataCheckStatement>[1] = {
      type: DataCheckType.RowCount,
      schemaName: "public",
      tableName: "events",
      segmentColumn: "tenant_id",
    };

    expect(buildDataCheckStatement("postgresql", target).sql).toBe(
      'SELECT CAST("tenant_id" AS TEXT) AS segment, COUNT(*) AS value FROM "public"."events" GROUP BY "tenant_id" ORDER BY COUNT(*) DESC LIMIT 100',
    );
    expect(buildDataCheckStatement("mysql", target).sql).toBe(
      "SELECT CAST(`tenant_id` AS CHAR) AS segment, COUNT(*) AS value FROM `public`.`events` GROUP BY `tenant_id` ORDER BY COUNT(*) DESC LIMIT 100",
    );
    expect(buildDataCheckStatement("sqlserver", target).sql).toBe(
      "SELECT TOP 100 CAST([tenant_id] AS NVARCHAR(4000)) AS segment, COUNT(*) AS value FROM [public].[events] GROUP BY [tenant_id] ORDER BY COUNT(*) DESC",
    );
    expect(buildDataCheckStatement("postgresql", target).isSegmented).toBe(
      true,
    );
  });

  test("accepted values are bound parameters, never SQL", () => {
    const statement: DataCheckStatement = buildDataCheckStatement(
      "postgresql",
      {
        type: DataCheckType.InvalidPercent,
        schemaName: "public",
        tableName: "orders",
        columnName: "status",
        acceptedValues: ["paid", "x'); DROP TABLE orders; --"],
      },
    );

    expect(statement.sql).toContain("NOT IN ($1, $2)");
    expect(statement.sql).not.toContain("DROP");
    expect(statement.params).toEqual(["paid", "x'); DROP TABLE orders; --"]);
    expect(
      buildDataCheckStatement("mysql", {
        type: DataCheckType.InvalidPercent,
        schemaName: "",
        tableName: "orders",
        columnName: "status",
        acceptedValues: ["a", "b"],
      }).sql,
    ).toContain("NOT IN (?, ?)");
    expect(
      buildDataCheckStatement("sqlserver", {
        type: DataCheckType.InvalidPercent,
        schemaName: "dbo",
        tableName: "orders",
        columnName: "status",
        acceptedValues: ["a"],
      }).sql,
    ).toContain("NOT IN (@p0)");
  });

  test("a pattern is a parameter too, and SQL Server, with no regular expressions, is refused", () => {
    expect(
      buildDataCheckStatement("postgresql", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "public",
        tableName: "users",
        columnName: "email",
        pattern: "^[^@]+@[^@]+$",
      }),
    ).toMatchObject({ params: ["^[^@]+@[^@]+$"] });
    expect(
      buildDataCheckStatement("mysql", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "",
        tableName: "users",
        columnName: "email",
        pattern: "@",
      }).sql,
    ).toContain("NOT REGEXP ?");
    expect(() => {
      return buildDataCheckStatement("sqlserver", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "dbo",
        tableName: "users",
        columnName: "email",
        pattern: "@",
      });
    }).toThrow();
  });

  test("orphans are counted with a join to the referenced table", () => {
    expect(
      buildDataCheckStatement("postgresql", {
        type: DataCheckType.OrphanCount,
        schemaName: "public",
        tableName: "orders",
        columnName: "customer_id",
        referenceSchemaName: "public",
        referenceTableName: "customers",
        referenceColumnName: "id",
      }).sql,
    ).toBe(
      'SELECT COUNT(*) AS value FROM "public"."orders" AS checked LEFT JOIN "public"."customers" AS referenced ON checked."customer_id" = referenced."id" WHERE checked."customer_id" IS NOT NULL AND referenced."id" IS NULL',
    );
  });

  test("custom SQL is wrapped so only its rows are read, at most 100", () => {
    expect(
      buildDataCheckStatement("postgresql", {
        type: DataCheckType.CustomSql,
        schemaName: "public",
        tableName: "orders",
        customSql: "SELECT COUNT(*) FROM orders WHERE total < 0;",
      }).sql,
    ).toBe(
      "SELECT * FROM (SELECT COUNT(*) FROM orders WHERE total < 0) AS oneuptime_check LIMIT 100",
    );
  });

  test("a column check with no column, or with what it needs missing, is refused", () => {
    expect(() => {
      return buildDataCheckStatement("postgresql", {
        type: DataCheckType.NullPercent,
        schemaName: "public",
        tableName: "orders",
      });
    }).toThrow();
    expect(() => {
      return buildDataCheckStatement("postgresql", {
        type: DataCheckType.InvalidPercent,
        schemaName: "public",
        tableName: "orders",
        columnName: "status",
        acceptedValues: [],
      });
    }).toThrow();
    expect(() => {
      return buildDataCheckStatement("postgresql", {
        type: DataCheckType.OrphanCount,
        schemaName: "public",
        tableName: "orders",
        columnName: "customer_id",
      });
    }).toThrow();
  });
});

describe("checkCustomSql", () => {
  test("one SELECT or WITH, a trailing semicolon allowed", () => {
    expect(checkCustomSql(" SELECT 1; ")).toBe("SELECT 1");
    expect(checkCustomSql("with t as (select 1) select * from t")).toBe(
      "with t as (select 1) select * from t",
    );
    // A semicolon inside a string is the string's.
    expect(checkCustomSql("SELECT COUNT(*) FROM t WHERE note = 'a;b'")).toBe(
      "SELECT COUNT(*) FROM t WHERE note = 'a;b'",
    );
  });

  test("a second statement, a write, or something that is not a read is refused", () => {
    for (const sql of [
      "",
      "SELECT 1; DROP TABLE orders",
      "DELETE FROM orders",
      "UPDATE orders SET total = 0",
      "SELECT * INTO copy FROM orders",
      "WITH d AS (DELETE FROM orders RETURNING *) SELECT COUNT(*) FROM d",
      "EXEC sp_who",
      "x".repeat(20_000),
    ]) {
      expect(() => {
        return checkCustomSql(sql);
      }).toThrow();
    }
  });
});
