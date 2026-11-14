import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil, {
  AggregateWindow,
} from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHICH ZONE AN AGGREGATE ASKS ITS DAYS TO START IN (issue #7277).
 *
 * A chart draws its days, weeks, months and years on the reader's calendar,
 * so the request for them carries the reader's zone, and the server starts
 * each bucket at the reader's midnight. An hour and shorter are the same
 * instants everywhere, and their requests stay exactly as they were. A zone
 * the Timezone list does not name is never sent, since the server refuses
 * it, and a request that names its own zone keeps it.
 *
 * The instants below are the zones' midnights as Python's zoneinfo has them.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const START: Date = new Date("2026-03-01T12:00:00.000Z");

function windowOf(durationMs: number): { startDate: Date; endDate: Date } {
  return {
    startDate: START,
    endDate: new Date(START.getTime() + durationMs),
  };
}

interface Request extends AggregateWindow {
  aggregationType: AggregationType;
  aggregateColumnName: string;
}

function requestOf(durationMs: number): Request {
  return {
    aggregationType: AggregationType.Sum,
    aggregateColumnName: "value",
    startTimestamp: START,
    endTimestamp: new Date(START.getTime() + durationMs),
  };
}

// Every window length that buckets by a day or longer, and the interval it gets.
const CALENDAR_WINDOWS: Array<{
  durationMs: number;
  interval: AggregationInterval;
}> = [
  { durationMs: 7 * DAY + 1, interval: AggregationInterval.Day },
  { durationMs: 30 * DAY, interval: AggregationInterval.Day },
  { durationMs: 42 * DAY, interval: AggregationInterval.Day },
  { durationMs: 42 * DAY + 1, interval: AggregationInterval.Week },
  { durationMs: 180 * DAY, interval: AggregationInterval.Week },
  { durationMs: 180 * DAY + 1, interval: AggregationInterval.Month },
  { durationMs: 6 * 365 * DAY, interval: AggregationInterval.Month },
  { durationMs: 6 * 365 * DAY + 1, interval: AggregationInterval.Year },
];

// Every window length that buckets by an hour or less.
const CLOCK_WINDOWS: Array<number> = [
  HOUR,
  3 * HOUR,
  12 * HOUR,
  DAY,
  3 * DAY,
  7 * DAY,
];

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("AggregationIntervalUtil.isCalendarInterval", () => {
  test("a day, a week, a month and a year are units of a calendar; nothing else is", () => {
    const calendar: Array<AggregationInterval> = Object.values(
      AggregationInterval,
    ).filter((interval: AggregationInterval): boolean => {
      return AggregationIntervalUtil.isCalendarInterval(interval);
    });

    expect(calendar.sort()).toEqual(
      [
        AggregationInterval.Day,
        AggregationInterval.Week,
        AggregationInterval.Month,
        AggregationInterval.Year,
      ].sort(),
    );
  });
});

describe("AggregationIntervalUtil.getReaderTimezone", () => {
  test("the windows the window table checks are the intervals they say", () => {
    for (const window of CALENDAR_WINDOWS) {
      expect(
        AggregationIntervalUtil.getAggregationIntervalForWindow(
          windowOf(window.durationMs),
        ),
      ).toBe(window.interval);
    }
  });

  for (const window of CALENDAR_WINDOWS) {
    test(`a window bucketed by ${window.interval} (${window.durationMs} ms) asks for the reader's zone`, () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(
        AggregationIntervalUtil.getReaderTimezone(windowOf(window.durationMs)),
      ).toBe(Timezone.AmericaNew_York);
    });
  }

  test("a window bucketed by an hour or less asks for no zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    for (const durationMs of CLOCK_WINDOWS) {
      expect(
        AggregationIntervalUtil.getReaderTimezone(windowOf(durationMs)),
      ).toBeUndefined();
    }
  });

  test("an interval the request pins decides, not the window", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);

    expect(
      AggregationIntervalUtil.getReaderTimezone({
        ...windowOf(30 * DAY),
        aggregationInterval: AggregationInterval.Hour,
      }),
    ).toBeUndefined();
    expect(
      AggregationIntervalUtil.getReaderTimezone({
        ...windowOf(30 * DAY),
        aggregationInterval: AggregationInterval.Total,
      }),
    ).toBeUndefined();
    expect(
      AggregationIntervalUtil.getReaderTimezone({
        ...windowOf(HOUR),
        aggregationInterval: AggregationInterval.Day,
      }),
    ).toBe(Timezone.AsiaTokyo);
    expect(
      AggregationIntervalUtil.getReaderTimezone({
        ...windowOf(HOUR),
        aggregationInterval: AggregationInterval.Month,
      }),
    ).toBe(Timezone.AsiaTokyo);
  });

  test("the zone the reader picked in User Settings, else the one the browser reports", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
    expect(AggregationIntervalUtil.getReaderTimezone(windowOf(30 * DAY))).toBe(
      Timezone.AsiaKolkata,
    );

    OneUptimeDate.setUserTimezone(null);
    expect(AggregationIntervalUtil.getReaderTimezone(windowOf(30 * DAY))).toBe(
      OneUptimeDate.getCurrentTimezone(),
    );
  });

  test("a legacy name the reader saved is asked for by its current name", () => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeKiev);

    expect(AggregationIntervalUtil.getReaderTimezone(windowOf(30 * DAY))).toBe(
      Timezone.EuropeKyiv,
    );
  });

  test("a zone the Timezone list does not name is never asked for: the server refuses it", () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("Mars/Olympus_Mons" as Timezone);

    expect(
      AggregationIntervalUtil.getReaderTimezone(windowOf(30 * DAY)),
    ).toBeUndefined();
  });
});

