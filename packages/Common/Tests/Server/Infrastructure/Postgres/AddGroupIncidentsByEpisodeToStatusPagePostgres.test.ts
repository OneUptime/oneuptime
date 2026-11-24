import { AddGroupIncidentsByEpisodeToStatusPage1809187610767 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187610767-AddGroupIncidentsByEpisodeToStatusPage";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddGroupIncidentsByEpisodeToStatusPage migration against a real
 * Postgres, on real rows (#10767). Every status page made before it -
 * whichever of its lists it shows, a deleted one too - reads off
 * afterwards, so it shows what it always showed; a page made after it reads
 * on without anyone naming the column; a page can still be made off; and
 * nothing else about an existing page changes. down() drops the column.
 *
 * Opt in with RUN_POSTGRES_GROUP_INCIDENTS_BY_EPISODE_TESTS=true and the
 * normal database credentials; GROUP_INCIDENTS_BY_EPISODE_TEST_DATABASE_HOST
 * / _PORT / _NAME point it at a database other than the local development
 * one. The database must already be migrated: the status page table is
 * cloned from public into a uniquely named schema (so the source's rows are
 * never read or modified), the column is dropped from the clone to give it
 * the shape it had before this migration, and the schema is dropped
 * afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_GROUP_INCIDENTS_BY_EPISODE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "StatusPage";

const COLUMN: string = "groupIncidentsByEpisode";

// What the migration must leave alone on an existing page.
const KEPT_COLUMNS: Array<string> = [
  "showIncidentsOnStatusPage",
  "showEpisodesOnStatusPage",
  "onlyShowScopedIncidents",
  "updatedAt",
  "version",
  "deletedAt",
];

interface Seed {
  showIncidentsOnStatusPage: boolean;
  showEpisodesOnStatusPage: boolean;
  deletedAt?: string | undefined;
}

const SEEDS: Record<string, Seed> = {
  "a page that shows both lists keeps separate cards": {
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
  },
  "a page that shows incidents only reads off": {
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: false,
  },
  "a page that shows episodes only reads off": {
    showIncidentsOnStatusPage: false,
    showEpisodesOnStatusPage: true,
  },
  "a page that shows neither reads off": {
    showIncidentsOnStatusPage: false,
    showEpisodesOnStatusPage: false,
  },
  "a deleted page reads off as well": {
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    deletedAt: "2026-10-01T12:00:00.000Z",
  },
};

type Row = Record<string, unknown>;

describePostgres(
  "AddGroupIncidentsByEpisodeToStatusPage against Postgres",
  () => {
    const schema: string = `group_by_episode_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

    const ids: Map<string, string> = new Map();
    const rowsBefore: Map<string, Row> = new Map();

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

    async function columnsOfTable(): Promise<Array<string>> {
      const rows: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name`,
        [schema, TABLE],
      );

      return rows.map((row: { column_name: string }): string => {
        return row.column_name;
      });
    }

    // A value for a NOT NULL column without a default, by its type.
    function filler(column: {
      column_name: string;
      udt_name: string;
    }): unknown {
      switch (column.udt_name) {
        case "uuid":
          return ObjectID.generate().toString();
        case "int2":
        case "int4":
        case "int8":
        case "numeric":
        case "float4":
        case "float8":
          return 1;
        case "bool":
          return false;
        case "timestamp":
        case "timestamptz":
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

    async function insertPage(fields: Row): Promise<string> {
      const row: Row = {
        _id: ObjectID.generate().toString(),
        name: "Acme Status",
        updatedAt: "2026-09-01T00:00:00.000Z",
        version: 3,
        ...fields,
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

    async function readPage(id: string, columns: Array<string>): Promise<Row> {
      const rows: Array<Row> = await database.query(
        `SELECT ${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")} FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [id],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    function asText(row: Row): Row {
      const text: Row = {};

      for (const [column, value] of Object.entries(row)) {
        text[column] = value instanceof Date ? value.toISOString() : value;
      }

      return text;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["GROUP_INCIDENTS_BY_EPISODE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["GROUP_INCIDENTS_BY_EPISODE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["GROUP_INCIDENTS_BY_EPISODE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING DEFAULTS)`,
      );

      // The table as it was before this migration.
      await database.query(
        `ALTER TABLE "${schema}"."${TABLE}" DROP COLUMN IF EXISTS "${COLUMN}"`,
      );

      requiredColumns = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, TABLE],
      );

      for (const [label, seed] of Object.entries(SEEDS)) {
        const id: string = await insertPage({
          showIncidentsOnStatusPage: seed.showIncidentsOnStatusPage,
          showEpisodesOnStatusPage: seed.showEpisodesOnStatusPage,
          ...(seed.deletedAt ? { deletedAt: seed.deletedAt } : {}),
        });

        ids.set(label, id);
        rowsBefore.set(label, asText(await readPage(id, KEPT_COLUMNS)));
      }

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddGroupIncidentsByEpisodeToStatusPage1809187610767().up(
          queryRunner,
        );
      });
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(Object.keys(SEEDS))("%s", async (label: string) => {
      const id: string = ids.get(label)!;

      expect((await readPage(id, [COLUMN]))[COLUMN]).toBe(false);
      expect(asText(await readPage(id, KEPT_COLUMNS))).toEqual(
        rowsBefore.get(label),
      );
    });

    test("the column is a boolean that is never null, on by default", async () => {
      const rows: Array<Row> = await database.query(
        `SELECT is_nullable, column_default, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
        [schema, TABLE, COLUMN],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!["udt_name"]).toBe("bool");
      expect(rows[0]!["is_nullable"]).toBe("NO");
      expect(rows[0]!["column_default"]).toBe("true");
    });

    test("a page made afterwards without naming the column groups incidents by episode", async () => {
      const id: string = await insertPage({
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
      });

      expect((await readPage(id, [COLUMN]))[COLUMN]).toBe(true);
    });

    test("a page can still be made with it off", async () => {
      const id: string = await insertPage({ [COLUMN]: false });

      expect((await readPage(id, [COLUMN]))[COLUMN]).toBe(false);
    });

    test("a null is refused: every page says one way or the other", async () => {
      await expect(insertPage({ [COLUMN]: null })).rejects.toThrow();
    });

    test("down() drops the column and leaves the rest of the table", async () => {
      const before: Array<string> = await columnsOfTable();

      expect(before).toContain(COLUMN);

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddGroupIncidentsByEpisodeToStatusPage1809187610767().down(
          queryRunner,
        );
      });

      expect(await columnsOfTable()).toEqual(
        before.filter((column: string): boolean => {
          return column !== COLUMN;
        }),
      );
    });
  },
);
