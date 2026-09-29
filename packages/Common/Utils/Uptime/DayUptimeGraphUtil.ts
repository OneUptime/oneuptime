/*
 * The keyboard and screen reader behaviour of the day-by-day uptime strip.
 *
 * The strip is one bar per day - ninety of them on a default status page, and
 * one strip per resource. That shape rules out the obvious accessibility fix
 * of making every bar a tab stop: a page with twenty resources would put
 * eighteen hundred stops between the visitor and the footer. The strip is
 * therefore a composite widget with a roving tabindex - one stop for the whole
 * strip, arrow keys to move within it - which is the pattern ARIA prescribes
 * for exactly this.
 *
 * Everything here is pure so the navigation maths and the wording of the
 * accessible names can be tested without a renderer.
 */

import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../Types/Monitor/UptimeHistoryLabels";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";

/*
 * One bar of the strip: the calendar day it stands for, as instants.
 */
export interface UptimeGraphDay {
  /* The instant the bar is labelled and reported by. */
  date: Date;
  startOfDay: Date;
  endOfDay: Date;
}

export default class DayUptimeGraphUtil {
  /* How far PageUp / PageDown jump. A week reads naturally on a daily strip. */
  public static readonly PageJumpInDays: number = 7;

  /*
   * Where focus goes for a key pressed on the bar at `currentIndex`, or null
   * when the key is not one this widget handles - in which case the caller
   * must leave the event alone so that Tab, Enter and Space keep their normal
   * meaning.
   *
   * Movement clamps rather than wraps. Wrapping a ninety day history would
   * jump from today to three months ago on one arrow press, which reads as a
   * glitch rather than as navigation.
   */
  public static getNextFocusIndex(data: {
    key: string;
    currentIndex: number;
    barCount: number;
  }): number | null {
    if (data.barCount <= 0) {
      return null;
    }

    const lastIndex: number = data.barCount - 1;

    /*
     * A caller whose index has drifted out of range (the window shrank under
     * it, say) is still owed sane movement, so clamp before moving rather
     * than after.
     */
    const current: number = Math.min(Math.max(data.currentIndex, 0), lastIndex);

    let next: number | null = null;

    switch (data.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = current + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = lastIndex;
        break;
      case "PageDown":
        next = current + this.PageJumpInDays;
        break;
      case "PageUp":
        next = current - this.PageJumpInDays;
        break;
      default:
        return null;
    }

    return Math.min(Math.max(next, 0), lastIndex);
  }

  /*
   * The strip's single tab stop. Today is the bar a visitor wants first, so
   * that is where focus lands before anything has been focused, and it is
   * also where focus lands again if the window shrinks under a stored index.
   */
  public static getActiveBarIndex(data: {
    storedIndex: number | null;
    barCount: number;
  }): number {
    if (data.barCount <= 0) {
      return 0;
    }

    const lastIndex: number = data.barCount - 1;

    if (data.storedIndex === null) {
      return lastIndex;
    }

    return Math.min(Math.max(data.storedIndex, 0), lastIndex);
  }

  public static getBarTabIndex(data: {
    index: number;
    activeIndex: number;
  }): number {
    return data.index === data.activeIndex ? 0 : -1;
  }

  /*
   * Uptime the way it is said out loud rather than the way it is drawn.
   * Trailing zeroes are noise in a screen reader ("ninety nine point nine
   * zero percent"), and a bar that is a hair under 100 must not be read as
   * 100 - "100% uptime" on a day that had an outage is a wrong statement, not
   * a rounding.
   */
  public static formatUptimePercentForLabel(percent: number): string {
    if (!Number.isFinite(percent)) {
      return "0";
    }

    const clamped: number = Math.min(Math.max(percent, 0), 100);

    if (clamped === 100) {
      return "100";
    }

    const rounded: number = Math.round(clamped * 100) / 100;

    if (rounded >= 100) {
      return "99.99";
    }

    // Drop a trailing ".0" / ".00" so whole numbers read as whole numbers.
    return String(parseFloat(rounded.toFixed(2)));
  }

  public static getDayAriaLabel(data: {
    dateLabel: string;
    hasEvents: boolean;
    uptimePercent: number;
    incidentCount: number;
    labels?: UptimeHistoryLabels | undefined;
  }): string {
    const labels: UptimeHistoryLabels =
      data.labels || DefaultUptimeHistoryLabels;

    const incidentCount: number = Math.max(data.incidentCount, 0);
    const hasIncidents: boolean = incidentCount > 0;

    if (!data.hasEvents) {
      return this.interpolate(
        hasIncidents
          ? labels.dayLabelNoDataWithIncidents
          : labels.dayLabelNoData,
        {
          date: data.dateLabel,
          total: String(incidentCount),
        },
      );
    }

    return this.interpolate(
      hasIncidents ? labels.dayLabelWithIncidents : labels.dayLabel,
      {
        date: data.dateLabel,
        uptime: this.formatUptimePercentForLabel(data.uptimePercent),
        total: String(incidentCount),
      },
    );
  }

  public static getGraphAriaLabel(data: {
    dayCount: number;
    labels?: UptimeHistoryLabels | undefined;
  }): string {
    const labels: UptimeHistoryLabels =
      data.labels || DefaultUptimeHistoryLabels;

    return this.interpolate(labels.graphLabel, {
      total: String(Math.max(data.dayCount, 0)),
    });
  }