describe("AggregationIntervalUtil.withReaderTimezone", () => {
  test("a request of days gets the reader's zone, on a copy: the request given is left as it is", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const request: Request = requestOf(30 * DAY);
    const sent: Request = AggregationIntervalUtil.withReaderTimezone(request);

    expect(sent).not.toBe(request);
    expect(sent).toEqual({ ...request, timezone: Timezone.AmericaNew_York });
    expect("timezone" in request).toBe(false);
  });

  test("a request of weeks, months and years gets it too", () => {
    OneUptimeDate.setUserTimezone(Timezone.AustraliaLord_Howe);

    for (const durationMs of [100 * DAY, 400 * DAY, 10 * 365 * DAY]) {
      expect(
        AggregationIntervalUtil.withReaderTimezone(requestOf(durationMs))
          .timezone,
      ).toBe(Timezone.AustraliaLord_Howe);
    }
  });

  test("a request of hours or less is handed back as it is, with no zone on it", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    for (const durationMs of CLOCK_WINDOWS) {
      const request: Request = requestOf(durationMs);
      const sent: Request = AggregationIntervalUtil.withReaderTimezone(request);

      expect(sent).toBe(request);
      expect("timezone" in sent).toBe(false);
    }
  });

  test("a request that names its zone keeps it, UTC included", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    for (const timezone of [Timezone.UTC, Timezone.AsiaTokyo]) {
      const request: Request = { ...requestOf(30 * DAY), timezone: timezone };

      expect(AggregationIntervalUtil.withReaderTimezone(request)).toBe(request);
    }
  });

  test("the interval a request pins decides", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const pinnedToHours: Request = {
      ...requestOf(30 * DAY),
      aggregationInterval: AggregationInterval.Hour,
    };
    const pinnedToDays: Request = {
      ...requestOf(2 * HOUR),
      aggregationInterval: AggregationInterval.Day,
    };

    expect(AggregationIntervalUtil.withReaderTimezone(pinnedToHours)).toBe(
      pinnedToHours,
    );
    expect(
      AggregationIntervalUtil.withReaderTimezone(pinnedToDays).timezone,
    ).toBe(Timezone.AmericaNew_York);
  });

  test("a request with no window to read an interval from goes as it is", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const noWindow: Request = {
      aggregationType: AggregationType.Count,
      aggregateColumnName: "value",
    };

    expect(AggregationIntervalUtil.withReaderTimezone(noWindow)).toBe(noWindow);
    expect(
      AggregationIntervalUtil.withReaderTimezone(
        undefined as unknown as Request,
      ),
    ).toBeUndefined();
  });

  test("no zone is added when the reader's is not one the list names", () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("Mars/Olympus_Mons" as Timezone);

    const request: Request = requestOf(30 * DAY);

    expect(AggregationIntervalUtil.withReaderTimezone(request)).toBe(request);
  });
});

