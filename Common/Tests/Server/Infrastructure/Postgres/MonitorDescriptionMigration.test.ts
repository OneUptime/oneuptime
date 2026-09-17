import { RemoveMonitorDescriptionLengthLimit1793600000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1793600000000-RemoveMonitorDescriptionLengthLimit";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource, MigrationInterface, QueryRunner } from "typeorm";

interface DescriptionColumn {
  table: string;
  column: string;
}

interface StoredDescription {
  _id: number;
  description: string | null;
}

const DESCRIPTION_COLUMNS: ReadonlyArray<DescriptionColumn> = [
  { table: "Monitor", column: "description" },
  { table: "MonitorTemplate", column: "monitorDescription" },
];

async function queriesFor(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new RemoveMonitorDescriptionLengthLimit1793600000000()[direction](
    runner,
  );
  return statements;
}

describe("monitor description migration", () => {
  test.each(["up", "down"] as const)(
    "%s changes types in place without deleting or truncating descriptions",
    async (direction: "up" | "down") => {
      const statements: Array<string> = await queriesFor(direction);
      const type: string =
        direction === "up" ? "text" : "character varying(500)";

      /*
       * TypeORM generates DROP/ADD for this type change unless corrected.
       * The exact ALTER contract also excludes a truncating rollback cast.
       */
      expect(statements).toHaveLength(DESCRIPTION_COLUMNS.length);
      for (const { table, column } of DESCRIPTION_COLUMNS) {
        expect(statements).toContain(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE ${type}`,
        );
      }
      expect(statements.join("\n")).not.toMatch(/DROP COLUMN|TRUNCATE|USING/i);
    },
  );

  test("is registered exactly once so existing databases receive the change", () => {
    expect(
      SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return migration === RemoveMonitorDescriptionLengthLimit1793600000000;
        },
      ),
    ).toHaveLength(1);
  });
});

/*
 * Opt in with RUN_POSTGRES_MONITOR_DESCRIPTION_MIGRATION_TESTS=true and the
 * normal database credentials. Every test uses a transaction inside a unique
 * schema, and the connection's search_path excludes public to protect app data.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_DESCRIPTION_MIGRATION_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("monitor descriptions against Postgres", () => {
  const schema: string = `monitor_description_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const migration: RemoveMonitorDescriptionLengthLimit1793600000000 =
    new RemoveMonitorDescriptionLengthLimit1793600000000();
  const existingDescriptions: ReadonlyArray<string | null> = [
    null,
    "",
    "Monitor for pod CPU saturation",
    "監視 café 🚀".repeat(20),
    "x".repeat(500),
  ];
  let database: DataSource;
  let runner: QueryRunner;

  async function rows(
    column: DescriptionColumn,
  ): Promise<Array<StoredDescription>> {
    return runner.query(
      `SELECT "_id", "${column.column}" AS description FROM "${column.table}" ORDER BY "_id"`,
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_DESCRIPTION_MIGRATION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["MONITOR_DESCRIPTION_MIGRATION_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    runner = database.createQueryRunner();
    await runner.connect();
    const currentSchema: Array<{ current_schema: string }> = await runner.query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    await runner.startTransaction();
    for (const { table, column } of DESCRIPTION_COLUMNS) {
      await runner.query(
        `CREATE TABLE "${table}" ("_id" integer PRIMARY KEY, "${column}" character varying(500))`,
      );
      for (const [index, description] of existingDescriptions.entries()) {
        await runner.query(
          `INSERT INTO "${table}" ("_id", "${column}") VALUES ($1, $2)`,
          [index, description],
        );
      }
    }
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) {
      await runner.rollbackTransaction();
    }
  });

  afterAll(async () => {
    if (runner) {
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("preserves existing null, empty, Unicode and 500-character values through migration and rollback", async () => {
    const expected: Array<StoredDescription> = existingDescriptions.map(
      (description: string | null, index: number): StoredDescription => {
        return { _id: index, description };
      },
    );

    await migration.up(runner);
    for (const column of DESCRIPTION_COLUMNS) {
      expect(await rows(column)).toEqual(expected);
      const types: Array<{
        data_type: string;
        character_maximum_length: number | null;
      }> = await runner.query(
        "SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schema, column.table, column.column],
      );
      expect(types).toEqual([
        { data_type: "text", character_maximum_length: null },
      ]);
    }

    await migration.down(runner);
    for (const column of DESCRIPTION_COLUMNS) {
      expect(await rows(column)).toEqual(expected);
    }
  });

  test.each(DESCRIPTION_COLUMNS)(
    "stores and updates long descriptions in $table",
    async (column: DescriptionColumn) => {
      await migration.up(runner);
      const descriptions: ReadonlyArray<string> = [
        "a".repeat(501),
        "b".repeat(100_000),
        "## 監視 🚀\nCPU > 90% — café\n".repeat(1_000),
      ];

      for (const [index, description] of descriptions.entries()) {
        const id: number = 100 + index;
        const inserted: Array<StoredDescription> = await runner.query(
          `INSERT INTO "${column.table}" ("_id", "${column.column}") VALUES ($1, $2) RETURNING "_id", "${column.column}" AS description`,
          [id, description],
        );
        expect(inserted).toEqual([{ _id: id, description }]);

        const updatedDescription: string = `${description}\nUpdated description`;
        await runner.query(
          `UPDATE "${column.table}" SET "${column.column}" = $1 WHERE "_id" = $2`,
          [updatedDescription, id],
        );
        expect(await rows(column)).toContainEqual({
          _id: id,
          description: updatedDescription,
        });
      }
    },
  );

  test.each(DESCRIPTION_COLUMNS)(
    "refuses rollback with an oversized $table description instead of discarding it",
    async (column: DescriptionColumn) => {
      await migration.up(runner);
      const description: string = "x".repeat(501);
      await runner.query(
        `INSERT INTO "${column.table}" ("_id", "${column.column}") VALUES ($1, $2)`,
        [100, description],
      );

      /*
       * Match the transaction TypeORM uses for an actual rollback. The nested
       * savepoint lets us verify the retained data after the expected failure.
       */
      await runner.startTransaction();
      try {
        await expect(migration.down(runner)).rejects.toThrow(
          /value too long for type character varying\(500\)/,
        );
      } finally {
        await runner.rollbackTransaction();
      }
      expect(await rows(column)).toContainEqual({ _id: 100, description });
    },
  );
});
