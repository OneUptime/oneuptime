import {
  MigrationFailureType,
  recordMigrationFailure,
  scrubMigrationErrorText,
} from "../../../../Server/Utils/Database/MigrationFailureLog";
import { DataSource } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * The migration-failure diagnostic log.
 *
 * This module exists so the admin health page can say WHY a migration is
 * pending rather than only that it is behind, which means the free-form text of
 * a database error gets persisted and then rendered back to an operator. Two
 * properties carry the weight, and neither one announces itself when it breaks:
 *
 *   1. The text is scrubbed first. Connection errors echo the DSN they failed
 *      to dial - `postgres://oneuptime:<password>@host/db` - and a failing DDL
 *      quotes its literal defaults, so an unscrubbed error message parks the
 *      database password in a table and puts it on a web page. A regex that
 *      stops matching still produces a row, still renders, and reads exactly
 *      like a working one.
 *
 *   2. Nothing here ever throws. Every write is best-effort by design: it runs
 *      on the failure path of a boot or migrate Job, where the caller is
 *      already holding a real error. A diagnostic that escalated would mask the
 *      failure it was written to explain - and on a first rollout the
 *      "MigrationFailure" table does not exist yet, so the INSERT genuinely
 *      does fail on the run that most needs the original error to survive.
 *
 * The row is written with raw SQL against a caller-supplied DataSource, which
 * is what lets the assertions below drive it with a stub instead of a database.
 */

// Mirrors the module's own bounds; a row must not be able to bloat the table.
const MAX_ERROR_MESSAGE_LENGTH: number = 10000;
const MAX_ERROR_STACK_LENGTH: number = 20000;

interface RecordedQuery {
  sql: string;
  parameters: Array<unknown>;
}

/*
 * A DataSource stand-in that records what would have been executed. Only
 * `query` is reached by the code under test, so the cast is narrow and the stub
 * cannot silently absorb a call to some other member.
 */
function stubDataSource(recorded: Array<RecordedQuery>): DataSource {
  return {
    query: (sql: string, parameters: Array<unknown>): Promise<void> => {
      recorded.push({ sql, parameters });
      return Promise.resolve();
    },
  } as unknown as DataSource;
}

function throwingDataSource(error: Error): DataSource {
  return {
    query: (): Promise<void> => {
      return Promise.reject(error);
    },
  } as unknown as DataSource;
}

// Positional parameters of the INSERT, in the order the statement binds them.
const MESSAGE_PARAMETER: number = 2;
const STACK_PARAMETER: number = 3;

