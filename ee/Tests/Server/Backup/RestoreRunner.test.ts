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

import BackupRunner from "../../../Server/Backup/BackupRunner";
import {
  getBackupManifestKey,
  getBackupPostgresKey,
} from "../../../Server/Backup/BackupLayout";
import RestoreRunner, {
  readRestoreRunnerState,
  RestoreRunnerState,
} from "../../../Server/Backup/RestoreRunner";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
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
  ADMIN_USER_ID,
  BackupTables,
  FOLDER,
  runRow,
  silenceLogger,
  stepOf,
  stepStatuses,
  useBackupTables,
} from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * ONE RESTORE, STEP BY STEP: a backup made by the real BackupRunner, the
 * live data changed afterwards, then the real RestoreRunner - its run
 * recorder, preview and catalog sync on the real services, the databases
 * models behind their engines' methods (Fakes/FakeBackupEngines).
 *
 *   - a restore that succeeds puts the backup's data in place of the live
 *     data, PostgreSQL by a switch of two databases and ClickHouse under
 *     its own name, after a backup of the current data, and drops what it
 *     set aside only because that backup exists;
 *   - one that fails, is cancelled or stops half way leaves the live data
 *     as it was, or puts it back, and says so;
 *   - the live data is never touched before the backup was checked and
 *     the current data backed up.
 */

const NOW: Date = new Date("2026-10-24T02:00:00.000Z");

