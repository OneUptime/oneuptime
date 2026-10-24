import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  BACKUP_TEST_FILE_NAME,
  BackupTestCheck,
  BackupTestCheckKey,
  BackupTestResult,
  testBackupDestination,
} from "../../../Server/Backup/BackupDestinationTest";
import { BackupStorageError } from "../../../Server/Backup/Storage/BackupStorage";
import { MINIO_SETTINGS, silenceLogger } from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * "Test the destination", before anything is saved: what a backup does,
 * done once and small - OneUptime writes, reads, lists and deletes a file;
 * pg_dump is checked against the server; ClickHouse writes a backup of its
 * tables' definitions - each check saying what it did or what to change,
 * and nothing left behind whichever stops it.
 */

describe("testBackupDestination", () => {
  let storage: MemoryBackupStorage;
  let postgres: FakePostgresEngine;
  let clickhouse: FakeClickhouseEngine;

  beforeEach(() => {
    silenceLogger();
    storage = new MemoryBackupStorage();
    postgres = new FakePostgresEngine();
    clickhouse = new FakeClickhouseEngine(storage);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function test_(
    includesClickhouse: boolean = true,
  ): Promise<BackupTestResult> {
    return await testBackupDestination({
      settings: MINIO_SETTINGS,
      storage,
      postgres: postgres.asEngine(),
      clickhouse: clickhouse.asEngine(),
      includesClickhouse,
    });
  }

  function check(
    result: BackupTestResult,
    key: BackupTestCheckKey,
  ): BackupTestCheck | undefined {
    return result.checks.find((candidate: BackupTestCheck): boolean => {
      return candidate.key === key;
    });
  }

  test("passes when OneUptime, pg_dump and ClickHouse can all do what a backup does, and says what each did", async () => {
    const result: BackupTestResult = await test_();

    expect(result.isSuccessful).toBe(true);
    expect(
      result.checks.map((item: BackupTestCheck): string => {
        return item.key;
      }),
    ).toEqual(["storage", "postgres", "clickhouse"]);
    expect(check(result, BackupTestCheckKey.Storage)?.message).toMatch(
      /^OneUptime wrote, read, listed and deleted a test file at memory:\/\/backups\/prod\/oneuptime-backup-test\/[0-9a-f-]+\/\.$/,
    );
    expect(check(result, BackupTestCheckKey.Postgres)?.message).toBe(
      "pg_dump 16.4 is ready for PostgreSQL 16.4.",
    );
    expect(check(result, BackupTestCheckKey.Clickhouse)?.message).toMatch(
      /^ClickHouse wrote a test backup \(its tables' definitions, no data\) to memory:\/\/backups\/prod\/oneuptime-backup-test\/[0-9a-f-]+\/clickhouse\/, then it was removed\.$/,
    );
  });

  test("leaves nothing at the destination", async () => {
    await test_();

    expect(Array.from(storage.objects.keys())).toEqual([]);
  });

  test("asks ClickHouse for a backup of its tables' definitions only", async () => {
    const startBackup: jest.SpiedFunction<typeof clickhouse.startBackup> =
      jest.spyOn(clickhouse, "startBackup");

    await test_();

    expect(startBackup).toHaveBeenCalledWith(
      expect.objectContaining({ structureOnly: true }),
    );
  });

  test("writes the test file under the backups' folder, with a name that says what it is", async () => {
    await test_();

    expect(
      storage.calls.find((call: string): boolean => {
        return call.startsWith("put ");
      }),
    ).toMatch(
      new RegExp(
        `^put prod/oneuptime-backup-test/[0-9a-f-]+/${BACKUP_TEST_FILE_NAME.split(".").join("\\.")}$`,
      ),
    );
  });

  test("a storage that refuses the write fails the storage check with its sentence, and ClickHouse is not asked", async () => {
    storage.failures.set(
      "putObject",
      new BackupStorageError(
        "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in oneuptime-backups/prod/.",
        { retryable: false, status: 403 },
      ),
    );

    const result: BackupTestResult = await test_();

    expect(result.isSuccessful).toBe(false);
    expect(check(result, BackupTestCheckKey.Storage)).toEqual({
      key: BackupTestCheckKey.Storage,
      isSuccessful: false,
      message:
        "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in oneuptime-backups/prod/.",
    });
    expect(check(result, BackupTestCheckKey.Clickhouse)).toBeUndefined();
    expect(clickhouse.calls).not.toContain("startBackup");
  });

  test("a storage that loses what it was given fails, and the file is removed", async () => {
    jest
      .spyOn(storage, "readSmallObject")
      .mockResolvedValue(Buffer.from("other"));

    const result: BackupTestResult = await test_();

    expect(check(result, BackupTestCheckKey.Storage)?.message).toMatch(
      /is not the one written\.$/,
    );
    expect(Array.from(storage.objects.keys())).toEqual([]);
  });

  test("a key that may not list fails the storage check: a backup could not find its old backups", async () => {
    jest
      .spyOn(storage, "list")
      .mockResolvedValue({ objects: [], prefixes: [] });

    const result: BackupTestResult = await test_();

    expect(check(result, BackupTestCheckKey.Storage)?.message).toMatch(
      /^The test file was written, but listing .* does not show it\.$/,
    );
  });

  test("a database user without CREATEDB passes, with the one change a restore needs", async () => {
    postgres.serverInfo = {
      ...postgres.serverInfo,
      user: "oneuptime",
      isSuperuser: false,
      canCreateDatabases: false,
    };

    expect(check(await test_(), BackupTestCheckKey.Postgres)).toEqual({
      key: BackupTestCheckKey.Postgres,
      isSuccessful: true,
      message:
        "pg_dump 16.4 is ready for PostgreSQL 16.4. Restoring needs one more thing: the database user oneuptime may not create databases (ALTER USER oneuptime CREATEDB;).",
    });
  });

  test("no pg_dump fails the PostgreSQL check with what to do", async () => {
    postgres.toolSets = [];

    const result: BackupTestResult = await test_();

    expect(result.isSuccessful).toBe(false);
    expect(check(result, BackupTestCheckKey.Postgres)?.message).toBe(
      "pg_dump and pg_restore are not installed where OneUptime runs. The Enterprise image carries them; on another image, install the PostgreSQL client tools or set BACKUP_POSTGRES_BIN_DIR.",
    );
  });

  test("ClickHouse refused by the storage fails its check with ClickHouse's words, and its files go", async () => {
    clickhouse.nextOperationError =
      "Code: 499. DB::Exception: The AWS Access Key Id you provided does not exist in our records. HTTP response code: 403 (S3_ERROR)";

    const result: BackupTestResult = await test_();

    expect(result.isSuccessful).toBe(false);
    expect(check(result, BackupTestCheckKey.Clickhouse)?.message).toContain(
      "ClickHouse said",
    );
    expect(Array.from(storage.objects.keys())).toEqual([]);
  });

  test("without ClickHouse in the backups, ClickHouse is not tested", async () => {
    const result: BackupTestResult = await test_(false);

    expect(
      result.checks.map((item: BackupTestCheck): string => {
        return item.key;
      }),
    ).toEqual(["storage", "postgres"]);
    expect(clickhouse.calls).toEqual([]);
  });
});
