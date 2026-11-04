import { afterEach, describe, expect, jest, test } from "@jest/globals";
import oracledb from "oracledb";
import { readOracleConnection } from "../../../../Server/Utils/DataObservability/OracleConnection";
import {
  collectTableHealth,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { getCollectorEngineOfKind } from "../../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";

/*
 * Oracle is read over the oracledb driver in thin mode: its catalog views,
 * every statement in a read-only transaction rolled back after it, and
 * checks in Oracle's own SQL - no AS before a table's alias, FETCH FIRST
 * in place of LIMIT, :1 binds, and its value column named in quotes.
 */

const URL_CONNECTION: string =
  "oracle://oneuptime_reader:s3cret@orders-db.internal:1521/ORCLPDB1";

describe("readOracleConnection", () => {
  test("a URL, or JSON with an Easy Connect string", () => {
    expect(readOracleConnection(URL_CONNECTION)).toEqual({
      user: "oneuptime_reader",
      password: "s3cret",
      connectString: "orders-db.internal:1521/ORCLPDB1",
    });
    expect(
      readOracleConnection(
        JSON.stringify({
          user: "r",
          password: "p",
          connectString: "db:1522/SALES",
        }),
      ),
    ).toEqual({ user: "r", password: "p", connectString: "db:1522/SALES" });
  });

  test("what is missing is said", () => {
    expect(() => {
      return readOracleConnection("oracle://reader@db:1521/X");
    }).toThrow(/user, a password and where to connect/);
  });

  test("the target is the host, port and service, never the password", () => {
    const target: unknown = readConnectionTarget({
      engine: "oracle",
      connectionString: URL_CONNECTION,
    });

    expect(target).toEqual({
      databaseName: "ORCLPDB1",
      host: "orders-db.internal",
      port: 1521,
    });
    expect(JSON.stringify(target)).not.toContain("s3cret");
    expect(getCollectorEngineOfKind(DataStoreKind.Oracle)).toBe("oracle");
  });
});

describe("Oracle's check SQL", () => {
  test("a pattern with REGEXP_LIKE and a bound :1, the value named in quotes", () => {
    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("oracle", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "SALES",
        tableName: "USERS",
        columnName: "EMAIL",
        pattern: "@",
      });

    expect(statement.sql).toBe(
      'SELECT 100.0 * SUM(CASE WHEN "EMAIL" IS NOT NULL AND NOT REGEXP_LIKE(CAST("EMAIL" AS VARCHAR2(4000)), :1) THEN 1 ELSE 0 END) / NULLIF(COUNT("EMAIL"), 0) AS "value" FROM "SALES"."USERS"',
    );
    expect(statement.params).toEqual(["@"]);
  });

  test("no AS before a table's alias, FETCH FIRST in place of LIMIT", () => {
    expect(
      buildDataCheckStatement("oracle", {
        type: DataCheckType.OrphanCount,
        schemaName: "SALES",
        tableName: "ORDERS",
        columnName: "USER_ID",
        referenceSchemaName: "SALES",
        referenceTableName: "USERS",
        referenceColumnName: "ID",
        segmentColumn: "REGION",
      }).sql,
    ).toBe(
      'SELECT CAST(checked."REGION" AS VARCHAR2(4000)) AS "segment", COUNT(*) AS "value" FROM "SALES"."ORDERS" checked LEFT JOIN "SALES"."USERS" referenced ON checked."USER_ID" = referenced."ID" WHERE checked."USER_ID" IS NOT NULL AND referenced."ID" IS NULL GROUP BY checked."REGION" ORDER BY COUNT(*) DESC FETCH FIRST 100 ROWS ONLY',
    );
    expect(
      buildDataCheckStatement("oracle", {
        type: DataCheckType.CustomSql,
        schemaName: "SALES",
        tableName: "ORDERS",
        customSql: "SELECT COUNT(*) AS value FROM sales.orders WHERE total < 0",
      }).sql,
    ).toBe(
      "SELECT * FROM (SELECT COUNT(*) AS value FROM sales.orders WHERE total < 0) oneuptime_check FETCH FIRST 100 ROWS ONLY",
    );
  });
});

