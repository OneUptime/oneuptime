import { describe, expect, test } from "@jest/globals";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import {
  DURATION_STEPS_IN_SECONDS,
  FEWEST_VALUE_AXIS_TICKS,
  FINEST_TICK_FIGURES,
  MOST_VALUE_AXIS_TICKS,
  ValueAxisTicks,
  areNeighboursApart,
  getValueAxisTicks,
} from "../../../../UI/Components/Charts/Utils/ValueAxisTicks";
import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  NBSP,
  ReadTick,
  getMantissa,
  isEveryTickExact,
  isOneFigureFewerWorse,
  readTick,
} from "../../../Helpers/AxisTickLabels";

/*
 * ISSUE #10118: A DURATION AXIS STEPS IN NATURAL UNITS OF TIME, AND READS
 * THEM CLEANLY, IN THE READER'S LANGUAGE.
 *
 * A duration axis stepped in decimal round numbers of its unit (1, 2, 2.5 or
 * 5 times a power of ten seconds), and ValueFormatter wrote each tick in the
 * unit its size picked: a second's step near an hour and a half read
 * "1.5000 hours", "1.5003 hours". An axis told it is in a unit of time
 * (durationUnitInSeconds, as a metric chart tells it) now steps in natural
 * units: 1, 2, 5, 10, 15 and 30 seconds, the same in minutes, 1, 2, 3, 6 and
 * 12 hours, 1, 2, 5 and 7 days and on, and the round decimal steps below a
 * second. Its ticks read "1 h 30 min", "45 sec", "250 ms", or a clock where
 * that would take three units ("1:30:02", "12 d 05:30").
 */

// A label as it is drawn: every space a no-break one.
function nb(text: string): string {
  return text.replace(/ /g, NBSP);
}

// A metric chart's formatter for a unit of time, in a language.
function durationFormatter(
  unit: string,
  language?: string,
): ValueAxisFormatter {
  return (value: number, precision?: ValueAxisPrecision): string => {
    return ValueFormatter.formatValue(value, unit, {
      language: language,
      step: precision?.step,
      largestTick: precision?.largestTick,
    });
  };
}

// The axis a metric chart draws for values in `unit`.
function durationAxis(input: {
  values: Array<number>;
  unit: string;
  domain?: Array<number | "auto">;
  language?: string;
}): ValueAxisTicks {
  return getValueAxisTicks({
    values: input.values,
    domain: input.domain || ["auto", "auto"],
    allowDecimals: true,
    formatter: durationFormatter(input.unit, input.language),
    durationUnitInSeconds: ValueFormatter.getDurationUnitInSeconds(input.unit),
  });
}

// Whether a step, in seconds, is one a clock or a calendar reads in.
function isNaturalStep(stepInSeconds: number): boolean {
  const step: number = Number(stepInSeconds.toPrecision(9));

  if (step < 1) {
    return [1, 2, 2.5, 5].includes(getMantissa(step));
  }

  if (DURATION_STEPS_IN_SECONDS.includes(step)) {
    return true;
  }

  const days: number = step / 86400;

  return (
    Number.isInteger(days) &&
    days >= 20 &&
    [1, 2, 5].includes(getMantissa(days))
  );
}

const INVISIBLE_MARKS: RegExp = /\p{Cf}/gu;
const LATIN_DIGIT: RegExp = /[0-9]/;
// A Latin letter that is not one of the sub-second symbols every language writes.
const LATIN_WORD: RegExp = /[A-Za-z]/;
const SUB_SECOND_SYMBOLS: RegExp = /ms|µs|ns/g;

