import { describe, expect, test } from "@jest/globals";
import {
  maskFailingRows,
  readFailingRows,
} from "../../../../Types/DataObservability/DataCheckFailingRows";
import {
  DataCheckType,
  MAX_FAILING_ROWS,
  MAX_FAILING_ROW_VALUE_LENGTH,
} from "../../../../Types/DataObservability/DataCheckType";
import { readFreshnessAge } from "../../../../Server/Utils/DataObservability/DataCheckResults";
import {
  buildDataCheckSampleStatement,
  buildDataCheckStatement,
  buildFreshnessStatement,
  DataCheckTarget,
} from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { validateDataCheck } from "../../../../Server/Utils/DataObservability/DataCheckValidation";
import { isBusyAtShare } from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { DatabaseEngine } from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";

/*
 * What a check can do beyond reading one number from every row: count the rows
 * a query returns, read a share of a table, name a few failing rows, wait for a
 * busy database, and say when a table's data last changed.
 */

const TABLE: DataCheckTarget = {
  type: DataCheckType.NullPercent,
  schemaName: "public",
  tableName: "orders",
  columnName: "total",
};

describe("a Failing Rows check", () => {
  test("counts what the query returns, and reads nothing else", () => {
    const statement: { sql: string; isSegmented: boolean } =
      buildDataCheckStatement("postgresql", {
        ...TABLE,
        type: DataCheckType.FailingRows,
        customSql: "SELECT id FROM orders WHERE total < 0;",
      });

    expect(statement.sql).toBe(
      "SELECT COUNT(*) AS value FROM (SELECT id FROM orders WHERE total < 0) AS oneuptime_check",
    );
    expect(statement.isSegmented).toBe(false);
  });

  test("Oracle takes no AS before a table's alias, and quotes value", () => {
    expect(
      buildDataCheckStatement("oracle", {
        ...TABLE,
        type: DataCheckType.FailingRows,
        customSql: "SELECT id FROM orders",
      }).sql,
    ).toBe(
      'SELECT COUNT(*) AS "value" FROM (SELECT id FROM orders) oneuptime_check',
    );
  });

  test("a query that writes is refused", () => {
    expect(() => {
      return buildDataCheckStatement("postgresql", {
        ...TABLE,
        type: DataCheckType.FailingRows,
        customSql: "DELETE FROM orders",
      });
    }).toThrow();
  });

  test("MongoDB counts the documents a pipeline ends in", () => {
    const statement: { sql: string } = buildDataCheckStatement("mongodb", {
      ...TABLE,
      type: DataCheckType.FailingRows,
      customSql: '[{ "$match": { "total": { "$lt": 0 } } }]',
    });
    const parsed: { pipeline: Array<unknown>; emptyValue: number } = JSON.parse(
      statement.sql,
    );

    expect(parsed.pipeline[parsed.pipeline.length - 1]).toEqual({
      $count: "value",
    });
    expect(parsed.emptyValue).toBe(0);
  });
});

describe("reading a share of a table", () => {
  const sampled: DataCheckTarget = { ...TABLE, samplePercent: 10 };

  test.each<[DatabaseEngine, string]>([
    ["postgresql", 'FROM "public"."orders" TABLESAMPLE SYSTEM (10)'],
    ["sqlserver", "FROM [public].[orders] TABLESAMPLE (10 PERCENT)"],
    ["oracle", 'FROM "public"."orders" SAMPLE (10)'],
    ["snowflake", 'FROM "public"."orders" SAMPLE BERNOULLI (10)'],
    ["bigquery", "FROM `public`.`orders` TABLESAMPLE SYSTEM (10 PERCENT)"],
    ["databricks", "FROM `public`.`orders` TABLESAMPLE (10 PERCENT)"],
    ["athena", 'FROM "public"."orders" TABLESAMPLE BERNOULLI (10)'],
    ["mysql", "WHERE RAND() < 0.1"],
    ["clickhouse", "WHERE rand() % 10000 < 1000"],
    ["redshift", "WHERE RANDOM() < 0.1"],
  ])("%s", (engine: DatabaseEngine, expected: string) => {
    expect(buildDataCheckStatement(engine, sampled).sql).toContain(expected);
  });

  test("with a segment, the share is still what is grouped", () => {
    expect(
      buildDataCheckStatement("mysql", {
        ...sampled,
        segmentColumn: "region",
      }).sql,
    ).toContain("WHERE RAND() < 0.1 GROUP BY");
  });

  test("MongoDB keeps each document by chance", () => {
    const parsed: { pipeline: Array<unknown> } = JSON.parse(
      buildDataCheckStatement("mongodb", sampled).sql,
    );

    expect(parsed.pipeline[0]).toEqual({
      $match: { $expr: { $lt: [{ $rand: {} }, 0.1] } },
    });
  });

  test("no percent, 100, or a count: every row is read", () => {
    const full: string = buildDataCheckStatement("postgresql", TABLE).sql;

    expect(full).not.toContain("TABLESAMPLE");
    expect(
      buildDataCheckStatement("postgresql", { ...TABLE, samplePercent: 100 })
        .sql,
    ).toBe(full);
    expect(
      buildDataCheckStatement("postgresql", {
        ...TABLE,
        type: DataCheckType.RowCount,
        samplePercent: 10,
      }).sql,
    ).not.toContain("TABLESAMPLE");
  });
});

