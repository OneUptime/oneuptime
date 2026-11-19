import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { Client } from "pg";
import { FindOperator } from "typeorm";
import MeaningSearch from "../../../../Server/Utils/AI/MeaningSearch";
import { SEARCHED_INCIDENT_COLUMNS } from "../../../../Server/Utils/AI/Toolbox/IncidentTools";
import ObjectID from "../../../../Types/ObjectID";

/*
 * SEARCH BY MEANING, READ BY POSTGRES (#7673).
 *
 * search_incidents and search_alerts ask the database for the records that
 * say what a question says: one Postgres regular expression built from
 * MeaningMatch's concept patterns and the question's words, read without
 * case (~*) over each searched column, or the question as typed (ILIKE).
 * MeaningSearch.test.ts reads that pattern as JavaScript reads it; here
 * Postgres reads it, on an Incident table holding paraphrases of the same
 * failures and records about other ones, so the word boundaries, groups and
 * classes are pinned as the database runs them.
 *
 * Opt in with RUN_POSTGRES_MEANING_SEARCH_TESTS=true against any Postgres
 * (MEANING_SEARCH_TEST_DATABASE_HOST, _PORT, _NAME; DATABASE_USERNAME,
 * DATABASE_PASSWORD): the table is made in a schema of the test's own, and
 * dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MEANING_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

// A condition's SQL for a column, its parameters written in as literals.
function sqlOf(condition: unknown, alias: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  let sql: string = operator.getSql!(alias);

  for (const [key, value] of Object.entries(
    (operator.objectLiteralParameters || {}) as Record<string, unknown>,
  )) {
    sql = sql.split(`:${key}`).join(`'${String(value).replace(/'/g, "''")}'`);
  }

  return sql;
}

const ROWS: Array<{
  name: string;
  title: string;
  rootCause?: string;
  description?: string;
  postmortemNote?: string;
}> = [
  {
    name: "pool",
    title: "Checkout is down",
    rootCause: "The connection pool was exhausted on the payments database.",
  },
  {
    name: "max-connections",
    title: "Payments API errors",
    description: "FATAL: sorry, too many clients already",
  },
  {
    name: "unavailable",
    title: "Checkout: Service Unavailable",
  },
  {
    name: "bad-gateway",
    title: "Edge answers 502 Bad Gateway",
  },
  {
    name: "oom",
    title: "worker-7 OOMKilled",
  },
  {
    name: "memory-limit",
    title: "Worker restarted",
    postmortemNote: "It exceeded its memory limit during the import.",
  },
  {
    name: "disk",
    title: "db-1 volume",
    rootCause: "No space left on device",
  },
  {
    name: "certificate",
    title: "Edge TLS errors",
    rootCause: "The certificate expired on the load balancer.",
  },
  {
    name: "billing",
    title: "The billing query failed at 02:00",
  },
  {
    name: "rapid",
    title: "Rapid growth of the orders table",
  },
  {
    name: "typed",
    title: "Checkout down",
    description: "Tracked as 4521-7788 in the ticket system; 100%_done",
  },
];

describePostgres("search by meaning, on Postgres", () => {
  const schema: string = `meaning_search_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let client: Client;

  async function found(question: string): Promise<Array<string>> {
    const condition: unknown = MeaningSearch.getCondition({
      columns: SEARCHED_INCIDENT_COLUMNS,
      text: question,
    });
    // The columns quoted, as TypeORM writes them in the query it runs.
    let where: string = sqlOf(condition, "Incident.title");

    for (const column of SEARCHED_INCIDENT_COLUMNS) {
      where = where
        .split(`Incident.${column} `)
        .join(`"Incident"."${column}" `);
    }

    const result: { rows: Array<{ name: string }> } = await client.query(
      `SELECT "name" FROM "Incident" WHERE ${where} ORDER BY "name"`,
    );

    return result.rows.map((row: { name: string }): string => {
      return row.name;
    });
  }

  beforeAll(async () => {
    client = new Client({
      host: process.env["MEANING_SEARCH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["MEANING_SEARCH_TEST_DATABASE_PORT"] || "5400"),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["MEANING_SEARCH_TEST_DATABASE_NAME"] || "postgres",
    });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Incident" (
        "name" text PRIMARY KEY,
        "title" varchar(100),
        "description" text,
        "rootCause" text,
        "remediationNotes" text,
        "postmortemNote" text
      );
    `);

    for (const row of ROWS) {
      await client.query(
        `INSERT INTO "Incident" ("name", "title", "description", "rootCause", "postmortemNote") VALUES ($1, $2, $3, $4, $5)`,
        [
          row.name,
          row.title,
          row.description || null,
          row.rootCause || null,
          row.postmortemNote || null,
        ],
      );
    }
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });

  test("too many connections finds every way of saying the pool ran out, and nothing else", async () => {
    expect(await found("too many connections")).toEqual([
      "max-connections",
      "pool",
    ]);
  });

  test("a 503 finds the other server errors, in other words", async () => {
    expect(await found("checkout 503")).toEqual(
      expect.arrayContaining(["unavailable", "bad-gateway", "pool", "typed"]),
    );
    expect(await found("checkout 503")).not.toContain("certificate");
  });

  test("OOMKilled finds what ran out of memory, in any column", async () => {
    expect(await found("OOMKilled")).toEqual(["memory-limit", "oom"]);
  });

  test("disk full finds no space left on device", async () => {
    expect(await found("disk full")).toEqual(["disk"]);
  });

  test("a word is found in any of its forms, from the start of a word only", async () => {
    expect(await found("billing queries failing")).toEqual(["billing"]);
    // "rapid" does not start with "api"; "errors" starts with "error".
    expect(await found("api errors")).toEqual([
      "certificate",
      "max-connections",
    ]);
  });

  test("an id is found as typed, and % and _ match only themselves", async () => {
    expect(await found("4521-7788")).toEqual(["typed"]);
    expect(await found("100%_done")).toEqual(["typed"]);
    expect(await found("100%")).toEqual(["typed"]);
    expect(await found("1x0%_done")).toEqual([]);
  });
});
