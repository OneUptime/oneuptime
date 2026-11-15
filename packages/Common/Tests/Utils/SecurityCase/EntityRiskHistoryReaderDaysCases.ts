import { getEntityRiskHistoryDays } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskModel";
import { formatDayLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/DayLabels";
import {
  ENTITY_RISK_HISTORY_IN_DAYS,
  ENTITY_RISK_HISTORY_POINT_LIMIT,
  SecurityEntityRiskHistoryDay,
  SecurityEntityRiskHistoryPoint,
} from "../../../Types/SecurityCase/SecurityEntityRisk";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import {
  getRiskHistorySeries,
  readRiskHistory,
  updateRiskHistory,
} from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { DayCount } from "../../../Utils/SecurityCase/SecurityOverviewMetrics";
import { describe, expect, test } from "@jest/globals";

/*
 * ENTITY RISK'S HISTORY BARS ARE THE READER'S DAYS (issue #8207).
 *
 * The entity's page draws its risk over the last 30 days, a bar a day: the
 * score at the end of each day. The Security overview's bars beside it
 * count the reader's days (issue #7925); these were UTC days, the history
 * keeping one score a UTC day, so in New York a score that rose at 20:00 on
 * 4 November showed on the 5 November bar. The history keeps the moments
 * the score changed now, and each reader's days are read off it.
 *
 * Every expectation is worked out here on the platform's own clock (Intl):
 * where each of the reader's days starts and ends, and the last change
 * before its end. The cases run with the process in a zone of its own (the
 * zone docblock of each file that calls this), which must move
 * nothing: the reader's zone is the one they picked.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// The date an instant falls on in `timezone`, as the platform's clock has it.
function platformDay(ms: number, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(ms));
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

interface PlatformDay {
  day: string;
  startMs: number;
  endMs: number;
}

/*
 * The reader's last `count` days, today's the last, found on the
 * platform's clock: each day ends where the next date begins, to the
 * minute (every zone's midnight is on a minute).
 */
function platformLastDays(
  nowMs: number,
  count: number,
  timezone: string,
): Array<PlatformDay> {
  const boundaries: Array<number> = [];
  // Back far enough for `count` days and the start of the first.
  let ms: number = Math.floor(nowMs / HOUR) * HOUR - (count + 2) * DAY;

  while (ms < nowMs + 2 * DAY) {
    if (platformDay(ms, timezone) !== platformDay(ms + HOUR, timezone)) {
      let low: number = ms;
      let high: number = ms + HOUR;

      // The first minute of the new date.
      while (high - low > MINUTE) {
        const middle: number =
          low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;

        if (platformDay(middle, timezone) === platformDay(ms, timezone)) {
          low = middle;
        } else {
          high = middle;
        }
      }

      boundaries.push(high);
    }

    ms += HOUR;
  }

  const days: Array<PlatformDay> = [];

  for (let index: number = 0; index + 1 < boundaries.length; index++) {
    days.push({
      day: platformDay(boundaries[index]!, timezone),
      startMs: boundaries[index]!,
      endMs: boundaries[index + 1]!,
    });
  }

  const today: number = days.findIndex((day: PlatformDay): boolean => {
    return day.startMs <= nowMs && nowMs < day.endMs;
  });

  return days.slice(today - count + 1, today + 1);
}

interface Change {
  ms: number;
  score: number;
}

// The score at the end of each day: the last change before it ends; 0 before any.
function scoreAtEndOf(
  days: Array<PlatformDay>,
  changes: Array<Change>,
): Array<SecurityEntityRiskHistoryDay> {
  return days.map((day: PlatformDay): SecurityEntityRiskHistoryDay => {
    let score: number = 0;

    for (const change of changes) {
      if (change.ms < day.endMs) {
        score = change.score;
      }
    }

    return { day: day.day, score };
  });
}

// The history the server keeps of `changes`, written one by one as they happen.
function recorded(
  changes: Array<Change>,
): Array<SecurityEntityRiskHistoryPoint> {
  let history: Array<SecurityEntityRiskHistoryPoint> = [];

  for (const change of changes) {
    history = updateRiskHistory(history, change.score, new Date(change.ms));
  }

  return history;
}

/*
 * A score that changes every 7 hours and 13 minutes over five weeks, and
 * on either side of each reader's midnights by a minute: a change in the
 * minute before a midnight is that day's, one at the midnight the next's.
 */
function changesBefore(nowMs: number, readerZone: string): Array<Change> {
  const changes: Array<Change> = [];
  let score: number = 5;

  for (
    let ms: number = nowMs - 35 * DAY;
    ms <= nowMs;
    ms += 7 * HOUR + 13 * MINUTE
  ) {
    score = (score * 7 + 11) % 190;
    changes.push({ ms, score });
  }

  for (const day of platformLastDays(nowMs, 30, readerZone)) {
    if (day.startMs - MINUTE > nowMs - 35 * DAY) {
      changes.push({ ms: day.startMs - MINUTE, score: 191 });
      changes.push({ ms: day.startMs, score: 7 });
    }
  }

  return changes
    .filter((change: Change): boolean => {
      return change.ms <= nowMs;
    })
    .sort((a: Change, b: Change): number => {
      return a.ms - b.ms;
    });
}

const READERS: Array<[string, Timezone]> = [
  ["UTC", Timezone.UTC],
  ["New York, west of UTC", Timezone.AmericaNew_York],
  ["Los Angeles", Timezone.AmericaLos_Angeles],
  ["St John's, half an hour off the hour", Timezone.AmericaSt_Johns],
  ["London", Timezone.EuropeLondon],
  ["Kolkata, half an hour off the hour", Timezone.AsiaKolkata],
  ["Kathmandu, 45 minutes off the hour", Timezone.AsiaKathmandu],
  ["Tokyo, east of UTC", Timezone.AsiaTokyo],
  [
    "Lord Howe Island, half an hour of summer time",
    Timezone.AustraliaLord_Howe,
  ],
  ["Auckland, in the southern hemisphere", Timezone.PacificAuckland],
  [
    "Chatham, 45 minutes off the hour, with summer time",
    Timezone.PacificChatham,
  ],
];

/*
 * Moments the page is read at: after the northern autumn changes (London
 * 25 October, New York 1 November) and the southern spring ones; after the
 * northern spring ones (8 and 29 March) and the southern autumn ones (5
 * April); and around a reader's midnight.
 */
const MOMENTS: Array<string> = [
  "2026-11-15T15:00:00.000Z",
  "2026-04-12T03:30:00.000Z",
  "2026-11-05T00:59:00.000Z",
  "2026-10-10T18:20:00.000Z",
];

export default function describeEntityRiskHistoryReaderDays(
  processZone: string,
): void {
  describe(`with the server and the browser in ${processZone}`, () => {
    test("the process is in that zone", () => {
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(processZone);
    });

    test("the issue's case: a rise at 20:00 in New York on 4 November is on the 4 November bar there, and on the 5th in UTC", () => {
      const now: Date = new Date("2026-11-10T15:00:00.000Z");
      // 20:00 EST on the 4th is 01:00 UTC on the 5th.
      const history: Array<SecurityEntityRiskHistoryPoint> = recorded([
        { ms: Date.parse("2026-11-01T12:00:00.000Z"), score: 40 },
        { ms: Date.parse("2026-11-05T01:00:00.000Z"), score: 120 },
      ]);
      const inNewYork: Array<SecurityEntityRiskHistoryDay> =
        getRiskHistorySeries({
          history,
          now,
          days: 7,
          timezone: Timezone.AmericaNew_York,
        });
      const inUtc: Array<SecurityEntityRiskHistoryDay> = getRiskHistorySeries({
        history,
        now,
        days: 7,
      });

      expect(inNewYork).toEqual([
        { day: "2026-11-04", score: 120 },
        { day: "2026-11-05", score: 120 },
        { day: "2026-11-06", score: 120 },
        { day: "2026-11-07", score: 120 },
        { day: "2026-11-08", score: 120 },
        { day: "2026-11-09", score: 120 },
        { day: "2026-11-10", score: 120 },
      ]);
      expect(
        getRiskHistorySeries({
          history,
          now,
          days: 8,
          timezone: Timezone.AmericaNew_York,
        })[0],
      ).toEqual({ day: "2026-11-03", score: 40 });
      expect(inUtc[0]).toEqual({ day: "2026-11-04", score: 40 });
      expect(inUtc[1]).toEqual({ day: "2026-11-05", score: 120 });

      // Kept a point a UTC day, as it was, New York's 4th read 40.
      const asItWas: Array<SecurityEntityRiskHistoryDay> = getRiskHistorySeries(
        {
          history: [
            { day: "2026-11-01", score: 40 },
            { day: "2026-11-05", score: 120 },
          ],
          now,
          days: 7,
          timezone: Timezone.AmericaNew_York,
        },
      );

      expect(asItWas[0]).toEqual({ day: "2026-11-04", score: 40 });
    });

    describe.each(READERS)("read in %s", (_name: string, zone: Timezone) => {
      test.each(MOMENTS)(
        "at %s: 30 bars, one for each of the reader's days, each the score at the end of its day",
        (iso: string) => {
          const nowMs: number = Date.parse(iso);
          const changes: Array<Change> = changesBefore(nowMs, zone);
          const days: Array<PlatformDay> = platformLastDays(nowMs, 30, zone);
          const series: Array<SecurityEntityRiskHistoryDay> =
            getRiskHistorySeries({
              history: recorded(changes),
              now: new Date(nowMs),
              days: 30,
              timezone: zone,
            });

          expect(days).toHaveLength(30);
          expect(series).toEqual(scoreAtEndOf(days, changes));
          // Today's is the score now.
          expect(series[29]!.score).toBe(changes[changes.length - 1]!.score);
        },
      );
    });

    test("a day the clocks change on is one bar, of 23 or 25 hours, in each direction", () => {
      for (const [iso, zone, from, to] of [
        [
          "2026-11-03T15:00:00.000Z",
          Timezone.AmericaNew_York,
          "2026-10-31",
          "2026-11-02",
        ],
        [
          "2026-03-10T15:00:00.000Z",
          Timezone.AmericaNew_York,
          "2026-03-07",
          "2026-03-09",
        ],
        [
          "2026-04-07T03:00:00.000Z",
          Timezone.AustraliaLord_Howe,
          "2026-04-04",
          "2026-04-06",
        ],
        [
          "2026-09-29T03:00:00.000Z",
          Timezone.PacificChatham,
          "2026-09-26",
          "2026-09-28",
        ],
      ] as Array<[string, Timezone, string, string]>) {
        const series: Array<SecurityEntityRiskHistoryDay> =
          getRiskHistorySeries({
            history: [],
            now: new Date(iso),
            days: 5,
            timezone: zone,
          });
        const dates: Array<string> = series.map(
          (day: SecurityEntityRiskHistoryDay): string => {
            return day.day;
          },
        );

        expect(new Set(dates).size).toBe(5);
        expect(dates).toContain(from);
        expect(dates).toContain(to);
        expect(dates[4]).toBe(platformDay(Date.parse(iso), zone));
      }
    });

    test("a legacy name reads the days of the zone it stands for", () => {
      const now: Date = new Date("2026-11-10T15:00:00.000Z");
      const history: Array<SecurityEntityRiskHistoryPoint> = recorded([
        { ms: Date.parse("2026-11-05T04:30:00.000Z"), score: 60 },
      ]);

      expect(
        getRiskHistorySeries({
          history,
          now,
          days: 10,
          timezone: "Asia/Calcutta" as Timezone,
        }),
      ).toEqual(
        getRiskHistorySeries({
          history,
          now,
          days: 10,
          timezone: Timezone.AsiaKolkata,
        }),
      );
    });

    describe("a row written before, a point a UTC day", () => {
      const ROW: Array<{ day: string; score: number }> = [
        { day: "2026-11-08", score: 30 },
        { day: "2026-11-09", score: 55 },
        // Today's, written at 09:00 UTC; it is 15:00 UTC now.
        { day: "2026-11-10", score: 80 },
      ];
      const NOW: Date = new Date("2026-11-10T15:00:00.000Z");

      test("each day reads as the score at the end of its UTC day; today's, written today, is now's", () => {
        expect(
          getRiskHistorySeries({ history: ROW, now: NOW, days: 4 }),
        ).toEqual([
          { day: "2026-11-07", score: 0 },
          { day: "2026-11-08", score: 30 },
          { day: "2026-11-09", score: 55 },
          { day: "2026-11-10", score: 80 },
        ]);

        // East of UTC today is the 11th already: today's score is still 80.
        expect(
          getRiskHistorySeries({
            history: ROW,
            now: new Date("2026-11-10T23:30:00.000Z"),
            days: 2,
            timezone: Timezone.AsiaTokyo,
          }),
        ).toEqual([
          { day: "2026-11-10", score: 55 },
          { day: "2026-11-11", score: 80 },
        ]);
      });

      test("the next change keeps the days written before and takes over from now", () => {
        const history: Array<SecurityEntityRiskHistoryPoint> =
          updateRiskHistory(ROW, 95, NOW);

        expect(history).toEqual([
          { at: "2026-11-08T23:59:59.999Z", score: 30 },
          { at: "2026-11-09T23:59:59.999Z", score: 55 },
          // Today's day, read as now, gives way to the change now.
          { at: NOW.toISOString(), score: 95 },
        ]);
        expect(getRiskHistorySeries({ history, now: NOW, days: 1 })[0]).toEqual(
          { day: "2026-11-10", score: 95 },
        );
      });

      test("the same score now as today's day adds nothing new", () => {
        expect(updateRiskHistory(ROW, 80, NOW)).toEqual([
          { at: "2026-11-08T23:59:59.999Z", score: 30 },
          { at: "2026-11-09T23:59:59.999Z", score: 55 },
          { at: NOW.toISOString(), score: 80 },
        ]);
      });
    });

    describe("what the history keeps", () => {
      const NOW: Date = new Date("2026-11-15T15:00:00.000Z");

      test("the month, and the change before it, which the month's first day carries", () => {
        const history: Array<SecurityEntityRiskHistoryPoint> = recorded([
          { ms: NOW.getTime() - 60 * DAY, score: 10 },
          { ms: NOW.getTime() - 45 * DAY, score: 20 },
          { ms: NOW.getTime() - 10 * DAY, score: 30 },
          { ms: NOW.getTime(), score: 40 },
        ]);

        expect(history).toEqual([
          { at: new Date(NOW.getTime() - 45 * DAY).toISOString(), score: 20 },
          { at: new Date(NOW.getTime() - 10 * DAY).toISOString(), score: 30 },
          { at: NOW.toISOString(), score: 40 },
        ]);

        // Every one of the 30 days reads its score: the first carries 20.
        const series: Array<SecurityEntityRiskHistoryDay> =
          getRiskHistorySeries({
            history,
            now: NOW,
            days: ENTITY_RISK_HISTORY_IN_DAYS,
            timezone: Timezone.PacificKiritimati,
          });

        expect(series[0]!.score).toBe(20);
        expect(series[29]!.score).toBe(40);
      });

      test("every zone's midnight is on a quarter hour, so a quarter hour keeps its last change: exact in Kathmandu", () => {
        // Kathmandu's 5 November starts at 18:15 UTC on the 4th.
        const history: Array<SecurityEntityRiskHistoryPoint> = recorded([
          { ms: Date.parse("2026-11-04T18:05:00.000Z"), score: 10 },
          { ms: Date.parse("2026-11-04T18:14:00.000Z"), score: 20 },
          { ms: Date.parse("2026-11-04T18:15:00.000Z"), score: 30 },
          { ms: Date.parse("2026-11-04T18:29:00.000Z"), score: 40 },
        ]);

        expect(history).toEqual([
          { at: "2026-11-04T18:14:00.000Z", score: 20 },
          { at: "2026-11-04T18:29:00.000Z", score: 40 },
        ]);
        expect(
          getRiskHistorySeries({
            history,
            now: new Date("2026-11-05T06:00:00.000Z"),
            days: 2,
            timezone: Timezone.AsiaKathmandu,
          }),
        ).toEqual([
          { day: "2026-11-04", score: 20 },
          { day: "2026-11-05", score: 40 },
        ]);
      });

      test("a score that churns all month keeps one change an hour, bounded", () => {
        const changes: Array<Change> = [];

        for (
          let ms: number = NOW.getTime() - 32 * DAY;
          ms <= NOW.getTime();
          ms += 5 * MINUTE
        ) {
          changes.push({ ms, score: changes.length % 2 === 0 ? 10 : 20 });
        }

        let history: Array<SecurityEntityRiskHistoryPoint> = [];

        // Written in batches, as the recorder writes a row per finding.
        for (const change of changes) {
          history = updateRiskHistory(
            history,
            change.score,
            new Date(change.ms),
          );
        }

        expect(history.length).toBeLessThanOrEqual(
          ENTITY_RISK_HISTORY_POINT_LIMIT,
        );
        expect(history.length).toBeLessThanOrEqual(
          (ENTITY_RISK_HISTORY_IN_DAYS + 1) * 24 + 1,
        );
        // Still in time order, each hour's own.
        for (let index: number = 1; index < history.length; index++) {
          expect(Date.parse(history[index]!.at)).toBeGreaterThan(
            Date.parse(history[index - 1]!.at),
          );
        }
        // And the days still read: today's is the score now.
        expect(
          getRiskHistorySeries({
            history,
            now: NOW,
            days: 30,
            timezone: Timezone.AmericaNew_York,
          })[29]!.score,
        ).toBe(changes[changes.length - 1]!.score);
      });

      test("what it reads back is what it wrote", () => {
        const history: Array<SecurityEntityRiskHistoryPoint> = recorded(
          changesBefore(NOW.getTime(), Timezone.AsiaKathmandu),
        );

        expect(readRiskHistory(history)).toEqual(history);
        expect(readRiskHistory(JSON.parse(JSON.stringify(history)))).toEqual(
          history,
        );
      });
    });

    test("the page's bars: the reader's days, each in its level's colour, labelled by the date it is", () => {
      const now: Date = new Date("2026-11-10T15:00:00.000Z");
      const days: Array<DayCount> = getEntityRiskHistoryDays({
        history: recorded([
          { ms: Date.parse("2026-11-05T01:00:00.000Z"), score: 120 },
        ]),
        threshold: 100,
        now,
        timezone: Timezone.AmericaNew_York,
      });

      expect(days).toHaveLength(30);
      expect(days[29]!.day).toBe("2026-11-10");

      const fourth: DayCount = days.find((day: DayCount): boolean => {
        return day.day === "2026-11-04";
      })!;
      const third: DayCount = days.find((day: DayCount): boolean => {
        return day.day === "2026-11-03";
      })!;

      expect(fourth.total).toBe(120);
      expect(fourth.byKey["High"]).toBe(120);
      expect(third.total).toBe(0);
      // A bar's label is the date it is, in every zone.
      expect(formatDayLabel(fourth.day)).toBe("Nov 4");
    });
  });
}
