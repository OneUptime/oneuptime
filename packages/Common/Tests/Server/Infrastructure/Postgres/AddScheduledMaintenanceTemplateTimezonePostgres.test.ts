import { AddScheduledMaintenanceTemplateTimezone1809186700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186700000-AddScheduledMaintenanceTemplateTimezone";
import ObjectID from "../../../../Types/ObjectID";
import MaintenanceTemplateSchedule from "../../../../Types/ScheduledMaintenance/MaintenanceTemplateSchedule";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddScheduledMaintenanceTemplateTimezone migration against a real
 * Postgres, on real rows (#10037). Every template saved before it - recurring
 * or not, deleted ones too - reads UTC afterwards, the clock its events were
 * stepped on until now, and nothing else about it changes: its schedule, its
 * next event time, when it was last updated. Read back from Postgres, the
 * next event an hourly, daily or weekly template's schedule works out on UTC
 * is the very time it holds, so none of those moves; a monthly one goes back
 * to its first event's day of the month. A template saved after it without a
 * time zone reads UTC too, and none can be saved without one. down() drops
 * the column again.
 *
 * Opt in with RUN_POSTGRES_TEMPLATE_TIMEZONE_TESTS=true and the normal
 * database credentials; TEMPLATE_TIMEZONE_TEST_DATABASE_HOST / _PORT / _NAME
 * point it at a database other than the local development one. The database
 * must already be migrated: the template table is cloned from public into a
 * uniquely named schema (so the source's rows are never read or modified),
 * the column is dropped from the clone to give it the shape it had before
 * this migration, and the schema is dropped afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TEMPLATE_TIMEZONE_TESTS"] === "true"
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
  "scheduleNextEventAt",
  "updatedAt",
  "version",
  "deletedAt",
];

function recurring(intervalType: string, intervalCount: number): string {
  return JSON.stringify({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  });
}

// The moment of the upgrade, half a minute past an hour.
const UPGRADE_AT: Date = new Date("2026-11-19T12:00:30.000Z");

interface Seed {
  isRecurringEvent: boolean;
  firstEventScheduledAt: string;
  firstEventStartsAt: string;
  firstEventEndsAt: string;
  recurringInterval: string;
  // What the old steps of fixed milliseconds had worked out, at UPGRADE_AT.
  scheduleNextEventAt: string | null;
  deletedAt?: string | undefined;
  /*
   * The next event the template's schedule works out on UTC at UPGRADE_AT -
   * the time it holds, for every template that keeps it.
   */
  expectedNextEventAt: string | null;
}

/*
 * Typed in Los Angeles in July (09:00 PDT is 16:00 UTC), as most of these
 * were: the old steps kept 16:00 UTC all year, and so does UTC.
 */
const SEEDS: Record<string, Seed> = {
  "a daily template keeps its next event": {
    isRecurringEvent: true,
    firstEventScheduledAt: "2026-07-01T16:00:00.000Z",
    firstEventStartsAt: "2026-07-02T09:00:00.000Z",
    firstEventEndsAt: "2026-07-02T11:00:00.000Z",
    recurringInterval: recurring("Day", 1),
    // 141 days of 24 hours on.
    scheduleNextEventAt: "2026-11-19T16:00:00.000Z",
    expectedNextEventAt: "2026-11-19T16:00:00.000Z",
  },
  "a weekly template keeps its next event": {
    isRecurringEvent: true,
    firstEventScheduledAt: "2026-07-06T07:00:00.000Z",
    firstEventStartsAt: "2026-07-11T00:00:00.000Z",
    firstEventEndsAt: "2026-07-11T02:00:00.000Z",
    recurringInterval: recurring("Week", 1),
    scheduleNextEventAt: "2026-11-23T07:00:00.000Z",
    expectedNextEventAt: "2026-11-23T07:00:00.000Z",
  },
  "an every-six-hours template keeps its next event": {
    isRecurringEvent: true,
    firstEventScheduledAt: "2026-07-01T00:00:00.000Z",
    firstEventStartsAt: "2026-07-01T01:00:00.000Z",
    firstEventEndsAt: "2026-07-01T02:00:00.000Z",
    recurringInterval: recurring("Hour", 6),
    scheduleNextEventAt: "2026-11-19T18:00:00.000Z",
    expectedNextEventAt: "2026-11-19T18:00:00.000Z",
  },
  /*
   * The old steps of 30.4375 days put a window on the 1st at 19:30 on 1
   * December: on UTC's calendar it is at 00:00 that day, its first event's
   * time.
   */
  "a monthly template goes back to its first event's time of the 1st": {
    isRecurringEvent: true,
    firstEventScheduledAt: "2026-01-01T00:00:00.000Z",
    firstEventStartsAt: "2026-01-01T02:00:00.000Z",
    firstEventEndsAt: "2026-01-01T04:00:00.000Z",
    recurringInterval: recurring("Month", 1),
    scheduleNextEventAt: "2026-12-01T19:30:00.000Z",
    expectedNextEventAt: "2026-12-01T00:00:00.000Z",
  },
  "a template that does not recur reads UTC too": {
    isRecurringEvent: false,
    firstEventScheduledAt: "2026-07-01T16:00:00.000Z",
    firstEventStartsAt: "2026-07-02T09:00:00.000Z",
    firstEventEndsAt: "2026-07-02T11:00:00.000Z",
    recurringInterval: recurring("Day", 1),
    scheduleNextEventAt: null,
    expectedNextEventAt: null,
  },
  "a deleted template reads UTC as well": {
    isRecurringEvent: true,
    firstEventScheduledAt: "2026-07-01T16:00:00.000Z",
    firstEventStartsAt: "2026-07-02T09:00:00.000Z",
    firstEventEndsAt: "2026-07-02T11:00:00.000Z",
    recurringInterval: recurring("Day", 1),
    scheduleNextEventAt: "2026-11-19T16:00:00.000Z",
    deletedAt: "2026-10-01T12:00:00.000Z",
    expectedNextEventAt: "2026-11-19T16:00:00.000Z",
  },
};

type Row = Record<string, unknown>;

describePostgres(
  "AddScheduledMaintenanceTemplateTimezone against Postgres",
  () => {
    const schema: string = `template_timezone_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

    const ids: Map<string, string> = new Map();
    const rowsBefore: Map<string, Row> = new Map();
    const rowsAfterUp: Map<string, Row> = new Map();
    let timezoneColumn: Array<Row> = [];
    let columnsBefore: Array<string> = [];

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

    // A value for a NOT NULL column the seed does not name, by its type.
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

    async function insertTemplate(fields: Row): Promise<string> {
      const row: Row = {
        _id: ObjectID.generate().toString(),
        templateName: "Patching",
        title: "Database patching",
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

    // Each seed's row as Postgres holds it, its time zone with it once there is one.
    async function readTemplates(
      into: Map<string, Row>,
      withTimezone: boolean,
    ): Promise<void> {
      for (const label of Object.keys(SEEDS)) {
        const rows: Array<Row> = await database.query(
          `SELECT ${[...KEPT_COLUMNS, ...(withTimezone ? ["timezone"] : [])]
            .map((column: string): string => {
              return `"${column}"`;
            })
            .join(", ")} FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
          [ids.get(label)],
        );

        expect(rows).toHaveLength(1);

        into.set(label, rows[0]!);
      }
    }

    function asText(row: Row): Row {
      const text: Row = {};

      for (const [column, value] of Object.entries(row)) {
        text[column] =
          value instanceof Date
            ? value.toISOString()
            : value && typeof value === "object"
              ? JSON.stringify(value)
              : value;
      }

      return text;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TEMPLATE_TIMEZONE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TEMPLATE_TIMEZONE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEMPLATE_TIMEZONE_TEST_DATABASE_NAME"] ||
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

      // The table as it was before this migration.
      await database.query(
        `ALTER TABLE "${schema}"."${TABLE}" DROP COLUMN IF EXISTS "timezone"`,
      );

      requiredColumns = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, TABLE],
      );

      for (const [label, seed] of Object.entries(SEEDS)) {
        ids.set(
          label,
          await insertTemplate({
            isRecurringEvent: seed.isRecurringEvent,
            firstEventScheduledAt: seed.firstEventScheduledAt,
            firstEventStartsAt: seed.firstEventStartsAt,
            firstEventEndsAt: seed.firstEventEndsAt,
            recurringInterval: seed.recurringInterval,
            scheduleNextEventAt: seed.scheduleNextEventAt,
            deletedAt: seed.deletedAt || null,
          }),
        );
      }

      columnsBefore = await columnsOfTable();
      await readTemplates(rowsBefore, false);

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddScheduledMaintenanceTemplateTimezone1809186700000().up(
          queryRunner,
        );
      });

      await readTemplates(rowsAfterUp, true);

      timezoneColumn = await database.query(
        `SELECT is_nullable, column_default, character_maximum_length FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = 'timezone'`,
        [schema, TABLE],
      );
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(Object.keys(SEEDS))(
      "%s, and nothing else about it changes",
      (label: string) => {
        const before: Row = asText(rowsBefore.get(label)!);
        const after: Row = asText(rowsAfterUp.get(label)!);

        expect(after["timezone"]).toBe("UTC");

        for (const column of KEPT_COLUMNS) {
          expect([column, after[column]]).toEqual([column, before[column]]);
        }
      },
    );

    test.each(Object.keys(SEEDS))(
      "%s: its schedule, read back on UTC at the upgrade, works out the next event it says",
      (label: string) => {
        const seed: Seed = SEEDS[label]!;
        const after: Row = rowsAfterUp.get(label)!;

        if (!seed.isRecurringEvent || !seed.scheduleNextEventAt) {
          expect(after["scheduleNextEventAt"]).toBeNull();
          return;
        }

        expect(
          MaintenanceTemplateSchedule.getNextEventAt(
            after,
            UPGRADE_AT,
          )?.toISOString(),
        ).toBe(seed.expectedNextEventAt);
      },
    );

    test("the column is NOT NULL, as long as a time zone name may be, with UTC for its default", () => {
      expect(timezoneColumn).toHaveLength(1);
      expect(timezoneColumn[0]!["is_nullable"]).toBe("NO");
      expect(String(timezoneColumn[0]!["column_default"])).toContain("'UTC'");
      expect(Number(timezoneColumn[0]!["character_maximum_length"])).toBe(100);
    });

    test("no template is left without a time zone", async () => {
      const left: Array<Row> = await database.query(
        `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "timezone" IS NULL OR "timezone" <> 'UTC'`,
      );

      expect(left).toEqual([]);
    });

    test("a template saved afterwards without one reads UTC, and one cannot be saved with none", async () => {
      const id: string = await insertTemplate({
        isRecurringEvent: true,
        recurringInterval: recurring("Day", 1),
      });

      const rows: Array<Row> = await database.query(
        `SELECT "timezone" FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [id],
      );

      expect(rows[0]!["timezone"]).toBe("UTC");

      let refusal: unknown = null;

      try {
        await insertTemplate({ timezone: null });
      } catch (error) {
        refusal = error;
      }

      expect(String(refusal)).toContain("null value");
    });

    test("down() drops the column again, leaving the table as it was", async () => {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddScheduledMaintenanceTemplateTimezone1809186700000().down(
          queryRunner,
        );
      });

      expect(await columnsOfTable()).toEqual(columnsBefore);
      expect(columnsBefore).not.toContain("timezone");
    });
  },
);
