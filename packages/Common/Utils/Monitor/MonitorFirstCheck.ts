import MonitorType from "../../Types/Monitor/MonitorType";

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
 *     That rule is MonitorFirstCheckOverdue's, in a module of its own: it
 *     reads the monitor's schedule and every monitor type's family, which
 *     a status page, loading this module before it draws, never needs.
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

/*
 * When a monitor's time starts to count for its uptime and its SLOs (issues
 * #8960 and #9031), for code that measures a monitor's status timeline rows
 * itself (Utils/Uptime/TimeBeforeFirstCheck):
 *
 *   - undefined: from the start, so nothing is left out;
 *   - null: never, as nothing has checked the monitor yet;
 *   - a date: its first check.
 */
export type MeasuredFrom = Date | null | undefined;

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
   * When the monitor's time starts to count (MeasuredFrom): what
   * MonitorStatusTimelineService.getMeasuredFromCte works out in SQL for
   * the status pages and the Dashboard, so an SLO measures a monitor over
   * the same time they do.
   *
   * From the start for a manual monitor (its status is the one a person
   * sets), for one of no known type and for one read without the column,
   * which counts as measured, as everywhere else. And from the start for
   * every monitor until the upgrade has put the column right for history
   * (isUptimeHistoryReady, the DataMigrations row of
   * BackfillMonitorFirstMeasuredAtForUptimeHistory): a result that came
   * back during the upgrade stamped the monitor with the upgrade's time, so
   * its history would read as never checked until that has run. Never while
   * nothing has checked it, and from its first check otherwise. A date that
   * cannot be read counts from the start.
   */
  public static getMeasuredFrom(data: {
    monitor: MonitorFirstCheckFields | null | undefined;
    isUptimeHistoryReady: boolean;
  }): MeasuredFrom {
    const monitor: MonitorFirstCheckFields | null | undefined = data.monitor;

    if (
      !data.isUptimeHistoryReady ||
      !monitor ||
      !monitor.monitorType ||
      monitor.monitorType === MonitorType.Manual ||
      monitor.firstMeasuredAt === undefined
    ) {
      return undefined;
    }

    if (monitor.firstMeasuredAt === null) {
      return null;
    }

    const firstMeasuredAt: Date = new Date(monitor.firstMeasuredAt);

    return Number.isNaN(firstMeasuredAt.getTime())
      ? undefined
      : firstMeasuredAt;
  }

  /*
   * Whether a status is the one a monitor starts in: operational, and not
   * offline as well. A status read without the flags is not.
   */
  public static isStartingStatus(
    status: StartingStatusFlags | null | undefined,
  ): boolean {
    return (
      status?.isOperationalState === true && status.isOfflineState !== true
    );
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
}
