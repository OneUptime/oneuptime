import {
  XcpNgMessageWatermark,
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "./XcpNgProbeCollection";

/*
 * ------------------------------------------------------------------
 * What a pool's alarms, HA, master, patches and backups look like on their
 * way to OneUptime (#10997)
 * ------------------------------------------------------------------
 *
 * Xen Orchestra's OpenMetrics plugin, which the XCP-ng Agent reads, carries
 * none of this. Its REST API (/rest/v0) carries all of it, read with a
 * Read only API token by the probe that reads the Xen Orchestra (#10996):
 *
 *   /pools                     whether HA is on, and the master
 *   /messages and /alarms      XAPI's messages, new since each pool's
 *                              watermark, and which open ones are gone
 *   /backup-logs, /backup-jobs and /schedules
 *                              each job's runs, and how often it runs
 *   /hosts/:id/missing_patches every six hours
 *
 * The probe reads them after the metrics, in the same collection, and
 * reports them in `XcpNgCollectionReport.events`; the server keeps the
 * watermarks, so a probe that restarts starts where the last report left
 * off, and neither loses nor repeats a message.
 *
 * A pool read straight from XAPI (#10999) reports its messages and its HA
 * and master in the report's own `messages` and `poolStates`; XAPI knows
 * nothing of Xen Orchestra's backups.
 *
 * On the server each message and each backup run becomes a log record of
 * its pool (XcpNgEventLogAttribute), which the pool's Logs page lists and
 * the alert templates of XcpNgEventAlertTemplates read; the HA plan, the
 * backups VMs are late for and each host's missing patches become derived
 * series (XcpNgDerivedSeries), which the XCP-ng monitor's templates read.
 *
 * Attribute keys and values are stored in customers' logs and monitors:
 * never rename one.
 * ------------------------------------------------------------------
 */

// The instrumentation scope every event record is sent under.
export const XCP_NG_EVENTS_SCOPE_NAME: string = "oneuptime.xcp-ng.events";

// Record attributes of an event's log record.
export enum XcpNgEventLogAttribute {
  // "message" or "backup".
  Kind = "xcp_ng.event.kind",

  // --- A message ---
  MessageId = "xcp_ng.message.id",
  // VM_CRASHED, HA_HOST_FAILED, ALARM ...
  MessageName = "xcp_ng.message.name",
  // "1" (most severe) to "5".
  MessagePriority = "xcp_ng.message.priority",
  // The template it is for (XcpNgMessageAlert).
  MessageAlert = "xcp_ng.message.alert",
  // "raised", or "cleared" once XAPI no longer lists the message.
  MessageState = "xcp_ng.message.state",
  // What it is about: pool, host, vm, sr, vdi, other or unknown.
  ObjectType = "xcp_ng.object.type",
  ObjectUuid = "xcp_ng.object.uuid",
  ObjectName = "xcp_ng.object.name",
  // A threshold ALARM: the variable perfmon watched, and its value.
  AlarmVariable = "xcp_ng.alarm.variable",
  AlarmValue = "xcp_ng.alarm.value",

  // --- A backup run ---
  BackupJobId = "xcp_ng.backup.job.id",
  BackupJobName = "xcp_ng.backup.job.name",
  BackupRunId = "xcp_ng.backup.run.id",
  // success, failure, skipped or interrupted.
  BackupStatus = "xcp_ng.backup.status",
  // full or delta.
  BackupMode = "xcp_ng.backup.mode",
  // How many of the pool's VMs the run backed up, and how many failed.
  BackupVmCount = "xcp_ng.backup.vm_count",
  BackupFailedVmCount = "xcp_ng.backup.failed_vm_count",
  // The VMs that failed, by name, comma-separated (capped).
  BackupFailedVms = "xcp_ng.backup.failed_vms",
}

export enum XcpNgEventKind {
  Message = "message",
  Backup = "backup",
}

export enum XcpNgMessageState {
  Raised = "raised",
  Cleared = "cleared",
}

/*
 * How a backup run, or one VM's backup in it, ended - Xen Orchestra's own
 * words. A run still pending is never reported.
 */
export enum XcpNgBackupStatus {
  Success = "success",
  Failure = "failure",
  Skipped = "skipped",
  Interrupted = "interrupted",
}

// --- Bounds on what one collection carries ---

// The most messages one pool's read hands the server.
export const XCP_NG_MAX_EVENT_MESSAGES_PER_POOL: number = 200;

// The open messages the server tracks per pool (newest kept).
export const XCP_NG_MAX_OPEN_MESSAGES_PER_POOL: number = 500;

// The open message ids one existence check asks Xen Orchestra about.
export const XCP_NG_OPEN_MESSAGE_ID_CHUNK: number = 40;

// The backup runs whose full log one collection reads.
export const XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION: number = 20;

// The VMs one run's report keeps (failed ones first).
export const XCP_NG_MAX_BACKUP_VMS_PER_RUN: number = 1000;

// The patches one host's report keeps, and the backup jobs one read keeps.
export const XCP_NG_MAX_PATCHES_PER_HOST: number = 200;
export const XCP_NG_MAX_BACKUP_JOBS: number = 200;

// The longest error text kept for a run or one of its VMs.
export const XCP_NG_MAX_BACKUP_ERROR_LENGTH: number = 500;

/*
 * How far back the first read of a Xen Orchestra's backup logs looks: a
 * week and a day, so a weekly job's last run is on the card from the first
 * minute.
 */
export const XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS: number =
  8 * 24 * 60 * 60 * 1000;

// A run Xen Orchestra still calls pending after this long is not waited for.
export const XCP_NG_BACKUP_PENDING_GIVE_UP_MS: number = 3 * 24 * 60 * 60 * 1000;

// Missing patches are checked this often: the check runs on every host.
export const XCP_NG_PATCH_CHECK_INTERVAL_MS: number = 6 * 60 * 60 * 1000;

// --- What the server hands the probe ---

export interface XcpNgPoolEventsJobState {
  // The pool's XAPI UUID, lower case.
  poolId: string;
  // Absent: the first read, which reads from then on, not the history.
  messageWatermark?: XcpNgMessageWatermark | undefined;
  /*
   * The messages whose alerts are open: the probe says which of them XAPI
   * no longer lists (dismissed in Xen Orchestra or XenCenter, or gone).
   */
  openMessageIds: Array<string>;
}

/*
 * Where reading a Xen Orchestra's backup logs stands. Runs that started at
 * or after `readSince` (ms, Xen Orchestra's clock) are read; those of them
 * already delivered are not delivered again. A run still pending, or one
 * finished but not delivered yet (a read delivers at most
 * XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION), is followed by its id in
 * `trackedRuns`, so `readSince` can move on to the newest run and the
 * state stays small however long a run takes.
 */
export interface XcpNgBackupWatermark {
  readSince: number;
  deliveredRunIds: Array<string>;
  trackedRuns: Array<XcpNgTrackedBackupRun>;
}

export interface XcpNgTrackedBackupRun {
  runId: string;
  // ms, Xen Orchestra's clock.
  start: number;
}

// The runs one watermark follows by id.
export const XCP_NG_MAX_TRACKED_BACKUP_RUNS: number = 200;

// Of one job's runs that finished since the last read, the newest read.
export const XCP_NG_MAX_BACKUP_RUNS_PER_JOB_PER_READ: number = 5;

// The events part of one collection job (Xen Orchestra with an API token).
export interface XcpNgEventsJobState {
  pools: Array<XcpNgPoolEventsJobState>;
  // Absent: the first read, which looks XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS back.
  backupWatermark?: XcpNgBackupWatermark | undefined;
  // Whether this collection checks every host for missing patches.
  checkPatches: boolean;
}

// --- What the probe reports ---

export interface XcpNgPoolEventsReport {
  poolId: string;
  // Read this time (Xen Orchestra: HA on or off, and the master).
  poolState?: XcpNgPoolState | undefined;
  // New since the watermark, oldest first.
  messages: Array<XcpNgPoolMessage>;
  // What the next read starts from.
  messageWatermark: XcpNgMessageWatermark;
  // Of the open message ids handed out, those XAPI no longer lists.
  clearedMessageIds: Array<string>;
}

// One VM's backup in a run.
export interface XcpNgBackupVmResult {
  // The VM's XAPI UUID, lower case.
  vmId: string;
  vmName?: string | undefined;
  status: XcpNgBackupStatus;
  // Why it failed or was skipped, as Xen Orchestra wrote it.
  error?: string | undefined;
  // ISO.
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  // What it sent, summed over its transfers.
  bytes?: number | undefined;
}

// One finished run of a backup job.
export interface XcpNgBackupRun {
  // Xen Orchestra's id for the run (its log).
  runId: string;
  jobId: string;
  jobName: string;
  scheduleId?: string | undefined;
  // full or delta.
  mode?: string | undefined;
  status: XcpNgBackupStatus;
  // ISO, Xen Orchestra's clock.
  startedAt: string;
  endedAt?: string | undefined;
  // What failed for the whole run, before or around its VMs.
  error?: string | undefined;
  // Each VM it backed up or tried to, failed ones first.
  vms: Array<XcpNgBackupVmResult>;
  // The VMs the run included, from its own log (attributes it to pools).
  includedVmIds: Array<string>;
  // VMs left out of `vms` to stay within XCP_NG_MAX_BACKUP_VMS_PER_RUN.
  omittedVmCount?: number | undefined;
}

// When a backup job runs, as Xen Orchestra schedules it.
export interface XcpNgBackupSchedule {
  scheduleId: string;
  // Five fields, Xen Orchestra's cron ("0 2 * * *").
  cron: string;
  // An IANA zone ("Europe/Paris"); absent is Xen Orchestra's own.
  timezone?: string | undefined;
  enabled: boolean;
}

/*
 * A backup job and its schedules. How late a VM's backup may be is worked
 * out from them on the server (XcpNgBackupSchedule).
 */
export interface XcpNgBackupJobInfo {
  jobId: string;
  name: string;
  // full or delta.
  mode?: string | undefined;
  // backup, mirrorBackup, metadataBackup.
  jobType?: string | undefined;
  schedules: Array<XcpNgBackupSchedule>;
}

export interface XcpNgMissingPatch {
  name: string;
  version?: string | undefined;
  release?: string | undefined;
  description?: string | undefined;
  size?: number | undefined;
}

// One host's missing patches.
export interface XcpNgHostPatches {
  // The host's XAPI UUID, lower case.
  hostId: string;
  patchCount: number;
  // The first XCP_NG_MAX_PATCHES_PER_HOST, by name.
  patches: Array<XcpNgMissingPatch>;
}

/*
 * What could not be read this time, in words - shown on the pool's pages,
 * so a token that cannot read backups says so where the backups would be.
 */
export interface XcpNgEventReadProblems {
  messages?: string | undefined;
  backups?: string | undefined;
  patches?: string | undefined;
}

// The events part of a Xen Orchestra collection report.
export interface XcpNgEventsReport {
  pools: Array<XcpNgPoolEventsReport>;
  // Present when the backup logs were read.
  backupRuns?: Array<XcpNgBackupRun> | undefined;
  backupWatermark?: XcpNgBackupWatermark | undefined;
  backupJobs?: Array<XcpNgBackupJobInfo> | undefined;
  // Present when the patches were checked.
  hostPatches?: Array<XcpNgHostPatches> | undefined;
  problems: XcpNgEventReadProblems;
  // Parts left out, in words, for the connection's status.
  warnings: Array<string>;
}
