import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  describeZoneStripAcrossDst,
  expectSameDays,
  expectUtcStripToPairWithServerBuckets,
  getDaysTheOldWay,
  getPinnedWindows,
  PinnedWindow,
} from "./DayUptimeGraphUtilTimezoneCases";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the day-by-day uptime strip has to be operable
 * without a mouse and describable to a screen reader.
 *
 * The strip is ninety bars per resource. Two consequences drive everything
 * here: it can only be one tab stop (so movement inside it is arrow keys over
 * a roving tabindex, which is the maths below), and every bar needs a name a
 * screen reader can read out (which is the wording below). Both are pure so
 * they can be pinned down exactly rather than inferred from a rendered DOM.
 */

const SPANISH_LABELS: UptimeHistoryLabels = {
  ...DefaultUptimeHistoryLabels,
  graphLabel: "Historial de {{total}} dias",
  dayLabel: "{{date}}: {{uptime}} por ciento",
  dayLabelWithIncidents: "{{date}}: {{uptime}} por ciento, {{total}} sucesos",
  dayLabelNoData: "{{date}}: sin datos",
  dayLabelNoDataWithIncidents: "{{date}}: sin datos, {{total}} sucesos",
};

describe("DayUptimeGraphUtil.getNextFocusIndex", () => {
  test("ArrowRight and ArrowDown both move forward one day", () => {
    for (const key of ["ArrowRight", "ArrowDown"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBe(11);
    }
  });

  test("ArrowLeft and ArrowUp both move back one day", () => {
    for (const key of ["ArrowLeft", "ArrowUp"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBe(9);
    }
  });

  test("Home goes to the oldest day and End to today", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "Home",
        currentIndex: 45,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "End",
        currentIndex: 45,
        barCount: 90,
      }),
    ).toBe(89);
  });

  test("PageDown and PageUp move a week at a time", () => {
    expect(DayUptimeGraphUtil.PageJumpInDays).toBe(7);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageDown",
        currentIndex: 40,
        barCount: 90,
      }),
    ).toBe(47);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageUp",
        currentIndex: 40,
        barCount: 90,
      }),
    ).toBe(33);
  });

  /*
   * Wrapping a ninety day history would jump from today to three months ago
   * on one key press, which reads as a glitch rather than as navigation.
   */
  test("movement clamps at both ends rather than wrapping", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: 0,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 89,
        barCount: 90,
      }),
    ).toBe(89);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageUp",
        currentIndex: 3,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageDown",
        currentIndex: 87,
        barCount: 90,
      }),
    ).toBe(89);
  });

  /*
   * The widget must not swallow the keys the browser owns. Returning null is
   * what tells the component to leave the event alone, so Tab still leaves
   * the strip and Enter and Space still activate the focused bar.
   */
  test("keys the strip does not own are handed back", () => {
    for (const key of [
      "Tab",
      "Enter",
      " ",
      "Escape",
      "a",
      "ArrowRightArrow",
      "",
    ]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBeNull();
    }
  });

  test("an empty strip has nowhere to move", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 0,
        barCount: 0,
      }),
    ).toBeNull();

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "Home",
        currentIndex: 0,
        barCount: -3,
      }),
    ).toBeNull();
  });

  /*
   * The window can shrink under a stored index - a status page whose owner
   * lowers showUptimeHistoryInDays from 90 to 30 between renders. Movement
   * must still land somewhere real.
   */
  test("an index left over from a longer window still moves sanely", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 500,
        barCount: 30,
      }),
    ).toBe(29);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: 500,
        barCount: 30,
      }),
    ).toBe(28);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: -8,
        barCount: 30,
      }),
    ).toBe(0);
  });

  test("a one day strip cannot move off itself", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 0,
          barCount: 1,
        }),
      ).toBe(0);
    }
  });
});

describe("DayUptimeGraphUtil.getActiveBarIndex", () => {
  /*
   * Today, not three months ago: the bar a visitor wants first is the one on
   * the right hand end.
   */
  test("focus lands on today before anything has been focused", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({
        storedIndex: null,
        barCount: 90,
      }),
    ).toBe(89);
  });

  test("a stored index is used as it stands", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: 12, barCount: 90 }),
    ).toBe(12);
  });

  test("a stored index outside the window is pulled back into it", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: 400, barCount: 30 }),
    ).toBe(29);

    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: -5, barCount: 30 }),
    ).toBe(0);
  });

  test("an empty strip reports index zero rather than minus one", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: null, barCount: 0 }),
    ).toBe(0);
  });
});