describe("collecting an Oracle database", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("tables with their DML since the last statistics, materialized views, views, columns and lineage; every read rolled back", async () => {
    const statements: Array<string> = [];
    let rollbacks: number = 0;
    let closed: boolean = false;
    const connection: Partial<oracledb.Connection> & { callTimeout: number } = {
      callTimeout: 0,
      execute: (async (sql: string): Promise<oracledb.Result<unknown>> => {
        statements.push(sql);

        if (sql.startsWith("SET TRANSACTION READ ONLY")) {
          return {} as oracledb.Result<unknown>;
        }

        if (sql.includes("FROM all_mviews")) {
          return {
            rows: [{ TABLE_SCHEMA: "SALES", TABLE_NAME: "ORDERS_MV" }],
          } as never;
        }

        if (sql.includes("FROM dba_segments")) {
          throw new Error("ORA-00942: table or view does not exist");
        }

        if (sql.includes("FROM user_segments")) {
          return {
            rows: [
              {
                TABLE_SCHEMA: "SALES",
                TABLE_NAME: "ORDERS",
                SIZE_BYTES: 65536,
              },
            ],
          } as never;
        }

        if (sql.includes("FROM all_tables")) {
          return {
            rows: [
              {
                TABLE_SCHEMA: "SALES",
                TABLE_NAME: "ORDERS",
                NUM_ROWS: 1200,
                WRITE_COUNT: 37,
                SECONDS_SINCE_CHANGE: 600,
              },
              {
                TABLE_SCHEMA: "SALES",
                TABLE_NAME: "ORDERS_MV",
                NUM_ROWS: 30,
                WRITE_COUNT: null,
                SECONDS_SINCE_CHANGE: null,
              },
            ],
          } as never;
        }

        if (sql.includes("FROM all_views")) {
          return {
            rows: [{ TABLE_SCHEMA: "SALES", TABLE_NAME: "ORDERS_V" }],
          } as never;
        }

        if (sql.includes("FROM all_tab_columns")) {
          return {
            rows: [
              {
                TABLE_SCHEMA: "SALES",
                TABLE_NAME: "ORDERS",
                COLUMN_NAME: "ID",
                DATA_TYPE: "NUMBER",
                IS_NULLABLE: "N",
                ORDINAL_POSITION: 1,
              },
            ],
          } as never;
        }

        if (sql.includes("FROM all_dependencies")) {
          return {
            rows: [
              {
                UPSTREAM_SCHEMA: "SALES",
                UPSTREAM_TABLE: "ORDERS",
                DOWNSTREAM_SCHEMA: "SALES",
                DOWNSTREAM_TABLE: "ORDERS_V",
              },
            ],
          } as never;
        }

        throw new Error(`Unexpected statement: ${sql.slice(0, 60)}`);
      }) as never,
      rollback: (async (): Promise<void> => {
        rollbacks++;
      }) as never,
      close: (async (): Promise<void> => {
        closed = true;
      }) as never,
    };
    const getConnection: jest.SpyInstance = jest
      .spyOn(oracledb, "getConnection")
      .mockResolvedValue(connection as never) as unknown as jest.SpyInstance;

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "oracle",
      connectionString: URL_CONNECTION,
    });

    expect(getConnection.mock.calls[0]![0]).toMatchObject({
      user: "oneuptime_reader",
      connectString: "orders-db.internal:1521/ORCLPDB1",
    });
    expect(connection.callTimeout).toBe(30_000);
    expect(
      snapshot.tables.map((table: { name: string; kind: DataAssetKind }) => {
        return `${table.name}:${table.kind}`;
      }),
    ).toEqual(["ORDERS:Table", "ORDERS_MV:Materialized View", "ORDERS_V:View"]);
    expect(snapshot.tables[0]).toMatchObject({
      estimatedRows: 1200,
      sizeInBytes: 65536,
      writeCount: 37,
      secondsSinceChange: 600,
    });
    expect(snapshot.tables[0]!.columns).toEqual([
      { name: "ID", dataType: "number", isNullable: false, position: 1 },
    ]);
    expect(snapshot.lineage).toEqual([
      expect.objectContaining({
        upstreamTable: "ORDERS",
        downstreamTable: "ORDERS_V",
      }),
    ]);
    // Every read began read-only and was rolled back.
    expect(
      statements.filter((sql: string) => {
        return sql.startsWith("SET TRANSACTION READ ONLY");
      }).length,
    ).toBe(rollbacks);
    expect(closed).toBe(true);
  });
});
