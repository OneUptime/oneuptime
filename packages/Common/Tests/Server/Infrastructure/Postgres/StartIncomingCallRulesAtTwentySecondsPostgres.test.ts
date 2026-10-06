import { StartIncomingCallRulesAtTwentySeconds1798600000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798600000000-StartIncomingCallRulesAtTwentySeconds";
import { DEFAULT_INCOMING_CALL_RING_SECONDS } from "../../../../Types/IncomingCall/IncomingCallRingTime";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The StartIncomingCallRulesAtTwentySeconds migration against a real
 * Postgres, on real rows: a rule created without a ring time rings for 20
 * seconds after it and for 30 before it, and no rule that exists moves -
 * not one that took the old default, not one set to 30 on purpose, not one
 * with a time of its own.
 *
 * Opt in with RUN_POSTGRES_INCOMING_CALL_RING_TIME_TESTS=true and the normal
 * database credentials; INCOMING_CALL_RING_TIME_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: the escalation rule table is cloned
 * from public into a uniquely named schema (so the source's rows are never
 * read or modified), the migration's own down() puts the default back as it
 * was before it, and up() then runs on seeded rows. The schema is dropped
 * afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INCOMING_CALL_RING_TIME_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "IncomingCallPolicyEscalationRule";

// Every kind of rule the change must leave alone, with the ring time it holds.
const SEEDS: Record<string, number | null> = {
  // Created without a ring time while the default was 30.
  "took the old default": null,
  "set to 30 on purpose": 30,
  "rings longer": 45,
  "already rings for 20": 20,
  "rings for Twilio's shortest": 5,
};

describePostgres(
  "StartIncomingCallRulesAtTwentySeconds against Postgres",
  () => {
    const schema: string = `incoming_call_ring_time_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

    const ids: Map<string, string> = new Map();
    let publicDefault: string | null = null;
    let defaultAfterDown: string | null = null;
    let defaultAfterUp: string | null = null;
    let defaultAfterSecondDown: string | null = null;
    const ringTimesBeforeUp: Map<string, number> = new Map();
    const ringTimesAfterUp: Map<string, number> = new Map();
    const ringTimesAfterSecondDown: Map<string, number> = new Map();

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

    /*
     * Inserts a rule, filling every NOT NULL column that has no default and
     * was not given with a value of its type, so the seeds only say what the
     * test is about. A null ring time leaves the column out, as the API
     * does for a rule created without one.
     */
    async function insertRule(ringSeconds: number | null): Promise<string> {
      const row: Record<string, unknown> = {
        _id: ObjectID.generate().toString(),
      };

      if (ringSeconds !== null) {
        row["escalateAfterSeconds"] = ringSeconds;
      }

      for (const column of requiredColumns) {
        if (column.column_name in row) {
          continue;
        }

        if (column.udt_name === "uuid") {
          row[column.column_name] = ObjectID.generate().toString();
        } else if (column.udt_name === "int4" || column.udt_name === "int8") {
          row[column.column_name] = 1;
        } else if (column.udt_name === "bool") {
          row[column.column_name] = false;
        } else if (column.udt_name === "timestamptz") {
          row[column.column_name] = new Date().toISOString();
        } else {
          row[column.column_name] =
            `${column.column_name}-${ObjectID.generate().toString()}`;
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

    async function ringDefault(tableSchema: string): Promise<string | null> {
      const rows: Array<{ column_default: string | null }> =
        await database.query(
          `SELECT column_default FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND column_name = 'escalateAfterSeconds'`,
          [tableSchema, TABLE],
        );

      expect(rows).toHaveLength(1);
      return rows[0]!.column_default;
    }

    async function ringTimeOf(id: string): Promise<number> {
      const rows: Array<{ escalateAfterSeconds: number }> =
        await database.query(
          `SELECT "escalateAfterSeconds" FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
          [id],
        );

      expect(rows).toHaveLength(1);
      return Number(rows[0]!.escalateAfterSeconds);
    }

    async function readSeeds(into: Map<string, number>): Promise<void> {
      for (const label of Object.keys(SEEDS)) {
        into.set(label, await ringTimeOf(ids.get(label)!));
      }
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["INCOMING_CALL_RING_TIME_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["INCOMING_CALL_RING_TIME_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["INCOMING_CALL_RING_TIME_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      publicDefault = await ringDefault("public");

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

      // The table as it was BEFORE the migration, whether or not the source ran it.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new StartIncomingCallRulesAtTwentySeconds1798600000000().down(
          queryRunner,
        );
      });
      defaultAfterDown = await ringDefault(schema);

      for (const [label, ringSeconds] of Object.entries(SEEDS)) {
        ids.set(label, await insertRule(ringSeconds));
      }
      await readSeeds(ringTimesBeforeUp);

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new StartIncomingCallRulesAtTwentySeconds1798600000000().up(
          queryRunner,
        );
      });
      defaultAfterUp = await ringDefault(schema);
      await readSeeds(ringTimesAfterUp);

      // And back down, to see what a rollback keeps.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new StartIncomingCallRulesAtTwentySeconds1798600000000().down(
          queryRunner,
        );
      });
      defaultAfterSecondDown = await ringDefault(schema);
      await readSeeds(ringTimesAfterSecondDown);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the migrated database starts a new rule at 20 seconds", () => {
      expect(publicDefault).toBe(String(DEFAULT_INCOMING_CALL_RING_SECONDS));
      expect(publicDefault).toBe("20");
    });

    test("before it, a rule created without a ring time rang for 30", () => {
      expect(defaultAfterDown).toBe("30");
      expect(ringTimesBeforeUp.get("took the old default")).toBe(30);
    });

    test("after it, the column defaults to 20", () => {
      expect(defaultAfterUp).toBe("20");
    });

    test("every rule that existed keeps the ring time it held", () => {
      expect(Object.fromEntries(ringTimesAfterUp)).toEqual({
        "took the old default": 30,
        "set to 30 on purpose": 30,
        "rings longer": 45,
        "already rings for 20": 20,
        "rings for Twilio's shortest": 5,
      });
      expect(Object.fromEntries(ringTimesAfterUp)).toEqual(
        Object.fromEntries(ringTimesBeforeUp),
      );
    });

    test("a rollback puts the default back to 30 and moves no rule", () => {
      expect(defaultAfterSecondDown).toBe("30");
      expect(Object.fromEntries(ringTimesAfterSecondDown)).toEqual(
        Object.fromEntries(ringTimesBeforeUp),
      );
    });

    test("a rule created after it without a ring time rings for 20, and one that asks for 30 gets 30", async () => {
      // down() ran last, so a new rule takes the default down() restored...
      expect(await ringTimeOf(await insertRule(null))).toBe(30);

      // ...and up() again starts a new rule at 20.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new StartIncomingCallRulesAtTwentySeconds1798600000000().up(
          queryRunner,
        );
      });

      expect(await ringTimeOf(await insertRule(null))).toBe(20);
      expect(await ringTimeOf(await insertRule(30))).toBe(30);

      // The seeded rules still hold what they held.
      const afterThirdRun: Map<string, number> = new Map();
      await readSeeds(afterThirdRun);
      expect(Object.fromEntries(afterThirdRun)).toEqual(
        Object.fromEntries(ringTimesBeforeUp),
      );
    });
  },
);
