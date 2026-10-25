import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BACKUP_POSTGRES_BIN_DIR_ENV,
  buildPostgresToolEnvironment,
  findPostgresToolSets,
  getPostgresMajor,
  parsePostgresToolVersion,
  pickPostgresToolSet,
  PostgresToolEnvironment,
  PostgresToolSet,
  StartedTool,
  startPostgresTool,
  summarizeToolError,
  ToolRun,
} from "../../../Server/Backup/Postgres/PostgresTools";
import { getSuffixedDatabaseName } from "../../../Server/Backup/Postgres/PostgresBackupEngine";

/*
 * PostgreSQL's own tools, found and run the way the backups run them: the
 * oldest pg_dump at least as new as the server, a clear sentence when none
 * fits, the connection in the tool's environment only (never its command
 * line), nothing else of the app's environment, and the tool's own error
 * as the reason it stopped. The tools here are small scripts standing in
 * for pg_dump and pg_restore; the Postgres suite runs the real ones.
 */

function toolSet(
  major: number,
  version: string = `${major}.4`,
): PostgresToolSet {
  return {
    directory: `/usr/lib/postgresql/${major}/bin`,
    major,
    version,
    pgDump: `/usr/lib/postgresql/${major}/bin/pg_dump`,
    pgRestore: `/usr/lib/postgresql/${major}/bin/pg_restore`,
  };
}

