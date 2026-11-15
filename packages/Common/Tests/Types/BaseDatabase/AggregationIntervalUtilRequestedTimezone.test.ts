import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil, {
  AggregateWindow,
} from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A READER'S ZONE, CARRIED OUTSIDE AnalyticsModelAPI (issues #7922, #7925).
 *
 * The dashboard asks for every chart's day buckets in the reader's zone
 * (withReaderTimezone, issue #7277). Ask AI's charts and the Security
 * overviews' day bars are cut on the server instead, so their requests
 * carry the zone to it: the page reads it with getListedReaderTimezone, the
 * server reads it back with readRequestedTimezone, and a tool puts it on its
 * aggregate with withTimezone, by the same rule withReaderTimezone follows -
 * only days, weeks, months and years take a zone, and only a zone the
 * Timezone list names.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const START: Date = new Date("2026-03-01T12:00:00.000Z");

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

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("AggregationIntervalUtil.readRequestedTimezone", () => {
  test.each([
    Timezone.AmericaNew_York,
    Timezone.EuropeLondon,
    Timezone.AsiaKolkata,
    Timezone.AsiaKathmandu,
    Timezone.AustraliaLord_Howe,
    Timezone.UTC,
  ])("keeps %s, a name the list names", (timezone: Timezone) => {
    expect(AggregationIntervalUtil.readRequestedTimezone(timezone)).toBe(
      timezone,
    );
  });

  test.each([
    [Timezone.AsiaCalcutta, Timezone.AsiaKolkata],
    [Timezone.AsiaKatmandu, Timezone.AsiaKathmandu],
    [Timezone.USPacificNew, Timezone.AmericaLos_Angeles],
    [Timezone.EuropeKiev, Timezone.EuropeKyiv],
    [Timezone.EtcUTC, Timezone.UTC],
    // Listed, but it never observes daylight saving: Panama's clock.
    [Timezone.EST, Timezone.AmericaPanama],
  ])(
    "reads the legacy %s as its current name, %s",
    (legacy: Timezone, current: Timezone) => {
      expect(AggregationIntervalUtil.readRequestedTimezone(legacy)).toBe(
        current,
      );
    },
  );

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty name", ""],
    ["a zone the list does not name", "Mars/Olympus_Mons"],
    ["a name in the wrong case", "america/new_york"],
    ["a name with padding", " America/New_York "],
    ["an offset", "+05:30"],
    ["an abbreviation the list does not name", "PST"],
    ["a number", -300],
    ["a boolean", true],
    ["an object", { name: "America/New_York" }],
    ["a list", ["America/New_York"]],
    ["text written to be SQL", "UTC'), ('x"],
  ] as Array<[string, unknown]>)(
    "drops %s: no zone, never an error",
    (_name: string, value: unknown) => {
      expect(
        AggregationIntervalUtil.readRequestedTimezone(value),
      ).toBeUndefined();
    },
  );

  test("every name the list names is read as a name the list names", () => {
    for (const timezone of Object.values(Timezone)) {
      const read: Timezone | undefined =
        AggregationIntervalUtil.readRequestedTimezone(timezone);

      expect(read).toBeDefined();
      expect(TimezoneAlias.isListedName(read)).toBe(true);
    }
  });
});

