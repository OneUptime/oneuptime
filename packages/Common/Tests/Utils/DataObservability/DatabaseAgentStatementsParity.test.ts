import { describe, expect, test } from "@jest/globals";
import {
  DataCheckStatement,
  DataCheckTarget,
  buildDataCheckStatement,
  buildFreshnessStatement,
} from "../../../Server/Utils/DataObservability/DataCheckSql";
import {
  readCheckRows,
  readFreshnessAge,
} from "../../../Server/Utils/DataObservability/DataCheckResults";
import { readTableHealthSnapshot } from "../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import {
  MAX_COLUMNS_PER_COLLECTION,
  MAX_LINEAGE_EDGES_PER_COLLECTION,
  MAX_TABLES_PER_COLLECTION,
  TableHealthSnapshot,
  readCount,
  readMySqlKind,
  readPostgresKind,
} from "../../../Server/Utils/DataObservability/TableHealthCollector";
import { MAX_CHECKS_PER_COLLECTION } from "../../../Server/Utils/DataObservability/DataCheckPlanner";
import { MAX_CUSTOM_SQL_LENGTH } from "../../../Server/Utils/DataObservability/DataCheckSql";
import {
  DataCheckType,
  DATA_CHECK_TYPES,
} from "../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DATABASE_AGENT_MAX_CHECKS,
  DATABASE_AGENT_MAX_COLUMNS,
  DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH,
  DATABASE_AGENT_MAX_LINEAGE_EDGES,
  DATABASE_AGENT_MAX_TABLES,
  DATABASE_AGENT_STORES_PER_POLL,
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentCheck,
  DatabaseAgentEngine,
  DatabaseAgentSnapshot,
  DatabaseAgentWork,
  getDatabaseAgentEngineOfSystem,
  isDatabaseAgentDatabaseName,
  readDatabaseAgentDataObservabilityPosture,
  readDatabaseAgentWork,
  readDatabaseAgentWorkList,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import {
  CUSTOM_SQL_OFF_REFUSAL,
  DatabaseAgentCatalog,
  DatabaseAgentRefusal,
  DatabaseAgentStatement,
  buildDatabaseAgentCheckStatement,
  buildDatabaseAgentFreshnessStatement,
  checkDatabaseAgentCustomSql,
  getDatabaseAgentCatalogKey,
  getDatabaseAgentCheckRefusal,
  getDatabaseAgentFreshnessRefusal,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentStatements";
import {
  assembleDatabaseAgentTables,
  readDatabaseAgentCheckRows,
  readDatabaseAgentColumnRow,
  readDatabaseAgentCount,
  readDatabaseAgentFreshnessAge,
  readMySqlTableKind,
  readPostgresRelationKind,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentRows";

/*
 * A DATABASE AGENT RUNS EXACTLY WHAT OneUptime'S WORKERS AND PROBES RUN
 * (#11148).
 *
 * The agent builds its statements itself, from its own copy of
 * DatabaseAgentStatements, so a check means the same wherever it runs only
 * while that copy and the server's builder (DataCheckSql) agree. This holds
 * them together for PostgreSQL and MySQL - every check type, with and
 * without a segment, a sample, accepted values, a pattern and a reference -
 * and the readers of what comes back, the limits and the wire contract: a
 * work item read strictly, a posture read failing closed, and a snapshot the
 * agent builds read by the server as a probe's.
 */

const ENGINES: Array<DatabaseAgentEngine> = ["postgresql", "mysql"];

function agentCheckOf(target: DataCheckTarget): DatabaseAgentCheck {
  return {
    checkId: "00000000-0000-4000-8000-000000000001",
    type: target.type,
    schemaName: target.schemaName,
    tableName: target.tableName,
    columnName: target.columnName || null,
    segmentColumn: target.segmentColumn || null,
    acceptedValues: target.acceptedValues || null,
    pattern: target.pattern || null,
    referenceSchemaName:
      target.referenceTableName !== undefined && target.referenceTableName !== null
        ? target.referenceSchemaName || ""
        : null,
    referenceTableName: target.referenceTableName || null,
    referenceColumnName: target.referenceColumnName || null,
    customSql: target.customSql || null,
    samplePercent: target.samplePercent || null,
  };
}

// Every type a person adds, with what each needs, with and without a segment.
function targetsFor(schema: string): Array<DataCheckTarget> {
  const base: Pick<DataCheckTarget, "schemaName" | "tableName"> = {
    schemaName: schema,
    tableName: "orders",
  };
  const targets: Array<DataCheckTarget> = [];

  for (const type of DATA_CHECK_TYPES) {
    const target: DataCheckTarget = { ...base, type };

    if (
      [
        DataCheckType.NullPercent,
        DataCheckType.DuplicatePercent,
        DataCheckType.DistinctCount,
        DataCheckType.Minimum,
        DataCheckType.Maximum,
        DataCheckType.Average,
        DataCheckType.Sum,
        DataCheckType.InvalidPercent,
        DataCheckType.FormatMismatchPercent,
        DataCheckType.OrphanCount,
      ].includes(type)
    ) {
      target.columnName = 'customer "id"';
    }

    if (type === DataCheckType.InvalidPercent) {
      target.acceptedValues = ["paid", "it's open", "a`b"];
    }

    if (type === DataCheckType.FormatMismatchPercent) {
      target.pattern = "^[A-Z]{2}-[0-9]+$";
    }

    if (type === DataCheckType.OrphanCount) {
      target.referenceSchemaName = schema;
      target.referenceTableName = "customers";
      target.referenceColumnName = "id";
    }

    if (type === DataCheckType.CustomSql || type === DataCheckType.FailingRows) {
      target.customSql = "SELECT COUNT(*) FROM orders WHERE amount > 25";
    }

    targets.push(target);
    targets.push({ ...target, segmentColumn: "region`; DROP" });

    if (
      [
        DataCheckType.NullPercent,
        DataCheckType.Average,
        DataCheckType.InvalidPercent,
        DataCheckType.FormatMismatchPercent,
      ].includes(type)
    ) {
      targets.push({ ...target, samplePercent: 10 });
    }
  }

  return targets;
}

describe("A Database Agent's statements are the server's", () => {
  for (const engine of ENGINES) {
    const schema: string = engine === "mysql" ? "shop" : "public";

    test.each(targetsFor(schema))(
      `${engine}: %o is built alike on the agent and the server`,
      (target: DataCheckTarget) => {
        const server: DataCheckStatement = buildDataCheckStatement(engine, target);
        const agent: DatabaseAgentStatement = buildDatabaseAgentCheckStatement(
          engine,
          agentCheckOf(target),
          { allowsCustomSql: true },
        );

        expect(agent).toEqual(server);
      },
    );

    test(`${engine}: a freshness column is read alike`, () => {
      const target: { schemaName: string; tableName: string; columnName: string } =
        { schemaName: schema, tableName: "orders", columnName: "updated_at" };

      expect(buildDatabaseAgentFreshnessStatement(engine, target)).toEqual(
        buildFreshnessStatement(engine, target),
      );
    });

    test(`${engine}: what the server refuses to build, the agent refuses too`, () => {
      for (const target of [
        { ...targetsFor(schema)[0]!, type: DataCheckType.NullPercent, columnName: null },
        {
          schemaName: schema,
          tableName: "orders",
          type: DataCheckType.InvalidPercent,
          columnName: "status",
          acceptedValues: [],
        },
        {
          schemaName: schema,
          tableName: "orders",
          type: DataCheckType.FormatMismatchPercent,
          columnName: "status",
          pattern: "",
        },
        {
          schemaName: schema,
          tableName: "orders",
          type: DataCheckType.OrphanCount,
          columnName: "status",
        },
        {
          schemaName: schema,
          tableName: "orders",
          type: DataCheckType.CustomSql,
          customSql: "DELETE FROM orders",
        },
        {
          schemaName: schema,
          tableName: "orders",
          type: DataCheckType.CustomSql,
          customSql: "SELECT 1; DROP TABLE orders",
        },
      ] as Array<DataCheckTarget>) {
        expect(() => {
          return buildDataCheckStatement(engine, target);
        }).toThrow();
        expect(() => {
          return buildDatabaseAgentCheckStatement(engine, agentCheckOf(target), {
            allowsCustomSql: true,
          });
        }).toThrow(DatabaseAgentRefusal);
      }
    });
  }

  test("Custom SQL is built only where the agent's owner allows it", () => {
    const check: DatabaseAgentCheck = agentCheckOf({
      schemaName: "public",
      tableName: "orders",
      type: DataCheckType.CustomSql,
      customSql: "SELECT 1",
    });

    expect(() => {
      return buildDatabaseAgentCheckStatement("postgresql", check, {
        allowsCustomSql: false,
      });
    }).toThrow(CUSTOM_SQL_OFF_REFUSAL);
    expect(() => {
      return buildDatabaseAgentCheckStatement(
        "postgresql",
        { ...check, type: DataCheckType.FailingRows },
        { allowsCustomSql: false },
      );
    }).toThrow(CUSTOM_SQL_OFF_REFUSAL);
  });

  test("a query that writes, or two statements, is refused before it is sent", () => {
    for (const sql of [
      "INSERT INTO orders VALUES (1)",
      "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x",
      "SELECT * INTO copy FROM orders",
      "SELECT 1; SELECT 2",
      "UPDATE orders SET amount = 0",
      "",
      "x".repeat(DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH + 1),
    ]) {
      expect(() => {
        return checkDatabaseAgentCustomSql(sql);
      }).toThrow(DatabaseAgentRefusal);
    }

    // A semicolon or a write word inside a string is no statement.
    expect(
      checkDatabaseAgentCustomSql("SELECT COUNT(*) FROM t WHERE note = 'a; delete'"),
    ).toBe("SELECT COUNT(*) FROM t WHERE note = 'a; delete'");
  });
});

describe("A Database Agent reads what comes back as the server does", () => {
  test("a check's rows", () => {
    const cases: Array<{
      type: DataCheckType;
      isSegmented: boolean;
      rows: Array<Record<string, unknown>>;
    }> = [
      { type: DataCheckType.RowCount, isSegmented: false, rows: [{ value: "5" }] },
      { type: DataCheckType.NullPercent, isSegmented: false, rows: [{ value: null }] },
      {
        type: DataCheckType.RowCount,
        isSegmented: true,
        rows: [
          { segment: "paid", value: 2 },
          { segment: null, value: "1" },
          { segment: new Date("2026-01-02T00:00:00Z"), value: 3 },
          { segment: "x".repeat(500), value: 4 },
          { segment: "bad", value: "not a number" },
        ],
      },
      { type: DataCheckType.CustomSql, isSegmented: false, rows: [{ count: "3" }] },
      {
        type: DataCheckType.CustomSql,
        isSegmented: true,
        rows: [{ region: "eu", total: 7 }, { region: null, total: "8" }],
      },
      { type: DataCheckType.Sum, isSegmented: false, rows: [] },
    ];

    for (const item of cases) {
      expect(readDatabaseAgentCheckRows(item)).toEqual(readCheckRows(item));
    }
  });

  test("a freshness column's newest value, counts and kinds", () => {
    const now: Date = new Date("2026-11-26T12:00:00Z");

    for (const value of [
      new Date("2026-11-26T11:00:00Z"),
      "2026-11-26 11:00:00",
      "2026-11-27T00:00:00Z",
      "",
      null,
      "not a time",
    ]) {
      expect(readDatabaseAgentFreshnessAge(value, now)).toBe(
        readFreshnessAge(value, now),
      );
    }

    for (const value of ["12", 7, BigInt(9), "-1", "x", null, 2.7]) {
      expect(readDatabaseAgentCount(value)).toBe(readCount(value));
    }

    for (const relkind of ["r", "p", "v", "m", "f", "i", "S", null]) {
      expect(readPostgresRelationKind(relkind)).toBe(readPostgresKind(relkind));
    }

    for (const type of ["BASE TABLE", "view", "SYSTEM VIEW", "SEQUENCE", null]) {
      expect(readMySqlTableKind(type)).toBe(readMySqlKind(type));
    }
  });

  test("the limits are the probe's and the workers'", () => {
    expect(DATABASE_AGENT_MAX_TABLES).toBe(MAX_TABLES_PER_COLLECTION);
    expect(DATABASE_AGENT_MAX_COLUMNS).toBe(MAX_COLUMNS_PER_COLLECTION);
    expect(DATABASE_AGENT_MAX_LINEAGE_EDGES).toBe(
      MAX_LINEAGE_EDGES_PER_COLLECTION,
    );
    expect(DATABASE_AGENT_MAX_CHECKS).toBe(MAX_CHECKS_PER_COLLECTION);
    expect(DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH).toBe(MAX_CUSTOM_SQL_LENGTH);
  });
});

describe("A check is judged against the catalog the agent read", () => {
  const catalog: DatabaseAgentCatalog = new Map([
    [getDatabaseAgentCatalogKey("public", "orders"), new Set(["id", "status", "customer_id"])],
    [getDatabaseAgentCatalogKey("public", "customers"), new Set(["id"])],
    // Its columns were cut: read by name only.
    [getDatabaseAgentCatalogKey("public", "wide"), null],
  ]);
  const of: (fields: Partial<DatabaseAgentCheck>) => DatabaseAgentCheck = (
    fields: Partial<DatabaseAgentCheck>,
  ): DatabaseAgentCheck => {
    return {
      ...agentCheckOf({
        schemaName: "public",
        tableName: "orders",
        type: DataCheckType.RowCount,
      }),
      ...fields,
    };
  };

  test("what the catalog has may run", () => {
    expect(getDatabaseAgentCheckRefusal(of({}), catalog, { allowsCustomSql: false })).toBeNull();
    expect(
      getDatabaseAgentCheckRefusal(
        of({ type: DataCheckType.NullPercent, columnName: "status", segmentColumn: "id" }),
        catalog,
        { allowsCustomSql: false },
      ),
    ).toBeNull();
    expect(
      getDatabaseAgentCheckRefusal(
        of({
          type: DataCheckType.OrphanCount,
          columnName: "customer_id",
          referenceSchemaName: "public",
          referenceTableName: "customers",
          referenceColumnName: "id",
        }),
        catalog,
        { allowsCustomSql: false },
      ),
    ).toBeNull();
    expect(
      getDatabaseAgentCheckRefusal(
        of({ tableName: "wide", type: DataCheckType.NullPercent, columnName: "anything" }),
        catalog,
        { allowsCustomSql: false },
      ),
    ).toBeNull();
  });

  test("a table, a column, a segment or a reference the catalog lacks is refused", () => {
    for (const fields of [
      { tableName: "pg_authid", schemaName: "pg_catalog" },
      { tableName: "orders", schemaName: "other" },
      { type: DataCheckType.NullPercent, columnName: 'status"; DROP TABLE orders; --' },
      { segmentColumn: "no_such_column" },
      {
        type: DataCheckType.OrphanCount,
        columnName: "customer_id",
        referenceSchemaName: "public",
        referenceTableName: "missing",
        referenceColumnName: "id",
      },
      {
        type: DataCheckType.OrphanCount,
        columnName: "customer_id",
        referenceSchemaName: "public",
        referenceTableName: "customers",
        referenceColumnName: "email",
      },
      {
        type: DataCheckType.OrphanCount,
        columnName: "customer_id",
      },
    ] as Array<Partial<DatabaseAgentCheck>>) {
      expect(
        getDatabaseAgentCheckRefusal(of(fields), catalog, {
          allowsCustomSql: true,
        }),
      ).toEqual(expect.any(String));
    }
  });

  test("Custom SQL is held to its owner's switch, not to a table", () => {
    const custom: DatabaseAgentCheck = of({
      type: DataCheckType.CustomSql,
      tableName: "anything",
      customSql: "SELECT 1",
    });

    expect(getDatabaseAgentCheckRefusal(custom, catalog, { allowsCustomSql: false })).toBe(
      CUSTOM_SQL_OFF_REFUSAL,
    );
    expect(getDatabaseAgentCheckRefusal(custom, catalog, { allowsCustomSql: true })).toBeNull();
  });

  test("a freshness column is judged the same way", () => {
    const read: { tableKey: string; schemaName: string; tableName: string; columnName: string } =
      { tableKey: "public.orders", schemaName: "public", tableName: "orders", columnName: "status" };

    expect(getDatabaseAgentFreshnessRefusal(read, catalog)).toBeNull();
    expect(
      getDatabaseAgentFreshnessRefusal({ ...read, columnName: "missing" }, catalog),
    ).toEqual(expect.any(String));
    expect(
      getDatabaseAgentFreshnessRefusal({ ...read, tableName: "missing" }, catalog),
    ).toEqual(expect.any(String));
  });
});

describe("The conversation is read strictly", () => {
  const work: Record<string, unknown> = {
    dataStoreId: "11111111-1111-4111-8111-111111111111",
    engine: "postgresql",
    databaseName: "orders",
    maxTables: 10,
    maxColumns: 100,
    exclusions: ["audit", 7],
    checks: [
      {
        checkId: "22222222-2222-4222-8222-222222222222",
        type: DataCheckType.RowCount,
        schemaName: "public",
        tableName: "orders",
        // Never read: the agent builds its own statement.
        sql: "DROP TABLE orders",
      },
      { checkId: "not-an-id", type: DataCheckType.RowCount, tableName: "t" },
      {
        checkId: "33333333-3333-4333-8333-333333333333",
        type: DataCheckType.DbtTest,
        tableName: "t",
      },
    ],
    freshnessReads: [
      {
        tableKey: "public.orders",
        schemaName: "public",
        tableName: "orders",
        columnName: "updated_at",
      },
      { tableKey: "", tableName: "x", columnName: "y" },
    ],
    waitWhenBusy: true,
    readsViewLineage: "yes",
    connectionString: "postgres://stolen:secret@elsewhere/db",
  };

  test("a work item keeps what it may and nothing else", () => {
    const read: DatabaseAgentWork | null = readDatabaseAgentWork(work);

    expect(read).toEqual({
      dataStoreId: "11111111-1111-4111-8111-111111111111",
      engine: "postgresql",
      databaseName: "orders",
      maxTables: 10,
      maxColumns: 100,
      exclusions: ["audit"],
      checks: [
        {
          checkId: "22222222-2222-4222-8222-222222222222",
          type: DataCheckType.RowCount,
          schemaName: "public",
          tableName: "orders",
          columnName: null,
          segmentColumn: null,
          acceptedValues: null,
          pattern: null,
          referenceSchemaName: null,
          referenceTableName: null,
          referenceColumnName: null,
          customSql: null,
          samplePercent: null,
        },
      ],
      freshnessReads: [
        {
          tableKey: "public.orders",
          schemaName: "public",
          tableName: "orders",
          columnName: "updated_at",
        },
      ],
      waitWhenBusy: true,
      readsViewLineage: false,
    });
    expect(JSON.stringify(read)).not.toContain("stolen");
    expect(JSON.stringify(read)).not.toContain("DROP");
  });

  test("a work item with a bad id, engine or database is no work", () => {
    for (const bad of [
      { ...work, dataStoreId: "x" },
      { ...work, engine: "oracle" },
      { ...work, databaseName: "../etc/passwd" },
      { ...work, databaseName: "orders\u0000" },
      { ...work, databaseName: " orders" },
      { ...work, databaseName: "x".repeat(65) },
      null,
      [],
      "work",
    ]) {
      expect(readDatabaseAgentWork(bad)).toBeNull();
    }

    expect(isDatabaseAgentDatabaseName("orders_2026")).toBe(true);
    expect(isDatabaseAgentDatabaseName("a/b")).toBe(false);
  });

  test("limits are held to the agent's own, and an answer to the stores per poll", () => {
    const huge: DatabaseAgentWork | null = readDatabaseAgentWork({
      ...work,
      maxTables: 10 ** 9,
      maxColumns: -3,
    });

    expect(huge?.maxTables).toBe(DATABASE_AGENT_MAX_TABLES);
    expect(huge?.maxColumns).toBe(DATABASE_AGENT_MAX_COLUMNS);
    expect(
      readDatabaseAgentWorkList({
        stores: Array.from({ length: 20 }, () => {
          return work;
        }),
      }),
    ).toHaveLength(DATABASE_AGENT_STORES_PER_POLL);
    expect(readDatabaseAgentWorkList({ stores: "none" })).toEqual([]);
  });

  test("a posture is on only for the boolean true, with a version spoken", () => {
    expect(
      readDatabaseAgentDataObservabilityPosture({
        isOn: true,
        workVersion: DATABASE_AGENT_WORK_VERSION,
        engine: "mysql",
        runsChecks: true,
        runsCustomSql: "true",
      }),
    ).toEqual({
      isOn: true,
      setting: null,
      offReason: null,
      engine: "mysql",
      runsChecks: true,
      runsCustomSql: false,
      workVersion: DATABASE_AGENT_WORK_VERSION,
    });
    expect(
      readDatabaseAgentDataObservabilityPosture({ isOn: "true", workVersion: 1 })?.isOn,
    ).toBe(false);
    expect(readDatabaseAgentDataObservabilityPosture({ isOn: true })).toBeNull();
    expect(readDatabaseAgentDataObservabilityPosture(null)).toBeNull();
  });

  test("a database system's engine", () => {
    expect(getDatabaseAgentEngineOfSystem("PostgreSQL")).toBe("postgresql");
    expect(getDatabaseAgentEngineOfSystem("mariadb")).toBe("mysql");
    expect(getDatabaseAgentEngineOfSystem("redis")).toBeNull();
    expect(getDatabaseAgentEngineOfSystem(null)).toBeNull();
  });
});

describe("What a Database Agent reports is a probe's snapshot to the server", () => {
  test("its tables, columns, checks and lineage are read as sent", () => {
    const now: Date = new Date("2026-11-26T12:00:00Z");
    const assembled: ReturnType<typeof assembleDatabaseAgentTables> =
      assembleDatabaseAgentTables({
        engine: "postgresql",
        tables: [
          {
            schema: "public",
            name: "orders",
            kind: DataAssetKind.Table,
            estimatedRows: 5,
            sizeInBytes: 8192,
            writeCount: 12,
            secondsSinceChange: null,
            readCount: 3,
            secondsSinceRead: null,
          },
          {
            schema: "audit",
            name: "log",
            kind: DataAssetKind.Table,
            estimatedRows: 1,
            sizeInBytes: 1,
            writeCount: 1,
            secondsSinceChange: null,
            readCount: 1,
            secondsSinceRead: null,
          },
        ],
        columns: [
          readDatabaseAgentColumnRow({
            table_schema: "public",
            table_name: "orders",
            column_name: "status",
            data_type: "TEXT",
            is_nullable: "YES",
            ordinal_position: 2,
          })!,
          readDatabaseAgentColumnRow({
            table_schema: "public",
            table_name: "orders",
            column_name: "id",
            data_type: "integer",
            is_nullable: false,
            ordinal_position: 1,
          })!,
        ],
        maxTables: 100,
        maxColumns: 1000,
        exclusions: ["audit"],
      });
    const sent: DatabaseAgentSnapshot = {
      engine: "postgresql",
      collectedAt: "2026-11-26T11:59:00.000Z",
      tables: assembled.tables,
      isComplete: assembled.isComplete,
      warnings: assembled.warnings,
      secondsSinceStatsReset: 3600,
      target: { databaseName: "orders", host: "db.example.com", port: 5432 },
      checkResults: [
        {
          checkId: "22222222-2222-4222-8222-222222222222",
          values: [{ segment: null, value: 5 }],
          error: null,
        },
      ],
      lineage: [
        {
          source: "View Definition",
          upstreamDatabase: null,
          upstreamSchema: "public",
          upstreamTable: "orders",
          downstreamSchema: "public",
          downstreamTable: "open_orders",
          secondsSinceSeen: null,
          seenBy: null,
        },
      ],
      isViewLineageComplete: true,
    };

    const read: TableHealthSnapshot | null = readTableHealthSnapshot(
      JSON.parse(JSON.stringify(sent)),
      now,
    );

    expect(read).not.toBeNull();
    expect(read!.engine).toBe("postgresql");
    expect(read!.collectedAt).toBe("2026-11-26T11:59:00.000Z");
    // The excluded schema is left out on the agent.
    expect(read!.tables.map((table: { name: string }) => {
      return table.name;
    })).toEqual(["orders"]);
    expect(read!.tables[0]!.columns).toEqual([
      { name: "id", dataType: "integer", isNullable: false, position: 1 },
      { name: "status", dataType: "text", isNullable: true, position: 2 },
    ]);
    expect(read!.tables[0]!.estimatedRows).toBe(5);
    expect(read!.target).toEqual({
      databaseName: "orders",
      host: "db.example.com",
      port: 5432,
    });
    expect(read!.checkResults).toEqual([
      {
        checkId: "22222222-2222-4222-8222-222222222222",
        values: [{ segment: null, value: 5 }],
        error: null,
      },
    ]);
    expect(read!.lineage).toHaveLength(1);
    expect(read!.isViewLineageComplete).toBe(true);
  });

  test("a column list cut at its limit leaves the last table's columns unknown", () => {
    const assembled: ReturnType<typeof assembleDatabaseAgentTables> =
      assembleDatabaseAgentTables({
        engine: "mysql",
        tables: [
          {
            schema: "shop",
            name: "a",
            kind: DataAssetKind.Table,
            estimatedRows: null,
            sizeInBytes: null,
            writeCount: null,
            secondsSinceChange: null,
            readCount: null,
            secondsSinceRead: null,
          },
        ],
        columns: [
          readDatabaseAgentColumnRow({
            table_schema: "shop",
            table_name: "a",
            column_name: "x",
            data_type: "int",
            is_nullable: "NO",
            ordinal_position: 1,
          })!,
        ],
        maxTables: 1,
        maxColumns: 1,
        exclusions: [],
      });

    expect(assembled.tables[0]!.columns).toBeNull();
    expect(assembled.isComplete).toBe(false);
    expect(assembled.warnings).toHaveLength(2);
  });
});
