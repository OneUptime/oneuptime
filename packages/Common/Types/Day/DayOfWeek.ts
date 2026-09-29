enum DayOfWeek {
  Sunday = "Sunday",
  Monday = "Monday",
  Tuesday = "Tuesday",
  Wednesday = "Wednesday",
  Thursday = "Thursday",
  Friday = "Friday",
  Saturday = "Saturday",
}

export class DayOfWeekUtil {
  public static getNumberOfDayOfWeek(dayOfWeek: DayOfWeek): number {
    switch (dayOfWeek) {
      case DayOfWeek.Sunday:
        return 0;
      case DayOfWeek.Monday:
        return 1;
      case DayOfWeek.Tuesday:
        return 2;
      case DayOfWeek.Wednesday:
        return 3;
      case DayOfWeek.Thursday:
        return 4;
      case DayOfWeek.Friday:
        return 5;
      case DayOfWeek.Saturday:
        return 6;
    }
  }
}

export default DayOfWeek;
