import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import DataPointUtil from "../../../../UI/Components/Charts/Utils/DataPoint";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * A CHART'S SLOTS ARE THE READER'S DAYS AND HOURS, WHATEVER ZONE THE
 * BROWSER IS IN (issue #7127).
 *
 * A chart names its slots in the timezone the reader configured
 * (OneUptimeDate.getCurrentTimezone()), and used to step from one slot to
 * the next on the browser's clock. When the two zones differ and either
 * changes its clocks inside the window, a step of the browser's day is 23
 * or 25 hours of the reader's: the slots drifted an hour off the reader's
 * midnight, two of them named the same day ("25 Oct" twice, their points
 * on one row), and the window's last day had no slot at all. The hourly
 * tier named the hour a fall-back repeats twice with the same label.
 *
 * These cases run in four files, one for each zone the browser (the
 * process) is in: UTC, London, New York and Auckland, each naming its zone
 * in its first comment, where Jest reads it. Every expectation is the same
 * in all four: the instants are worked out here from the platform's own
 * clock (Intl), not from the code under test, so a case that passes in one
 * file and fails in another is a slot that still follows the browser.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const MONTHS: ReadonlyArray<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// ---- The platform's own clock, which the expectations are worked out on.

interface Reading {
  // "2026-10-25"
  day: string;
  hour: number;
  minute: number;
  second: number;
}

const READING_FORMATS: Map<string, Intl.DateTimeFormat> = new Map();

function readingIn(zone: string, instant: Date): Reading {
  let format: Intl.DateTimeFormat | undefined = READING_FORMATS.get(zone);

  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    READING_FORMATS.set(zone, format);
  }

  const parts: Array<Intl.DateTimeFormatPart> = format.formatToParts(instant);
  const part: (type: Intl.DateTimeFormatPartTypes) => string = (
    type: Intl.DateTimeFormatPartTypes,
  ): string => {
    return (
      parts.find((candidate: Intl.DateTimeFormatPart): boolean => {
        return candidate.type === type;
      })?.value || ""
    );
  };

  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
  };
}