describe("DayUptimeGraphUtil.getBarTabIndex", () => {
  /*
   * The whole point of the roving tabindex: exactly one bar per strip is
   * reachable with Tab, so twenty resources cost twenty tab stops rather than
   * eighteen hundred.
   */
  test("exactly one bar in a strip is tabbable", () => {
    const barCount: number = 90;
    const activeIndex: number = 42;

    let tabbable: number = 0;

    for (let index: number = 0; index < barCount; index++) {
      const tabIndex: number = DayUptimeGraphUtil.getBarTabIndex({
        index: index,
        activeIndex: activeIndex,
      });

      expect(tabIndex === 0 || tabIndex === -1).toBe(true);

      if (tabIndex === 0) {
        tabbable++;
      }
    }

    expect(tabbable).toBe(1);
    expect(
      DayUptimeGraphUtil.getBarTabIndex({ index: 42, activeIndex: 42 }),
    ).toBe(0);
  });
});

describe("DayUptimeGraphUtil.formatUptimePercentForLabel", () => {
  test("a whole number reads as a whole number", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(100)).toBe("100");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99)).toBe("99");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(0)).toBe("0");
  });

  test("trailing zeroes are dropped", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.5)).toBe("99.5");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.5)).not.toBe(
      "99.50",
    );
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.123)).toBe(
      "99.12",
    );
  });

  /*
   * A day that had an outage must never be read out as "100% uptime". Saying
   * so on a status page is a wrong statement, not a rounding.
   */
  test("a hair under a hundred never rounds up to a hundred", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.999)).toBe(
      "99.99",
    );
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.99999)).toBe(
      "99.99",
    );
  });

  test("impossible readings are clamped rather than repeated", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(140)).toBe("100");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(-20)).toBe("0");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(NaN)).toBe("0");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(Infinity)).toBe("0");
  });
});

describe("DayUptimeGraphUtil.getDayAriaLabel", () => {
  test("a clean day names the date and the reading", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 100,
        incidentCount: 0,
      }),
    ).toBe("Mar 03 2026: 100% uptime");
  });

  test("a day with incidents says how many", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 98.25,
        incidentCount: 2,
      }),
    ).toBe("Mar 03 2026: 98.25% uptime, 2 incidents");
  });

  /*
   * A day before the monitor existed is not a day of downtime, and the label
   * must not imply it was.
   */
  test("a day with no timeline rows says no data, not zero percent", () => {
    const label: string = DayUptimeGraphUtil.getDayAriaLabel({
      dateLabel: "Jan 01 2026",
      hasEvents: false,
      uptimePercent: 100,
      incidentCount: 0,
    });

    expect(label).toBe("Jan 01 2026: no data");
    expect(label).not.toContain("%");
  });

  test("a day with no data but with incidents still reports them", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Jan 01 2026",
        hasEvents: false,
        uptimePercent: 0,
        incidentCount: 3,
      }),
    ).toBe("Jan 01 2026: no data, 3 incidents");
  });

  test("a negative incident count is treated as none", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 100,
        incidentCount: -4,
      }),
    ).toBe("Mar 03 2026: 100% uptime");
  });

  test("the caller's own wording is used when it passes some", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "3 mar 2026",
        hasEvents: true,
        uptimePercent: 99.9,
        incidentCount: 1,
        labels: SPANISH_LABELS,
      }),
    ).toBe("3 mar 2026: 99.9 por ciento, 1 sucesos");

    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "3 mar 2026",
        hasEvents: false,
        uptimePercent: 0,
        incidentCount: 0,
        labels: SPANISH_LABELS,
      }),
    ).toBe("3 mar 2026: sin datos");
  });

  /*
   * A half translated locale must degrade to an odd label, never to a page
   * that fails to render.
   */
  test("a translation missing its placeholders still produces a label", () => {
    const label: string = DayUptimeGraphUtil.getDayAriaLabel({
      dateLabel: "Mar 03 2026",
      hasEvents: true,
      uptimePercent: 100,
      incidentCount: 0,
      labels: {
        ...DefaultUptimeHistoryLabels,
        dayLabel: "Disponibilidad del dia",
      },
    });

    expect(label).toBe("Disponibilidad del dia");
  });

  test("a placeholder used twice is filled in both places", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 50,
        incidentCount: 0,
        labels: {
          ...DefaultUptimeHistoryLabels,
          dayLabel: "{{date}} - {{date}}",
        },
      }),
    ).toBe("Mar 03 2026 - Mar 03 2026");
  });
});

