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

import BackupRunner, {
  BackupOutcome,
} from "../../../Server/Backup/BackupRunner";
import BackupScheduler, {
  BACKUP_LICENSE_REQUIRED_MESSAGE,
  BACKUP_SHUTDOWN_HANDLER_NAME,
  STALE_RUN_AFTER_IN_MS,
} from "../../../Server/Backup/BackupScheduler";
import RestoreRunner from "../../../Server/Backup/RestoreRunner";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import GracefulShutdown from "Common/Server/Utils/GracefulShutdown";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
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
  MINIO_FINGERPRINT,
  runRow,
  silenceLogger,
  stepStatuses,
  useBackupTables,
} from "./Fakes/BackupTestBed";
import {
  FakeClickhouseEngine,
  FakePostgresEngine,
} from "./Fakes/FakeBackupEngines";
import MemoryBackupStorage from "./Fakes/MemoryBackupStorage";

/*
 * What runs backups: the every-minute tick, which - while it holds the
 * instance's one backup lock - fails the runs whose worker stopped, queues
 * the scheduled backup once it is due, and starts the oldest queued run;
 * one run at a time, a restore whatever the license says, a new backup
 * only while the license includes backups.
 */

const NOW: Date = new Date("2026-10-25T02:00:30.000Z");

describe("BackupScheduler", () => {
  let tables: BackupTables;
  let storage: MemoryBackupStorage;
  let backupRunner: BackupRunner;
  let restoreRunner: { run: jest.Mock; recoverInterrupted: jest.Mock };
  let isActive: boolean;
  let lockTaken: number;
  let lockReleased: number;
  let lockAvailable: boolean;
  let failures: Array<{ kind: BackupRunKind; error: string }>;
  let scheduler: BackupScheduler;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);

    tables = useBackupTables();
    storage = new MemoryBackupStorage();
    backupRunner = new BackupRunner({
      postgres: new FakePostgresEngine().asEngine(),
      clickhouse: new FakeClickhouseEngine(storage).asEngine(),
      createStorage: () => {
        return storage;
      },
      now: (): Date => {
        return NOW;
      },
    });
    restoreRunner = {
      run: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
      recoverInterrupted: jest.fn(async (): Promise<string> => {
        return "OneUptime stopped while the restore ran (it may have been restarted). Nothing was changed.";
      }),
    };
    isActive = true;
    lockTaken = 0;
    lockReleased = 0;
    lockAvailable = true;
    failures = [];

    jest
      .spyOn(GracefulShutdown, "registerHandler")
      .mockImplementation((): void => {
        return undefined;
      });

    scheduler = new BackupScheduler({
      backupRunner,
      restoreRunner: restoreRunner as unknown as RestoreRunner,
      now: (): Date => {
        return NOW;
      },
      isBackupsActive: (): boolean => {
        return isActive;
      },
      lock: async () => {
        if (!lockAvailable) {
          return null;
        }

        lockTaken++;

        return {
          release: async (): Promise<void> => {
            lockReleased++;
          },
        };
      },
      notifyFailure: async (data: { kind: BackupRunKind; error: string }) => {
        failures.push({ kind: data.kind, error: data.error });
        return null;
      },
    });
  });

  afterEach(async () => {
    await scheduler.waitForCurrentRun();
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function runs(): Array<StoredRow> {
    return tables.runs.rows;
  }

  describe("the scheduled backup", () => {
    test("once it is due: queued, the next one moved on, and started", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );
      const run: jest.SpiedFunction<typeof backupRunner.run> = jest.spyOn(
        backupRunner,
        "run",
      );

      await scheduler.tick();
      await scheduler.waitForCurrentRun();

      expect(runs()).toHaveLength(1);
      expect(runs()[0]).toEqual(
        expect.objectContaining({
          kind: BackupRunKind.Backup,
          trigger: BackupRunTrigger.Scheduled,
          includesPostgres: true,
          includesClickhouse: true,
        }),
      );
      expect(run).toHaveBeenCalledTimes(1);
      expect(runs()[0]!["status"]).toBe(BackupRunStatus.Succeeded);
      expect(
        new Date(
          tables.settings.rows[0]!["nextBackupAt"] as Date,
        ).toISOString(),
      ).toBe("2026-10-26T02:00:00.000Z");
    });

    test("holds the lock while it runs, and gives it back when it is done", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );

      await scheduler.tick();

      expect(lockTaken).toBe(1);
      expect(scheduler.getCurrentRunId()).toBe(String(runs()[0]!["_id"]));

      await scheduler.waitForCurrentRun();

      expect(lockReleased).toBe(1);
      expect(scheduler.getCurrentRunId()).toBeNull();
    });

    test("before it is due: nothing is queued, and the lock goes back at once", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-26T02:00:00.000Z",
      );

      await scheduler.tick();

      expect(runs()).toEqual([]);
      expect(lockReleased).toBe(1);
    });

    test("with ClickHouse left out of the backups, the backup holds PostgreSQL alone", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );
      tables.settings.rows[0]!["includesClickhouse"] = false;

      await scheduler.queueScheduledBackup();

      expect(runs()[0]!["includesClickhouse"]).toBe(false);
    });

    test("with backups turned off, nothing is queued", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );
      tables.settings.rows[0]!["isEnabled"] = false;

      expect(await scheduler.queueScheduledBackup()).toBeNull();
      expect(runs()).toEqual([]);
    });

    test("while the license does not include backups, nothing is queued", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );
      isActive = false;

      expect(await scheduler.queueScheduledBackup()).toBeNull();
      expect(runs()).toEqual([]);
    });

    test("without a next time yet, the next time is set and nothing runs now", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = null;

      expect(await scheduler.queueScheduledBackup()).toBeNull();
      expect(runs()).toEqual([]);
      expect(
        new Date(
          tables.settings.rows[0]!["nextBackupAt"] as Date,
        ).toISOString(),
      ).toBe("2026-10-26T02:00:00.000Z");
    });

    test("due while another run is waiting: waits for its next time, and is not queued twice", async () => {
      tables.settings.rows[0]!["nextBackupAt"] = new Date(
        "2026-10-25T02:00:00.000Z",
      );
      tables.runs.rows.push(runRow({ status: BackupRunStatus.Queued }));

      expect(await scheduler.queueScheduledBackup()).toBeNull();
      expect(runs()).toHaveLength(1);
      expect(
        new Date(
          tables.settings.rows[0]!["nextBackupAt"] as Date,
        ).toISOString(),
      ).toBe("2026-10-26T02:00:00.000Z");
    });

    test("without backup settings, nothing is queued", async () => {
      tables.settings.rows.length = 0;

      expect(await scheduler.queueScheduledBackup()).toBeNull();
    });
  });

  describe("the next run", () => {
    test("is the oldest queued one", async () => {
      tables.runs.rows.push(
        runRow({
          _id: "11111111-1111-4111-8111-111111111111",
          createdAt: new Date("2026-10-25T01:00:00Z"),
        }),
        runRow({
          _id: "22222222-2222-4222-8222-222222222222",
          createdAt: new Date("2026-10-25T00:00:00Z"),
        }),
      );

      expect((await scheduler.claimNextRun())?.id?.toString()).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
    });

    test("waits while another runs: one run at a time on the whole instance", async () => {
      tables.runs.rows.push(
        runRow({ status: BackupRunStatus.Running, heartbeatAt: NOW }),
        runRow({ status: BackupRunStatus.Queued }),
      );

      expect(await scheduler.claimNextRun()).toBeNull();
    });

    test("a queued backup the license no longer allows fails with why; a restore runs whatever the license", async () => {
      isActive = false;
      tables.runs.rows.push(
        runRow({
          _id: "11111111-1111-4111-8111-111111111111",
          createdAt: new Date("2026-10-25T00:00:00Z"),
        }),
        runRow({
          _id: "22222222-2222-4222-8222-222222222222",
          kind: BackupRunKind.Restore,
          createdAt: new Date("2026-10-25T01:00:00Z"),
        }),
      );

      expect((await scheduler.claimNextRun())?.id?.toString()).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
      expect(tables.runs.get("11111111-1111-4111-8111-111111111111")).toEqual(
        expect.objectContaining({
          status: BackupRunStatus.Failed,
          error: BACKUP_LICENSE_REQUIRED_MESSAGE,
        }),
      );
    });

    test("a queued run a master admin cancelled is cancelled, never started", async () => {
      tables.runs.rows.push(
        runRow({
          _id: "11111111-1111-4111-8111-111111111111",
          cancelRequestedAt: NOW,
        }),
      );

      expect(await scheduler.claimNextRun()).toBeNull();
      expect(tables.runs.get("11111111-1111-4111-8111-111111111111")).toEqual(
        expect.objectContaining({
          status: BackupRunStatus.Cancelled,
          error: "Cancelled by a master admin before it started.",
        }),
      );
    });

    test("a restore is handed to the restore runner, with its row", async () => {
      tables.runs.rows.push(
        runRow({
          kind: BackupRunKind.Restore,
          restoredBackupRunId: ObjectID.generate().toString(),
        }),
      );

      await scheduler.tick();
      await scheduler.waitForCurrentRun();

      expect(restoreRunner.run).toHaveBeenCalledTimes(1);
      expect(
        (restoreRunner.run.mock.calls[0]![0] as { run: BackupRun }).run.kind,
      ).toBe(BackupRunKind.Restore);
    });
  });

  describe("while a run goes on", () => {
    test("another tick in this worker does nothing", async () => {
      let finish: () => void = (): void => {
        return undefined;
      };

      jest
        .spyOn(backupRunner, "run")
        .mockImplementation((): Promise<BackupOutcome | null> => {
          return new Promise<BackupOutcome | null>(
            (resolve: (value: BackupOutcome | null) => void) => {
              finish = (): void => {
                resolve(null);
              };
            },
          );
        });
      tables.runs.rows.push(runRow());

      await scheduler.tick();
      await scheduler.tick();

      expect(lockTaken).toBe(1);

      finish();
      await scheduler.waitForCurrentRun();
    });

    test("another worker without the lock does nothing", async () => {
      lockAvailable = false;
      tables.runs.rows.push(runRow());

      await scheduler.tick();

      expect(runs()[0]!["status"]).toBe(BackupRunStatus.Queued);
    });

    test("shutting the worker down stops the run", async () => {
      let signal: AbortSignal | undefined;
      let finish: () => void = (): void => {
        return undefined;
      };

      jest
        .spyOn(backupRunner, "run")
        .mockImplementation(
          (
            data: Parameters<BackupRunner["run"]>[0],
          ): Promise<BackupOutcome | null> => {
            signal = data.signal;

            return new Promise<BackupOutcome | null>(
              (resolve: (value: BackupOutcome | null) => void) => {
                finish = (): void => {
                  resolve(null);
                };
                data.signal?.addEventListener("abort", finish);
              },
            );
          },
        );
      tables.runs.rows.push(runRow());

      await scheduler.tick();

      const registered: jest.SpiedFunction<
        typeof GracefulShutdown.registerHandler
      > = GracefulShutdown.registerHandler as never;
      const handler: [string, unknown, () => Promise<void>] = registered.mock
        .calls[registered.mock.calls.length - 1] as never;

      expect(handler[0]).toBe(BACKUP_SHUTDOWN_HANDLER_NAME);

      await handler[2]();

      expect(signal?.aborted).toBe(true);
      await scheduler.waitForCurrentRun();
      expect(lockReleased).toBe(1);
    });
  });

  describe("after a run", () => {
    test("a backup that succeeded lets the next failure be told at once", async () => {
      tables.settings.rows[0]!["lastFailureNotifiedAt"] = new Date(
        "2026-10-24T22:00:00Z",
      );
      tables.runs.rows.push(runRow());

      await scheduler.tick();
      await scheduler.waitForCurrentRun();

      expect(
        tables.settings.rows[0]!["lastFailureNotifiedAt"] ?? null,
      ).toBeNull();
    });

    test("a backup that failed is told to the master admins", async () => {
      jest
        .spyOn(backupRunner, "run")
        .mockImplementation(
          async (
            data: Parameters<BackupRunner["run"]>[0],
          ): Promise<BackupOutcome | null> => {
            await data.onFailure?.("pg_dump failed: no space left on device.");
            return null;
          },
        );
      tables.runs.rows.push(runRow());

      await scheduler.tick();
      await scheduler.waitForCurrentRun();

      expect(failures).toEqual([
        {
          kind: BackupRunKind.Backup,
          error: "pg_dump failed: no space left on device.",
        },
      ]);
    });
  });

  describe("a run whose worker stopped", () => {
    test("a backup is failed, what it wrote deleted, its step failed and the rest skipped, and the admins told", async () => {
      const name: string = "20261025T013000Z-11111111";

      tables.runs.rows.push(
        runRow({
          _id: "11111111-1111-4111-8111-111111111111",
          status: BackupRunStatus.Running,
          name,
          startedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
          heartbeatAt: new Date(NOW.getTime() - STALE_RUN_AFTER_IN_MS - 1000),
          destinationFingerprint: MINIO_FINGERPRINT,
          steps: [
            {
              key: BackupStepKey.CheckDestination,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.BackUpPostgres,
              status: BackupStepStatus.Running,
            },
            {
              key: BackupStepKey.BackUpClickhouse,
              status: BackupStepStatus.Pending,
            },
          ],
        }),
      );
      storage.write(`${FOLDER}${name}/postgres.dump`, "PGDMP half");

      expect(await scheduler.recoverStaleRuns()).toBe(1);

      const row: StoredRow = tables.runs.get(
        "11111111-1111-4111-8111-111111111111",
      )!;

      expect(row["status"]).toBe(BackupRunStatus.Failed);
      expect(row["error"]).toBe(
        "OneUptime stopped while this backup ran (it may have been restarted). What it had written was deleted; the next backup runs on the schedule.",
      );
      expect(stepStatuses(row)).toEqual([
        "check-destination: succeeded",
        "back-up-postgres: failed",
        "back-up-clickhouse: skipped",
      ]);
      expect(storage.keysUnder(`${FOLDER}${name}/`)).toEqual([]);
      expect(failures).toEqual([
        { kind: BackupRunKind.Backup, error: row["error"] as string },
      ]);
    });

    test("a run whose worker still says it is alive is left alone", async () => {
      tables.runs.rows.push(
        runRow({
          status: BackupRunStatus.Running,
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          heartbeatAt: new Date(NOW.getTime() - 20 * 1000),
        }),
      );

      expect(await scheduler.recoverStaleRuns()).toBe(0);
      expect(runs()[0]!["status"]).toBe(BackupRunStatus.Running);
    });

    test("a restore is undone as far as it can be, and failed with what happened", async () => {
      tables.runs.rows.push(
        runRow({
          _id: "11111111-1111-4111-8111-111111111111",
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Running,
          heartbeatAt: new Date(NOW.getTime() - 10 * 60 * 1000),
          createdByUserId: ADMIN_USER_ID,
        }),
      );

      await scheduler.recoverStaleRuns();

      expect(restoreRunner.recoverInterrupted).toHaveBeenCalledTimes(1);
      expect(tables.runs.get("11111111-1111-4111-8111-111111111111")).toEqual(
        expect.objectContaining({
          status: BackupRunStatus.Failed,
          error:
            "OneUptime stopped while the restore ran (it may have been restarted). Nothing was changed.",
        }),
      );
      expect(failures[0]!.kind).toBe(BackupRunKind.Restore);
    });

    test("cleaning up that fails still fails the run, with why", async () => {
      restoreRunner.recoverInterrupted.mockImplementation(async () => {
        throw new Error("ClickHouse is down");
      });
      tables.runs.rows.push(
        runRow({
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Running,
          heartbeatAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        }),
      );

      await scheduler.recoverStaleRuns();

      expect(runs()[0]!["error"]).toBe(
        "OneUptime stopped while this ran, and cleaning up after it failed: ClickHouse is down.",
      );
    });
  });

  test("Back up now queues a manual backup for the master admin who asked", async () => {
    const run: BackupRun = await BackupScheduler.queueManualBackup({
      createdByUserId: new ObjectID(ADMIN_USER_ID),
      includesClickhouse: false,
    });

    expect(tables.runs.get(run.id!)).toEqual(
      expect.objectContaining({
        kind: BackupRunKind.Backup,
        trigger: BackupRunTrigger.Manual,
        status: BackupRunStatus.Queued,
        includesPostgres: true,
        includesClickhouse: false,
      }),
    );
    expect(String(tables.runs.get(run.id!)!["createdByUserId"])).toBe(
      ADMIN_USER_ID,
    );
  });
});
