import { describe, expect, test } from "@jest/globals";
import {
  StatusTimelineTick,
  StatusTimelineTickUnit,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import {
  formatStatusTimelineDateRange,
  formatStatusTimelineEnd,
  formatStatusTimelineFullTime,
  formatStatusTimelineMonth,
  formatStatusTimelineRange,
  formatStatusTimelineShortDate,
  formatStatusTimelineShortDateTime,
  formatStatusTimelineTickLabel,
  formatStatusTimelineTime,
  formatStatusTimelineTimeWithSeconds,
  formatStatusTimelineWindowEnds,
  formatStatusTimelineYear,
  getStatusTimelineDayHeading,
  getStatusTimelineZoneName,
  isSameStatusTimelineDay,
  StatusTimelineClock,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineTime";

/*
 * How a status timeline writes its times: in the reader's zone and
 * language, as the feeds do - real times of day, a day heading with the full
 * date, the zone's name - with a fixed clock, so nothing here depends on
 * where or when the suite runs.
 */

// Intl writes a narrow no-break space before AM/PM in newer ICU versions.
const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

const plain: (text: string) => string = (text: string): string => {
  return text.replace(NARROW_SPACES, " ");
};

const NOW: Date = new Date("2026-10-14T08:36:00.000Z");

const clock: (
  overrides?: Partial<StatusTimelineClock>,
) => StatusTimelineClock = (
  overrides?: Partial<StatusTimelineClock>,
): StatusTimelineClock => {
  return {
    timezone: "Europe/London",
    language: "en",
    use12HourClock: false,
    now: NOW,
    ...(overrides || {}),
  };
};

const tick: (
  at: string,
  unit: StatusTimelineTickUnit,
  isDayStart?: boolean,
) => StatusTimelineTick = (
  at: string,
  unit: StatusTimelineTickUnit,
  isDayStart: boolean = false,
): StatusTimelineTick => {
  return { at: new Date(at), left: 50, unit: unit, isDayStart: isDayStart };
};

describe("times of day, in the reader's zone", () => {
  test("a 24-hour reader in London (summer time)", () => {
    expect(
      formatStatusTimelineTime(new Date("2026-10-09T06:27:00.000Z"), clock()),
    ).toBe("07:27");
  });

  test("a 12-hour reader in New York", () => {
    expect(
      plain(
        formatStatusTimelineTime(
          new Date("2026-10-09T06:27:00.000Z"),
          clock({ timezone: "America/New_York", use12HourClock: true }),
        ),
      ),
    ).toBe("2:27 AM");
  });

  test("to the second, for two ends in one minute", () => {
    expect(
      formatStatusTimelineTimeWithSeconds(
        new Date("2026-10-09T06:26:12.000Z"),
        clock(),
      ),
    ).toBe("07:26:12");
  });

  test("in the reader's language", () => {
    expect(
      formatStatusTimelineShortDate(
        new Date("2026-10-09T06:27:00.000Z"),
        clock({ language: "de" }),
      ),
    ).toBe("9. Okt.");
    expect(
      formatStatusTimelineShortDate(
        new Date("2026-10-09T06:27:00.000Z"),
        clock({ language: "ja" }),
      ),
    ).toBe("10月9日");
  });

  test("in the language's own digits, as its dates and counts are", () => {
    const persian: string = formatStatusTimelineTime(
      new Date("2026-10-09T06:27:00.000Z"),
      clock({ language: "fa" }),
    );

    expect(persian).toMatch(/^[۰-۹:]+/u);
    expect(persian).not.toMatch(/[0-9]/);
    expect(
      formatStatusTimelineTime(
        new Date("2026-10-09T06:27:00.000Z"),
        clock({ language: "de" }),
      ),
    ).toMatch(/^[0-9:]+/);
  });

  test("a language Intl does not know reads as English, never the browser's own", () => {
    expect(
      formatStatusTimelineShortDate(
        new Date("2026-10-09T06:27:00.000Z"),
        clock({ language: "zz-NOPE" }),
      ),
    ).toBe("Oct 9");
  });

  test("dates near midnight fall on the reader's day, not UTC's", () => {
    const lateEvening: Date = new Date("2026-10-08T23:30:00.000Z");

    expect(formatStatusTimelineShortDate(lateEvening, clock())).toBe("Oct 9");
    expect(
      formatStatusTimelineShortDate(lateEvening, clock({ timezone: "UTC" })),
    ).toBe("Oct 8");
  });
});

describe("when an entry ended", () => {
  test("on the day it began: the time alone", () => {
    expect(
      formatStatusTimelineEnd({
        startsAt: new Date("2026-10-09T06:26:00.000Z"),
        endsAt: new Date("2026-10-09T06:27:00.000Z"),
        clock: clock(),
      }),
    ).toBe("07:27");
  });

  test("on another day: the day as well", () => {
    expect(
      formatStatusTimelineEnd({
        startsAt: new Date("2026-09-15T16:11:00.000Z"),
        endsAt: new Date("2026-10-04T04:18:00.000Z"),
        clock: clock(),
      }),
    ).toBe("Oct 4, 05:18");
  });

  test("the day is the reader's: across midnight in their zone is another day", () => {
    const startsAt: Date = new Date("2026-10-08T22:50:00.000Z");
    const endsAt: Date = new Date("2026-10-08T23:10:00.000Z");

    expect(
      isSameStatusTimelineDay(startsAt, endsAt, clock({ timezone: "UTC" })),
    ).toBe(true);
    expect(isSameStatusTimelineDay(startsAt, endsAt, clock())).toBe(false);
  });
});

describe("formatStatusTimelineRange", () => {
  test("two ends in different minutes read to the minute", () => {
    expect(
      formatStatusTimelineRange({
        startsAt: new Date("2026-10-04T05:30:10.000Z"),
        endsAt: new Date("2026-10-04T05:31:01.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "06:30", end: "06:31" });
  });

  test("two ends in one minute read to the second, never 07:26 – 07:26", () => {
    expect(
      formatStatusTimelineRange({
        startsAt: new Date("2026-10-09T06:26:12.000Z"),
        endsAt: new Date("2026-10-09T06:26:50.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "07:26:12", end: "07:26:50" });
  });

  test("an end on another day carries its day", () => {
    expect(
      formatStatusTimelineRange({
        startsAt: new Date("2026-09-15T16:11:00.000Z"),
        endsAt: new Date("2026-10-04T04:18:00.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "17:11", end: "Oct 4, 05:18" });
  });
});

describe("formatStatusTimelineDateRange: a range read on its own, with its day", () => {
  test("two ends in different minutes: the day, then the times to the minute", () => {
    expect(
      formatStatusTimelineDateRange({
        startsAt: new Date("2026-10-04T05:30:10.000Z"),
        endsAt: new Date("2026-10-04T05:31:01.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "Oct 4, 06:30", end: "06:31" });
  });

  test("two ends in one minute read to the second, never Oct 9, 07:26 – 07:26", () => {
    expect(
      formatStatusTimelineDateRange({
        startsAt: new Date("2026-10-09T06:26:12.000Z"),
        endsAt: new Date("2026-10-09T06:26:50.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "Oct 9, 07:26:12", end: "07:26:50" });
  });

  test("a 12-hour reader reads it to the second too", () => {
    const range: { start: string; end: string } = formatStatusTimelineDateRange(
      {
        startsAt: new Date("2026-10-09T06:26:12.000Z"),
        endsAt: new Date("2026-10-09T06:26:50.000Z"),
        clock: clock({ use12HourClock: true }),
      },
    );

    expect(plain(range.start)).toBe("Oct 9, 7:26:12 AM");
    expect(plain(range.end)).toBe("7:26:50 AM");
  });

  test("an end on another day carries its day", () => {
    expect(
      formatStatusTimelineDateRange({
        startsAt: new Date("2026-09-15T16:11:00.000Z"),
        endsAt: new Date("2026-10-04T04:18:00.000Z"),
        clock: clock(),
      }),
    ).toEqual({ start: "Sep 15, 17:11", end: "Oct 4, 05:18" });
  });
});

describe("the axis's labels", () => {
  test("hours read as times; a midnight reads as its date", () => {
    expect(
      formatStatusTimelineTickLabel(
        tick("2026-10-14T05:00:00.000Z", StatusTimelineTickUnit.Hour),
        clock(),
      ),
    ).toBe("06:00");
    expect(
      formatStatusTimelineTickLabel(
        tick("2026-10-13T23:00:00.000Z", StatusTimelineTickUnit.Hour, true),
        clock(),
      ),
    ).toBe("Oct 14");
  });

  test("days and weeks read as dates, months with their year, years alone", () => {
    expect(
      formatStatusTimelineTickLabel(
        tick("2026-10-05T00:00:00.000Z", StatusTimelineTickUnit.Week),
        clock({ timezone: "UTC" }),
      ),
    ).toBe("Oct 5");
    expect(
      formatStatusTimelineTickLabel(
        tick("2026-10-01T00:00:00.000Z", StatusTimelineTickUnit.Month),
        clock({ timezone: "UTC" }),
      ),
    ).toBe("Oct 2026");
    expect(
      formatStatusTimelineTickLabel(
        tick("2026-01-01T00:00:00.000Z", StatusTimelineTickUnit.Year),
        clock({ timezone: "UTC" }),
      ),
    ).toBe("2026");
  });

  test("months and years in the reader's language", () => {
    expect(
      formatStatusTimelineMonth(
        new Date("2026-10-01T00:00:00.000Z"),
        clock({ language: "de", timezone: "UTC" }),
      ),
    ).toBe("Okt. 2026");
    expect(
      formatStatusTimelineYear(
        new Date("2026-06-01T00:00:00.000Z"),
        clock({ language: "ja", timezone: "UTC" }),
      ),
    ).toBe("2026年");
  });

  test("the window's two ends, for the band's name", () => {
    expect(
      formatStatusTimelineWindowEnds({
        start: new Date("2026-09-14T08:36:00.000Z"),
        end: NOW,
        clock: clock(),
      }),
    ).toEqual({ start: "Sep 14, 09:36", end: "Oct 14, 09:36" });
    expect(
      plain(
        formatStatusTimelineShortDateTime(NOW, clock({ use12HourClock: true })),
      ),
    ).toBe("Oct 14, 9:36 AM");
  });
});

describe("the list's day headings and tooltips", () => {
  test("a day heading: its full date, Today or Yesterday, and the zone", () => {
    expect(
      getStatusTimelineDayHeading(
        new Date("2026-10-14T06:00:00.000Z"),
        clock(),
      ),
    ).toEqual({
      dayKey: "2026-10-14",
      label: "Wednesday, October 14, 2026",
      relativeLabel: "Today",
      zoneName: "BST",
    });
    expect(
      getStatusTimelineDayHeading(new Date("2026-10-13T06:00:00.000Z"), clock())
        .relativeLabel,
    ).toBe("Yesterday");
    expect(
      getStatusTimelineDayHeading(new Date("2026-10-09T06:00:00.000Z"), clock())
        .relativeLabel,
    ).toBeUndefined();
  });

  test("the zone's name is the one at that instant: BST in summer, GMT in winter", () => {
    expect(
      getStatusTimelineZoneName(new Date("2026-10-09T06:00:00.000Z"), clock()),
    ).toBe("BST");
    expect(
      getStatusTimelineZoneName(new Date("2026-11-09T06:00:00.000Z"), clock()),
    ).toBe("GMT");
  });

  test("everything about an instant, for a tooltip", () => {
    expect(
      plain(
        formatStatusTimelineFullTime(
          new Date("2026-10-09T06:27:12.000Z"),
          clock(),
        ),
      ),
    ).toBe("Friday, October 9, 2026 at 07:27:12 BST");
  });
});