describe("the axes a duration metric draws, from milliseconds to weeks", () => {
  test.each([
    [
      "a response time, 12 ms to 1.48 sec",
      "ms",
      [12, 300, 1480],
      [0, "auto"],
      ["0 ms", "500 ms", "1.0 sec", "1.5 sec"],
    ],
    [
      "a p99 latency, 0.4 sec to 3.2 sec",
      "s",
      [0.4, 2.1, 3.2],
      [0, "auto"],
      ["0 sec", "1 sec", "2 sec", "3 sec", "4 sec"],
    ],
    [
      "a queue's wait, 250 ms to 1.2 sec",
      "ms",
      [250, 700, 1200],
      ["auto", "auto"],
      ["250 ms", "500 ms", "750 ms", "1.00 sec", "1.25 sec"],
    ],
    [
      "a job's run, up to 45 seconds",
      "s",
      [2, 30, 45],
      [0, "auto"],
      ["0 sec", "15 sec", "30 sec", "45 sec"],
    ],
    [
      "a build, up to a minute and a half",
      "s",
      [20, 64, 90],
      [0, "auto"],
      ["0 sec", "30 sec", "1 min", "1 min 30 sec"],
    ],
    [
      "a backup, up to 50 minutes",
      "s",
      [300, 1800, 3000],
      [0, "auto"],
      ["0 min", "10 min", "20 min", "30 min", "40 min", "50 min"],
    ],
    [
      "a batch job, up to two hours",
      "s",
      [900, 4000, 7000],
      [0, "auto"],
      ["0 min", "30 min", "1 h", "1 h 30 min", "2 h"],
    ],
    [
      "the issue's job, an hour and a half give or take two seconds",
      "s",
      [5398.2, 5400, 5401.7],
      ["auto", "auto"],
      ["1:29:58", "1:29:59", "1:30:00", "1:30:01", "1:30:02"],
    ],
    [
      "a time to resolve, up to 20 hours",
      "s",
      [3600, 40000, 72000],
      [0, "auto"],
      ["0 h", "6 h", "12 h", "18 h", "1 d"],
    ],
    [
      "a host's uptime of twelve days, over an hour",
      "s",
      [1036800, 1038600, 1040400],
      ["auto", "auto"],
      ["12 d 00:00", "12 d 00:15", "12 d 00:30", "12 d 00:45", "12 d 01:00"],
    ],
    [
      "the same uptime over a day",
      "s",
      [1036800, 1080000, 1123200],
      ["auto", "auto"],
      ["12 d", "12 d 6 h", "12 d 12 h", "12 d 18 h", "13 d"],
    ],
    [
      "a certificate's time left, up to three weeks",
      "s",
      [86400, 900000, 1814400],
      [0, "auto"],
      ["0 d", "7 d", "14 d", "21 d"],
    ],
    [
      "a trace's spans, 1.2 ms to 1.8 ms, in nanoseconds",
      "ns",
      [1.2e6, 1.5e6, 1.8e6],
      ["auto", "auto"],
      ["1.2 ms", "1.4 ms", "1.6 ms", "1.8 ms"],
    ],
    [
      "a wait in microseconds, up to 3 µs",
      "us",
      [0.4, 1.6, 2.9],
      [0, "auto"],
      ["0 µs", "1 µs", "2 µs", "3 µs"],
    ],
    [
      "a metric in minutes, up to 200 minutes",
      "min",
      [10, 120, 200],
      [0, "auto"],
      ["0 h", "1 h", "2 h", "3 h", "4 h"],
    ],
  ])(
    "%s",
    (
      _name: string,
      unit: string,
      values: Array<number>,
      domain: Array<number | "auto">,
      expected: Array<string>,
    ) => {
      const axis: ValueAxisTicks = durationAxis({
        values: values,
        unit: unit,
        domain: domain,
      });

      expect(axis.labels).toEqual(expected.map(nb));
      expect(
        isNaturalStep(
          axis.precision!.step *
            (ValueFormatter.getDurationUnitInSeconds(unit) as number),
        ),
      ).toBe(true);
    },
  );

  test("before: the issue's job read decimal fractions of an hour, stepped by recharts' or by a decimal second", () => {
    const decimal: ValueAxisTicks = getValueAxisTicks({
      values: [5398.2, 5400, 5401.7],
      domain: ["auto", "auto"],
      allowDecimals: true,
      // A seconds formatter as a host wrote it before: the step, nothing more.
      formatter: (value: number, precision?: ValueAxisPrecision): string => {
        return ValueFormatter.formatValue(value, "s", {
          step: precision?.step,
        });
      },
    });

    // Still never "1.5003 hours": a span of time is written in units of time.
    for (const label of decimal.labels) {
      expect(label).not.toMatch(/hours/);
    }
  });

  test("the tooltip of an axis whose own figures cannot tell its ticks apart reads to its step", () => {
    const issue: ValueAxisTicks = durationAxis({
      values: [5398.2, 5400, 5401.7],
      unit: "s",
    });
    // Its own figures: "1.5 hours" on every tick.
    expect(
      issue.ticks!.map((tick: number): string => {
        return ValueFormatter.formatValue(tick, "s");
      }),
    ).toEqual(Array(5).fill(`1.5${NBSP}hours`));
    expect(issue.tooltipPrecision).toEqual(issue.precision);
    expect(
      ValueFormatter.formatValue(5400.6, "s", {
        step: issue.tooltipPrecision!.step,
        largestTick: issue.tooltipPrecision!.largestTick,
      }),
    ).toBe("1:30:01");

    // A wide one keeps its own figures: "1.52 hours".
    const wide: ValueAxisTicks = durationAxis({
      values: [900, 4000, 7000],
      unit: "s",
      domain: [0, "auto"],
    });
    expect(wide.tooltipPrecision).toBeUndefined();
  });
});

