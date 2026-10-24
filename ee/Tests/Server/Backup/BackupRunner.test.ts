import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import { createHash } from "crypto";
import BackupRunner from "../../../Server/Backup/BackupRunner";
import {
  getBackupFolderKey,
  getBackupManifestKey,
  getBackupPostgresKey,
} from "../../../Server/Backup/BackupLayout";
import { BackupStorageError } from "../../../Server/Backup/Storage/BackupStorage";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import BackupRunService from "Common/Server/Services/BackupRunService";
import Encryption from "Common/Server/Utils/Encryption";
import {
  BACKUP_ENCRYPTION_CHECK_TEXT,
  BackupManifest,
  getBackupName,
  isBackupName,
  parseBackupManifest,
} from "Common/Types/Backup/BackupManifest";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { StoredRow } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import {
  BACKUP_SECRET,
  BackupTables,
  FOLDER,
  MINIO_FINGERPRINT,
  runRow,
  silenceLogger,
  stepOf,
  stepStatuses,
  succeededBackupRow,
  useBackupTables,
} from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * ONE BACKUP, STEP BY STEP, as the Backups page follows it: the real
 * BackupRunner on the real run recorder and services (their rows in
 * memory), the destination a storage in memory, PostgreSQL and ClickHouse
 * models behind their engines' methods (Fakes/FakeBackupEngines).
 *
 *   - what a backup that succeeds leaves: the dump, ClickHouse's files and
 *     the manifest - written last - and a row with every step done;
 *   - what one that fails or is cancelled leaves: nothing at the
 *     destination, the step it stopped on and why;
 *   - the retention: old backups go (files, then row), never the newest
 *     that succeeded or one a restore reads; a retention that fails keeps
 *     the new backup.
 */

