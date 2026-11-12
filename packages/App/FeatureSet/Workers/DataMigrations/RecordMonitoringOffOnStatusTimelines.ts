import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import logger from "Common/Server/Utils/Logger";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * Marks, on each monitor's status timeline, that its monitoring is off, for
 * every monitor whose monitoring was turned off before OneUptime started to
 * mark it (MonitorStatusTimeline.isMonitoringOff, issue #6480).
 *
 * Uptime, status page bars, SLOs and monitor group graphs leave out the time
 * from a status event that marks monitoring off to the next one that does
 * not. Turning monitoring off or back on starts such a status event now
 * (MonitorStatusTimelineService.recordMonitoringSwitch); a monitor turned off
 * before has none, so its frozen status would go on counting until someone
 * turned it on and off again. This starts one for it now, with the status
 * the monitor holds.
 *
 * Only from now: nothing recorded when such a monitor's monitoring was turned
 * off, so the time before stays as it was counted.
 *
 * Idempotent, and safe to run twice at once: recordMonitoringSwitch writes
 * nothing for a monitor whose latest status event already marks monitoring
 * off, and its status events are written under the monitor's lock. A monitor
 * it cannot mark is logged and left for the switch, never failing the run.
 */
export default class RecordMonitoringOffOnStatusTimelines extends DataMigrationBase {
  public constructor() {
    super("RecordMonitoringOffOnStatusTimelines");
  }

  public override async migrate(): Promise<void> {
    let marked: number = 0;
    let skip: number = 0;

    /*
     * Paged on a stable id order: monitors created in the same instant never
     * swap places between pages. Marking a monitor never changes its switch,
     * so the pages stay put under the walk.
     */
    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          disableActiveMonitoring: true,
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

        try {
          const statusEvent: MonitorStatusTimeline | null =
            await MonitorStatusTimelineService.recordMonitoringSwitch({
              monitorId: monitor.id,
              isMonitoringOff: true,
            });

          if (statusEvent) {
            marked++;
          }
        } catch (err) {
          logger.error(
            `RecordMonitoringOffOnStatusTimelines: could not mark monitoring off on the status timeline of monitor ${monitor.id.toString()}:`,
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
      `RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of ${marked} monitor(s).`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