describe("RestoreRunner", () => {
  let tables: BackupTables;
  let storage: MemoryBackupStorage;
  let postgres: FakePostgresEngine;
  let clickhouse: FakeClickhouseEngine;
  let backupRunner: BackupRunner;
  let restoreRunner: RestoreRunner;
  let migrations: Array<string>;
  let reconciled: number;
  let clearedCaches: number;
  let backup: BackupRun;

  beforeEach(async () => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);

    tables = useBackupTables();
    storage = new MemoryBackupStorage();
    postgres = new FakePostgresEngine();
    clickhouse = new FakeClickhouseEngine(storage);
    migrations = [];
    reconciled = 0;
    clearedCaches = 0;

    backupRunner = new BackupRunner({
      postgres: postgres.asEngine(),
      clickhouse: clickhouse.asEngine(),
      createStorage: () => {
        return storage;
      },
      now: (): Date => {
        return NOW;
      },
    });
    restoreRunner = new RestoreRunner({
      backupRunner,
      migratePostgres: async (): Promise<Array<string>> => {
        return migrations;
      },
      reconcileClickhouse: async (): Promise<void> => {
        reconciled++;
        const live: { views: number } | undefined = clickhouse.databases.get(
          clickhouse.database,
        );

        if (live) {
          live.views = 3;
        }
      },
      clearCaches: async (): Promise<number> => {
        clearedCaches++;
        return 4;
      },
      now: (): Date => {
        return NOW;
      },
    });

    // The backup the restores go back to.
    backup = toRun(runRow({ trigger: BackupRunTrigger.Scheduled }));
    tables.runs.rows.push(
      runRow({
        _id: backup.id!.toString(),
        trigger: BackupRunTrigger.Scheduled,
      }),
    );
    expect(await backupRunner.run({ run: backup })).not.toBeNull();

    // The live data moves on after the backup.
    postgres.live()["Project"]!.push({ name: "Made after the backup" });
    clickhouse.databases.get("oneuptime")!.rows = 150000;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function toRun(row: StoredRow): BackupRun {
    const run: BackupRun = new BackupRun(new ObjectID(String(row["_id"])));
    run.kind = row["kind"] as BackupRunKind;
    run.trigger = row["trigger"] as BackupRunTrigger;
    run.status = row["status"] as BackupRunStatus;
    run.includesPostgres = row["includesPostgres"] as boolean;
    run.includesClickhouse = row["includesClickhouse"] as boolean;

    if (row["restoredBackupRunId"]) {
      run.restoredBackupRunId = new ObjectID(
        String(row["restoredBackupRunId"]),
      );
    }

    if (row["createdByUserId"]) {
      run.createdByUserId = new ObjectID(String(row["createdByUserId"]));
    }

    run.runnerState = (row["runnerState"] as JSONObject) || {};

    return run;
  }

  function queueRestore(overrides: StoredRow = {}): BackupRun {
    const row: StoredRow = runRow({
      kind: BackupRunKind.Restore,
      restoredBackupRunId: backup.id!.toString(),
      createdByUserId: ADMIN_USER_ID,
      runnerState: { takeBackupFirst: true },
      ...overrides,
    });
    tables.runs.rows.push(row);

    return toRun(row);
  }

  function projectNames(database: string = "oneuptimedb"): Array<string> {
    return (postgres.databases.get(database)?.["Project"] || []).map(
      (row: Record<string, unknown>): string => {
        return String(row["name"]);
      },
    );
  }

  function databaseNames(): Array<string> {
    return Array.from(postgres.databases.keys()).sort();
  }

  describe("a restore that succeeds", () => {
    test("goes through every step, and the live data is the backup's", async () => {
      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(true);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Succeeded);
      expect(stepStatuses(row)).toEqual([
        "check-backup: succeeded",
        "back-up-current-data: succeeded",
        "restore-postgres: succeeded",
        "restore-clickhouse: succeeded",
        "switch-over: succeeded",
        "upgrade-restored-data: succeeded",
        "clean-up: succeeded",
      ]);
      expect(projectNames()).toEqual(["Acme", "Globex"]);
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(100000);
    });

    test("backs the current data up first - a backup of its own, at the destination, before anything changes", async () => {
      const restore: BackupRun = queueRestore();
      await restoreRunner.run({ run: restore });

      const safety: StoredRow | undefined = tables.runs.rows.find(
        (row: StoredRow): boolean => {
          return row["trigger"] === BackupRunTrigger.BeforeRestore;
        },
      );

      expect(safety?.["status"]).toBe(BackupRunStatus.Succeeded);
      expect(String(safety?.["_id"])).toBe(
        String(tables.runs.get(restore.id!)!["safetyBackupRunId"]),
      );

      // Its dump is the data from just before the restore.
      const dump: Buffer = storage.objects.get(
        getBackupPostgresKey(FOLDER, String(safety!["name"])),
      )!.body;

      expect(dump.toString("utf8")).toContain("Made after the backup");
      expect(
        storage.objects.has(
          getBackupManifestKey(FOLDER, String(safety!["name"])),
        ),
      ).toBe(true);
    });

    test("drops the data it set aside, because the backup of it exists", async () => {
      await restoreRunner.run({ run: queueRestore() });

      expect(databaseNames()).toEqual(["oneuptimedb"]);
      expect(Array.from(clickhouse.databases.keys())).toEqual(["oneuptime"]);
    });

    test("brings the restored data up to this release: migrations, caches, ClickHouse's tables and views", async () => {
      migrations = ["AddSomething1808000000000"];
      const restore: BackupRun = queueRestore();

      await restoreRunner.run({ run: restore });

      expect(
        stepOf(tables.runs.get(restore.id!), BackupStepKey.UpgradeRestoredData)
          ?.message,
      ).toBe(
        "Applied 1 schema migration to PostgreSQL. Cleared 4 cached permissions. ClickHouse's tables and views are up to date.",
      );
      expect(clearedCaches).toBe(1);
      expect(reconciled).toBe(1);
      expect(clickhouse.databases.get("oneuptime")!.views).toBe(3);
    });

    test("drops the materialized views of what it sets aside at once, so they never write twice", async () => {
      const dropViews: jest.SpiedFunction<
        typeof clickhouse.dropMaterializedViews
      > = jest.spyOn(clickhouse, "dropMaterializedViews");

      await restoreRunner.run({ run: queueRestore() });

      expect(dropViews).toHaveBeenCalledTimes(1);
      expect(dropViews.mock.calls[0]![0]).toMatch(
        /^oneuptime_before_restore_[0-9a-f]{8}$/,
      );
      // Before the backup's telemetry is restored under the live name.
      expect(clickhouse.calls.indexOf("dropMaterializedViews")).toBeLessThan(
        clickhouse.calls.lastIndexOf("startRestore"),
      );
    });

    test("says what the restored PostgreSQL holds", async () => {
      const restore: BackupRun = queueRestore();
      await restoreRunner.run({ run: restore });

      expect(
        stepOf(tables.runs.get(restore.id!), BackupStepKey.RestorePostgres)
          ?.message,
      ).toBe("2 projects, 1 user, 3 monitors, 1 status page");
    });

    test("writes its own row again when the restored data does not have it, keeping who started it", async () => {
      const restore: BackupRun = queueRestore();
      const switchOver: typeof postgres.switchOver =
        postgres.switchOver.bind(postgres);

      // The restored database is the backup's: this restore's row is not in it.
      jest
        .spyOn(postgres, "switchOver")
        .mockImplementation(async (data: Parameters<typeof switchOver>[0]) => {
          await switchOver(data);
          tables.runs.rows.splice(
            tables.runs.rows.findIndex((row: StoredRow): boolean => {
              return String(row["_id"]) === restore.id!.toString();
            }),
            1,
          );
        });

      expect(await restoreRunner.run({ run: restore })).toBe(true);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["kind"]).toBe(BackupRunKind.Restore);
      expect(row["status"]).toBe(BackupRunStatus.Succeeded);
      expect(String(row["createdByUserId"])).toBe(ADMIN_USER_ID);
      expect(String(row["restoredBackupRunId"])).toBe(backup.id!.toString());
      expect(stepStatuses(row)).toHaveLength(7);
    });

    test("without a backup of the current data, keeps what it set aside and says where", async () => {
      const restore: BackupRun = queueRestore({
        runnerState: { takeBackupFirst: false },
      });

      expect(await restoreRunner.run({ run: restore })).toBe(true);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(stepOf(row, BackupStepKey.BackUpCurrentData)).toEqual(
        expect.objectContaining({
          status: BackupStepStatus.Skipped,
          message: "Skipped by the master admin who started the restore.",
        }),
      );
      expect(stepOf(row, BackupStepKey.CleanUp)?.message).toMatch(
        /^Kept the data from before the restore, as no backup of it was taken: oneuptimedb_before_restore_[0-9a-f]{8}, oneuptime_before_restore_[0-9a-f]{8}\. Drop it once you no longer need it\.$/,
      );
      expect(databaseNames()).toHaveLength(2);
      expect(projectNames(databaseNames()[1])).toContain(
        "Made after the backup",
      );
    });

    test("PostgreSQL alone: ClickHouse is not touched", async () => {
      const restore: BackupRun = queueRestore({ includesClickhouse: false });

      expect(await restoreRunner.run({ run: restore })).toBe(true);

      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
      expect(
        stepOf(tables.runs.get(restore.id!), BackupStepKey.RestoreClickhouse)
          ?.status,
      ).toBe(BackupStepStatus.Skipped);
      expect(projectNames()).toEqual(["Acme", "Globex"]);
    });

    test("ClickHouse alone: PostgreSQL is not touched, and there is nothing to switch", async () => {
      const restore: BackupRun = queueRestore({ includesPostgres: false });

      expect(await restoreRunner.run({ run: restore })).toBe(true);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(projectNames()).toContain("Made after the backup");
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(100000);
      expect(stepOf(row, BackupStepKey.SwitchOver)).toEqual(
        expect.objectContaining({
          status: BackupStepStatus.Skipped,
          message: "Only ClickHouse was restored: nothing to switch.",
        }),
      );
      expect(clearedCaches).toBe(0);
    });
  });

  describe("a restore that does not finish", () => {
    test("when pg_restore fails: the live data is untouched, what it made is dropped, and it says why", async () => {
      postgres.failures.set(
        "restoreInto",
        new Error(
          "pg_restore failed: pg_restore: error: could not execute query: ERROR: out of memory.",
        ),
      );
      const failures: Array<string> = [];
      const restore: BackupRun = queueRestore();

      expect(
        await restoreRunner.run({
          run: restore,
          onFailure: async (error: string) => {
            failures.push(error);
          },
        }),
      ).toBe(false);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Failed);
      expect(row["error"]).toContain("out of memory");
      expect(projectNames()).toContain("Made after the backup");
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
      expect(databaseNames()).toEqual(["oneuptimedb"]);
      expect(failures).toEqual([row["error"]]);
    });

    test("when the dump does not match its checksum: nothing is restored", async () => {
      const name: string = String(tables.runs.get(backup.id!)!["name"]);
      const key: string = getBackupPostgresKey(FOLDER, name);
      const stored: Buffer = storage.objects.get(key)!.body;

      // Changed at the destination after the backup, at the same size.
      storage.write(
        key,
        Buffer.from(stored.toString("utf8").split("Acme").join("Acmf")),
      );

      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(false);
      expect(tables.runs.get(restore.id!)!["error"]).toContain(
        "The PostgreSQL dump at the destination does not match the checksum it was written with",
      );
      expect(projectNames()).toContain("Made after the backup");
      expect(databaseNames()).toEqual(["oneuptimedb"]);
    });

    test("when ClickHouse's restore fails: the telemetry set aside is put back, views and all", async () => {
      const startRestore: typeof clickhouse.startRestore =
        clickhouse.startRestore.bind(clickhouse);

      jest
        .spyOn(clickhouse, "startRestore")
        .mockImplementation(
          async (data: Parameters<typeof startRestore>[0]) => {
            if (!data.structureOnly) {
              clickhouse.nextOperationError =
                "Code: 243. DB::Exception: Cannot reserve 1.00 MiB, not enough space (NOT_ENOUGH_SPACE)";
            }

            await startRestore(data);
          },
        );

      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(false);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["error"]).toContain("not enough space");
      expect(row["error"]).toContain(
        "ClickHouse's data from before the restore was put back.",
      );
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
      expect(clickhouse.databases.get("oneuptime")!.views).toBe(3);
      expect(Array.from(clickhouse.databases.keys())).toEqual(["oneuptime"]);
      expect(projectNames()).toContain("Made after the backup");
      expect(databaseNames()).toEqual(["oneuptimedb"]);
    });

    test("when the switch fails: ClickHouse is put back, and PostgreSQL stays as it was", async () => {
      postgres.failures.set(
        "switchOver",
        new Error(
          "Could not switch to the restored database: Connections to oneuptimedb did not close within 15 seconds. The current database was kept.",
        ),
      );

      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(false);

      expect(tables.runs.get(restore.id!)!["error"]).toContain(
        "did not close within 15 seconds",
      );
      expect(projectNames()).toContain("Made after the backup");
      expect(databaseNames()).toEqual(["oneuptimedb"]);
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
    });

    test("when the backup of the current data fails: nothing is restored", async () => {
      postgres.failures.set(
        "dump",
        new Error(
          "pg_dump failed: pg_dump: error: connection to server failed.",
        ),
      );

      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(false);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["error"]).toContain(
        "The backup of the current data failed, so nothing was restored:",
      );
      expect(stepOf(row, BackupStepKey.RestorePostgres)?.status).toBe(
        BackupStepStatus.Skipped,
      );
      expect(projectNames()).toContain("Made after the backup");
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
    });

    test("when a master admin cancels before the live data is touched: cancelled, nothing changed, nobody told", async () => {
      const failures: Array<string> = [];
      const restore: BackupRun = queueRestore({ cancelRequestedAt: NOW });

      expect(
        await restoreRunner.run({
          run: restore,
          onFailure: async (error: string) => {
            failures.push(error);
          },
        }),
      ).toBe(false);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(row["status"]).toBe(BackupRunStatus.Cancelled);
      expect(row["error"]).toBe(
        "The restore was cancelled. Nothing was changed.",
      );
      expect(projectNames()).toContain("Made after the backup");
      expect(failures).toEqual([]);
    });

    test("when the backup's manifest is gone: the check says so, and nothing is touched", async () => {
      const name: string = String(tables.runs.get(backup.id!)!["name"]);
      storage.objects.delete(getBackupManifestKey(FOLDER, name));

      const restore: BackupRun = queueRestore();

      expect(await restoreRunner.run({ run: restore })).toBe(false);

      const row: StoredRow = tables.runs.get(restore.id!)!;

      expect(stepOf(row, BackupStepKey.CheckBackup)?.status).toBe(
        BackupStepStatus.Failed,
      );
      expect(row["error"]).toContain("The backup's manifest is not at");
      expect(postgres.calls).not.toContain("createDatabase");
      expect(clickhouse.calls).not.toContain("renameDatabase");
    });

    test("when the backup row is gone: says so", async () => {
      const restore: BackupRun = queueRestore({
        restoredBackupRunId: ObjectID.generate().toString(),
      });

      expect(await restoreRunner.run({ run: restore })).toBe(false);
      expect(tables.runs.get(restore.id!)!["error"]).toBe(
        "The backup to restore no longer exists.",
      );
    });
  });

  describe("a restore whose worker stopped", () => {
    test("is undone as far as it went: the restore database dropped, ClickHouse put back", async () => {
      postgres.databases.set("oneuptimedb_restore_abcdef12", {});
      clickhouse.databases.set("oneuptime_before_restore_abcdef12", {
        rows: 150000,
        views: 0,
        tables: 20,
      });
      clickhouse.databases.set("oneuptime", { rows: 5, views: 0, tables: 20 });

      const run: BackupRun = new BackupRun(ObjectID.generate());
      run.runnerState = {
        postgresRestoreDatabase: "oneuptimedb_restore_abcdef12",
        clickhouseSetAsideDatabase: "oneuptime_before_restore_abcdef12",
        clickhouseRestored: false,
      };

      expect(await restoreRunner.recoverInterrupted(run)).toBe(
        "OneUptime stopped while the restore ran (it may have been restarted). Nothing was changed. ClickHouse's data from before the restore was put back.",
      );
      expect(databaseNames()).toEqual(["oneuptimedb"]);
      expect(clickhouse.databases.get("oneuptime")!.rows).toBe(150000);
      expect(reconciled).toBe(1);
    });

    test("after PostgreSQL was switched in, leaves the restored data where it is, and says to restart", async () => {
      const run: BackupRun = new BackupRun(ObjectID.generate());
      run.runnerState = {
        postgresSetAsideDatabase: "oneuptimedb_before_restore_abcdef12",
        postgresSwitched: true,
      };

      expect(await restoreRunner.recoverInterrupted(run)).toBe(
        "OneUptime stopped after the restored PostgreSQL was switched in; the rest of the restore did not run. Restart OneUptime so it brings the restored data up to this version.",
      );
      expect(postgres.calls).not.toContain("dropDatabase");
    });
  });

  test("the state a run records reads back as it was written, and nothing else", () => {
    const state: RestoreRunnerState = readRestoreRunnerState({
      takeBackupFirst: true,
      postgresRestoreDatabase: "db_restore_1",
      postgresSetAsideDatabase: "db_before_restore_1",
      postgresSwitched: true,
      clickhouseSetAsideDatabase: "ch_before_restore_1",
      clickhouseRestored: true,
      keptDatabases: ["db_before_restore_1", 7, null],
      unknown: "ignored",
    } as unknown as JSONObject);

    expect(state).toEqual({
      takeBackupFirst: true,
      postgresRestoreDatabase: "db_restore_1",
      postgresSetAsideDatabase: "db_before_restore_1",
      postgresSwitched: true,
      clickhouseSetAsideDatabase: "ch_before_restore_1",
      clickhouseRestored: true,
      keptDatabases: ["db_before_restore_1"],
    });
    expect(readRestoreRunnerState(null)).toEqual({});
    expect(readRestoreRunnerState({ takeBackupFirst: "yes" } as never)).toEqual(
      {
        takeBackupFirst: false,
        postgresSwitched: false,
        clickhouseRestored: false,
      },
    );
  });
});
