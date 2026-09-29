import OneUptimeDate, { CalendarUnit } from "../../Types/Date";
import EventInterval from "../../Types/Events/EventInterval";
import Recurring from "../../Types/Events/Recurring";
import StatusPageReportPeriodType from "../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../Types/Timezone";

/*
 * The exact stretch of time one scheduled status page report covers, plus the
 * strings the email and the settings screen use to describe it.
 *
 * Deliberately pure and synchronous, and deliberately in Common/Utils rather
 * than Common/Server: the settings screen renders the very same window the
 * worker will use, so what the user is shown before saving is what actually
 * gets emailed. That is the whole point of the calendar option - a report is no
 * longer "whatever the last 30 days happened to be when the cron fired".
 */
export interface StatusPageReportPeriod {
  // Inclusive. The first instant the report measures.
  startDate: Date;
  // Inclusive. The last instant the report measures.
  endDate: Date;
  // Whole days spanned, kept for display and for callers that think in days.
  numberOfDays: number;
  // The zone every boundary above was resolved in.
  timezone: Timezone;
  /*
   * The `report.reportDates` template variable. Rolling windows keep the exact
   * shape they have always had ("30 days (Jun 29, 2026 - Jul 29, 2026)") so
   * customer-authored email templates written against it keep reading the same;
   * calendar windows, which are new, are just the range.
   */
  reportDates: string;
  /*
   * How a sentence refers to the period: "the last 30 days", "July 2026",
   * "the week of Jul 27, 2026". Reads correctly after "your status summary
   * for ...", which the old string did not once periods stopped being rolling.
   */
  periodName: string;
}

export default class StatusPageReportPeriodUtil {
  public static readonly DEFAULT_REPORT_DATA_IN_DAYS: number = 30;
  public static readonly DEFAULT_TIMEZONE: Timezone = Timezone.UTC;

  public static getDefaultPeriodType(): StatusPageReportPeriodType {
    return StatusPageReportPeriodType.Rolling;
  }

  /*
   * Resolve the window a report sent at `sentAt` (default: now) covers.
   *
   * Everything is optional because this is called with a half-filled form as
   * the user types, and with columns that are null on status pages created
   * before reports were configurable. Missing values fall back to the same
   * defaults the database columns carry.
   */
  public static getReportPeriod(data: {
    periodType?: StatusPageReportPeriodType | undefined;
    reportRecurringInterval?: Recurring | undefined;
    reportDataInDays?: number | undefined;
    timezone?: Timezone | undefined;
    sentAt?: Date | undefined;
  }): StatusPageReportPeriod {
    const timezone: Timezone = data.timezone || this.DEFAULT_TIMEZONE;
    const sentAt: Date = data.sentAt || OneUptimeDate.getCurrentDate();

    if (data.periodType === StatusPageReportPeriodType.PreviousCalendarPeriod) {
      return this.getPreviousCalendarPeriod({
        reportRecurringInterval: data.reportRecurringInterval,
        timezone: timezone,
        sentAt: sentAt,
      });
    }

    return this.getRollingPeriod({
      reportDataInDays: data.reportDataInDays,
      timezone: timezone,
      sentAt: sentAt,
    });
  }

  private static getRollingPeriod(data: {
    reportDataInDays?: number | undefined;
    timezone: Timezone;
    sentAt: Date;
  }): StatusPageReportPeriod {
    const numberOfDays: number = this.toWholeDays(
      data.reportDataInDays,
      this.DEFAULT_REPORT_DATA_IN_DAYS,
    );

    const endDate: Date = data.sentAt;
    const startDate: Date = OneUptimeDate.getSomeDaysAgoFromDate(
      endDate,
      numberOfDays,
    );

    return {
      startDate: startDate,
      endDate: endDate,
      numberOfDays: numberOfDays,
      timezone: data.timezone,
      reportDates: `${numberOfDays} days (${this.formatDay(startDate, data.timezone)} - ${this.formatDay(endDate, data.timezone)})`,
      periodName:
        numberOfDays === 1 ? "the last day" : `the last ${numberOfDays} days`,
    };
  }

