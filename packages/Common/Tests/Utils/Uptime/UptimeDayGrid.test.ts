import UptimeDayGrid from "../../../Utils/Uptime/UptimeDayGrid";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DAY GRID A STATUS PAGE'S UPTIME DAYS ARE CUT ON, WORKED OUT WITH
 * ONEUPTIME'S OWN TZ DATA (issue #10039).
 *
 * The daily uptime statements used to cut a visitor's days in Postgres
 * (`AT TIME ZONE`), with the database server's own zoneinfo: a Helm node
 * that kept postgres:15.10 (tzdata 2024b) started a Vancouver visitor's day
 * at 08:00 UTC instead of 07:00 from 2026-11-01. The midnights are now
 * worked out with moment-timezone - the copy of the tz database every other
 * wall-clock time in OneUptime is worked out with - and handed to Postgres
 * as instants.
 *
 * Each midnight here is checked against the platform's own clock (Intl),
 * not against the code under test: it reads 00:00 on its day in the zone
 * (01:00 on a day whose midnight the clocks skip), and the instant before
 * it is on the day before.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// `instant` on `zone`'s clock, as the platform reads it: "2026-11-01 00:00".
function wallClock(instant: Date, zone: string): string {
  const parts: Record<string, string> = {};

  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}`;
}

function dateOn(instant: Date, zone: string): string {
  return wallClock(instant, zone).slice(0, 10);
}

function grid(data: {
  zone: string;
  from: string;
  to: string;
  now?: string | undefined;
}): Array<Date> {
  return UptimeDayGrid.getMidnights({
    startDate: new Date(data.from),
    endDate: new Date(data.to),
    timezone: data.zone,
    now: new Date(data.now || "2030-01-01T00:00:00.000Z"),
  });
}

function iso(midnights: Array<Date>): Array<string> {
  return midnights.map((midnight: Date): string => {
    return midnight.toISOString();
  });
}

// How long each day of the grid is, in hours.
function dayLengthsInHours(midnights: Array<Date>): Array<number> {
  const lengths: Array<number> = [];

  for (let index: number = 1; index < midnights.length; index++) {
    lengths.push(
      (midnights[index]!.getTime() - midnights[index - 1]!.getTime()) / HOUR_MS,
    );
  }

  return lengths;
}

/*
 * Every midnight starts a local day the platform agrees on: it reads 00:00
 * (or `skippedMidnightTime` on a day the clocks skip midnight), the instant
 * before it is on the day before, and the grid walks one local date at a
 * time.
 */
function expectEveryMidnightOnTheClock(
  midnights: Array<Date>,
  zone: string,
): void {
  for (let index: number = 0; index < midnights.length; index++) {
    const midnight: Date = midnights[index]!;
    const before: Date = new Date(midnight.getTime() - 1);

    expect(dateOn(before, zone)).not.toBe(dateOn(midnight, zone));
    expect(["00:00", "01:00"]).toContain(wallClock(midnight, zone).slice(11));

    if (index > 0) {
      const previous: Date = midnights[index - 1]!;

      // The next local date, never one skipped and never the same twice.
      expect(dateOn(new Date(previous.getTime() + 36 * HOUR_MS), zone)).toBe(
        dateOn(midnight, zone),
      );
    }
  }
}

describe("UptimeDayGrid.getMidnights", () => {
  test("UTC: every UTC midnight from the window's first day to the one after its last, and one day on", () => {
    expect(
      iso(
        grid({
          zone: "UTC",
          from: "2026-07-24T12:00:00.000Z",
          to: "2026-07-27T06:00:00.000Z",
        }),
      ),
    ).toEqual([
      "2026-07-24T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
      "2026-07-27T00:00:00.000Z",
      // Ends the window's last day, 27 July.
      "2026-07-28T00:00:00.000Z",
      // One day on, for a database clock a moment ahead of this one.
      "2026-07-29T00:00:00.000Z",
    ]);
  });

  test("a window that starts and ends on a midnight: the day it ends at is the last one", () => {
    expect(
      iso(
        grid({
          zone: "UTC",
          from: "2026-07-24T00:00:00.000Z",
          to: "2026-07-26T00:00:00.000Z",
        }),
      ),
    ).toEqual([
      "2026-07-24T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
      "2026-07-27T00:00:00.000Z",
      "2026-07-28T00:00:00.000Z",
    ]);
  });

  test("a window that runs on past now is cut at now's day: no future day is laid out", () => {
    const midnights: Array<Date> = grid({
      zone: "UTC",
      from: "2026-11-01T00:00:00.000Z",
      to: "2027-02-01T00:00:00.000Z",
      now: "2026-11-03T15:00:00.000Z",
    });

    expect(iso(midnights)).toEqual([
      "2026-11-01T00:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
      "2026-11-03T00:00:00.000Z",
      "2026-11-04T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z",
    ]);
  });

  test("a window that starts after now still has its first day, and the day after", () => {
    expect(
      iso(
        grid({
          zone: "UTC",
          from: "2026-12-10T12:00:00.000Z",
          to: "2026-12-20T00:00:00.000Z",
          now: "2026-11-03T15:00:00.000Z",
        }),
      ),
    ).toEqual([
      "2026-12-10T00:00:00.000Z",
      "2026-12-11T00:00:00.000Z",
      "2026-12-12T00:00:00.000Z",
    ]);
  });

  test("now defaults to the current time", () => {
    const now: Date = new Date();
    const midnights: Array<Date> = UptimeDayGrid.getMidnights({
      startDate: new Date(now.getTime() - 3 * DAY_MS),
      endDate: new Date(now.getTime() + 30 * DAY_MS),
      timezone: "UTC",
    });

    // Three days back, today, the midnight that ends today, and one more.
    expect(midnights.length).toBe(6);
    expect(midnights[midnights.length - 1]!.getTime()).toBeGreaterThan(
      now.getTime(),
    );
    expect(midnights[midnights.length - 1]!.getTime()).toBeLessThanOrEqual(
      now.getTime() + 2 * DAY_MS,
    );
  });

  test("British Columbia: a Vancouver visitor's day starts at 07:00 UTC, every day across 2026-11-01 (tzdata 2026b, #9999)", () => {
    const midnights: Array<Date> = grid({
      zone: "America/Vancouver",
      from: "2026-10-30T07:00:00.000Z",
      to: "2026-11-04T07:00:00.000Z",
    });

    expect(midnights.length).toBeGreaterThanOrEqual(6);

    for (const midnight of iso(midnights)) {
      expect(midnight.slice(11)).toBe("07:00:00.000Z");
    }

    expect(iso(midnights)).toContain("2026-11-01T07:00:00.000Z");
    expect(iso(midnights)).toContain("2026-11-02T07:00:00.000Z");
    // No 25-hour day: British Columbia did not fall back.
    expect(new Set(dayLengthsInHours(midnights))).toEqual(new Set([24]));
  });

  test("Los Angeles still falls back: 07:00 UTC until 2026-11-01, 08:00 UTC after, and a 25-hour day", () => {
    const midnights: Array<Date> = grid({
      zone: "America/Los_Angeles",
      from: "2026-10-30T07:00:00.000Z",
      to: "2026-11-04T08:00:00.000Z",
    });

    expect(iso(midnights)).toContain("2026-10-31T07:00:00.000Z");
    expect(iso(midnights)).toContain("2026-11-01T07:00:00.000Z");
    expect(iso(midnights)).toContain("2026-11-02T08:00:00.000Z");
    expect(iso(midnights)).toContain("2026-11-03T08:00:00.000Z");
    expect(dayLengthsInHours(midnights)).toContain(25);
    expectEveryMidnightOnTheClock(midnights, "America/Los_Angeles");
  });

  test("New York: one 23-hour day when the clocks go forward, one 25-hour day when they go back", () => {
    const spring: Array<Date> = grid({
      zone: "America/New_York",
      from: "2026-03-05T12:00:00.000Z",
      to: "2026-03-11T12:00:00.000Z",
    });
    const autumn: Array<Date> = grid({
      zone: "America/New_York",
      from: "2026-10-29T12:00:00.000Z",
      to: "2026-11-04T12:00:00.000Z",
    });

    expect(
      dayLengthsInHours(spring).filter((hours: number): boolean => {
        return hours !== 24;
      }),
    ).toEqual([23]);
    expect(iso(spring)).toContain("2026-03-08T05:00:00.000Z");
    expect(iso(spring)).toContain("2026-03-09T04:00:00.000Z");

    expect(
      dayLengthsInHours(autumn).filter((hours: number): boolean => {
        return hours !== 24;
      }),
    ).toEqual([25]);
    expect(iso(autumn)).toContain("2026-11-01T04:00:00.000Z");
    expect(iso(autumn)).toContain("2026-11-02T05:00:00.000Z");

    expectEveryMidnightOnTheClock(spring, "America/New_York");
    expectEveryMidnightOnTheClock(autumn, "America/New_York");
  });

  test("Santiago: the day whose midnight the clocks skip starts at 01:00 and is 23 hours long", () => {
    const midnights: Array<Date> = grid({
      zone: "America/Santiago",
      from: "2026-09-04T12:00:00.000Z",
      to: "2026-09-08T12:00:00.000Z",
    });

    expect(iso(midnights)).toEqual([
      "2026-09-04T04:00:00.000Z",
      "2026-09-05T04:00:00.000Z",
      // 6 September: midnight never comes, the day starts at 01:00 -03.
      "2026-09-06T04:00:00.000Z",
      "2026-09-07T03:00:00.000Z",
      "2026-09-08T03:00:00.000Z",
      "2026-09-09T03:00:00.000Z",
      "2026-09-10T03:00:00.000Z",
    ]);
    expect(wallClock(midnights[2]!, "America/Santiago")).toBe(
      "2026-09-06 01:00",
    );
    expect(dayLengthsInHours(midnights)).toEqual([24, 24, 23, 24, 24, 24]);
    expectEveryMidnightOnTheClock(midnights, "America/Santiago");
  });

  test("Santiago: the day its clocks go back at midnight is 25 hours long", () => {
    const midnights: Array<Date> = grid({
      zone: "America/Santiago",
      from: "2026-04-03T12:00:00.000Z",
      to: "2026-04-06T12:00:00.000Z",
    });

    expect(dayLengthsInHours(midnights)).toEqual([24, 25, 24, 24, 24]);
    expectEveryMidnightOnTheClock(midnights, "America/Santiago");
  });

  test("Lord Howe Island: days of 24.5 and 23.5 hours, where the clocks move half an hour", () => {
    const autumn: Array<Date> = grid({
      zone: "Australia/Lord_Howe",
      from: "2026-04-03T12:00:00.000Z",
      to: "2026-04-07T12:00:00.000Z",
    });
    const spring: Array<Date> = grid({
      zone: "Australia/Lord_Howe",
      from: "2026-10-02T12:00:00.000Z",
      to: "2026-10-06T12:00:00.000Z",
    });

    expect(dayLengthsInHours(autumn)).toContain(24.5);
    expect(dayLengthsInHours(spring)).toContain(23.5);
    expectEveryMidnightOnTheClock(autumn, "Australia/Lord_Howe");
    expectEveryMidnightOnTheClock(spring, "Australia/Lord_Howe");
  });

  test.each([
    ["Asia/Kolkata", "18:30:00.000Z"],
    ["Asia/Kathmandu", "18:15:00.000Z"],
    ["Asia/Shanghai", "16:00:00.000Z"],
    ["Asia/Tokyo", "15:00:00.000Z"],
  ])("%s: every midnight at %s", (zone: string, utcTimeOfMidnight: string) => {
    const midnights: Array<Date> = grid({
      zone: zone,
      from: "2026-07-01T12:00:00.000Z",
      to: "2026-07-20T12:00:00.000Z",
    });

    for (const midnight of iso(midnights)) {
      expect(midnight.slice(11)).toBe(utcTimeOfMidnight);
    }
    expectEveryMidnightOnTheClock(midnights, zone);
  });

  /*
   * Zones whose 2026 rules every copy of the tz database agrees on: the
   * platform's own (Node's ICU) can be a release behind moment's, as it is
   * for Cuba's 2026 clocks between 2026e and 2026f.
   */
  test.each([
    "Europe/London",
    "Europe/Berlin",
    "Australia/Sydney",
    "Pacific/Chatham",
    "Pacific/Auckland",
    "Asia/Tehran",
  ])(
    "%s: a whole year of days, each starting at the zone's own midnight",
    (zone: string) => {
      const midnights: Array<Date> = grid({
        zone: zone,
        from: "2026-01-01T12:00:00.000Z",
        to: "2026-12-31T12:00:00.000Z",
      });

      expect(midnights.length).toBeGreaterThanOrEqual(366);
      expectEveryMidnightOnTheClock(midnights, zone);
    },
  );

  test("a 90-day status page history: 90 days, today's end and one more", () => {
    const now: Date = new Date("2026-11-20T15:30:00.000Z");
    const midnights: Array<Date> = UptimeDayGrid.getMidnights({
      startDate: new Date("2026-08-23T04:00:00.000Z"),
      endDate: now,
      timezone: "America/New_York",
      now: now,
    });

    expect(midnights[0]!.toISOString()).toBe("2026-08-23T04:00:00.000Z");
    expect(midnights.length).toBe(90 + 2);
    expectEveryMidnightOnTheClock(midnights, "America/New_York");
  });

  test("a legacy name cuts the days its current one does", () => {
    expect(
      iso(
        grid({
          zone: "Asia/Calcutta",
          from: "2026-07-01T12:00:00.000Z",
          to: "2026-07-05T12:00:00.000Z",
        }),
      ),
    ).toEqual(
      iso(
        grid({
          zone: "Asia/Kolkata",
          from: "2026-07-01T12:00:00.000Z",
          to: "2026-07-05T12:00:00.000Z",
        }),
      ),
    );
    // A name tzdata removed, which only TimezoneAlias still translates.
    expect(
      iso(
        grid({
          zone: "US/Pacific-New",
          from: "2026-07-01T12:00:00.000Z",
          to: "2026-07-05T12:00:00.000Z",
        }),
      ),
    ).toEqual(
      iso(
        grid({
          zone: "America/Los_Angeles",
          from: "2026-07-01T12:00:00.000Z",
          to: "2026-07-05T12:00:00.000Z",
        }),
      ),
    );
  });

  test.each([
    ["an empty string", ""],
    ["spaces", "   "],
  ])("%s is UTC", (_name: string, zone: string) => {
    expect(
      iso(
        grid({
          zone: zone,
          from: "2026-07-24T12:00:00.000Z",
          to: "2026-07-25T12:00:00.000Z",
        }),
      ),
    ).toEqual(
      iso(
        grid({
          zone: "UTC",
          from: "2026-07-24T12:00:00.000Z",
          to: "2026-07-25T12:00:00.000Z",
        }),
      ),
    );
  });

  test.each([
    ["a typo", "Europe/Lodnon"],
    ["text written to be SQL", "UTC'); DROP TABLE x; --"],
  ])("%s is refused, never read as UTC", (_name: string, zone: string) => {
    expect(() => {
      grid({
        zone: zone,
        from: "2026-07-24T12:00:00.000Z",
        to: "2026-07-25T12:00:00.000Z",
      });
    }).toThrow(BadDataException);
  });

  test("a window no one could mean is refused rather than laid out without end", () => {
    expect(() => {
      grid({
        zone: "UTC",
        from: "1900-01-01T00:00:00.000Z",
        to: "2026-07-25T12:00:00.000Z",
      });
    }).toThrow(BadDataException);
  });

  test("a window that is not dates is refused", () => {
    expect(() => {
      UptimeDayGrid.getMidnights({
        startDate: new Date(Number.NaN),
        endDate: new Date("2026-07-25T12:00:00.000Z"),
        timezone: "UTC",
      });
    }).toThrow(BadDataException);
  });
});

describe("UptimeDayGrid.getDatabaseParameter", () => {
  test("binds the midnights as ISO instants, in order, which Postgres reads whatever its session's zone", () => {
    const parameter: Array<string> = UptimeDayGrid.getDatabaseParameter({
      startDate: new Date("2026-11-01T08:00:00.000Z"),
      endDate: new Date("2026-11-02T08:00:00.000Z"),
      timezone: "America/Vancouver",
      now: new Date("2027-01-01T00:00:00.000Z"),
    });

    expect(parameter).toEqual([
      "2026-11-01T07:00:00.000Z",
      "2026-11-02T07:00:00.000Z",
      "2026-11-03T07:00:00.000Z",
      "2026-11-04T07:00:00.000Z",
    ]);
    expect(
      UptimeDayGrid.toDatabaseParameter([new Date("2026-11-01T07:00:00.000Z")]),
    ).toEqual(["2026-11-01T07:00:00.000Z"]);
  });
});