describe("in the reader's language", () => {
  test.each([
    [
      "de",
      ["0 Min.", "30 Min.", "1 Std.", "1 Std. 30 Min.", "2 Std."],
      ["1:29:58", "1:29:59", "1:30:00", "1:30:01", "1:30:02"],
      [
        "12 Tg. 00:00",
        "12 Tg. 00:15",
        "12 Tg. 00:30",
        "12 Tg. 00:45",
        "12 Tg. 01:00",
      ],
    ],
    [
      "fa",
      ["۰ دقیقه", "۳۰ دقیقه", "۱ ساعت", "۱ ساعت ۳۰ دقیقه", "۲ ساعت"],
      ["۱:۲۹:۵۸", "۱:۲۹:۵۹", "۱:۳۰:۰۰", "۱:۳۰:۰۱", "۱:۳۰:۰۲"],
      [
        "۱۲ روز ۰۰:۰۰",
        "۱۲ روز ۰۰:۱۵",
        "۱۲ روز ۰۰:۳۰",
        "۱۲ روز ۰۰:۴۵",
        "۱۲ روز ۰۱:۰۰",
      ],
    ],
    [
      "ar",
      ["0 د", "30 د", "1 س", "1 س 30 د", "2 س"],
      ["1:29:58", "1:29:59", "1:30:00", "1:30:01", "1:30:02"],
      [
        "12 يومًا 00:00",
        "12 يومًا 00:15",
        "12 يومًا 00:30",
        "12 يومًا 00:45",
        "12 يومًا 01:00",
      ],
    ],
    [
      "ja",
      ["0 分", "30 分", "1 時間", "1 時間 30 分", "2 時間"],
      ["1:29:58", "1:29:59", "1:30:00", "1:30:01", "1:30:02"],
      [
        "12 日 00:00",
        "12 日 00:15",
        "12 日 00:30",
        "12 日 00:45",
        "12 日 01:00",
      ],
    ],
    [
      "fr",
      ["0 min", "30 min", "1 h", "1 h 30 min", "2 h"],
      ["1:29:58", "1:29:59", "1:30:00", "1:30:01", "1:30:02"],
      ["12 j 00:00", "12 j 00:15", "12 j 00:30", "12 j 00:45", "12 j 01:00"],
    ],
    [
      "da",
      ["0 min.", "30 min.", "1 t.", "1 t. 30 min.", "2 t."],
      ["1.29.58", "1.29.59", "1.30.00", "1.30.01", "1.30.02"],
      [
        "12 dage 00.00",
        "12 dage 00.15",
        "12 dage 00.30",
        "12 dage 00.45",
        "12 dage 01.00",
      ],
    ],
  ])(
    "%s: a batch job's two hours, the issue's job, a host's uptime",
    (
      language: string,
      twoHours: Array<string>,
      issue: Array<string>,
      uptime: Array<string>,
    ) => {
      expect(
        durationAxis({
          values: [900, 4000, 7000],
          unit: "s",
          domain: [0, "auto"],
          language: language,
        }).labels,
      ).toEqual(twoHours.map(nb));
      expect(
        durationAxis({
          values: [5398.2, 5400, 5401.7],
          unit: "s",
          language: language,
        }).labels,
      ).toEqual(issue.map(nb));
      expect(
        durationAxis({
          values: [1036800, 1038600, 1040400],
          unit: "s",
          language: language,
        }).labels,
      ).toEqual(uptime.map(nb));
    },
  );

  test("a language steps an axis as English does: the same ticks", () => {
    for (const values of [
      [900, 4000, 7000],
      [5398.2, 5401.7],
      [1036800, 1040400],
      [12, 1480],
    ]) {
      const english: ValueAxisTicks = durationAxis({ values, unit: "s" });

      for (const language of ["de", "fa", "ar", "ja", "ru", "zh-CN", "hi"]) {
        expect(
          durationAxis({ values, unit: "s", language: language }).ticks,
        ).toEqual(english.ticks);
      }
    }
  });
});

