import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorTurnedOff, {
  MonitorTurnedOffResult,
} from "Common/Server/Utils/Monitor/MonitorTurnedOff";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * Resolves, once, what the monitors whose monitoring was already off left
 * open: the incidents and alerts their own criteria opened with Auto resolve
 * on, which nothing could resolve any more (issue #6479).
 *
 * Turning a monitor's monitoring off resolves those (MonitorTurnedOff, issue
 * #6400), but only when monitoring changes from on to off. A monitor turned
 * off before that kept them open - "<monitor> is offline" on Active
 * Incidents for good - until someone turned it on and off again or resolved
 * them by hand. This resolves them now, as the switch would have.
 *
 * Never what a person still needs open:
 *   - only a monitor that is not archived and whose own switch is off: one
 *     paused by an incident or by scheduled maintenance resumes on its own,
 *     and archiving leaves what is open as it is, as its dialog says;
 *   - only what the monitor's own criteria opened with Auto resolve on, as
 *     the switch: an incident declared by hand, one whose criteria leaves it
 *     to a person, and one another monitor opened stay open;
 *   - and, unlike the switch, nobody is there to decide, so what a person
 *     has worked on - moved its state, acknowledged it, written a note on
 *     it - is left to them (isUpgrade). Only what was left behind untouched
 *     is resolved, and its timeline says it was resolved when OneUptime was
 *     upgraded, because the monitor's monitoring is off.
 *
 * Each resolve is OneUptime's own, as any resolve: owners and subscribers
 * are told, and the monitor gets its operational status back, held as time
 * with monitoring off (MonitorStatusTimeline.isMonitoringOff).
 *
 * Safe to run twice, and twice at once: MonitorTurnedOff reads each monitor
 * again and does nothing once its monitoring is on, it resolves only what is
 * still open, and an incident or alert resolved meanwhile is skipped. A
 * monitor or a record that fails is logged and the rest go on; the run never
 * fails. Paged on a stable id order, LIMIT_PER_PROJECT monitors a page:
 * resolving changes neither column the walk reads, so the pages stay put.
 */
export default class ResolveWhatMonitorsTurnedOffWouldHaveResolved extends DataMigrationBase {
  public constructor() {
    super("ResolveWhatMonitorsTurnedOffWouldHaveResolved");
  }

  public override async migrate(): Promise<void> {
    let monitorCount: number = 0;
    let resolvedIncidents: number = 0;
    let resolvedAlerts: number = 0;
    let leftIncidents: number = 0;
    let leftAlerts: number = 0;
    let skip: number = 0;

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          disableActiveMonitoring: true,
          isArchived: false,
        },
        select: {
          _id: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: skip,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      for (const monitor of monitors) {
        if (!monitor.id) {
          continue;
        }

        monitorCount++;

        try {
          const result: MonitorTurnedOffResult =
            await MonitorTurnedOff.resolveWhatItWouldHaveResolved({
              monitorId: monitor.id,
              isUpgrade: true,
            });

          resolvedIncidents += result.resolvedIncidentIds.length;
          resolvedAlerts += result.resolvedAlertIds.length;
          leftIncidents += result.leftForAPersonIncidentIds?.length || 0;
          leftAlerts += result.leftForAPersonAlertIds?.length || 0;
        } catch (err) {
          logger.error(
            `ResolveWhatMonitorsTurnedOffWouldHaveResolved: could not resolve what monitor ${monitor.id.toString()} left open:`,
          );
          logger.error(err);
        }
      }

      if (monitors.length < LIMIT_PER_PROJECT) {
        break;
      }

      skip += monitors.length;
    }

    logger.info(
      `ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved ${resolvedIncidents} incident(s) and ${resolvedAlerts} alert(s) of ${monitorCount} monitor(s) whose monitoring is off; left ${leftIncidents} incident(s) and ${leftAlerts} alert(s) a person has worked on open.`,
    );
  }

  // A resolve is on the records' timelines, as any resolve: nothing to undo.
  public override async rollback(): Promise<void> {
    return;
  }
}