describe("AggregationIntervalUtil.getTimezoneForWindow", () => {
  test.each([
    [7 * DAY + 1, AggregationInterval.Day],
    [42 * DAY + 1, AggregationInterval.Week],
    [180 * DAY + 1, AggregationInterval.Month],
    [6 * 365 * DAY + 1, AggregationInterval.Year],
  ])(
    "a window of %s ms, bucketed by %s, asks for the zone it is given",
    (durationMs: number, interval: AggregationInterval) => {
      expect(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: START,
          endDate: new Date(START.getTime() + durationMs),
        }),
      ).toBe(interval);
      expect(
        AggregationIntervalUtil.getTimezoneForWindow({
          startDate: START,
          endDate: new Date(START.getTime() + durationMs),
          timezone: Timezone.AsiaKathmandu,
        }),
      ).toBe(Timezone.AsiaKathmandu);
    },
  );

  test.each([HOUR, 3 * HOUR, 12 * HOUR, DAY, 3 * DAY, 7 * DAY])(
    "a window of %s ms is hours or shorter: no zone",
    (durationMs: number) => {
      expect(
        AggregationIntervalUtil.getTimezoneForWindow({
          startDate: START,
          endDate: new Date(START.getTime() + durationMs),
          timezone: Timezone.AmericaNew_York,
        }),
      ).toBeUndefined();
    },
  );

  test("the interval a request pins decides, not the window", () => {
    expect(
      AggregationIntervalUtil.getTimezoneForWindow({
        startDate: START,
        endDate: new Date(START.getTime() + HOUR),
        aggregationInterval: AggregationInterval.Day,
        timezone: Timezone.AmericaNew_York,
      }),
    ).toBe(Timezone.AmericaNew_York);
    expect(
      AggregationIntervalUtil.getTimezoneForWindow({
        startDate: START,
        endDate: new Date(START.getTime() + 30 * DAY),
        aggregationInterval: AggregationInterval.Total,
        timezone: Timezone.AmericaNew_York,
      }),
    ).toBeUndefined();
    expect(
      AggregationIntervalUtil.getTimezoneForWindow({
        startDate: START,
        endDate: new Date(START.getTime() + 30 * DAY),
        aggregationInterval: AggregationInterval.Hour,
        timezone: Timezone.AmericaNew_York,
      }),
    ).toBeUndefined();
  });

  test("no zone, or one the list does not name, is no zone", () => {
    expect(
      AggregationIntervalUtil.getTimezoneForWindow({
        startDate: START,
        endDate: new Date(START.getTime() + 30 * DAY),
        timezone: undefined,
      }),
    ).toBeUndefined();
    expect(
      AggregationIntervalUtil.getTimezoneForWindow({
        startDate: START,
        endDate: new Date(START.getTime() + 30 * DAY),
        timezone: "Mars/Olympus_Mons" as Timezone,
      }),
    ).toBeUndefined();
  });
});

describe("AggregationIntervalUtil.withTimezone", () => {
  test("a request of days gets the zone, on a copy: the one given is left as it is", () => {
    const request: Request = requestOf(30 * DAY);
    const zoned: Request = AggregationIntervalUtil.withTimezone(
      request,
      Timezone.AmericaNew_York,
    );

    expect(zoned).not.toBe(request);
    expect(zoned).toEqual({ ...request, timezone: Timezone.AmericaNew_York });
    expect(request.timezone).toBeUndefined();
  });

  test("weeks, months and years too", () => {
    for (const durationMs of [60 * DAY, 300 * DAY, 7 * 365 * DAY]) {
      expect(
        AggregationIntervalUtil.withTimezone(
          requestOf(durationMs),
          Timezone.AsiaKolkata,
        ).timezone,
      ).toBe(Timezone.AsiaKolkata);
    }
  });

  test("hours or less: the very request given, no zone on it", () => {
    for (const durationMs of [HOUR, DAY, 7 * DAY]) {
      const request: Request = requestOf(durationMs);

      expect(
        AggregationIntervalUtil.withTimezone(request, Timezone.AsiaKolkata),
      ).toBe(request);
    }
  });

  test("a request that names its zone keeps it", () => {
    const request: Request = {
      ...requestOf(30 * DAY),
      timezone: Timezone.UTC,
    };

    expect(
      AggregationIntervalUtil.withTimezone(request, Timezone.AmericaNew_York),
    ).toBe(request);
  });

  test("no zone to add, or one the list does not name: the request as it is", () => {
    const request: Request = requestOf(30 * DAY);

    expect(AggregationIntervalUtil.withTimezone(request, undefined)).toBe(
      request,
    );
    expect(
      AggregationIntervalUtil.withTimezone(
        request,
        "Mars/Olympus_Mons" as Timezone,
      ),
    ).toBe(request);
  });

  test("a request with no window to read an interval from goes as it is", () => {
    const request: Request = {
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
    };

    expect(
      AggregationIntervalUtil.withTimezone(request, Timezone.AmericaNew_York),
    ).toBe(request);
  });

  test("withReaderTimezone is withTimezone with the reader's zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);

    for (const durationMs of [HOUR, 7 * DAY, 30 * DAY, 300 * DAY]) {
      expect(
        AggregationIntervalUtil.withReaderTimezone(requestOf(durationMs)),
      ).toEqual(
        AggregationIntervalUtil.withTimezone(
          requestOf(durationMs),
          Timezone.AsiaKathmandu,
        ),
      );
    }
  });
});