describe("DayUptimeGraphUtil.getGraphAriaLabel", () => {
  test("the strip names the window it covers", () => {
    expect(DayUptimeGraphUtil.getGraphAriaLabel({ dayCount: 90 })).toBe(
      "Uptime history for the last 90 days",
    );
  });

  test("the caller's own wording is used when it passes some", () => {
    expect(
      DayUptimeGraphUtil.getGraphAriaLabel({
        dayCount: 30,
        labels: SPANISH_LABELS,
      }),
    ).toBe("Historial de 30 dias");
  });

  test("a strip with nothing in it does not claim a negative window", () => {
    expect(DayUptimeGraphUtil.getGraphAriaLabel({ dayCount: -5 })).toBe(
      "Uptime history for the last 0 days",
    );
  });
});

/*
 * The strip's day maths (root cause 3 of the status.chainflip.io grey bars).
 *
 * The status page's per-day readings are UTC days - one cached payload
 * serves every visitor - but the strip drew each visitor's LOCAL days and
 * paired a bar with whichever reading started inside it. Off UTC, bars were
 * painted from the wrong day's reading and today's bar often had none at
 * all, so it fell back to the capped rows and came out grey. getDays now
 * draws the zone the readings were cut in; formatDayLabel says which zone
 * that is when it is not the viewer's.
 *
 * These cases hold in any process zone: this file runs in the machine's own
 * zone, and DayUptimeGraphUtilTimezone.<Zone>.test.ts pin five others. The
 * helpers and the independent oracles live in
 * DayUptimeGraphUtilTimezoneCases.ts.
 */

describe("DayUptimeGraphUtil.isValidTimezone", () => {
  test("IANA zones moment knows are valid", () => {
    expect(DayUptimeGraphUtil.isValidTimezone("UTC")).toBe(true);
    expect(DayUptimeGraphUtil.isValidTimezone("America/New_York")).toBe(true);
    expect(DayUptimeGraphUtil.isValidTimezone("Asia/Kolkata")).toBe(true);
    // The legacy alias some ICU builds report for the same zone.
    expect(DayUptimeGraphUtil.isValidTimezone("Asia/Calcutta")).toBe(true);
  });

  /*
   * The timezone arrives on the wire. Anything that is not a zone must send
   * the strip down its old path, never into moment with a bad name.
   */
  test("anything else is not", () => {
    for (const value of [
      "",
      "   ",
      "Not/AZone",
      " UTC",
      undefined,
      null,
      0,
      330,
      Number.NaN,
      true,
      {},
      ["UTC"],
    ]) {
      expect(DayUptimeGraphUtil.isValidTimezone(value)).toBe(false);
    }
  });
});

describe("DayUptimeGraphUtil.getDays without a timezone", () => {
  /*
   * The dashboard's monitor page passes no timezone and must draw exactly
   * what it drew before the fix, whatever zone the browser is in.
   */
  test("is the old local-day strip, bar for bar, for every pinned window", () => {
    for (const window of getPinnedWindows()) {
      expectSameDays(
        DayUptimeGraphUtil.getDays({
          startDate: window.startDate,
          endDate: window.endDate,
        }),
        getDaysTheOldWay(window.startDate, window.endDate),
      );
    }
  });

  test("is the old strip for windows that are not a whole number of days", () => {
    const windows: Array<[string, string]> = [
      ["2026-09-01T23:00:00.000Z", "2026-09-22T01:00:00.000Z"],
      ["2026-09-01T01:00:00.000Z", "2026-09-22T23:00:00.000Z"],
      ["2026-02-10T08:15:00.000Z", "2026-05-11T19:45:00.000Z"],
      ["2026-09-22T12:00:00.000Z", "2026-09-22T12:00:00.000Z"],
    ];

    for (const [start, end] of windows) {
      const startDate: Date = new Date(start);
      const endDate: Date = new Date(end);

      expectSameDays(
        DayUptimeGraphUtil.getDays({ startDate: startDate, endDate: endDate }),
        getDaysTheOldWay(startDate, endDate),
      );
    }
  });

  test("an unusable timezone is the no-timezone path, not UTC", () => {
    const window: PinnedWindow = getPinnedWindows()[0]!;

    const expected: Array<UptimeGraphDay> = getDaysTheOldWay(
      window.startDate,
      window.endDate,
    );

    for (const timezone of [undefined, "", "   ", "Not/AZone", " UTC"]) {
      expectSameDays(
        DayUptimeGraphUtil.getDays({
          startDate: window.startDate,
          endDate: window.endDate,
          timezone: timezone,
        }),
        expected,
      );
    }
  });
});