  /*
   * The last WHOLE calendar period before the report went out, sized by the
   * send frequency. A monthly report sent at any point in August covers
   * 1 Aug 00:00:00.000 minus one month through 31 Jul 23:59:59.999 - i.e. July,
   * exactly as it reads on a calendar, in the status page's report timezone.
   */
  private static getPreviousCalendarPeriod(data: {
    reportRecurringInterval?: Recurring | undefined;
    timezone: Timezone;
    sentAt: Date;
  }): StatusPageReportPeriod {
    const recurring: Recurring = data.reportRecurringInterval
      ? Recurring.fromJSON(data.reportRecurringInterval)
      : Recurring.getDefault();

    const unit: CalendarUnit = Recurring.toCalendarUnit(recurring.intervalType);
    const intervalCount: number = this.toWholeDays(
      recurring.intervalCount?.toNumber(),
      1,
    );

    /*
     * Exclusive upper bound: the start of the period the report is being sent
     * IN, which is the first instant not yet covered. The inclusive endDate
     * below steps back a millisecond from it so the email reads "Jul 31" rather
     * than "Aug 1".
     */
    const endExclusive: Date = OneUptimeDate.getStartOfCalendarUnit(
      data.sentAt,
      unit,
      data.timezone,
    );

    const startDate: Date = OneUptimeDate.addRemoveCalendarUnits(
      endExclusive,
      unit,
      -intervalCount,
      data.timezone,
    );

    const endDate: Date = new Date(endExclusive.getTime() - 1);

    return {
      startDate: startDate,
      endDate: endDate,
      numberOfDays: Math.max(
        1,
        Math.round(
          (endExclusive.getTime() - startDate.getTime()) /
            OneUptimeDate.getMillisecondsInDays(1),
        ),
      ),
      timezone: data.timezone,
      reportDates: `${this.formatDay(startDate, data.timezone)} - ${this.formatDay(endDate, data.timezone)}`,
      periodName: this.getCalendarPeriodName({
        intervalType: recurring.intervalType,
        intervalCount: intervalCount,
        startDate: startDate,
        endDate: endDate,
        timezone: data.timezone,
      }),
    };
  }

  private static getCalendarPeriodName(data: {
    intervalType: EventInterval;
    intervalCount: number;
    startDate: Date;
    endDate: Date;
    timezone: Timezone;
  }): string {
    /*
     * Only a single-unit period has a name a reader already knows ("July 2026").
     * Anything spanning several units, and hourly periods, are clearer as an
     * explicit range.
     */
    if (data.intervalCount === 1) {
      if (data.intervalType === EventInterval.Month) {
        return this.format(data.startDate, "MMMM YYYY", data.timezone);
      }

      if (data.intervalType === EventInterval.Year) {
        return this.format(data.startDate, "YYYY", data.timezone);
      }

      if (data.intervalType === EventInterval.Week) {
        return `the week of ${this.formatDay(data.startDate, data.timezone)}`;
      }

      if (data.intervalType === EventInterval.Day) {
        return this.formatDay(data.startDate, data.timezone);
      }
    }

    return `${this.formatDay(data.startDate, data.timezone)} - ${this.formatDay(data.endDate, data.timezone)}`;
  }

  /*
   * Guard against the nulls, decimals and zeroes a JSON column or a mid-edit
   * form field can hold. A zero-length window would divide by zero downstream.
   */
  private static toWholeDays(
    value: number | undefined | null,
    fallback: number,
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      return fallback;
    }

    return Math.floor(value);
  }

  private static formatDay(date: Date, timezone: Timezone): string {
    return this.format(date, "MMM D, YYYY", timezone);
  }

  private static format(
    date: Date,
    format: string,
    timezone: Timezone,
  ): string {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: format,
      timezone: timezone,
    });
  }
}