// A Saturday morning, as the run's clock reads it.
const NOW: Date = new Date("2026-10-24T02:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

describe("BackupRunner", () => {
  let tables: BackupTables;
  let storage: MemoryBackupStorage;
  let postgres: FakePostgresEngine;
  let clickhouse: FakeClickhouseEngine;
  let runner: BackupRunner;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);

    tables = useBackupTables();
    storage = new MemoryBackupStorage();
    postgres = new FakePostgresEngine();
    clickhouse = new FakeClickhouseEngine(storage);
    runner = new BackupRunner({
      postgres: postgres.asEngine(),
      clickhouse: clickhouse.asEngine(),
      createStorage: () => {
        return storage;
      },
      now: (): Date => {
        return NOW;
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function queue(overrides: StoredRow = {}): BackupRun {
    const row: StoredRow = runRow(overrides);
    tables.runs.rows.push(row);

    const run: BackupRun = new BackupRun(new ObjectID(String(row["_id"])));
    run.kind = row["kind"] as BackupRunKind;
    run.trigger = row["trigger"] as BackupRunTrigger;
    run.status = row["status"] as BackupRunStatus;
    run.includesPostgres = row["includesPostgres"] as boolean;
    run.includesClickhouse = row["includesClickhouse"] as boolean;

    return run;
  }

  function nameOf(run: BackupRun): string {
    return getBackupName({ startedAt: NOW, id: run.id!.toString() });
  }

  describe("a backup that succeeds", () => {
    test("goes through every step, in order, and says so on its row", async () => {
      const run: BackupRun = queue();

      expect(await runner.run({ run })).not.toBeNull();

      const row: StoredRow = tables.runs.get(run.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Succeeded);
      expect(stepStatuses(row)).toEqual([
        "check-destination: succeeded",
        "back-up-postgres: succeeded",
        "back-up-clickhouse: succeeded",
        "verify-backup: succeeded",
        "delete-old-backups: succeeded",
      ]);
      expect(stepOf(row, BackupStepKey.DeleteOldBackups)?.message).toBe(
        "No backup was older than the retention.",
      );
      expect(new Date(row["startedAt"] as Date).toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(row["finishedAt"]).toBeDefined();
      expect(row["error"] ?? null).toBeNull();
    });

    test("is named for when it started, and its row says where it is", async () => {
      const run: BackupRun = queue();
      await runner.run({ run });

      const row: StoredRow = tables.runs.get(run.id!)!;
      const name: string = nameOf(run);

      expect(isBackupName(name)).toBe(true);
      expect(name.startsWith("20261024T020000Z-")).toBe(true);
      expect(row["name"]).toBe(name);
      expect(row["location"]).toBe(`memory://backups/${FOLDER}${name}/`);
      expect(row["destinationFingerprint"]).toBe(MINIO_FINGERPRINT);
      expect(row["destinationType"]).toBe("s3-compatible");
    });

    test("leaves the dump, ClickHouse's files and the manifest at the destination - the manifest written last", async () => {
      const run: BackupRun = queue();
      await runner.run({ run });

      const name: string = nameOf(run);

      expect(storage.keysUnder(getBackupFolderKey(FOLDER, name))).toEqual([
        `${FOLDER}${name}/clickhouse/.backup`,
        `${FOLDER}${name}/clickhouse/data/parts.bin`,
        `${FOLDER}${name}/manifest.json`,
        `${FOLDER}${name}/postgres.dump`,
      ]);

      const writes: Array<string> = storage.calls.filter(
        (call: string): boolean => {
          return call.startsWith("put ") || call.startsWith("upload ");
        },
      );

      expect(writes[writes.length - 1]).toBe(
        `put ${getBackupManifestKey(FOLDER, name)}`,
      );
    });

    test("writes a manifest a restore and another installation can read: what it holds, how big, its checksum", async () => {
      const run: BackupRun = queue();
      await runner.run({ run });

      const name: string = nameOf(run);
      const dump: Buffer = storage.objects.get(
        getBackupPostgresKey(FOLDER, name),
      )!.body;
      const manifest: BackupManifest = parseBackupManifest(
        storage.objects
          .get(getBackupManifestKey(FOLDER, name))!
          .body.toString("utf8"),
      );

      expect(manifest.backupId).toBe(run.id!.toString());
      expect(manifest.name).toBe(name);
      expect(manifest.trigger).toBe(BackupRunTrigger.Manual);
      expect(manifest.startedAt).toBe(NOW.toISOString());
      expect(manifest.postgres).toEqual({
        file: "postgres.dump",
        format: "pg_dump-custom",
        sizeInBytes: dump.length,
        sha256: createHash("sha256").update(dump).digest("hex"),
        database: "oneuptimedb",
        serverVersion: "16.4",
        toolVersion: "16.4",
        lastMigration: "AddBackups1807120000000",
        counts: { projects: 2, users: 1, monitors: 3, statusPages: 1 },
      });
      expect(manifest.clickhouse).toEqual({
        folder: "clickhouse/",
        database: "oneuptime",
        serverVersion: "25.3.2.39",
        sizeInBytes:
          storage.objects.get(`${FOLDER}${name}/clickhouse/.backup`)!.body
            .length +
          storage.objects.get(`${FOLDER}${name}/clickhouse/data/parts.bin`)!
            .body.length,
        fileCount: 2,
      });

      // Encrypted with this installation's ENCRYPTION_SECRET, so a restore can tell.
      expect(await Encryption.decrypt(manifest.encryptionCheck!)).toBe(
        BACKUP_ENCRYPTION_CHECK_TEXT,
      );
    });

    test("records each database's size on its row, as the manifest does", async () => {
      const run: BackupRun = queue();
      await runner.run({ run });

      const row: StoredRow = tables.runs.get(run.id!)!;
      const manifest: JSONObject = row["manifest"] as JSONObject;

      expect(row["postgresSizeInBytes"]).toBe(
        (manifest["postgres"] as JSONObject)["sizeInBytes"],
      );
      expect(row["clickhouseSizeInBytes"]).toBe(
        (manifest["clickhouse"] as JSONObject)["sizeInBytes"],
      );
    });

    test("never writes the destination's secret to its row or its manifest", async () => {
      const run: BackupRun = queue();
      await runner.run({ run });

      expect(JSON.stringify(tables.runs.get(run.id!))).not.toContain(
        BACKUP_SECRET,
      );
      expect(
        storage.objects
          .get(getBackupManifestKey(FOLDER, nameOf(run)))!
          .body.toString("utf8"),
      ).not.toContain(BACKUP_SECRET);
    });

    test("a backup of PostgreSQL alone skips ClickHouse, and its manifest holds no ClickHouse", async () => {
      const run: BackupRun = queue({ includesClickhouse: false });
      await runner.run({ run });

      const row: StoredRow = tables.runs.get(run.id!)!;

      expect(stepOf(row, BackupStepKey.BackUpClickhouse)).toEqual(
        expect.objectContaining({
          status: BackupStepStatus.Skipped,
          message: "ClickHouse is not in the backups (Settings > Backups).",
        }),
      );
      expect(clickhouse.calls).not.toContain("startBackup");
      expect(
        parseBackupManifest(
          storage.objects
            .get(getBackupManifestKey(FOLDER, nameOf(run)))!
            .body.toString("utf8"),
        ).clickhouse,
      ).toBeUndefined();
    });
  });

  describe("a backup that fails", () => {
    async function runAndRead(
      run: BackupRun,
      onFailure?: (error: string) => Promise<void>,
    ): Promise<StoredRow> {
      expect(await runner.run({ run, onFailure })).toBeNull();
      return tables.runs.get(run.id!)!;
    }

    test("when pg_dump fails half way: nothing is left at the destination, and the step says why", async () => {
      postgres.dumpFailsAfterBytes = 10;
      const failures: Array<string> = [];
      const run: BackupRun = queue();

      const row: StoredRow = await runAndRead(run, async (error: string) => {
        failures.push(error);
      });

      expect(row["status"]).toBe(BackupRunStatus.Failed);
      expect(row["error"]).toContain("pg_dump failed");
      expect(stepStatuses(row)).toEqual([
        "check-destination: succeeded",
        "back-up-postgres: failed",
        "back-up-clickhouse: skipped",
        "verify-backup: skipped",
        "delete-old-backups: skipped",
      ]);
      expect(
        storage.keysUnder(getBackupFolderKey(FOLDER, nameOf(run))),
      ).toEqual([]);
      expect(failures).toEqual([row["error"]]);
    });

    test("when ClickHouse fails: its words, what to change, and nothing left behind", async () => {
      clickhouse.nextOperationError =
        "Code: 499. DB::Exception: Access Denied. HTTP response code: 403 (S3_ERROR)";
      const run: BackupRun = queue();

      const row: StoredRow = await runAndRead(run);

      expect(row["status"]).toBe(BackupRunStatus.Failed);
      expect(stepOf(row, BackupStepKey.BackUpClickhouse)?.status).toBe(
        BackupStepStatus.Failed,
      );
      expect(stepOf(row, BackupStepKey.BackUpClickhouse)?.message).toContain(
        "ClickHouse said",
      );
      expect(
        storage.keysUnder(getBackupFolderKey(FOLDER, nameOf(run))),
      ).toEqual([]);
    });

    test("when the dump at the destination is not the size written: the check fails", async () => {
      const head: typeof storage.headObject = storage.headObject.bind(storage);

      jest
        .spyOn(storage, "headObject")
        .mockImplementation(async (key: string) => {
          const object: Awaited<ReturnType<typeof head>> = await head(key);

          return object && key.endsWith("postgres.dump")
            ? { ...object, sizeInBytes: object.sizeInBytes - 1 }
            : object;
        });

      const row: StoredRow = await runAndRead(queue());

      expect(stepOf(row, BackupStepKey.VerifyBackup)?.status).toBe(
        BackupStepStatus.Failed,
      );
      expect(row["error"]).toMatch(
        /^The PostgreSQL dump at the destination is \d+ bytes; \d+ were written\.$/,
      );
    });

    test("when pg_restore cannot read the dump back: the check fails", async () => {
      postgres.failures.set(
        "readArchiveContents",
        new Error(
          "pg_restore could not read the backup: pg_restore: error: did not find magic string in file header.",
        ),
      );

      const row: StoredRow = await runAndRead(queue());

      expect(stepOf(row, BackupStepKey.VerifyBackup)?.status).toBe(
        BackupStepStatus.Failed,
      );
      expect(row["error"]).toContain("did not find magic string");
    });

    test("when ClickHouse's own record of the backup is missing: the check fails", async () => {
      const run: BackupRun = queue();
      const startBackup: typeof clickhouse.startBackup =
        clickhouse.startBackup.bind(clickhouse);

      jest
        .spyOn(clickhouse, "startBackup")
        .mockImplementation(async (data: Parameters<typeof startBackup>[0]) => {
          await startBackup(data);
          storage.objects.delete(`${data.folderKey}.backup`);
        });

      const row: StoredRow = await runAndRead(run);

      expect(row["error"]).toBe(
        "ClickHouse's own record of the backup (.backup) is not at the destination.",
      );
      expect(
        storage.keysUnder(getBackupFolderKey(FOLDER, nameOf(run))),
      ).toEqual([]);
    });

    test("when something is already where the backup goes: it overwrites and deletes nothing", async () => {
      const run: BackupRun = queue();
      const taken: string = `${getBackupFolderKey(FOLDER, nameOf(run))}someone-elses.bin`;
      storage.write(taken, "keep me");

      const row: StoredRow = await runAndRead(run);

      expect(row["error"]).toBe(
        `Something is already at memory://backups/${getBackupFolderKey(FOLDER, nameOf(run))}. Nothing was overwritten.`,
      );
      expect(storage.objects.get(taken)?.body.toString("utf8")).toBe("keep me");
      expect(postgres.calls).not.toContain("dump");
    });

    test("when no pg_dump fits the server: before anything is written, with what to do", async () => {
      postgres.toolSets = [];
      const run: BackupRun = queue();

      const row: StoredRow = await runAndRead(run);

      expect(stepOf(row, BackupStepKey.CheckDestination)?.status).toBe(
        BackupStepStatus.Failed,
      );
      expect(row["error"]).toContain(
        "pg_dump and pg_restore are not installed where OneUptime runs",
      );
      expect(
        storage.calls.some((call: string): boolean => {
          return call.startsWith("upload") || call.startsWith("put");
        }),
      ).toBe(false);
    });

    test("when the server's PostgreSQL is newer than every pg_dump here: says which versions there are", async () => {
      postgres.serverInfo = {
        ...postgres.serverInfo,
        versionNum: 190001,
        major: 19,
      };

      const row: StoredRow = await runAndRead(queue());

      expect(row["error"]).toBe(
        "PostgreSQL 19 needs pg_dump 19 or newer, and the newest here is 16.4. Update OneUptime, or set BACKUP_POSTGRES_BIN_DIR to newer PostgreSQL client tools.",
      );
    });

    test("when the storage refuses the upload: the storage's sentence, and the failure told", async () => {
      storage.failures.set(
        "upload",
        new BackupStorageError(
          "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in oneuptime-backups/prod/.",
          { retryable: false, status: 403 },
        ),
      );
      const failures: Array<string> = [];

      const row: StoredRow = await runAndRead(
        queue(),
        async (error: string) => {
          failures.push(error);
        },
      );

      expect(row["error"]).toBe(
        "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in oneuptime-backups/prod/.",
      );
      expect(failures).toHaveLength(1);
    });

    test("without backup settings: says to set a destination", async () => {
      tables.settings.rows.length = 0;

      const row: StoredRow = await runAndRead(queue());

      expect(row["status"]).toBe(BackupRunStatus.Failed);
      expect(row["error"]).toBe(
        "Backups are not set up. Set a destination in Settings > Backups.",
      );
    });

    test("a failure the notification cannot send still fails the run, quietly", async () => {
      postgres.dumpFailsAfterBytes = 0;

      const row: StoredRow = await runAndRead(queue(), async () => {
        throw new Error("SMTP is down");
      });

      expect(row["status"]).toBe(BackupRunStatus.Failed);
    });
  });

  describe("a backup that is cancelled", () => {
    test("by a master admin: stops at the next step, keeps nothing, and tells nobody", async () => {
      const run: BackupRun = queue({ cancelRequestedAt: NOW });
      const failures: Array<string> = [];

      expect(
        await runner.run({
          run,
          onFailure: async (error: string) => {
            failures.push(error);
          },
        }),
      ).toBeNull();

      const row: StoredRow = tables.runs.get(run.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Cancelled);
      expect(row["error"]).toBe(
        "The backup was cancelled. Nothing it wrote was kept.",
      );
      expect(
        storage.keysUnder(getBackupFolderKey(FOLDER, nameOf(run))),
      ).toEqual([]);
      expect(failures).toEqual([]);
    });

    test("by the worker shutting down (its signal): cancelled the same way", async () => {
      const controller: AbortController = new AbortController();
      controller.abort();

      expect(
        await runner.run({ run: queue(), signal: controller.signal }),
      ).toBeNull();

      expect(tables.runs.rows[0]!["status"]).toBe(BackupRunStatus.Cancelled);
    });
  });

  describe("the retention", () => {
    function seedBackup(daysAgo: number, overrides: StoredRow = {}): StoredRow {
      const startedAt: Date = new Date(NOW.getTime() - daysAgo * DAY);
      const row: StoredRow = succeededBackupRow({
        startedAt,
        name: getBackupName({ startedAt, id: ObjectID.generate().toString() }),
        overrides,
      });

      tables.runs.rows.push(row);
      storage.write(`${FOLDER}${row["name"]}/postgres.dump`, "PGDMP{}");
      storage.write(`${FOLDER}${row["name"]}/manifest.json`, "{}");

      return row;
    }

    test("deletes the backups older than 30 days - files, then row - and keeps the rest", async () => {
      const old: StoredRow = seedBackup(45);
      const older: StoredRow = seedBackup(31);
      const recent: StoredRow = seedBackup(10);
      const run: BackupRun = queue();

      await runner.run({ run });

      expect(tables.runs.get(String(old["_id"]))).toBeUndefined();
      expect(tables.runs.get(String(older["_id"]))).toBeUndefined();
      expect(tables.runs.get(String(recent["_id"]))).toBeDefined();
      expect(storage.keysUnder(`${FOLDER}${old["name"]}/`)).toEqual([]);
      expect(storage.keysUnder(`${FOLDER}${older["name"]}/`)).toEqual([]);
      expect(storage.keysUnder(`${FOLDER}${recent["name"]}/`)).toHaveLength(2);
      expect(
        stepOf(tables.runs.get(run.id!), BackupStepKey.DeleteOldBackups)
          ?.message,
      ).toBe("Deleted 2 backups older than 30 days.");
    });

    test("deletes old failed runs' rows too, without counting them as backups", async () => {
      const failed: StoredRow = seedBackup(40, {
        status: BackupRunStatus.Failed,
      });
      const run: BackupRun = queue();

      await runner.run({ run });

      expect(tables.runs.get(String(failed["_id"]))).toBeUndefined();
      expect(
        stepOf(tables.runs.get(run.id!), BackupStepKey.DeleteOldBackups)
          ?.message,
      ).toBe("No backup was older than the retention.");
    });

    test("never deletes a backup a restore is reading", async () => {
      const reading: StoredRow = seedBackup(60);
      tables.runs.rows.push(
        runRow({
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Queued,
          restoredBackupRunId: reading["_id"],
        }),
      );

      await runner.run({ run: queue() });

      expect(tables.runs.get(String(reading["_id"]))).toBeDefined();
      expect(storage.keysUnder(`${FOLDER}${reading["name"]}/`)).toHaveLength(2);
    });

    test("a backup at a previous destination loses its row, and its files there are left alone", async () => {
      const elsewhere: StoredRow = seedBackup(50, {
        destinationFingerprint: "another-destination",
      });

      await runner.run({ run: queue() });

      expect(tables.runs.get(String(elsewhere["_id"]))).toBeUndefined();
      expect(storage.keysUnder(`${FOLDER}${elsewhere["name"]}/`)).toHaveLength(
        2,
      );
    });

    test("a retention that fails keeps the new backup: the run succeeds, the step says what happened", async () => {
      seedBackup(45);
      storage.failures.set(
        "deleteObject",
        new BackupStorageError(
          "The storage is busy (HTTP 503). Try again later.",
          {
            retryable: true,
            status: 503,
          },
        ),
      );
      const run: BackupRun = queue();

      expect(await runner.run({ run })).not.toBeNull();

      const row: StoredRow = tables.runs.get(run.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Succeeded);
      expect(stepOf(row, BackupStepKey.DeleteOldBackups)).toEqual(
        expect.objectContaining({
          status: BackupStepStatus.Failed,
          message:
            "Could not delete the backups older than the retention: The storage is busy (HTTP 503). Try again later. This backup is kept; the old ones are deleted after the next backup.",
        }),
      );
      expect(
        storage.keysUnder(getBackupFolderKey(FOLDER, nameOf(run))),
      ).toHaveLength(4);
    });

    test("a backup taken before a restore deletes nothing", async () => {
      const old: StoredRow = seedBackup(45);
      const run: BackupRun = queue({ trigger: BackupRunTrigger.BeforeRestore });

      await runner.run({ run, isBeforeRestore: true });

      expect(
        stepOf(tables.runs.get(run.id!), BackupStepKey.DeleteOldBackups),
      ).toEqual(
        expect.objectContaining({
          status: BackupStepStatus.Skipped,
          message: "A backup taken before a restore deletes nothing.",
        }),
      );
      expect(tables.runs.get(String(old["_id"]))).toBeDefined();
    });

    test("with a retention of a day, yesterday's backup goes and the new one is the newest kept", async () => {
      tables.settings.rows[0]!["retentionInDays"] = 1;
      const yesterday: StoredRow = seedBackup(1.5);

      await runner.run({ run: queue() });

      expect(tables.runs.get(String(yesterday["_id"]))).toBeUndefined();
    });
  });

  test("a row that cannot be written for a moment stops nothing: the next write carries every step", async () => {
    const update: typeof BackupRunService.updateOneById =
      BackupRunService.updateOneById.bind(BackupRunService);
    let calls: number = 0;

    jest
      .spyOn(BackupRunService, "updateOneById")
      .mockImplementation(
        async (
          data: Parameters<typeof update>[0],
        ): ReturnType<typeof update> => {
          calls++;

          // The moment a restore switches databases: the write after the first step fails.
          if (calls === 3) {
            throw new Error("Connection terminated unexpectedly");
          }

          return await update(data);
        },
      );

    const run: BackupRun = queue();

    expect(await runner.run({ run })).not.toBeNull();
    expect(calls).toBeGreaterThan(3);
    expect(stepStatuses(tables.runs.get(run.id!))).toEqual([
      "check-destination: succeeded",
      "back-up-postgres: succeeded",
      "back-up-clickhouse: succeeded",
      "verify-backup: succeeded",
      "delete-old-backups: succeeded",
    ]);
  });

  test("a run that finished is never left with a step that reads as running or waiting", async () => {
    clickhouse.failures.set(
      "getServerVersion",
      new Error("ClickHouse is down"),
    );
    const run: BackupRun = queue();

    await runner.run({ run });

    expect(stepStatuses(tables.runs.get(run.id!))).toEqual([
      "check-destination: succeeded",
      "back-up-postgres: succeeded",
      "back-up-clickhouse: failed",
      "verify-backup: skipped",
      "delete-old-backups: skipped",
    ]);
  });
});
