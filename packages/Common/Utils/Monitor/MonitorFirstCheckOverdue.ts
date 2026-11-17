import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorCheckScheduleUtil, {
  MonitorCheckFreshness,
} from "./MonitorCheckScheduleUtil";
import MonitorTypeFamily, { MonitorOverviewFamily } from "./MonitorTypeFamily";

/*
 * A MONITOR WHOSE FIRST CHECK IS OVERDUE (issue #8899).
 *
 * The last of the rules for a monitor nothing has checked yet
 * (Utils/Monitor/MonitorFirstCheck): a probe check, a telemetry or an
 * infrastructure monitor whose first result should have come back by now,
 * judged from when it was created exactly as the page judges it
 * (MonitorCheckScheduleUtil.getCheckFreshness). The lists then say "No
 * results yet" (MonitorRowStatus). A heartbeat, an agent, a network device
 * or a Probe Status monitor has no time its first signal is due by, so it
 * waits.
 *
 * It is a module of its own because of what it reads: the monitor's
 * schedule (CronTab) and its type's family. MonitorFirstCheck's other
 * rules need none of that, and a status page loads them before it draws
 * (Utils/StatusPage/FrozenMonitorResources) without ever judging a first
 * check overdue, so it does not download what this reads
 * (packages/Common/Scripts/first-load-budgets.js). A public dashboard does
 * load this rule before it draws, for its Monitor List widget's rows, so
 * the family comes from MonitorTypeFamily, not from the overview's layout
 * (MonitorOverviewFamily), which brings every monitor type's metrics and
 * the database metric catalog with it.
 */

export interface FirstCheckScheduleFields {
  monitorType?: MonitorType | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  monitoringInterval?: string | null | undefined;
}

/*
 * The families whose first result has a time it is due by: run on a
 * schedule the page can see (getCheckFreshness). A pushed or event-driven
 * monitor waits for its first signal however long it takes.
 */
const FAMILIES_WITH_A_FIRST_CHECK_DUE: ReadonlyArray<MonitorOverviewFamily> = [
  MonitorOverviewFamily.ProbeCheck,
  MonitorOverviewFamily.TelemetrySignal,
  MonitorOverviewFamily.Infrastructure,
];

export default class MonitorFirstCheckOverdue {
  /*
   * Whether a monitor that has never been measured is past the time its
   * first result was due: the page's "No results yet" (Overdue, nothing
   * ever reported). Only the families run on a schedule have such a time;
   * a monitor with no creation time, or of a type this build does not
   * know, is still waiting. `now` is on the server's clock, as creation is.
   */
  public static isFirstCheckOverdue(data: {
    monitor: FirstCheckScheduleFields;
    now: Date;
  }): boolean {
    const createdAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
      data.monitor.createdAt,
    );

    if (!createdAt || !data.monitor.monitorType) {
      return false;
    }

    let family: MonitorOverviewFamily;

    try {
      family = MonitorTypeFamily.getFamily(
        data.monitor.monitorType as MonitorType,
      );
    } catch {
      return false;
    }

    if (!FAMILIES_WITH_A_FIRST_CHECK_DUE.includes(family)) {
      return false;
    }

    const monitoringInterval: string | undefined =
      data.monitor.monitoringInterval || undefined;

    return (
      MonitorCheckScheduleUtil.getCheckFreshness({
        isScheduled: true,
        isKnown: true,
        lastResultAt: undefined,
        nextCheckAt: undefined,
        cadenceSeconds: MonitorCheckScheduleUtil.resolveCadenceSeconds({
          monitoringInterval: monitoringInterval,
          from: data.now,
        }),
        createdAt: createdAt,
        now: data.now,
        monitoringInterval: monitoringInterval,
      }).freshness === MonitorCheckFreshness.Stale
    );
  }
}
