import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import MonitorFirstCheck, { MeasuredFrom } from "../Monitor/MonitorFirstCheck";
import UptimeUtil from "./UptimeUtil";

/*
 * THE TIME BEFORE A MONITOR'S FIRST CHECK, IN ITS ROWS (issue #9031).
 *
 * Every monitor is created in its project's operational status, and nothing
 * stands behind that status until something has measured the monitor
 * (Monitor.firstMeasuredAt). Since #8960 the status pages and the Dashboard
 * leave that time out of a monitor's bars and uptime, in SQL
 * (MonitorStatusTimelineService.getTimelineSourceCtes). This is the same
 * rule for code that measures a monitor's status timeline rows itself: a
 * Monitor Uptime SLO (Server/Utils/Slo/SloMonitorTimelines), so it neither
 * spends its error budget on that time nor counts it as good.
 *
 * The rule is the SQL's (getFirstCheckCutSql). A period of a status a
 * monitor can start in (operational, and not offline as well:
 * MonitorFirstCheck.isStartingStatus) that starts before the monitor's
 * first check starts at the first check instead, and all of it is left out
 * while nothing has checked the monitor. A status something else recorded
 * before the first check (an incident, a person, the heartbeat check
 * judging a heartbeat that never came) counts as it is, and so does time
 * with monitoring off. A monitor measured from the start (MeasuredFrom
 * undefined: a manual monitor, or any monitor until the upgrade has put the
 * column right for history, see MonitorFirstCheck.getMeasuredFrom) is not
 * cut at all.
 *
 * The time cut away is marked as monitoring off, not dropped. Every reader
 * of these rows already leaves time with monitoring off out of both the
 * good time and the total (UptimeUtil.getMonitorEventsForId and
 * getNotMonitoredSeconds, issue #6480), and a row dropped would let the open
 * row before it run on across the time it covered. Where each row ends is
 * worked out first, as UptimeUtil works it out (an open row runs to the
 * next row's start, the last one to now), and the cut is made after: the
 * SQL cuts after its LEAD for the same reason. Once a monitor's rows are
 * cut, every row but the last is closed where it ended, so a row the cut
 * adds can never end another one somewhere else.
 *
 * A monitor whose rows hold no such time gets the very same array back, so
 * whatever is measured from it reads exactly as it did before.
 */
