import { AddServerEmailLog1809183300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183300000-AddServerEmailLog";
import ServerEmailLog from "../../../../Models/DatabaseModels/ServerEmailLog";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ProjectService from "../../../../Server/Services/ProjectService";
import ServerEmailLogService from "../../../../Server/Services/ServerEmailLogService";
import logger from "../../../../Server/Utils/Logger";
import OlderRowsPurge, {
  OlderRowsPurgeSummary,
} from "../../../../Server/Utils/Retention/OlderRowsPurge";
import ServerEmailLogReader from "../../../../Server/Utils/ServerSending/ServerEmailLogReader";
import ServerEmailLogRecorder from "../../../../Server/Utils/ServerSending/ServerEmailLogRecorder";
import ServerEmailLogWriter from "../../../../Server/Utils/ServerSending/ServerEmailLogWriter";
import Email from "../../../../Types/Email";
import {
  SERVER_EMAIL_LOG_PAGE_SIZE,
  ServerEmailLogAnswer,
  ServerEmailLogEntry,
  ServerEmailLogStatus,
} from "../../../../Types/Email/ServerEmailLog";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * THE SERVER'S EMAIL LOG, ON POSTGRES (#6878).
 *
 * The AddServerEmailLog migration, then the log's real paths on the table
 * it makes - MailService's writer, the master admins' read and the daily
 * purge:
 *
 *   - the table and its two indexes, with no key to any project: a row of
 *     a project that never existed, or no longer does, is written;
 *   - a password reset's row holds whom it went to, its subject, its
 *     template and how it went - and nowhere the reset link or its token;
 *   - the list reads newest first, every email or the failed ones only, a
 *     page at a time, and each of its two sorts is served by its index;
 *   - a row older than the log keeps it (30 days on a self-hosted server)
 *     is deleted for good by the daily purge; a younger one stays;
 *   - down() drops the table, and up() makes it again.
 *
 * Opt in with RUN_POSTGRES_SERVER_EMAIL_LOG_TESTS=true and the normal
 * database credentials; SERVER_EMAIL_LOG_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * migration runs in a uniquely named schema, first on the search path, so
 * no row of the database's own is read or written; the schema is dropped
 * afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SERVER_EMAIL_LOG_TESTS"] === "true"
    ? describe
    : describe.skip;

const DAY: number = 24 * 60 * 60 * 1000;

const RESET_TOKEN: string = "6f1c2a7e-93b4-4d2f-8a51-0c7e9d3b2f64";

describePostgres("AddServerEmailLog against Postgres", () => {
  const schema: string = `server_email_log_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const connection: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  } = {
    host: process.env["SERVER_EMAIL_LOG_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["SERVER_EMAIL_LOG_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["SERVER_EMAIL_LOG_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
  };

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}", public`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function rowsAsText(): Promise<string> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT row_to_json(t)::text AS "row" FROM "${schema}"."ServerEmailLog" t`,
    );

    return rows
      .map((row: Record<string, unknown>): string => {
        return String(row["row"]);
      })
      .join("\n");
  }

  async function addRow(data: {
    to: string;
    status: "Success" | "Error";
    createdAt: Date;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."ServerEmailLog" ("_id", "version", "toEmail", "status", "createdAt", "updatedAt")
       VALUES ($1, 1, $2, $3, $4, $4)`,
      [id, data.to, data.status, data.createdAt],
    );

    return id;
  }

  async function planOf(sql: string): Promise<string> {
    const rows: Array<Record<string, string>> = await database.query(
      `EXPLAIN ${sql}`,
    );

    return rows
      .map((row: Record<string, string>): string => {
        return String(row["QUERY PLAN"]);
      })
      .join("\n");
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...connection,
      entities: [ServerEmailLog],
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddServerEmailLog1809183300000().up(queryRunner);
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."ServerEmailLog"`);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    // The projects' names: none of the database's own projects is read.
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([] as never);

    for (const silenced of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    ServerEmailLogWriter.startWriting();
  });

  afterEach(() => {
    ServerEmailLogRecorder.register(null);
    jest.restoreAllMocks();
  });

  test("makes the table and its two indexes, with no key to any other table", async () => {
    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'ServerEmailLog' ORDER BY indexname`,
      [schema],
    );

    expect(
      indexes.map((index: { indexdef: string }): string => {
        return index.indexdef
          .replace(`"${schema}".`, "")
          .replace(`${schema}.`, "");
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`("createdAt")`),
        expect.stringContaining(`(status, "createdAt")`),
      ]),
    );

    const keys: Array<unknown> = await database.query(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = 'ServerEmailLog' AND c.contype = 'f'`,
      [schema],
    );

    expect(keys).toEqual([]);
  });

  test("a password reset's row: whom, its subject and template, how it went - never the link or its token", async () => {
    await ServerEmailLogRecorder.record({
      isServerSettings: true,
      toEmail: new Email("alice@example.test"),
      subject: `Password Reset Request for OneUptime https://oneuptime.example.test/accounts/reset-password/${RESET_TOKEN}`,
      templateType: "ForgotPassword.hbs",
      isSent: false,
      statusMessage: `550 5.1.1 Recipient address rejected (link was https://oneuptime.example.test/accounts/reset-password/${RESET_TOKEN})`,
    });

    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "toEmail", "subject", "templateType", "status", "statusMessage", "projectId" FROM "${schema}"."ServerEmailLog"`,
    );

    expect(rows).toEqual([
      {
        toEmail: "alice@example.test",
        subject: "Password Reset Request for OneUptime [link]",
        templateType: "ForgotPassword.hbs",
        status: "Error",
        statusMessage: "550 5.1.1 Recipient address rejected (link was [link])",
        projectId: null,
      },
    ]);

    const stored: string = await rowsAsText();

    expect(stored).not.toContain(RESET_TOKEN);
    expect(stored).not.toContain("reset-password");
  });

  test("a project's failed email is written with its project, though no such project exists", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await ServerEmailLogRecorder.record({
      isServerSettings: true,
      toEmail: new Email("bob@example.test"),
      subject: "Incident #12: a private incident's title",
      templateType: "IncidentCreated.hbs",
      projectId: projectId,
      isSent: false,
      statusMessage: "535 5.7.8 Authentication failed",
    });

    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "subject", "projectId" FROM "${schema}"."ServerEmailLog"`,
    );

    expect(rows).toEqual([{ subject: null, projectId: projectId.toString() }]);
  });

  test("the list: newest first, the failed ones only, a page at a time", async () => {
    const now: number = Date.now();

    for (
      let index: number = 0;
      index < SERVER_EMAIL_LOG_PAGE_SIZE + 2;
      index++
    ) {
      await addRow({
        to: `person${index}@example.test`,
        status: index % 2 === 0 ? "Success" : "Error",
        createdAt: new Date(now - index * 60 * 1000),
      });
    }

    const first: ServerEmailLogAnswer = await ServerEmailLogReader.read({
      failedOnly: false,
      skip: 0,
    });

    expect(first.entries).toHaveLength(SERVER_EMAIL_LOG_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.entries[0]!.toEmail).toBe("person0@example.test");
    expect(
      first.entries.map((entry: ServerEmailLogEntry): number => {
        return Date.parse(entry.at);
      }),
    ).toEqual(
      [...first.entries]
        .map((entry: ServerEmailLogEntry): number => {
          return Date.parse(entry.at);
        })
        .sort((a: number, b: number): number => {
          return b - a;
        }),
    );

    const second: ServerEmailLogAnswer = await ServerEmailLogReader.read({
      failedOnly: false,
      skip: SERVER_EMAIL_LOG_PAGE_SIZE,
    });

    expect(
      second.entries.map((entry: ServerEmailLogEntry): string => {
        return entry.toEmail;
      }),
    ).toEqual([
      `person${SERVER_EMAIL_LOG_PAGE_SIZE}@example.test`,
      `person${SERVER_EMAIL_LOG_PAGE_SIZE + 1}@example.test`,
    ]);
    expect(second.hasMore).toBe(false);

    const failed: ServerEmailLogAnswer = await ServerEmailLogReader.read({
      failedOnly: true,
      skip: 0,
    });

    expect(failed.entries.length).toBeGreaterThan(0);
    expect(
      failed.entries.every((entry: ServerEmailLogEntry): boolean => {
        return entry.status === ServerEmailLogStatus.Failed;
      }),
    ).toBe(true);
    expect(failed.entries[0]!.toEmail).toBe("person1@example.test");
  });

  test("each of the list's two sorts is served by its index", async () => {
    await database.query("SET enable_seqscan = off");

    try {
      const every: string = await planOf(
        `SELECT "_id" FROM "${schema}"."ServerEmailLog" ORDER BY "createdAt" DESC LIMIT ${SERVER_EMAIL_LOG_PAGE_SIZE + 1}`,
      );
      const failedOnly: string = await planOf(
        `SELECT "_id" FROM "${schema}"."ServerEmailLog" WHERE "status" = 'Error' ORDER BY "createdAt" DESC LIMIT ${SERVER_EMAIL_LOG_PAGE_SIZE + 1}`,
      );

      expect(every).toMatch(
        /Index Scan Backward using "?IDX_0d2976fa945e500101c4d5ed27"?/,
      );
      expect(failedOnly).toMatch(
        /Index Scan Backward using "?IDX_c96f1586cc4957746bae4011e6"?/,
      );
      expect(every).not.toMatch(/\bSort\b/);
      expect(failedOnly).not.toMatch(/\bSort\b/);
    } finally {
      await database.query("SET enable_seqscan = on");
    }
  });

  test("a row older than the log keeps it is deleted for good by the daily purge; a younger one stays", async () => {
    expect(ServerEmailLogService.hardDeleteItemsOlderThanDays).toBe(30);
    expect(OlderRowsPurge.isPurged(ServerEmailLogService)).toBe(true);

    const old: string = await addRow({
      to: "old@example.test",
      status: "Error",
      createdAt: new Date(Date.now() - 31 * DAY),
    });
    const young: string = await addRow({
      to: "young@example.test",
      status: "Error",
      createdAt: new Date(Date.now() - 29 * DAY),
    });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [ServerEmailLogService],
    });

    expect(summary.purged).toBe(1);

    const left: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."ServerEmailLog" ORDER BY "createdAt"`,
    );

    expect(
      left.map((row: { _id: string }): string => {
        return row._id;
      }),
    ).toEqual([young]);
    expect(
      left.map((row: { _id: string }): string => {
        return row._id;
      }),
    ).not.toContain(old);
  });

  test("down() drops the table, and up() makes it again", async () => {
    /*
     * down() names its indexes in public, where the migrations run: its
     * statements run here in the suite's schema instead, never in public.
     */
    const statements: Array<string> = [];

    await new AddServerEmailLog1809183300000().down({
      query: async (sql: string): Promise<void> => {
        statements.push(sql);
      },
    } as unknown as QueryRunner);

    expect(statements).toHaveLength(3);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      for (const statement of statements) {
        await queryRunner.query(
          statement.replace(/"public"\./g, `"${schema}".`),
        );
      }
    });

    const gone: Array<unknown> = await database.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ServerEmailLog'`,
      [schema],
    );

    expect(gone).toEqual([]);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddServerEmailLog1809183300000().up(queryRunner);
    });

    const back: Array<unknown> = await database.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ServerEmailLog'`,
      [schema],
    );

    expect(back).toHaveLength(1);
  });
});
