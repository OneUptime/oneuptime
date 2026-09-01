/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import XAxisMaxMin from "../../../UI/Components/Charts/Types/XAxis/XAxisMaxMin";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";

/*
 * A chart's x-axis label is the IDENTITY of its bucket, not decoration:
 * DataPointUtil places a series row by finding the first row whose label
 * matches, TimeAnnotationUtil resolves an event marker the same way, and
 * recharts' categorical scale resolves no category at all once its domain
 * holds a duplicate.
 *
 * These tests hold the property that makes all three safe — inside any one
 * window, no two ticks may share a label — and the corollary that a window
 * short enough not to need help keeps its short labels.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;

const WINDOW_START: Date = new Date("2026-03-02T00:00:00.000Z");

function windowOf(
  hours: number,
  start: Date = WINDOW_START,
): {
  xAxisMin: XAxisMaxMin;
  xAxisMax: XAxisMaxMin;
} {
  return {
    xAxisMin: start,
    xAxisMax: new Date(start.getTime() + hours * HOUR_IN_MS),
  };
}

function labelsFor(bounds: {
  xAxisMin: XAxisMaxMin;
  xAxisMax: XAxisMaxMin;
}): Array<string> {
  const formatter: (value: Date) => string = XAxisUtil.getFormatter(bounds);
  return XAxisUtil.getPrecisionIntervals(bounds).map((interval: Date) => {
    return formatter(interval);
  });
}

afterEach((): void => {
  OneUptimeDate.setUserTimezone(null);
});

describe("XAxisUtil label uniqueness", () => {
  test("a 24 hour window labels every one of its 97 ticks distinctly", () => {
    /*
     * The reported bug. A 24h window sits on the fifteen-minute tier and
     * spans 97 interval starts, but a bare "HH:mm" only has 96 readings in
     * a day — the first and last tick both read "00:00", so the last
     * bucket's data and annotations were folded onto the first.
     */
    const bounds: ReturnType<typeof windowOf> = windowOf(24);

    expect(XAxisUtil.getPrecision(bounds)).toBe(
      XAxisPrecision.EVERY_FIFTEEN_MINUTES,
    );

    const labels: Array<string> = labelsFor(bounds);

    expect(labels).toHaveLength(97);
    expect(new Set(labels).size).toBe(97);
  });

  test("a 48 hour window labels every one of its 97 ticks distinctly", () => {
    /*
     * The severe case. A 48h window sits on the thirty-minute tier: 97
     * interval starts over a bare "HH:mm" that has only 48 readings, so
     * every label appeared exactly twice and the whole of day two merged
     * onto day one.
     */
    const bounds: ReturnType<typeof windowOf> = windowOf(48);

    expect(XAxisUtil.getPrecision(bounds)).toBe(
      XAxisPrecision.EVERY_THIRTY_MINUTES,
    );

    const labels: Array<string> = labelsFor(bounds);

    expect(labels).toHaveLength(97);
    expect(new Set(labels).size).toBe(97);
  });

  test.each([
    ["6 hours", 6, 73],
    ["12 hours", 12, 145],
    ["13 hours", 13, 53],
    ["23 hours", 23, 93],
    ["24 hours", 24, 97],
    ["36 hours", 36, 73],
    ["48 hours", 48, 97],
    ["72 hours", 72, 145],
    ["5 days", 120, 121],
  ])(
    "%s: no two ticks share a label",
    (_name: string, hours: number, expectedTicks: number): void => {
      const labels: Array<string> = labelsFor(windowOf(hours));

      expect(labels).toHaveLength(expectedTicks);
      expect(new Set(labels).size).toBe(labels.length);
    },
  );

  test("no window across three days repeats a label, at any tier", () => {
    /*
     * The property itself, swept rather than sampled — including windows
     * that start off a clean boundary, which is what a live "last N hours"
     * range always does.
     */
    const start: Date = new Date("2026-03-02T07:23:00.000Z");
    const repeating: Array<string> = [];

    for (let minutes: number = 15; minutes <= 3 * 24 * 60; minutes += 97) {
      const bounds: { xAxisMin: XAxisMaxMin; xAxisMax: XAxisMaxMin } = {
        xAxisMin: start,
        xAxisMax: new Date(start.getTime() + minutes * 60 * 1000),
      };
      const labels: Array<string> = labelsFor(bounds);
      if (new Set(labels).size !== labels.length) {
        repeating.push(
          `${minutes}min: ${labels.length} ticks, ${new Set(labels).size} distinct`,
        );
      }
    }

    expect(repeating).toEqual([]);
  });
});

