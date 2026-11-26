import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import { XcpNgPoolFeedEventType } from "../../../Models/DatabaseModels/XcpNgPoolFeed";
import {
  XcpNgMessageAlert,
  XcpNgMessageDefinition,
  XcpNgMessageObjectType,
  getXcpNgMessageDefinition,
  getXcpNgMessageObjectTypeFromClass,
  isXcpNgFeedPriority,
  isXcpNgMessageClearable,
} from "../../../Types/XcpNg/XcpNgMessageCatalog";
import {
  XCP_NG_MAX_OPEN_MESSAGES_PER_POOL,
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgBackupStatus,
  XcpNgBackupVmResult,
  XcpNgBackupWatermark,
  XcpNgEventReadProblems,
  XcpNgHostPatches,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XCP_NG_MAX_POOL_BACKUP_JOBS,
  XCP_NG_MAX_PROBLEM_VMS_PER_RUN,
  XCP_NG_MAX_RUNS_PER_POOL_JOB,
  XcpNgEventSource,
  XcpNgOpenMessage,
  XcpNgPoolBackupJob,
  XcpNgPoolBackupProblemVm,
  XcpNgPoolBackupRunSummary,
  XcpNgPoolEventReadStatus,
  XcpNgPoolEventState,
  getXcpNgOpenMessageGroupKey,
  readXcpNgPoolEventState,
} from "../../../Types/XcpNg/XcpNgPoolEventState";
import {
  XcpNgMessageWatermark,
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import {
  XcpNgScope,
  XcpNgTelemetryUtil,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  XcpNgHaVerdict,
  XcpNgHaVerdictSource,
  getXcpNgHaVerdict,
} from "../../../Utils/XcpNg/XcpNgHighAvailability";
import {
  XcpNgAlarmReading,
  readXcpNgAlarmBody,
} from "../../../Utils/XcpNg/XenOrchestraRest";
import {
  getXcpNgBackupJobIntervalSeconds,
  isXcpNgVmBackupOverdue,
} from "./XcpNgBackupSchedule";
import {
  XcpNgDerivedReadings,
  XcpNgEventObject,
  buildXcpNgBackupLogRecord,
  buildXcpNgClearedLogRecord,
  buildXcpNgMessageLogRecord,
  describeXcpNgAlarm,
  describeXcpNgBackupRun,
} from "./XcpNgEventRecords";

/*
 * ------------------------------------------------------------------
 * One pool's events, worked out - pure
 * ------------------------------------------------------------------
 *
 * From what a probe reported (XcpNgEventsReport through Xen Orchestra; the
 * report's messages and pool states straight from XAPI) and what the pool
 * had stored, everything one collection changes for one pool:
 *
 *   - its log records: each message raised, each alert's last message gone
 *     (cleared), each backup run;
 *   - its feed lines: messages of priority 1 to 4, a master that moved, HA
 *     turned on or off or no longer able to tolerate a host failure, a
 *     backup run that failed;
 *   - its columns: HA, the master, when what was read, each backup job's
 *     last runs, and the state the next collection starts from;
 *   - its VMs' last backups and how often their jobs run, its hosts'
 *     missing patches;
 *   - the derived readings the XCP-ng monitor's templates read.
 *
 * Nothing here reads or writes a database (XcpNgPoolEventsIngest does), so
 * every rule can be tested on its own.
 * ------------------------------------------------------------------
 */

// The feed lines one pool's collection writes for its messages.
export const XCP_NG_MAX_MESSAGE_FEED_LINES: number = 20;

// A job name as the VM's column keeps it.
const MAX_JOB_NAME_LENGTH: number = 100;

export interface XcpNgStoredPool {
  xcpNgPoolId: string;
  poolIdentifier: string;
  name: string;
  reportedName: string | null;
  xenOrchestraName: string | null;
  isHaEnabled: boolean | null;
  haHostFailuresToTolerate: number | null;
  haPlanExistsFor: number | null;
  isHaOvercommitted: boolean | null;
  masterHostExternalId: string | null;
  backupJobs: Array<XcpNgPoolBackupJob> | null;
  eventState: unknown;
  patchesCheckedAt?: Date | null | undefined;
}

export interface XcpNgStoredResource {
  kind: string;
  externalId: string;
  name: string | null;
  isUp: boolean | null;
  isEnabled: boolean | null;
  isControlDomain: boolean | null;
  lastSuccessfulBackupAt: Date | null;
  backupIntervalSeconds: number | null;
  missingPatchCount: number | null;
}

export interface XcpNgVmBackupUpdate {
  vmId: string;
  lastBackupAt: Date;
  lastBackupStatus: XcpNgBackupStatus;
  lastBackupJobName: string;
  // Null after a success: the last error no longer stands.
  lastBackupError: string | null;
  lastBackupBytes: number | null;
  // Set after a success only.
  lastSuccessfulBackupAt: Date | null;
}

export interface XcpNgFeedLine {
  type: XcpNgPoolFeedEventType;
  markdown: string;
  color: Color;
  postedAt: Date;
}

// The pool's own columns a collection writes.
export interface XcpNgPoolEventColumns {
  isHaEnabled?: boolean | null | undefined;
  haHostFailuresToTolerate?: number | null | undefined;
  haPlanExistsFor?: number | null | undefined;
  isHaOvercommitted?: boolean | null | undefined;
  masterHostExternalId?: string | null | undefined;
  eventsReadAt?: Date | undefined;
  backupsReadAt?: Date | undefined;
  patchesCheckedAt?: Date | undefined;
  eventReadStatus: XcpNgPoolEventReadStatus;
  backupJobs?: Array<XcpNgPoolBackupJob> | undefined;
  eventState: XcpNgPoolEventState;
}

export interface XcpNgPoolEventsInput {
  now: Date;
  source: XcpNgEventSource;
  pool: XcpNgStoredPool;
  // This pool's hosts, VMs, storage repositories and virtual disks.
  inventory: Array<XcpNgStoredResource>;
  // The HA and master read this time; absent when they were not.
  poolState?: XcpNgPoolState | undefined;
  // Whether this pool's messages were read this time.
  messagesRead: boolean;
  // New since the watermark, oldest first.
  messages: Array<XcpNgPoolMessage>;
  // Through Xen Orchestra: the pool's next message watermark.
  messageWatermark?: XcpNgMessageWatermark | undefined;
  clearedMessageIds: Array<string>;
  /*
   * Through Xen Orchestra, when the backup logs were read: every run read
   * (of every pool of the Xen Orchestra), each job with its schedules, and
   * the next watermark.
   */
  backupRuns?: Array<XcpNgBackupRun> | undefined;
  backupJobs?: Array<XcpNgBackupJobInfo> | undefined;
  backupWatermark?: XcpNgBackupWatermark | undefined;
  // Through Xen Orchestra, when patches were checked: every host checked.
  hostPatches?: Array<XcpNgHostPatches> | undefined;
  patchesChecked: boolean;
  problems: XcpNgEventReadProblems;
}

export interface XcpNgPoolEventsOutput {
  records: Array<JSONObject>;
  feed: Array<XcpNgFeedLine>;
  columns: XcpNgPoolEventColumns;
  vmBackupUpdates: Array<XcpNgVmBackupUpdate>;
  vmIntervalUpdates: Array<{ vmId: string; intervalSeconds: number | null }>;
  hostPatchUpdates: Array<XcpNgHostPatches>;
  derived: XcpNgDerivedReadings;
}

interface Inventory {
  byId: Map<string, XcpNgStoredResource>;
  hosts: Array<XcpNgStoredResource>;
  vms: Array<XcpNgStoredResource>;
}

function indexInventory(rows: Array<XcpNgStoredResource>): Inventory {
  const byId: Map<string, XcpNgStoredResource> = new Map();
  const hosts: Array<XcpNgStoredResource> = [];
  const vms: Array<XcpNgStoredResource> = [];

  for (const original of rows) {
    // A copy: what this collection works out never changes the caller's rows.
    const row: XcpNgStoredResource = { ...original };
    const id: string = (row.externalId || "").toLowerCase();
    if (!id) {
      continue;
    }
    byId.set(id, row);
    if (row.kind === XcpNgResourceKind.Host) {
      hosts.push(row);
    } else if (row.kind === XcpNgResourceKind.VM && !row.isControlDomain) {
      vms.push(row);
    }
  }

  return { byId, hosts, vms };
}

function shortId(uuid: string): string {
  return XcpNgTelemetryUtil.getShortIdentifier(uuid) || uuid;
}

function getObjectTypeOfKind(kind: string): XcpNgMessageObjectType {
  switch (kind) {
    case XcpNgResourceKind.Host:
      return XcpNgScope.Host;
    case XcpNgResourceKind.VM:
      return XcpNgScope.VM;
    case XcpNgResourceKind.StorageRepository:
      return XcpNgScope.StorageRepository;
    case XcpNgResourceKind.VDI:
      return XcpNgScope.VDI;
    default:
      return "other";
  }
}

/*
 * What a message is about, by its name in the pool's inventory: the UUID
 * names a host, a VM, a storage repository, a disk or the pool itself; an
 * object the inventory does not hold reads by its class and the start of
 * its UUID.
 */
export function resolveXcpNgEventObject(data: {
  uuid: string;
  objectClass: string;
  definition: XcpNgMessageDefinition;
  pool: XcpNgStoredPool;
  inventory: Map<string, XcpNgStoredResource>;
}): XcpNgEventObject {
  const uuid: string = (data.uuid || "").toLowerCase();

  if (uuid && uuid === data.pool.poolIdentifier.toLowerCase()) {
    return { type: XcpNgScope.Pool, uuid: uuid, name: data.pool.name };
  }

  const row: XcpNgStoredResource | undefined = uuid
    ? data.inventory.get(uuid)
    : undefined;

  if (row) {
    return {
      type: getObjectTypeOfKind(row.kind),
      uuid: uuid,
      name: row.name || shortId(uuid),
    };
  }

  let type: XcpNgMessageObjectType = getXcpNgMessageObjectTypeFromClass(
    data.objectClass,
  );
  if (type === "unknown") {
    type = data.definition.objectType;
  }

  const label: Record<string, string> = {
    [XcpNgScope.Pool]: "Pool",
    [XcpNgScope.Host]: "Host",
    [XcpNgScope.VM]: "VM",
    [XcpNgScope.StorageRepository]: "Storage repository",
    [XcpNgScope.VDI]: "Virtual disk",
  };

  return {
    type: type,
    uuid: uuid,
    name: uuid ? `${label[type] || "Object"} ${shortId(uuid)}` : data.pool.name,
  };
}

function getFeedColor(priority: number): Color {
  if (priority <= 2) {
    return Red500;
  }
  if (priority === 3) {
    return Yellow500;
  }
  return Blue500;
}

function hostName(
  inventory: Map<string, XcpNgStoredResource>,
  uuid: string,
): string {
  const row: XcpNgStoredResource | undefined = inventory.get(uuid);
  return row?.name || `Host ${shortId(uuid)}`;
}

/*
 * Whether a run's VM result counts as a status worse than another: what a
 * pool's view of a run is (the worst of its VMs).
 */
const STATUS_SEVERITY: Readonly<Record<XcpNgBackupStatus, number>> = {
  [XcpNgBackupStatus.Success]: 0,
  [XcpNgBackupStatus.Skipped]: 1,
  [XcpNgBackupStatus.Interrupted]: 2,
  [XcpNgBackupStatus.Failure]: 3,
};

/*
 * A run as far as it concerns one pool: its VMs of the pool - or, for a
 * run that failed before any VM (an unreachable remote), the pool when the
 * job backs up its VMs - with the worst of their statuses. Null when the
 * run has nothing to do with the pool.
 */
export function summarizeXcpNgRunForPool(data: {
  run: XcpNgBackupRun;
  poolVmIds: Set<string>;
  vmNames: Map<string, string>;
  // Whether the job backed up this pool's VMs in an earlier run.
  jobKnownHere: boolean;
}): XcpNgPoolBackupRunSummary | null {
  const vms: Array<XcpNgBackupVmResult> = data.run.vms.filter(
    (vm: XcpNgBackupVmResult): boolean => {
      return data.poolVmIds.has(vm.vmId);
    },
  );
  const includedHere: Array<string> = data.run.includedVmIds.filter(
    (vmId: string): boolean => {
      return data.poolVmIds.has(vmId);
    },
  );

  if (vms.length === 0 && includedHere.length === 0) {
    if (!data.run.error || !data.jobKnownHere) {
      return null;
    }
  }

  let status: XcpNgBackupStatus =
    vms.length === 0 ? data.run.status : XcpNgBackupStatus.Success;
  for (const vm of vms) {
    if (STATUS_SEVERITY[vm.status] > STATUS_SEVERITY[status]) {
      status = vm.status;
    }
  }
  // A run-level failure (a target it could not reach) is every pool's.
  if (
    data.run.error &&
    STATUS_SEVERITY[data.run.status] > STATUS_SEVERITY[status]
  ) {
    status = data.run.status;
  }

  const problemVms: Array<XcpNgPoolBackupProblemVm> = vms
    .filter((vm: XcpNgBackupVmResult): boolean => {
      return vm.status !== XcpNgBackupStatus.Success;
    })
    .sort((left: XcpNgBackupVmResult, right: XcpNgBackupVmResult): number => {
      return STATUS_SEVERITY[right.status] - STATUS_SEVERITY[left.status];
    })
    .slice(0, XCP_NG_MAX_PROBLEM_VMS_PER_RUN)
    .map((vm: XcpNgBackupVmResult): XcpNgPoolBackupProblemVm => {
      const problem: XcpNgPoolBackupProblemVm = {
        vmId: vm.vmId,
        vmName:
          vm.vmName || data.vmNames.get(vm.vmId) || `VM ${shortId(vm.vmId)}`,
        status: vm.status,
      };
      if (vm.error) {
        problem.error = vm.error;
      }
      return problem;
    });

  const summary: XcpNgPoolBackupRunSummary = {
    runId: data.run.runId,
    status: status,
    startedAt: data.run.startedAt,
    vmCount: Math.max(vms.length, includedHere.length),
    failedVmCount: vms.filter((vm: XcpNgBackupVmResult): boolean => {
      return vm.status === XcpNgBackupStatus.Failure;
    }).length,
    skippedVmCount: vms.filter((vm: XcpNgBackupVmResult): boolean => {
      return vm.status === XcpNgBackupStatus.Skipped;
    }).length,
    problemVms: problemVms,
  };

  if (data.run.endedAt) {
    summary.endedAt = data.run.endedAt;
  }
  if (data.run.error) {
    summary.error = data.run.error;
  }

  return summary;
}

function compareRunsNewestFirst(
  left: XcpNgPoolBackupRunSummary,
  right: XcpNgPoolBackupRunSummary,
): number {
  return (
    new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

function describeHaVerdict(verdict: XcpNgHaVerdict): string {
  if (verdict.source === XcpNgHaVerdictSource.Plan) {
    return `its plan covers ${verdict.planExistsFor ?? 0} host failure${
      verdict.planExistsFor === 1 ? "" : "s"
    } of the ${verdict.hostFailuresToTolerate ?? 0} it is set to tolerate`;
  }
  return "fewer than two hosts are up and enabled to restart VMs on";
}

export function processXcpNgPoolEvents(
  input: XcpNgPoolEventsInput,
): XcpNgPoolEventsOutput {
  const now: Date = input.now;
  const pool: XcpNgStoredPool = input.pool;
  const inventory: Inventory = indexInventory(input.inventory);
  const state: XcpNgPoolEventState = readXcpNgPoolEventState(pool.eventState);
  const isXenOrchestra: boolean =
    input.source === XcpNgEventSource.XenOrchestra;

  const output: XcpNgPoolEventsOutput = {
    records: [],
    feed: [],
    columns: {
      eventReadStatus: { source: input.source, problems: input.problems },
      eventState: state,
    },
    vmBackupUpdates: [],
    vmIntervalUpdates: [],
    hostPatchUpdates: [],
    derived: { at: now, vmBackups: [], hostPatches: [] },
  };

  // ---- HA and the master ----

  let masterChangeWritten: boolean = false;
  const hostsUpAndEnabled: number = inventory.hosts.filter(
    (host: XcpNgStoredResource): boolean => {
      return host.isUp === true && host.isEnabled !== false;
    },
  ).length;

  let haEnabled: boolean | null = pool.isHaEnabled;
  let hostFailuresToTolerate: number | null = pool.haHostFailuresToTolerate;
  let planExistsFor: number | null = pool.haPlanExistsFor;
  let overcommitted: boolean | null = pool.isHaOvercommitted;

  if (input.poolState) {
    const read: XcpNgPoolState = input.poolState;
    haEnabled = read.haEnabled;
    // Xen Orchestra does not say the plan: never keep an older XAPI one.
    hostFailuresToTolerate = read.haHostFailuresToTolerate ?? null;
    planExistsFor = read.haPlanExistsFor ?? null;
    overcommitted = read.haOvercommitted ?? null;

    output.columns.isHaEnabled = haEnabled;
    output.columns.haHostFailuresToTolerate = hostFailuresToTolerate;
    output.columns.haPlanExistsFor = planExistsFor;
    output.columns.isHaOvercommitted = overcommitted;

    const master: string | null = read.masterHostUuid
      ? read.masterHostUuid.toLowerCase()
      : null;

    if (master) {
      output.columns.masterHostExternalId = master;
      const previous: string | null = pool.masterHostExternalId
        ? pool.masterHostExternalId.toLowerCase()
        : null;
      if (previous && previous !== master) {
        output.feed.push({
          type: XcpNgPoolFeedEventType.XcpNgPoolMasterChanged,
          markdown: mdText`The pool master moved from **${hostName(
            inventory.byId,
            previous,
          )}** to **${hostName(inventory.byId, master)}**.`.toString(),
          color: Yellow500,
          postedAt: now,
        });
        masterChangeWritten = true;
      }
    }

    if (pool.isHaEnabled !== null && pool.isHaEnabled !== haEnabled) {
      output.feed.push({
        type: XcpNgPoolFeedEventType.XcpNgPoolHaChanged,
        markdown: haEnabled
          ? mdText`High availability was turned on.`.toString()
          : mdText`High availability was turned off: VMs are no longer restarted on another host when theirs fails.`.toString(),
        color: haEnabled ? Green500 : Yellow500,
        postedAt: now,
      });
    }
  }

  const verdict: XcpNgHaVerdict = getXcpNgHaVerdict({
    haEnabled: haEnabled,
    hostFailuresToTolerate: hostFailuresToTolerate,
    planExistsFor: planExistsFor,
    overcommitted: overcommitted,
    hostsUpAndEnabled: hostsUpAndEnabled,
  });

  /*
   * A change of whether HA can tolerate a host failure, against the last
   * read's verdict: HA's own state, or the hosts under it (one disabled).
   */
  const couldTolerate: boolean | undefined = state.haCouldTolerateHostFailure;
  if (
    haEnabled === true &&
    pool.isHaEnabled === true &&
    couldTolerate !== undefined &&
    verdict.canTolerateHostFailure !== null &&
    couldTolerate !== verdict.canTolerateHostFailure
  ) {
    output.feed.push({
      type: XcpNgPoolFeedEventType.XcpNgPoolHaChanged,
      markdown: verdict.canTolerateHostFailure
        ? mdText`High availability can tolerate a host failure again.`.toString()
        : mdText`High availability can no longer tolerate a host failure: ${describeHaVerdict(
            verdict,
          )}.`.toString(),
      color: verdict.canTolerateHostFailure ? Green500 : Red500,
      postedAt: now,
    });
  }

  if (verdict.canTolerateHostFailure === null) {
    delete state.haCouldTolerateHostFailure;
  } else {
    state.haCouldTolerateHostFailure = verdict.canTolerateHostFailure;
  }

  if (haEnabled !== null) {
    output.derived.ha = {
      enabled: haEnabled,
      canTolerateHostFailure: verdict.canTolerateHostFailure,
      hostFailuresToTolerate: verdict.hostFailuresToTolerate,
      planExistsFor: verdict.planExistsFor,
    };
  }

  // ---- Messages ----

  if (input.messagesRead) {
    output.columns.eventsReadAt = now;
  }

  if (isXenOrchestra && input.messageWatermark) {
    state.messageWatermark = input.messageWatermark;
  }

  const openById: Map<string, XcpNgOpenMessage> = new Map();
  for (const open of state.openMessages) {
    openById.set(open.id, open);
  }

  let feedLines: number = 0;
  let feedLinesLeftOut: number = 0;

  for (const message of input.messages) {
    if (message.poolId.toLowerCase() !== pool.poolIdentifier.toLowerCase()) {
      continue;
    }

    const definition: XcpNgMessageDefinition = getXcpNgMessageDefinition({
      name: message.name,
      reportedPriority: message.priority,
    });
    const object: XcpNgEventObject = resolveXcpNgEventObject({
      uuid: message.objectUuid,
      objectClass: message.objectClass,
      definition: definition,
      pool: pool,
      inventory: inventory.byId,
    });
    const alarm: XcpNgAlarmReading | null =
      message.name === "ALARM" ? readXcpNgAlarmBody(message.body) : null;

    output.records.push(
      buildXcpNgMessageLogRecord({
        message: message,
        definition: definition,
        object: object,
        alarm: alarm,
        observedAt: now,
      }),
    );

    // The master's move is written once, from the pool's own state.
    const isMasterMove: boolean =
      definition.alert === XcpNgMessageAlert.PoolMasterChanged;

    if (
      isXcpNgFeedPriority(definition.priority) &&
      !(isMasterMove && masterChangeWritten)
    ) {
      if (feedLines < XCP_NG_MAX_MESSAGE_FEED_LINES) {
        feedLines++;
        const detail: string = alarm
          ? describeXcpNgAlarm(alarm)
          : message.body.trim().substring(0, 300);
        output.feed.push({
          type: XcpNgPoolFeedEventType.XcpNgPoolMessage,
          markdown: detail
            ? mdText`**${definition.title}**: ${object.name}. ${detail}`.toString()
            : mdText`**${definition.title}**: ${object.name}.`.toString(),
          color: getFeedColor(definition.priority),
          postedAt: new Date(message.timestamp),
        });
      } else {
        feedLinesLeftOut++;
      }
    }

    if (isXenOrchestra && isXcpNgMessageClearable(definition.alert)) {
      const open: XcpNgOpenMessage = {
        id: message.uuid,
        name: message.name,
        alert: definition.alert,
        objectType: object.type,
        objectUuid: object.uuid,
        objectName: object.name,
        raisedAt: message.timestamp,
      };
      if (alarm?.variable) {
        open.variable = alarm.variable;
      }
      openById.set(open.id, open);
    }
  }

  if (feedLinesLeftOut > 0) {
    output.feed.push({
      type: XcpNgPoolFeedEventType.XcpNgPoolMessage,
      markdown: mdText`${String(
        feedLinesLeftOut,
      )} more XCP-ng messages arrived in the same minute. Every one is on the pool's Logs page.`.toString(),
      color: Gray500,
      postedAt: now,
    });
  }

  // An alert's group is cleared when its last open message is gone.
  if (isXenOrchestra && input.clearedMessageIds.length > 0) {
    const cleared: Array<XcpNgOpenMessage> = [];
    for (const id of input.clearedMessageIds) {
      const open: XcpNgOpenMessage | undefined = openById.get(id);
      if (open) {
        cleared.push(open);
        openById.delete(id);
      }
    }

    const stillOpenGroups: Set<string> = new Set<string>(
      Array.from(openById.values()).map((open: XcpNgOpenMessage): string => {
        return getXcpNgOpenMessageGroupKey(open);
      }),
    );
    const clearedGroups: Set<string> = new Set<string>();

    for (const open of cleared) {
      const group: string = getXcpNgOpenMessageGroupKey(open);
      if (stillOpenGroups.has(group) || clearedGroups.has(group)) {
        continue;
      }
      clearedGroups.add(group);
      output.records.push(
        buildXcpNgClearedLogRecord({
          open: open,
          priority: getXcpNgMessageDefinition({ name: open.name }).priority,
          observedAt: now,
        }),
      );
    }
  }

  // The newest are kept: an old one beyond the bound is the least likely.
  state.openMessages = Array.from(openById.values())
    .sort((left: XcpNgOpenMessage, right: XcpNgOpenMessage): number => {
      return (
        new Date(left.raisedAt).getTime() - new Date(right.raisedAt).getTime()
      );
    })
    .slice(-XCP_NG_MAX_OPEN_MESSAGES_PER_POOL);

  // ---- Backups ----

  const backupJobs: Array<XcpNgPoolBackupJob> = (pool.backupJobs || []).map(
    (job: XcpNgPoolBackupJob): XcpNgPoolBackupJob => {
      return { ...job, runs: [...(job.runs || [])] };
    },
  );
  let backupJobsChanged: boolean = false;

  if (isXenOrchestra && input.backupRuns !== undefined) {
    if (!input.problems.backups) {
      output.columns.backupsReadAt = now;
    }
    if (!state.backupsWatchedSince) {
      state.backupsWatchedSince = now.toISOString();
    }
    if (input.backupWatermark) {
      state.backupWatermark = input.backupWatermark;
    }

    const poolVmIds: Set<string> = new Set<string>(
      inventory.vms.map((vm: XcpNgStoredResource): string => {
        return vm.externalId.toLowerCase();
      }),
    );
    const vmNames: Map<string, string> = new Map();
    for (const vm of inventory.vms) {
      if (vm.name) {
        vmNames.set(vm.externalId.toLowerCase(), vm.name);
      }
    }
    const jobVmIds: Record<string, Array<string>> = state.jobVmIds || {};

    const runs: Array<XcpNgBackupRun> = [...input.backupRuns].sort(
      (left: XcpNgBackupRun, right: XcpNgBackupRun): number => {
        return (
          new Date(left.startedAt).getTime() -
          new Date(right.startedAt).getTime()
        );
      },
    );

    for (const run of runs) {
      const summary: XcpNgPoolBackupRunSummary | null =
        summarizeXcpNgRunForPool({
          run: run,
          poolVmIds: poolVmIds,
          vmNames: vmNames,
          jobKnownHere:
            Boolean(jobVmIds[run.jobId]) ||
            backupJobs.some((job: XcpNgPoolBackupJob): boolean => {
              return job.jobId === run.jobId;
            }),
        });

      if (!summary) {
        continue;
      }

      let job: XcpNgPoolBackupJob | undefined = backupJobs.find(
        (entry: XcpNgPoolBackupJob): boolean => {
          return entry.jobId === run.jobId;
        },
      );
      if (!job) {
        job = {
          jobId: run.jobId,
          name: run.jobName,
          isScheduled: false,
          runs: [],
          vmCount: 0,
        };
        backupJobs.push(job);
      }

      const isNewest: boolean =
        job.runs.length === 0 ||
        job.runs.every((existing: XcpNgPoolBackupRunSummary): boolean => {
          return (
            new Date(existing.startedAt).getTime() <=
            new Date(summary.startedAt).getTime()
          );
        });

      job.name = run.jobName || job.name;
      if (run.mode) {
        job.mode = run.mode;
      }
      job.runs = [
        summary,
        ...job.runs.filter((existing: XcpNgPoolBackupRunSummary): boolean => {
          return existing.runId !== summary.runId;
        }),
      ]
        .sort(compareRunsNewestFirst)
        .slice(0, XCP_NG_MAX_RUNS_PER_POOL_JOB);

      if (isNewest) {
        job.vmCount = summary.vmCount;
        const included: Array<string> = Array.from(
          new Set<string>([
            ...run.includedVmIds.filter((vmId: string): boolean => {
              return poolVmIds.has(vmId);
            }),
            ...run.vms
              .filter((vm: XcpNgBackupVmResult): boolean => {
                return poolVmIds.has(vm.vmId);
              })
              .map((vm: XcpNgBackupVmResult): string => {
                return vm.vmId;
              }),
          ]),
        );
        if (included.length > 0) {
          jobVmIds[run.jobId] = included;
        }
      }

      if (summary.status === XcpNgBackupStatus.Success) {
        const endedAt: string = summary.endedAt || summary.startedAt;
        if (
          !job.lastSuccessAt ||
          new Date(job.lastSuccessAt).getTime() < new Date(endedAt).getTime()
        ) {
          job.lastSuccessAt = endedAt;
        }
      }
      backupJobsChanged = true;

      output.records.push(
        buildXcpNgBackupLogRecord({
          jobId: run.jobId,
          jobName: job.name,
          mode: job.mode,
          summary: summary,
          observedAt: now,
        }),
      );

      if (summary.status === XcpNgBackupStatus.Failure) {
        output.feed.push({
          type: XcpNgPoolFeedEventType.XcpNgPoolBackupFailed,
          markdown: mdText`${describeXcpNgBackupRun({
            jobName: job.name,
            summary: summary,
          })}`.toString(),
          color: Red500,
          postedAt: new Date(summary.endedAt || summary.startedAt),
        });
      }

      // Each of the pool's VMs in the run: its last backup.
      for (const vm of run.vms) {
        if (!poolVmIds.has(vm.vmId)) {
          continue;
        }
        const at: Date = new Date(
          vm.endedAt || run.endedAt || vm.startedAt || run.startedAt,
        );
        if (isNaN(at.getTime())) {
          continue;
        }
        const isSuccess: boolean = vm.status === XcpNgBackupStatus.Success;
        output.vmBackupUpdates.push({
          vmId: vm.vmId,
          lastBackupAt: at,
          lastBackupStatus: vm.status,
          lastBackupJobName: job.name.substring(0, MAX_JOB_NAME_LENGTH),
          lastBackupError: isSuccess ? null : vm.error || null,
          lastBackupBytes:
            vm.bytes !== undefined && Number.isFinite(vm.bytes)
              ? vm.bytes
              : null,
          lastSuccessfulBackupAt: isSuccess ? at : null,
        });
      }
    }

    state.jobVmIds = jobVmIds;
  }

  // Each job's name and how often it runs, when the jobs were read.
  if (isXenOrchestra && input.backupJobs !== undefined) {
    const known: Map<string, XcpNgBackupJobInfo> = new Map();
    for (const info of input.backupJobs) {
      known.set(info.jobId, info);
    }

    for (let index: number = backupJobs.length - 1; index >= 0; index--) {
      const job: XcpNgPoolBackupJob = backupJobs[index] as XcpNgPoolBackupJob;
      const info: XcpNgBackupJobInfo | undefined = known.get(job.jobId);

      if (!info) {
        // The job was deleted in Xen Orchestra.
        backupJobs.splice(index, 1);
        if (state.jobVmIds) {
          delete state.jobVmIds[job.jobId];
        }
        backupJobsChanged = true;
        continue;
      }

      const intervalSeconds: number | null = getXcpNgBackupJobIntervalSeconds({
        schedules: info.schedules,
        now: now,
      });
      const isScheduled: boolean = intervalSeconds !== null;

      if (
        job.name !== info.name ||
        job.isScheduled !== isScheduled ||
        (job.intervalSeconds ?? null) !== intervalSeconds ||
        (info.mode && job.mode !== info.mode) ||
        (info.jobType && job.jobType !== info.jobType)
      ) {
        backupJobsChanged = true;
      }

      job.name = info.name;
      job.isScheduled = isScheduled;
      if (intervalSeconds === null) {
        delete job.intervalSeconds;
      } else {
        job.intervalSeconds = intervalSeconds;
      }
      if (info.mode) {
        job.mode = info.mode;
      }
      if (info.jobType) {
        job.jobType = info.jobType;
      }
    }
  }

  if (backupJobsChanged) {
    backupJobs.sort((left: XcpNgPoolBackupJob, right: XcpNgPoolBackupJob) => {
      return left.name.localeCompare(right.name);
    });
    output.columns.backupJobs = backupJobs.slice(
      0,
      XCP_NG_MAX_POOL_BACKUP_JOBS,
    );
  }

  // Each VM's backup interval: the shortest of its scheduled jobs'.
  if (isXenOrchestra && (backupJobsChanged || input.backupRuns !== undefined)) {
    const intervals: Map<string, number> = new Map();
    for (const job of backupJobs) {
      if (!job.isScheduled || !job.intervalSeconds) {
        continue;
      }
      for (const vmId of state.jobVmIds?.[job.jobId] || []) {
        const current: number | undefined = intervals.get(vmId);
        if (current === undefined || job.intervalSeconds < current) {
          intervals.set(vmId, job.intervalSeconds);
        }
      }
    }

    for (const vm of inventory.vms) {
      const vmId: string = vm.externalId.toLowerCase();
      const next: number | null = intervals.get(vmId) ?? null;
      if ((vm.backupIntervalSeconds ?? null) !== next) {
        output.vmIntervalUpdates.push({ vmId: vmId, intervalSeconds: next });
        vm.backupIntervalSeconds = next;
      }
    }
  }

  // Overdue, from each VM's newest successful backup after this run.
  if (isXenOrchestra) {
    const newestSuccess: Map<string, Date> = new Map();
    for (const update of output.vmBackupUpdates) {
      if (update.lastSuccessfulBackupAt) {
        const known: Date | undefined = newestSuccess.get(update.vmId);
        if (!known || known < update.lastSuccessfulBackupAt) {
          newestSuccess.set(update.vmId, update.lastSuccessfulBackupAt);
        }
      }
    }

    const watchedSince: Date | null = state.backupsWatchedSince
      ? new Date(state.backupsWatchedSince)
      : null;

    for (const vm of inventory.vms) {
      if (!vm.backupIntervalSeconds) {
        continue;
      }
      const vmId: string = vm.externalId.toLowerCase();
      const fresh: Date | undefined = newestSuccess.get(vmId);
      const lastSuccess: Date | null =
        fresh &&
        (!vm.lastSuccessfulBackupAt || fresh > vm.lastSuccessfulBackupAt)
          ? fresh
          : vm.lastSuccessfulBackupAt;

      output.derived.vmBackups.push({
        vmId: vmId,
        vmName: vm.name || `VM ${shortId(vmId)}`,
        overdue: isXcpNgVmBackupOverdue({
          intervalSeconds: vm.backupIntervalSeconds,
          lastSuccessfulBackupAt: lastSuccess,
          watchedSince: watchedSince,
          now: now,
        }),
      });
    }
  }

  // ---- Patches ----

  if (isXenOrchestra && input.patchesChecked) {
    output.columns.patchesCheckedAt = now;
  }

  const patchCounts: Map<string, number> = new Map();
  for (const host of inventory.hosts) {
    if (
      host.missingPatchCount !== null &&
      host.missingPatchCount !== undefined
    ) {
      patchCounts.set(host.externalId.toLowerCase(), host.missingPatchCount);
    }
  }

  if (isXenOrchestra && input.hostPatches) {
    for (const checked of input.hostPatches) {
      const hostId: string = checked.hostId.toLowerCase();
      const row: XcpNgStoredResource | undefined = inventory.byId.get(hostId);
      if (!row || row.kind !== XcpNgResourceKind.Host) {
        continue;
      }
      output.hostPatchUpdates.push(checked);
      patchCounts.set(hostId, checked.patchCount);
    }
  }

  for (const host of inventory.hosts) {
    const hostId: string = host.externalId.toLowerCase();
    const count: number | undefined = patchCounts.get(hostId);
    if (count !== undefined) {
      output.derived.hostPatches.push({
        hostId: hostId,
        hostName: host.name || `Host ${shortId(hostId)}`,
        count: count,
      });
    }
  }

  output.columns.eventState = state;
  return output;
}
