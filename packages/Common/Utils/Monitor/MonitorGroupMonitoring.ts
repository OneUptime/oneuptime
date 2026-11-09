import { JSONObject } from "../../Types/JSON";

/*
 * MONITORING FOR EVERY MONITOR OF A MONITOR GROUP (issue #6401).
 *
 * A monitor group's Overview has a Monitoring card that says how many of the
 * group's monitors are checked, and turns monitoring off or on for every one
 * of them at once - the whole group, not the page of a list a bulk action
 * reaches. Nothing is stored on the group: it reads as off when monitoring
 * is off for every monitor in it, and its Current Status then says
 * "Disabled", as a monitor's does.
 *
 * Archived monitors are left out of the count and of the switch: nothing
 * checks them whatever their switch says, and they do not count towards
 * the group's status either (ArchivedMonitorResources).
 *
 * What the server answers (MonitorGroupAPI's monitoring-summary,
 * turn-monitoring-off and turn-monitoring-on) and how the dashboard reads
 * it, in one place.
 */

export interface MonitorGroupMonitoringSummary {
  // The group's monitors that are not archived: the ones the switch turns.
  monitorCount: number;
  // Of those, the ones whose monitoring is turned off.
  monitoringOffCount: number;
}

export interface MonitorGroupMonitoringChange
  extends MonitorGroupMonitoringSummary {
  // How many monitors the press turned off, or on.
  changedCount: number;
}

// A monitor as the summary reads it: its own switch, stored the other way round.
export interface MonitorWithMonitoringSwitch {
  disableActiveMonitoring?: boolean | null | undefined;
}

export enum MonitorGroupMonitoringState {
  // No monitor to check: the group is empty, or holds archived ones only.
  NoMonitors = "NoMonitors",
  // Monitoring is on for every monitor.
  On = "On",
  // Monitoring is off for every monitor: the group reads as Disabled.
  Off = "Off",
  // On for some, off for others.
  Mixed = "Mixed",
}

export default class MonitorGroupMonitoring {
  // The summary of the monitors given: pass the group's unarchived ones.
  public static getSummary(
    monitors: Array<MonitorWithMonitoringSwitch>,
  ): MonitorGroupMonitoringSummary {
    return {
      monitorCount: monitors.length,
      monitoringOffCount: monitors.filter(
        (monitor: MonitorWithMonitoringSwitch): boolean => {
          return monitor.disableActiveMonitoring === true;
        },
      ).length,
    };
  }

  public static getState(
    summary: MonitorGroupMonitoringSummary,
  ): MonitorGroupMonitoringState {
    if (summary.monitorCount <= 0) {
      return MonitorGroupMonitoringState.NoMonitors;
    }

    if (summary.monitoringOffCount <= 0) {
      return MonitorGroupMonitoringState.On;
    }

    if (summary.monitoringOffCount >= summary.monitorCount) {
      return MonitorGroupMonitoringState.Off;
    }

    return MonitorGroupMonitoringState.Mixed;
  }

  // The group reads as off - "Disabled" - when monitoring is off for every monitor.
  public static isMonitoringOffForEveryMonitor(
    summary: MonitorGroupMonitoringSummary | null | undefined,
  ): boolean {
    return (
      Boolean(summary) &&
      MonitorGroupMonitoring.getState(summary!) ===
        MonitorGroupMonitoringState.Off
    );
  }

  public static toJSON(
    summary: MonitorGroupMonitoringSummary | MonitorGroupMonitoringChange,
  ): JSONObject {
    const json: JSONObject = {
      monitorCount: summary.monitorCount,
      monitoringOffCount: summary.monitoringOffCount,
    };

    if ("changedCount" in summary) {
      json["changedCount"] = summary.changedCount;
    }

    return json;
  }

  /*
   * The summary in a server answer. Null when it is not one - a count that
   * is missing, is no whole number, or is more off than there are monitors -
   * so a page shows nothing rather than a wrong count.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): MonitorGroupMonitoringSummary | null {
    if (!json || typeof json !== "object") {
      return null;
    }

    const monitorCount: unknown = json["monitorCount"];
    const monitoringOffCount: unknown = json["monitoringOffCount"];

    if (
      !MonitorGroupMonitoring.isCount(monitorCount) ||
      !MonitorGroupMonitoring.isCount(monitoringOffCount) ||
      monitoringOffCount > monitorCount
    ) {
      return null;
    }

    return {
      monitorCount: monitorCount,
      monitoringOffCount: monitoringOffCount,
    };
  }

  private static isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
}