describe("XAxisUtil label verbosity", () => {
  test("a window that cannot wrap the clock keeps its bare time labels", () => {
    /*
     * The date is bought at the cost of nearly tripling the label width,
     * so it is only spent where a bare reading would be ambiguous. 23h is
     * the last window that cannot repeat one.
     */
    const labels: Array<string> = labelsFor(windowOf(23));

    expect(labels[0]).toBe("00:00");
    expect(labels[labels.length - 1]).toBe("23:00");
  });

  test("a window that can wrap the clock says which day each tick is", () => {
    const labels: Array<string> = labelsFor(windowOf(48));

    expect(labels[0]).toBe("02 Mar, 00:00");
    expect(labels[labels.length - 1]).toBe("04 Mar, 00:00");
    // The same clock reading on the two days is now two different labels.
    expect(labels).toContain("03 Mar, 00:00");
  });

  test("the day-qualified form matches the shape the hourly tier already uses", () => {
    /*
     * EVERY_HOUR and every coarser tier have carried "DD MMM, HH:00" for
     * this same reason all along, so the finer tiers borrow its shape
     * rather than inventing one.
     */
    const hourly: Array<string> = labelsFor(windowOf(5 * 24));
    const subHourly: Array<string> = labelsFor(windowOf(48));

    expect(hourly[0]).toBe("02 Mar, 00:00");
    expect(subHourly[0]).toBe("02 Mar, 00:00");
  });
});

describe("XAxisUtil labels across a daylight saving transition", () => {
  /*
   * The browser reports UTC here (see the docblock) while the user has
   * configured London — the normal case for anyone who has set a timezone,
   * and the one where a transition in the configured zone is invisible to
   * the interval walker.
   */

  test("clocks going back do not give two ticks the same label", () => {
    /*
     * On 2026-10-25 London runs 01:00-01:59 BST and then 01:00-01:59 GMT.
     * A four hour window is nowhere near long enough to wrap the clock,
     * but the replayed hour repeated twelve five-minute labels — and the
     * date does not settle it either, since both readings are on the 25th.
     */
    OneUptimeDate.setUserTimezone("Europe/London" as Timezone);

    const bounds: ReturnType<typeof windowOf> = windowOf(
      4,
      new Date("2026-10-25T00:00:00.000Z"),
    );
    const labels: Array<string> = labelsFor(bounds);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("25 Oct, 01:00 BST");
    expect(labels).toContain("25 Oct, 01:00 GMT");
  });

  test("clocks going forward stay on the plain form", () => {
    /*
     * A spring-forward skips an hour rather than replaying one, so it
     * cannot produce a duplicate and must not cost the axis any width.
     */
    OneUptimeDate.setUserTimezone("Europe/London" as Timezone);

    const bounds: ReturnType<typeof windowOf> = windowOf(
      4,
      new Date("2026-03-29T00:00:00.000Z"),
    );
    const labels: Array<string> = labelsFor(bounds);

    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  test("an ordinary window in the same zone is untouched", () => {
    OneUptimeDate.setUserTimezone("Europe/London" as Timezone);

    const labels: Array<string> = labelsFor(
      windowOf(6, new Date("2026-06-01T00:00:00.000Z")),
    );

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe("01:00");
  });
});

describe("XAxisUtil formats in the configured timezone", () => {
  test("past-day labels read in local BST time instead of UTC", () => {
    OneUptimeDate.setUserTimezone("Europe/London" as Timezone);

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-04-06T14:00:00.000Z"),
      xAxisMax: new Date("2026-04-07T14:00:00.000Z"),
    });

    /*
     * A 24h window uses the fifteen-minute tier, and is exactly long
     * enough to wrap the clock — so the label carries its day. 07:30 UTC
     * is 08:30 BST on the 7th.
     */
    expect(formatter(new Date("2026-04-07T07:30:00.000Z"))).toBe(
      "07 Apr, 08:30",
    );
  });

  test("a window too short to wrap still reads in local BST time", () => {
    OneUptimeDate.setUserTimezone("Europe/London" as Timezone);

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-04-07T02:00:00.000Z"),
      xAxisMax: new Date("2026-04-07T14:00:00.000Z"),
    });

    expect(formatter(new Date("2026-04-07T07:30:00.000Z"))).toBe("08:30");
  });

  test("does not mutate the original date while rounding local labels", () => {
    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-04-06T14:00:00.000Z"),
      xAxisMax: new Date("2026-04-07T14:00:00.000Z"),
    });

    const originalDate: Date = new Date("2026-04-07T07:30:45.000Z");

    formatter(originalDate);

    expect(originalDate.toISOString()).toBe("2026-04-07T07:30:45.000Z");
  });

  test("the weekly tier reads its day and its month in the same zone", () => {
    /*
     * These used to be mixed inside one label — the day came from the
     * browser's clock and the month from the configured one — so a tick
     * near midnight could report a day from one date and a month from
     * another.
     */
    OneUptimeDate.setUserTimezone("Pacific/Auckland" as Timezone);

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMin: new Date("2026-01-01T00:00:00.000Z"),
      xAxisMax: new Date("2026-03-01T00:00:00.000Z"),
    });

    /*
     * 31 Jan 23:00 UTC is already 1 Feb in Auckland (UTC+13). Both halves
     * of the label have to agree on that.
     */
    expect(formatter(new Date("2026-01-31T23:00:00.000Z"))).toBe("01 Feb");
  });
});
