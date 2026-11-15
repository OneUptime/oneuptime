import Monitor from "../../Models/DatabaseModels/Monitor";
import Query from "../../Types/BaseDatabase/Query";
import ObjectID from "../../Types/ObjectID";
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
  /*
   * Given the project the monitors are read in, the status is asked of that
   * project too (issue #8096). A monitor's statuses are its project's own,
   * so the answer is the same, but Postgres can then start from the
   * project's few statuses that are not operational and read only the
   * monitors that hold one (the index on currentMonitorStatusId), where it
   * otherwise reads every monitor of the project and joins each to its
   * status: 1,915 buffers instead of 8,585 for a count in a project of
   * 20,000 monitors. Every Not Operational count and list that knows its
   * project passes it; a list also counts what it lists.
   */
  public static getQuery(
    projectId?: ObjectID | string | null | undefined,
  ): Query<Monitor> {
    return {
      ...MonitoringOff.getMonitoredQuery(),
      currentMonitorStatus: projectId
        ? {
            isOperationalState: false,
            projectId:
              projectId instanceof ObjectID
                ? projectId
                : new ObjectID(projectId),
          }
        : {
            isOperationalState: false,
          },
    };
  }
}
