import InBetween from "../BaseDatabase/InBetween";
import OneUptimeDate from "../Date";
import RollingTime from "../RollingTime/RollingTime";
import RollingTimeUtil from "../RollingTime/RollingTimeUtil";

/*
 * THE WINDOW A TELEMETRY CHECK JUDGES (issues #11248 and #11334).
 *
 * A check judges the window that ends when it was due: the last so many
 * seconds of a Logs, Traces, Exceptions, Profiles, Security Events or AI
 * step, or the rolling time of a Metrics or infrastructure step. A monitor's
 * windows follow on from one another, each starting where the one before
 * ended (#11248).
 *
 * A window holds its start and not its end: from its start, included, up to
 * its end, not included. With both ends held, a record stamped exactly where
 * one window ends and the next begins was counted by both checks - data
 * stamped to the second (syslog, some file sources) on a monitor whose
 * moment falls on a whole second. The start rather than the end, because:
 *
 *   - a check never counts a record stamped at the very moment it was due,
 *     which it can hardly have received by then: that record belongs to the
 *     next window, read a whole interval later;
 *   - a time written to the second stands for that second, so a record
 *     stamped 10:01:07 lands in the window that holds 10:01:07 to 10:01:08;
 *   - ClickHouse's time buckets hold their start and not their end
 *     (toStartOfInterval), so a window whose ends are whole minutes is made
 *     of whole one-minute buckets, and a rollup can serve it exactly.
 *
 * Every read a check makes of its window takes the window from here, and
 * each reader leaves its end out the same way (InBetween.includesEnd): the
 * analytics query builder (StatementGenerator), the Postgres one
 * (QueryHelper), and the reads that write their own SQL.
 */
export default class TelemetryCheckWindow {
  // The `seconds` up to `endsAt` (now, when no end is given).
  public static ofSeconds(
    seconds: number,
    endsAt?: Date | undefined,
  ): InBetween<Date> {
    const end: Date = endsAt || OneUptimeDate.getCurrentDate();

    return TelemetryCheckWindow.from(
      OneUptimeDate.addRemoveSeconds(end, seconds * -1),
      end,
    );
  }

  /*
   * A rolling time's window up to `endsAt` (now, when no end is given): the
   * same start RollingTimeUtil gives it.
   */
  public static ofRollingTime(
    rollingTime: RollingTime,
    endsAt?: Date | undefined,
  ): InBetween<Date> {
    const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      rollingTime,
      endsAt,
    );

    return TelemetryCheckWindow.from(range.startValue, range.endValue);
  }

  // From `startsAt`, included, up to `endsAt`, not included.
  public static from(startsAt: Date, endsAt: Date): InBetween<Date> {
    return new InBetween<Date>(startsAt, endsAt, { includesEnd: false });
  }
}