  public static isValidTimezone(timezone: unknown): timezone is string {
    return (
      typeof timezone === "string" &&
      timezone.trim() !== "" &&
      moment.tz.zone(timezone) !== null
    );
  }

  /*
   * The calendar days the strip draws, oldest first, one per bar.
   *
   * Without a zone this is the strip's long-standing behaviour, unchanged:
   * the browser's own days, stepped from startDate.
   *
   * With a zone, the days are that zone's days. A strip painted from server
   * readings must pass the zone the server cut its buckets in, or a bar and
   * the reading it is painted from describe different spans of time. The
   * status page's buckets are UTC days, shared by every visitor through one
   * cached response. Drawn on a New York visitor's local days, each UTC
   * bucket started at 20:00 the PREVIOUS local day, so every bar showed the
   * next day's reading and today's bar had no reading at all.
   *
   * The zone path steps calendar days in the zone rather than adding 24
   * hours, so a DST day is one bar of 23 or 25 hours, as the server's bucket
   * for it is.
   */
  public static getDays(data: {
    startDate: Date;
    endDate: Date;
    timezone?: string | undefined;
  }): Array<UptimeGraphDay> {
    const days: Array<UptimeGraphDay> = [];

    if (!this.isValidTimezone(data.timezone)) {
      const count: number = OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
        data.startDate,
        data.endDate,
      );

      for (let i: number = 0; i < count; i++) {
        const date: Date = OneUptimeDate.getSomeDaysAfterDate(
          data.startDate,
          i,
        );

        days.push({
          date: date,
          startOfDay: OneUptimeDate.getStartOfDay(date),
          endOfDay: OneUptimeDate.getEndOfDay(date),
        });
      }

      return days;
    }

    const timezone: string = data.timezone;

    const firstDay: Date = OneUptimeDate.getStartOfDay(
      data.startDate,
      timezone,
    );
    const lastDay: Date = OneUptimeDate.getStartOfDay(data.endDate, timezone);

    /*
     * Rounded, because a span of calendar days that crosses a DST change is
     * a whole number of days give or take an hour, never exactly.
     */
    const count: number =
      Math.round(
        (lastDay.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000),
      ) + 1;

    /*
     * Stepped from local MIDDAY, not midnight. In a zone that changes its
     * clocks at midnight (America/Santiago, America/Havana, Asia/Beirut) that
     * day has no 00:00, and stepping a midnight onto it keeps the old offset
     * and lands on 23:00 of the PREVIOUS day - which would draw that day twice
     * and skip the next. Midday is never in a DST gap. addRemoveHours adds
     * absolute hours, so the anchor is 11:00-13:00 local on firstDay's own
     * date even when that date is 23 or 25 hours long.
     */
    const midday: Date = OneUptimeDate.addRemoveHours(firstDay, 12);

    const getStartOfNthDay: (n: number) => Date = (n: number): Date => {
      return OneUptimeDate.getStartOfDay(
        OneUptimeDate.addRemoveDays(midday, n, timezone),
        timezone,
      );
    };

    for (let i: number = 0; i < count; i++) {
      const startOfDay: Date = getStartOfNthDay(i);

      days.push({
        date: startOfDay,
        startOfDay: startOfDay,
        /*
         * The next day's start less a millisecond, not endOf("day"): on a
         * day whose clock repeats its last hour, endOf("day") is the FIRST
         * 23:59:59.999 and the repeated hour would belong to no bar.
         */
        endOfDay: new Date(getStartOfNthDay(i + 1).getTime() - 1),
      });
    }

    return days;
  }

  /*
   * The date a bar is labelled with, in the zone its day was drawn in.
   *
   * When that zone draws a different calendar day from the visitor's own -
   * a UTC strip read from New York - the label says which zone it is, so
   * "Sep 23" at eight in the evening on Sep 22 reads as the UTC date it is
   * rather than as a mistake. When the two agree on the day (a UTC strip read
   * in London in winter), the label is left alone.
   */
  public static formatDayLabel(data: {
    date: Date;
    timezone?: string | undefined;
  }): string {
    if (!this.isValidTimezone(data.timezone)) {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        data.date,
        true,
      );
    }

    const label: string =
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: data.date,
        format: "MMM DD, YYYY",
        timezone: data.timezone,
      });

    const viewerTimezone: string = OneUptimeDate.getCurrentTimezone();

    const barOffset: number = moment(data.date).tz(data.timezone).utcOffset();
    const viewerOffset: number = this.isValidTimezone(viewerTimezone)
      ? moment(data.date).tz(viewerTimezone).utcOffset()
      : barOffset;

    if (barOffset === viewerOffset) {
      return label;
    }

    return `${label} (${OneUptimeDate.getZoneAbbrByTimezone(
      data.timezone as Timezone,
      data.date,
    )})`;
  }

  /*
   * The same {{placeholder}} shape i18next uses, so a caller can hand these
   * strings straight from a translation file. Replacing rather than
   * formatting keeps this dependency-free and keeps a missing placeholder
   * from throwing on a half translated locale - the worst case is a literal
   * "{{uptime}}" in a label, not a page that fails to render.
   */
  private static interpolate(
    template: string,
    values: Record<string, string>,
  ): string {
    let result: string = template;

    for (const key of Object.keys(values)) {
      result = result.split(`{{${key}}}`).join(values[key] as string);
    }

    return result;
  }
}