export default class TimeBeforeFirstCheck {
  public static markNotMonitored(data: {
    monitorId: ObjectID;
    timelines: Array<MonitorStatusTimeline>;
    measuredFrom: MeasuredFrom;
  }): Array<MonitorStatusTimeline> {
    if (data.measuredFrom === undefined) {
      return data.timelines;
    }

    // Never checked: no first check, so every such period is before it.
    const firstCheckAt: number =
      data.measuredFrom === null
        ? Infinity
        : OneUptimeDate.fromString(data.measuredFrom).getTime();

    if (Number.isNaN(firstCheckAt)) {
      return data.timelines;
    }

    const monitorId: string = data.monitorId.toString();
    const now: Date = OneUptimeDate.getCurrentDate();

    // A row's start, as UptimeUtil reads it: a row with none starts now.
    const getStart: (row: MonitorStatusTimeline) => number = (
      row: MonitorStatusTimeline,
    ): number => {
      return OneUptimeDate.fromString(row.startsAt || now).getTime();
    };

    const isOwn: (row: MonitorStatusTimeline | undefined) => boolean = (
      row: MonitorStatusTimeline | undefined,
    ): boolean => {
      return Boolean(row) && row!.monitorId?.toString() === monitorId;
    };

    const isBeforeFirstCheck: (row: MonitorStatusTimeline) => boolean = (
      row: MonitorStatusTimeline,
    ): boolean => {
      return (
        isOwn(row) &&
        !UptimeUtil.isMonitoringOff(row) &&
        getStart(row) < firstCheckAt &&
        MonitorFirstCheck.isStartingStatus(row.monitorStatus)
      );
    };

    if (!data.timelines.some(isBeforeFirstCheck)) {
      return data.timelines;
    }

    // In the order UptimeUtil ends them in (compareTimelinesChronologically).
    const ownRows: Array<MonitorStatusTimeline> = data.timelines
      .filter(isOwn)
      .sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline): number => {
        return UptimeUtil.compareTimelinesChronologically(a, b);
      });

    const rows: Array<MonitorStatusTimeline> = [];
    const lastIndex: number = ownRows.length - 1;
    let isLastRowSplit: boolean = false;
    let isAnyRowSplit: boolean = false;

    for (let index: number = 0; index <= lastIndex; index++) {
      const row: MonitorStatusTimeline = ownRows[index]!;
      const isLast: boolean = index === lastIndex;

      /*
       * Where the row ends: its own end, the next row's start while it is
       * open, or now. The last row, while open, stays open and runs on to
       * now; any other is closed there.
       */
      const endsAt: Date | undefined =
        row.endsAt ||
        (isLast ? undefined : ownRows[index + 1]!.startsAt || now);
      const end: number = OneUptimeDate.fromString(endsAt || now).getTime();

      if (!isBeforeFirstCheck(row)) {
        rows.push(
          endsAt === row.endsAt
            ? row
            : TimeBeforeFirstCheck.copyRow(row, { endsAt: endsAt }),
        );
        continue;
      }

      // All of it before the first check.
      if (end <= firstCheckAt) {
        rows.push(
          TimeBeforeFirstCheck.copyRow(row, {
            endsAt: endsAt,
            isMonitoringOff: true,
          }),
        );
        continue;
      }

      // Before the first check, and on after it: in two.
      rows.push(
        TimeBeforeFirstCheck.copyRow(row, {
          endsAt: new Date(firstCheckAt),
          isMonitoringOff: true,
        }),
      );
      rows.push(
        TimeBeforeFirstCheck.copyRow(row, {
          startsAt: new Date(firstCheckAt),
          endsAt: endsAt,
        }),
      );

      isAnyRowSplit = true;
      isLastRowSplit = isLast;
    }

    /*
     * A row cut in two whose second half starts after the last row would
     * sort after it, and end it at the first check: a closed row that runs
     * past the last row's start, which only a corrupt timeline holds. The
     * last row then ends now, where it ended before.
     */
    const lastRow: MonitorStatusTimeline | undefined = ownRows[lastIndex];

    if (
      lastRow &&
      !lastRow.endsAt &&
      isAnyRowSplit &&
      !isLastRowSplit &&
      firstCheckAt > getStart(lastRow)
    ) {
      rows[rows.length - 1] = TimeBeforeFirstCheck.copyRow(
        rows[rows.length - 1]!,
        { endsAt: now },
      );
    }

    // Rows of other monitors, which no reader counts for this one, as they were.
    return [
      ...rows,
      ...data.timelines.filter((row: MonitorStatusTimeline): boolean => {
        return !isOwn(row);
      }),
    ];
  }

  /*
   * A row as the uptime math reads it - its monitor, status, start, end and
   * whether its monitoring was off - with the changes made, never the row
   * itself: the caller's rows stay as they were read.
   */
  private static copyRow(
    row: MonitorStatusTimeline,
    changes: {
      startsAt?: Date | undefined;
      endsAt?: Date | undefined;
      isMonitoringOff?: boolean | undefined;
    },
  ): MonitorStatusTimeline {
    const copy: MonitorStatusTimeline = new MonitorStatusTimeline();

    if (row._id) {
      copy._id = row._id;
    }

    if (row.projectId) {
      copy.projectId = row.projectId;
    }

    if (row.monitorId) {
      copy.monitorId = row.monitorId;
    }

    if (row.monitorStatusId) {
      copy.monitorStatusId = row.monitorStatusId;
    }

    if (row.monitorStatus) {
      copy.monitorStatus = row.monitorStatus;
    }

    const startsAt: Date | undefined = changes.startsAt || row.startsAt;

    if (startsAt) {
      copy.startsAt = startsAt;
    }

    // An end left out is an open row, as a row read with none is.
    const endsAt: Date | undefined =
      "endsAt" in changes ? changes.endsAt : row.endsAt;

    if (endsAt) {
      copy.endsAt = endsAt;
    }

    const isMonitoringOff: boolean | undefined =
      changes.isMonitoringOff === undefined
        ? row.isMonitoringOff
        : changes.isMonitoringOff;

    if (isMonitoringOff !== undefined) {
      copy.isMonitoringOff = isMonitoringOff;
    }

    return copy;
  }
}
