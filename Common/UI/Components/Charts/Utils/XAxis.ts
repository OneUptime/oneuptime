import OneUptimeDate from "../../../../Types/Date";
import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import XAxisMaxMin from "../Types/XAxis/XAxisMaxMin";
import XAxisPrecision from "../Types/XAxis/XAxisPrecision";

export default class XAxisUtil {
  public static getPrecision(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
  }): XAxisPrecision {
    if (
      typeof data.xAxisMax === "number" ||
      typeof data.xAxisMin === "number"
    ) {
      // number not yet supported.
      throw new NotImplementedException();
    }

    const startDate: Date = OneUptimeDate.fromString(data.xAxisMin as Date);
    const endDate: Date = OneUptimeDate.fromString(data.xAxisMax as Date);

    const totalMilliseconds: number = endDate.getTime() - startDate.getTime();
    const totalSeconds: number = totalMilliseconds / 1000;
    const totalMinutes: number = totalSeconds / 60;
    const totalHours: number = totalMinutes / 60;
    const totalDays: number = totalHours / 24;
    const totalWeeks: number = totalDays / 7;
    const totalMonths: number = totalDays / 30;

    if (totalSeconds <= 100) {
      return XAxisPrecision.EVERY_SECOND;
    }
    if (totalSeconds <= 500) {
      return XAxisPrecision.EVERY_FIVE_SECONDS;
    }
    if (totalSeconds <= 1000) {
      return XAxisPrecision.EVERY_TEN_SECONDS;
    }
    if (totalSeconds <= 3000) {
      return XAxisPrecision.EVERY_THIRTY_SECONDS;
    }
    if (totalMinutes <= 100) {
      return XAxisPrecision.EVERY_MINUTE;
    }
    if (totalMinutes <= 500) {
      return XAxisPrecision.EVERY_FIVE_MINUTES;
    }
    if (totalMinutes <= 1000) {
      return XAxisPrecision.EVERY_TEN_MINUTES;
    }
    if (totalMinutes <= 3000) {
      return XAxisPrecision.EVERY_THIRTY_MINUTES;
    }
    if (totalHours <= 80) {
      return XAxisPrecision.EVERY_HOUR;
    }
    if (totalHours <= 100) {
      return XAxisPrecision.EVERY_TWO_HOURS;
    }
    if (totalHours <= 150) {
      return XAxisPrecision.EVERY_THREE_HOURS;
    }
    if (totalHours <= 300) {
      return XAxisPrecision.EVERY_SIX_HOURS;
    }
    if (totalHours <= 1200) {
      return XAxisPrecision.EVERY_TWELVE_HOURS;
    }
    if (totalDays <= 100) {
      return XAxisPrecision.EVERY_DAY;
    }
    if (totalDays <= 200) {
      return XAxisPrecision.EVERY_TWO_DAYS;
    }
    if (totalWeeks <= 100) {
      return XAxisPrecision.EVERY_WEEK;
    }
    if (totalWeeks <= 200) {
      return XAxisPrecision.EVERY_TWO_WEEKS;
    }
    if (totalMonths <= 100) {
      return XAxisPrecision.EVERY_MONTH;
    }
    if (totalMonths <= 200) {
      return XAxisPrecision.EVERY_TWO_MONTHS;
    }
    if (totalMonths <= 300) {
      return XAxisPrecision.EVERY_THREE_MONTHS;
    }
    if (totalMonths <= 600) {
      return XAxisPrecision.EVERY_SIX_MONTHS;
    }
    return XAxisPrecision.EVERY_YEAR;
  }

  public static getPrecisionIntervals(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
  }): Array<Date> {
    const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

    if (
      typeof data.xAxisMax === "number" ||
      typeof data.xAxisMin === "number"
    ) {
      // number not yet supported.
      throw new NotImplementedException();
    }

    const startDate: Date = new Date(data.xAxisMin as Date);
    const endDate: Date = new Date(data.xAxisMax as Date);
    const intervals: Array<Date> = [];

    const currentDate: Date = new Date(startDate);

    while (currentDate <= endDate) {
      intervals.push(new Date(currentDate));

      switch (precision) {
        case XAxisPrecision.EVERY_SECOND:
          currentDate.setSeconds(currentDate.getSeconds() + 1);
          break;
        case XAxisPrecision.EVERY_FIVE_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 5);
          break;
        case XAxisPrecision.EVERY_TEN_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 10);
          break;
        case XAxisPrecision.EVERY_THIRTY_SECONDS:
          currentDate.setSeconds(currentDate.getSeconds() + 30);
          break;
        case XAxisPrecision.EVERY_MINUTE:
          currentDate.setMinutes(currentDate.getMinutes() + 1);
          break;
        case XAxisPrecision.EVERY_FIVE_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 5);
          break;
        case XAxisPrecision.EVERY_TEN_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 10);
          break;
        case XAxisPrecision.EVERY_THIRTY_MINUTES:
          currentDate.setMinutes(currentDate.getMinutes() + 30);
          break;
        case XAxisPrecision.EVERY_HOUR:
          currentDate.setHours(currentDate.getHours() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_HOURS:
          currentDate.setHours(currentDate.getHours() + 2);
          break;
        case XAxisPrecision.EVERY_THREE_HOURS:
          currentDate.setHours(currentDate.getHours() + 3);
          break;
        case XAxisPrecision.EVERY_SIX_HOURS:
          currentDate.setHours(currentDate.getHours() + 6);
          break;
        case XAxisPrecision.EVERY_TWELVE_HOURS:
          currentDate.setHours(currentDate.getHours() + 12);
          break;
        case XAxisPrecision.EVERY_DAY:
          currentDate.setDate(currentDate.getDate() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_DAYS:
          currentDate.setDate(currentDate.getDate() + 2);
          break;
        case XAxisPrecision.EVERY_WEEK:
          currentDate.setDate(currentDate.getDate() + 7);
          break;
        case XAxisPrecision.EVERY_TWO_WEEKS:
          currentDate.setDate(currentDate.getDate() + 14);
          break;
        case XAxisPrecision.EVERY_MONTH:
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        case XAxisPrecision.EVERY_TWO_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 2);
          break;
        case XAxisPrecision.EVERY_THREE_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 3);
          break;
        case XAxisPrecision.EVERY_SIX_MONTHS:
          currentDate.setMonth(currentDate.getMonth() + 6);
          break;
        case XAxisPrecision.EVERY_YEAR:
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          break;
      }
    }

    return intervals;
  }

  public static getFormatter(data: {
    xAxisMin: XAxisMaxMin;
    xAxisMax: XAxisMaxMin;
  }): (value: Date) => string {
    const precision: XAxisPrecision = XAxisUtil.getPrecision(data);

    switch (precision) {
      case XAxisPrecision.EVERY_SECOND:
        return (value: Date) => {
          // round down to nearest second
          return value.toISOString().substring(11, 19);
        };
      case XAxisPrecision.EVERY_FIVE_SECONDS:
        // round down to nearest 5 seconds
        return (value: Date) => {
          const seconds: number = value.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 5) * 5;
          value.setSeconds(roundedSeconds);
          return value.toISOString().substring(11, 19);
        };
      case XAxisPrecision.EVERY_TEN_SECONDS:
        // round down to nearest 10 seconds
        return (value: Date) => {
          const seconds: number = value.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 10) * 10;
          value.setSeconds(roundedSeconds);
          return value.toISOString().substring(11, 19);
        };
      case XAxisPrecision.EVERY_THIRTY_SECONDS:
        // round down to nearest 30 seconds
        return (value: Date) => {
          const seconds: number = value.getSeconds();
          const roundedSeconds: number = Math.floor(seconds / 30) * 30;
          value.setSeconds(roundedSeconds);
          return value.toISOString().substring(11, 19);
        };
      case XAxisPrecision.EVERY_MINUTE:
        // round down to nearest minute
        return (value: Date) => {
          return value.toISOString().substring(11, 16);
        };
      case XAxisPrecision.EVERY_FIVE_MINUTES:
        // round down to nearest 5 minutes
        return (value: Date) => {
          const minutes: number = value.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 5) * 5;
          value.setMinutes(roundedMinutes);
          return value.toISOString().substring(11, 16);
        };
      case XAxisPrecision.EVERY_TEN_MINUTES:
        // round down to nearest 10 minutes
        return (value: Date) => {
          const minutes: number = value.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 10) * 10;
          value.setMinutes(roundedMinutes);
          return value.toISOString().substring(11, 16);
        };
      case XAxisPrecision.EVERY_THIRTY_MINUTES:
        // round down to nearest 30 minutes
        return (value: Date) => {
          const minutes: number = value.getMinutes();
          const roundedMinutes: number = Math.floor(minutes / 30) * 30;
          value.setMinutes(roundedMinutes);
          return value.toISOString().substring(11, 16);
        };
      case XAxisPrecision.EVERY_HOUR:
        return (value: Date) => {
          return value.toISOString().substring(11, 13);
        }; // HH:00
      case XAxisPrecision.EVERY_TWO_HOURS:
        return (value: Date) => {
          const hours: number = value.getHours();
          const roundedHours: number = Math.floor(hours / 2) * 2;
          value.setHours(roundedHours);

          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}, ${value.toISOString().substring(11, 13)}:00`;
        };
      case XAxisPrecision.EVERY_THREE_HOURS:
        // round down to nearest 3 hours
        return (value: Date) => {
          const hours: number = value.getHours();
          const roundedHours: number = Math.floor(hours / 3) * 3;
          value.setHours(roundedHours);

          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}, ${value.toISOString().substring(11, 13)}:00`;
        };
      case XAxisPrecision.EVERY_SIX_HOURS:
        // round down to nearest 6 hours // HH:00 DD MMM
        return (value: Date) => {
          const hours: number = value.getHours();
          const roundedHours: number = Math.floor(hours / 6) * 6;
          value.setHours(roundedHours);

          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}, ${value.toISOString().substring(11, 13)}:00`;
        };
      case XAxisPrecision.EVERY_TWELVE_HOURS:
        // round down to nearest 12 hours  // DD MMM, HH:00
        return (value: Date) => {
          const hours: number = value.getHours();
          const roundedHours: number = Math.floor(hours / 12) * 12;
          value.setHours(roundedHours);

          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          const hour: string = dateString.substring(11, 13);
          return `${day} ${month}, ${hour}:00`;
        };
      case XAxisPrecision.EVERY_DAY:
        // round down to nearest day
        return (value: Date) => {
          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}`;
        };
      case XAxisPrecision.EVERY_TWO_DAYS:
        // round down to nearest 2 days
        return (value: Date) => {
          const days: number = value.getDate();
          const roundedDays: number = Math.floor(days / 2) * 2;
          value.setDate(roundedDays);
          const dateString: string = value.toISOString();
          const day: string = dateString.substring(8, 10);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}`;
        };
      case XAxisPrecision.EVERY_WEEK:
        // round down to nearest week
        return (value: Date) => {
          const day: string = value.getDate().toString();
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}`;
        };
      case XAxisPrecision.EVERY_TWO_WEEKS:
        // round down to nearest 2 weeks. // DD MMM
        return (value: Date) => {
          const days: number = value.getDate();
          const roundedDays: number = Math.floor(days / 2) * 2;
          value.setDate(roundedDays);
          const day: string = value.getDate().toString();
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          return `${day} ${month}`;
        };
      case XAxisPrecision.EVERY_MONTH:
        // round down to nearest month // MM YYYY
        return (value: Date) => {
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          const year: string = value.getFullYear().toString();
          return `${month} ${year}`;
        };

      case XAxisPrecision.EVERY_TWO_MONTHS:
        // round down to nearest 2 months // MM YYYY
        return (value: Date) => {
          const months: number = value.getMonth();
          const roundedMonths: number = Math.floor(months / 2) * 2;
          value.setMonth(roundedMonths);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          const year: string = value.getFullYear().toString();
          return `${month} ${year}`;
        };
      case XAxisPrecision.EVERY_THREE_MONTHS:
        // round down to nearest 3 months // MM YYYY
        return (value: Date) => {
          const months: number = value.getMonth();
          const roundedMonths: number = Math.floor(months / 3) * 3;
          value.setMonth(roundedMonths);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          const year: string = value.getFullYear().toString();
          return `${month} ${year}`;
        };
      case XAxisPrecision.EVERY_SIX_MONTHS:
        // round down to nearest 6 months // MM YYYY
        return (value: Date) => {
          const months: number = value.getMonth();
          const roundedMonths: number = Math.floor(months / 6) * 6;
          value.setMonth(roundedMonths);
          const month: string = value.toLocaleString("default", {
            month: "short",
          });
          const year: string = value.getFullYear().toString();
          return `${month} ${year}`;
        };
      case XAxisPrecision.EVERY_YEAR:
        // round down to nearest year // YYYY
        return (value: Date) => {
          return value.getFullYear().toString();
        };
      default:
        throw new Error("Unsupported precision");
    }
  }
}