describe("AggregationIntervalUtil.floorDateToIntervalGrid in a zone", () => {
  const floorOf: (
    instant: string,
    interval: AggregationInterval,
    timezone?: Timezone,
  ) => string = (
    instant: string,
    interval: AggregationInterval,
    timezone?: Timezone,
  ): string => {
    return AggregationIntervalUtil.floorDateToIntervalGrid(
      new Date(instant),
      interval,
      timezone,
    ).toISOString();
  };

  test("a day floors to the zone's midnight, where the server starts it", () => {
    // 23:30 on 9 March in New York.
    expect(
      floorOf(
        "2026-03-10T03:30:00.000Z",
        AggregationInterval.Day,
        Timezone.AmericaNew_York,
      ),
    ).toBe("2026-03-09T04:00:00.000Z");
    // With no zone, to UTC's midnight, as before.
    expect(floorOf("2026-03-10T03:30:00.000Z", AggregationInterval.Day)).toBe(
      "2026-03-10T00:00:00.000Z",
    );
  });

  test("on the days the clocks change, to that day's own midnight", () => {
    // Noon on 8 March, the clocks gone forward at 02:00.
    expect(
      floorOf(
        "2026-03-08T16:00:00.000Z",
        AggregationInterval.Day,
        Timezone.AmericaNew_York,
      ),
    ).toBe("2026-03-08T05:00:00.000Z");
    // 23:00 on 1 November, the clocks gone back at 02:00.
    expect(
      floorOf(
        "2026-11-02T04:00:00.000Z",
        AggregationInterval.Day,
        Timezone.AmericaNew_York,
      ),
    ).toBe("2026-11-01T04:00:00.000Z");
    // Santiago skips its midnight on 6 September: the day starts at 01:00.
    expect(
      floorOf(
        "2026-09-06T15:00:00.000Z",
        AggregationInterval.Day,
        Timezone.AmericaSantiago,
      ),
    ).toBe("2026-09-06T04:00:00.000Z");
  });

  test("a zone half an hour off UTC, and one ahead of it", () => {
    expect(
      floorOf(
        "2026-03-06T10:00:00.000Z",
        AggregationInterval.Day,
        Timezone.AsiaKolkata,
      ),
    ).toBe("2026-03-05T18:30:00.000Z");
    expect(
      floorOf(
        "2026-03-06T10:00:00.000Z",
        AggregationInterval.Day,
        Timezone.AsiaTokyo,
      ),
    ).toBe("2026-03-05T15:00:00.000Z");
  });

  test("an hour and less ignore the zone: their grid is the same everywhere", () => {
    for (const interval of [
      AggregationInterval.Minute,
      AggregationInterval.FiveMinutes,
      AggregationInterval.FifteenMinutes,
      AggregationInterval.ThirtyMinutes,
      AggregationInterval.Hour,
    ]) {
      expect(
        floorOf("2026-03-06T10:47:13.000Z", interval, Timezone.AsiaKolkata),
      ).toBe(floorOf("2026-03-06T10:47:13.000Z", interval));
    }
  });

  test("a week, a month and a year are left as they are, zone or none", () => {
    for (const interval of [
      AggregationInterval.Week,
      AggregationInterval.Month,
      AggregationInterval.Year,
    ]) {
      expect(
        floorOf("2026-03-06T10:47:13.000Z", interval, Timezone.AsiaKolkata),
      ).toBe("2026-03-06T10:47:13.000Z");
    }
  });
});

describe("AggregationIntervalUtil.getIntervalAlignedWindow in a zone", () => {
  const MONTH: { startDate: Date; endDate: Date } = {
    startDate: new Date("2026-02-10T15:00:00.000Z"),
    endDate: new Date("2026-03-12T15:00:00.000Z"),
  };

  test("a window of days starts at the zone's midnight; its end and its interval stay", () => {
    const aligned: {
      startDate: Date;
      endDate: Date;
      interval: AggregationInterval;
    } = AggregationIntervalUtil.getIntervalAlignedWindow({
      ...MONTH,
      timezone: Timezone.AmericaNew_York,
    });

    expect(aligned.startDate.toISOString()).toBe("2026-02-10T05:00:00.000Z");
    expect(aligned.endDate.toISOString()).toBe(MONTH.endDate.toISOString());
    expect(aligned.interval).toBe(AggregationInterval.Day);
  });

  test("with no zone, at UTC's midnight, as before", () => {
    expect(
      AggregationIntervalUtil.getIntervalAlignedWindow(
        MONTH,
      ).startDate.toISOString(),
    ).toBe("2026-02-10T00:00:00.000Z");
  });

  test("a window of hours ignores the zone", () => {
    const hours: { startDate: Date; endDate: Date } = {
      startDate: new Date("2026-03-06T10:47:00.000Z"),
      endDate: new Date("2026-03-07T22:00:00.000Z"),
    };

    expect(
      AggregationIntervalUtil.getIntervalAlignedWindow({
        ...hours,
        timezone: Timezone.AsiaKolkata,
      }),
    ).toEqual(AggregationIntervalUtil.getIntervalAlignedWindow(hours));
  });
});
