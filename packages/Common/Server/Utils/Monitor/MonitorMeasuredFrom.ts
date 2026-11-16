import DataMigrationService from "../../Services/DataMigrationService";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataMigration from "../../../Models/DatabaseModels/DataMigration";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import MonitorFirstCheck, {
  MeasuredFrom,
} from "../../../Utils/Monitor/MonitorFirstCheck";
import { FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME } from "./UptimeHistoryMigration";

/*
 * WHEN EACH MONITOR'S TIME STARTS TO COUNT, READ FOR CODE THAT MEASURES A
 * MONITOR'S ROWS ITSELF (issue #9031).
 *
 * The status pages and the Dashboard work it out in SQL
 * (MonitorStatusTimelineService.getMeasuredFromCte). An SLO measures its
 * monitors' rows in TypeScript (SloUtil), so it reads the same two things
 * here and applies the same rule (MonitorFirstCheck.getMeasuredFrom, then
 * Utils/Uptime/TimeBeforeFirstCheck):
 *
 *   - whether the upgrade has put Monitor.firstMeasuredAt right for the
 *     monitors' history: the DataMigrations row of
 *     BackfillMonitorFirstMeasuredAtForUptimeHistory. Until it is there,
 *     every monitor counts from the start, as it always did - a result that
 *     came back during the upgrade stamped its monitor with the upgrade's
 *     time, and an SLO reading that would see no history at all and resolve
 *     or raise its alerts on it;
 *   - each monitor's type and first check.
 *
 * Every read is the caller's to fail: an SLO evaluation that cannot read
 * these measures nothing that tick, rather than measuring the monitor one
 * way this tick and the other way the next.
 */
export default class MonitorMeasuredFrom {
  // Whether the upgrade has put the column right for the monitors' history.
  public static async isUptimeHistoryReady(): Promise<boolean> {
    const migration: DataMigration | null =
      await DataMigrationService.findOneBy({
        query: {
          name: FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME,
          executed: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    return Boolean(migration);
  }

  /*
   * When each of the monitors' time starts to count, by monitor id. A
   * monitor missing from the map counts from the start: one not found, and
   * every monitor until the upgrade has put the column right for history -
   * the monitors are not read at all then.
   */
  public static async getMeasuredFromByMonitorId(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<Map<string, MeasuredFrom>> {
    const measuredFromByMonitorId: Map<string, MeasuredFrom> = new Map<
      string,
      MeasuredFrom
    >();

    if (data.monitorIds.length === 0) {
      return measuredFromByMonitorId;
    }

    if (!(await MonitorMeasuredFrom.isUptimeHistoryReady())) {
      return measuredFromByMonitorId;
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(data.monitorIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        monitorType: true,
        firstMeasuredAt: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    for (const monitor of monitors) {
      const monitorId: string | undefined = monitor.id?.toString();

      if (!monitorId) {
        continue;
      }

      measuredFromByMonitorId.set(
        monitorId,
        MonitorFirstCheck.getMeasuredFrom({
          monitor: monitor,
          isUptimeHistoryReady: true,
        }),
      );
    }

    return measuredFromByMonitorId;
  }
}
