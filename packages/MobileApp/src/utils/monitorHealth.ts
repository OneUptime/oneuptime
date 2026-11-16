import {
  isFirstCheckOverdue,
  isStatusUnmeasured,
  type FirstCheckScheduleFields,
  type MonitorFirstCheckFields,
} from "./monitorFirstCheck";

/*
 * WHICH MONITORS ARE LISTED, WHAT EACH ONE'S ROW SAYS, AND WHICH OF THEM
 * HAVE AN ISSUE - the rules the web app reads, kept here because the app is
 * built without Common's runtime code. Their sources:
 *
 *   - Common/Utils/Monitor/MonitoringOff: a monitor whose monitoring is turned
 *     off (`disableActiveMonitoring`) is not checked, so the status it still
 *     holds - "Offline", say - is only what its last check saw. Turning it off
 *     resolves the incidents and alerts it would have resolved itself, so
 *     nothing of it is left open as a live problem.
 *   - Common/Utils/Monitor/NotOperationalMonitorQuery: a monitor has an issue
 *     when its status is not an operational one, among the monitors that are
 *     checked - neither archived nor turned off.
 *   - Common/Models/DatabaseModels/Monitor isArchived: archiving retires a
 *     monitor and takes it out of every monitor list.
 *   - Common/Utils/Monitor/MonitorRowStatus: what a row says a monitor's
 *     status is - the words the Monitors list, the Monitor List widget and
 *     the monitor's own page say - wherever the stored status is not one a
 *     check stands behind: Archived, Disabled, Probes Not Enabled, Probes
 *     Disconnected, and - for a monitor nothing has checked yet, still in
 *     the operational status it was created in (utils/monitorFirstCheck) -
 *     Paused, No results yet or Waiting for data (issue #8961).
 *
 * So the Monitors screen lists no archived monitor; a monitor whose
 * monitoring is off is Disabled and never an issue whatever its last status
 * was; a monitor with an operational status that no check stands behind -
 * nothing has checked it yet, or no probe checks it - is Not checked, never
 * Healthy; and Home's Monitor issues, Monitors and Disabled counts ask the
 * server for exactly the monitors the screen puts under Issues, lists, and
 * puts under Disabled.
 *
 * Common's suite runs this file next to those rules
 * (MonitorHealthMobileParity), so the two cannot drift apart. Its only
 * imports are the app's other copies (./monitorFirstCheck, and its
 * ./cronSchedule): that suite runs them as they are, outside the app.
 */

export type MonitorHealth =
  | "disabled"
  | "issue"
  | "notChecked"
  | "healthy"
  | "unknown";

// Common's MonitorRowStatusKind, value for value.
export type MonitorRowStatusKind =
  | "Archived"
  | "MonitoringOff"
  | "NoProbeEnabled"
  | "ProbesDisconnected"
  // Never measured, and its checks held by an incident or maintenance.
  | "PausedBeforeFirstCheck"
  // Never measured, and its first result is overdue.
  | "NoResultsYet"
  // Never measured, and its first result not due yet (or never due).
  | "WaitingForData"
  // The monitor's own status.
  | "Status"
  // Read with no status at all.
  | "NoStatus";

/*
 * How OneUptime's words are drawn: gray for what says nothing about the
 * monitor's health, red for no probe checking it, amber for a first result
 * that is late - the web's row colours.
 */
export type MonitorRowStatusTone = "neutral" | "danger" | "warning";

export interface MonitorRowStatus {
  kind: MonitorRowStatusKind;
  // OneUptime's words; otherwise the monitor's status name as stored.
  text: string;
  // Whether text is OneUptime's words rather than a status's name.
  isProductWords: boolean;
  /*
   * The tone OneUptime's words are drawn in; null where the monitor's own
   * status is drawn, in its own colour (none for a monitor with no status).
   */
  tone: MonitorRowStatusTone | null;
}

export interface MonitorHealthFields
  extends MonitorFirstCheckFields,
    FirstCheckScheduleFields {
  isArchived?: boolean | null | undefined;
  disableActiveMonitoring?: boolean | null | undefined;
  disableActiveMonitoringBecauseOfManualIncident?: boolean | null | undefined;
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?:
    | boolean
    | null
    | undefined;
  isNoProbeEnabledOnThisMonitor?: boolean | null | undefined;
  isAllProbesDisconnectedFromThisMonitor?: boolean | null | undefined;
  currentMonitorStatus?:
    | {
        name?: string | null | undefined;
        isOperationalState?: boolean | null | undefined;
        isOfflineState?: boolean | null | undefined;
      }
    | null
    | undefined;
}

// OneUptime's words for each kind that is not the monitor's own status.
export const MONITOR_ROW_STATUS_WORDS: Readonly<
  Record<Exclude<MonitorRowStatusKind, "Status">, string>
> = {
  Archived: "Archived",
  MonitoringOff: "Disabled",
  NoProbeEnabled: "Probes Not Enabled",
  ProbesDisconnected: "Probes Disconnected",
  PausedBeforeFirstCheck: "Paused",
  NoResultsYet: "No results yet",
  WaitingForData: "Waiting for data",
  // The word for a monitor read with no status, or a status with no name.
  NoStatus: "Unknown",
};

export const MONITOR_ROW_STATUS_TONES: Readonly<
  Record<
    Exclude<MonitorRowStatusKind, "Status" | "NoStatus">,
    MonitorRowStatusTone
  >
