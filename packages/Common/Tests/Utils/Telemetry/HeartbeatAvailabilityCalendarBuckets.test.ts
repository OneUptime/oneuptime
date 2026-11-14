/** @timezone Asia/Tokyo */

import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import Timezone from "../../../Types/Timezone";
import HeartbeatAvailabilityUtil, {
  HeartbeatAvailabilityPoint,
  HeartbeatAvailabilityResult,
} from "../../../Utils/Telemetry/HeartbeatAvailability";
import {
  ReceivingGap,
  ReceivingGapReason,
} from "../../../Utils/Telemetry/ReceivingGaps";
import { describe, expect, test } from "@jest/globals";

/*
 * The day, week, month and year buckets of the heartbeat availability chart
 * (the Host, Docker host, Podman host and Kubernetes cluster overviews), on
 * the calendar the server cut them on (issue #7277). The dashboard asks for
 * them in the reader's zone, so a London reader's days start at London
 * midnight: 23:00 UTC in summer, 00:00 UTC in winter. A grid of fixed
 * 24-hour steps from the first of them put every day after the clocks went
 * back at 23:00 the evening before: two points on 25 October, every later
 * point a day early, and none on the last day. Months of a fixed 30 days ran
 * off the 1st from the second month on, and years of 365 days off 1 January
 * after the first leap year.
 *
 * This file runs in Asia/Tokyo (the docblock above, through
 * Tests/Utils/TimezoneEnvironment.js), a zone none of these readers is in, so
 * only the zone the builder is given can put their days in the right place.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const NOW: Date = new Date("2026-11-13T10:30:30.000Z");

// The instant `day` (YYYY-MM-DD) began where clocks read UTC + offsetHours.
function midnight(day: string, offsetHours: number): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - offsetHours * HOUR);
}

// London in 2026: BST (UTC+1) from 29 March 01:00 UTC to 25 October 01:00 UTC.
function londonMidnight(day: string): Date {
  return midnight(day, day >= "2026-03-30" && day <= "2026-10-25" ? 1 : 0);
}

// New York in 2026: EDT (UTC-4) from 8 March 07:00 UTC to 1 November 06:00 UTC.
function newYorkMidnight(day: string): Date {
  return midnight(day, day >= "2026-03-09" && day <= "2026-11-01" ? -4 : -5);
}

// Every calendar day from `from` to `to`, both included.
function days(from: string, to: string): Array<string> {
  const result: Array<string> = [];
  for (
    let t: number = Date.parse(`${from}T00:00:00.000Z`);
    t <= Date.parse(`${to}T00:00:00.000Z`);
    t += DAY
  ) {
    result.push(new Date(t).toISOString().slice(0, 10));
  }
  return result;
}

// Every `step`-th day from `from` to `to` (Mondays, a week apart).
function everyNthDay(from: string, to: string, step: number): Array<string> {
  return days(from, to).filter((_: string, index: number) => {
    return index % step === 0;
  });
}

function rows(instants: Array<Date>): Array<AggregatedModel> {
  return instants.map((timestamp: Date): AggregatedModel => {
    return { timestamp, value: 3 } as AggregatedModel;
  });
}

function build(data: {
  instants: Array<Date>;
  windowStart: Date;
  windowEnd?: Date | undefined;
  now?: Date | undefined;
  timezone?: Timezone | undefined;
  receivingGaps?: Array<ReceivingGap> | undefined;
}): HeartbeatAvailabilityResult {
  return HeartbeatAvailabilityUtil.buildAvailabilitySeries({
    heartbeatData: rows(data.instants),
    windowStart: data.windowStart,
    windowEnd: data.windowEnd || NOW,
    now: data.now || NOW,
    timezone: data.timezone,
    receivingGaps: data.receivingGaps,
  });
}

function xs(points: Array<HeartbeatAvailabilityPoint>): Array<string> {
  return points.map((point: HeartbeatAvailabilityPoint) => {
    return point.x.toISOString();
  });
}

// The last point's x (Common targets ES2017, which has no Array.prototype.at).
function lastX(points: Array<HeartbeatAvailabilityPoint>): string | undefined {
  const all: Array<string> = xs(points);
  return all[all.length - 1];
}

function isoStrings(instants: Array<Date>): Array<string> {
  return instants.map((instant: Date) => {
    return instant.toISOString();
  });
}

function downXs(result: HeartbeatAvailabilityResult): Array<string> {
  return xs(
    result.points.filter((point: HeartbeatAvailabilityPoint) => {
      return point.y === 0;
    }),
  );
}

// The calendar day an instant falls on, read on clocks in `zone`.
function dayIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

// The weekday and time of day an instant reads in `zone`, as "Mon 00:00".
function weekdayAndTimeIn(instant: Date, zone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(instant);
  const part: (type: string) => string = (type: string): string => {
    return (
      parts.find((p: Intl.DateTimeFormatPart) => {
        return p.type === type;
      })?.value || ""
    );
  };
  return `${part("weekday")} ${part("hour")}:${part("minute")}`;
}

describe("Heartbeat availability walks day, week, month and year buckets on the calendar", () => {
  test("the test runs in Tokyo, so no reader's zone is the machine's", () => {
    // Tokyo is UTC+9 all year: getTimezoneOffset reads -540 in both seasons.
    expect(new Date("2026-01-15T00:00:00.000Z").getTimezoneOffset()).toBe(-540);
    expect(new Date("2026-07-15T00:00:00.000Z").getTimezoneOffset()).toBe(-540);
  });

  describe("a London reader's past month, over the October clock change", () => {
    // 30 days ending now: Day buckets. 25 October 2026 is 25 hours long.
    const windowStart: Date = new Date(NOW.getTime() - 30 * DAY);
    const allDays: Array<string> = days("2026-10-14", "2026-11-13");

    test("one point a day, at that day's London midnight, up to today", () => {
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays.map(londonMidnight),
        windowStart,
        timezone: Timezone.EuropeLondon,
      });

      expect(xs(result.points)).toEqual(
        isoStrings(allDays.map(londonMidnight)),
      );
      expect(
        result.points.map((point: HeartbeatAvailabilityPoint) => {
          return dayIn(point.x, "Europe/London");
        }),
      ).toEqual(allDays);
      expect(result.uptimePercent).toBe(100);
    });

    test("a silent day is down on that day, on either side of the change", () => {
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays
          .filter((day: string) => {
            return day !== "2026-10-20" && day !== "2026-11-01";
          })
          .map(londonMidnight),
        windowStart,
        timezone: Timezone.EuropeLondon,
      });

      expect(downXs(result)).toEqual([
        "2026-10-19T23:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ]);
      expect(
        downXs(result).map((x: string) => {
          return dayIn(new Date(x), "Europe/London");
        }),
      ).toEqual(["2026-10-20", "2026-11-01"]);
      expect(result.points).toHaveLength(31);
      expect(result.uptimePercent).toBeCloseTo((29 / 31) * 100, 10);
    });

    test("the 25-hour day is judged on all 25 of its hours", () => {
      const withoutTheLongDay: Array<Date> = allDays
        .filter((day: string) => {
          return day !== "2026-10-25";
        })
        .map(londonMidnight);

      /*
       * OneUptime was not receiving for the first 24 hours of 25 October,
       * but heard the last hour of it (00:00-01:00 UTC on the 26th is
       * 23:00-24:00 GMT on the 25th), and the host stayed silent through
       * it: that silence is the host's. A 24-hour slot ended at 23:00 UTC
       * and called the whole day not monitored.
       */
      const heardTheLastHour: HeartbeatAvailabilityResult = build({
        instants: withoutTheLongDay,
        windowStart,
        timezone: Timezone.EuropeLondon,
        receivingGaps: [
          {
            startsAt: new Date("2026-10-24T23:00:00.000Z"),
            endsAt: new Date("2026-10-25T23:00:00.000Z"),
            reason: ReceivingGapReason.NotReceiving,
          },
        ],
      });
      expect(downXs(heardTheLastHour)).toEqual(["2026-10-24T23:00:00.000Z"]);

      // Not receiving for all 25 hours: not monitored, neither up nor down.
      const heardNone: HeartbeatAvailabilityResult = build({
        instants: withoutTheLongDay,
        windowStart,
        timezone: Timezone.EuropeLondon,
        receivingGaps: [
          {
            startsAt: new Date("2026-10-24T23:00:00.000Z"),
            endsAt: new Date("2026-10-26T00:00:00.000Z"),
            reason: ReceivingGapReason.NotReceiving,
          },
        ],
      });
      expect(downXs(heardNone)).toEqual([]);
      expect(xs(heardNone.points)).not.toContain("2026-10-24T23:00:00.000Z");
      expect(heardNone.points).toHaveLength(30);
      expect(heardNone.uptimePercent).toBe(100);
    });

    test("today, silent so far, is left out rather than down", () => {
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays
          .filter((day: string) => {
            return day !== "2026-11-13";
          })
          .map(londonMidnight),
        windowStart,
        timezone: Timezone.EuropeLondon,
      });

      expect(downXs(result)).toEqual([]);
      expect(lastX(result.points)).toBe("2026-11-12T00:00:00.000Z");
      expect(result.uptimePercent).toBe(100);
    });

    test("in the 25th hour of 25 October, that day is still in progress", () => {
      /*
       * 23:30 UTC on the 25th is 23:30 GMT, the day's 25th hour in London
       * (it began at 00:00 BST, 23:00 UTC on the 24th): it has half an hour
       * left, so a host silent in it so far is not down yet. A slot 24
       * hours long had closed at 23:00 UTC and called it so.
       */
      const now: Date = new Date("2026-10-25T23:30:00.000Z");
      const result: HeartbeatAvailabilityResult = build({
        instants: days("2026-09-26", "2026-10-24").map(londonMidnight),
        windowStart: new Date(now.getTime() - 30 * DAY),
        windowEnd: now,
        now,
        timezone: Timezone.EuropeLondon,
      });

      expect(downXs(result)).toEqual([]);
      expect(lastX(result.points)).toBe("2026-10-23T23:00:00.000Z");
      expect(result.uptimePercent).toBe(100);
    });

    test("rows the server cut at UTC midnight still land one a day", () => {
      /*
       * A request answered in UTC though the builder was told London (a
       * zone that changed between the two): each row is at most an hour off
       * its London day, and lands on that day.
       */
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays.map((day: string) => {
          return midnight(day, 0);
        }),
        windowStart,
        timezone: Timezone.EuropeLondon,
      });

      expect(
        result.points.map((point: HeartbeatAvailabilityPoint) => {
          return dayIn(point.x, "Europe/London");
        }),
      ).toEqual(allDays);
      expect(result.uptimePercent).toBe(100);
    });

    test("rows the server cut at Paris midnight, an hour early, still land one a day", () => {
      /*
       * Paris is an hour ahead of London all year, so its midnight falls at
       * 23:00 the evening before in London: each row is the nearest one to
       * its own London day's start, not inside the day before.
       */
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays.map((day: string) => {
          return new Date(londonMidnight(day).getTime() - HOUR);
        }),
        windowStart,
        timezone: Timezone.EuropeLondon,
      });

      expect(xs(result.points)).toEqual(
        isoStrings(allDays.map(londonMidnight)),
      );
      expect(result.uptimePercent).toBe(100);
    });
  });

  test("a New York reader's past two weeks, over the November clock change", () => {
    // 14 days ending now: Day buckets. 1 November 2026 is 25 hours long.
    const allDays: Array<string> = days("2026-10-30", "2026-11-13");
    const result: HeartbeatAvailabilityResult = build({
      instants: allDays.map(newYorkMidnight),
      windowStart: new Date(NOW.getTime() - 14 * DAY),
      timezone: Timezone.AmericaNew_York,
    });

    expect(xs(result.points)).toEqual(isoStrings(allDays.map(newYorkMidnight)));
    expect(
      result.points.map((point: HeartbeatAvailabilityPoint) => {
        return dayIn(point.x, "America/New_York");
      }),
    ).toEqual(allDays);
    expect(result.uptimePercent).toBe(100);
  });

  test.each([
    {
      zone: Timezone.EuropeLondon,
      // 29 March 2026 is 23 hours long in London.
      from: "2026-03-11",
      to: "2026-04-10",
      midnightOf: londonMidnight,
    },
    {
      zone: Timezone.AmericaNew_York,
      // 8 March 2026 is 23 hours long in New York.
      from: "2026-02-20",
      to: "2026-03-20",
      midnightOf: newYorkMidnight,
    },
  ])(
    "$zone over the spring clock change: every point at its day's midnight",
    (scenario: {
      zone: Timezone;
      from: string;
      to: string;
      midnightOf: (day: string) => Date;
    }) => {
      const allDays: Array<string> = days(scenario.from, scenario.to);
      const windowEnd: Date = new Date(`${scenario.to}T12:00:00.000Z`);
      const result: HeartbeatAvailabilityResult = build({
        instants: allDays.map(scenario.midnightOf),
        windowStart: new Date(`${scenario.from}T12:00:00.000Z`),
        windowEnd,
        now: windowEnd,
        timezone: scenario.zone,
      });

      expect(xs(result.points)).toEqual(
        isoStrings(allDays.map(scenario.midnightOf)),
      );
      expect(result.uptimePercent).toBe(100);
    },
  );

  test.each([
    {
      zone: Timezone.EuropeLondon,
      midnightOf: londonMidnight,
    },
    {
      zone: Timezone.AmericaNew_York,
      midnightOf: newYorkMidnight,
    },
  ])(
    "$zone past three months: one point a week, each on a Monday midnight there",
    (scenario: { zone: Timezone; midnightOf: (day: string) => Date }) => {
      // 90 days ending now: Week buckets, from Monday 10 August to Monday 9 November.
      const mondays: Array<string> = everyNthDay("2026-08-10", "2026-11-09", 7);
      const result: HeartbeatAvailabilityResult = build({
        instants: mondays.map(scenario.midnightOf),
        windowStart: new Date(NOW.getTime() - 90 * DAY),
        timezone: scenario.zone,
      });

      expect(mondays).toHaveLength(14);
      expect(xs(result.points)).toEqual(
        isoStrings(mondays.map(scenario.midnightOf)),
      );
      expect(
        result.points.map((point: HeartbeatAvailabilityPoint) => {
          return weekdayAndTimeIn(point.x, scenario.zone);
        }),
      ).toEqual(
        mondays.map(() => {
          return "Mon 00:00";
        }),
      );
      expect(result.uptimePercent).toBe(100);
    },
  );

  test("a London reader's past year: one point a month, each on its 1st", () => {
    // 365 days ending now: Month buckets.
    const firsts: Array<string> = [
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ];
    const result: HeartbeatAvailabilityResult = build({
      instants: firsts.map(londonMidnight),
      windowStart: new Date(NOW.getTime() - 365 * DAY),
      timezone: Timezone.EuropeLondon,
    });

    expect(xs(result.points)).toEqual(isoStrings(firsts.map(londonMidnight)));
    expect(result.uptimePercent).toBe(100);
  });

  test("on 31 October, October is still in progress", () => {
    /*
     * October has 31 days: a host silent in it so far is not down until it
     * ends. A slot 30 days long had closed at the start of the 31st.
     */
    const now: Date = new Date("2026-10-31T12:00:00.000Z");
    const firsts: Array<string> = [
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ];
    const result: HeartbeatAvailabilityResult = build({
      instants: firsts.map(londonMidnight),
      windowStart: new Date(now.getTime() - 365 * DAY),
      windowEnd: now,
      now,
      timezone: Timezone.EuropeLondon,
    });

    expect(downXs(result)).toEqual([]);
    expect(xs(result.points)).toEqual(isoStrings(firsts.map(londonMidnight)));
    expect(result.uptimePercent).toBe(100);
  });

  test("five years of months a host was up in every one: no month is down", () => {
    /*
     * No zone given: the server's UTC months. A fixed 30-day step fell a
     * day behind the 1st every other month, and from the third year on it
     * had fallen half a month behind and put two months' rows in one slot,
     * leaving the next one empty and down.
     */
    const firsts: Array<Date> = [];
    for (let year: number = 2021; year <= 2026; year++) {
      for (let month: number = 0; month < 12; month++) {
        const first: Date = new Date(Date.UTC(year, month, 1));
        if (first >= new Date("2021-11-01") && first <= NOW) {
          firsts.push(first);
        }
      }
    }

    const result: HeartbeatAvailabilityResult = build({
      instants: firsts,
      windowStart: new Date("2021-11-13T10:30:30.000Z"),
    });

    expect(firsts).toHaveLength(61);
    expect(downXs(result)).toEqual([]);
    expect(xs(result.points)).toEqual(isoStrings(firsts));
    expect(result.uptimePercent).toBe(100);
  });

  test("ten years: one point a year, each on 1 January, leap years and all", () => {
    const januaryFirsts: Array<Date> = [];
    for (let year: number = 2016; year <= 2026; year++) {
      januaryFirsts.push(new Date(Date.UTC(year, 0, 1)));
    }

    const result: HeartbeatAvailabilityResult = build({
      instants: januaryFirsts,
      windowStart: new Date("2016-11-13T10:30:30.000Z"),
    });

    expect(xs(result.points)).toEqual(isoStrings(januaryFirsts));
    expect(result.uptimePercent).toBe(100);
  });

  test("no zone given: UTC days, as the server cuts them for a request that names none", () => {
    const allDays: Array<string> = days("2026-10-14", "2026-11-13");
    const utcMidnights: Array<Date> = allDays.map((day: string) => {
      return midnight(day, 0);
    });
    const result: HeartbeatAvailabilityResult = build({
      instants: utcMidnights,
      windowStart: new Date(NOW.getTime() - 30 * DAY),
    });

    expect(xs(result.points)).toEqual(isoStrings(utcMidnights));
    expect(result.uptimePercent).toBe(100);
  });

  test("a silent window still walks the reader's days", () => {
    // No rows at all: every complete day is down, at its London midnight.
    const result: HeartbeatAvailabilityResult = build({
      instants: [],
      windowStart: new Date(NOW.getTime() - 30 * DAY),
      timezone: Timezone.EuropeLondon,
    });

    // 14 October began before the window did, and 13 November is not over.
    expect(xs(result.points)).toEqual(
      isoStrings(days("2026-10-15", "2026-11-12").map(londonMidnight)),
    );
    expect(result.uptimePercent).toBe(0);
  });

  test("minute buckets are the same in every zone and ignore it", () => {
    const windowStart: Date = new Date(NOW.getTime() - 30 * 60_000);
    const minuteStarts: Array<Date> = [];
    for (let m: number = 0; m <= 30; m++) {
      if (m !== 12 && m !== 13) {
        minuteStarts.push(
          new Date(
            Math.floor(windowStart.getTime() / 60_000) * 60_000 + m * 60_000,
          ),
        );
      }
    }

    const inLondon: HeartbeatAvailabilityResult = build({
      instants: minuteStarts,
      windowStart,
      timezone: Timezone.EuropeLondon,
    });
    const withoutZone: HeartbeatAvailabilityResult = build({
      instants: minuteStarts,
      windowStart,
    });

    expect(inLondon).toEqual(withoutZone);
    expect(downXs(inLondon)).toHaveLength(2);
  });
});