describe("DayUptimeGraphUtil.getDays with timezone UTC", () => {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  /*
   * The pairing the status page depends on: every bar a UTC day, today's
   * bar holding the window end, and every server bucket - the first one
   * clipped to the window start, the rest UTC midnights - in exactly one
   * bar. The local-day strip the page drew before the fix breaks this in
   * any zone off UTC (see the per-zone files for the exact failure).
   */
  for (const window of getPinnedWindows()) {
    test(`pairs every bar with its own server bucket: ${window.name}`, () => {
      expectUtcStripToPairWithServerBuckets(window);
    });
  }

  test("does not depend on the zone the viewer picked in their settings", () => {
    const window: PinnedWindow = getPinnedWindows()[4]!;

    const asProcess: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: window.startDate,
      endDate: window.endDate,
      timezone: "UTC",
    });

    for (const viewer of [
      Timezone.AmericaNew_York,
      Timezone.AsiaTokyo,
      Timezone.AsiaKolkata,
      Timezone.PacificAuckland,
    ]) {
      OneUptimeDate.setUserTimezone(viewer);

      expectSameDays(
        DayUptimeGraphUtil.getDays({
          startDate: window.startDate,
          endDate: window.endDate,
          timezone: "UTC",
        }),
        asProcess,
      );
    }
  });

  /*
   * Calendar days, not 24-hour periods: two instants a millisecond apart on
   * either side of a UTC midnight are on two dates, so two bars. (The
   * no-zone path counts whole 24-hour spans between the two instants, so it
   * can draw one bar for two dates; the zone path must not.)
   */
  test("counts calendar days rather than 24 hour spans", () => {
    const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: new Date("2026-09-21T23:59:59.999Z"),
      endDate: new Date("2026-09-22T00:00:00.000Z"),
      timezone: "UTC",
    });

    expect(
      days.map((day: UptimeGraphDay) => {
        return day.startOfDay.toISOString();
      }),
    ).toEqual(["2026-09-21T00:00:00.000Z", "2026-09-22T00:00:00.000Z"]);

    const wholeDay: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: new Date("2026-09-22T00:00:00.000Z"),
      endDate: new Date("2026-09-22T23:59:59.999Z"),
      timezone: "UTC",
    });

    expect(wholeDay).toHaveLength(1);
    expect(wholeDay[0]!.startOfDay.toISOString()).toBe(
      "2026-09-22T00:00:00.000Z",
    );
    expect(wholeDay[0]!.endOfDay.toISOString()).toBe(
      "2026-09-22T23:59:59.999Z",
    );
  });

  test("a window of one instant is one bar", () => {
    const instant: Date = new Date("2026-09-22T15:42:07.123Z");

    const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: instant,
      endDate: instant,
      timezone: "UTC",
    });

    expect(days).toHaveLength(1);
    expect(days[0]!.date.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  /*
   * Should never happen - the page computes start from end - but a window
   * that ends before it starts must draw nothing rather than throw or draw
   * a negative count. The no-zone path behaves the same way.
   */
  test("a window that ends before it starts draws no bars on either path", () => {
    const startDate: Date = new Date("2026-09-22T12:00:00.000Z");

    for (const endDate of [
      new Date("2026-09-21T12:00:00.000Z"),
      new Date("2026-09-20T12:00:00.000Z"),
      new Date("2026-06-01T12:00:00.000Z"),
    ]) {
      expect(
        DayUptimeGraphUtil.getDays({
          startDate: startDate,
          endDate: endDate,
          timezone: "UTC",
        }),
      ).toEqual([]);

      expect(
        DayUptimeGraphUtil.getDays({ startDate: startDate, endDate: endDate }),
      ).toEqual([]);
    }
  });
});

describeZoneStripAcrossDst("the machine's own zone");

