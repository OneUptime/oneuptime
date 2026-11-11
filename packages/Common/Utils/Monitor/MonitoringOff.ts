import Monitor from "../../Models/DatabaseModels/Monitor";
import Query from "../../Types/BaseDatabase/Query";

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
 */

// What a monitor is read with before isOff can answer for it.
export const MONITORING_OFF_SELECT: { disableActiveMonitoring: true } = {
  disableActiveMonitoring: true,
};

export interface MonitoringOffFlags {
  disableActiveMonitoring?: boolean | undefined | null;
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
}