describe("scrubMigrationErrorText", () => {
  describe("connection strings", () => {
    it("masks the password in a DSN the error echoed back", () => {
      expect(
        scrubMigrationErrorText(
          'could not connect to postgres://oneuptime:sup3r-s3cret@db:5432/oneuptime"',
        ),
      ).toBe(
        'could not connect to postgres://oneuptime:***REDACTED***@db:5432/oneuptime"',
      );
    });

    it("keeps the scheme and the username, which are what identify the failure", () => {
      /*
       * Redacting the whole DSN would be safe and useless: an operator reading
       * the health page needs to know which host and which role could not
       * connect. Only the password is a credential.
       */
      const scrubbed: string = scrubMigrationErrorText(
        "postgres://readonly:hunter2@primary.internal:5432/app",
      );

      expect(scrubbed).toContain("postgres://readonly:");
      expect(scrubbed).toContain("@primary.internal:5432/app");
      expect(scrubbed).not.toContain("hunter2");
    });

    it("masks every DSN in a message that names more than one", () => {
      const scrubbed: string = scrubMigrationErrorText(
        "failed over from postgres://a:first@one/db to postgres://b:second@two/db",
      );

      expect(scrubbed).not.toContain("first");
      expect(scrubbed).not.toContain("second");
      expect(scrubbed.match(/\*\*\*REDACTED\*\*\*/g)).toHaveLength(2);
    });

    it("masks schemes other than postgres", () => {
      // The same error text can carry a redis or amqp URL from a side effect.
      for (const scheme of ["redis", "amqp", "mongodb+srv", "clickhouse"]) {
        expect(
          scrubMigrationErrorText(`${scheme}://user:leaked@host:1234/x`),
        ).not.toContain("leaked");
      }
    });

    it("leaves a URL that carries no credentials untouched", () => {
      const harmless: string = "see https://oneuptime.com/docs/migrations";
      expect(scrubMigrationErrorText(harmless)).toBe(harmless);
    });
  });

  describe("keyword-introduced secrets", () => {
    it.each([
      ["password", "password=letmein"],
      ["secret", "secret=letmein"],
      ["token", "token=letmein"],
      ["api_key", "api_key=letmein"],
      ["api-key", "api-key=letmein"],
      ["apikey", "apikey=letmein"],
      ["credential", "credential=letmein"],
      ["private_key", "private_key=letmein"],
      ["auth_token", "auth_token=letmein"],
      ["access_key", "access_key=letmein"],
    ])("masks a value introduced by %s", (_label: string, text: string) => {
      const scrubbed: string = scrubMigrationErrorText(text);

      expect(scrubbed).not.toContain("letmein");
      expect(scrubbed).toContain("***REDACTED***");
    });

    it("matches the keyword whatever its case", () => {
      expect(scrubMigrationErrorText("PASSWORD=letmein")).not.toContain(
        "letmein",
      );
      expect(scrubMigrationErrorText("Api_Key: letmein")).not.toContain(
        "letmein",
      );
    });

    it("masks a single-quoted literal, as a failing DDL default would quote it", () => {
      const scrubbed: string = scrubMigrationErrorText(
        `ALTER TABLE "User" ADD "x" text DEFAULT password='p@ss word'`,
      );

      expect(scrubbed).not.toContain("p@ss word");
      expect(scrubbed).toContain("***REDACTED***");
    });

    it("masks a double-quoted literal", () => {
      expect(scrubMigrationErrorText('token: "abc def"')).not.toContain(
        "abc def",
      );
    });

    it("keeps the keyword and separator so the message still reads", () => {
      expect(scrubMigrationErrorText("password: letmein")).toBe(
        "password: ***REDACTED***",
      );
      expect(scrubMigrationErrorText("password=letmein")).toBe(
        "password=***REDACTED***",
      );
    });

    it("stops at the delimiter rather than swallowing the rest of the message", () => {
      /*
       * The tail of a migration error is the part an operator acts on. A
       * greedy match would redact the failure itself along with the secret.
       */
      const scrubbed: string = scrubMigrationErrorText(
        "connect failed (password=letmein, host=db) while running migration",
      );

      expect(scrubbed).not.toContain("letmein");
      expect(scrubbed).toContain("host=db");
      expect(scrubbed).toContain("while running migration");
    });
  });

  describe("as a whole", () => {
    it("scrubs a DSN and a keyword secret in the same message", () => {
      const scrubbed: string = scrubMigrationErrorText(
        "postgres://app:dsnpass@db/x rejected password=kwpass",
      );

      expect(scrubbed).not.toContain("dsnpass");
      expect(scrubbed).not.toContain("kwpass");
    });

    it("is idempotent, so text scrubbed twice is unchanged the second time", () => {
      /*
       * The message is scrubbed on the way into the row; anything that scrubs
       * again on the way out must not mangle the redaction marker.
       */
      const once: string = scrubMigrationErrorText(
        "postgres://app:p@db/x and password=q",
      );

      expect(scrubMigrationErrorText(once)).toBe(once);
    });

    it("returns an empty string unchanged rather than throwing", () => {
      expect(scrubMigrationErrorText("")).toBe("");
    });

    it("leaves ordinary migration errors completely alone", () => {
      const ordinary: string =
        'relation "Monitor" already exists — column "name" of relation "User" does not exist';

      expect(scrubMigrationErrorText(ordinary)).toBe(ordinary);
    });
  });
});

