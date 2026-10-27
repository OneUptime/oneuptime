import dataSourceOptions from "../../../../Server/Infrastructure/Postgres/DataSourceOptions";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import timers from "timers";
import { DataSource, DataSourceOptions, QueryRunner } from "typeorm";

/*
 * A connection opened as OneUptime opens its own has Postgres's JIT compiler
 * off - and this is the statement it is off for.
 *
 * The reads behind incident and alert rules (owner, label, grouping, on-call,
 * runbook, auto-remediation and privacy rules) take a page of rules with
 * their seven to-many relations: fifteen tables joined, LIMIT 10000. Postgres
 * costs that above jit_above_cost even on empty tables, so with JIT on it
 * compiled the statement to machine code each time: 170-210 ms, against 4 ms
 * to plan and run it (2026-10-27). Here an empty copy of that shape is
 * explained on a connection opened with the production options, with JIT's
 * cost threshold at 0 (still nothing compiled: JIT is off), and again after
 * `SET jit = on` (compiled, where this Postgres was built with JIT).
 *
 * Needs only a bare Postgres - CI's Common test job sets the flag for the
 * one test-setup.sh starts. Everything it creates lives in a schema of its
 * own, dropped afterwards. Locally:
 *
 *   RUN_POSTGRES_JIT_TESTS=true \
 *   POSTGRES_JIT_TEST_DATABASE_HOST=127.0.0.1 \
 *   POSTGRES_JIT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... \
 *     npx jest Tests/Server/Infrastructure/Postgres/PostgresJitOffPostgres.test.ts
 */

/*
 * The production pool replaces each connection once it is
 * PostgresConnectionMaxLifetimeMs old: pg-pool arms a timer for every
 * connection and unref()s it, and Common's jest environment is jsdom, whose
 * setTimeout returns a bare number. As AbandonedStatementsPostgres does, the
 * suite runs on Node's own timers.
 */
let jsdomSetTimeout: typeof globalThis.setTimeout;
let jsdomClearTimeout: typeof globalThis.clearTimeout;

beforeAll(() => {
  jsdomSetTimeout = globalThis.setTimeout;
  jsdomClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = timers.setTimeout as typeof globalThis.setTimeout;
  globalThis.clearTimeout =
    timers.clearTimeout as typeof globalThis.clearTimeout;
});

afterAll(() => {
  globalThis.setTimeout = jsdomSetTimeout;
  globalThis.clearTimeout = jsdomClearTimeout;
});

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_JIT_TESTS"] === "true" ? describe : describe.skip;

const SCHEMA: string = `jit_off_${process.pid}_${Date.now()}`;

// A rule's to-many relations: a join table and the table it reaches, each.
const RELATIONS: Array<string> = [
  "monitors",
  "severities",
  "incidentLabels",
  "monitorLabels",
  "ownerUsers",
  "ownerTeams",
  "creatorTeams",
];

// The rule read's shape: the DISTINCT page of ids TypeORM takes first.
function ruleRead(): string {
  const joins: Array<string> = [];
  const columns: Array<string> = [
    `"Rule"."_id" AS "Rule__id"`,
    `"Rule"."createdAt" AS "Rule_createdAt"`,
    `"Rule"."name" AS "Rule_name"`,
  ];

  RELATIONS.forEach((relation: string, index: number) => {
    joins.push(
      `LEFT JOIN "${SCHEMA}"."Rule_${relation}" "j${index}" ON "j${index}"."ruleId" = "Rule"."_id"`,
      `LEFT JOIN "${SCHEMA}"."${relation}" "t${index}" ON "t${index}"."_id" = "j${index}"."targetId" AND ("t${index}"."deletedAt" IS NULL)`,
    );
    columns.push(`"t${index}"."_id" AS "t${index}__id"`);
  });

  return [
    `SELECT DISTINCT "d"."Rule__id", "d"."Rule_createdAt" FROM (`,
    `SELECT ${columns.join(", ")} FROM "${SCHEMA}"."Rule" "Rule"`,
    joins.join(" "),
    `WHERE "Rule"."projectId" = '00000000-0000-4000-8000-000000000001'`,
    `AND "Rule"."isEnabled" = true AND "Rule"."deletedAt" IS NULL`,
    `) "d" ORDER BY "d"."Rule_createdAt" DESC, "d"."Rule__id" ASC LIMIT 10000 OFFSET 0`,
  ].join(" ");
}

