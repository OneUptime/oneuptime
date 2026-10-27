import InBetween from "../BaseDatabase/InBetween";
import OneUptimeDate from "../Date";
import RollingTime from "./RollingTime";

export default class RollingTimeUtil {
  public static getDefault(): RollingTime {
    return RollingTime.Past1Minute;
  }

  /*
   * The window a rolling time covers, ending now - or at `endDate` when a
   * caller needs it to end earlier (a telemetry check while OneUptime's
   * ingest queue is behind, issue #2825).
   */
  public static convertToStartAndEndDate(
    rollingTime: RollingTime,
    endDate: Date = OneUptimeDate.getCurrentDate(),
  ): InBetween<Date> {
    let startDate: Date = endDate;

    if (rollingTime === RollingTime.Past1Minute) {
      startDate = OneUptimeDate.addRemoveMinutes(endDate, -1);
    }

    if (rollingTime === RollingTime.Past5Minutes) {
      startDate = OneUptimeDate.addRemoveMinutes(endDate, -5);
    }

    if (rollingTime === RollingTime.Past10Minutes) {
      startDate = OneUptimeDate.addRemoveMinutes(endDate, -10);
    }

    if (rollingTime === RollingTime.Past15Minutes) {
      startDate = OneUptimeDate.addRemoveMinutes(endDate, -15);
    }

    if (rollingTime === RollingTime.Past30Minutes) {
      startDate = OneUptimeDate.addRemoveMinutes(endDate, -30);
    }

    if (rollingTime === RollingTime.Past1Hour) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -1);
    }

    if (rollingTime === RollingTime.Past2Hours) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -2);
    }

    if (rollingTime === RollingTime.Past3Hours) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -3);
    }

    if (rollingTime === RollingTime.Past6Hours) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -6);
    }

    if (rollingTime === RollingTime.Past12Hours) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -12);
    }

    /*
     * Days are fixed lengths, 24 hours a day, not calendar days: in a zone
     * whose clocks change inside the window, N calendar days back is an hour
     * more or less than N days. Past 1, 3 and 7 Days and Past 180 Days sit
     * exactly on the edge of a bucket width (AggregationIntervalUtil), so in
     * London after the clocks went back on 2026-10-25 Past 3 Days was
     * bucketed by the hour instead of every 30 minutes - in the browser, and
     * on any server not in UTC - and getWindowInMs, which steps back from
     * 1970-01-01, read Past 90 and 180 Days an hour long in New York.
     */
    if (rollingTime === RollingTime.Past1Hours) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -24);
    }

    if (rollingTime === RollingTime.Past2Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -2 * 24);
    }

    if (rollingTime === RollingTime.Past3Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -3 * 24);
    }

    if (rollingTime === RollingTime.Past7Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -7 * 24);
    }

    if (rollingTime === RollingTime.Past14Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -14 * 24);
    }

    if (rollingTime === RollingTime.Past30Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -30 * 24);
    }

    if (rollingTime === RollingTime.Past60Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -60 * 24);
    }

    if (rollingTime === RollingTime.Past90Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -90 * 24);
    }

    if (rollingTime === RollingTime.Past180Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -180 * 24);
    }

    if (rollingTime === RollingTime.Past365Days) {
      startDate = OneUptimeDate.addRemoveHours(endDate, -365 * 24);
    }

    return new InBetween(startDate, endDate);
  }

  // How long a rolling time's window is, in milliseconds.
  public static getWindowInMs(rollingTime: RollingTime): number {
    const endDate: Date = new Date(0);
    const window: InBetween<Date> = this.convertToStartAndEndDate(
      rollingTime,
      endDate,
    );

    return endDate.getTime() - (window.startValue as Date).getTime();
  }
}