describe("recordMigrationFailure", () => {
  it("writes one row and reports that it did", async () => {
    const recorded: Array<RecordedQuery> = [];

    const wrote: boolean = await recordMigrationFailure(
      stubDataSource(recorded),
      {
        migrationName: "AddMonitorTable1790900000000",
        migrationType: MigrationFailureType.PostgresSchema,
        error: new Error("relation already exists"),
      },
    );

    expect(wrote).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.sql).toContain('INSERT INTO "MigrationFailure"');
    expect(recorded[0]!.parameters[0]).toBe("AddMonitorTable1790900000000");
    expect(recorded[0]!.parameters[1]).toBe(
      MigrationFailureType.PostgresSchema,
    );
    expect(recorded[0]!.parameters[MESSAGE_PARAMETER]).toBe(
      "relation already exists",
    );
  });

  it("records the runner the migration belongs to", async () => {
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "BackfillMonitorStatus",
      migrationType: MigrationFailureType.DataMigration,
      error: new Error("boom"),
    });

    expect(recorded[0]!.parameters[1]).toBe(MigrationFailureType.DataMigration);
  });

  it("scrubs the credential out of the message before it is stored", async () => {
    /*
     * The row is read back by the admin health page, so an unscrubbed message
     * is a password on a web page as well as one in a table.
     */
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error: new Error(
        "connect ECONNREFUSED postgres://oneuptime:sup3r-s3cret@db:5432/oneuptime",
      ),
    });

    const message: string = recorded[0]!.parameters[
      MESSAGE_PARAMETER
    ] as string;

    expect(message).not.toContain("sup3r-s3cret");
    expect(message).toContain("***REDACTED***");
  });

  it("scrubs the stack too, not only the message", async () => {
    const recorded: Array<RecordedQuery> = [];

    const error: Error = new Error("connect failed");
    error.stack =
      "Error: connect failed\n  at dial (postgres://u:stackpw@db/x)";

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error,
    });

    const stack: string = recorded[0]!.parameters[STACK_PARAMETER] as string;

    expect(stack).not.toContain("stackpw");
    expect(stack).toContain("***REDACTED***");
  });

  it("stores a null stack when the error carries none", async () => {
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      // Not an Error, so there is no stack to take.
      error: "a bare string rejection",
    });

    expect(recorded[0]!.parameters[STACK_PARAMETER]).toBeNull();
  });

  it("stringifies a rejection that is not an Error", async () => {
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error: "a bare string rejection",
    });

    expect(recorded[0]!.parameters[MESSAGE_PARAMETER]).toBe(
      "a bare string rejection",
    );
  });

  it("falls back to the error name when the message is empty", async () => {
    /*
     * An empty message would render as a blank explanation on the health page,
     * which reads as "no error" rather than "an error we cannot describe".
     */
    const recorded: Array<RecordedQuery> = [];

    const error: Error = new Error("");
    error.name = "QueryFailedError";

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error,
    });

    expect(recorded[0]!.parameters[MESSAGE_PARAMETER]).toBe("QueryFailedError");
  });

  it("bounds the message so a pathological error cannot bloat the table", async () => {
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error: new Error("x".repeat(MAX_ERROR_MESSAGE_LENGTH + 5000)),
    });

    expect((recorded[0]!.parameters[MESSAGE_PARAMETER] as string).length).toBe(
      MAX_ERROR_MESSAGE_LENGTH,
    );
  });

  it("bounds the stack as well", async () => {
    const recorded: Array<RecordedQuery> = [];

    const error: Error = new Error("boom");
    error.stack = "y".repeat(MAX_ERROR_STACK_LENGTH + 5000);

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error,
    });

    expect((recorded[0]!.parameters[STACK_PARAMETER] as string).length).toBe(
      MAX_ERROR_STACK_LENGTH,
    );
  });

  it("stamps the row with a version so an INSERT never relies on a column default", async () => {
    const recorded: Array<RecordedQuery> = [];

    await recordMigrationFailure(stubDataSource(recorded), {
      migrationName: "AddMonitorTable1790900000000",
      migrationType: MigrationFailureType.PostgresSchema,
      error: new Error("boom"),
    });

    expect(recorded[0]!.sql).toContain('"attemptedAt"');
    expect(recorded[0]!.sql).toContain('"hostName"');
    expect(recorded[0]!.sql).toContain('"appVersion"');
    // attemptedAt is bound, not defaulted, so the row is honest about when.
    expect(recorded[0]!.parameters[4]).toBeInstanceOf(Date);
  });

  describe("when the write itself fails", () => {
    /*
     * The case this module was written for. On a first rollout the
     * "MigrationFailure" table does not exist yet, so the very run that most
     * needs the original migration error to survive is the run where this
     * INSERT throws.
     */
    it("swallows the error rather than masking the migration failure", async () => {
      const failure: Promise<boolean> = recordMigrationFailure(
        throwingDataSource(
          new Error('relation "MigrationFailure" does not exist'),
        ),
        {
          migrationName: "AddMonitorTable1790900000000",
          migrationType: MigrationFailureType.PostgresSchema,
          error: new Error("the real migration error"),
        },
      );

      await expect(failure).resolves.toBe(false);
    });

    it("reports false rather than a silent success", async () => {
      /*
       * The return value is how a caller can tell the diagnostic landed. A
       * swallowed error that still returned true would make a lost row
       * indistinguishable from a written one.
       */
      const wrote: boolean = await recordMigrationFailure(
        throwingDataSource(new Error("connection terminated")),
        {
          migrationName: "AddMonitorTable1790900000000",
          migrationType: MigrationFailureType.PostgresSchema,
          error: new Error("the real migration error"),
        },
      );

      expect(wrote).toBe(false);
    });

    it("does not throw even when building the row would", async () => {
      // A rejection whose String() throws — the ugliest input available.
      const hostile: unknown = {
        toString: (): string => {
          throw new Error("cannot stringify");
        },
      };

      const recorded: Array<RecordedQuery> = [];

      await expect(
        recordMigrationFailure(stubDataSource(recorded), {
          migrationName: "AddMonitorTable1790900000000",
          migrationType: MigrationFailureType.PostgresSchema,
          error: hostile,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("MigrationFailureType", () => {
  it("stores each runner verbatim, since the value is persisted", () => {
    /*
     * These strings live in rows that outlive any deployment. Renaming one
     * orphans every row already written under the old value.
     */
    expect(MigrationFailureType.PostgresSchema).toBe("PostgresSchema");
    expect(MigrationFailureType.DataMigration).toBe("DataMigration");
  });
});