describe("DayUptimeGraphUtil.formatDayLabel", () => {
  /*
   * The viewer's zone is pinned with setUserTimezone in each case, so these
   * hold whatever zone this process runs in.
   */
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  const UTC_MIDNIGHT: Date = new Date("2026-09-23T00:00:00.000Z");

  test("a UTC bar read by a UTC viewer is the bare UTC date", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: UTC_MIDNIGHT,
        timezone: "UTC",
      }),
    ).toBe("Sep 23, 2026");
  });

  /*
   * At 22:00 on Sep 22 in New York, today's bar is the UTC day Sep 23. It
   * says so, rather than reading like a date from the future.
   */
  test("a UTC bar read from New York is the UTC date, marked as UTC", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const tenPmOnTheTwentySecond: Date = new Date("2026-09-23T02:00:00.000Z");

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: tenPmOnTheTwentySecond,
        timezone: "UTC",
      }),
    ).toBe("Sep 23, 2026 (UTC)");

    expect(
      DayUptimeGraphUtil.formatDayLabel({ date: tenPmOnTheTwentySecond }),
    ).toBe("Sep 22, 2026");
  });

  test("the marker appears for every viewer whose offset differs at that date", () => {
    for (const viewer of [
      Timezone.AmericaNew_York,
      Timezone.AsiaTokyo,
      Timezone.AsiaKolkata,
      Timezone.PacificAuckland,
    ]) {
      OneUptimeDate.setUserTimezone(viewer);

      expect(
        DayUptimeGraphUtil.formatDayLabel({
          date: UTC_MIDNIGHT,
          timezone: "UTC",
        }),
      ).toBe("Sep 23, 2026 (UTC)");

      expect(
        DayUptimeGraphUtil.formatDayLabel({
          date: new Date("2026-01-15T00:00:00.000Z"),
          timezone: "UTC",
        }),
      ).toBe("Jan 15, 2026 (UTC)");
    }
  });

  /*
   * London is on UTC in winter and an hour off it in summer, and the marker
   * follows the offset AT THE BAR'S DATE rather than today's.
   */
  test("a London viewer sees the marker in summer only", () => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-01-15T00:00:00.000Z"),
        timezone: "UTC",
      }),
    ).toBe("Jan 15, 2026");

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: UTC_MIDNIGHT,
        timezone: "UTC",
      }),
    ).toBe("Sep 23, 2026 (UTC)");
  });

  test("the marker is about the offset, not the zone's name", () => {
    // Abidjan is a different zone that is always on UTC.
    OneUptimeDate.setUserTimezone(Timezone.AfricaAbidjan);

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: UTC_MIDNIGHT,
        timezone: "UTC",
      }),
    ).toBe("Sep 23, 2026");

    // Toronto keeps New York's offsets all year.
    OneUptimeDate.setUserTimezone(Timezone.AmericaToronto);

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-01-15T05:00:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("Jan 15, 2026");
  });

  test("a bar drawn in another zone is dated in that zone and named with its abbreviation at that date", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);

    // New York midnights: EST in winter, EDT in summer.
    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-01-15T05:00:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("Jan 15, 2026 (EST)");

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-07-15T04:00:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("Jul 15, 2026 (EDT)");

    OneUptimeDate.setUserTimezone(Timezone.UTC);

    // Kolkata's Sep 23 starts at 18:30Z on Sep 22.
    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-09-22T18:30:00.000Z"),
        timezone: "Asia/Kolkata",
      }),
    ).toBe("Sep 23, 2026 (IST)");
  });

  test("without a usable timezone the label is the long-standing local one", () => {
    for (const viewer of [null, Timezone.AsiaTokyo, Timezone.AmericaNew_York]) {
      OneUptimeDate.setUserTimezone(viewer);

      for (const window of getPinnedWindows()) {
        const expected: string =
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            window.endDate,
            true,
          );

        for (const timezone of [undefined, "", "Not/AZone"]) {
          expect(
            DayUptimeGraphUtil.formatDayLabel({
              date: window.endDate,
              timezone: timezone,
            }),
          ).toBe(expected);
        }
      }
    }

    // And that local label follows the viewer's chosen zone.
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);

    expect(
      DayUptimeGraphUtil.formatDayLabel({
        date: new Date("2026-09-22T20:00:00.000Z"),
      }),
    ).toBe("Sep 23, 2026");
  });
});
