import { Client } from "pg";
import {
  CONTAINER_COMMAND_KNOWN_WORDS,
  classifyContainerCommand,
  containerCommandProjectionSql,
  reduceContainerCommand,
} from "../../../Types/DatabaseServer/DatabaseContainerCommand";
import {
  ALL_COMMANDS,
  ContainerCommandCase,
  argvOf,
} from "./DatabaseContainerCommandCorpus";

/*
 * containerCommandProjectionSql EXECUTED on Postgres, against its JavaScript
 * twin reduceContainerCommand. The container-discovery job reduces every
 * candidate pod's command lines in SQL before they leave the database, and
 * the classifier only ever sees that reduction — so a regex Postgres reads
 * differently from JavaScript (btrim() stripping only spaces once hid every
 * newline-led `sh -c` script, MongoDB Community's mongod among them) would
 * pass every JavaScript test and still miss real servers in production.
 * Every real-world command line of the shared corpus must project to exactly
 * what the twin computes, and classify to its expected role from there.
 *
 * Opt in with RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS=true, as for
 * DatabaseServerSqlPostgres (no table is read or written; any database
 * will do). Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from DATABASE_SERVER_SQL_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from DATABASE_SERVER_SQL_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECTION_SQL: string = `SELECT ${containerCommandProjectionSql({
  argv: "$1::jsonb",
  knownWords: "$2::text[]",
})} AS "command"`;

describePostgres("the container command projection on Postgres", () => {
  let client: Client;

  async function project(argv: Array<unknown>): Promise<Array<unknown>> {
    const result: { rows: Array<{ command: Array<unknown> }> } =
      await client.query(PROJECTION_SQL, [
        JSON.stringify(argv),
        [...CONTAINER_COMMAND_KNOWN_WORDS],
      ]);
    return result.rows[0]!.command;
  }

  beforeAll(async () => {
    client = new Client({
      host:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_PORT"] || "5400",
      ),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  test.each(
    ALL_COMMANDS.map((entry: ContainerCommandCase): string => {
      return entry.name;
    }),
  )("%s: Postgres projects what the twin computes", async (name: string) => {
    const entry: ContainerCommandCase = ALL_COMMANDS.find(
      (candidate: ContainerCommandCase): boolean => {
        return candidate.name === name;
      },
    )!;
    const argv: Array<string> = argvOf(entry);

    const projected: Array<unknown> = await project(argv);

    expect(projected).toEqual(reduceContainerCommand(argv));
    expect(
      classifyContainerCommand({
        command: projected as Array<string | null>,
      }),
    ).toBe(entry.role);
  });

  test("gaps, blanks and junk elements project like the twin", async () => {
    for (const argv of [
      [],
      [null],
      ["   "],
      [null, "psql"],
      ["sh", "-c", null],
      ["sh", null, "exec postgres"],
      ["sh", "-c", ""],
      ["redis-server", "/conf", "--sentinel"],
      ["sh", ...Array(12).fill("-e"), "-c", "psql"],
      ["\n\t/bin/sh", "-c", "\n\n\texec postgres"],
      // Too long to read, and the character (not UTF-16 unit) boundary.
      ["sh", "-c", "psql -c 'select 1'\n".repeat(1000)],
      ["sh", "-c", "\u{1F600}".repeat(16384)],
      ["sh", "-c", `psql ${"\u{1F600}".repeat(16379)}`],
      ["sh", "-c", `psql ${"\u{1F600}".repeat(16380)}`],
    ]) {
      expect(await project(argv)).toEqual(reduceContainerCommand(argv));
    }
  });

  test("secrets never leave Postgres", async () => {
    const secret: string = "hunter2-do-not-leak";
    for (const argv of [
      ["postgres", "-c", `password=${secret}`],
      ["mysql", `-p${secret}`],
      ["sh", "-c", `redis-server --requirepass ${secret}`],
      ["sh", "-c", `cat > /etc/secret <<EOF\n${secret}\nEOF\nexec postgres`],
      ["bash", "-o", secret, "-c", "exec postgres"],
    ]) {
      expect(JSON.stringify(await project(argv))).not.toContain("hunter2");
    }
  });
});
