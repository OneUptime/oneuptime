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
 * The two behave differently and both need holding: the interval walker
 * steps in browser wall-clock time, so when the zones agree it walks
 * straight over the repeated hour and never emits it twice, while when
 * they differ the transition is invisible to it and the hour is emitted
 * twice over.
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

  test("the transition reads straight through, BST into GMT", () => {
    const labels: Array<string> = labelsFor(FOUR_HOURS_ACROSS_THE_FALL_BACK);

    /*
     * Stepping wall-clock minutes in the browser's own zone walks over the
     * repeated hour rather than through it, so the axis never holds both
     * 01:30s. It still says which side of the change each tick is on.
     */
    expect(labels).toContain("25 Oct, 01:55 BST");
    expect(labels).toContain("25 Oct, 02:00 GMT");
    expect(labels).not.toContain("25 Oct, 01:00 GMT");
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
