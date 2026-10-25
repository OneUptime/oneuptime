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

import BackupRunRecorder, {
  BackupRunCancelledError,
  HEARTBEAT_INTERVAL_IN_MS,
} from "../../../Server/Backup/BackupRunRecorder";
import BackupRunService from "Common/Server/Services/BackupRunService";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import {
  BACKUP_STEP_KEYS,
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
  runRow,
  silenceLogger,
  stepOf,
  stepStatuses,
  useBackupTables,
} from "./Fakes/BackupTestBed";

/*
 * A run as the Backups page follows it: its row written as each step
 * starts and ends, progress at most every few seconds, a heartbeat that
 * says the worker is alive, a cancel read from the row - and the row
 * written again when a restore switched to data that does not have it.
 */

const RUN_ID: string = "8ba7b811-9dad-41d1-80b4-00c04fd43101";

describe("BackupRunRecorder", () => {
  let tables: BackupTables;
  let recorder: BackupRunRecorder;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);
    tables = useBackupTables({ runs: [runRow({ _id: RUN_ID })] });
    recorder = new BackupRunRecorder({
      identity: {
        id: new ObjectID(RUN_ID),
        kind: BackupRunKind.Restore,
        trigger: BackupRunTrigger.Manual,
        includesPostgres: true,
        includesClickhouse: true,
        createdByUserId: new ObjectID(ADMIN_USER_ID),
        restoredBackupRunId: new ObjectID(
          "8ba7b812-9dad-41d1-80b4-00c04fd43101",
        ),
      },
      stepKeys: BACKUP_STEP_KEYS,
    });
  });

  afterEach(() => {
    recorder.stopHeartbeat();
    jest.useRealTimers();
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function row(): StoredRow {
    return tables.runs.get(RUN_ID)!;
  }

  test("a started run is running, every step waiting", async () => {
    await recorder.start();

    expect(row()["status"]).toBe(BackupRunStatus.Running);
    expect(row()["startedAt"]).toBeDefined();
    expect(stepStatuses(row())).toEqual([
      "check-destination: pending",
      "back-up-postgres: pending",
      "back-up-clickhouse: pending",
      "verify-backup: pending",
      "delete-old-backups: pending",
    ]);
  });

  test("a step that succeeds keeps when it ran and what it said; one that fails, its error, thrown on", async () => {
    await recorder.start();

    expect(
      await recorder.runStep(BackupStepKey.CheckDestination, async () => {
        return { value: 7, message: "The destination answers." };
      }),
    ).toBe(7);

    await expect(
      recorder.runStep(BackupStepKey.BackUpPostgres, async () => {
        throw new Error("pg_dump failed.");
      }),
    ).rejects.toThrow("pg_dump failed.");

    expect(stepOf(row(), BackupStepKey.CheckDestination)).toEqual(
      expect.objectContaining({
        status: BackupStepStatus.Succeeded,
        message: "The destination answers.",
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
      }),
    );
    expect(stepOf(row(), BackupStepKey.BackUpPostgres)).toEqual(
      expect.objectContaining({
        status: BackupStepStatus.Failed,
        message: "pg_dump failed.",
      }),
    );
  });

  test("progress is written at most every few seconds, not with every chunk", async () => {
    await recorder.start();
    await recorder.startStep(BackupStepKey.BackUpPostgres);
    const writes: number = tables.runs.updates.length;

    for (let index: number = 1; index <= 500; index++) {
      recorder.progress(BackupStepKey.BackUpPostgres, {
        doneBytes: index * 1024,
      });
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });

    expect(tables.runs.updates.length - writes).toBeLessThanOrEqual(1);

    // The step's end writes what it reached.
    await recorder.finishStep(
      BackupStepKey.BackUpPostgres,
      BackupStepStatus.Succeeded,
    );

    expect(stepOf(row(), BackupStepKey.BackUpPostgres)?.progress).toEqual({
      doneBytes: 500 * 1024,
    });
  });

  test("a finished run leaves no step waiting or running", async () => {
    await recorder.start();
    await recorder.startStep(BackupStepKey.CheckDestination);
    await recorder.finish(BackupRunStatus.Failed, {
      error: "The worker stopped.",
    });

    expect(row()["status"]).toBe(BackupRunStatus.Failed);
    expect(row()["error"]).toBe("The worker stopped.");
    expect(stepStatuses(row())).toEqual([
      "check-destination: failed",
      "back-up-postgres: skipped",
      "back-up-clickhouse: skipped",
      "verify-backup: skipped",
      "delete-old-backups: skipped",
    ]);
  });

  test("a heartbeat every 15 seconds says the worker is alive, and stops when the run does", async () => {
    const intervals: Array<{
      beat: () => void;
      ms: number;
      handle: Record<string, unknown>;
    }> = [];
    const cleared: Array<unknown> = [];

    jest.spyOn(global, "setInterval").mockImplementation(((
      beat: () => void,
      ms: number,
    ) => {
      const handle: Record<string, unknown> = {
        unref: (): void => {
          return undefined;
        },
      };
      intervals.push({ beat, ms, handle });
      return handle;
    }) as never);
    jest.spyOn(global, "clearInterval").mockImplementation(((
      handle: unknown,
    ) => {
      cleared.push(handle);
    }) as never);

    await recorder.start();

    expect(HEARTBEAT_INTERVAL_IN_MS).toBe(15000);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.ms).toBe(HEARTBEAT_INTERVAL_IN_MS);

    const writes: number = tables.runs.updates.length;

    // A beat: the row says when the worker was last alive.
    intervals[0]!.beat();
    await (recorder as unknown as { pendingWrite: Promise<void> }).pendingWrite;

    expect(tables.runs.updates.length).toBe(writes + 1);
    expect(
      tables.runs.updates[tables.runs.updates.length - 1]!.set["heartbeatAt"],
    ).toBeDefined();

    await recorder.finish(BackupRunStatus.Succeeded);

    expect(cleared).toEqual([intervals[0]!.handle]);
  });

  test("a cancel is read from the row, and stops the run", async () => {
    expect(await recorder.isCancelRequested()).toBe(false);

    tables.runs.rows[0]!["cancelRequestedAt"] = new Date();

    // Read at most every 5 seconds: a new recorder asks at once.
    const fresh: BackupRunRecorder = new BackupRunRecorder({
      identity: recorder.identity,
      stepKeys: BACKUP_STEP_KEYS,
    });

    await expect(fresh.throwIfCancelled()).rejects.toBeInstanceOf(
      BackupRunCancelledError,
    );
  });

  test("a row that cannot be written for a moment is no error: the run goes on", async () => {
    jest
      .spyOn(BackupRunService, "updateOneById")
      .mockImplementationOnce(async () => {
        throw new Error("Connection terminated");
      });

    await expect(recorder.start()).resolves.toBeUndefined();
  });

  describe("after a restore switched to data that does not have the run", () => {
    test("the row is written again, with everything it held, and who started it", async () => {
      await recorder.start({ name: "20261023T020000Z-8ba7b812" });
      await recorder.runStep(BackupStepKey.CheckDestination, async () => {
        return { value: undefined };
      });

      tables.runs.rows.length = 0;

      await recorder.reattach();

      expect(row()).toEqual(
        expect.objectContaining({
          kind: BackupRunKind.Restore,
          trigger: BackupRunTrigger.Manual,
          status: BackupRunStatus.Running,
          name: "20261023T020000Z-8ba7b812",
        }),
      );
      expect(String(row()["createdByUserId"])).toBe(ADMIN_USER_ID);
      expect(String(row()["restoredBackupRunId"])).toBe(
        "8ba7b812-9dad-41d1-80b4-00c04fd43101",
      );
      expect(stepOf(row(), BackupStepKey.CheckDestination)?.status).toBe(
        BackupStepStatus.Succeeded,
      );
    });

    test("a master admin the restored data does not know is left off it", async () => {
      await recorder.start();
      tables.runs.rows.length = 0;
      tables.users.rows.length = 0;

      await recorder.reattach();

      expect(row()["createdByUserId"] ?? null).toBeNull();
    });

    test("a row that is there is only brought up to date", async () => {
      await recorder.start();

      await recorder.reattach();

      expect(tables.runs.inserts).toHaveLength(0);
    });
  });
});