describe("every duration axis steps evenly, in natural units of time, with the fewest figures", () => {
  const units: Array<{ unit: string; inSeconds: number }> = [
    { unit: "s", inSeconds: 1 },
    { unit: "ms", inSeconds: 0.001 },
    { unit: "ns", inSeconds: 1e-9 },
    { unit: "min", inSeconds: 60 },
  ];

  test.each(units)(
    "$unit: a seeded sweep of 600 axes, spans from a millisecond to eight weeks",
    ({ unit, inSeconds }: { unit: string; inSeconds: number }) => {
      const random: SeededRandom = seededRandom(10118);
      const readOptions: { durationUnitInSeconds: number } = {
        durationUnitInSeconds: inSeconds,
      };

      for (let index: number = 0; index < 600; index++) {
        // A span from a millisecond to eight weeks, somewhere from 0 to 60 days in.
        const spanInSeconds: number = Math.pow(10, -3 + random() * 9.7);
        const startInSeconds: number =
          random(3) === 0 ? 0 : Math.pow(10, -3 + random() * 9.7);
        const values: Array<number> = [0, 0.3, 0.7, 1].map(
          (part: number): number => {
            return (startInSeconds + part * spanInSeconds) / inSeconds;
          },
        );
        const isFromZero: boolean = random(2) === 0;
        const axis: ValueAxisTicks = durationAxis({
          values: values,
          unit: unit,
          domain: isFromZero ? [0, "auto"] : ["auto", "auto"],
        });
        const ticks: Array<number> = axis.ticks as Array<number>;
        const step: number = (axis.precision as ValueAxisPrecision).step;

        expect(axis.precision).toBeDefined();
        // A natural step of time.
        expect(isNaturalStep(step * inSeconds)).toBe(true);
        // Evenly: each tick a step past the one below it, to twelve figures.
        for (let place: number = 1; place < ticks.length; place++) {
          expect(
            Math.abs(ticks[place]! - ticks[place - 1]! - step),
          ).toBeLessThanOrEqual(Math.max(step, Math.abs(ticks[place]!)) * 1e-9);
        }
        // About five ticks, taking every value in.
        expect(ticks.length).toBeGreaterThanOrEqual(FEWEST_VALUE_AXIS_TICKS);
        expect(ticks.length).toBeLessThanOrEqual(MOST_VALUE_AXIS_TICKS);
        expect(ticks[0]!).toBeLessThanOrEqual(Math.min(...values));
        expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(
          Math.max(...values),
        );
        // Never finer than five figures of the axis's largest value.
        const largest: number = Math.max(...values.map(Math.abs));
        expect(step).toBeGreaterThanOrEqual(
          Math.pow(
            10,
            Math.floor(Math.log10(largest)) - FINEST_TICK_FIGURES + 1,
          ) *
            (1 - 1e-9),
        );
        // Neighbours apart, each tick its own value, the fewest figures.
        expect(areNeighboursApart(axis.labels)).toBe(true);
        expect(isEveryTickExact(ticks, axis.labels, readOptions)).toBe(true);
        expect(
          isOneFigureFewerWorse(ticks, axis.labels, readOptions, step),
        ).toBe(true);

        // One way across the axis: a clock, or units; and no decimal of a minute, an hour or a day.
        const kinds: Set<string> = new Set<string>(
          axis.labels.map((label: string): string => {
            const read: ReadTick = readTick(label, readOptions);

            return read.kind === "clock" ? "clock" : "units";
          }),
        );
        expect(kinds.size).toBe(1);
        for (const label of axis.labels) {
          expect(label).not.toMatch(/\d[.,]\d+\u00A0(min|h|d)(\u00A0|$)/);
          expect(label).not.toMatch(/hours|days/);
        }

        // The tooltip takes the step only where the formatter's own figures fail.
        const ownFigures: Array<string> = ticks.map((tick: number): string => {
          return ValueFormatter.formatValue(tick, unit);
        });
        expect(axis.tooltipPrecision).toEqual(
          areNeighboursApart(ownFigures) ? undefined : axis.precision,
        );
      }
    },
  );

  test.each(["de", "fa", "ar", "ja", "ru", "hi", "zh-CN"])(
    "%s: a seeded sweep of 300 axes in seconds: neighbours apart, in the language's digits",
    (language: string) => {
      const random: SeededRandom = seededRandom(10118);

      for (let index: number = 0; index < 300; index++) {
        const spanInSeconds: number = Math.pow(10, -3 + random() * 9.7);
        const startInSeconds: number =
          random(3) === 0 ? 0 : Math.pow(10, -3 + random() * 9.7);
        const values: Array<number> = [
          startInSeconds,
          startInSeconds + spanInSeconds,
        ];
        const axis: ValueAxisTicks = durationAxis({
          values: values,
          unit: "s",
          language: language,
        });
        const labels: Array<string> = axis.labels.map(
          (label: string): string => {
            return label.replace(INVISIBLE_MARKS, "");
          },
        );

        expect(areNeighboursApart(labels)).toBe(true);
        for (const label of labels) {
          // Held together: a tick never breaks over two lines.
          expect(label).not.toMatch(/ /);

          const words: string = label.replace(SUB_SECOND_SYMBOLS, "");

          if (language === "fa") {
            // Persian digits, Persian words: no Latin digit, no Latin word.
            expect(LATIN_DIGIT.test(label)).toBe(false);
            expect(LATIN_WORD.test(words)).toBe(false);
          }
          if (language === "ar") {
            // Latin digits, Arabic words.
            expect(LATIN_DIGIT.test(label)).toBe(true);
            expect(LATIN_WORD.test(words)).toBe(false);
          }
        }
      }
    },
  );
});
