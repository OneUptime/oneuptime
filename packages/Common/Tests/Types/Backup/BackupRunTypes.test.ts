import { describe, expect, test } from "@jest/globals";
import {
  AllBackupRunStatuses,
  BACKUP_STEP_KEYS,
  BackupRunStatus,
  BackupStep,
  BackupStepKey,
  BackupStepStatus,
  RESTORE_STEP_KEYS,
  getCurrentBackupStep,
  getFailedBackupStep,
  isBackupRunActive,
  isBackupRunFinished,
  readBackupSteps,
} from "../../../Types/Backup/BackupRunTypes";

/*
 * A run's steps as the Backups page reads them from the row: what the
 * runner wrote, and nothing it did not (a newer release's step, a damaged
 * value) drawn as an empty line.
 */

describe("BackupRunTypes", () => {
  test("a run is active while queued or running, and finished once it succeeded, failed or was cancelled", () => {
    expect(
      AllBackupRunStatuses.filter((status: BackupRunStatus): boolean => {
        return isBackupRunActive(status);
      }),
    ).toEqual([BackupRunStatus.Queued, BackupRunStatus.Running]);
    expect(
      AllBackupRunStatuses.filter((status: BackupRunStatus): boolean => {
        return isBackupRunFinished(status);
      }),
    ).toEqual([
      BackupRunStatus.Succeeded,
      BackupRunStatus.Failed,
      BackupRunStatus.Cancelled,
    ]);
    expect(isBackupRunActive(undefined)).toBe(false);
    expect(isBackupRunFinished(null)).toBe(false);
  });

  test("a backup's steps and a restore's are separate, and each in the order it runs", () => {
    expect(BACKUP_STEP_KEYS).toEqual([
      BackupStepKey.CheckDestination,
      BackupStepKey.BackUpPostgres,
      BackupStepKey.BackUpClickhouse,
      BackupStepKey.VerifyBackup,
      BackupStepKey.DeleteOldBackups,
    ]);
    expect(RESTORE_STEP_KEYS).toEqual([
      BackupStepKey.CheckBackup,
      BackupStepKey.BackUpCurrentData,
      BackupStepKey.RestorePostgres,
      BackupStepKey.RestoreClickhouse,
      BackupStepKey.SwitchOver,
      BackupStepKey.UpgradeRestoredData,
      BackupStepKey.CleanUp,
    ]);
    expect(
      BACKUP_STEP_KEYS.filter((key: BackupStepKey): boolean => {
        return RESTORE_STEP_KEYS.includes(key);
      }),
    ).toEqual([]);
    expect([...BACKUP_STEP_KEYS, ...RESTORE_STEP_KEYS].sort()).toEqual(
      Object.values(BackupStepKey).sort(),
    );
  });

  describe("readBackupSteps", () => {
    test("reads every part of a step the runner writes", () => {
      expect(
        readBackupSteps([
          {
            key: "back-up-postgres",
            status: "running",
            startedAt: "2026-10-24T02:00:01.000Z",
            message: "pg_dump 16.4",
            progress: { doneBytes: 1024, totalBytes: 4096 },
          },
          {
            key: "back-up-clickhouse",
            status: "succeeded",
            startedAt: "2026-10-24T02:00:02.000Z",
            finishedAt: "2026-10-24T02:00:04.000Z",
            progress: { doneFiles: 12, totalFiles: 40 },
          },
        ]),
      ).toEqual([
        {
          key: BackupStepKey.BackUpPostgres,
          status: BackupStepStatus.Running,
          startedAt: "2026-10-24T02:00:01.000Z",
          message: "pg_dump 16.4",
          progress: { doneBytes: 1024, totalBytes: 4096 },
        },
        {
          key: BackupStepKey.BackUpClickhouse,
          status: BackupStepStatus.Succeeded,
          startedAt: "2026-10-24T02:00:02.000Z",
          finishedAt: "2026-10-24T02:00:04.000Z",
          progress: { doneFiles: 12, totalFiles: 40 },
        },
      ]);
    });

    test("leaves out what is not a step of this product", () => {
      expect(
        readBackupSteps([
          null,
          "check-destination",
          [],
          { key: "upload-to-tape", status: "running" },
          { key: "check-destination", status: "half-done" },
          { key: "check-destination", status: "pending" },
        ]),
      ).toEqual([
        {
          key: BackupStepKey.CheckDestination,
          status: BackupStepStatus.Pending,
        },
      ]);
    });

    test("leaves out a progress it cannot read, and the parts of one that are not counts", () => {
      expect(
        readBackupSteps([
          {
            key: "verify-backup",
            status: "running",
            progress: { doneBytes: -5, totalBytes: "4096", doneFiles: 3 },
          },
          { key: "verify-backup", status: "running", progress: [1, 2] },
          {
            key: "verify-backup",
            status: "running",
            progress: { doneBytes: NaN },
          },
        ]),
      ).toEqual([
        {
          key: BackupStepKey.VerifyBackup,
          status: BackupStepStatus.Running,
          progress: { doneFiles: 3 },
        },
        { key: BackupStepKey.VerifyBackup, status: BackupStepStatus.Running },
        { key: BackupStepKey.VerifyBackup, status: BackupStepStatus.Running },
      ]);
    });

    test("anything but a list holds no steps", () => {
      expect(readBackupSteps(undefined)).toEqual([]);
      expect(readBackupSteps({ key: "check-destination" })).toEqual([]);
      expect(readBackupSteps("[]")).toEqual([]);
    });
  });

  test("the current step is the one running, else the first waiting", () => {
    const steps: Array<BackupStep> = [
      {
        key: BackupStepKey.CheckDestination,
        status: BackupStepStatus.Succeeded,
      },
      { key: BackupStepKey.BackUpPostgres, status: BackupStepStatus.Pending },
      { key: BackupStepKey.BackUpClickhouse, status: BackupStepStatus.Running },
    ];

    expect(getCurrentBackupStep(steps)?.key).toBe(
      BackupStepKey.BackUpClickhouse,
    );
    expect(getCurrentBackupStep(steps.slice(0, 2))?.key).toBe(
      BackupStepKey.BackUpPostgres,
    );
    expect(getCurrentBackupStep(steps.slice(0, 1))).toBeUndefined();
  });

  test("the failed step is the one a failed run stopped on", () => {
    expect(
      getFailedBackupStep([
        { key: BackupStepKey.CheckBackup, status: BackupStepStatus.Succeeded },
        { key: BackupStepKey.RestorePostgres, status: BackupStepStatus.Failed },
        { key: BackupStepKey.SwitchOver, status: BackupStepStatus.Skipped },
      ])?.key,
    ).toBe(BackupStepKey.RestorePostgres);
    expect(getFailedBackupStep([])).toBeUndefined();
  });
});
