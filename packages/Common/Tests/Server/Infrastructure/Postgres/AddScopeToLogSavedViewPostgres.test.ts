import { AddScopeToLogSavedView1808880000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808880000000-AddScopeToLogSavedView";
import ObjectID from "../../../../Types/ObjectID";
import {
  SAVED_VIEW_SCOPE_MAX_LENGTH,
  SavedViewScopeKind,
  buildSavedViewScope,
} from "../../../../Utils/Telemetry/SavedViewScope";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddScopeToLogSavedView migration against a real Postgres, on real
 * rows (issue #5549). Every saved log view a project already has keeps no
 * scope - so it stays on the Logs page, where an empty scope lists it, and
 * none goes missing - and nothing else about it changes: its name, query,
 * columns, time range, sort, page size, default, owner. Afterwards a view
 * can be given the page it was saved on, as long as a scope may be and no
 * longer, and each page's query lists that page's views alone. down() takes
 * the column away and keeps every view; up() again adds it again.
 *
 * Opt in with RUN_POSTGRES_LOG_SAVED_VIEW_SCOPE_TESTS=true and the normal
 * database credentials; LOG_SAVED_VIEW_SCOPE_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: LogSavedView is cloned from public into
 * a uniquely named schema (so the source's rows are never read or modified)
 * and put back as it was before the migration, without the column. The
 * schema is dropped afterwards. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml, after that job has applied
 * every registered migration to an empty database.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LOG_SAVED_VIEW_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "LogSavedView";

// Every column the migration must leave alone, as Postgres hands it back.
const KEPT_COLUMNS: Array<string> = [
  "projectId",
  "name",
  "query",
  "columns",
  "sortField",
  "sortOrder",
  "pageSize",
  "timeRange",
  "isDefault",
  "createdByUserId",
  "updatedAt",
  "version",
  "deletedAt",
];

const PROJECT_ID: string = ObjectID.generate().toString();
const CLUSTER_ID: string = ObjectID.generate().toString();

interface Seed {
  name: string;
  query: Record<string, unknown>;
  isDefault: boolean;
  deletedAt?: string | undefined;
}

// The views a project had before views had a page.
const SEEDS: Record<string, Seed> = {
  "the Logs page's default view": {
    name: "Errors",
    query: { severityText: { _type: "Includes", value: ["ERROR"] } },
    isDefault: true,
  },
  "a view saved on a cluster's Logs tab back then, its cluster in its query": {
    name: "Payments namespace",
    query: {
      attributes: {
        "resource.k8s.cluster.name": "prod-eks-01",
        "resource.k8s.namespace.name": "payments",
      },
    },
    isDefault: false,
  },
  "a deleted view": {
    name: "Old",
    query: {},
    isDefault: false,
    deletedAt: "2026-10-01T12:00:00.000Z",
  },
};

type Row = Record<string, unknown>;

describePostgres("AddScopeToLogSavedView against Postgres", () => {
  const schema: string = `log_saved_view_scope_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

  const ids: Map<string, string> = new Map();
  const rowsBefore: Map<string, Row> = new Map();
  const rowsAfterUp: Map<string, Row> = new Map();

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  // A value for a NOT NULL column the seed does not name, by its type.
  function filler(column: { column_name: string; udt_name: string }): unknown {
    switch (column.udt_name) {
      case "uuid":
        return ObjectID.generate().toString();
      case "int2":
      case "int4":
      case "int8":
        return 1;
      case "bool":
        return false;
      case "timestamptz":
      case "timestamp":
        return "2026-10-01T00:00:00.000Z";
      case "jsonb":
      case "json":
        return "{}";
      case "varchar":
      case "text":
        return `${column.column_name}-${ObjectID.generate().toString()}`;
      default:
        throw new Error(
          `No value for the required column ${column.column_name} of type ${column.udt_name}: add one here.`,
        );
    }
  }

  async function insertView(seed: Seed, extra: Row = {}): Promise<string> {
    const row: Row = {
      _id: ObjectID.generate().toString(),
      projectId: PROJECT_ID,
      name: seed.name,
      query: JSON.stringify(seed.query),
      columns: JSON.stringify(["time", "severityText", "body"]),
      sortField: "time",
      sortOrder: "Descending",
      pageSize: 100,
      timeRange: JSON.stringify({ range: "Past 1 Hour" }),
      isDefault: seed.isDefault,
      createdByUserId: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
      version: 2,
      deletedAt: seed.deletedAt || null,
      ...extra,
    };

    for (const column of requiredColumns) {
      if (!(column.column_name in row)) {
        row[column.column_name] = filler(column);
      }
    }

    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${TABLE}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );

    return row["_id"] as string;
  }

  async function readViews(into: Map<string, Row>): Promise<void> {
    for (const label of Object.keys(SEEDS)) {
      const rows: Array<Row> = await database.query(
        `SELECT ${KEPT_COLUMNS.map((column: string): string => {
          return `"${column}"`;
        }).join(", ")} FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [ids.get(label)],
      );

      expect(rows).toHaveLength(1);

      const row: Row = {};

      for (const [column, value] of Object.entries(rows[0]!)) {
        row[column] = value instanceof Date ? value.toISOString() : value;
      }

      into.set(label, row);
    }
  }

  async function scopeColumn(): Promise<Array<Row>> {
    return database.query(
      `SELECT data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'scope'`,
      [schema, TABLE],
    );
  }

  async function scopes(): Promise<Map<string, unknown>> {
    const rows: Array<Row> = await database.query(
      `SELECT "_id", "scope" FROM "${schema}"."${TABLE}"`,
    );

    return new Map(
      rows.map((row: Row): [string, unknown] => {
        return [String(row["_id"]), row["scope"]];
      }),
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["LOG_SAVED_VIEW_SCOPE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["LOG_SAVED_VIEW_SCOPE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["LOG_SAVED_VIEW_SCOPE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
    // As the table was before the migration.
    await database.query(
      `ALTER TABLE "${schema}"."${TABLE}" DROP COLUMN IF EXISTS "scope"`,
    );

    requiredColumns = await database.query(
      `SELECT column_name, udt_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
         AND is_nullable = 'NO' AND column_default IS NULL`,
      [schema, TABLE],
    );

    for (const [label, seed] of Object.entries(SEEDS)) {
      ids.set(label, await insertView(seed));
    }

    await readViews(rowsBefore);

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddScopeToLogSavedView1808880000000().up(queryRunner);
    });

    await readViews(rowsAfterUp);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("adds the column nullable, varchar(500), with no default", async () => {
    expect(await scopeColumn()).toEqual([
      {
        data_type: "character varying",
        character_maximum_length: SAVED_VIEW_SCOPE_MAX_LENGTH,
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });

  test.each(Object.keys(SEEDS))(
    "%s keeps no scope, and everything else as it was",
    async (label: string) => {
      expect((await scopes()).get(ids.get(label)!)).toBeNull();

      const before: Row = rowsBefore.get(label)!;
      const after: Row = rowsAfterUp.get(label)!;

      for (const column of KEPT_COLUMNS) {
        expect([column, after[column]]).toEqual([column, before[column]]);
      }
    },
  );

  test("the Logs page's query lists every view the project had: none goes missing", async () => {
    const listed: Array<Row> = await database.query(
      `SELECT "_id" FROM "${schema}"."${TABLE}"
       WHERE "projectId" = $1 AND "scope" IS NULL AND "deletedAt" IS NULL`,
      [PROJECT_ID],
    );

    expect(
      listed
        .map((row: Row): string => {
          return String(row["_id"]);
        })
        .sort(),
    ).toEqual(
      [
        ids.get("the Logs page's default view")!,
        ids.get(
          "a view saved on a cluster's Logs tab back then, its cluster in its query",
        )!,
      ].sort(),
    );
  });

  test("a view saved on a page is listed by that page's query alone", async () => {
    const clusterScope: string = buildSavedViewScope(
      SavedViewScopeKind.KubernetesCluster,
      CLUSTER_ID,
    );
    const clusterViewId: string = await insertView(
      { name: "Ingress", query: {}, isDefault: true },
      { scope: clusterScope },
    );

    const onCluster: Array<Row> = await database.query(
      `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "projectId" = $1 AND "scope" = $2`,
      [PROJECT_ID, clusterScope],
    );
    const onLogsPage: Array<Row> = await database.query(
      `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "projectId" = $1 AND "scope" IS NULL`,
      [PROJECT_ID],
    );
    const onOtherCluster: Array<Row> = await database.query(
      `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "projectId" = $1 AND "scope" = $2`,
      [
        PROJECT_ID,
        buildSavedViewScope(
          SavedViewScopeKind.KubernetesCluster,
          ObjectID.generate(),
        ),
      ],
    );

    expect(onCluster).toEqual([{ _id: clusterViewId }]);
    expect(
      onLogsPage.some((row: Row): boolean => {
        return String(row["_id"]) === clusterViewId;
      }),
    ).toBe(false);
    expect(onOtherCluster).toEqual([]);
  });

  test("holds a scope as long as a scope may be, and refuses a longer one", async () => {
    const longest: string = buildSavedViewScope(
      SavedViewScopeKind.KubernetesPod,
      "prod",
      "payments",
      "p".repeat(1000),
    );

    expect(longest.length).toBe(SAVED_VIEW_SCOPE_MAX_LENGTH);

    const id: string = await insertView(
      { name: "Long", query: {}, isDefault: false },
      { scope: longest },
    );

    expect((await scopes()).get(id)).toBe(longest);

    await expect(
      insertView(
        { name: "Too long", query: {}, isDefault: false },
        { scope: `${longest}x` },
      ),
    ).rejects.toThrow(/too long/);
  });

  test("down() takes the column away and keeps every view; up() adds it again", async () => {
    const countBefore: Array<Row> = await database.query(
      `SELECT count(*)::int AS "count" FROM "${schema}"."${TABLE}"`,
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddScopeToLogSavedView1808880000000().down(queryRunner);
    });

    expect(await scopeColumn()).toEqual([]);
    expect(
      await database.query(
        `SELECT count(*)::int AS "count" FROM "${schema}"."${TABLE}"`,
      ),
    ).toEqual(countBefore);

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddScopeToLogSavedView1808880000000().up(queryRunner);
    });

    expect(await scopeColumn()).toHaveLength(1);
    // Every view comes back with no scope: on the Logs page.
    for (const scope of (await scopes()).values()) {
      expect(scope).toBeNull();
    }
  });
});