// Minutes the zone's clock is ahead of UTC at `instant`.
function offsetInMinutes(zone: string, instant: Date): number {
  const reading: Reading = readingIn(zone, instant);
  const readingAsUtc: number = Date.parse(
    `${reading.day}T${pad(reading.hour)}:${pad(reading.minute)}:${pad(reading.second)}.000Z`,
  );

  return Math.round(
    (readingAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE,
  );
}

/*
 * The instant the zone's clock reads `time` on `day`: a reading the clock
 * passes once (midnight, in every zone here).
 */
function wallTimeIn(zone: string, day: string, time: string = "00:00"): Date {
  const readingAsUtc: number = Date.parse(`${day}T${time}:00.000Z`);
  let instant: number = readingAsUtc;

  for (let attempt: number = 0; attempt < 3; attempt++) {
    instant = readingAsUtc - offsetInMinutes(zone, new Date(instant)) * MINUTE;
  }

  const reading: Reading = readingIn(zone, new Date(instant));

  if (
    reading.day !== day ||
    `${pad(reading.hour)}:${pad(reading.minute)}` !== time
  ) {
    throw new Error(`${zone}'s clock never reads ${time} on ${day}`);
  }

  return new Date(instant);
}

// The calendar day `days` days after `day`.
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

// "25 Oct", as a chart names a day in English.
function dayLabel(day: string): string {
  return `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

// ---- The zones.

interface ZoneWithClockChanges {
  zone: Timezone;
  // The 2026 day its clocks go back on, and how long that day is.
  fallBackDay: string;
  fallBackDayHours: number;
  // The 2026 day its clocks go forward on, and how long that day is.
  springForwardDay: string;
  springForwardDayHours: number;
}

const LONDON: ZoneWithClockChanges = {
  zone: Timezone.EuropeLondon,
  // 02:00 BST becomes 01:00 GMT, at 01:00 UTC.
  fallBackDay: "2026-10-25",
  fallBackDayHours: 25,
  // 01:00 GMT becomes 02:00 BST, at 01:00 UTC.
  springForwardDay: "2026-03-29",
  springForwardDayHours: 23,
};

const NEW_YORK: ZoneWithClockChanges = {
  zone: Timezone.AmericaNew_York,
  // 02:00 EDT becomes 01:00 EST, at 06:00 UTC.
  fallBackDay: "2026-11-01",
  fallBackDayHours: 25,
  // 02:00 EST becomes 03:00 EDT, at 07:00 UTC.
  springForwardDay: "2026-03-08",
  springForwardDayHours: 23,
};

const AUCKLAND: ZoneWithClockChanges = {
  zone: Timezone.PacificAuckland,
  // 03:00 NZDT becomes 02:00 NZST, at 14:00 UTC the day before.
  fallBackDay: "2026-04-05",
  fallBackDayHours: 25,
  // 02:00 NZST becomes 03:00 NZDT, at 14:00 UTC the day before.
  springForwardDay: "2026-09-27",
  springForwardDayHours: 23,
};

/*
 * Lord Howe Island moves its clocks by half an hour: 02:00 (UTC+11) becomes
 * 01:30 (UTC+10:30) in April, and 02:00 becomes 02:30 in October.
 */
const LORD_HOWE: ZoneWithClockChanges = {
  zone: Timezone.AustraliaLord_Howe,
  fallBackDay: "2026-04-05",
  fallBackDayHours: 24.5,
  springForwardDay: "2026-10-04",
  springForwardDayHours: 23.5,
};

const ZONES_WITH_CLOCK_CHANGES: ReadonlyArray<ZoneWithClockChanges> = [
  LONDON,
  NEW_YORK,
  AUCKLAND,
  LORD_HOWE,
];

/*
 * The days around which a window of days is laid: every zone's two changes
 * of 2026, so a reader in UTC is tested against each browser's too.
 */
const CLOCK_CHANGE_DAYS: ReadonlyArray<string> = ZONES_WITH_CLOCK_CHANGES.map(
  (zone: ZoneWithClockChanges): Array<string> => {
    return [zone.fallBackDay, zone.springForwardDay];
  },
)
  .flat()
  .filter((day: string, index: number, days: Array<string>): boolean => {
    return days.indexOf(day) === index;
  });

// ---- The chart.

interface Window {
  start: Date;
  end: Date;
  precision: XAxisPrecision;
}

interface Slots {
  instants: Array<string>;
  labels: Array<string>;
}

function slotsOf(window: Window): Slots {
  const bounds: {
    xAxisMin: Date;
    xAxisMax: Date;
    precision: XAxisPrecision;
  } = {
    xAxisMin: window.start,
    xAxisMax: window.end,
    precision: window.precision,
  };
  const formatter: (value: Date) => string = XAxisUtil.getFormatter(bounds);
  const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals(bounds);

  return {
    instants: intervals.map((interval: Date): string => {
      return interval.toISOString();
    }),
    labels: intervals.map((interval: Date): string => {
      return spaced(formatter(interval));
    }),
  };
}

function labelOf(window: Window, value: Date): string {
  return spaced(
    XAxisUtil.getFormatter({
      xAxisMin: window.start,
      xAxisMax: window.end,
      precision: window.precision,
    })(value),
  );
}

function expectEveryLabelOnce(labels: Array<string>): void {
  expect(new Set(labels).size).toBe(labels.length);
}

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

// The rows a chart draws, as DataPointUtil lays them out for ChartCard.
function rowsOf(window: Window, series: SeriesPoints): Array<ChartDataPoint> {
  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: window.start,
      max: window.end,
      aggregateType: XAxisAggregateType.Average,
      precision: window.precision,
    },
  };

  return DataPointUtil.getChartDataPoints({
    seriesPoints: [series],
    xAxis: xAxis,
    yAxis: Y_AXIS,
  });
}

/*
 * Points a few minutes apart from the first slot to the last, in order,
 * name exactly the slots, in order: every step of the reader's clock in the
 * window has one slot, no two slots share a step, and no point is left
 * without a slot to go to.
 */
function expectEveryPointOnASlot(window: Window, pointEveryMs: number): void {
  const slots: Slots = slotsOf(window);
  const formatter: (value: Date) => string = XAxisUtil.getFormatter({
    xAxisMin: window.start,
    xAxisMax: window.end,
    precision: window.precision,
  });

  expectEveryLabelOnce(slots.labels);

  const first: number = Date.parse(slots.instants[0]!);
  const last: number = Date.parse(slots.instants[slots.instants.length - 1]!);
  const points: Array<number> = [];

  for (let instant: number = first; instant < last; instant += pointEveryMs) {
    points.push(instant);
  }
  points.push(last);

  const named: Array<string> = [];

  for (const point of points) {
    const label: string = spaced(formatter(new Date(point)));

    if (named[named.length - 1] !== label) {
      named.push(label);
    }
  }

  expect(named).toEqual(slots.labels);
}

/*
 * Points `pointEveryMs` apart from the window's start, and one at the last
 * instant before its end, name exactly the window's slots, in order: every
 * bucket the window reaches into has a slot, the bucket its end is in
 * included however little of it the window holds, and no slot stands for a
 * bucket the window does not reach (issue #7278). A walk that lands on the
 * end itself has a slot there; when the end is where a bucket starts, that
 * bucket holds none of the window, so its slot is left out of the count, as
 * getRenderableIntervals leaves it off the chart when nothing is in it.
 */
function expectTheWholeWindowOnSlots(
  window: Window,
  pointEveryMs: number,
): void {
  const slots: Slots = slotsOf(window);
  const formatter: (value: Date) => string = XAxisUtil.getFormatter({
    xAxisMin: window.start,
    xAxisMax: window.end,
    precision: window.precision,
  });
  const start: number = window.start.getTime();
  const end: number = window.end.getTime();
  const points: Array<number> = [];

  for (let instant: number = start; instant < end; instant += pointEveryMs) {
    points.push(instant);
  }
  points.push(end - 1);

  const named: Array<string> = [];

  for (const point of points) {
    const label: string = spaced(formatter(new Date(point)));

    if (named[named.length - 1] !== label) {
      named.push(label);
    }
  }

  const endsWhereABucketStarts: boolean =
    formatter(new Date(end)) !== formatter(new Date(end - 1));
  const labels: Array<string> =
    endsWhereABucketStarts &&
    slots.instants[slots.instants.length - 1] === window.end.toISOString()
      ? slots.labels.slice(0, -1)
      : slots.labels;
  // Named in the failure, so a seeded window that fails can be read back.
  const asked: string = `${window.precision} from ${window.start.toISOString()} to ${window.end.toISOString()}`;

  expect({ asked, labels: named }).toEqual({ asked, labels: labels });
  expectEveryLabelOnce(slots.labels);

  // The first slot is the start, each slot after the one before, none past the end.
  expect(slots.instants[0]).toBe(window.start.toISOString());
  slots.instants.forEach((instant: string, index: number): void => {
    expect(Date.parse(instant)).toBeLessThanOrEqual(end);

    if (index > 0) {
      expect(Date.parse(instant)).toBeGreaterThan(
        Date.parse(slots.instants[index - 1]!),
      );
    }
  });
}

function pairsOf(slots: Slots): Array<[string, string]> {
  return slots.instants.map(
    (instant: string, index: number): [string, string] => {
      return [instant, slots.labels[index]!];
    },
  );
}

// A row as a reader sees it: its label, its "Requests" value, and where its bucket starts.
interface ReadRow {
  label: string;
  value: unknown;
  start: string;
}

function readRow(row: ChartDataPoint): ReadRow {
  return {
    label: spaced(String(row[CHART_DATA_POINT_X_AXIS_KEY])),
    value: row["Requests"],
    start: new Date(Number(row[CHART_DATA_POINT_DATE_KEY])).toISOString(),
  };
}

// "Requests", one total a bucket, each worth its place: 1, 2, 3 ...
function totalsAt(starts: Array<Date>): SeriesPoints {
  return {
    seriesName: "Requests",
    data: starts.map((start: Date, index: number): { x: Date; y: number } => {
      return { x: start, y: index + 1 };
    }),
  };
}

// ---- The cases.

export default function describeChartSlotsInConfiguredZone(
  processZone: string,
): void {
  describe(`a chart's slots with the browser in ${processZone}`, () => {
    afterEach(() => {
      OneUptimeDate.setUserTimezone(null);
    });

    test(`the file runs in ${processZone}`, () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        processZone,
      );

      /*
       * Date's own clock is the zone's: its offset in January and in July.
       * (Date counts the minutes behind UTC, the zone's clock those ahead.)
       */
      for (const instant of [
        new Date("2026-01-15T12:00:00.000Z"),
        new Date("2026-07-15T12:00:00.000Z"),
      ]) {
        expect(
          instant.getTimezoneOffset() + offsetInMinutes(processZone, instant),
        ).toBe(0);
      }
    });

    describe("a day a slot, over thirty days across a clock change", () => {
      for (const reader of [
        ...ZONES_WITH_CLOCK_CHANGES,
        { zone: Timezone.UTC },
      ]) {
        for (const changeDay of CLOCK_CHANGE_DAYS) {
          const firstDay: string = addDays(changeDay, -13);
          const days: Array<string> = Array.from(
            { length: 30 },
            (_value: unknown, index: number): string => {
              return addDays(firstDay, index);
            },
          );

          test(`read in ${reader.zone}, from midnight on ${firstDay} to midnight on ${days[29]}: a slot at each midnight there, each day once`, () => {
            OneUptimeDate.setUserTimezone(reader.zone);

            const slots: Slots = slotsOf({
              start: wallTimeIn(reader.zone, firstDay),
              end: wallTimeIn(reader.zone, days[29]!),
              precision: XAxisPrecision.EVERY_DAY,
            });

            expect(slots.instants).toEqual(
              days.map((day: string): string => {
                return wallTimeIn(reader.zone, day).toISOString();
              }),
            );
            expect(slots.labels).toEqual(days.map(dayLabel));
          });

          test(`read in ${reader.zone}, the same thirty days from 14:37: one slot a day, each at 14:37 there`, () => {
            OneUptimeDate.setUserTimezone(reader.zone);

            const slots: Slots = slotsOf({
              start: wallTimeIn(reader.zone, firstDay, "14:37"),
              end: wallTimeIn(reader.zone, days[29]!, "14:37"),
              precision: XAxisPrecision.EVERY_DAY,
            });

            expect(slots.instants).toEqual(
              days.map((day: string): string => {
                return wallTimeIn(reader.zone, day, "14:37").toISOString();
              }),
            );
            expect(slots.labels).toEqual(days.map(dayLabel));
          });
        }
      }

      test("read in London, the window of issue #7127: 12 Oct to 10 Nov 2026, one slot a day", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const slots: Slots = slotsOf({
          start: new Date("2026-10-11T23:00:00.000Z"),
          end: new Date("2026-11-10T00:00:00.000Z"),
          precision: XAxisPrecision.EVERY_DAY,
        });

        expect(slots.labels).toHaveLength(30);
        expectEveryLabelOnce(slots.labels);
        expect(slots.labels[0]).toBe("12 Oct");
        expect(slots.labels[13]).toBe("25 Oct");
        expect(slots.labels[14]).toBe("26 Oct");
        expect(slots.labels[29]).toBe("10 Nov");
        // BST's midnight is 23:00 UTC the day before; GMT's is midnight UTC.
        expect(slots.instants[13]).toBe("2026-10-24T23:00:00.000Z");
        expect(slots.instants[14]).toBe("2026-10-26T00:00:00.000Z");
        expect(slots.instants[29]).toBe("2026-11-10T00:00:00.000Z");
      });

      test("read in London, 15 Mar to 13 Apr 2026: the day after the clocks go forward keeps its slot", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const slots: Slots = slotsOf({
          start: new Date("2026-03-15T00:00:00.000Z"),
          end: new Date("2026-04-12T23:00:00.000Z"),
          precision: XAxisPrecision.EVERY_DAY,
        });

        expect(slots.labels).toHaveLength(30);
        expectEveryLabelOnce(slots.labels);
        expect(slots.labels[14]).toBe("29 Mar");
        expect(slots.labels[15]).toBe("30 Mar");
        expect(slots.labels[29]).toBe("13 Apr");
        expect(slots.instants[14]).toBe("2026-03-29T00:00:00.000Z");
        expect(slots.instants[15]).toBe("2026-03-29T23:00:00.000Z");
      });

      for (const reader of ZONES_WITH_CLOCK_CHANGES) {
        for (const change of [
          { day: reader.fallBackDay, hours: reader.fallBackDayHours },
          { day: reader.springForwardDay, hours: reader.springForwardDayHours },
        ]) {
          test(`read in ${reader.zone}, ${change.day} is a slot ${change.hours} hours wide`, () => {
            OneUptimeDate.setUserTimezone(reader.zone);

            const midnight: Date = wallTimeIn(reader.zone, change.day);

            expect(
              (XAxisUtil.getNextInterval(
                midnight,
                XAxisPrecision.EVERY_DAY,
              ).getTime() -
                midnight.getTime()) /
                HOUR,
            ).toBe(change.hours);
            expect(
              XAxisUtil.getBucketStart(
                new Date(midnight.getTime() + 12 * HOUR),
                XAxisPrecision.EVERY_DAY,
              ).toISOString(),
            ).toBe(midnight.toISOString());
          });
        }
      }
    });

    describe("a day a row: each day's point on its own row", () => {
      for (const reader of ZONES_WITH_CLOCK_CHANGES) {
        for (const changeDay of [reader.fallBackDay, reader.springForwardDay]) {
          test(`read in ${reader.zone}, thirty days around ${changeDay}, the last day's point included`, () => {
            OneUptimeDate.setUserTimezone(reader.zone);

            const firstDay: string = addDays(changeDay, -13);
            const days: Array<string> = Array.from(
              { length: 30 },
              (_value: unknown, index: number): string => {
                return addDays(firstDay, index);
              },
            );
            // One point at noon of each day there, worth its day's number.
            const series: SeriesPoints = {
              seriesName: "Daily active users",
              data: days.map(
                (day: string, index: number): { x: Date; y: number } => {
                  return {
                    x: wallTimeIn(reader.zone, day, "12:00"),
                    y: index + 1,
                  };
                },
              ),
            };
            const rows: Array<ChartDataPoint> = rowsOf(
              {
                start: wallTimeIn(reader.zone, firstDay),
                end: wallTimeIn(reader.zone, days[29]!),
                precision: XAxisPrecision.EVERY_DAY,
              },
              series,
            );

            expect(
              rows.map((row: ChartDataPoint): string => {
                return spaced(String(row[CHART_DATA_POINT_X_AXIS_KEY]));
              }),
            ).toEqual(days.map(dayLabel));
            expect(
              rows.map((row: ChartDataPoint): unknown => {
                return row["Daily active users"];
              }),
            ).toEqual(
              days.map((_day: string, index: number): number => {
                return index + 1;
              }),
            );
            // Each row turns back into the midnight it starts at there.
            expect(
              rows.map((row: ChartDataPoint): string => {
                return new Date(
                  Number(row[CHART_DATA_POINT_DATE_KEY]),
                ).toISOString();
              }),
            ).toEqual(
              days.map((day: string): string => {
                return wallTimeIn(reader.zone, day).toISOString();
              }),
            );
          });
        }
      }
    });

    describe("a week and a month a slot", () => {
      test("read in New York, weeks from Sunday midnight across both of its changes: each a Sunday there, named by its week's Monday", () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        const sundays: Array<string> = Array.from(
          { length: 40 },
          (_value: unknown, index: number): string => {
            return addDays("2026-02-01", index * 7);
          },
        );
        const slots: Slots = slotsOf({
          start: wallTimeIn(Timezone.AmericaNew_York, sundays[0]!),
          end: wallTimeIn(Timezone.AmericaNew_York, sundays[39]!),
          precision: XAxisPrecision.EVERY_WEEK,
        });

        expect(slots.instants).toEqual(
          sundays.map((day: string): string => {
            return wallTimeIn(Timezone.AmericaNew_York, day).toISOString();
          }),
        );
        /*
         * A week is named by its Monday, the day the server starts a week
         * bucket on (#7277): a Sunday is the last day of the week that
         * began six days before.
         */
        expect(slots.labels).toEqual(
          sundays.map((day: string): string => {
            return dayLabel(addDays(day, -6));
          }),
        );
      });

      test("read in Auckland, a year of months from 31 January: every month once, each on its last day", () => {
        /*
         * Stepped a month at a time with Date's setter, 31 January became
         * 3 March (31 February rolls over): February had no slot.
         */
        OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

        const lastDays: Array<string> = [
          "2026-01-31",
          "2026-02-28",
          "2026-03-31",
          "2026-04-30",
          "2026-05-31",
          "2026-06-30",
          "2026-07-31",
          "2026-08-31",
          "2026-09-30",
          "2026-10-31",
          "2026-11-30",
          "2026-12-31",
          "2027-01-31",
        ];
        const slots: Slots = slotsOf({
          start: wallTimeIn(Timezone.PacificAuckland, lastDays[0]!),
          end: wallTimeIn(Timezone.PacificAuckland, lastDays[12]!),
          precision: XAxisPrecision.EVERY_MONTH,
        });

        expect(slots.instants).toEqual(
          lastDays.map((day: string): string => {
            return wallTimeIn(Timezone.PacificAuckland, day).toISOString();
          }),
        );
        expect(slots.labels).toEqual([
          "Jan 2026",
          "Feb 2026",
          "Mar 2026",
          "Apr 2026",
          "May 2026",
          "Jun 2026",
          "Jul 2026",
          "Aug 2026",
          "Sep 2026",
          "Oct 2026",
          "Nov 2026",
          "Dec 2026",
          "Jan 2027",
        ]);
      });

      test("read in London, quarters from 1 January: each on the first of its quarter there", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const firsts: Array<string> = [
          "2026-01-01",
          "2026-04-01",
          "2026-07-01",
          "2026-10-01",
          "2027-01-01",
        ];
        const slots: Slots = slotsOf({
          start: wallTimeIn(Timezone.EuropeLondon, firsts[0]!),
          end: wallTimeIn(Timezone.EuropeLondon, firsts[4]!),
          precision: XAxisPrecision.EVERY_THREE_MONTHS,
        });

        expect(slots.instants).toEqual(
          firsts.map((day: string): string => {
            return wallTimeIn(Timezone.EuropeLondon, day).toISOString();
          }),
        );
        expect(slots.labels).toEqual([
          "Jan 2026",
          "Apr 2026",
          "Jul 2026",
          "Oct 2026",
          "Jan 2027",
        ]);
      });

      test("read in Auckland, years from New Year there: each named by its year there", () => {
        // New Year in Auckland is 11:00 UTC on 31 December, a year earlier in UTC.
        OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

        const slots: Slots = slotsOf({
          start: new Date("2020-12-31T11:00:00.000Z"),
          end: new Date("2025-12-31T11:00:00.000Z"),
          precision: XAxisPrecision.EVERY_YEAR,
        });

        expect(slots.instants).toEqual([
          "2020-12-31T11:00:00.000Z",
          "2021-12-31T11:00:00.000Z",
          "2022-12-31T11:00:00.000Z",
          "2023-12-31T11:00:00.000Z",
          "2024-12-31T11:00:00.000Z",
          "2025-12-31T11:00:00.000Z",
        ]);
        expect(slots.labels).toEqual([
          "2021",
          "2022",
          "2023",
          "2024",
          "2025",
          "2026",
        ]);
      });
    });

    describe("an hour a slot, across the clocks going back", () => {
      const cases: Array<{
        zone: Timezone;
        start: string;
        slots: Array<[string, string]>;
      }> = [
        {
          zone: Timezone.EuropeLondon,
          start: "2026-10-24T23:00:00.000Z",
          slots: [
            ["2026-10-24T23:00:00.000Z", "25 Oct, 00:00 BST"],
            ["2026-10-25T00:00:00.000Z", "25 Oct, 01:00 BST"],
            ["2026-10-25T01:00:00.000Z", "25 Oct, 01:00 GMT"],
            ["2026-10-25T02:00:00.000Z", "25 Oct, 02:00 GMT"],
            ["2026-10-25T03:00:00.000Z", "25 Oct, 03:00 GMT"],
            ["2026-10-25T04:00:00.000Z", "25 Oct, 04:00 GMT"],
            ["2026-10-25T05:00:00.000Z", "25 Oct, 05:00 GMT"],
          ],
        },
        {
          zone: Timezone.AmericaNew_York,
          start: "2026-11-01T04:00:00.000Z",
          slots: [
            ["2026-11-01T04:00:00.000Z", "01 Nov, 00:00 EDT"],
            ["2026-11-01T05:00:00.000Z", "01 Nov, 01:00 EDT"],
            ["2026-11-01T06:00:00.000Z", "01 Nov, 01:00 EST"],
            ["2026-11-01T07:00:00.000Z", "01 Nov, 02:00 EST"],
            ["2026-11-01T08:00:00.000Z", "01 Nov, 03:00 EST"],
            ["2026-11-01T09:00:00.000Z", "01 Nov, 04:00 EST"],
            ["2026-11-01T10:00:00.000Z", "01 Nov, 05:00 EST"],
          ],
        },
        {
          zone: Timezone.PacificAuckland,
          start: "2026-04-04T11:00:00.000Z",
          slots: [
            ["2026-04-04T11:00:00.000Z", "05 Apr, 00:00 NZDT"],
            ["2026-04-04T12:00:00.000Z", "05 Apr, 01:00 NZDT"],
            ["2026-04-04T13:00:00.000Z", "05 Apr, 02:00 NZDT"],
            ["2026-04-04T14:00:00.000Z", "05 Apr, 02:00 NZST"],
            ["2026-04-04T15:00:00.000Z", "05 Apr, 03:00 NZST"],
            ["2026-04-04T16:00:00.000Z", "05 Apr, 04:00 NZST"],
            ["2026-04-04T17:00:00.000Z", "05 Apr, 05:00 NZST"],
          ],
        },
      ];

      for (const hours of cases) {
        test(`read in ${hours.zone}: the repeated hour is two slots, each named with its zone`, () => {
          OneUptimeDate.setUserTimezone(hours.zone);

          const start: Date = new Date(hours.start);
          const slots: Slots = slotsOf({
            start: start,
            end: new Date(start.getTime() + 6 * HOUR),
            precision: XAxisPrecision.EVERY_HOUR,
          });

          expect(
            slots.instants.map(
              (instant: string, index: number): [string, string] => {
                return [instant, slots.labels[index]!];
              },
            ),
          ).toEqual(hours.slots);
        });

        test(`read in ${hours.zone}: a point in each hour lands on that hour's own slot`, () => {
          OneUptimeDate.setUserTimezone(hours.zone);

          const start: Date = new Date(hours.start);
          const window: Window = {
            start: start,
            end: new Date(start.getTime() + 6 * HOUR),
            precision: XAxisPrecision.EVERY_HOUR,
          };
          const rows: Array<ChartDataPoint> = rowsOf(window, {
            seriesName: "Requests",
            data: hours.slots.map(
              (
                slot: [string, string],
                index: number,
              ): { x: Date; y: number } => {
                return {
                  x: new Date(Date.parse(slot[0]) + 30 * MINUTE),
                  y: index + 1,
                };
              },
            ),
          });

          expect(
            rows.map((row: ChartDataPoint): [string, unknown] => {
              return [
                spaced(String(row[CHART_DATA_POINT_X_AXIS_KEY])),
                row["Requests"],
              ];
            }),
          ).toEqual(
            hours.slots.map(
              (slot: [string, string], index: number): [string, number] => {
                return [slot[1], index + 1];
              },
            ),
          );
        });
      }

      test("read in London, a point in the second 01:30 starts at 01:00 GMT, a point in the first at 01:00 BST", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-10-25T01:30:00.000Z"),
            XAxisPrecision.EVERY_HOUR,
          ).toISOString(),
        ).toBe("2026-10-25T01:00:00.000Z");
        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-10-25T00:30:00.000Z"),
            XAxisPrecision.EVERY_HOUR,
          ).toISOString(),
        ).toBe("2026-10-25T00:00:00.000Z");
      });
    });

    describe("an hour a slot, across the clocks going forward", () => {
      const cases: Array<{
        zone: Timezone;
        start: string;
        slots: Array<[string, string]>;
      }> = [
        {
          zone: Timezone.EuropeLondon,
          start: "2026-03-29T00:00:00.000Z",
          slots: [
            ["2026-03-29T00:00:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T01:00:00.000Z", "29 Mar, 02:00"],
            ["2026-03-29T02:00:00.000Z", "29 Mar, 03:00"],
            ["2026-03-29T03:00:00.000Z", "29 Mar, 04:00"],
            ["2026-03-29T04:00:00.000Z", "29 Mar, 05:00"],
            ["2026-03-29T05:00:00.000Z", "29 Mar, 06:00"],
          ],
        },
        {
          zone: Timezone.AmericaNew_York,
          start: "2026-03-08T05:00:00.000Z",
          slots: [
            ["2026-03-08T05:00:00.000Z", "08 Mar, 00:00"],
            ["2026-03-08T06:00:00.000Z", "08 Mar, 01:00"],
            ["2026-03-08T07:00:00.000Z", "08 Mar, 03:00"],
            ["2026-03-08T08:00:00.000Z", "08 Mar, 04:00"],
            ["2026-03-08T09:00:00.000Z", "08 Mar, 05:00"],
            ["2026-03-08T10:00:00.000Z", "08 Mar, 06:00"],
          ],
        },
        {
          zone: Timezone.PacificAuckland,
          start: "2026-09-26T12:00:00.000Z",
          slots: [
            ["2026-09-26T12:00:00.000Z", "27 Sep, 00:00"],
            ["2026-09-26T13:00:00.000Z", "27 Sep, 01:00"],
            ["2026-09-26T14:00:00.000Z", "27 Sep, 03:00"],
            ["2026-09-26T15:00:00.000Z", "27 Sep, 04:00"],
            ["2026-09-26T16:00:00.000Z", "27 Sep, 05:00"],
            ["2026-09-26T17:00:00.000Z", "27 Sep, 06:00"],
          ],
        },
      ];

      for (const hours of cases) {
        test(`read in ${hours.zone}: the skipped hour has no slot, and every other hour one`, () => {
          OneUptimeDate.setUserTimezone(hours.zone);

          const start: Date = new Date(hours.start);
          const slots: Slots = slotsOf({
            start: start,
            end: new Date(start.getTime() + 5 * HOUR),
            precision: XAxisPrecision.EVERY_HOUR,
          });

          expect(
            slots.instants.map(
              (instant: string, index: number): [string, string] => {
                return [instant, slots.labels[index]!];
              },
            ),
          ).toEqual(hours.slots);
        });
      }
    });

    describe("steps of minutes across the clocks going back", () => {
      test("read in New York, fifteen minutes a slot over four hours: the repeated hour twice, in order", () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        const start: Date = new Date("2026-11-01T04:00:00.000Z");
        const slots: Slots = slotsOf({
          start: start,
          end: new Date(start.getTime() + 4 * HOUR),
          precision: XAxisPrecision.EVERY_FIFTEEN_MINUTES,
        });

        expect(slots.instants).toHaveLength(17);
        slots.instants.forEach((instant: string, index: number): void => {
          expect(Date.parse(instant) - start.getTime()).toBe(
            index * 15 * MINUTE,
          );
        });
        expectEveryLabelOnce(slots.labels);
        expect(slots.labels.slice(4, 10)).toEqual([
          "01 Nov, 01:00 EDT",
          "01 Nov, 01:15 EDT",
          "01 Nov, 01:30 EDT",
          "01 Nov, 01:45 EDT",
          "01 Nov, 01:00 EST",
          "01 Nov, 01:15 EST",
        ]);
      });

      test("read in Auckland, five minutes a slot: a point in the second 02:32 is filed under 02:30 NZST", () => {
        OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

        const window: Window = {
          start: new Date("2026-04-04T12:00:00.000Z"),
          end: new Date("2026-04-04T16:00:00.000Z"),
          precision: XAxisPrecision.EVERY_FIVE_MINUTES,
        };

        expect(labelOf(window, new Date("2026-04-04T13:32:10.000Z"))).toBe(
          "05 Apr, 02:30 NZDT",
        );
        expect(labelOf(window, new Date("2026-04-04T14:32:10.000Z"))).toBe(
          "05 Apr, 02:30 NZST",
        );
        expect(slotsOf(window).instants).toHaveLength(49);
      });
    });

    describe("blocks of hours", () => {
      const cases: Array<{
        name: string;
        zone: Timezone;
        precision: XAxisPrecision;
        start: string;
        end: string;
        slots: Array<[string, string]>;
      }> = [
        {
          name: "London, two hours, the clocks going back: the block they go back in is three hours",
          zone: Timezone.EuropeLondon,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-10-24T23:00:00.000Z",
          end: "2026-10-25T08:00:00.000Z",
          slots: [
            ["2026-10-24T23:00:00.000Z", "25 Oct, 00:00"],
            ["2026-10-25T02:00:00.000Z", "25 Oct, 02:00"],
            ["2026-10-25T04:00:00.000Z", "25 Oct, 04:00"],
            ["2026-10-25T06:00:00.000Z", "25 Oct, 06:00"],
            ["2026-10-25T08:00:00.000Z", "25 Oct, 08:00"],
          ],
        },
        {
          name: "London, two hours, the clocks going forward: the block they go forward in is one hour",
          zone: Timezone.EuropeLondon,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-29T00:00:00.000Z",
          end: "2026-03-29T07:00:00.000Z",
          slots: [
            ["2026-03-29T00:00:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T01:00:00.000Z", "29 Mar, 02:00"],
            ["2026-03-29T03:00:00.000Z", "29 Mar, 04:00"],
            ["2026-03-29T05:00:00.000Z", "29 Mar, 06:00"],
            ["2026-03-29T07:00:00.000Z", "29 Mar, 08:00"],
          ],
        },
        {
          /*
           * From 21:37 the walk steps onto 01:37, which the clocks skip. Its
           * block from 00:00 still has the hour before the gap, and the slot
           * stands there at 00:37, the walk's minutes past the hour kept.
           *
           * The window ends at 06:37 BST, in the block from 06:00, which the
           * walk would have reached at 07:37: an hour of the window went
           * with the clocks, so it ends earlier in its block than it
           * starts. That block has its slot at its start (#7278).
           */
          name: "London, two hours from 21:37, the clocks going forward: 01:37 never comes, so its slot is at 00:37, in the same block",
          zone: Timezone.EuropeLondon,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-28T21:37:00.000Z",
          end: "2026-03-29T05:37:00.000Z",
          slots: [
            ["2026-03-28T21:37:00.000Z", "28 Mar, 20:00"],
            ["2026-03-28T23:37:00.000Z", "28 Mar, 22:00"],
            ["2026-03-29T00:37:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T02:37:00.000Z", "29 Mar, 02:00"],
            ["2026-03-29T04:37:00.000Z", "29 Mar, 04:00"],
            ["2026-03-29T05:00:00.000Z", "29 Mar, 06:00"],
          ],
        },
        {
          name: "New York, two hours, the clocks going back",
          zone: Timezone.AmericaNew_York,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-11-01T04:00:00.000Z",
          end: "2026-11-01T13:00:00.000Z",
          slots: [
            ["2026-11-01T04:00:00.000Z", "01 Nov, 00:00"],
            ["2026-11-01T07:00:00.000Z", "01 Nov, 02:00"],
            ["2026-11-01T09:00:00.000Z", "01 Nov, 04:00"],
            ["2026-11-01T11:00:00.000Z", "01 Nov, 06:00"],
            ["2026-11-01T13:00:00.000Z", "01 Nov, 08:00"],
          ],
        },
        {
          name: "New York, two hours, the clocks going forward: 02:00 never comes, so its block starts at 03:00",
          zone: Timezone.AmericaNew_York,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-08T05:00:00.000Z",
          end: "2026-03-08T12:00:00.000Z",
          slots: [
            ["2026-03-08T05:00:00.000Z", "08 Mar, 00:00"],
            ["2026-03-08T07:00:00.000Z", "08 Mar, 03:00"],
            ["2026-03-08T08:00:00.000Z", "08 Mar, 04:00"],
            ["2026-03-08T10:00:00.000Z", "08 Mar, 06:00"],
            ["2026-03-08T12:00:00.000Z", "08 Mar, 08:00"],
          ],
        },
        {
          /*
           * From 22:37 the walk steps onto 02:37, which the clocks skip. The
           * block's slot stands where the clock resumes, at 03:00, rather
           * than at 03:37: a window that ends at 03:10 still has a slot for
           * its last ten minutes.
           */
          name: "New York, two hours from 22:37 to 03:10 across the clocks going forward: the block from 02:00 has its slot at 03:00",
          zone: Timezone.AmericaNew_York,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-08T03:37:00.000Z",
          end: "2026-03-08T07:10:00.000Z",
          slots: [
            ["2026-03-08T03:37:00.000Z", "07 Mar, 22:00"],
            ["2026-03-08T05:37:00.000Z", "08 Mar, 00:00"],
            ["2026-03-08T07:00:00.000Z", "08 Mar, 03:00"],
          ],
        },
        {
          name: "Auckland, two hours, the clocks going back: 02:00 comes twice, and its block starts at the first",
          zone: Timezone.PacificAuckland,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-04-04T11:00:00.000Z",
          end: "2026-04-04T20:00:00.000Z",
          slots: [
            ["2026-04-04T11:00:00.000Z", "05 Apr, 00:00"],
            ["2026-04-04T13:00:00.000Z", "05 Apr, 02:00"],
            ["2026-04-04T16:00:00.000Z", "05 Apr, 04:00"],
            ["2026-04-04T18:00:00.000Z", "05 Apr, 06:00"],
            ["2026-04-04T20:00:00.000Z", "05 Apr, 08:00"],
          ],
        },
        {
          name: "Auckland, two hours, the clocks going forward",
          zone: Timezone.PacificAuckland,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-09-26T12:00:00.000Z",
          end: "2026-09-26T19:00:00.000Z",
          slots: [
            ["2026-09-26T12:00:00.000Z", "27 Sep, 00:00"],
            ["2026-09-26T14:00:00.000Z", "27 Sep, 03:00"],
            ["2026-09-26T15:00:00.000Z", "27 Sep, 04:00"],
            ["2026-09-26T17:00:00.000Z", "27 Sep, 06:00"],
            ["2026-09-26T19:00:00.000Z", "27 Sep, 08:00"],
          ],
        },
        {
          name: "London, twelve hours across the clocks going back: noon and midnight there",
          zone: Timezone.EuropeLondon,
          precision: XAxisPrecision.EVERY_TWELVE_HOURS,
          start: "2026-10-24T11:00:00.000Z",
          end: "2026-10-26T00:00:00.000Z",
          slots: [
            ["2026-10-24T11:00:00.000Z", "24 Oct, 12:00"],
            ["2026-10-24T23:00:00.000Z", "25 Oct, 00:00"],
            ["2026-10-25T12:00:00.000Z", "25 Oct, 12:00"],
            ["2026-10-26T00:00:00.000Z", "26 Oct, 00:00"],
          ],
        },
        {
          /*
           * Troll station's clocks go forward two hours, from 01:00 to
           * 03:00: the block from 02:00 starts where the clock resumes, at
           * 03:00, not two hours later.
           */
          name: "Antarctica/Troll, two hours, the clocks going forward two hours: 02:00 never comes, so its block starts at 03:00",
          zone: Timezone.AntarcticaTroll,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-28T20:00:00.000Z",
          end: "2026-03-29T08:00:00.000Z",
          slots: [
            ["2026-03-28T20:00:00.000Z", "28 Mar, 20:00"],
            ["2026-03-28T22:00:00.000Z", "28 Mar, 22:00"],
            ["2026-03-29T00:00:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T01:00:00.000Z", "29 Mar, 03:00"],
            ["2026-03-29T02:00:00.000Z", "29 Mar, 04:00"],
            ["2026-03-29T04:00:00.000Z", "29 Mar, 06:00"],
            ["2026-03-29T06:00:00.000Z", "29 Mar, 08:00"],
            ["2026-03-29T08:00:00.000Z", "29 Mar, 10:00"],
          ],
        },
        {
          /*
           * From 23:00 the walk steps onto 01:00, which the clocks skip:
           * the block from 00:00 is left its first hour, before the gap,
           * and its slot stands at its start.
           */
          name: "Antarctica/Troll, two hours from 23:00, the clocks going forward two hours: the block from 00:00 keeps its hour before the gap",
          zone: Timezone.AntarcticaTroll,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-03-28T23:00:00.000Z",
          end: "2026-03-29T07:00:00.000Z",
          slots: [
            ["2026-03-28T23:00:00.000Z", "28 Mar, 22:00"],
            ["2026-03-29T00:00:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T01:00:00.000Z", "29 Mar, 03:00"],
            ["2026-03-29T03:00:00.000Z", "29 Mar, 04:00"],
            ["2026-03-29T05:00:00.000Z", "29 Mar, 06:00"],
            ["2026-03-29T07:00:00.000Z", "29 Mar, 08:00"],
          ],
        },
        {
          name: "Antarctica/Troll, three hours from 22:00, the clocks going forward two hours: the block from 00:00 keeps its hour before the gap",
          zone: Timezone.AntarcticaTroll,
          precision: XAxisPrecision.EVERY_THREE_HOURS,
          start: "2026-03-28T22:00:00.000Z",
          end: "2026-03-29T08:00:00.000Z",
          slots: [
            ["2026-03-28T22:00:00.000Z", "28 Mar, 21:00"],
            ["2026-03-29T00:00:00.000Z", "29 Mar, 00:00"],
            ["2026-03-29T02:00:00.000Z", "29 Mar, 03:00"],
            ["2026-03-29T05:00:00.000Z", "29 Mar, 06:00"],
            ["2026-03-29T08:00:00.000Z", "29 Mar, 09:00"],
          ],
        },
        {
          name: "Antarctica/Troll, two hours, the clocks going back two hours",
          zone: Timezone.AntarcticaTroll,
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          start: "2026-10-24T22:00:00.000Z",
          end: "2026-10-25T08:00:00.000Z",
          slots: [
            ["2026-10-24T22:00:00.000Z", "25 Oct, 00:00"],
            ["2026-10-25T00:00:00.000Z", "25 Oct, 02:00"],
            ["2026-10-25T04:00:00.000Z", "25 Oct, 04:00"],
            ["2026-10-25T06:00:00.000Z", "25 Oct, 06:00"],
            ["2026-10-25T08:00:00.000Z", "25 Oct, 08:00"],
          ],
        },
        {
          name: "New York, six hours across the clocks going forward",
          zone: Timezone.AmericaNew_York,
          precision: XAxisPrecision.EVERY_SIX_HOURS,
          start: "2026-03-08T05:00:00.000Z",
          end: "2026-03-09T04:00:00.000Z",
          slots: [
            ["2026-03-08T05:00:00.000Z", "08 Mar, 00:00"],
            ["2026-03-08T10:00:00.000Z", "08 Mar, 06:00"],
            ["2026-03-08T16:00:00.000Z", "08 Mar, 12:00"],
            ["2026-03-08T22:00:00.000Z", "08 Mar, 18:00"],
            ["2026-03-09T04:00:00.000Z", "09 Mar, 00:00"],
          ],
        },
      ];

      for (const blocks of cases) {
        test(`read in ${blocks.name}`, () => {
          OneUptimeDate.setUserTimezone(blocks.zone);

          const slots: Slots = slotsOf({
            start: new Date(blocks.start),
            end: new Date(blocks.end),
            precision: blocks.precision,
          });

          expect(
            slots.instants.map(
              (instant: string, index: number): [string, string] => {
                return [instant, slots.labels[index]!];
              },
            ),
          ).toEqual(blocks.slots);
        });
      }

      test("read in London, both 01:30s on the day the clocks go back fall in the block from 00:00", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        for (const instant of [
          "2026-10-25T00:30:00.000Z",
          "2026-10-25T01:30:00.000Z",
        ]) {
          expect(
            XAxisUtil.getBucketStart(
              new Date(instant),
              XAxisPrecision.EVERY_TWO_HOURS,
            ).toISOString(),
          ).toBe("2026-10-24T23:00:00.000Z");
        }
      });

      test("read in Auckland, 02:00 comes twice on the day the clocks go back: both 02:30s and 03:30 fall in the block from the first 02:00", () => {
        OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

        // 02:30 NZDT, then 02:30 and 03:30 NZST.
        for (const instant of [
          "2026-04-04T13:30:00.000Z",
          "2026-04-04T14:30:00.000Z",
          "2026-04-04T15:30:00.000Z",
        ]) {
          expect(
            XAxisUtil.getBucketStart(
              new Date(instant),
              XAxisPrecision.EVERY_TWO_HOURS,
            ).toISOString(),
          ).toBe("2026-04-04T13:00:00.000Z");
        }
      });

      test("read in New York, 03:30 on the day the clocks go forward falls in the block that starts at 03:00", () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-03-08T07:30:00.000Z"),
            XAxisPrecision.EVERY_TWO_HOURS,
          ).toISOString(),
        ).toBe("2026-03-08T07:00:00.000Z");
      });

      test("read in Antarctica/Troll, 03:30 on the day the clocks go forward two hours falls in the block that starts at 03:00", () => {
        OneUptimeDate.setUserTimezone(Timezone.AntarcticaTroll);

        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-03-29T01:30:00.000Z"),
            XAxisPrecision.EVERY_TWO_HOURS,
          ).toISOString(),
        ).toBe("2026-03-29T01:00:00.000Z");
      });
    });

    describe("Lord Howe Island, whose clocks change by half an hour", () => {
      test("an hour a slot from midnight across its fall-back: 01:00 twice, the second hour half an hour long", () => {
        OneUptimeDate.setUserTimezone(Timezone.AustraliaLord_Howe);

        const slots: Slots = slotsOf({
          start: new Date("2026-04-04T13:00:00.000Z"),
          end: new Date("2026-04-04T18:00:00.000Z"),
          precision: XAxisPrecision.EVERY_HOUR,
        });

        expect(slots.labels).toEqual([
          "05 Apr, 00:00 GMT+11",
          "05 Apr, 01:00 GMT+11",
          "05 Apr, 01:00 GMT+1030",
          "05 Apr, 02:00 GMT+1030",
          "05 Apr, 03:00 GMT+1030",
          "05 Apr, 04:00 GMT+1030",
        ]);
        // The second 01:00 runs from the change, at 01:30 there, to 02:00.
        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-04-04T15:10:00.000Z"),
            XAxisPrecision.EVERY_HOUR,
          ).toISOString(),
        ).toBe("2026-04-04T15:00:00.000Z");
      });

      test("an hour a slot from 23:45 across its fall-back: the half-hour-long hour still has a slot", () => {
        OneUptimeDate.setUserTimezone(Timezone.AustraliaLord_Howe);

        const slots: Slots = slotsOf({
          start: new Date("2026-04-04T12:45:00.000Z"),
          end: new Date("2026-04-04T17:45:00.000Z"),
          precision: XAxisPrecision.EVERY_HOUR,
        });

        expect(slots.labels).toEqual([
          "04 Apr, 23:00 GMT+11",
          "05 Apr, 00:00 GMT+11",
          "05 Apr, 01:00 GMT+11",
          "05 Apr, 01:00 GMT+1030",
          "05 Apr, 02:00 GMT+1030",
          "05 Apr, 03:00 GMT+1030",
          "05 Apr, 04:00 GMT+1030",
        ]);
        expect(slots.instants[3]).toBe("2026-04-04T15:00:00.000Z");
      });

      test("an hour a slot from 00:45 across its spring-forward: 02:00 is half an hour long, and has its slot", () => {
        OneUptimeDate.setUserTimezone(Timezone.AustraliaLord_Howe);

        const slots: Slots = slotsOf({
          start: new Date("2026-10-03T14:15:00.000Z"),
          end: new Date("2026-10-03T18:15:00.000Z"),
          precision: XAxisPrecision.EVERY_HOUR,
        });

        expect(slots.labels).toEqual([
          "04 Oct, 00:00",
          "04 Oct, 01:00",
          "04 Oct, 02:00",
          "04 Oct, 03:00",
          "04 Oct, 04:00",
          "04 Oct, 05:00",
        ]);
        // 02:00 starts where the clock resumes, at 02:30 there.
        expect(slots.instants[2]).toBe("2026-10-03T15:30:00.000Z");
        expect(
          XAxisUtil.getBucketStart(
            new Date("2026-10-03T15:45:00.000Z"),
            XAxisPrecision.EVERY_HOUR,
          ).toISOString(),
        ).toBe("2026-10-03T15:30:00.000Z");
      });
    });

    describe("every point on a slot of its own, at every step, around every change", () => {
      const tiers: Array<{
        precision: XAxisPrecision;
        // How long a window, and how far apart its points.
        windowMs: number;
        pointEveryMs: number;
      }> = [
        {
          precision: XAxisPrecision.EVERY_FIVE_MINUTES,
          windowMs: 6 * HOUR,
          pointEveryMs: 5 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_THIRTY_MINUTES,
          windowMs: DAY,
          pointEveryMs: 5 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_HOUR,
          windowMs: 2 * DAY,
          pointEveryMs: 5 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          windowMs: 3 * DAY,
          pointEveryMs: 15 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_THREE_HOURS,
          windowMs: 3 * DAY,
          pointEveryMs: 15 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_TWELVE_HOURS,
          windowMs: 4 * DAY,
          pointEveryMs: 15 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_DAY,
          windowMs: 6 * DAY,
          pointEveryMs: 30 * MINUTE,
        },
      ];

      /*
       * Troll station's clocks change by two hours, at 01:00 UTC: forward
       * from 01:00 to 03:00 on 29 March, back from 03:00 to 01:00 on 25
       * October. Its two repeated hours straddle the 02:00 boundary of a
       * block of two hours, so each of those blocks holds the readings it
       * names, which are not one stretch of time; the case "Antarctica/Troll,
       * two hours, the clocks going back two hours" above lays them out. Every
       * other step around its changes is here.
       */
      const changes: Array<{
        zone: Timezone;
        day: string;
        leaveOut?: XAxisPrecision | undefined;
      }> = [
        ...ZONES_WITH_CLOCK_CHANGES.map(
          (
            reader: ZoneWithClockChanges,
          ): Array<{ zone: Timezone; day: string }> => {
            return [
              { zone: reader.zone, day: reader.fallBackDay },
              { zone: reader.zone, day: reader.springForwardDay },
            ];
          },
        ).flat(),
        { zone: Timezone.AntarcticaTroll, day: "2026-03-29" },
        {
          zone: Timezone.AntarcticaTroll,
          day: "2026-10-25",
          leaveOut: XAxisPrecision.EVERY_TWO_HOURS,
        },
      ];

      for (const change of changes) {
        for (const tier of tiers) {
          if (tier.precision === change.leaveOut) {
            continue;
          }

          test(`read in ${change.zone}, around ${change.day}, one ${tier.precision} slot each`, () => {
            OneUptimeDate.setUserTimezone(change.zone);

            // From the evening before, on the hour and 37 minutes past it.
            for (const startTime of ["21:00", "21:37"]) {
              const start: Date = wallTimeIn(
                change.zone,
                addDays(change.day, -1),
                startTime,
              );

              expectEveryPointOnASlot(
                {
                  start: start,
                  end: new Date(start.getTime() + tier.windowMs),
                  precision: tier.precision,
                },
                tier.pointEveryMs,
              );
            }
          });
        }
      }
    });

    describe("an empty trailing day is measured by its own length there", () => {
      // The day grid of a window with one reading at its start, and what renders.
      function trailing(
        start: string,
        end: string,
      ): {
        intervals: Array<Date>;
        renderable: Array<Date>;
      } {
        const bounds: {
          xAxisMin: Date;
          xAxisMax: Date;
          precision: XAxisPrecision;
        } = {
          xAxisMin: new Date(start),
          xAxisMax: new Date(end),
          precision: XAxisPrecision.EVERY_DAY,
        };

        return {
          intervals: XAxisUtil.getPrecisionIntervals(bounds),
          renderable: XAxisUtil.getRenderableIntervals({
            ...bounds,
            seriesPoints: [
              {
                seriesName: "resource.host.name=web-1",
                data: [{ x: bounds.xAxisMin, y: 1 }],
              },
            ],
          }),
        };
      }

      test("read in London, its 23-hour spring-forward day: 11 h 45 min of it is over half, so its slot stays", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const { intervals, renderable } = trailing(
          "2026-03-25T00:00:00.000Z",
          "2026-03-29T11:45:00.000Z",
        );

        expect(intervals[intervals.length - 1]!.toISOString()).toBe(
          "2026-03-29T00:00:00.000Z",
        );
        expect(renderable).toHaveLength(intervals.length);
      });

      test("read in London, the 24-hour day after it: 11 h 45 min of it is under half, so its slot goes", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const { intervals, renderable } = trailing(
          "2026-03-26T00:00:00.000Z",
          "2026-03-30T10:45:00.000Z",
        );

        expect(intervals[intervals.length - 1]!.toISOString()).toBe(
          "2026-03-29T23:00:00.000Z",
        );
        expect(renderable).toHaveLength(intervals.length - 1);
      });

      test("read in London, its 25-hour fall-back day: 12 h 15 min of it is under half, 12 h 45 min over", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const under: { intervals: Array<Date>; renderable: Array<Date> } =
          trailing("2026-10-21T23:00:00.000Z", "2026-10-25T11:15:00.000Z");
        const over: { intervals: Array<Date>; renderable: Array<Date> } =
          trailing("2026-10-21T23:00:00.000Z", "2026-10-25T11:45:00.000Z");

        expect(under.intervals[under.intervals.length - 1]!.toISOString()).toBe(
          "2026-10-24T23:00:00.000Z",
        );
        expect(under.renderable).toHaveLength(under.intervals.length - 1);
        expect(over.renderable).toHaveLength(over.intervals.length);
      });
    });

    describe("a reader who has not picked a zone reads the browser's", () => {
      const own: ZoneWithClockChanges | undefined =
        ZONES_WITH_CLOCK_CHANGES.find((zone: ZoneWithClockChanges): boolean => {
          return zone.zone === processZone;
        });

      test(`thirty days around each of ${processZone}'s changes, a slot at each of its midnights`, () => {
        OneUptimeDate.setUserTimezone(null);

        const changeDays: Array<string> = own
          ? [own.fallBackDay, own.springForwardDay]
          : ["2026-10-25"];

        for (const changeDay of changeDays) {
          const firstDay: string = addDays(changeDay, -13);
          const days: Array<string> = Array.from(
            { length: 30 },
            (_value: unknown, index: number): string => {
              return addDays(firstDay, index);
            },
          );
          const slots: Slots = slotsOf({
            start: wallTimeIn(processZone, firstDay),
            end: wallTimeIn(processZone, days[29]!),
            precision: XAxisPrecision.EVERY_DAY,
          });

          expect(slots.instants).toEqual(
            days.map((day: string): string => {
              return wallTimeIn(processZone, day).toISOString();
            }),
          );
          expect(slots.labels).toEqual(days.map(dayLabel));
        }
      });
    });

    /*
     * A WINDOW THAT ENDS EARLIER IN ITS BUCKET THAN IT STARTS (issue #7278).
     *
     * The walk steps from the window's start, so each slot keeps the
     * start's place in its bucket: from 14:42, a day axis has its slots at
     * 14:42. A window that ends at 09:00 stopped the walk on the day before
     * its last, since 14:42 on the last day is past the end, and the
     * server's bucket for that day, from its midnight to 09:00, had no slot
     * to land on: its total was never drawn. Every step walked the same
     * way: weeks, months, years, blocks of hours, hours and minutes. That
     * bucket now has a slot, at its start.
     *
     * The rows are the server's buckets, each from a midnight (a Monday's,
     * a 1st's, New Year's) in the reader's zone, which the request now asks
     * for (issue #7277). The first starts before the window does, and still
     * lands on the first slot, which has its label.
     */
    describe("the bucket a window ends in has a slot, however early in it the window ends (#7278)", () => {
      const readers: ReadonlyArray<Timezone> = [
        ...ZONES_WITH_CLOCK_CHANGES.map(
          (reader: ZoneWithClockChanges): Timezone => {
            return reader.zone;
          },
        ),
        Timezone.UTC,
        Timezone.AsiaKolkata,
        Timezone.AsiaTokyo,
      ];

      for (const reader of readers) {
        for (const changeDay of CLOCK_CHANGE_DAYS) {
          const firstDay: string = addDays(changeDay, -13);
          const days: Array<string> = Array.from(
            { length: 30 },
            (_value: unknown, index: number): string => {
              return addDays(firstDay, index);
            },
          );

          test(`read in ${reader}, days from 14:42 on ${firstDay} to 09:00 on ${days[29]}: the last day's slot at its midnight, and each day's total on its own row`, () => {
            OneUptimeDate.setUserTimezone(reader);

            const window: Window = {
              start: wallTimeIn(reader, firstDay, "14:42"),
              end: wallTimeIn(reader, days[29]!, "09:00"),
              precision: XAxisPrecision.EVERY_DAY,
            };
            const slots: Slots = slotsOf(window);

            expect(slots.instants).toEqual([
              ...days.slice(0, 29).map((day: string): string => {
                return wallTimeIn(reader, day, "14:42").toISOString();
              }),
              wallTimeIn(reader, days[29]!).toISOString(),
            ]);
            expect(slots.labels).toEqual(days.map(dayLabel));

            const midnights: Array<Date> = days.map((day: string): Date => {
              return wallTimeIn(reader, day);
            });

            expect(rowsOf(window, totalsAt(midnights)).map(readRow)).toEqual(
              days.map((day: string, index: number): ReadRow => {
                return {
                  label: dayLabel(day),
                  value: index + 1,
                  start: midnights[index]!.toISOString(),
                };
              }),
            );
          });

          // Every day the clocks change on here is a Sunday (checked below).
          const thursdays: Array<string> = Array.from(
            { length: 13 },
            (_value: unknown, index: number): string => {
              return addDays(changeDay, -45 + 7 * index);
            },
          );
          const mondays: Array<string> = Array.from(
            { length: 14 },
            (_value: unknown, index: number): string => {
              return addDays(changeDay, -48 + 7 * index);
            },
          );
          const tuesday: string = addDays(changeDay, 44);

          test(`read in ${reader}, weeks from 14:42 on Thursday ${thursdays[0]} to 09:00 on Tuesday ${tuesday}: each named by its Monday, the last week's slot at its Monday's midnight, and each week's total on its own row`, () => {
            OneUptimeDate.setUserTimezone(reader);

            expect(new Date(`${changeDay}T12:00:00.000Z`).getUTCDay()).toBe(0);

            const window: Window = {
              start: wallTimeIn(reader, thursdays[0]!, "14:42"),
              end: wallTimeIn(reader, tuesday, "09:00"),
              precision: XAxisPrecision.EVERY_WEEK,
            };
            const slots: Slots = slotsOf(window);

            expect(slots.instants).toEqual([
              ...thursdays.map((day: string): string => {
                return wallTimeIn(reader, day, "14:42").toISOString();
              }),
              wallTimeIn(reader, mondays[13]!).toISOString(),
            ]);
            expect(slots.labels).toEqual(mondays.map(dayLabel));

            const midnights: Array<Date> = mondays.map((day: string): Date => {
              return wallTimeIn(reader, day);
            });

            expect(rowsOf(window, totalsAt(midnights)).map(readRow)).toEqual(
              mondays.map((day: string, index: number): ReadRow => {
                return {
                  label: dayLabel(day),
                  value: index + 1,
                  start: midnights[index]!.toISOString(),
                };
              }),
            );
          });
        }

        test(`read in ${reader}, months from 14:42 on 17 January to 09:00 on 9 December 2026: December's slot at the 1st's midnight, and each month's total on its own row`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const months: Array<string> = Array.from(
            { length: 12 },
            (_value: unknown, index: number): string => {
              return `2026-${pad(index + 1)}`;
            },
          );
          const labels: Array<string> = months.map((month: string): string => {
            return `${MONTHS[Number(month.slice(5, 7)) - 1]} 2026`;
          });
          const window: Window = {
            start: wallTimeIn(reader, "2026-01-17", "14:42"),
            end: wallTimeIn(reader, "2026-12-09", "09:00"),
            precision: XAxisPrecision.EVERY_MONTH,
          };
          const slots: Slots = slotsOf(window);

          expect(slots.instants).toEqual([
            ...months.slice(0, 11).map((month: string): string => {
              return wallTimeIn(reader, `${month}-17`, "14:42").toISOString();
            }),
            wallTimeIn(reader, "2026-12-01").toISOString(),
          ]);
          expect(slots.labels).toEqual(labels);

          const rows: Array<ReadRow> = rowsOf(
            window,
            totalsAt(
              months.map((month: string): Date => {
                return wallTimeIn(reader, `${month}-01`);
              }),
            ),
          ).map(readRow);

          expect(
            rows.map((row: ReadRow): [string, unknown] => {
              return [row.label, row.value];
            }),
          ).toEqual(
            labels.map((label: string, index: number): [string, number] => {
              return [label, index + 1];
            }),
          );
        });

        test(`read in ${reader}, years from 14:42 on 17 March 2020 to 09:00 on 9 February 2026: 2026's slot at New Year's midnight, and each year's total on its own row`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const years: Array<number> = [
            2020, 2021, 2022, 2023, 2024, 2025, 2026,
          ];
          const window: Window = {
            start: wallTimeIn(reader, "2020-03-17", "14:42"),
            end: wallTimeIn(reader, "2026-02-09", "09:00"),
            precision: XAxisPrecision.EVERY_YEAR,
          };
          const slots: Slots = slotsOf(window);

          expect(slots.instants).toEqual([
            ...years.slice(0, 6).map((year: number): string => {
              return wallTimeIn(reader, `${year}-03-17`, "14:42").toISOString();
            }),
            wallTimeIn(reader, "2026-01-01").toISOString(),
          ]);
          expect(slots.labels).toEqual(years.map(String));

          const rows: Array<ReadRow> = rowsOf(
            window,
            totalsAt(
              years.map((year: number): Date => {
                return wallTimeIn(reader, `${year}-01-01`);
              }),
            ),
          ).map(readRow);

          expect(
            rows.map((row: ReadRow): [string, unknown] => {
              return [row.label, row.value];
            }),
          ).toEqual(
            years.map((year: number, index: number): [string, number] => {
              return [String(year), index + 1];
            }),
          );
        });

        test(`read in ${reader}, an hour a slot from 10:42 to 15:20: the hour from 15:00 has its slot, at 15:00`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const slots: Slots = slotsOf({
            start: wallTimeIn(reader, "2026-06-15", "10:42"),
            end: wallTimeIn(reader, "2026-06-15", "15:20"),
            precision: XAxisPrecision.EVERY_HOUR,
          });

          expect(pairsOf(slots)).toEqual([
            ...["10", "11", "12", "13", "14"].map(
              (hour: string): [string, string] => {
                return [
                  wallTimeIn(reader, "2026-06-15", `${hour}:42`).toISOString(),
                  `15 Jun, ${hour}:00`,
                ];
              },
            ),
            [
              wallTimeIn(reader, "2026-06-15", "15:00").toISOString(),
              "15 Jun, 15:00",
            ],
          ]);
        });

        test(`read in ${reader}, blocks of two, three, six and twelve hours from 10:42, each window ending 20 minutes into a block: that block has its slot, at its start`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const cases: Array<{
            precision: XAxisPrecision;
            end: [string, string];
            // The day, the reading and the label of each slot.
            slots: Array<[string, string, string]>;
          }> = [
            {
              precision: XAxisPrecision.EVERY_TWO_HOURS,
              end: ["2026-06-15", "20:20"],
              slots: [
                ["2026-06-15", "10:42", "15 Jun, 10:00"],
                ["2026-06-15", "12:42", "15 Jun, 12:00"],
                ["2026-06-15", "14:42", "15 Jun, 14:00"],
                ["2026-06-15", "16:42", "15 Jun, 16:00"],
                ["2026-06-15", "18:42", "15 Jun, 18:00"],
                ["2026-06-15", "20:00", "15 Jun, 20:00"],
              ],
            },
            {
              precision: XAxisPrecision.EVERY_THREE_HOURS,
              end: ["2026-06-15", "18:20"],
              slots: [
                ["2026-06-15", "10:42", "15 Jun, 09:00"],
                ["2026-06-15", "13:42", "15 Jun, 12:00"],
                ["2026-06-15", "16:42", "15 Jun, 15:00"],
                ["2026-06-15", "18:00", "15 Jun, 18:00"],
              ],
            },
            {
              precision: XAxisPrecision.EVERY_SIX_HOURS,
              end: ["2026-06-16", "12:20"],
              slots: [
                ["2026-06-15", "10:42", "15 Jun, 06:00"],
                ["2026-06-15", "16:42", "15 Jun, 12:00"],
                ["2026-06-15", "22:42", "15 Jun, 18:00"],
                ["2026-06-16", "04:42", "16 Jun, 00:00"],
                ["2026-06-16", "10:42", "16 Jun, 06:00"],
                ["2026-06-16", "12:00", "16 Jun, 12:00"],
              ],
            },
            {
              precision: XAxisPrecision.EVERY_TWELVE_HOURS,
              end: ["2026-06-17", "01:20"],
              slots: [
                ["2026-06-15", "10:42", "15 Jun, 00:00"],
                ["2026-06-15", "22:42", "15 Jun, 12:00"],
                ["2026-06-16", "10:42", "16 Jun, 00:00"],
                ["2026-06-16", "22:42", "16 Jun, 12:00"],
                ["2026-06-17", "00:00", "17 Jun, 00:00"],
              ],
            },
          ];

          for (const blocks of cases) {
            const slots: Slots = slotsOf({
              start: wallTimeIn(reader, "2026-06-15", "10:42"),
              end: wallTimeIn(reader, blocks.end[0], blocks.end[1]),
              precision: blocks.precision,
            });

            expect({
              precision: blocks.precision,
              slots: pairsOf(slots),
            }).toEqual({
              precision: blocks.precision,
              slots: blocks.slots.map(
                (slot: [string, string, string]): [string, string] => {
                  return [
                    wallTimeIn(reader, slot[0], slot[1]).toISOString(),
                    slot[2],
                  ];
                },
              ),
            });
          }
        });

        test(`read in ${reader}, five minutes a slot from 10:42 to 11:31, and a minute a slot from 13:37:20 to 243 ms past 13:42: the step the window ends in has its slot, at its start`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const fiveMinutes: Slots = slotsOf({
            start: wallTimeIn(reader, "2026-06-15", "10:42"),
            end: wallTimeIn(reader, "2026-06-15", "11:31"),
            precision: XAxisPrecision.EVERY_FIVE_MINUTES,
          });
          const walked: Array<string> = Array.from(
            { length: 10 },
            (_value: unknown, index: number): string => {
              return new Date(
                wallTimeIn(reader, "2026-06-15", "10:42").getTime() +
                  index * 5 * MINUTE,
              ).toISOString();
            },
          );

          expect(fiveMinutes.instants).toEqual([
            ...walked,
            wallTimeIn(reader, "2026-06-15", "11:30").toISOString(),
          ]);
          expect(fiveMinutes.labels).toEqual([
            "10:40",
            "10:45",
            "10:50",
            "10:55",
            "11:00",
            "11:05",
            "11:10",
            "11:15",
            "11:20",
            "11:25",
            "11:30",
          ]);

          const minuteStart: Date = new Date(
            wallTimeIn(reader, "2026-06-15", "13:37").getTime() + 20 * 1000,
          );
          const minutes: Slots = slotsOf({
            start: minuteStart,
            end: new Date(
              wallTimeIn(reader, "2026-06-15", "13:42").getTime() + 243,
            ),
            precision: XAxisPrecision.EVERY_MINUTE,
          });

          expect(minutes.instants).toEqual([
            ...[0, 1, 2, 3, 4].map((index: number): string => {
              return new Date(
                minuteStart.getTime() + index * MINUTE,
              ).toISOString();
            }),
            wallTimeIn(reader, "2026-06-15", "13:42").toISOString(),
          ]);
          expect(minutes.labels).toEqual([
            "13:37",
            "13:38",
            "13:39",
            "13:40",
            "13:41",
            "13:42",
          ]);
        });

        test(`read in ${reader}, a window that ends where a bucket starts holds none of it, and one that ends later in its bucket than it starts has a slot there already: no slot is added to either`, () => {
          OneUptimeDate.setUserTimezone(reader);

          const cases: Array<{
            precision: XAxisPrecision;
            start: [string, string];
            end: [string, string];
            slots: number;
            last: [string, string];
            lastLabel: string;
          }> = [
            // It ends where a bucket starts.
            {
              precision: XAxisPrecision.EVERY_DAY,
              start: ["2026-03-01", "14:42"],
              end: ["2026-03-30", "00:00"],
              slots: 29,
              last: ["2026-03-29", "14:42"],
              lastLabel: "29 Mar",
            },
            {
              precision: XAxisPrecision.EVERY_WEEK,
              start: ["2026-01-15", "14:42"],
              end: ["2026-04-13", "00:00"],
              slots: 13,
              last: ["2026-04-09", "14:42"],
              lastLabel: "06 Apr",
            },
            {
              precision: XAxisPrecision.EVERY_MONTH,
              start: ["2026-01-17", "14:42"],
              end: ["2026-12-01", "00:00"],
              slots: 11,
              last: ["2026-11-17", "14:42"],
              lastLabel: "Nov 2026",
            },
            {
              precision: XAxisPrecision.EVERY_YEAR,
              start: ["2020-03-17", "14:42"],
              end: ["2026-01-01", "00:00"],
              slots: 6,
              last: ["2025-03-17", "14:42"],
              lastLabel: "2025",
            },
            {
              precision: XAxisPrecision.EVERY_HOUR,
              start: ["2026-06-15", "10:42"],
              end: ["2026-06-15", "15:00"],
              slots: 5,
              last: ["2026-06-15", "14:42"],
              lastLabel: "15 Jun, 14:00",
            },
            {
              precision: XAxisPrecision.EVERY_TWO_HOURS,
              start: ["2026-06-15", "10:42"],
              end: ["2026-06-15", "20:00"],
              slots: 5,
              last: ["2026-06-15", "18:42"],
              lastLabel: "15 Jun, 18:00",
            },
            {
              precision: XAxisPrecision.EVERY_FIVE_MINUTES,
              start: ["2026-06-15", "10:42"],
              end: ["2026-06-15", "11:30"],
              slots: 10,
              last: ["2026-06-15", "11:27"],
              lastLabel: "11:25",
            },
            // It ends later in its bucket than it starts.
            {
              precision: XAxisPrecision.EVERY_DAY,
              start: ["2026-03-01", "09:00"],
              end: ["2026-03-30", "14:42"],
              slots: 30,
              last: ["2026-03-30", "09:00"],
              lastLabel: "30 Mar",
            },
            {
              precision: XAxisPrecision.EVERY_WEEK,
              start: ["2026-01-12", "09:00"],
              end: ["2026-04-09", "14:42"],
              slots: 13,
              last: ["2026-04-06", "09:00"],
              lastLabel: "06 Apr",
            },
            {
              precision: XAxisPrecision.EVERY_MONTH,
              start: ["2026-01-09", "09:00"],
              end: ["2026-12-17", "14:42"],
              slots: 12,
              last: ["2026-12-09", "09:00"],
              lastLabel: "Dec 2026",
            },
            {
              precision: XAxisPrecision.EVERY_YEAR,
              start: ["2020-01-09", "09:00"],
              end: ["2026-03-17", "14:42"],
              slots: 7,
              last: ["2026-01-09", "09:00"],
              lastLabel: "2026",
            },
            {
              precision: XAxisPrecision.EVERY_HOUR,
              start: ["2026-06-15", "10:20"],
              end: ["2026-06-15", "15:42"],
              slots: 6,
              last: ["2026-06-15", "15:20"],
              lastLabel: "15 Jun, 15:00",
            },
            {
              precision: XAxisPrecision.EVERY_TWO_HOURS,
              start: ["2026-06-15", "10:20"],
              end: ["2026-06-15", "20:42"],
              slots: 6,
              last: ["2026-06-15", "20:20"],
              lastLabel: "15 Jun, 20:00",
            },
            {
              precision: XAxisPrecision.EVERY_FIVE_MINUTES,
              start: ["2026-06-15", "10:41"],
              end: ["2026-06-15", "11:34"],
              slots: 11,
              last: ["2026-06-15", "11:31"],
              lastLabel: "11:30",
            },
          ];

          for (const window of cases) {
            const slots: Slots = slotsOf({
              start: wallTimeIn(reader, window.start[0], window.start[1]),
              end: wallTimeIn(reader, window.end[0], window.end[1]),
              precision: window.precision,
            });

            expect({
              window: window.start.concat(window.end).join(" "),
              slots: slots.instants.length,
              last: slots.instants[slots.instants.length - 1],
              lastLabel: slots.labels[slots.labels.length - 1],
            }).toEqual({
              window: window.start.concat(window.end).join(" "),
              slots: window.slots,
              last: wallTimeIn(
                reader,
                window.last[0],
                window.last[1],
              ).toISOString(),
              lastLabel: window.lastLabel,
            });
          }
        });
      }

      test("read in New York, an hour a slot from 00:42 to 05:20 on the day the clocks go forward: the hour from 05:00 has its slot", () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        expect(
          pairsOf(
            slotsOf({
              start: new Date("2026-03-08T05:42:00.000Z"),
              end: new Date("2026-03-08T09:20:00.000Z"),
              precision: XAxisPrecision.EVERY_HOUR,
            }),
          ),
        ).toEqual([
          ["2026-03-08T05:42:00.000Z", "08 Mar, 00:00"],
          ["2026-03-08T06:42:00.000Z", "08 Mar, 01:00"],
          ["2026-03-08T07:42:00.000Z", "08 Mar, 03:00"],
          ["2026-03-08T08:42:00.000Z", "08 Mar, 04:00"],
          ["2026-03-08T09:00:00.000Z", "08 Mar, 05:00"],
        ]);
      });

      test("read in London, an hour a slot from 00:42 BST to 04:20 GMT on the day the clocks go back: the hour from 04:00 has its slot", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        expect(
          pairsOf(
            slotsOf({
              start: new Date("2026-10-24T23:42:00.000Z"),
              end: new Date("2026-10-25T04:20:00.000Z"),
              precision: XAxisPrecision.EVERY_HOUR,
            }),
          ),
        ).toEqual([
          ["2026-10-24T23:42:00.000Z", "25 Oct, 00:00 BST"],
          ["2026-10-25T00:42:00.000Z", "25 Oct, 01:00 BST"],
          ["2026-10-25T01:42:00.000Z", "25 Oct, 01:00 GMT"],
          ["2026-10-25T02:42:00.000Z", "25 Oct, 02:00 GMT"],
          ["2026-10-25T03:42:00.000Z", "25 Oct, 03:00 GMT"],
          ["2026-10-25T04:00:00.000Z", "25 Oct, 04:00 GMT"],
        ]);
      });

      test("read in London, two days a slot from 14:42 on 3 March to 09:00 on 31 March: the two days from the 30th have their slot, at its midnight", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const slots: Slots = slotsOf({
          start: new Date("2026-03-03T14:42:00.000Z"),
          end: new Date("2026-03-31T08:00:00.000Z"),
          precision: XAxisPrecision.EVERY_TWO_DAYS,
        });

        expect(slots.labels).toEqual(
          [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].map(
            (day: number): string => {
              return `${pad(day)} Mar`;
            },
          ),
        );
        // 30 March is in British Summer Time: its midnight is 23:00 UTC the day before.
        expect(slots.instants[slots.instants.length - 1]).toBe(
          "2026-03-29T23:00:00.000Z",
        );
      });
    });

    /*
     * The server's day buckets start at the reader's midnight (#7277). They
     * started at midnight UTC, which is the evening before west of UTC: a
     * reader in New York saw each day's total on the day before, and the
     * first day's total on no day at all, since the day before the window
     * has no slot.
     */
    describe("a day's total is drawn on its own day when the server starts it at the reader's midnight (#7277)", () => {
      test("read in New York, from 6 to 10 March: started at each midnight there, each total on its own day; started at midnight UTC, every total a day early and the first lost", () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        const days: Array<string> = [
          "2026-03-06",
          "2026-03-07",
          "2026-03-08",
          "2026-03-09",
          "2026-03-10",
        ];
        const window: Window = {
          start: wallTimeIn(Timezone.AmericaNew_York, days[0]!),
          end: wallTimeIn(Timezone.AmericaNew_York, days[4]!, "12:00"),
          precision: XAxisPrecision.EVERY_DAY,
        };

        expect(
          rowsOf(
            window,
            totalsAt(
              days.map((day: string): Date => {
                return wallTimeIn(Timezone.AmericaNew_York, day);
              }),
            ),
          )
            .map(readRow)
            .map((row: ReadRow): [string, unknown] => {
              return [row.label, row.value];
            }),
        ).toEqual([
          ["06 Mar", 1],
          ["07 Mar", 2],
          ["08 Mar", 3],
          ["09 Mar", 4],
          ["10 Mar", 5],
        ]);

        expect(
          rowsOf(
            window,
            totalsAt(
              days.map((day: string): Date => {
                return new Date(`${day}T00:00:00.000Z`);
              }),
            ),
          )
            .map(readRow)
            .map((row: ReadRow): [string, unknown] => {
              return [row.label, row.value];
            }),
        ).toEqual([
          ["06 Mar", 2],
          ["07 Mar", 3],
          ["08 Mar", 4],
          ["09 Mar", 5],
          ["10 Mar", undefined],
        ]);
      });
    });

    /*
     * Seeded windows at every step from a minute to a year, starting and
     * ending anywhere: across each clock change of the zone, and anywhere
     * in 2026. Every instant of each is on a slot, the bucket its end is in
     * included (#7278). The steps of two days and two weeks are left out:
     * they name a slot after the even day of the month it falls on, which
     * their walk of 2 and 14 days does not keep to. A walk from 31 January
     * steps to 2 February, and 1 February, named "31 Jan" (its day 0), has
     * no slot; a fortnight's slot names one of its seven even days.
     */
    describe("every instant of a window on a slot, the bucket its end is in included: seeded windows (#7278)", () => {
      const tiers: Array<{
        precision: XAxisPrecision;
        longestWindowMs: number;
        pointEveryMs: number;
      }> = [
        {
          precision: XAxisPrecision.EVERY_MINUTE,
          longestWindowMs: 3 * HOUR,
          pointEveryMs: 30 * 1000,
        },
        {
          precision: XAxisPrecision.EVERY_FIVE_MINUTES,
          longestWindowMs: 12 * HOUR,
          pointEveryMs: 2 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_FIFTEEN_MINUTES,
          longestWindowMs: DAY,
          pointEveryMs: 5 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_THIRTY_MINUTES,
          longestWindowMs: 3 * DAY,
          pointEveryMs: 10 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_HOUR,
          longestWindowMs: 7 * DAY,
          pointEveryMs: 15 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_TWO_HOURS,
          longestWindowMs: 7 * DAY,
          pointEveryMs: 30 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_THREE_HOURS,
          longestWindowMs: 7 * DAY,
          pointEveryMs: 30 * MINUTE,
        },
        {
          precision: XAxisPrecision.EVERY_SIX_HOURS,
          longestWindowMs: 10 * DAY,
          pointEveryMs: HOUR,
        },
        {
          precision: XAxisPrecision.EVERY_TWELVE_HOURS,
          longestWindowMs: 14 * DAY,
          pointEveryMs: HOUR,
        },
        {
          precision: XAxisPrecision.EVERY_DAY,
          longestWindowMs: 42 * DAY,
          pointEveryMs: 6 * HOUR,
        },
        {
          precision: XAxisPrecision.EVERY_WEEK,
          longestWindowMs: 183 * DAY,
          pointEveryMs: DAY,
        },
        {
          precision: XAxisPrecision.EVERY_MONTH,
          longestWindowMs: 6 * 365 * DAY,
          pointEveryMs: 5 * DAY,
        },
        {
          precision: XAxisPrecision.EVERY_THREE_MONTHS,
          longestWindowMs: 6 * 365 * DAY,
          pointEveryMs: 10 * DAY,
        },
        {
          precision: XAxisPrecision.EVERY_YEAR,
          longestWindowMs: 15 * 365 * DAY,
          pointEveryMs: 60 * DAY,
        },
      ];

      // Each zone's changes of 2026 (worked out with Python's zoneinfo).
      const readers: Array<{ zone: Timezone; changes: Array<string> }> = [
        { zone: Timezone.UTC, changes: [] },
        {
          zone: Timezone.EuropeLondon,
          changes: ["2026-03-29T01:00:00.000Z", "2026-10-25T01:00:00.000Z"],
        },
        {
          zone: Timezone.AmericaNew_York,
          changes: ["2026-03-08T07:00:00.000Z", "2026-11-01T06:00:00.000Z"],
        },
        {
          zone: Timezone.PacificAuckland,
          changes: ["2026-04-04T14:00:00.000Z", "2026-09-26T14:00:00.000Z"],
        },
        {
          zone: Timezone.AustraliaLord_Howe,
          changes: ["2026-04-04T15:00:00.000Z", "2026-10-03T15:30:00.000Z"],
        },
        // Its clocks skip midnight in September: that day starts at 01:00.
        {
          zone: Timezone.AmericaSantiago,
          changes: ["2026-04-05T03:00:00.000Z", "2026-09-06T04:00:00.000Z"],
        },
        { zone: Timezone.AsiaKolkata, changes: [] },
        { zone: Timezone.AsiaTokyo, changes: [] },
      ];

      const YEAR_START: number = Date.parse("2026-01-01T00:00:00.000Z");

      readers.forEach(
        (
          reader: { zone: Timezone; changes: Array<string> },
          readerIndex: number,
        ): void => {
          test(`read in ${reader.zone}: windows at every step, starting and ending anywhere`, () => {
            OneUptimeDate.setUserTimezone(reader.zone);

            const random: SeededRandom = seededRandom(7278 + readerIndex);

            for (const tier of tiers) {
              const windows: Array<Window> = [];

              // Two anywhere in the year, or one where the clocks change.
              const anywhere: number = reader.changes.length > 0 ? 1 : 2;

              for (let draw: number = 0; draw < anywhere; draw++) {
                const start: number =
                  YEAR_START + Math.floor(random() * 365 * DAY);

                windows.push({
                  start: new Date(start),
                  end: new Date(
                    start + 1 + Math.floor(random() * tier.longestWindowMs),
                  ),
                  precision: tier.precision,
                });
              }

              // One across each change, its end anywhere after it.
              for (const change of reader.changes) {
                const changeAt: number = Date.parse(change);
                const start: number =
                  changeAt - Math.floor(random() * tier.longestWindowMs);

                windows.push({
                  start: new Date(start),
                  end: new Date(
                    changeAt + 1 + Math.floor(random() * tier.longestWindowMs),
                  ),
                  precision: tier.precision,
                });
              }

              for (const window of windows) {
                expectTheWholeWindowOnSlots(window, tier.pointEveryMs);
              }
            }
          });
        },
      );
    });

    describe("a window that is not one", () => {
      test("an invalid start or end has no slots", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        for (const precision of [
          XAxisPrecision.EVERY_FIVE_MINUTES,
          XAxisPrecision.EVERY_TWO_HOURS,
          XAxisPrecision.EVERY_DAY,
          XAxisPrecision.EVERY_MONTH,
        ]) {
          expect(
            XAxisUtil.getPrecisionIntervals({
              xAxisMin: new Date(Number.NaN),
              xAxisMax: new Date("2026-10-25T00:00:00.000Z"),
              precision: precision,
            }),
          ).toEqual([]);
          expect(
            XAxisUtil.getPrecisionIntervals({
              xAxisMin: new Date("2026-10-25T00:00:00.000Z"),
              xAxisMax: new Date(Number.NaN),
              precision: precision,
            }),
          ).toEqual([]);
        }
      });

      test("an end before the start has no slots, and an end at the start one", () => {
        OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);

        const start: Date = new Date("2026-10-25T00:00:00.000Z");

        expect(
          XAxisUtil.getPrecisionIntervals({
            xAxisMin: start,
            xAxisMax: new Date(start.getTime() - HOUR),
            precision: XAxisPrecision.EVERY_DAY,
          }),
        ).toEqual([]);
        expect(
          XAxisUtil.getPrecisionIntervals({
            xAxisMin: start,
            xAxisMax: start,
            precision: XAxisPrecision.EVERY_DAY,
          }).map((interval: Date): string => {
            return interval.toISOString();
          }),
        ).toEqual([start.toISOString()]);
      });
    });
  });
}
