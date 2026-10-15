import {
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportProgress,
  DiscoveryImportStatus,
  DiscoveryImportView,
  countSettledDevices,
  countSettledMonitors,
  getRetryableHostResults,
} from "Common/Types/NetworkDevice/DiscoveryImport";

/*
 * WHAT THE PROGRESS VIEW SAYS ABOUT AN IMPORT (OneUptime issue #4812).
 *
 * Progress anyone can trust: devices and monitors counted apart, because
 * they are separate work that fails separately (a device imports while the
 * plan refuses its monitor); every failure listed with the server's reason,
 * hosts that failed for the same reason together; the finished summary; and
 * exactly how many hosts "Retry" would try again.
 *
 * Worked out from the import as the server describes it - the same record
 * whoever opens the dialog, whenever they open it. React-free.
 */

export enum DiscoveryImportPhase {
  // Queued, and about to start.
  Starting = "Starting",
  // Queued behind another import of the project.
  Waiting = "Waiting",
  Running = "Running",
  // Running, and asked to stop.
  Stopping = "Stopping",
  Finished = "Finished",
  Stopped = "Stopped",
  Failed = "Failed",
}

/*
 * A queued import is normally picked up within a second or two. One still
 * queued after this long is waiting for an earlier import of the project.
 */
export const DISCOVERY_IMPORT_WAITING_AFTER_MS: number = 15 * 1000;

export enum DiscoveryImportIssueKind {
  // The device could not be created.
  DeviceFailed = "DeviceFailed",
  // The import stopped before it got to the host.
  NotReached = "NotReached",
  // The device is in; its monitor was refused.
  MonitorFailed = "MonitorFailed",
  // The device is in; there was nothing to make a monitor for.
  MonitorSkipped = "MonitorSkipped",
}

export interface DiscoveryImportIssueHost {
  name: string;
  ipAddress: string;
  deviceId?: string | undefined;
}

// Hosts that ended the same way for the same reason, listed once.
export interface DiscoveryImportIssueGroup {
  kind: DiscoveryImportIssueKind;
  // The server's sentence, as written.
  reason: string;
  hosts: Array<DiscoveryImportIssueHost>;
}

export interface DiscoveryImportProgressModel {
  phase: DiscoveryImportPhase;
  isActive: boolean;
  hostCount: number;
  devicesSettled: number;
  monitorsRequested: number;
  monitorsSettled: number;
  // 0-100, of the hosts whose device and monitor are both settled.
  overallPercent: number;
  progress: DiscoveryImportProgress;
  // Hosts "Retry" would try again.
  retryableCount: number;
  issueGroups: Array<DiscoveryImportIssueGroup>;
  // The list of issues is cut short: more hosts failed than it carries.
  hasMoreIssues: boolean;
}

export function getDiscoveryImportPhase(
  view: DiscoveryImportView,
  now: number = Date.now(),
): DiscoveryImportPhase {
  switch (view.status) {
    case DiscoveryImportStatus.Queued: {
      const createdAt: number = new Date(view.createdAt).getTime();

      return Number.isFinite(createdAt) &&
        now - createdAt > DISCOVERY_IMPORT_WAITING_AFTER_MS
        ? DiscoveryImportPhase.Waiting
        : DiscoveryImportPhase.Starting;
    }
    case DiscoveryImportStatus.Running:
      return view.isStopRequested
        ? DiscoveryImportPhase.Stopping
        : DiscoveryImportPhase.Running;
    case DiscoveryImportStatus.Completed:
      return DiscoveryImportPhase.Finished;
    case DiscoveryImportStatus.Stopped:
      return DiscoveryImportPhase.Stopped;
    default:
      return DiscoveryImportPhase.Failed;
  }
}