> = {
  Archived: "neutral",
  MonitoringOff: "neutral",
  NoProbeEnabled: "danger",
  ProbesDisconnected: "danger",
  PausedBeforeFirstCheck: "neutral",
  NoResultsYet: "warning",
  WaitingForData: "neutral",
};

/*
 * Every field the row rule reads, as a select: the flags that say nothing
 * checks a monitor, whether anything has measured it, when it was created
 * and how often it is checked, and its status with what tells the one a
 * monitor starts in. Common's MONITOR_ROW_STATUS_SELECT, field for field. A
 * fresh object each time, so nothing a caller adds to one reaches another.
 */
export function getMonitorRowStatusSelect(): Record<string, unknown> {
  return {
    isArchived: true,
    disableActiveMonitoring: true,
    disableActiveMonitoringBecauseOfManualIncident: true,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    isNoProbeEnabledOnThisMonitor: true,
    isAllProbesDisconnectedFromThisMonitor: true,
    monitorType: true,
    firstMeasuredAt: true,
    createdAt: true,
    monitoringInterval: true,
    currentMonitorStatus: {
      name: true,
      color: true,
      isOperationalState: true,
      isOfflineState: true,
    },
  };
}

function ownWords(
  kind: Exclude<MonitorRowStatusKind, "Status" | "NoStatus">,
): MonitorRowStatus {
  return {
    kind: kind,
    text: MONITOR_ROW_STATUS_WORDS[kind],
    isProductWords: true,
    tone: MONITOR_ROW_STATUS_TONES[kind],
  };
}

/*
 * What a row - and the monitor's own screen - says the monitor's status is.
 * First match wins, in the web's order: why nothing checks the monitor
 * (archived, monitoring off, no probe), then why nothing has yet (paused,
 * overdue, waiting), then its status. `now` decides whether a first result
 * is overdue; it defaults to the current time.
 */
export function getMonitorRowStatus(
  monitor: MonitorHealthFields,
  now?: Date | undefined,
): MonitorRowStatus {
  if (monitor.isArchived === true) {
    return ownWords("Archived");
  }

  if (monitor.disableActiveMonitoring === true) {
    return ownWords("MonitoringOff");
  }

  if (monitor.isNoProbeEnabledOnThisMonitor === true) {
    return ownWords("NoProbeEnabled");
  }

  if (monitor.isAllProbesDisconnectedFromThisMonitor === true) {
    return ownWords("ProbesDisconnected");
  }

  if (isStatusUnmeasured(monitor)) {
    if (
      monitor.disableActiveMonitoringBecauseOfManualIncident === true ||
      monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
    ) {
      return ownWords("PausedBeforeFirstCheck");
    }

    if (isFirstCheckOverdue({ monitor: monitor, now: now || new Date() })) {
      return ownWords("NoResultsYet");
    }

    return ownWords("WaitingForData");
  }

  const status: MonitorHealthFields["currentMonitorStatus"] =
    monitor.currentMonitorStatus;

  if (!status) {
    return {
      kind: "NoStatus",
      text: MONITOR_ROW_STATUS_WORDS.NoStatus,
      isProductWords: true,
      tone: null,
    };
  }

  return {
    kind: "Status",
    text: status.name || MONITOR_ROW_STATUS_WORDS.NoStatus,
    isProductWords: !status.name,
    tone: null,
  };
}

/*
 * Every monitor the app lists and counts as a monitor of the project: all of
 * them but the archived ones. A fresh object each time, so nothing a caller
 * adds to one query reaches another.
 */
export function getListedMonitorsQuery(): Record<string, unknown> {
  return { isArchived: false };
}

// The listed monitors whose monitoring is turned off: the Disabled ones.
export function getDisabledMonitorsQuery(): Record<string, unknown> {
  return { isArchived: false, disableActiveMonitoring: true };
}

/*
 * The listed monitors with an issue: monitoring on, and a status that is not
 * an operational one. NotOperationalMonitorQuery, word for word.
 */
export function getMonitorIssuesQuery(): Record<string, unknown> {
  return {
    isArchived: false,
    disableActiveMonitoring: false,
    currentMonitorStatus: { isOperationalState: false },
  };
}

/*
 * Where a listed monitor belongs. Disabled comes first and wins: a monitor
 * whose monitoring is off is neither an issue nor healthy, whatever status
 * its last check left. Otherwise only the server's semantic flag decides
 * between an issue and an operational status - status names are the
 * project's own and editable - and a monitor read without a status is
 * unknown, not healthy. An operational status is Healthy only where a check
 * stands behind it, as its row says: one that nothing has checked yet, or
 * that no probe checks, is Not checked (its row says Waiting for data, No
 * results yet, Paused, Probes Not Enabled or Probes Disconnected).
 */
export function getMonitorHealth(monitor: MonitorHealthFields): MonitorHealth {
  if (monitor.disableActiveMonitoring === true) {
    return "disabled";
  }

  const operationalState: boolean | null | undefined =
    monitor.currentMonitorStatus?.isOperationalState;

  if (operationalState === false) {
    return "issue";
  }

  if (operationalState !== true) {
    return "unknown";
  }

  if (
    monitor.isNoProbeEnabledOnThisMonitor === true ||
    monitor.isAllProbesDisconnectedFromThisMonitor === true ||
    isStatusUnmeasured(monitor)
  ) {
    return "notChecked";
  }

  return "healthy";
}
