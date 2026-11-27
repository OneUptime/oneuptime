import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentService from "Common/Server/Services/IncidentService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

/*
 * Works out, once, every monitor an incident declared by hand has paused
 * (Monitor.disableActiveMonitoringBecauseOfManualIncident), as the open
 * incidents on it now say (MonitorIncidentPause, issue #11141):
 *
 *   - A monitor no open incident pauses is resumed, and returned to
 *     operational unless an incident is still open on it - what the resolve
 *     of the incident that paused it should have done. A reopened incident
 *     holds nothing, but it used to count as one still pausing the monitor,
 *     so the resolve of the incident that had paused it left it paused for
 *     good: never checked again, its incoming requests dropped, its last
 *     status counted as its uptime.
 *   - A monitor that open incidents pause, none of which puts it in a
 *     status, has its time left out of uptime, status pages and SLOs from
 *     the upgrade on, as time with monitoring off is. Nothing recorded when
 *     its pause began, so the time before the upgrade counts as it did.
 *
 * Exactly what a resolve does to a monitor it gives back
 * (IncidentService.markMonitorsActiveForMonitoring): safe to run twice, and
 * twice at once, since each monitor is read again and only what differs
 * from its incidents is written. The paused monitors are listed first, on a
 * stable id order, then worked out: resuming one changes the column the
 * list is read by. A monitor that fails is logged and the rest go on; the
 * run never fails.
 */
export default class WorkOutMonitorsPausedByIncidents extends DataMigrationBase {
  public constructor() {
    super("WorkOutMonitorsPausedByIncidents");
  }

  public override async migrate(): Promise<void> {
    const pausedMonitors: Array<Monitor> = [];
    let skip: number = 0;

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          disableActiveMonitoringBecauseOfManualIncident: true,
        },
        select: {
          _id: true,
          projectId: true,
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

      pausedMonitors.push(...monitors);

      if (monitors.length < LIMIT_PER_PROJECT) {
        break;
      }

      skip += monitors.length;
    }

    let workedOut: number = 0;

    for (const monitor of pausedMonitors) {
      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      try {
        await IncidentService.markMonitorsActiveForMonitoring(
          new ObjectID(monitor.projectId.toString()),
          [monitor],
        );

        workedOut++;
      } catch (err) {
        logger.error(
          `WorkOutMonitorsPausedByIncidents: could not work out monitor ${monitor.id.toString()}:`,
        );
        logger.error(err);
      }
    }

    const stillPaused: number = await this.countPaused();

    logger.info(
      `WorkOutMonitorsPausedByIncidents: worked out ${workedOut} of ${pausedMonitors.length} monitor(s) paused by an incident declared by hand; ${pausedMonitors.length - stillPaused} resumed, as no open incident pauses them any more.`,
    );
  }

  private async countPaused(): Promise<number> {
    return (
      await MonitorService.countBy({
        query: {
          disableActiveMonitoringBecauseOfManualIncident: true,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();
  }

  /*
   * A resume is what a resolve does, on the monitor's own timelines: nothing
   * to undo.
   */
  public override async rollback(): Promise<void> {
    return;
  }
}