describe("PostgresTools", () => {
  let directory: string;
  let savedBinDir: string | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-backup-tools-test-"),
    );
    savedBinDir = process.env[BACKUP_POSTGRES_BIN_DIR_ENV];
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });

    if (savedBinDir === undefined) {
      delete process.env[BACKUP_POSTGRES_BIN_DIR_ENV];
    } else {
      process.env[BACKUP_POSTGRES_BIN_DIR_ENV] = savedBinDir;
    }
  });

  function script(name: string, body: string): string {
    const file: string = path.join(directory, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  }

  test.each<[string, { major: number; version: string } | null]>([
    ["pg_dump (PostgreSQL) 16.4", { major: 16, version: "16.4" }],
    [
      "pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)",
      { major: 17, version: "17.2" },
    ],
    ["pg_dump (PostgreSQL) 18beta1", { major: 18, version: "18beta1" }],
    ["pg_dump (PostgreSQL) 9.6.24", { major: 9, version: "9.6.24" }],
    ["something else", null],
    ["pg_dump (PostgreSQL) ", null],
  ])(
    "%s reads as %p",
    (output: string, expected: { major: number; version: string } | null) => {
      expect(parsePostgresToolVersion(output)).toEqual(expected);
    },
  );

  test("a server's major version comes from server_version_num", () => {
    expect(getPostgresMajor(150004)).toBe(15);
    expect(getPostgresMajor(180001)).toBe(18);
    expect(getPostgresMajor(90624)).toBe(9);
  });

  describe("picking the tools for a server", () => {
    const sets: Array<PostgresToolSet> = [
      toolSet(16),
      toolSet(17),
      toolSet(18),
    ];

    test("the oldest set at least as new as the server", () => {
      expect(
        pickPostgresToolSet({ toolSets: sets, serverMajor: 15 }).major,
      ).toBe(16);
      expect(
        pickPostgresToolSet({ toolSets: sets, serverMajor: 17 }).major,
      ).toBe(17);
    });

    test("for a restore, one that also reads the archive's version", () => {
      expect(
        pickPostgresToolSet({
          toolSets: sets,
          serverMajor: 16,
          atLeastMajor: 18,
        }).major,
      ).toBe(18);
    });

    test("none at all: says the Enterprise image carries them, and what to do on another", () => {
      expect(() => {
        return pickPostgresToolSet({ toolSets: [], serverMajor: 16 });
      }).toThrow(
        "pg_dump and pg_restore are not installed where OneUptime runs. The Enterprise image carries them; on another image, install the PostgreSQL client tools or set BACKUP_POSTGRES_BIN_DIR.",
      );
    });

    test("none new enough: names the newest there is", () => {
      expect(() => {
        return pickPostgresToolSet({ toolSets: sets, serverMajor: 19 });
      }).toThrow(
        "PostgreSQL 19 needs pg_dump 19 or newer, and the newest here is 18.4. Update OneUptime, or set BACKUP_POSTGRES_BIN_DIR to newer PostgreSQL client tools.",
      );
    });
  });

  test("finds a set of tools in BACKUP_POSTGRES_BIN_DIR, by the version pg_dump says", async () => {
    script("pg_dump", 'echo "pg_dump (PostgreSQL) 21.1"');
    script("pg_restore", 'echo "pg_restore (PostgreSQL) 21.1"');
    process.env[BACKUP_POSTGRES_BIN_DIR_ENV] = directory;

    const found: Array<PostgresToolSet> = await findPostgresToolSets();
    const ours: PostgresToolSet | undefined = found.find(
      (set: PostgresToolSet): boolean => {
        return set.directory === directory;
      },
    );

    expect(ours).toEqual({
      directory,
      major: 21,
      version: "21.1",
      pgDump: path.join(directory, "pg_dump"),
      pgRestore: path.join(directory, "pg_restore"),
    });
    // Oldest first.
    expect(
      found.map((set: PostgresToolSet): number => {
        return set.major;
      }),
    ).toEqual(
      [
        ...found.map((set: PostgresToolSet): number => {
          return set.major;
        }),
      ].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
  });

  test("a directory with pg_dump but no pg_restore is not a set", async () => {
    script("pg_dump", 'echo "pg_dump (PostgreSQL) 22.0"');
    process.env[BACKUP_POSTGRES_BIN_DIR_ENV] = directory;

    expect(
      (await findPostgresToolSets()).some((set: PostgresToolSet): boolean => {
        return set.directory === directory;
      }),
    ).toBe(false);
  });

  describe("the tool's environment", () => {
    test("names the server, the user and the password, and nothing else of the app's", () => {
      process.env["ONEUPTIME_SECRET_FOR_THE_TEST"] = "do-not-pass-me";

      const environment: PostgresToolEnvironment = buildPostgresToolEnvironment(
        {
          host: "postgres",
          port: 5432,
          user: "oneuptime",
          password: "pg-password",
          database: "oneuptimedb",
        },
      );

      try {
        expect(environment.env).toEqual(
          expect.objectContaining({
            PGHOST: "postgres",
            PGPORT: "5432",
            PGUSER: "oneuptime",
            PGPASSWORD: "pg-password",
            PGDATABASE: "oneuptimedb",
            PGAPPNAME: "oneuptime-backup",
          }),
        );
        expect(
          environment.env["ONEUPTIME_SECRET_FOR_THE_TEST"],
        ).toBeUndefined();
        expect(environment.env["PGSSLMODE"]).toBeUndefined();
      } finally {
        delete process.env["ONEUPTIME_SECRET_FOR_THE_TEST"];
        environment.cleanUp();
      }
    });

    test("speaks TLS as the app does, its certificates in files only this process reads, removed afterwards", () => {
      const environment: PostgresToolEnvironment = buildPostgresToolEnvironment(
        {
          host: "db.example.com",
          port: 5432,
          user: "oneuptime",
          password: "pg-password",
          database: "oneuptimedb",
          ssl: {
            rejectUnauthorized: true,
            ca: "CA PEM",
            cert: "CERT PEM",
            key: "KEY PEM",
          },
        },
      );

      const ca: string = environment.env["PGSSLROOTCERT"]!;

      expect(environment.env["PGSSLMODE"]).toBe("verify-full");
      expect(fs.readFileSync(ca, "utf8")).toBe("CA PEM");
      expect(fs.statSync(ca).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(ca)).mode & 0o777).toBe(0o700);
      expect(fs.readFileSync(environment.env["PGSSLKEY"]!, "utf8")).toBe(
        "KEY PEM",
      );

      environment.cleanUp();

      expect(fs.existsSync(path.dirname(ca))).toBe(false);
    });

    test("TLS without checking the certificate is require", () => {
      const environment: PostgresToolEnvironment = buildPostgresToolEnvironment(
        {
          host: "db",
          port: 5432,
          user: "u",
          password: "p",
          database: "d",
          ssl: { rejectUnauthorized: false },
        },
      );

      expect(environment.env["PGSSLMODE"]).toBe("require");
      environment.cleanUp();
    });
  });

  describe("running a tool", () => {
    test("its stdout is the caller's stream, and its environment is the one it was given", async () => {
      const binary: string = script(
        "tool",
        'printf "%s" "$PGPASSWORD|$HOME_FOR_TEST"',
      );
      const tool: StartedTool = startPostgresTool({
        binary,
        args: [],
        env: { PATH: process.env["PATH"], PGPASSWORD: "pg-password" },
        stdin: "ignore",
        stdout: "pipe",
      });

      let output: string = "";
      tool.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });

      const run: ToolRun = await tool.done;

      expect(run.exitCode).toBe(0);
      expect(output).toBe("pg-password|");
    });

    test("a tool that fails says why in its own words, its error line first", async () => {
      const binary: string = script(
        "tool",
        'echo "pg_dump: warning: something minor" >&2\necho "pg_dump: error: connection to server at \\"postgres\\" failed: FATAL:  password authentication failed for user \\"oneuptime\\"" >&2\nexit 1',
      );
      const run: ToolRun = await startPostgresTool({
        binary,
        args: [],
        env: { PATH: process.env["PATH"] },
        stdin: "ignore",
        stdout: "ignore",
      }).done;

      expect(run.exitCode).toBe(1);
      expect(summarizeToolError(run.stderr)).toBe(
        'pg_dump: error: connection to server at "postgres" failed: FATAL:  password authentication failed for user "oneuptime"',
      );
    });

    test("a tool that is not there says so, without throwing", async () => {
      const run: ToolRun = await startPostgresTool({
        binary: path.join(directory, "missing"),
        args: [],
        env: {},
        stdin: "ignore",
        stdout: "ignore",
      }).done;

      expect(run.exitCode).not.toBe(0);
      expect(run.stderr).toContain("ENOENT");
    });

    test("a cancelled run stops the tool", async () => {
      // One process, as pg_dump is: the shell becomes the sleep.
      const binary: string = script("tool", "exec sleep 30");
      const controller: AbortController = new AbortController();
      const tool: StartedTool = startPostgresTool({
        binary,
        args: [],
        env: { PATH: process.env["PATH"] },
        stdin: "ignore",
        stdout: "ignore",
        signal: controller.signal,
      });

      controller.abort();

      const run: ToolRun = await tool.done;

      expect(run.signal).toBe("SIGTERM");
    });

    test("summarizeToolError takes the last line when the tool printed no error line", () => {
      expect(summarizeToolError("\n  first\n  last line  \n")).toBe(
        "last line",
      );
      expect(summarizeToolError("")).toBe("");
    });
  });

  test("a restore's database names stay within PostgreSQL's 63 bytes, cut on the original's side", () => {
    expect(getSuffixedDatabaseName("oneuptimedb", "_restore_3f2a9c1b")).toBe(
      "oneuptimedb_restore_3f2a9c1b",
    );

    const long: string = getSuffixedDatabaseName(
      "d".repeat(60),
      "_before_restore_3f2a9c1b",
    );

    expect(Buffer.byteLength(long, "utf8")).toBeLessThanOrEqual(63);
    expect(long.endsWith("_before_restore_3f2a9c1b")).toBe(true);
  });
});
