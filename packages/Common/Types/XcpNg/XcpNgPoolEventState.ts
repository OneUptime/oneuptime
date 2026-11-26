import { XcpNgMessageAlert } from "./XcpNgMessageCatalog";
import {
  XcpNgBackupStatus,
  XcpNgBackupWatermark,
  XcpNgEventReadProblems,
} from "./XcpNgPoolEvents";
import { XcpNgMessageWatermark } from "./XcpNgProbeCollection";

/*
 * ------------------------------------------------------------------
 * What an XCP-ng pool keeps of its alarms and backups (#10997)
 * ------------------------------------------------------------------
 *
 * Stored on the pool's row (XcpNgPool): the backup jobs and their last runs
 * its Backups card draws (backupJobs), which path read them and what could
 * not be read (eventReadStatus), and - for the server alone, never served -
 * where reading stands (eventState): the message watermark, the messages
 * whose alerts are open, the backup watermark and which of the pool's VMs
 * each job backed up last.
 * ------------------------------------------------------------------
 */

// How the pool's events reach OneUptime.
export enum XcpNgEventSource {
  // A probe reads Xen Orchestra's REST API: alarms, HA, backups, patches.
  XenOrchestra = "XenOrchestra",
  // A probe reads the pool's XAPI: alarms, HA and the master; no backups.
  Xapi = "Xapi",
}

export interface XcpNgPoolEventReadStatus {
  source: XcpNgEventSource;
  problems: XcpNgEventReadProblems;
}

// One of the pool's VMs that did not back up in a run.
export interface XcpNgPoolBackupProblemVm {
  vmId: string;
  vmName: string;
  status: XcpNgBackupStatus;
  error?: string | undefined;
}

// A run of a job, as far as it concerns this pool.
export interface XcpNgPoolBackupRunSummary {
  runId: string;
  // The worst of this pool's VMs, or the run's own with none of them in it.
  status: XcpNgBackupStatus;
  startedAt: string;
  endedAt?: string | undefined;
  // This pool's VMs it backed up or tried to.
  vmCount: number;
  failedVmCount: number;
  skippedVmCount: number;
  // The first XCP_NG_MAX_PROBLEM_VMS_PER_RUN that failed, then skipped.
  problemVms: Array<XcpNgPoolBackupProblemVm>;
  // What failed for the whole run.
  error?: string | undefined;
}

export interface XcpNgPoolBackupJob {
  jobId: string;
  name: string;
  mode?: string | undefined;
  jobType?: string | undefined;
  // How late a VM's backup may be; absent while no schedule is enabled.
  intervalSeconds?: number | undefined;
  isScheduled: boolean;
  // Newest first, at most XCP_NG_MAX_RUNS_PER_POOL_JOB.
  runs: Array<XcpNgPoolBackupRunSummary>;
  // This pool's VMs in its latest run.
  vmCount: number;
  // When a run of it last succeeded for this pool.
  lastSuccessAt?: string | undefined;
}

export const XCP_NG_MAX_RUNS_PER_POOL_JOB: number = 5;
export const XCP_NG_MAX_PROBLEM_VMS_PER_RUN: number = 10;
export const XCP_NG_MAX_POOL_BACKUP_JOBS: number = 100;

// A message whose alert is open until XAPI no longer lists it.
export interface XcpNgOpenMessage {
  id: string;
  name: string;
  alert: XcpNgMessageAlert;
  objectType: string;
  objectUuid: string;
  objectName: string;
  // A threshold ALARM's variable: one alarm per object and variable.
  variable?: string | undefined;
  // ISO, the message's own time.
  raisedAt: string;
}

export interface XcpNgPoolEventState {
  // Through Xen Orchestra: where this pool's messages are read from.
  messageWatermark?: XcpNgMessageWatermark | undefined;
  openMessages: Array<XcpNgOpenMessage>;
  // The Xen Orchestra's backup logs (the same on each of its pools).
  backupWatermark?: XcpNgBackupWatermark | undefined;
  // When this pool's backups were first read: the overdue clock's start.
  backupsWatchedSince?: string | undefined;
  // Per job, this pool's VMs in its latest run.
  jobVmIds?: Record<string, Array<string>> | undefined;
  /*
   * Whether HA could tolerate a host failure at the last read: a host
   * disabled since changes it without HA's own state changing.
   */
  haCouldTolerateHostFailure?: boolean | undefined;
}

// A group of open messages: one alert, cleared once the last is gone.
export function getXcpNgOpenMessageGroupKey(
  message: Pick<XcpNgOpenMessage, "name" | "objectUuid" | "variable">,
): string {
  return `${message.name}\n${message.objectUuid}\n${message.variable || ""}`;
}

export function getEmptyXcpNgPoolEventState(): XcpNgPoolEventState {
  return { openMessages: [] };
}

/*
 * A stored state, read defensively: a row written by an older release, or
 * hand-edited JSON, never breaks a collection.
 */
export function readXcpNgPoolEventState(value: unknown): XcpNgPoolEventState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getEmptyXcpNgPoolEventState();
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const state: XcpNgPoolEventState = {
    openMessages: Array.isArray(record["openMessages"])
      ? (record["openMessages"] as Array<unknown>).filter(
          (entry: unknown): entry is XcpNgOpenMessage => {
            return (
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as XcpNgOpenMessage).id === "string" &&
              typeof (entry as XcpNgOpenMessage).name === "string"
            );
          },
        )
      : [],
  };

  const watermark: unknown = record["messageWatermark"];
  if (
    watermark &&
    typeof watermark === "object" &&
    typeof (watermark as XcpNgMessageWatermark).readUntil === "string" &&
    Array.isArray((watermark as XcpNgMessageWatermark).uuidsAtReadUntil)
  ) {
    state.messageWatermark = watermark as XcpNgMessageWatermark;
  }

  const backupWatermark: unknown = record["backupWatermark"];
  if (
    backupWatermark &&
    typeof backupWatermark === "object" &&
    typeof (backupWatermark as XcpNgBackupWatermark).readSince === "number" &&
    Array.isArray((backupWatermark as XcpNgBackupWatermark).deliveredRunIds)
  ) {
    state.backupWatermark = {
      readSince: (backupWatermark as XcpNgBackupWatermark).readSince,
      deliveredRunIds: (backupWatermark as XcpNgBackupWatermark)
        .deliveredRunIds,
      trackedRuns: Array.isArray(
        (backupWatermark as XcpNgBackupWatermark).trackedRuns,
      )
        ? (backupWatermark as XcpNgBackupWatermark).trackedRuns
        : [],
    };
  }

  if (typeof record["haCouldTolerateHostFailure"] === "boolean") {
    state.haCouldTolerateHostFailure = record[
      "haCouldTolerateHostFailure"
    ] as boolean;
  }

  if (typeof record["backupsWatchedSince"] === "string") {
    state.backupsWatchedSince = record["backupsWatchedSince"] as string;
  }

  const jobVmIds: unknown = record["jobVmIds"];
  if (jobVmIds && typeof jobVmIds === "object" && !Array.isArray(jobVmIds)) {
    const kept: Record<string, Array<string>> = {};
    for (const [jobId, vmIds] of Object.entries(
      jobVmIds as Record<string, unknown>,
    )) {
      if (Array.isArray(vmIds)) {
        kept[jobId] = vmIds.filter((vmId: unknown): vmId is string => {
          return typeof vmId === "string";
        });
      }
    }
    state.jobVmIds = kept;
  }

  return state;
}
