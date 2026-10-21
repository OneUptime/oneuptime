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

    if (rollingTime === RollingTime.Past1Hours) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -1);
    }

    if (rollingTime === RollingTime.Past2Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -2);
    }

    if (rollingTime === RollingTime.Past3Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -3);
    }

    if (rollingTime === RollingTime.Past7Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -7);
    }

    if (rollingTime === RollingTime.Past14Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -14);
    }

    if (rollingTime === RollingTime.Past30Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -30);
    }

    if (rollingTime === RollingTime.Past60Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -60);
    }

    if (rollingTime === RollingTime.Past90Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -90);
    }

    if (rollingTime === RollingTime.Past180Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -180);
    }

    if (rollingTime === RollingTime.Past365Days) {
      startDate = OneUptimeDate.addRemoveDays(endDate, -365);
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
