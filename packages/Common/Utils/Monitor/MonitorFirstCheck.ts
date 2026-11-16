import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorCheckScheduleUtil, {
  MonitorCheckFreshness,
} from "./MonitorCheckScheduleUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "./MonitorOverviewFamily";

/*
 * A MONITOR NOTHING HAS CHECKED YET (issue #8899).
 *
 * MonitorService creates every monitor in the project's operational status,
 * so a monitor reads Operational from the moment it is saved - before its
 * first probe result, heartbeat, email, agent report or evaluation has come
 * back, and for good when none ever does (a self-hosted probe that is not
 * connected). That Operational is only the status it was created in: no
 * check stands behind it.
 *
 * The monitor's own page works that out from what it can read
 * (MonitorOverviewPresentationUtil: probe rows, heartbeats, the evaluation
 * log), and says "Waiting for data" or "No results yet" instead. A list
 * cannot read all of that for every row, so the monitor keeps the answer on
 * its row: Monitor.firstMeasuredAt, stamped the first time something
 * measures it (Server/Utils/Monitor/MonitorFirstMeasured). This is the rule
 * every place that draws a monitor's status from its row reads it by - the
 * Monitors list, the Monitor List widget and its honeycomb
 * (MonitorRowStatus), a status page (Utils/StatusPage/FrozenMonitorResources),
 * OneUptime AI's query_monitors - so each says what the page says.
 *
 *   - Never measured: firstMeasuredAt was read and is empty. A monitor read
 *     without the column counts as measured, so a read that forgets it
 *     shows the status as it always did and never hides a real one. A
 *     manual monitor is never measured, and never "never measured" either:
 *     its status is the one a person sets.
 *   - Its status unmeasured: never measured, and still in the status it
 *     started in - operational, and not flagged offline as well, as the
 *     page reads a status flagged both ways. A status something else set
 *     before the first check (an incident, a person, a maintenance event,
 *     the server judging a heartbeat that never came) was recorded, and is
 *     shown as it is.
 *   - Its first check overdue: a probe check, a telemetry or an
 *     infrastructure monitor whose first result should have come back by
 *     now, judged from when it was created exactly as the page judges it
 *     (MonitorCheckScheduleUtil.getCheckFreshness): the page then says "No
 *     results yet". A heartbeat, an agent, a network device or a Probe
 *     Status monitor has no time its first signal is due by, so it waits.
 */

// What a monitor is read with before this can answer for it.
export const MONITOR_FIRST_CHECK_SELECT: {
  monitorType: true;
  firstMeasuredAt: true;
  createdAt: true;
  monitoringInterval: true;
} = {
  monitorType: true,
  firstMeasuredAt: true,
  createdAt: true,
  monitoringInterval: true,
};

export interface MonitorFirstCheckFields {
  monitorType?: MonitorType | string | null | undefined;
  /*
   * NULL as read when nothing has measured the monitor; undefined when the
   * column was not read.
   */
  firstMeasuredAt?: Date | string | null | undefined;
}

// What a status is read with before isStartingStatus can answer for it.
export const STARTING_STATUS_SELECT: {
  isOperationalState: true;
  isOfflineState: true;
} = {
  isOperationalState: true,
  isOfflineState: true,
};

export interface StartingStatusFlags {
  isOperationalState?: boolean | null | undefined;
  isOfflineState?: boolean | null | undefined;
}

export interface MonitorWithStatusFirstCheckFields
  extends MonitorFirstCheckFields {
  currentMonitorStatus?: StartingStatusFlags | null | undefined;
}

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

export default class MonitorFirstCheck {
  /*
   * Whether nothing has measured the monitor: firstMeasuredAt read and
   * empty, on a monitor something checks. False for a manual monitor, for
   * one read without the column, and for one whose type is not known.
   */
  public static isNeverMeasured(
    monitor: MonitorFirstCheckFields | null | undefined,
  ): boolean {
    if (!monitor || monitor.firstMeasuredAt !== null) {
      return false;
    }

    if (!monitor.monitorType) {
      return false;
    }

    return monitor.monitorType !== MonitorType.Manual;
  }

  /*
   * Whether a status is the one a monitor starts in: operational, and not
   * offline as well. A status read without the flags is not.
   */
  public static isStartingStatus(
    status: StartingStatusFlags | null | undefined,
  ): boolean {
    return status?.isOperationalState === true && status.isOfflineState !== true;
  }

  /*
   * Whether the status the monitor holds is only the one it was created
   * in: nothing has measured it, and nothing else has moved it either.
   * What the lists and status pages draw in place of that status.
   */
  public static isStatusUnmeasured(
    monitor: MonitorWithStatusFirstCheckFields | null | undefined,
  ): boolean {
    return (
      MonitorFirstCheck.isNeverMeasured(monitor) &&
      MonitorFirstCheck.isStartingStatus(monitor?.currentMonitorStatus)
    );
  }

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
      family = MonitorOverviewFamilyUtil.getFamily(
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
