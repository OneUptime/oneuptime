import Monitor from "../../Models/DatabaseModels/Monitor";
import Query from "../../Types/BaseDatabase/Query";
import MonitorNotCheckedReason from "../../Types/Monitor/MonitorNotCheckedReason";

/*
 * A MONITOR WHOSE MONITORING IS TURNED OFF.
 *
 * Someone switched the monitor's monitoring off (`disableActiveMonitoring`),
 * so nothing checks it: the status it still holds - "Offline", say - is only
 * what its last check saw before that, and it will not change until its
 * monitoring is turned on again. Turning it off resolves the incidents and
 * alerts it would have resolved itself (Server/Utils/Monitor/MonitorTurnedOff),
 * so nothing of it is left open as a live problem either.
 *
 * So wherever a monitor's status is read as live - a status filter, a
 * problem count, an order that puts problems first, a status drawn beside
 * its name - a monitor whose monitoring is off is not one of the monitors
 * that status speaks for. It is still a monitor of the project, and a list
 * of all of them keeps it, saying "Disabled" (the Monitors table's word)
 * instead of the frozen status.
 *
 * An archived monitor is not checked either, and it has left every monitor
 * list (Models/DatabaseModels/Monitor isArchived), so the monitors whose
 * status is live are the ones neither archived nor turned off. A monitor
 * paused by an incident declared by hand or by a scheduled maintenance event
 * is one of them: what paused it is what its status shows.
 *
 * Read by NotOperationalMonitorQuery (every Not Operational list and count),
 * the Monitor List widget on a dashboard and on a public dashboard
 * (Utils/Dashboard/MonitorListWidgetFormat), OneUptime AI's query_monitors
 * and a monitor page's Ask AI context. The mobile app keeps its own copy of
 * the rule (MobileApp/src/utils/monitorHealth.ts), held to this one by
 * Tests/Utils/Monitor/MonitorHealthMobileParity.test.ts.
 *
 * isMonitored is getMonitoredQuery for a monitor already read. A network
 * device backed by a monitor takes its status from that monitor only while
 * it is monitored (NetworkDeviceService.refreshStampedMonitorStatus,
 * NetworkSiteService.onMonitorStatusChanged): otherwise the device has no
 * status, so neither its site's roll-up, the Network Map nor the site's
 * alerts count it, and its pages say why (Monitoring off, Monitor archived).
 */

// What a monitor is read with before isOff can answer for it.
export const MONITORING_OFF_SELECT: { disableActiveMonitoring: true } = {
  disableActiveMonitoring: true,
};

export interface MonitoringOffFlags {
  disableActiveMonitoring?: boolean | undefined | null;
}

// What a monitor is read with before isMonitored can answer for it.
export const MONITORED_SELECT: {
  isArchived: true;
  disableActiveMonitoring: true;
} = {
  isArchived: true,
  disableActiveMonitoring: true,
};

export interface MonitoredFlags extends MonitoringOffFlags {
  isArchived?: boolean | undefined | null;
}

export default class MonitoringOff {
  /*
   * Whether the monitor's monitoring is turned off. Only an explicit true is:
   * the column is NOT NULL and defaults to false, so a monitor read without
   * it was read without the column, not turned off.
   */
  public static isOff(monitor: MonitoringOffFlags | null | undefined): boolean {
    return monitor?.disableActiveMonitoring === true;
  }

  /*
   * The monitors whose status is live: not archived, monitoring on. A fresh
   * object each time, so a caller that adds to it changes no one else's.
   */
  public static getMonitoredQuery(): Query<Monitor> {
    return {
      isArchived: false,
      disableActiveMonitoring: false,
    };
  }

  /*
   * Whether the monitor's status is live: neither archived nor turned off,
   * as getMonitoredQuery finds monitors, for one already read (with
   * MONITORED_SELECT). Only an explicit true sets either flag, as in isOff:
   * a monitor read without them - or not found at all - counts as
   * monitored, so a read that forgets them shows a frozen status rather
   * than hiding a live one.
   */
  public static isMonitored(
    monitor: MonitoredFlags | null | undefined,
  ): boolean {
    return monitor?.isArchived !== true && !MonitoringOff.isOff(monitor);
  }

  /*
   * Why nothing checks the monitor (read with MONITORED_SELECT), or null
   * when it is checked - exactly when isMonitored is false, so the two never
   * disagree. Archived wins when both are set: unarchiving is what puts the
   * monitor back, and its switch only matters after that. The device pages'
   * "Monitor archived" and "Monitoring off" qualifiers and the Network Map's
   * device nodes say this reason (issue #7346).
   */
  public static getNotCheckedReason(
    monitor: MonitoredFlags | null | undefined,
  ): MonitorNotCheckedReason | null {
    if (monitor?.isArchived === true) {
      return MonitorNotCheckedReason.MonitorArchived;
    }

    if (MonitoringOff.isOff(monitor)) {
      return MonitorNotCheckedReason.MonitoringOff;
    }

    return null;
  }
}
