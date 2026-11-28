import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import {
  XcpNgBackupStatus,
  XcpNgEventReadProblems,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgEventSource,
  XcpNgPoolBackupJob,
  XcpNgPoolBackupRunSummary,
  XcpNgPoolEventReadStatus,
} from "Common/Types/XcpNg/XcpNgPoolEventState";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  getXcpNgVmBackupDueBy,
  isXcpNgVmBackupOverdue,
} from "Common/Utils/XcpNg/XcpNgBackupOverdue";
import {
  XcpNgHaVerdict,
  getXcpNgHaVerdict,
} from "Common/Utils/XcpNg/XcpNgHighAvailability";
import { toXcpNgDate, toXcpNgNumber } from "./XcpNgResourceUtils";

/*
 * WHAT A POOL'S ALARMS, HA, BACKUPS AND PATCHES SAY, FOR ITS PAGES (#10997).
 *
 * A probe reads them from Xen Orchestra's REST API - or HA and the master
 * from the pool's own XAPI - and the server keeps them on the pool's row
 * (its HA, its master, its backup jobs and their last runs, what could not
 * be read) and on each VM's and host's (its last backup, how often its jobs
 * run, its missing patches). The XCP-ng Agent reads none of it: a pool read
 * only by the agent has nothing here, and the pages say so and how to get
 * it, rather than "no backups".
 *
 * The rules are the alerts': whether HA can tolerate a host failure is
 * XcpNgHighAvailability's verdict, the one the server derives its series
 * from, and a VM's backup is overdue by XcpNgBackupOverdue, the one the VM
 * Not Backed Up alert reads. React-free, so App tests can read it.
 */

export type XcpNgHaState = "on" | "off" | "unknown";

export interface XcpNgHaSummary {
  state: XcpNgHaState;
  verdict: XcpNgHaVerdict;
  hostsUpAndEnabled: number;
  isOvercommitted: boolean | null;
  // The master's host row, when the inventory has it.
  master: XcpNgResource | null;
  masterHostExternalId: string | null;
}

type HaPool = Pick<
  XcpNgPool,
  | "isHaEnabled"
  | "haHostFailuresToTolerate"
  | "haPlanExistsFor"
  | "isHaOvercommitted"
  | "masterHostExternalId"
>;

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// Hosts up and enabled: those that can take another's VMs, as the server counts them.
export function countXcpNgHostsUpAndEnabled(
  rows: Array<XcpNgResource>,
): number {
  return rows.filter((row: XcpNgResource): boolean => {
    return (
      row.kind === XcpNgResourceKind.Host &&
      row.isUp === true &&
      row.isEnabled !== false
    );
  }).length;
}

export function summarizeXcpNgHa(data: {
  pool: HaPool;
  rows: Array<XcpNgResource>;
}): XcpNgHaSummary {
  const haEnabled: boolean | null = readBoolean(data.pool.isHaEnabled);
  const hostsUpAndEnabled: number = countXcpNgHostsUpAndEnabled(data.rows);
  const masterId: string = (data.pool.masterHostExternalId || "")
    .trim()
    .toLowerCase();

  const master: XcpNgResource | undefined = masterId
    ? data.rows.find((row: XcpNgResource): boolean => {
        return (
          row.kind === XcpNgResourceKind.Host &&
          (row.externalId || "").toLowerCase() === masterId
        );
      })
    : undefined;

  return {
    state: haEnabled === null ? "unknown" : haEnabled ? "on" : "off",
    verdict: getXcpNgHaVerdict({
      haEnabled: haEnabled,
      hostFailuresToTolerate: toXcpNgNumber(data.pool.haHostFailuresToTolerate),
      planExistsFor: toXcpNgNumber(data.pool.haPlanExistsFor),
      overcommitted: readBoolean(data.pool.isHaOvercommitted),
      hostsUpAndEnabled: hostsUpAndEnabled,
    }),
    hostsUpAndEnabled: hostsUpAndEnabled,
    isOvercommitted: readBoolean(data.pool.isHaOvercommitted),
    master: master || null,
    masterHostExternalId: masterId || null,
  };
}

// Whether HA is on and cannot survive one more host failure: the HA alert's rule.
export function isXcpNgHaAtRisk(summary: XcpNgHaSummary): boolean {
  return (
    summary.state === "on" && summary.verdict.canTolerateHostFailure === false
  );
}

/*
 * ---------------------------------------------------------------------------
 * Where reading stands
 * ---------------------------------------------------------------------------
 */

type ReadPool = Pick<
  XcpNgPool,
  "eventReadStatus" | "eventsReadAt" | "backupsReadAt" | "patchesCheckedAt"
>;

export function getXcpNgEventReadStatus(
  pool: Pick<XcpNgPool, "eventReadStatus">,
): XcpNgPoolEventReadStatus | null {
  const status: unknown = pool.eventReadStatus;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return null;
  }
  return status as XcpNgPoolEventReadStatus;
}

