/*
 * What a backup run is and where it stands (BackupRun): a backup of the
 * instance's databases, or a restore of one. Written by the Enterprise
 * Edition's runner as it goes, read by the Admin Dashboard's Backups page.
 */

export enum BackupRunKind {
  Backup = "backup",
  Restore = "restore",
}

export enum BackupRunTrigger {
  // On the schedule (BackupSetting).
  Scheduled = "scheduled",
  // A master admin's Back up now, or the restore they started.
  Manual = "manual",
  // Taken by a restore before it replaced anything.
  BeforeRestore = "before-restore",
  /*
   * Found at the destination with no run of this installation behind it: a
   * backup made before a restore, or by the installation this one replaces.
   */
  FoundAtDestination = "found-at-destination",
}

export enum BackupRunStatus {
  Queued = "queued",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Cancelled = "cancelled",
}

export const AllBackupRunStatuses: ReadonlyArray<BackupRunStatus> = [
  BackupRunStatus.Queued,
  BackupRunStatus.Running,
  BackupRunStatus.Succeeded,
  BackupRunStatus.Failed,
  BackupRunStatus.Cancelled,
];

export function isBackupRunActive(
  status: BackupRunStatus | string | undefined | null,
): boolean {
  return (
    status === BackupRunStatus.Queued || status === BackupRunStatus.Running
  );
}

export function isBackupRunFinished(
  status: BackupRunStatus | string | undefined | null,
): boolean {
  return (
    status === BackupRunStatus.Succeeded ||
    status === BackupRunStatus.Failed ||
    status === BackupRunStatus.Cancelled
  );
}

// The steps of a run, in the order they run. A run lists only the ones it takes.
export enum BackupStepKey {
  // A backup.
  CheckDestination = "check-destination",
  BackUpPostgres = "back-up-postgres",
  BackUpClickhouse = "back-up-clickhouse",
  VerifyBackup = "verify-backup",
  DeleteOldBackups = "delete-old-backups",
  // A restore.
  CheckBackup = "check-backup",
  BackUpCurrentData = "back-up-current-data",
  RestorePostgres = "restore-postgres",
  RestoreClickhouse = "restore-clickhouse",
  SwitchOver = "switch-over",
  UpgradeRestoredData = "upgrade-restored-data",
  CleanUp = "clean-up",
}

export enum BackupStepStatus {
  Pending = "pending",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Skipped = "skipped",
}

export interface BackupStepProgress {
  // Bytes written or read so far, and the total when it is known.
  doneBytes?: number | undefined;
  totalBytes?: number | undefined;
  // ClickHouse counts what it copies in files.
  doneFiles?: number | undefined;
  totalFiles?: number | undefined;
}

export interface BackupStep {
  key: BackupStepKey;
  status: BackupStepStatus;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  // What happened, in a sentence a person reads; never a credential.
  message?: string | undefined;
  progress?: BackupStepProgress | undefined;
}

export const BACKUP_STEP_KEYS: ReadonlyArray<BackupStepKey> = [
  BackupStepKey.CheckDestination,
  BackupStepKey.BackUpPostgres,
  BackupStepKey.BackUpClickhouse,
  BackupStepKey.VerifyBackup,
  BackupStepKey.DeleteOldBackups,
];

export const RESTORE_STEP_KEYS: ReadonlyArray<BackupStepKey> = [
  BackupStepKey.CheckBackup,
  BackupStepKey.BackUpCurrentData,
  BackupStepKey.RestorePostgres,
  BackupStepKey.RestoreClickhouse,
  BackupStepKey.SwitchOver,
  BackupStepKey.UpgradeRestoredData,
  BackupStepKey.CleanUp,
];

function isStepKey(value: unknown): value is BackupStepKey {
  return (
    typeof value === "string" &&
    (Object.values(BackupStepKey) as Array<string>).includes(value)
  );
}

function isStepStatus(value: unknown): value is BackupStepStatus {
  return (
    typeof value === "string" &&
    (Object.values(BackupStepStatus) as Array<string>).includes(value)
  );
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/*
 * The steps a row holds, as the page draws them: anything that is not a
 * step of this product (a newer release's step, a damaged value) is left
 * out rather than drawn as an empty line.
 */
export function readBackupSteps(value: unknown): Array<BackupStep> {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: Array<BackupStep> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;

    if (!isStepKey(record["key"]) || !isStepStatus(record["status"])) {
      continue;
    }

    const step: BackupStep = {
      key: record["key"],
      status: record["status"],
    };

    const startedAt: string | undefined = readText(record["startedAt"]);
    const finishedAt: string | undefined = readText(record["finishedAt"]);
    const message: string | undefined = readText(record["message"]);

    if (startedAt) {
      step.startedAt = startedAt;
    }

    if (finishedAt) {
      step.finishedAt = finishedAt;
    }

    if (message) {
      step.message = message;
    }

    const progressValue: unknown = record["progress"];

    if (
      progressValue &&
      typeof progressValue === "object" &&
      !Array.isArray(progressValue)
    ) {
      const progressRecord: Record<string, unknown> = progressValue as Record<
        string,
        unknown
      >;
      const progress: BackupStepProgress = {};
      const doneBytes: number | undefined = readCount(
        progressRecord["doneBytes"],
      );
      const totalBytes: number | undefined = readCount(
        progressRecord["totalBytes"],
      );
      const doneFiles: number | undefined = readCount(
        progressRecord["doneFiles"],
      );
      const totalFiles: number | undefined = readCount(
        progressRecord["totalFiles"],
      );

      if (doneBytes !== undefined) {
        progress.doneBytes = doneBytes;
      }
      if (totalBytes !== undefined) {
        progress.totalBytes = totalBytes;
      }
      if (doneFiles !== undefined) {
        progress.doneFiles = doneFiles;
      }
      if (totalFiles !== undefined) {
        progress.totalFiles = totalFiles;
      }

      if (Object.keys(progress).length > 0) {
        step.progress = progress;
      }
    }

    steps.push(step);
  }

  return steps;
}

// The step a running run is on: the one running, else the first not done yet.
export function getCurrentBackupStep(
  steps: Array<BackupStep>,
): BackupStep | undefined {
  return (
    steps.find((step: BackupStep): boolean => {
      return step.status === BackupStepStatus.Running;
    }) ||
    steps.find((step: BackupStep): boolean => {
      return step.status === BackupStepStatus.Pending;
    })
  );
}

// The step a failed run stopped on.
export function getFailedBackupStep(
  steps: Array<BackupStep>,
): BackupStep | undefined {
  return steps.find((step: BackupStep): boolean => {
    return step.status === BackupStepStatus.Failed;
  });
}
