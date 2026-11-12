import Monitor from "../../Models/DatabaseModels/Monitor";
import Query from "../../Types/BaseDatabase/Query";
import MonitoringOff from "./MonitoringOff";

/*
 * WHICH MONITORS ARE NOT OPERATIONAL.
 *
 * A monitor whose current status is not an operational one - Degraded,
 * Offline, or a status of the project's own - among the monitors that are
 * checked. Two kinds are left out: nothing checks them, so the status each
 * still holds is only what the last check saw before it stopped, and it is
 * no problem anyone can act on as one:
 *
 * - an archived monitor, which is gone from the Monitors list as well, and
 * - a monitor whose monitoring is turned off, which the Monitors menu's
 *   Disabled list shows instead (issue #6400). Turning monitoring off
 *   resolves the incidents and alerts it would have resolved itself
 *   (Server/Utils/Monitor/MonitorTurnedOff), so nothing of it is left
 *   looking like a live problem.
 *
 * A monitor paused by an incident declared by hand or by a scheduled
 * maintenance event stays in: what paused it is what its status shows.
 *
 * The one rule for each list and count that says "not operational": the
 * Monitors and Home menus' Not Operational pages and badges, Home's attention
 * strip, the Monitor List widget's "non-operational" filter on a dashboard
 * and a public dashboard, and OneUptime AI's query_monitors with
 * problemsOnly. The checked monitors are MonitoringOff's.
 */
export default class NotOperationalMonitorQuery {
  public static getQuery(): Query<Monitor> {
    return {
      ...MonitoringOff.getMonitoredQuery(),
      currentMonitorStatus: {
        isOperationalState: false,
      },
    };
  }
}
