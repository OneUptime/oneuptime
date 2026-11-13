/*
 * WHICH MONITORS ARE LISTED, AND WHICH OF THEM HAVE AN ISSUE - the rule the
 * web app reads, kept here because the app is built without Common's runtime
 * code. Its sources:
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
 *
 * So the Monitors screen lists no archived monitor, a monitor whose
 * monitoring is off is Disabled and never an issue whatever its last status
 * was, and Home's Monitor issues, Monitors and Disabled counts ask the server
 * for exactly the monitors the screen puts under Issues, lists, and puts
 * under Disabled.
 *
 * Common's test suite runs this file next to those rules
 * (MonitorHealthMobileParity), so the two cannot drift apart. It must import
 * nothing: that suite runs it as it is, outside the app.
 */

export type MonitorHealth = "disabled" | "issue" | "healthy" | "unknown";

export interface MonitorHealthFields {
  disableActiveMonitoring?: boolean | null | undefined;
  currentMonitorStatus?:
    | {
        isOperationalState?: boolean | null | undefined;
      }
    | null
    | undefined;
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
 * its last check left. Otherwise only the server's semantic flag decides -
 * status names are the project's own and editable - and a monitor read
 * without a status is unknown, not healthy.
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

  if (operationalState === true) {
    return "healthy";
  }

  return "unknown";
}