describe("a sample of failing rows", () => {
  test("a query's rows are whatever it selects, capped", () => {
    expect(
      buildDataCheckSampleStatement("postgresql", {
        ...TABLE,
        type: DataCheckType.FailingRows,
        customSql: "SELECT id, total FROM orders WHERE total < 0",
      })?.sql,
    ).toBe(
      `SELECT * FROM (SELECT id, total FROM orders WHERE total < 0) AS oneuptime_check LIMIT ${MAX_FAILING_ROWS}`,
    );
  });

  test("an invalid value names its column and binds what it compares", () => {
    const statement: { sql: string; params: Array<string> } | null =
      buildDataCheckSampleStatement("postgresql", {
        ...TABLE,
        type: DataCheckType.InvalidPercent,
        columnName: "status",
        acceptedValues: ["paid", "open"],
      });

    expect(statement?.sql).toBe(
      `SELECT "status" FROM "public"."orders" WHERE "status" IS NOT NULL AND CAST("status" AS TEXT) NOT IN ($1, $2) LIMIT ${MAX_FAILING_ROWS}`,
    );
    expect(statement?.params).toEqual(["paid", "open"]);
  });

  test("each engine limits its own way", () => {
    const target: DataCheckTarget = {
      ...TABLE,
      type: DataCheckType.InvalidPercent,
      columnName: "status",
      acceptedValues: ["paid"],
    };

    expect(buildDataCheckSampleStatement("sqlserver", target)?.sql).toContain(
      `SELECT TOP ${MAX_FAILING_ROWS} [status]`,
    );
    expect(buildDataCheckSampleStatement("oracle", target)?.sql).toContain(
      `FETCH FIRST ${MAX_FAILING_ROWS} ROWS ONLY`,
    );
  });

  test("an orphan names the value with nothing to refer to", () => {
    const sql: string | undefined = buildDataCheckSampleStatement(
      "postgresql",
      {
        ...TABLE,
        type: DataCheckType.OrphanCount,
        columnName: "customer_id",
        referenceSchemaName: "public",
        referenceTableName: "customers",
        referenceColumnName: "id",
      },
    )?.sql;

    expect(sql).toContain('SELECT checked."customer_id"');
    expect(sql).toContain('referenced."id" IS NULL');
  });

  test("a check that reads a number has no rows to name, and MongoDB keeps none", () => {
    expect(buildDataCheckSampleStatement("postgresql", TABLE)).toBeNull();
    expect(
      buildDataCheckSampleStatement("mongodb", {
        ...TABLE,
        type: DataCheckType.FailingRows,
        customSql: "[]",
      }),
    ).toBeNull();
  });

  test("a sensitive column is masked, by a scan's word or by its name", () => {
    const [row] = maskFailingRows(
      [
        {
          id: 7,
          email: "a.person@example.com",
          notes: "4111 1111 1111 1111",
          at: new Date(Date.UTC(2026, 10, 4)),
          missing: null,
        },
      ],
      { notes: "credit-card-number" },
    );

    expect(row?.["id"]).toBe("7");
    expect(row?.["email"]).not.toContain("a.person");
    expect(row?.["notes"]).not.toContain("4111 1111 1111 1111");
    expect(row?.["at"]).toBe("2026-11-04T00:00:00.000Z");
    expect(row?.["missing"]).toBe("");
  });

  test("what is kept is bounded", () => {
    const rows: Array<Record<string, unknown>> = Array.from({
      length: MAX_FAILING_ROWS + 5,
    }).map(() => {
      return { note: "x".repeat(MAX_FAILING_ROW_VALUE_LENGTH + 5) };
    });
    const masked: Array<Record<string, string>> = maskFailingRows(rows);

    expect(masked).toHaveLength(MAX_FAILING_ROWS);
    expect(masked[0]?.["note"]).toHaveLength(MAX_FAILING_ROW_VALUE_LENGTH);
  });

  test("a report's rows are read strictly: only text", () => {
    expect(
      readFailingRows([
        { a: "1", b: 2, c: { d: 3 } },
        "not a row",
        ["nor", "this"],
      ]),
    ).toEqual([{ a: "1" }]);
    expect(readFailingRows("nope")).toEqual([]);
  });
});

