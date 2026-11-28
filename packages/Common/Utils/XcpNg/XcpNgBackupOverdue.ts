/*
 * ------------------------------------------------------------------
 * Whether a VM's backup is overdue - pure, for the server and the pages
 * ------------------------------------------------------------------
 *
 * A VM "has not had a successful backup in its interval" (#10997) once its
 * last good backup is older than the longest gap between two runs of the
 * jobs that back it up (XcpNgBackupSchedule works it out from their
 * schedules), plus a grace of a quarter of it, an hour at least: a job
 * that runs every night has missed one once a VM's last good backup is more
 * than 30 hours old.
 *
 * The VM Not Backed Up alert reads it from the series the server derives,
 * and the pool's pages by this same rule, so a page never calls overdue
 * what the alert does not, nor the other way round.
 * ------------------------------------------------------------------
 */

// The least grace a VM's backup is given, and the share of its interval.
export const XCP_NG_BACKUP_MIN_GRACE_SECONDS: number = 60 * 60;
export const XCP_NG_BACKUP_GRACE_SHARE: number = 0.25;

// The grace a VM's backup is given past its interval.
export function getXcpNgBackupGraceSeconds(intervalSeconds: number): number {
  return Math.max(
    XCP_NG_BACKUP_MIN_GRACE_SECONDS,
    Math.round(intervalSeconds * XCP_NG_BACKUP_GRACE_SHARE),
  );
}

/*
 * Whether a VM's backup is overdue. With no successful backup on record,
 * it is counted from when OneUptime started reading the pool's backups
 * (`watchedSince`): a VM whose last good backup is older than what the
 * first read looked back over is caught once its interval has passed
 * since then, never on the first minute.
 */
export function isXcpNgVmBackupOverdue(data: {
  intervalSeconds: number | null | undefined;
  lastSuccessfulBackupAt: Date | null | undefined;
  watchedSince: Date | null | undefined;
  now: Date;
}): boolean {
  if (
    data.intervalSeconds === null ||
    data.intervalSeconds === undefined ||
    !Number.isFinite(data.intervalSeconds) ||
    data.intervalSeconds <= 0
  ) {
    return false;
  }

  const reference: Date | null | undefined =
    data.lastSuccessfulBackupAt || data.watchedSince;

  if (!reference || isNaN(reference.getTime())) {
    return false;
  }

  const allowedMs: number =
    (data.intervalSeconds + getXcpNgBackupGraceSeconds(data.intervalSeconds)) *
    1000;

  return data.now.getTime() - reference.getTime() > allowedMs;
}

// When a VM's backup becomes overdue, or null when it never can.
export function getXcpNgVmBackupDueBy(data: {
  intervalSeconds: number | null | undefined;
  lastSuccessfulBackupAt: Date | null | undefined;
  watchedSince: Date | null | undefined;
}): Date | null {
  if (
    data.intervalSeconds === null ||
    data.intervalSeconds === undefined ||
    !Number.isFinite(data.intervalSeconds) ||
    data.intervalSeconds <= 0
  ) {
    return null;
  }
  const reference: Date | null | undefined =
    data.lastSuccessfulBackupAt || data.watchedSince;
  if (!reference || isNaN(reference.getTime())) {
    return null;
  }
  return new Date(
    reference.getTime() +
      (data.intervalSeconds +
        getXcpNgBackupGraceSeconds(data.intervalSeconds)) *
        1000,
  );
}