function readProblem(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// What could not be read at the last read, in the probe's own words.
export function getXcpNgEventReadProblems(
  pool: Pick<XcpNgPool, "eventReadStatus">,
): XcpNgEventReadProblems {
  const problems: unknown = getXcpNgEventReadStatus(pool)?.problems;
  if (!problems || typeof problems !== "object") {
    return {};
  }
  const record: Record<string, unknown> = problems as Record<string, unknown>;
  const read: XcpNgEventReadProblems = {};
  const messages: string | undefined = readProblem(record["messages"]);
  const backups: string | undefined = readProblem(record["backups"]);
  const patches: string | undefined = readProblem(record["patches"]);
  if (messages) {
    read.messages = messages;
  }
  if (backups) {
    read.backups = backups;
  }
  if (patches) {
    read.patches = patches;
  }
  return read;
}

// Whether a probe has ever read the pool's alarms, HA and master.
export function isXcpNgEventsRead(pool: ReadPool): boolean {
  return (
    toXcpNgDate(pool.eventsReadAt) !== null ||
    getXcpNgEventReadStatus(pool) !== null
  );
}

/*
 * Whether the pool's backups are read: through Xen Orchestra only - XAPI
 * keeps no backup of its own, and the agent reads metrics.
 */
export function isXcpNgBackupsRead(pool: ReadPool): boolean {
  return toXcpNgDate(pool.backupsReadAt) !== null;
}

// Whether the pool is read through its own XAPI, which knows of no backups.
export function isXcpNgReadThroughXapi(pool: ReadPool): boolean {
  return getXcpNgEventReadStatus(pool)?.source === XcpNgEventSource.Xapi;
}

// When the pool's backups were first read: the overdue clock's start.
export function getXcpNgBackupsWatchedSince(
  pool: Pick<XcpNgPool, "eventReadStatus">,
): Date | null {
  return toXcpNgDate(getXcpNgEventReadStatus(pool)?.backupsWatchedSince);
}

/*
 * ---------------------------------------------------------------------------
 * A VM's backups
 * ---------------------------------------------------------------------------
 */

type BackupRow = Pick<
  XcpNgResource,
  | "kind"
  | "isControlDomain"
  | "lastBackupAt"
  | "lastBackupStatus"
  | "lastSuccessfulBackupAt"
  | "backupIntervalSeconds"
>;

const BACKUP_STATUSES: ReadonlySet<string> = new Set<string>(
  Object.values(XcpNgBackupStatus),
);

function isBackedUpVm(row: BackupRow): boolean {
  return row.kind === XcpNgResourceKind.VM && row.isControlDomain !== true;
}

// How a VM's last backup ended, or null before one was read.
export function getXcpNgVmBackupStatus(
  row: BackupRow,
): XcpNgBackupStatus | null {
  if (!isBackedUpVm(row)) {
    return null;
  }
  const status: string = (row.lastBackupStatus || "").trim().toLowerCase();
  return BACKUP_STATUSES.has(status) ? (status as XcpNgBackupStatus) : null;
}

// A VM whose last backup failed or was interrupted: it was not backed up.
export function isXcpNgVmLastBackupFailed(row: BackupRow): boolean {
  const status: XcpNgBackupStatus | null = getXcpNgVmBackupStatus(row);
  return (
    status === XcpNgBackupStatus.Failure ||
    status === XcpNgBackupStatus.Interrupted
  );
}

// Whether a scheduled job backs the VM up: its jobs run on a schedule.
export function isXcpNgVmInScheduledBackup(row: BackupRow): boolean {
  const interval: number | null = toXcpNgNumber(row.backupIntervalSeconds);
  return isBackedUpVm(row) && interval !== null && interval > 0;
}

// The VM Not Backed Up alert's rule, on the VM's row.
export function isXcpNgVmBackupLate(data: {
  row: BackupRow;
  watchedSince: Date | null;
  now: Date;
}): boolean {
  if (!isBackedUpVm(data.row)) {
    return false;
  }
  return isXcpNgVmBackupOverdue({
    intervalSeconds: toXcpNgNumber(data.row.backupIntervalSeconds),
    lastSuccessfulBackupAt: toXcpNgDate(data.row.lastSuccessfulBackupAt),
    watchedSince: data.watchedSince,
    now: data.now,
  });
}

// When a VM's backup falls overdue, or null when no scheduled job backs it up.
export function getXcpNgVmBackupDueAt(data: {
  row: BackupRow;
  watchedSince: Date | null;
}): Date | null {
  if (!isBackedUpVm(data.row)) {
    return null;
  }
  return getXcpNgVmBackupDueBy({
    intervalSeconds: toXcpNgNumber(data.row.backupIntervalSeconds),
    lastSuccessfulBackupAt: toXcpNgDate(data.row.lastSuccessfulBackupAt),
    watchedSince: data.watchedSince,
  });
}

export interface XcpNgBackupSummary {
  // The pool's VMs, its control domains left out.
  vms: number;
  // VMs with a last backup on record.
  withResult: number;
  ok: number;
  failed: number;
  late: number;
  // VMs no scheduled job backs up, once the backups are read.
  notScheduled: number;
  newestBackupAt: Date | null;
}

export function summarizeXcpNgBackups(data: {
  rows: Array<XcpNgResource>;
  watchedSince: Date | null;
  isRead: boolean;
  now: Date;
}): XcpNgBackupSummary {
  const summary: XcpNgBackupSummary = {
    vms: 0,
    withResult: 0,
    ok: 0,
    failed: 0,
    late: 0,
    notScheduled: 0,
    newestBackupAt: null,
  };

  for (const row of data.rows) {
    if (!isBackedUpVm(row)) {
      continue;
    }
    summary.vms++;

    const status: XcpNgBackupStatus | null = getXcpNgVmBackupStatus(row);
    if (status) {
      summary.withResult++;
      if (status === XcpNgBackupStatus.Success) {
        summary.ok++;
      }
      if (isXcpNgVmLastBackupFailed(row)) {
        summary.failed++;
      }
    }

    if (
      isXcpNgVmBackupLate({
        row: row,
        watchedSince: data.watchedSince,
        now: data.now,
      })
    ) {
      summary.late++;
    }

    if (data.isRead && !isXcpNgVmInScheduledBackup(row)) {
      summary.notScheduled++;
    }

    const at: Date | null = toXcpNgDate(row.lastBackupAt);
    if (at && (!summary.newestBackupAt || at > summary.newestBackupAt)) {
      summary.newestBackupAt = at;
    }
  }

  return summary;
}

/*
 * ---------------------------------------------------------------------------
 * The pool's backup jobs
 * ---------------------------------------------------------------------------
 */

function isRun(value: unknown): value is XcpNgPoolBackupRunSummary {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as XcpNgPoolBackupRunSummary).runId === "string" &&
    typeof (value as XcpNgPoolBackupRunSummary).startedAt === "string"
  );
}