interface Explained {
  compiled: boolean;
  functions: number;
}

async function explain(runner: QueryRunner): Promise<Explained> {
  const rows: Array<{ "QUERY PLAN": Array<Record<string, unknown>> }> =
    await runner.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${ruleRead()}`);
  const plan: Record<string, unknown> = rows[0]!["QUERY PLAN"][0]!;
  const jit: Record<string, unknown> | undefined = plan["JIT"] as
    | Record<string, unknown>
    | undefined;

  return {
    compiled: Boolean(jit),
    functions: jit ? Number(jit["Functions"]) : 0,
  };
}

describePostgres("Postgres's JIT compiler on OneUptime's connections", () => {
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      ...dataSourceOptions,
      host:
        process.env["POSTGRES_JIT_TEST_DATABASE_HOST"] ||
        process.env["DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["POSTGRES_JIT_TEST_DATABASE_PORT"] ||
          process.env["DATABASE_PORT"] ||
          5400,
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["POSTGRES_JIT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [],
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      maxQueryExecutionTime: undefined,
    } as DataSourceOptions);
    await database.initialize();

    await database.query(`CREATE SCHEMA "${SCHEMA}"`);
    await database.query(
      `CREATE TABLE "${SCHEMA}"."Rule" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "createdAt" timestamptz NOT NULL, "name" varchar(100), "isEnabled" boolean NOT NULL, "deletedAt" timestamptz)`,
    );

    for (const relation of RELATIONS) {
      await database.query(
        `CREATE TABLE "${SCHEMA}"."${relation}" ("_id" uuid PRIMARY KEY, "name" varchar(100), "deletedAt" timestamptz)`,
      );
      await database.query(
        `CREATE TABLE "${SCHEMA}"."Rule_${relation}" ("ruleId" uuid NOT NULL, "targetId" uuid NOT NULL, PRIMARY KEY ("ruleId", "targetId"))`,
      );
    }
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await database.destroy();
    }
  });

  test("a connection opened with the production options has jit off", async () => {
    const rows: Array<{ jit: string }> = await database.query("SHOW jit");

    expect(rows[0]!.jit).toBe("off");
  });

  /*
   * jit_above_cost 0 takes JIT's own threshold out of it: the read is costed
   * past it whatever the planner estimates (the real rule read on the
   * migrated schema was costed at 6e10 on empty tables, past every one of
   * JIT's thresholds). With jit off, nothing is compiled even so.
   */
  test("nothing is compiled on these connections, at any cost", async () => {
    const runner: QueryRunner = database.createQueryRunner();

    try {
      await runner.query("SET jit_above_cost = 0");
      const read: Explained = await explain(runner);

      expect(read.compiled).toBe(false);
      expect(read.functions).toBe(0);
    } finally {
      await runner.query("RESET jit_above_cost");
      await runner.release();
    }
  });

  test("with JIT turned back on, the same read is compiled", async () => {
    const runner: QueryRunner = database.createQueryRunner();

    try {
      await runner.query("SET jit = on");
      await runner.query("SET jit_above_cost = 0");

      // On only where this Postgres was built with JIT: nothing to turn on otherwise.
      const available: Array<{ available: boolean }> = await runner.query(
        "SELECT pg_jit_available() AS available",
      );

      if (!available[0]!.available) {
        return;
      }

      const read: Explained = await explain(runner);

      expect(read.compiled).toBe(true);
      expect(read.functions).toBeGreaterThan(0);
    } finally {
      await runner.query("RESET jit_above_cost");
      await runner.query("RESET jit");
      await runner.release();
    }
  });
});
