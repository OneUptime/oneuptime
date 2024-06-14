import InBetween from "../BaseDatabase/InBetween";
import OneUptimeDate from "../Date";

export default class DatabaseDate {
  public static asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
    date: string | Date,
  ): InBetween {
    let startValue: string | Date = date;

    if (!(startValue instanceof Date)) {
      startValue = OneUptimeDate.fromString(startValue);
    }

    let endValue: string | Date = date;

    if (!(endValue instanceof Date)) {
      endValue = OneUptimeDate.fromString(endValue);
    }

    startValue = OneUptimeDate.getStartOfDay(startValue);
    endValue = OneUptimeDate.getEndOfDay(endValue);

    return new InBetween(
      OneUptimeDate.toDatabaseDate(startValue),
      OneUptimeDate.toDatabaseDate(endValue),
    );
  }
}