function isJob(value: unknown): value is XcpNgPoolBackupJob {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as XcpNgPoolBackupJob).jobId === "string" &&
    typeof (value as XcpNgPoolBackupJob).name === "string"
  );
}

// A job's runs for the pool, newest first.
export function getXcpNgJobRuns(
  job: XcpNgPoolBackupJob,
): Array<XcpNgPoolBackupRunSummary> {
  return (Array.isArray(job.runs) ? job.runs : [])
    .filter(isRun)
    .slice()
    .sort(
      (
        left: XcpNgPoolBackupRunSummary,
        right: XcpNgPoolBackupRunSummary,
      ): number => {
        return (
          new Date(right.startedAt).getTime() -
          new Date(left.startedAt).getTime()
        );
      },
    );
}

export function getXcpNgNewestRun(
  job: XcpNgPoolBackupJob,
): XcpNgPoolBackupRunSummary | null {
  return getXcpNgJobRuns(job)[0] || null;
}

// A job whose newest run for the pool failed: the Backup Job Failed alert's.
export function isXcpNgJobFailing(job: XcpNgPoolBackupJob): boolean {
  const newest: XcpNgPoolBackupRunSummary | null = getXcpNgNewestRun(job);
  return (
    newest !== null &&
    (newest.status === XcpNgBackupStatus.Failure ||
      newest.status === XcpNgBackupStatus.Interrupted)
  );
}

/*
 * The pool's jobs, those failing first, then by name as people number
 * them; a job that never ran for the pool last.
 */
export function getXcpNgBackupJobs(
  pool: Pick<XcpNgPool, "backupJobs">,
): Array<XcpNgPoolBackupJob> {
  const jobs: Array<XcpNgPoolBackupJob> = (
    Array.isArray(pool.backupJobs) ? (pool.backupJobs as Array<unknown>) : []
  ).filter(isJob);

  const rank: (job: XcpNgPoolBackupJob) => number = (
    job: XcpNgPoolBackupJob,
  ): number => {
    if (isXcpNgJobFailing(job)) {
      return 0;
    }
    return getXcpNgNewestRun(job) ? 1 : 2;
  };

  return jobs
    .slice()
    .sort((left: XcpNgPoolBackupJob, right: XcpNgPoolBackupJob): number => {
      const byRank: number = rank(left) - rank(right);
      if (byRank !== 0) {
        return byRank;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

/*
 * ---------------------------------------------------------------------------
 * A host's patches
 * ---------------------------------------------------------------------------
 */

// How many patches a host misses, or null before a check counted them.
export function getXcpNgMissingPatchCount(
  row: Pick<XcpNgResource, "kind" | "missingPatchCount">,
): number | null {
  if (row.kind !== XcpNgResourceKind.Host) {
    return null;
  }
  const count: number | null = toXcpNgNumber(row.missingPatchCount);
  return count === null ? null : Math.max(0, Math.trunc(count));
}
