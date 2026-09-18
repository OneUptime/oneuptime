import { describe, expect, test } from "@jest/globals";
import ScheduleTimelineLayout, {
  PositionedInterval,
  TimeInterval,
  TimelineDay,
  TimelineRange,
  TimelineViewMode,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import { at, tzInstant } from "./CalendarFeedTestFixtures";

/*
 * The schedule timeline's geometry. Every range here is built in an explicit
 * IANA zone so the results do not depend on the zone the test runs in, and
 * the DST cases pin the property the whole layout exists for: a bar that
 * ends at local midnight ends exactly on a gridline, even on a 23- or 25-hour
 * day.
 */

const NEW_YORK: string = "America/New_York";
const TOKYO: string = "Asia/Tokyo";
const LONDON: string = "Europe/London";
const UTC: string = "UTC";

function week(anchor: Date, timezone: string): TimelineRange {
  return ScheduleTimelineLayout.getRange({
    mode: TimelineViewMode.Week,
    anchor,
    timezone,
  });
}

function month(anchor: Date, timezone: string): TimelineRange {
  return ScheduleTimelineLayout.getRange({
    mode: TimelineViewMode.Month,
    anchor,
    timezone,
  });
}

function keys(range: TimelineRange): Array<string> {
  return range.days.map((day: TimelineDay) => {
    return day.key;
  });
}

function interval(start: string, end: string): TimeInterval {
  return { start: at(start), end: at(end) };
}

describe("getRange: week", () => {
  test("is the ISO week (Monday first) containing the anchor", () => {
    const range: TimelineRange = week(at("2026-09-17T12:00:00Z"), UTC);

    expect(keys(range)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(range.start.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(range.mode).toBe(TimelineViewMode.Week);
    expect(range.timezone).toBe(UTC);
  });

  test("a Sunday anchor belongs to the week that started the Monday before", () => {
    const range: TimelineRange = week(at("2026-09-20T23:59:00Z"), UTC);

    expect(range.days[0]?.key).toBe("2026-09-14");
  });

  test("a Monday 00:00 anchor starts its own week", () => {
    const range: TimelineRange = week(at("2026-09-21T00:00:00Z"), UTC);

    expect(range.days[0]?.key).toBe("2026-09-21");
  });

  test("the same instant is a different week in a different zone", () => {
    // Monday 08:00 in Tokyo is still Sunday 19:00 in New York.
    const instant: Date = tzInstant("2026-09-21 08:00", TOKYO);

    expect(week(instant, TOKYO).days[0]?.key).toBe("2026-09-21");
    expect(week(instant, NEW_YORK).days[0]?.key).toBe("2026-09-14");
  });

  test("day edges are local midnights in the view zone", () => {
    const range: TimelineRange = week(at("2026-09-17T12:00:00Z"), NEW_YORK);

    // EDT is UTC-4 in September.
    expect(range.start.toISOString()).toBe("2026-09-14T04:00:00.000Z");
    expect(range.days[1]?.start.toISOString()).toBe("2026-09-15T04:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-21T04:00:00.000Z");
  });

  test("each day's end is the next day's start, across a DST change", () => {
    const range: TimelineRange = week(at("2026-03-05T12:00:00Z"), NEW_YORK);

    for (let index: number = 0; index < range.days.length - 1; index++) {
      expect(range.days[index]?.end.getTime()).toBe(
        range.days[index + 1]?.start.getTime(),
      );
    }

    expect(range.days[range.days.length - 1]?.end.getTime()).toBe(
      range.end.getTime(),
    );
  });

  test("weekend, labels and first-of-month flags", () => {
    const range: TimelineRange = week(at("2026-09-30T12:00:00Z"), UTC);

    expect(
      range.days.map((day: TimelineDay) => {
        return [day.weekdayShort, day.weekdayNarrow, day.isWeekend];
      }),
    ).toEqual([
      ["Mon", "M", false],
      ["Tue", "T", false],
      ["Wed", "W", false],
      ["Thu", "T", false],
      ["Fri", "F", false],
      ["Sat", "S", true],
      ["Sun", "S", true],
    ]);

    const october: TimelineDay | undefined = range.days.find(
      (day: TimelineDay) => {
        return day.isFirstOfMonth;
      },
    );

    expect(october?.key).toBe("2026-10-01");
    expect(october?.monthShort).toBe("Oct");
    expect(october?.dayOfMonth).toBe(1);
  });

  test("a week across a year boundary", () => {
    const range: TimelineRange = week(at("2026-12-31T12:00:00Z"), UTC);

    expect(keys(range)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("getRange: month", () => {
  test("is the calendar month containing the anchor", () => {
    const range: TimelineRange = month(at("2026-09-17T12:00:00Z"), UTC);

    expect(range.days).toHaveLength(30);
    expect(range.days[0]?.key).toBe("2026-09-01");
    expect(range.days[29]?.key).toBe("2026-09-30");
    expect(range.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test.each([
    ["2026-01-15T12:00:00Z", 31],
    ["2026-02-15T12:00:00Z", 28],
    ["2028-02-15T12:00:00Z", 29],
    ["2026-04-15T12:00:00Z", 30],
    ["2026-12-15T12:00:00Z", 31],
  ])("%s has %i days", (anchor: string, count: number) => {
    expect(month(at(anchor), UTC).days).toHaveLength(count);
  });

  test("the month is the view zone's month", () => {
    // 1 Oct 02:00 in Tokyo is still 30 Sep in UTC.
    const instant: Date = tzInstant("2026-10-01 02:00", TOKYO);

    expect(month(instant, TOKYO).days[0]?.key).toBe("2026-10-01");
    expect(month(instant, UTC).days[0]?.key).toBe("2026-09-01");
  });
});

describe("DST", () => {
  // US DST starts Sunday 8 March 2026 (02:00 -> 03:00): a 23-hour day.
  const springWeek: TimelineRange = week(at("2026-03-05T12:00:00Z"), NEW_YORK);

  test("the spring-forward day is 23 hours, the rest 24", () => {
    const hours: Array<number> = springWeek.days.map((day: TimelineDay) => {
      return (day.end.getTime() - day.start.getTime()) / 3600000;
    });

    expect(springWeek.days[6]?.key).toBe("2026-03-08");
    expect(hours).toEqual([24, 24, 24, 24, 24, 24, 23]);
  });

  test("every local midnight lands exactly on a gridline", () => {
    springWeek.days.forEach((day: TimelineDay, index: number) => {
      expect(ScheduleTimelineLayout.getFraction(day.start, springWeek)).toBe(
        index / 7,
      );
    });
  });

  test("local noon on the short day is still the middle of its column", () => {
    const noon: Date = tzInstant("2026-03-08 12:00", NEW_YORK);
    const fraction: number = ScheduleTimelineLayout.getFraction(
      noon,
      springWeek,
    );

    // 11 of the day's 23 hours have elapsed at local noon.
    expect(fraction).toBeCloseTo((6 + 11 / 23) / 7, 10);
  });

  test("the fall-back day is 25 hours", () => {
    // US DST ends Sunday 1 November 2026.
    const fallWeek: TimelineRange = week(at("2026-10-28T12:00:00Z"), NEW_YORK);
    const sunday: TimelineDay | undefined = fallWeek.days[6];

    expect(sunday?.key).toBe("2026-11-01");
    expect(
      ((sunday?.end.getTime() || 0) - (sunday?.start.getTime() || 0)) / 3600000,
    ).toBe(25);
  });

  test("a London week across the October change keeps seven columns", () => {
    const range: TimelineRange = week(at("2026-10-22T12:00:00Z"), LONDON);

    expect(range.days).toHaveLength(7);
    expect(range.days[6]?.key).toBe("2026-10-25");
  });
});

describe("shiftAnchor", () => {
  test("weeks move by seven days", () => {
    const anchor: Date = at("2026-09-17T12:00:00Z");

    const next: Date = ScheduleTimelineLayout.shiftAnchor({
      mode: TimelineViewMode.Week,
      anchor,
      timezone: UTC,
      direction: 1,
    });
    const previous: Date = ScheduleTimelineLayout.shiftAnchor({
      mode: TimelineViewMode.Week,
      anchor,
      timezone: UTC,
      direction: -1,
    });

    expect(week(next, UTC).days[0]?.key).toBe("2026-09-21");
    expect(week(previous, UTC).days[0]?.key).toBe("2026-09-07");
  });

  test("a week step across DST keeps local midnight", () => {
    const next: Date = ScheduleTimelineLayout.shiftAnchor({
      mode: TimelineViewMode.Week,
      anchor: tzInstant("2026-03-04 12:00", NEW_YORK),
      timezone: NEW_YORK,
      direction: 1,
    });

    expect(next.toISOString()).toBe(
      tzInstant("2026-03-09 00:00", NEW_YORK).toISOString(),
    );
  });

  test("months move by calendar month, even from the 31st", () => {
    const next: Date = ScheduleTimelineLayout.shiftAnchor({
      mode: TimelineViewMode.Month,
      anchor: at("2026-01-31T12:00:00Z"),
      timezone: UTC,
      direction: 1,
    });

    expect(month(next, UTC).days[0]?.key).toBe("2026-02-01");

    const back: Date = ScheduleTimelineLayout.shiftAnchor({
      mode: TimelineViewMode.Month,
      anchor: at("2026-03-31T12:00:00Z"),
      timezone: UTC,
      direction: -1,
    });

    expect(month(back, UTC).days[0]?.key).toBe("2026-02-01");
  });

  test("twelve steps forward is the same month next year", () => {
    let anchor: Date = at("2026-09-17T12:00:00Z");

    for (let step: number = 0; step < 12; step++) {
      anchor = ScheduleTimelineLayout.shiftAnchor({
        mode: TimelineViewMode.Month,
        anchor,
        timezone: NEW_YORK,
        direction: 1,
      });
    }

    expect(month(anchor, NEW_YORK).days[0]?.key).toBe("2027-09-01");
  });
});

describe("getRangeLabel", () => {
  test("a week inside one month", () => {
    expect(
      ScheduleTimelineLayout.getRangeLabel(
        week(at("2026-09-17T12:00:00Z"), UTC),
      ),
    ).toBe("September 14 – 20, 2026");
  });

  test("a week across two months", () => {
    expect(
      ScheduleTimelineLayout.getRangeLabel(
        week(at("2026-09-30T12:00:00Z"), UTC),
      ),
    ).toBe("Sep 28 – Oct 4, 2026");
  });

  test("a week across two years", () => {
    expect(
      ScheduleTimelineLayout.getRangeLabel(
        week(at("2026-12-31T12:00:00Z"), UTC),
      ),
    ).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  test("a month", () => {
    expect(
      ScheduleTimelineLayout.getRangeLabel(
        month(at("2026-09-17T12:00:00Z"), UTC),
      ),
    ).toBe("September 2026");
  });
});

describe("getFraction", () => {
  const range: TimelineRange = week(at("2026-09-17T12:00:00Z"), UTC);

  test("clamps before and after the range", () => {
    expect(
      ScheduleTimelineLayout.getFraction(at("2026-09-01T00:00:00Z"), range),
    ).toBe(0);
    expect(
      ScheduleTimelineLayout.getFraction(at("2026-10-01T00:00:00Z"), range),
    ).toBe(1);
    expect(ScheduleTimelineLayout.getFraction(range.end, range)).toBe(1);
    expect(ScheduleTimelineLayout.getFraction(range.start, range)).toBe(0);
  });

  test("an instant is placed within its own day's column", () => {
    // Thursday 12:00 = 3.5 days into the week.
    expect(
      ScheduleTimelineLayout.getFraction(at("2026-09-17T12:00:00Z"), range),
    ).toBeCloseTo(3.5 / 7, 12);

    // Saturday 06:00 = 5.25 days.
    expect(
      ScheduleTimelineLayout.getFraction(at("2026-09-19T06:00:00Z"), range),
    ).toBeCloseTo(5.25 / 7, 12);
  });

  test("is monotonic across a month", () => {
    const monthRange: TimelineRange = month(
      at("2026-03-15T12:00:00Z"),
      NEW_YORK,
    );

    let previous: number = -1;

    for (
      let time: number = monthRange.start.getTime();
      time <= monthRange.end.getTime();
      time += 3600 * 1000
    ) {
      const fraction: number = ScheduleTimelineLayout.getFraction(
        new Date(time),
        monthRange,
      );

      expect(fraction).toBeGreaterThanOrEqual(previous);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
      previous = fraction;
    }
  });

  test("an empty range places everything at 0", () => {
    expect(
      ScheduleTimelineLayout.getFraction(at("2026-09-17T12:00:00Z"), {
        ...range,
        days: [],
      }),
    ).toBe(0);
  });
});

describe("positionIntervals", () => {
  const range: TimelineRange = week(at("2026-09-17T12:00:00Z"), UTC);

  test("drops intervals that do not overlap the range", () => {
    const placed: Array<PositionedInterval<TimeInterval>> =
      ScheduleTimelineLayout.positionIntervals(
        [
          interval("2026-09-01T00:00:00Z", "2026-09-14T00:00:00Z"),
          interval("2026-09-21T00:00:00Z", "2026-09-22T00:00:00Z"),
        ],
        range,
      );

    expect(placed).toEqual([]);
  });

  test("a whole-day interval is exactly one column wide", () => {
    const placed: Array<PositionedInterval<TimeInterval>> =
      ScheduleTimelineLayout.positionIntervals(
        [interval("2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z")],
        range,
      );

    expect(placed[0]?.left).toBeCloseTo(100 / 7, 10);
    expect(placed[0]?.width).toBeCloseTo(100 / 7, 10);
    expect(placed[0]?.continuesBefore).toBe(false);
    expect(placed[0]?.continuesAfter).toBe(false);
  });

  test("intervals running past an edge are cut there and say so", () => {
    const placed: Array<PositionedInterval<TimeInterval>> =
      ScheduleTimelineLayout.positionIntervals(
        [
          interval("2026-09-10T09:00:00Z", "2026-09-15T00:00:00Z"),
          interval("2026-09-20T00:00:00Z", "2026-09-25T00:00:00Z"),
          interval("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
        ],
        range,
      );

    expect(placed[0]).toMatchObject({
      left: 0,
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(placed[0]?.width).toBeCloseTo(100 / 7, 10);

    expect(placed[1]?.left).toBeCloseTo((6 * 100) / 7, 10);
    expect((placed[1]?.left || 0) + (placed[1]?.width || 0)).toBeCloseTo(
      100,
      10,
    );
    expect(placed[1]?.continuesAfter).toBe(true);

    expect(placed[2]).toMatchObject({
      left: 0,
      width: 100,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  test("the original item is carried through", () => {
    const item: TimeInterval & { name: string } = {
      ...interval("2026-09-15T09:00:00Z", "2026-09-15T17:00:00Z"),
      name: "Alice",
    };

    const placed: Array<PositionedInterval<TimeInterval & { name: string }>> =
      ScheduleTimelineLayout.positionIntervals([item], range);

    expect(placed[0]?.item).toBe(item);
  });

  test("back-to-back intervals tile without overlap", () => {
    const placed: Array<PositionedInterval<TimeInterval>> =
      ScheduleTimelineLayout.positionIntervals(
        [
          interval("2026-09-14T00:00:00Z", "2026-09-16T09:00:00Z"),
          interval("2026-09-16T09:00:00Z", "2026-09-21T00:00:00Z"),
        ],
        range,
      );

    expect(placed[0]!.left + placed[0]!.width).toBeCloseTo(placed[1]!.left, 10);
    expect(placed[0]!.width + placed[1]!.width).toBeCloseTo(100, 10);
  });
});

describe("computeGaps", () => {
  const start: Date = at("2026-09-14T00:00:00Z");
  const end: Date = at("2026-09-21T00:00:00Z");

  test("no intervals: the whole window is a gap", () => {
    expect(ScheduleTimelineLayout.computeGaps([], start, end)).toEqual([
      { start, end },
    ]);
  });

  test("full coverage: no gaps", () => {
    expect(
      ScheduleTimelineLayout.computeGaps(
        [interval("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")],
        start,
        end,
      ),
    ).toEqual([]);
  });

  test("holes between, before and after intervals", () => {
    const gaps: Array<TimeInterval> = ScheduleTimelineLayout.computeGaps(
      [
        interval("2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z"),
        interval("2026-09-17T00:00:00Z", "2026-09-18T00:00:00Z"),
      ],
      start,
      end,
    );

    expect(
      gaps.map((gap: TimeInterval) => {
        return [gap.start.toISOString(), gap.end.toISOString()];
      }),
    ).toEqual([
      ["2026-09-14T00:00:00.000Z", "2026-09-15T00:00:00.000Z"],
      ["2026-09-16T00:00:00.000Z", "2026-09-17T00:00:00.000Z"],
      ["2026-09-18T00:00:00.000Z", "2026-09-21T00:00:00.000Z"],
    ]);
  });

  test("unsorted and overlapping input is merged", () => {
    const gaps: Array<TimeInterval> = ScheduleTimelineLayout.computeGaps(
      [
        interval("2026-09-18T00:00:00Z", "2026-09-21T00:00:00Z"),
        interval("2026-09-14T00:00:00Z", "2026-09-16T00:00:00Z"),
        interval("2026-09-15T00:00:00Z", "2026-09-17T00:00:00Z"),
      ],
      start,
      end,
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.start.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(gaps[0]?.end.toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  test("holes shorter than the minimum are ignored", () => {
    const gaps: Array<TimeInterval> = ScheduleTimelineLayout.computeGaps(
      [
        interval("2026-09-14T00:00:00Z", "2026-09-16T09:00:00Z"),
        // The engine's one-second seam.
        interval("2026-09-16T09:00:01Z", "2026-09-21T00:00:00Z"),
      ],
      start,
      end,
    );

    expect(gaps).toEqual([]);
  });

  test("a custom minimum", () => {
    const gaps: Array<TimeInterval> = ScheduleTimelineLayout.computeGaps(
      [
        interval("2026-09-14T00:00:00Z", "2026-09-16T09:00:00Z"),
        interval("2026-09-16T09:30:00Z", "2026-09-21T00:00:00Z"),
      ],
      start,
      end,
      60 * 60 * 1000,
    );

    expect(gaps).toEqual([]);
  });

  test("empty and zero-length intervals are ignored", () => {
    const gaps: Array<TimeInterval> = ScheduleTimelineLayout.computeGaps(
      [
        interval("2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z"),
        interval("2026-09-16T00:00:00Z", "2026-09-15T00:00:00Z"),
      ],
      start,
      end,
    );

    expect(gaps).toEqual([{ start, end }]);
  });

  test("an inverted window has no gaps", () => {
    expect(ScheduleTimelineLayout.computeGaps([], end, start)).toEqual([]);
  });
});

describe("findActive", () => {
  const shifts: Array<TimeInterval & { id: string }> = [
    { id: "a", ...interval("2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z") },
    { id: "b", ...interval("2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z") },
  ];

  test("returns the interval containing now; end is exclusive", () => {
    expect(
      ScheduleTimelineLayout.findActive(shifts, at("2026-09-14T12:00:00Z"))?.id,
    ).toBe("a");
    expect(
      ScheduleTimelineLayout.findActive(shifts, at("2026-09-15T00:00:00Z"))?.id,
    ).toBe("b");
  });

  test("returns null in a hole", () => {
    expect(
      ScheduleTimelineLayout.findActive(shifts, at("2026-09-17T00:00:00Z")),
    ).toBeNull();
  });
});

describe("formatInterval", () => {
  test("same day, 24-hour clock", () => {
    expect(
      ScheduleTimelineLayout.formatInterval({
        start: at("2026-09-15T09:00:00Z"),
        end: at("2026-09-15T17:30:00Z"),
        timezone: UTC,
        use12HourFormat: false,
      }),
    ).toBe("Tue, Sep 15, 09:00 – 17:30");
  });

  test("across days", () => {
    expect(
      ScheduleTimelineLayout.formatInterval({
        start: at("2026-09-14T09:00:00Z"),
        end: at("2026-09-21T09:00:00Z"),
        timezone: UTC,
        use12HourFormat: false,
      }),
    ).toBe("Mon, Sep 14, 09:00 → Mon, Sep 21, 09:00");
  });

  test("across years names the end's year", () => {
    expect(
      ScheduleTimelineLayout.formatInterval({
        start: at("2026-12-31T20:00:00Z"),
        end: at("2027-01-01T08:00:00Z"),
        timezone: UTC,
        use12HourFormat: false,
      }),
    ).toBe("Thu, Dec 31, 20:00 → Fri, Jan 1, 2027, 08:00");
  });

  test("12-hour clock", () => {
    expect(
      ScheduleTimelineLayout.formatInterval({
        start: at("2026-09-15T09:00:00Z"),
        end: at("2026-09-15T17:00:00Z"),
        timezone: UTC,
        use12HourFormat: true,
      }),
    ).toBe("Tue, Sep 15, 9:00 AM – 5:00 PM");
  });

  test("is written in the view zone", () => {
    expect(
      ScheduleTimelineLayout.formatInterval({
        start: at("2026-09-15T09:00:00Z"),
        end: at("2026-09-15T17:00:00Z"),
        timezone: TOKYO,
        use12HourFormat: false,
      }),
    ).toBe("Tue, Sep 15, 18:00 → Wed, Sep 16, 02:00");
  });
});

describe("formatDuration", () => {
  test.each([
    [0, "<1m"],
    [59 * 1000, "<1m"],
    [Number.NaN, "<1m"],
    [45 * 60 * 1000, "45m"],
    [8 * 3600 * 1000, "8h"],
    [(8 * 60 + 30) * 60 * 1000, "8h 30m"],
    [24 * 3600 * 1000, "1d"],
    [(3 * 24 + 12) * 3600 * 1000, "3d 12h"],
    [7 * 24 * 3600 * 1000, "7d"],
  ])("%p ms -> %s", (milliseconds: number, expected: string) => {
    expect(ScheduleTimelineLayout.formatDuration(milliseconds)).toBe(expected);
  });
});

describe("sumWithin", () => {
  test("clips each interval to the window and adds them up", () => {
    const total: number = ScheduleTimelineLayout.sumWithin(
      [
        interval("2026-09-13T00:00:00Z", "2026-09-15T00:00:00Z"),
        interval("2026-09-16T00:00:00Z", "2026-09-16T12:00:00Z"),
        interval("2026-09-20T00:00:00Z", "2026-09-23T00:00:00Z"),
        interval("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
      ],
      interval("2026-09-14T00:00:00Z", "2026-09-21T00:00:00Z"),
    );

    expect(total).toBe((24 + 12 + 24) * 3600 * 1000);
  });

  test("overlaps are counted twice (load, not presence)", () => {
    const total: number = ScheduleTimelineLayout.sumWithin(
      [
        interval("2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
        interval("2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
      ],
      interval("2026-09-14T00:00:00Z", "2026-09-21T00:00:00Z"),
    );

    expect(total).toBe(48 * 3600 * 1000);
  });
});

describe("getNavigability", () => {
  const addressable: TimeInterval = interval(
    "2026-03-21T12:00:00Z",
    "2027-09-17T12:00:00Z",
  );

  test("free movement in the middle", () => {
    expect(
      ScheduleTimelineLayout.getNavigability({
        mode: TimelineViewMode.Week,
        anchor: at("2026-09-17T12:00:00Z"),
        timezone: UTC,
        addressable,
      }),
    ).toEqual({ canGoBack: true, canGoForward: true });
  });

  test("cannot go back once the previous week is wholly out of range", () => {
    /*
     * The week of 2026-03-23; the previous week ends 2026-03-23 00:00, which
     * is after the earliest instant, so it is still reachable...
     */
    expect(
      ScheduleTimelineLayout.getNavigability({
        mode: TimelineViewMode.Week,
        anchor: at("2026-03-25T12:00:00Z"),
        timezone: UTC,
        addressable,
      }).canGoBack,
    ).toBe(true);

    /*
     * ...but from the week of 2026-03-16 the previous one ends 2026-03-16,
     * before the earliest instant.
     */
    expect(
      ScheduleTimelineLayout.getNavigability({
        mode: TimelineViewMode.Week,
        anchor: at("2026-03-18T12:00:00Z"),
        timezone: UTC,
        addressable,
      }).canGoBack,
    ).toBe(false);
  });

  test("cannot go forward once the next month starts after the limit", () => {
    expect(
      ScheduleTimelineLayout.getNavigability({
        mode: TimelineViewMode.Month,
        anchor: at("2027-08-15T12:00:00Z"),
        timezone: UTC,
        addressable,
      }).canGoForward,
    ).toBe(true);

    expect(
      ScheduleTimelineLayout.getNavigability({
        mode: TimelineViewMode.Month,
        anchor: at("2027-09-15T12:00:00Z"),
        timezone: UTC,
        addressable,
      }).canGoForward,
    ).toBe(false);
  });
});

describe("colours", () => {
  test("withAlpha converts #rrggbb and #rgb", () => {
    expect(ScheduleTimelineLayout.withAlpha("#6366f1", 0.2)).toBe(
      "rgba(99, 102, 241, 0.2)",
    );
    expect(ScheduleTimelineLayout.withAlpha("#fff", 1)).toBe(
      "rgba(255, 255, 255, 1)",
    );
    expect(ScheduleTimelineLayout.withAlpha("  #000000 ", 0.5)).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
  });

  test("withAlpha clamps alpha and leaves non-hex colours alone", () => {
    expect(ScheduleTimelineLayout.withAlpha("#000000", 4)).toBe(
      "rgba(0, 0, 0, 1)",
    );
    expect(ScheduleTimelineLayout.withAlpha("#000000", -1)).toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(ScheduleTimelineLayout.withAlpha("red", 0.5)).toBe("red");
    expect(ScheduleTimelineLayout.withAlpha("#12345", 0.5)).toBe("#12345");
  });

  test("getContrastTextColor picks dark text on light colours", () => {
    expect(ScheduleTimelineLayout.getContrastTextColor("#ffbf53")).toBe(
      "#111827",
    );
    expect(ScheduleTimelineLayout.getContrastTextColor("#84cc16")).toBe(
      "#111827",
    );
    expect(ScheduleTimelineLayout.getContrastTextColor("#000000")).toBe(
      "#ffffff",
    );
    expect(ScheduleTimelineLayout.getContrastTextColor("#6366f1")).toBe(
      "#ffffff",
    );
    expect(ScheduleTimelineLayout.getContrastTextColor("nonsense")).toBe(
      "#ffffff",
    );
  });
});

describe("getDayKey / isWithinRange", () => {
  test("the day key is the view zone's date", () => {
    const instant: Date = at("2026-09-17T23:30:00Z");

    expect(ScheduleTimelineLayout.getDayKey(instant, UTC)).toBe("2026-09-17");
    expect(ScheduleTimelineLayout.getDayKey(instant, TOKYO)).toBe("2026-09-18");
  });

  test("the range end is exclusive", () => {
    const range: TimeInterval = interval(
      "2026-09-14T00:00:00Z",
      "2026-09-21T00:00:00Z",
    );

    expect(
      ScheduleTimelineLayout.isWithinRange(at("2026-09-14T00:00:00Z"), range),
    ).toBe(true);
    expect(
      ScheduleTimelineLayout.isWithinRange(at("2026-09-21T00:00:00Z"), range),
    ).toBe(false);
  });
});
