import { BackupRunKind, BackupRunStatus } from "./BackupRunTypes";

/*
 * Which backups "Keep backups for N days" deletes: every backup that
 * started more than N days ago - finished ones only, never one still being
 * made, never one a restore is reading - except the newest one that
 * succeeded, which is kept however old it is. Backups that stopped (backups
 * turned off, a license that lapsed) therefore never leave the instance
 * without a backup to restore.
 *
 * Pure: the scheduler hands it the runs and the time, and deletes what it
 * names, at the destination and then the row.
 */

export interface BackupRetentionCandidate {
  id: string;
  kind: BackupRunKind;
  status: BackupRunStatus;
  // When it started, or was queued when it never started.
  startedAt: Date;
}

export interface BackupRetentionDecision {
  // To delete, oldest first.
  deleteIds: Array<string>;
  // Kept although older than the retention: the newest backup that succeeded.
  keptNewestSucceededId: string | null;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// The moment before which a backup is older than the retention.
export function getBackupRetentionCutoff(data: {
  retentionInDays: number;
  now: Date;
}): Date {
  const days: number =
    Number.isFinite(data.retentionInDays) && data.retentionInDays >= 1
      ? Math.floor(data.retentionInDays)
      : 1;

  return new Date(data.now.getTime() - days * DAY_IN_MS);
}

export function selectBackupsToDelete(data: {
  backups: Array<BackupRetentionCandidate>;
  retentionInDays: number;
  now: Date;
  // Backups a restore is reading (queued or running): never deleted.
  protectedIds?: Array<string> | undefined;
}): BackupRetentionDecision {
  const cutoff: Date = getBackupRetentionCutoff({
    retentionInDays: data.retentionInDays,
    now: data.now,
  });
  const protectedIds: Set<string> = new Set<string>(data.protectedIds || []);

  const backups: Array<BackupRetentionCandidate> = data.backups.filter(
    (candidate: BackupRetentionCandidate): boolean => {
      return (
        candidate.kind === BackupRunKind.Backup &&
        !Number.isNaN(candidate.startedAt.getTime())
      );
    },
  );

  let newestSucceeded: BackupRetentionCandidate | null = null;

  for (const candidate of backups) {
    if (candidate.status !== BackupRunStatus.Succeeded) {
      continue;
    }

    if (
      !newestSucceeded ||
      candidate.startedAt.getTime() > newestSucceeded.startedAt.getTime()
    ) {
      newestSucceeded = candidate;
    }
  }

  const deletable: Array<BackupRetentionCandidate> = backups.filter(
    (candidate: BackupRetentionCandidate): boolean => {
      if (
        candidate.status === BackupRunStatus.Queued ||
        candidate.status === BackupRunStatus.Running
      ) {
        return false;
      }

      if (protectedIds.has(candidate.id)) {
        return false;
      }

      if (newestSucceeded && candidate.id === newestSucceeded.id) {
        return false;
      }

      return candidate.startedAt.getTime() < cutoff.getTime();
    },
  );

  deletable.sort(
    (a: BackupRetentionCandidate, b: BackupRetentionCandidate): number => {
      return a.startedAt.getTime() - b.startedAt.getTime();
    },
  );

  return {
    deleteIds: deletable.map((candidate: BackupRetentionCandidate): string => {
      return candidate.id;
    }),
    keptNewestSucceededId:
      newestSucceeded &&
      newestSucceeded.startedAt.getTime() < cutoff.getTime()
        ? newestSucceeded.id
        : null,
  };
}