describe("whether a check can run", () => {
  const facts: Parameters<typeof validateDataCheck>[1] = {
    engine: "postgresql",
    columns: [
      { name: "total", dataType: "numeric", isNullable: true, position: 1 },
    ],
    referenceColumns: () => {
      return null;
    },
  };

  test("only a rate can be read from a share of the rows", () => {
    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.RowCount,
          samplePercent: 10,
        },
        facts,
      );
    }).toThrow("needs every row");
  });

  test.each([0, 100, 150, -1])("%s percent is refused", (percent: number) => {
    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.NullPercent,
          columnName: "total",
          samplePercent: percent,
        },
        facts,
      );
    }).toThrow("more than 0 and less than 100");
  });

  test("a share is fine for a rate", () => {
    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.NullPercent,
          columnName: "total",
          samplePercent: 0.5,
        },
        facts,
      );
    }).not.toThrow();
  });

  test("Failing Rows needs a read, and takes no segments", () => {
    expect(() => {
      return validateDataCheck(
        { checkType: DataCheckType.FailingRows, customSql: "DROP TABLE t" },
        facts,
      );
    }).toThrow();
    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.FailingRows,
          customSql: "SELECT 1",
          segmentColumn: "total",
        },
        facts,
      );
    }).toThrow("no segments");
  });
});

describe("a table's freshness column", () => {
  const NOW: Date = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));

  test("reads its newest value", () => {
    expect(
      buildFreshnessStatement("postgresql", {
        schemaName: "public",
        tableName: "orders",
        columnName: "updated_at",
      }).sql,
    ).toBe('SELECT MAX("updated_at") AS value FROM "public"."orders"');
  });

  test("MongoDB groups for it", () => {
    const parsed: { pipeline: Array<unknown> } = JSON.parse(
      buildFreshnessStatement("mongodb", {
        schemaName: "shop",
        tableName: "orders",
        columnName: "updatedAt",
      }).sql,
    );

    expect(parsed.pipeline).toEqual([
      { $group: { _id: null, value: { $max: "$updatedAt" } } },
    ]);
  });

  test("its value is how long ago that was", () => {
    expect(readFreshnessAge(new Date(NOW.getTime() - 90_000), NOW)).toBe(90);
    expect(readFreshnessAge("2026-11-04T11:59:00.000Z", NOW)).toBe(60);
  });

  test("a time in the future is just now, and no time says nothing", () => {
    expect(readFreshnessAge(new Date(NOW.getTime() + 90_000), NOW)).toBe(0);
    expect(readFreshnessAge(null, NOW)).toBeNull();
    expect(readFreshnessAge("not a time", NOW)).toBeNull();
  });
});

describe("a busy database", () => {
  test("half of its connections at work is busy", () => {
    expect(isBusyAtShare(50, 100)).toBe(true);
    expect(isBusyAtShare("80", "100")).toBe(true);
    expect(isBusyAtShare(49, 100)).toBe(false);
  });

  test("one that cannot say is not busy", () => {
    expect(isBusyAtShare(undefined, 100)).toBe(false);
    expect(isBusyAtShare(50, 0)).toBe(false);
  });
});
