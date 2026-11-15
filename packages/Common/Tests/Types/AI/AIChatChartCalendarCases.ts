import { AIChatWidgetData } from "../../../Types/AI/AIChatTypes";
import {
  getChartBucketTimezone,
  isDrawnOnAnotherCalendar,
  toReaderCalendarDate,
} from "../../../Types/AI/AIChatChartCalendar";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AN ASK AI CHART'S DAYS ARE DRAWN WHERE THEY WERE CUT (issue #8206).
 *
 * A chart records the zone its day buckets were cut in (AIChatWidgetData
 * .bucketTimezone: AggregationIntervalUtil.getCalendarBucketTimezone of the
 * read), and is drawn with each bucket at the start of the same calendar
 * day on the reader's calendar (AIChatChartCalendar). Where a day starts,
 * and which day an instant is on, are the platform's own (Intl) here, not
 * the code under test's. The process runs in a zone of its own (the
 * zone docblock of each file that calls this): the browser's zone,
 * which is neither the asker's nor the reader's, must move nothing.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

interface WallClock {
  date: string;
  time: string;
}

// The date and time of day `date` reads in `timezone`, on the platform's clock.
function wallClock(date: Date, timezone: string): WallClock {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date);
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/*
 * The first minute of each day in `timezone` from `from` for `count` days,
 * found on the platform's clock: a day bucket's start, as the server cuts
 * it there.
 */
function dayStarts(from: string, count: number, timezone: string): Array<Date> {
  const starts: Array<Date> = [];
  let ms: number = Date.parse(`${from}T12:00:00.000Z`);

  for (let index: number = 0; index < count; index++) {
    const day: string = wallClock(new Date(ms), timezone).date;
    let start: number = Math.floor(ms / MINUTE) * MINUTE;

    while (wallClock(new Date(start - MINUTE), timezone).date === day) {
      start -= MINUTE;
    }

    starts.push(new Date(start));
    ms += DAY;
  }

  return starts;
}

