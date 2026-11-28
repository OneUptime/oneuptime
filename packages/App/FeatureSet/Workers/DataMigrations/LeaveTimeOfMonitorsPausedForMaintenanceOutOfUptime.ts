import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorIncidentPause from "Common/Server/Utils/Monitor/MonitorIncidentPause";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

/*
 * Works out, once, what the time of every monitor a scheduled maintenance
 * event in progress pauses counts as from the upgrade on
 * (Monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent, issue
 * #11301): a monitor that the events and incidents pausing it put in no
 * status has its time left out of uptime, status pages and SLOs from now,
 * as time with monitoring off is. Nothing recorded when its event began, so
 * the time before the upgrade counts as it did. A monitor an event puts in a
 * status of its own counts it as before, and gets no row.
 *
 * Exactly what an event's start does to its monitors' time
 * (MonitorIncidentPause.syncMonitors): safe to run twice, and twice at once,
 * since each monitor is read again and a row is written only when its
 * latest status event says otherwise. The paused monitors are listed first,
 * on a stable id order, then worked out; a monitor that fails is logged and
 * the rest go on, and the run never fails.
 */
export default class LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime extends DataMigrationBase {
  public constructor() {
    super("LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime");
  }

  public override async migrate(): Promise<void> {
    const pausedMonitors: Array<Monitor> = [];
    let skip: number = 0;

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
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
        // syncMonitors logs a monitor that fails, and goes on.
        await MonitorIncidentPause.syncMonitors({
          projectId: new ObjectID(monitor.projectId.toString()),
          monitorIds: [monitor.id],
        });

        workedOut++;
      } catch (err) {
        logger.error(
          `LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime: could not work out monitor ${monitor.id.toString()}:`,
        );
        logger.error(err);
      }
    }

    logger.info(
      `LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime: worked out what the time of ${workedOut} of ${pausedMonitors.length} monitor(s) paused by scheduled maintenance counts as from now.`,
    );
  }

  /*
   * The rows it writes mark the monitors' time from the upgrade on, as an
   * event's start does: nothing to undo.
   */
  public override async rollback(): Promise<void> {
    return;
  }
}
