import InBetween from "../BaseDatabase/InBetween";
import TimeRange from "./TimeRange";
import OneUptimeDate from "../Date";

export default interface RangeStartAndEndDateTime {
  startAndEndDate?: InBetween<Date> | undefined;
  range: TimeRange;
}

export class RangeStartAndEndDateTimeUtil {
  /**
   * Returns the comparison window — the same-duration range immediately
   * preceding the current one. For "Past 1 Hour" this returns the hour
   * before that, suitable for "vs previous period" overlays.
   */
  public static getComparisonStartAndEndDate(
    dashboardStartAndEndDate: RangeStartAndEndDateTime,
  ): InBetween<Date> {
    const current: InBetween<Date> = this.getStartAndEndDate(
      dashboardStartAndEndDate,
    );
    if (!current.startValue || !current.endValue) {
      return current;
    }
    const startMs: number = current.startValue.getTime();
    const endMs: number = current.endValue.getTime();
    const durationMs: number = endMs - startMs;
    return new InBetween<Date>(
      new Date(startMs - durationMs),
      new Date(startMs),
    );
  }

  public static getStartAndEndDate(
    dashboardStartAndEndDate: RangeStartAndEndDateTime,
  ): InBetween<Date> {
    const currentDate: Date = OneUptimeDate.getCurrentDate();

    // 30 mins.
    if (dashboardStartAndEndDate.range === TimeRange.PAST_THIRTY_MINS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveMinutes(currentDate, -30),
        currentDate,
      );
    }

    if (dashboardStartAndEndDate.range === TimeRange.PAST_ONE_HOUR) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveHours(currentDate, -1),
        currentDate,
      );
    }

    // two hours.
    if (dashboardStartAndEndDate.range === TimeRange.PAST_TWO_HOURS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveHours(currentDate, -2),
        currentDate,
      );
    }

    // three hours
    if (dashboardStartAndEndDate.range === TimeRange.PAST_THREE_HOURS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveHours(currentDate, -3),
        currentDate,
      );
    }

    if (dashboardStartAndEndDate.range === TimeRange.PAST_ONE_DAY) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveDays(currentDate, -1),
        currentDate,
      );
    }

    // two days .
    if (dashboardStartAndEndDate.range === TimeRange.PAST_TWO_DAYS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveDays(currentDate, -2),
        currentDate,
      );
    }

    if (dashboardStartAndEndDate.range === TimeRange.PAST_ONE_WEEK) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveDays(currentDate, -7),
        currentDate,
      );
    }

    // two weeks.
    if (dashboardStartAndEndDate.range === TimeRange.PAST_TWO_WEEKS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveDays(currentDate, -14),
        currentDate,
      );
    }

    if (dashboardStartAndEndDate.range === TimeRange.PAST_ONE_MONTH) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveMonths(currentDate, -1),
        currentDate,
      );
    }

    // three months.
    if (dashboardStartAndEndDate.range === TimeRange.PAST_THREE_MONTHS) {
      return new InBetween<Date>(
        OneUptimeDate.addRemoveMonths(currentDate, -3),
        currentDate,
      );
    }

    // custom
    return (
      dashboardStartAndEndDate.startAndEndDate ||
      new InBetween<Date>(currentDate, currentDate)
    );
  }
}
