import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { Readable } from "stream";
import PostgresBackupEngine, {
  PostgresServerInfo,
} from "../../../Server/Backup/Postgres/PostgresBackupEngine";
import { BackupUploadResult } from "../../../Server/Backup/Storage/BackupStorage";
import PostgresAdminConnection, {
  PostgresAdminClient,
  PostgresConnectionTarget,
  PostgresRow,
} from "Common/Server/Infrastructure/Postgres/PostgresAdminConnection";
import ObjectID from "Common/Types/ObjectID";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * POSTGRESQL'S HALF OF A BACKUP AND A RESTORE, ON A REAL SERVER WITH THE
 * REAL pg_dump AND pg_restore: a database dumped while it is in use,
 * streamed into the storage (nothing on disk), read back by pg_restore,
 * restored into a new database beside the live one (byte for byte the
 * archive that was written), and switched in - the live one renamed aside
 * with the connections to it ended - then dropped.
 *
 * Opt in with RUN_POSTGRES_BACKUP_TESTS=true against a server whose user
 * may create databases (CI's is a superuser), e.g. from ee/:
 *
 *   RUN_POSTGRES_BACKUP_TESTS=true \
 *   BACKUP_TEST_DATABASE_HOST=127.0.0.1 BACKUP_TEST_DATABASE_PORT=5400 \
 *   DATABASE_USERNAME=postgres DATABASE_PASSWORD=... \
 *   node node_modules/.bin/jest Tests/Server/Backup/PostgresBackupEnginePostgres.test.ts \
 *     --selectProjects server --runInBand --forceExit
 *
 * The tools are found as in production (BACKUP_POSTGRES_BIN_DIR, then the
 * distributions' directories, then PATH). CI runs it in
 * .github/workflows/postgres-schema-drift.yaml. Everything runs in
 * databases of its own, dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_BACKUP_TESTS"] === "true"
    ? describe
    : describe.skip;

const SUFFIX: string = ObjectID.generate()
  .toString()
  .split("-")
  .join("")
  .slice(0, 8);
const LIVE: string = `backup_test_live_${SUFFIX}`;
const RESTORED: string = `backup_test_restore_${SUFFIX}`;
const SET_ASIDE: string = `backup_test_before_restore_${SUFFIX}`;

function target(database: string): PostgresConnectionTarget {
  return {
    host: process.env["BACKUP_TEST_DATABASE_HOST"] || "127.0.0.1",
    port: Number(process.env["BACKUP_TEST_DATABASE_PORT"] || 5400),
    user: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "",
    database,
  };
}

async function onDatabase<T>(
  database: string,
  run: (client: PostgresAdminClient) => Promise<T>,
): Promise<T> {
  return await PostgresAdminConnection.withClient(target(database), run);
}

async function count(database: string, table: string): Promise<number> {
  return await onDatabase(database, async (client: PostgresAdminClient) => {
    const rows: Array<PostgresRow> = await client.query(
      `SELECT count(*)::int AS count FROM public.${PostgresAdminConnection.quoteIdentifier(table)}`,
    );
    return Number(rows[0]!["count"]);
  });
}

async function databases(): Promise<Array<string>> {
  return await onDatabase("postgres", async (client: PostgresAdminClient) => {
    const rows: Array<PostgresRow> = await client.query(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname",
      [`backup_test_%_${SUFFIX}`],
    );
    return rows.map((row: PostgresRow): string => {
      return String(row["datname"]);
    });
  });
}

describePostgres("PostgresBackupEngine on a real PostgreSQL", () => {
  const storage: MemoryBackupStorage = new MemoryBackupStorage();
  const engine: PostgresBackupEngine = new PostgresBackupEngine({
    target: target(LIVE),
  });
  let uploaded: BackupUploadResult;

  beforeAll(async () => {
    await onDatabase("postgres", async (client: PostgresAdminClient) => {
      await client.query(`CREATE DATABASE "${LIVE}"`);
    });

    await onDatabase(LIVE, async (client: PostgresAdminClient) => {
      for (const table of ["Project", "User", "Monitor", "StatusPage"]) {
        await client.query(
          `CREATE TABLE public."${table}" ("_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(100), "deletedAt" timestamptz)`,
        );
      }

      await client.query(
        'CREATE TABLE public.migrations (id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)',
      );
      await client.query(
        "INSERT INTO public.migrations (\"timestamp\", name) VALUES (1807110000000, 'AddAuditLogExports1807110000000'), (1807450000000, 'AddBackups1807450000000')",
      );
      await client.query(
        `INSERT INTO public."Project" (name) VALUES ('Acme'), ('Globex')`,
      );
      await client.query(
        `INSERT INTO public."Project" (name, "deletedAt") VALUES ('Deleted', now())`,
      );
      await client.query(`INSERT INTO public."User" (name) VALUES ('Ada')`);
      await client.query(
        `INSERT INTO public."Monitor" (name) SELECT 'Monitor ' || n FROM generate_series(1, 3) n`,
      );
      await client.query(
        `INSERT INTO public."StatusPage" (name) VALUES ('Status')`,
      );
      // Enough rows that the dump is more than its table of contents.
      await client.query(
        'CREATE TABLE public."Telemetry" (id bigserial PRIMARY KEY, body text NOT NULL)',
      );
      await client.query(
        `INSERT INTO public."Telemetry" (body) SELECT md5(n::text) || repeat('x', 200) FROM generate_series(1, 20000) n`,
      );
    });
  }, 120000);

  afterAll(async () => {
    for (const name of await databases()) {
      await engine.dropDatabase(name);
    }
  }, 120000);

  test("reads the server: its version, the database, its size and encoding, and what the user may do", async () => {
    const info: PostgresServerInfo = await engine.getServerInfo();

    expect(info.major).toBeGreaterThanOrEqual(12);
    expect(info.version).toMatch(/^\d+(\.\d+)?/);
    expect(info.database).toBe(LIVE);
    expect(info.sizeInBytes).toBeGreaterThan(1024 * 1024);
    expect(info.encoding).toBe("UTF8");
    expect(info.isSuperuser || info.canCreateDatabases).toBe(true);
  });

  test("counts what people recognise, without the deleted, and names the last migration", async () => {
    expect(await engine.getContents()).toEqual({
      counts: { projects: 2, users: 1, monitors: 3, statusPages: 1 },
      lastMigration: "AddBackups1807450000000",
    });
  });

  test("dumps the database straight into the storage, in pg_dump's custom format", async () => {
    const dump: Awaited<ReturnType<PostgresBackupEngine["dump"]>> =
      await engine.dump({
        upload: async (source: Readable): Promise<BackupUploadResult> => {
          return await storage.upload({
            key: "b/postgres.dump",
            source,
            contentType: "application/octet-stream",
          });
        },
      });

    uploaded = dump.result;

    const stored: Buffer = storage.objects.get("b/postgres.dump")!.body;

    expect(stored.subarray(0, 5).toString("latin1")).toBe("PGDMP");
    expect(dump.result.sizeInBytes).toBe(stored.length);
    expect(dump.result.sha256).toBe(
      createHash("sha256").update(stored).digest("hex"),
    );
    expect(Number(dump.toolVersion.split(".")[0])).toBeGreaterThanOrEqual(
      dump.serverInfo.major,
    );
  }, 120000);

  test("pg_restore reads the archive back from the storage", async () => {
    expect(
      await engine.readArchiveContents({
        source: (await storage.download("b/postgres.dump")).stream,
      }),
    ).toBeGreaterThan(5);
  }, 60000);

  test("pg_restore refuses what is not an archive, in its own words", async () => {
    await expect(
      engine.readArchiveContents({
        source: Readable.from([Buffer.from("not a dump")]),
      }),
    ).rejects.toThrow("pg_restore could not read the backup");
  }, 60000);

  test("restores beside the live database, byte for byte the archive written, while the live one moves on", async () => {
    await onDatabase(LIVE, async (client: PostgresAdminClient) => {
      await client.query(
        `INSERT INTO public."Project" (name) VALUES ('Made after the backup')`,
      );
    });

    await engine.createDatabase({ name: RESTORED, encoding: "UTF8" });

    const restored: { sha256: string; bytes: number } =
      await engine.restoreInto({
        database: RESTORED,
        source: (await storage.download("b/postgres.dump")).stream,
      });

    expect(restored).toEqual({
      sha256: uploaded.sha256,
      bytes: uploaded.sizeInBytes,
    });
    expect((await engine.getContents(RESTORED)).counts).toEqual({
      projects: 2,
      users: 1,
      monitors: 3,
      statusPages: 1,
    });
    expect(await count(RESTORED, "Telemetry")).toBe(20000);
    expect((await engine.getContents()).counts.projects).toBe(3);
  }, 180000);

  test("a restore whose archive breaks half way says so, and is not a database to switch to", async () => {
    const broken: string = `backup_test_broken_${SUFFIX}`;
    const archive: Buffer = storage.objects.get("b/postgres.dump")!.body;

    await engine.createDatabase({ name: broken, encoding: "UTF8" });

    const source: Readable = new Readable({
      read(): void {
        this.push(archive.subarray(0, Math.floor(archive.length / 2)));
        this.destroy(
          new Error("the storage stopped sending in the middle of an answer"),
        );
      },
    });

    await expect(
      engine.restoreInto({ database: broken, source }),
    ).rejects.toThrow(/could not be read from the storage|pg_restore failed/);

    await engine.dropDatabase(broken);
  }, 120000);

  test("switches the restored database in: the live one aside, the connections to it ended, the backup's data live", async () => {
    // A connection to the live database, as OneUptime's pool holds one.
    let held: Promise<unknown> | null = null;
    let ended: string | null = null;

    held = onDatabase(LIVE, async (client: PostgresAdminClient) => {
      try {
        await client.query("SELECT pg_sleep(20)");
      } catch (error) {
        ended = error instanceof Error ? error.message : String(error);
      }
    });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 500);
    });

    await engine.switchOver({
      live: LIVE,
      restored: RESTORED,
      setAside: SET_ASIDE,
    });
    await held;

    expect(ended).not.toBeNull();
    expect((await engine.getContents()).counts.projects).toBe(2);
    expect((await engine.getContents(SET_ASIDE)).counts.projects).toBe(3);
    expect(await databases()).toEqual([LIVE, SET_ASIDE].sort());

    // The set-aside database takes connections again, for whoever needs it back.
    expect(await count(SET_ASIDE, "Project")).toBe(4);
  }, 120000);

  test("a switch that cannot be made keeps the current database, taking connections", async () => {
    await expect(
      engine.switchOver({
        live: LIVE,
        restored: `backup_test_missing_${SUFFIX}`,
        setAside: `backup_test_aside2_${SUFFIX}`,
      }),
    ).rejects.toThrow("The current database was kept.");

    expect((await engine.getContents()).counts.projects).toBe(2);
    expect(await engine.databaseExists(LIVE)).toBe(true);
  }, 120000);

  test("drops a database the backups made, whoever is connected to it", async () => {
    await engine.dropDatabase(SET_ASIDE);

    expect(await engine.databaseExists(SET_ASIDE)).toBe(false);
    expect(await databases()).toEqual([LIVE]);
  }, 120000);
});
