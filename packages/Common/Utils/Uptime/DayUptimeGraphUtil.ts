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
