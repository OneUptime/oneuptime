/** @timezone Europe/London */

import { describe, expect, test } from "@jest/globals";
import XAxisMaxMin from "../../../UI/Components/Charts/Types/XAxis/XAxisMaxMin";
import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";

/*
 * The daylight-saving half of the label-uniqueness property, in the OTHER
 * of the two configurations it has to hold in.
 *
 * OneUptimeDate.getCurrentTimezone() is `userTimezone || moment.tz.guess()`,
 * so a user who has never opened User Settings reads dates in the zone the
 * browser reports — the configured and browser zones are the SAME. That is
 * this file (the docblock sets both to London). XAxis.test.ts covers the
 * other configuration, where a user has picked a zone the browser does not
 * report.
 *
 * They used to behave differently: the interval walker stepped in browser
 * wall-clock time, so when the zones agreed it walked straight over the
 * repeated hour - its points were filed under the first reading of each
 * minute, the second hour's under the first's - while when they differed
 * the hour was emitted twice over. Steps of an hour or less are now a
 * fixed number of milliseconds (issue #7127), so both configurations walk
 * through the repeated hour, and the zone tells its two readings apart.
 */

const WINDOW_START: Date = new Date("2026-10-25T00:00:00.000Z");

/*
 * London's 2026 fall-back: 02:00 BST becomes 01:00 GMT, so 01:00-01:59
 * is a wall-clock reading that names two different instants that day.
 */
const FOUR_HOURS_ACROSS_THE_FALL_BACK: {
  xAxisMin: XAxisMaxMin;
  xAxisMax: XAxisMaxMin;
} = {
  xAxisMin: WINDOW_START,
  xAxisMax: new Date(WINDOW_START.getTime() + 4 * 60 * 60 * 1000),
};

function labelsFor(bounds: {
  xAxisMin: XAxisMaxMin;
  xAxisMax: XAxisMaxMin;
}): Array<string> {
  const formatter: (value: Date) => string = XAxisUtil.getFormatter(bounds);
  return XAxisUtil.getPrecisionIntervals(bounds).map((interval: Date) => {
    return formatter(interval);
  });
}

/** The zone London is really in at `date`, straight from the platform. */
function actualZoneAbbr(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part: Intl.DateTimeFormatPart): boolean => {
        return part.type === "timeZoneName";
      })?.value || ""
  );
}

describe("a fall-back window when the browser and configured zones agree", () => {
  test("no two ticks share a label", () => {
    const labels: Array<string> = labelsFor(FOUR_HOURS_ACROSS_THE_FALL_BACK);

    expect(new Set(labels).size).toBe(labels.length);
  });

  test("every tick names the zone it is really in", () => {
    /*
     * The labels carry a zone abbreviation here, and an abbreviation that
     * lied would be worse than none — a reader would take an instant for
     * one an hour away. Checked against the platform's own answer rather
     * than against our formatter.
     */
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals(
      FOUR_HOURS_ACROSS_THE_FALL_BACK,
    );
    const labels: Array<string> = labelsFor(FOUR_HOURS_ACROSS_THE_FALL_BACK);

    for (let index: number = 0; index < intervals.length; index++) {
      expect(labels[index]).toContain(actualZoneAbbr(intervals[index]!));
    }
  });

  test("the repeated hour is walked twice, BST and then GMT", () => {
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals(
      FOUR_HOURS_ACROSS_THE_FALL_BACK,
    );
    const labels: Array<string> = labelsFor(FOUR_HOURS_ACROSS_THE_FALL_BACK);

    /*
     * Four hours of five-minute steps, the repeated hour included: the
     * same 49 ticks the window has when the browser is in UTC
     * (XAxis.test.ts). Before, the walk stepped the browser's clock and
     * went from 01:55 BST straight to 02:00 GMT, an hour and five minutes,
     * so the axis had 37 ticks and no slot for 01:00-01:55 GMT.
     */
    expect(intervals).toHaveLength(49);
    for (let index: number = 1; index < intervals.length; index++) {
      expect(
        intervals[index]!.getTime() - intervals[index - 1]!.getTime(),
      ).toBe(5 * 60 * 1000);
    }

    expect(labels).toContain("25 Oct, 01:00 BST");
    expect(labels).toContain("25 Oct, 01:55 BST");
    expect(labels).toContain("25 Oct, 01:00 GMT");
    expect(labels).toContain("25 Oct, 01:55 GMT");
    expect(labels).toContain("25 Oct, 02:00 GMT");
    expect(labels.indexOf("25 Oct, 01:00 GMT")).toBe(
      labels.indexOf("25 Oct, 01:55 BST") + 1,
    );
  });

  test("a point in the second 01:30 is filed under 01:30 GMT, not 01:30 BST", () => {
    /*
     * Rounding a point with Date's setters re-read its clock time, and the
     * second 01:30 reads as the first: its point joined the first hour's.
     */
    const formatter: (value: Date) => string = XAxisUtil.getFormatter(
      FOUR_HOURS_ACROSS_THE_FALL_BACK,
    );

    expect(formatter(new Date("2026-10-25T00:32:10.000Z"))).toBe(
      "25 Oct, 01:30 BST",
    );
    expect(formatter(new Date("2026-10-25T01:32:10.000Z"))).toBe(
      "25 Oct, 01:30 GMT",
    );
  });

  test("an ordinary window in the same zone keeps its bare labels", () => {
    // No transition, well under a day: nothing to disambiguate, nothing spent.
    const summer: Date = new Date("2026-06-01T00:00:00.000Z");
    const labels: Array<string> = labelsFor({
      xAxisMin: summer,
      xAxisMax: new Date(summer.getTime() + 6 * 60 * 60 * 1000),
    });

    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