export function getDiscoveryImportIssueKind(
  result: DiscoveryImportHostResult,
): DiscoveryImportIssueKind | null {
  if (result.device === DiscoveryImportDeviceOutcome.Failed) {
    return DiscoveryImportIssueKind.DeviceFailed;
  }

  if (result.device === DiscoveryImportDeviceOutcome.NotReached) {
    return DiscoveryImportIssueKind.NotReached;
  }

  if (result.monitor === DiscoveryImportMonitorOutcome.Failed) {
    return DiscoveryImportIssueKind.MonitorFailed;
  }

  if (result.monitor === DiscoveryImportMonitorOutcome.Skipped) {
    return DiscoveryImportIssueKind.MonitorSkipped;
  }

  return null;
}

// The order the issue groups are listed in: what to act on first.
const ISSUE_ORDER: Array<DiscoveryImportIssueKind> = [
  DiscoveryImportIssueKind.DeviceFailed,
  DiscoveryImportIssueKind.MonitorFailed,
  DiscoveryImportIssueKind.NotReached,
  DiscoveryImportIssueKind.MonitorSkipped,
];

export function groupDiscoveryImportIssues(
  results: ReadonlyArray<DiscoveryImportHostResult>,
): Array<DiscoveryImportIssueGroup> {
  const groups: Array<DiscoveryImportIssueGroup> = [];
  const byKey: Map<string, DiscoveryImportIssueGroup> = new Map<
    string,
    DiscoveryImportIssueGroup
  >();

  for (const result of results) {
    const kind: DiscoveryImportIssueKind | null =
      getDiscoveryImportIssueKind(result);

    if (!kind) {
      continue;
    }

    const reason: string =
      (kind === DiscoveryImportIssueKind.DeviceFailed ||
      kind === DiscoveryImportIssueKind.NotReached
        ? result.deviceError
        : result.monitorError) || "";

    const key: string = JSON.stringify([kind, reason]);
    let group: DiscoveryImportIssueGroup | undefined = byKey.get(key);

    if (!group) {
      group = { kind: kind, reason: reason, hosts: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    const host: DiscoveryImportIssueHost = {
      name: result.name || result.ipAddress,
      ipAddress: result.ipAddress,
    };

    if (result.deviceId) {
      host.deviceId = result.deviceId;
    }

    group.hosts.push(host);
  }

  return groups.sort(
    (a: DiscoveryImportIssueGroup, b: DiscoveryImportIssueGroup): number => {
      return ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind);
    },
  );
}

/*
 * How many hosts Retry tries again: worked out from the results when the
 * view carries them all, else from the counts - a monitor fails only on a
 * device that is in, so the three counts never cover one host twice.
 */
export function countRetryableHosts(view: DiscoveryImportView): number {
  if (view.results && !view.hasMoreResults) {
    return getRetryableHostResults(view.results).length;
  }

  return (
    view.progress.devicesFailed +
    view.progress.devicesNotReached +
    view.progress.monitorsFailed
  );
}

export function getDiscoveryImportProgressModel(
  view: DiscoveryImportView,
  now: number = Date.now(),
): DiscoveryImportProgressModel {
  const phase: DiscoveryImportPhase = getDiscoveryImportPhase(view, now);
  const progress: DiscoveryImportProgress = view.progress;
  const isActive: boolean =
    view.status === DiscoveryImportStatus.Queued ||
    view.status === DiscoveryImportStatus.Running;

  return {
    phase: phase,
    isActive: isActive,
    hostCount: progress.hosts,
    devicesSettled: countSettledDevices(progress),
    monitorsRequested: progress.monitorsRequested,
    monitorsSettled: countSettledMonitors(progress),
    overallPercent:
      progress.hosts > 0
        ? Math.min(
            100,
            Math.floor((progress.hostsDone * 100) / progress.hosts),
          )
        : 0,
    progress: progress,
    retryableCount: isActive ? 0 : countRetryableHosts(view),
    issueGroups: groupDiscoveryImportIssues(view.results || []),
    hasMoreIssues: Boolean(view.hasMoreResults),
  };
}