export default function describeAIChatChartCalendar(processZone: string): void {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  describe(`with the browser in ${processZone}`, () => {
    test("the process is in that zone", () => {
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(processZone);
    });

    describe("the zone a chart says its days were cut in", () => {
      test.each<[string, unknown, Timezone | undefined]>([
        ["a listed zone", "America/New_York", Timezone.AmericaNew_York],
        ["UTC", "UTC", Timezone.UTC],
        [
          "a legacy name, in its current name",
          "Asia/Calcutta",
          Timezone.AsiaKolkata,
        ],
        [
          "a removed name, in its current name",
          "US/Pacific-New",
          Timezone.AmericaLos_Angeles,
        ],
        ["a zone the list does not name", "Mars/Olympus_Mons", undefined],
        ["a name in the wrong case", "america/new_york", undefined],
        ["an offset", "+05:30", undefined],
        ["a number", -300, undefined],
        ["null", null, undefined],
        ["nothing: a chart saved before", undefined, undefined],
      ])(
        "%s",
        (_name: string, value: unknown, expected: Timezone | undefined) => {
          expect(
            getChartBucketTimezone({
              bucketTimezone: value,
            } as unknown as AIChatWidgetData),
          ).toBe(expected);
        },
      );

      test("no data at all is no zone", () => {
        expect(getChartBucketTimezone(undefined)).toBeUndefined();
        expect(getChartBucketTimezone({})).toBeUndefined();
      });
    });

    /*
     * Asker, reader: each of the asker's days over both 2026 changes in
     * New York (8 March forward, 1 November back) and London, a half-hour
     * and a 45-minute zone, and UTC's for a run with no reader.
     */
    const PAIRS: Array<[Timezone, Timezone, string]> = [
      [Timezone.AmericaNew_York, Timezone.AmericaLos_Angeles, "2026-10-25"],
      [Timezone.AmericaNew_York, Timezone.AmericaLos_Angeles, "2026-03-01"],
      [Timezone.AmericaNew_York, Timezone.AsiaTokyo, "2026-10-25"],
      [Timezone.UTC, Timezone.AmericaNew_York, "2026-10-25"],
      [Timezone.UTC, Timezone.AmericaNew_York, "2026-03-01"],
      [Timezone.UTC, Timezone.AsiaKathmandu, "2026-10-25"],
      [Timezone.UTC, Timezone.AustraliaLord_Howe, "2026-03-29"],
      [Timezone.UTC, Timezone.AustraliaLord_Howe, "2026-09-30"],
      [Timezone.AsiaKolkata, Timezone.AsiaKathmandu, "2026-10-25"],
      [Timezone.AsiaKathmandu, Timezone.AsiaKolkata, "2026-10-25"],
      [Timezone.EuropeLondon, Timezone.AmericaSt_Johns, "2026-10-20"],
      [Timezone.EuropeLondon, Timezone.AmericaSt_Johns, "2026-03-25"],
      [Timezone.PacificChatham, Timezone.AmericaLos_Angeles, "2026-04-01"],
      [Timezone.PacificChatham, Timezone.AmericaLos_Angeles, "2026-09-24"],
    ];

    test.each(PAIRS)(
      "a day cut in %s and read in %s, from %s for 14 days, is drawn at the start of the same date there",
      (asker: Timezone, reader: Timezone, from: string) => {
        OneUptimeDate.setUserTimezone(reader);

        for (const start of dayStarts(from, 14, asker)) {
          const drawn: Date = toReaderCalendarDate(start, asker);

          // The date it counted, where it was cut...
          expect(wallClock(drawn, reader).date).toBe(
            wallClock(start, asker).date,
          );
          // ...at the start of that day on the reader's calendar.
          expect(wallClock(drawn, reader).time).toBe("00:00");
          expect(
            wallClock(new Date(drawn.getTime() - MINUTE), reader).date,
          ).not.toBe(wallClock(drawn, reader).date);
        }
      },
    );

    test("a chart read where it was cut is drawn exactly where it was", () => {
      for (const zone of [
        Timezone.AmericaNew_York,
        Timezone.AsiaKathmandu,
        Timezone.UTC,
        Timezone.AustraliaLord_Howe,
      ]) {
        OneUptimeDate.setUserTimezone(zone);
        const starts: Array<Date> = dayStarts("2026-10-20", 20, zone);

        for (const start of starts) {
          expect(toReaderCalendarDate(start, zone).getTime()).toBe(
            start.getTime(),
          );
        }

        expect(isDrawnOnAnotherCalendar(starts, zone)).toBe(false);
      }
    });

    test("a chart with no zone is drawn at its instants, and says nothing", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaLos_Angeles);
      const starts: Array<Date> = dayStarts("2026-10-20", 5, Timezone.UTC);

      for (const start of starts) {
        expect(toReaderCalendarDate(start, undefined)).toBe(start);
      }

      expect(isDrawnOnAnotherCalendar(starts, undefined)).toBe(false);
    });

    test("UTC's days read in London: the same in winter, an hour off in summer", () => {
      OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

      expect(
        isDrawnOnAnotherCalendar(
          dayStarts("2026-12-01", 10, Timezone.UTC),
          Timezone.UTC,
        ),
      ).toBe(false);
      expect(
        isDrawnOnAnotherCalendar(
          dayStarts("2026-07-01", 10, Timezone.UTC),
          Timezone.UTC,
        ),
      ).toBe(true);
      // A window over London's 25 October change: some of its days move.
      expect(
        isDrawnOnAnotherCalendar(
          dayStarts("2026-10-20", 10, Timezone.UTC),
          Timezone.UTC,
        ),
      ).toBe(true);
    });

    test("the same date in the reader's zone, never the browser's", () => {
      // A New York day read in Kathmandu: where the browser is moves nothing.
      OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);
      const start: Date = new Date("2026-11-05T05:00:00.000Z");

      expect(
        toReaderCalendarDate(start, Timezone.AmericaNew_York).toISOString(),
      ).toBe("2026-11-04T18:15:00.000Z");
    });
  });

  describe("the zone a read's calendar buckets are cut in", () => {
    const END: Date = new Date("2026-11-15T15:00:00.000Z");

    function window(days: number): { startDate: Date; endDate: Date } {
      return {
        startDate: new Date(END.getTime() - days * DAY),
        endDate: END,
      };
    }

    test.each<
      [
        string,
        number,
        AggregationInterval | undefined,
        Timezone | undefined,
        Timezone | undefined,
      ]
    >([
      [
        "30 days asked in New York",
        30,
        undefined,
        Timezone.AmericaNew_York,
        Timezone.AmericaNew_York,
      ],
      ["30 days with no reader: UTC", 30, undefined, undefined, Timezone.UTC],
      [
        "30 days in a legacy name, its current one",
        30,
        undefined,
        "Asia/Calcutta" as Timezone,
        Timezone.AsiaKolkata,
      ],
      [
        "30 days in a zone the list does not name: UTC",
        30,
        undefined,
        "Mars/Olympus_Mons" as Timezone,
        Timezone.UTC,
      ],
      [
        "a week: hours, no zone",
        7,
        undefined,
        Timezone.AmericaNew_York,
        undefined,
      ],
      ["a day: no zone", 1, undefined, Timezone.AmericaNew_York, undefined],
      [
        "3 days in days, asked for",
        3,
        AggregationInterval.Day,
        Timezone.AsiaKathmandu,
        Timezone.AsiaKathmandu,
      ],
      [
        "30 days in hours, asked for: no zone",
        30,
        AggregationInterval.Hour,
        Timezone.AmericaNew_York,
        undefined,
      ],
      [
        "a year in months",
        365,
        undefined,
        Timezone.EuropeLondon,
        Timezone.EuropeLondon,
      ],
      [
        "the whole window: no zone",
        30,
        AggregationInterval.Total,
        Timezone.AmericaNew_York,
        undefined,
      ],
    ])(
      "%s",
      (
        _name: string,
        days: number,
        interval: AggregationInterval | undefined,
        asked: Timezone | undefined,
        expected: Timezone | undefined,
      ) => {
        expect(
          AggregationIntervalUtil.getCalendarBucketTimezone({
            ...window(days),
            aggregationInterval: interval,
            timezone: asked,
          }),
        ).toBe(expected);
      },
    );

    test("it is the zone the request asks its buckets in, or UTC where it asks none", () => {
      for (const asked of [
        Timezone.AmericaNew_York,
        Timezone.AsiaKathmandu,
        undefined,
      ]) {
        const data: {
          startDate: Date;
          endDate: Date;
          timezone: Timezone | undefined;
        } = { ...window(30), timezone: asked };

        expect(AggregationIntervalUtil.getCalendarBucketTimezone(data)).toBe(
          AggregationIntervalUtil.getTimezoneForWindow(data) || Timezone.UTC,
        );
      }
    });
  });
}
