import { ClearNextEventOfTemplatesThatDoNotRecur1802800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1802800000000-ClearNextEventOfTemplatesThatDoNotRecur";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The ClearNextEventOfTemplatesThatDoNotRecur migration against a real
 * Postgres, on real rows. A template whose Recurring Event switch is off
 * loses the next time it still held - deleted templates too - and nothing
 * else about it changes: its schedule (the first event's times and the
 * interval), its switch, when it was last updated. A recurring template is
 * left exactly as it was, with a time or without one. Run twice, the second
 * run changes nothing.
 *
 * Opt in with RUN_POSTGRES_TEMPLATE_NEXT_EVENT_TESTS=true and the normal
 * database credentials; TEMPLATE_NEXT_EVENT_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: the template table is cloned from
 * public into a uniquely named schema (so the source's rows are never read
 * or modified), and the schema is dropped afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TEMPLATE_NEXT_EVENT_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "ScheduledMaintenanceTemplate";

// Every column the migration must leave alone, as Postgres hands it back.
const KEPT_COLUMNS: Array<string> = [
  "isRecurringEvent",
  "firstEventScheduledAt",
  "firstEventStartsAt",
  "firstEventEndsAt",
  "recurringInterval",
  "updatedAt",
  "version",
  "deletedAt",
];

const WEEKLY: Record<string, unknown> = {
  _type: "Recurring",
  value: {
    intervalType: "Week",
    intervalCount: { _type: "PositiveNumber", value: 1 },
  },
};

interface Seed {
  isRecurringEvent: boolean;
  scheduleNextEventAt: string | null;
  deletedAt?: string | undefined;
  // The next time after the migration.
  expectedNextEventAt: string | null;
}

const SEEDS: Record<string, Seed> = {
  "a recurring template keeps its next time": {
    isRecurringEvent: true,
    scheduleNextEventAt: "2030-06-10T09:00:00.000Z",
    expectedNextEventAt: "2030-06-10T09:00:00.000Z",
  },
  "a template turned off loses the next time it still held": {
    isRecurringEvent: false,
    scheduleNextEventAt: "2030-06-17T09:00:00.000Z",
    expectedNextEventAt: null,
  },
  "a template turned off whose time has passed loses it too": {
    isRecurringEvent: false,
    scheduleNextEventAt: "2020-01-06T09:00:00.000Z",
    expectedNextEventAt: null,
  },
  "a deleted template turned off loses its time as well": {
    isRecurringEvent: false,
    scheduleNextEventAt: "2030-06-24T09:00:00.000Z",
    deletedAt: "2026-10-01T12:00:00.000Z",
    expectedNextEventAt: null,
  },
  "a template that never recurred stays without a time": {
    isRecurringEvent: false,
    scheduleNextEventAt: null,
    expectedNextEventAt: null,
  },
  "a recurring template without a time is left as it is": {
    isRecurringEvent: true,
    scheduleNextEventAt: null,
    expectedNextEventAt: null,
  },
};

type Row = Record<string, unknown>;

describePostgres(
  "ClearNextEventOfTemplatesThatDoNotRecur against Postgres",
  () => {
    const schema: string = `template_next_event_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

    const ids: Map<string, string> = new Map();
    const rowsBefore: Map<string, Row> = new Map();
    const rowsAfterUp: Map<string, Row> = new Map();
    const rowsAfterSecondUp: Map<string, Row> = new Map();

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

    async function insertTemplate(seed: Seed): Promise<string> {
      const row: Row = {
        _id: ObjectID.generate().toString(),
        templateName: "Weekly database patching",
        title: "Database patching",
        isRecurringEvent: seed.isRecurringEvent,
        scheduleNextEventAt: seed.scheduleNextEventAt,
        firstEventScheduledAt: "2030-06-03T09:00:00.000Z",
        firstEventStartsAt: "2030-06-08T02:00:00.000Z",
        firstEventEndsAt: "2030-06-08T04:00:00.000Z",
        recurringInterval: JSON.stringify(WEEKLY),
        updatedAt: "2026-09-01T00:00:00.000Z",
        version: 3,
        deletedAt: seed.deletedAt || null,
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

    // Each seed's row as Postgres holds it: its next time and what is kept.
    async function readTemplates(into: Map<string, Row>): Promise<void> {
      for (const label of Object.keys(SEEDS)) {
        const rows: Array<Row> = await database.query(
          `SELECT ${["scheduleNextEventAt", ...KEPT_COLUMNS]
            .map((column: string): string => {
              return `"${column}"`;
            })
            .join(", ")} FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
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

    async function up(): Promise<void> {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new ClearNextEventOfTemplatesThatDoNotRecur1802800000000().up(
          queryRunner,
        );
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TEMPLATE_NEXT_EVENT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TEMPLATE_NEXT_EVENT_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEMPLATE_NEXT_EVENT_TEST_DATABASE_NAME"] ||
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

      requiredColumns = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, TABLE],
      );

      for (const [label, seed] of Object.entries(SEEDS)) {
        ids.set(label, await insertTemplate(seed));
      }

      await readTemplates(rowsBefore);
      await up();
      await readTemplates(rowsAfterUp);
      await up();
      await readTemplates(rowsAfterSecondUp);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(Object.keys(SEEDS))("%s", (label: string) => {
      const seed: Seed = SEEDS[label]!;
      const before: Row = rowsBefore.get(label)!;
      const after: Row = rowsAfterUp.get(label)!;

      expect(before["scheduleNextEventAt"]).toBe(seed.scheduleNextEventAt);
      expect(after["scheduleNextEventAt"]).toBe(seed.expectedNextEventAt);

      // Everything else about the template, as it was.
      for (const column of KEPT_COLUMNS) {
        expect([column, after[column]]).toEqual([column, before[column]]);
      }
    });

    test("no template whose switch is off holds a time afterwards", async () => {
      const left: Array<Row> = await database.query(
        `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "isRecurringEvent" = false AND "scheduleNextEventAt" IS NOT NULL`,
      );

      expect(left).toEqual([]);
    });

    test("a second run changes nothing", () => {
      expect(Object.fromEntries(rowsAfterSecondUp)).toEqual(
        Object.fromEntries(rowsAfterUp),
      );
    });
  },
);
