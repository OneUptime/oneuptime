import { describe, expect, test } from "@jest/globals";
import ValueFormatter, {
  ValueFormatterOptions,
} from "../../Utils/ValueFormatter";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import {
  NBSP,
  ReadTick,
  TIME_UNIT_SECONDS,
  readTick,
} from "../Helpers/AxisTickLabels";
import { DURATION_STEPS_IN_SECONDS } from "../../UI/Components/Charts/Utils/ValueAxisTicks";

/*
 * ISSUE #10118: A SPAN OF TIME ON AN AXIS THAT HANDS ITS STEP OVER IS
 * WRITTEN IN UNITS OF TIME, NEVER IN DECIMAL FRACTIONS OF AN HOUR.
 *
 * A duration axis stepping a second near an hour and a half read "1.5000
 * hours", "1.5003 hours", "1.5006 hours": distinct, close to their values,
 * and nothing anyone reads an hour as. With a step, a span of time is now
 * written:
 *
 *   - under a minute, as the formatter always scales one, with the figures
 *     the step needs: "45 sec", "1.25 sec", "250 ms";
 *   - from a minute, in the units from its largest down to the step's, by
 *     their short names, the ones that are zero left out: "1 h 30 min";
 *   - where that takes three units or more, as a clock: "1:30:02", "12 d
 *     05:30".
 *
 * In the reader's language: its unit names, digits, decimal sign, minus
 * and clock separator. Without a step, a span of time reads as before.
 */

// A label as it is drawn: every space a no-break one, so no tick breaks.
function nb(text: string): string {
  return text.replace(/ /g, NBSP);
}

// The marks Intl sets around a figure in Arabic and Persian, which are never drawn.
const INVISIBLE_MARKS: RegExp = /\p{Cf}/gu;

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;

function write(
  value: number,
  unit: string,
  options?: ValueFormatterOptions,
): string {
  return ValueFormatter.formatValue(value, unit, options);
}

// A tick of a seconds axis stepping `step` whose largest tick is `largestTick`.
function tick(
  value: number,
  step: number,
  largestTick: number,
  language?: string,
): string {
  return write(value, "s", {
    step: step,
    largestTick: largestTick,
    language: language,
  });
}

describe("without a step, a span of time reads as it always has", () => {
  test.each([
    [5400, "s", `1.5${NBSP}hours`],
    [5401, "s", `1.5${NBSP}hours`],
    [90, "s", `1.5${NBSP}min`],
    [1.25, "s", `1.25${NBSP}sec`],
    [250, "ms", `250${NBSP}ms`],
    [0, "s", `0${NBSP}sec`],
    [90, "min", `90${NBSP}min`],
  ])("%s %s reads %s", (value: number, unit: string, expected: string) => {
    expect(write(value, unit)).toBe(expected);
  });
});

describe("the issue's axis: a second's step near an hour and a half", () => {
  test("a clock, never 1.5000 hours", () => {
    const labels: Array<string> = [5398, 5399, 5400, 5401, 5402].map(
      (value: number): string => {
        return tick(value, 1, 5402);
      },
    );

    expect(labels).toEqual([
      "1:29:58",
      "1:29:59",
      "1:30:00",
      "1:30:01",
      "1:30:02",
    ]);
    for (const label of labels) {
      expect(label).not.toMatch(/hours/);
    }
  });

  test.each([
    ["en", "1:30:01"],
    ["de", "1:30:01"],
    ["fa", "۱:۳۰:۰۱"],
    ["ar", "1:30:01"],
    ["ja", "1:30:01"],
    // Danish writes a time of day with points, and a clock so too.
    ["da", "1.30.01"],
  ])("%s: %s", (language: string, expected: string) => {
    expect(tick(5401, 1, 5402, language)).toBe(expected);
  });

  test("a half second's step keeps its figure after the point, in the language's decimal sign", () => {
    expect(tick(5400.5, 0.5, 5401)).toBe("1:30:00.5");
    expect(tick(5400.5, 0.5, 5401, "de")).toBe("1:30:00,5");
    expect(tick(5400.5, 0.5, 5401, "fa")).toBe("۱:۳۰:۰۰٫۵");
    // Every tick keeps it, zeros too, so the ticks line up.
    expect(tick(5401, 0.5, 5401)).toBe("1:30:01.0");
  });
});

describe("from a minute: the units from the largest down to the step's", () => {
  test.each([
    // An axis stepping half an hour, up to two hours.
    [0, 1800, 7200, "0 min"],
    [1800, 1800, 7200, "30 min"],
    [3600, 1800, 7200, "1 h"],
    [5400, 1800, 7200, "1 h 30 min"],
    [7200, 1800, 7200, "2 h"],
    // A quarter of an hour.
    [2700, 900, 3600, "45 min"],
    [4500, 900, 5400, "1 h 15 min"],
    // Seconds, up to a minute and a half.
    [45, 15, 90, "45 sec"],
    [60, 30, 90, "1 min"],
    [90, 30, 90, "1 min 30 sec"],
    // Half a second's step past a minute: seconds take the figure after the point.
    [90.5, 0.5, 120, "1 min 30.5 sec"],
    [30, 0.5, 120, "30.0 sec"],
    // Six hours, past a day.
    [64800, 21600, 86400, "18 h"],
    [86400, 21600, 108000, "1 d"],
    [108000, 21600, 108000, "1 d 6 h"],
    // Days and weeks.
    [216000, 43200, 259200, "2 d 12 h"],
    [604800, 604800, 1814400, "7 d"],
    [1814400, 604800, 1814400, "21 d"],
  ])(
    "%s sec on an axis stepping %s sec up to %s sec reads %s",
    (value: number, step: number, largestTick: number, expected: string) => {
      expect(tick(value, step, largestTick)).toBe(nb(expected));
    },
  );

  test("a negative span keeps its minus before its first unit", () => {
    expect(tick(-5400, 1800, 7200)).toBe(nb("-1 h 30 min"));
    expect(tick(-5401, 1, 5402)).toBe("-1:30:01");
  });

  test("no unit names a decimal fraction of a minute, an hour or a day", () => {
    for (const value of [3600, 5400, 86400, 129600, 1814400]) {
      for (const step of [60, 900, 1800, 3600, 21600, 86400]) {
        const label: string = tick(value, step, 1814400);

        expect(label).not.toMatch(/\d[.,]\d+\u00A0(min|h|d)\b/);
      }
    }
  });
});

describe("three units or more: a clock", () => {
  test.each([
    // A second's step near an hour and a half.
    [5401, 1, 5402, "1:30:01"],
    // Every tick of an axis that reaches an hour is a clock, those under it too.
    [3599, 1, 3602, "0:59:59"],
    [3600, 1, 3602, "1:00:00"],
    // A host's uptime of twelve days, a quarter of an hour at a time.
    [1036800, 900, 1040400, "12 d 00:00"],
    [1056600, 900, 1058400, "12 d 05:30"],
    // Ten seconds at a time.
    [1056610, 10, 1056640, "12 d 05:30:10"],
    // Under a day, on an axis that reaches past one.
    [86280, 60, 86520, "0 d 23:58"],
  ])(
    "%s sec on an axis stepping %s sec up to %s sec reads %s",
    (value: number, step: number, largestTick: number, expected: string) => {
      expect(tick(value, step, largestTick)).toBe(nb(expected));
    },
  );

  test("without the axis's largest tick, each value takes the units it needs itself", () => {
    expect(write(3599, "s", { step: 1 })).toBe(nb("59 min 59 sec"));
    expect(write(3600, "s", { step: 1 })).toBe("1:00:00");
  });
});

describe("under a minute: scaled as the formatter always scales a span", () => {
  test.each([
    [45, "s", 15, 45, "45 sec"],
    [1.25, "s", 0.25, 1.25, "1.25 sec"],
    [1, "s", 0.25, 1.25, "1.00 sec"],
    [0.25, "s", 0.25, 1.25, "250 ms"],
    // A zero takes the unit of the step: "0 ms" beside "250 ms", not "0.00 sec".
    [0, "s", 0.25, 1.25, "0 ms"],
    [0, "s", 15, 45, "0 sec"],
    [250, "ms", 250, 1000, "250 ms"],
    [1250, "ms", 250, 1250, "1.25 sec"],
    [0, "ms", 250, 1000, "0 ms"],
    [1.5, "ms", 0.5, 2, "1.5 ms"],
    [2.5, "us", 0.5, 3, "2.5 µs"],
    [120, "ns", 20, 200, "120 ns"],
    [1.2e6, "ns", 2e5, 1.8e6, "1.2 ms"],
  ])(
    "%s %s on an axis stepping %s up to %s reads %s",
    (
      value: number,
      unit: string,
      step: number,
      largestTick: number,
      expected: string,
    ) => {
      expect(write(value, unit, { step: step, largestTick: largestTick })).toBe(
        nb(expected),
      );
    },
  );
});

describe("in every unit of time a metric is reported in", () => {
  test.each([
    [5400000, "ms", 1800000, 7200000, "1 h 30 min"],
    [5401000, "ms", 1000, 5402000, "1:30:01"],
    [5.4e9, "us", 1.8e9, 7.2e9, "1 h 30 min"],
    [5.4e12, "ns", 1.8e12, 7.2e12, "1 h 30 min"],
    [90, "min", 15, 120, "1 h 30 min"],
    [90, "minutes", 30, 120, "1 h 30 min"],
    [36, "h", 6, 48, "1 d 12 h"],
    [14, "d", 7, 21, "14 d"],
    [5400, "seconds", 1800, 7200, "1 h 30 min"],
  ])(
    "%s %s on an axis stepping %s up to %s reads %s",
    (
      value: number,
      unit: string,
      step: number,
      largestTick: number,
      expected: string,
    ) => {
      expect(write(value, unit, { step: step, largestTick: largestTick })).toBe(
        nb(expected),
      );
    },
  );

  test("the seconds one value of each stands for, and none for a rate or any other unit", () => {
    expect(ValueFormatter.getDurationUnitInSeconds("s")).toBe(1);
    expect(ValueFormatter.getDurationUnitInSeconds("Seconds")).toBe(1);
    expect(ValueFormatter.getDurationUnitInSeconds("ms")).toBe(0.001);
    expect(ValueFormatter.getDurationUnitInSeconds("us")).toBe(0.000001);
    expect(ValueFormatter.getDurationUnitInSeconds("µs")).toBe(0.000001);
    expect(ValueFormatter.getDurationUnitInSeconds("ns")).toBe(0.000000001);
    expect(ValueFormatter.getDurationUnitInSeconds("min")).toBe(60);
    expect(ValueFormatter.getDurationUnitInSeconds("h")).toBe(3600);
    expect(ValueFormatter.getDurationUnitInSeconds("d")).toBe(86400);
    for (const unit of [
      "By",
      "ms/s",
      "s/s",
      "%",
      "1",
      "",
      "{requests}",
      "Cel",
    ]) {
      expect(ValueFormatter.getDurationUnitInSeconds(unit)).toBeUndefined();
    }
    expect(ValueFormatter.getDurationUnitInSeconds(undefined)).toBeUndefined();
  });

  test("a rate of time is no span of time: it keeps its figures", () => {
    expect(write(1.25, "s/s", { step: 0.25, largestTick: 2 })).toBe(
      nb("1.25 sec/s"),
    );
  });
});

describe("in the reader's language", () => {
  test.each([
    [
      "de",
      "1 Std. 30 Min.",
      "45 Min.",
      "2 Tg. 12 Std.",
      "1 Min. 30,5 Sek.",
      "12 Tg. 05:30",
    ],
    ["fr", "1 h 30 min", "45 min", "2 j 12 h", "1 min 30,5 s", "12 j 05:30"],
    ["es", "1 h 30 min", "45 min", "2 d 12 h", "1 min 30,5 s", "12 d 05:30"],
    [
      "ru",
      "1 ч 30 мин",
      "45 мин",
      "2 дн. 12 ч",
      "1 мин 30,5 с",
      "12 дн. 05:30",
    ],
    [
      "fa",
      "۱ ساعت ۳۰ دقیقه",
      "۴۵ دقیقه",
      "۲ روز ۱۲ ساعت",
      "۱ دقیقه ۳۰٫۵ ثانیه",
      "۱۲ روز ۰۵:۳۰",
    ],
    ["ar", "1 س 30 د", "45 د", "2 يوم 12 س", "1 د 30.5 ث", "12 يومًا 05:30"],
    [
      "hi",
      "1 घं॰ 30 मि॰",
      "45 मि॰",
      "2 दिन 12 घं॰",
      "1 मि॰ 30.5 से॰",
      "12 दिन 05:30",
    ],
    [
      "ja",
      "1 時間 30 分",
      "45 分",
      "2 日 12 時間",
      "1 分 30.5 秒",
      "12 日 05:30",
    ],
    ["ko", "1시간 30분", "45분", "2일 12시간", "1분 30.5초", "12일 05:30"],
    [
      "zh-CN",
      "1小时 30分钟",
      "45分钟",
      "2天 12小时",
      "1分钟 30.5秒",
      "12天 05:30",
    ],
    [
      "da",
      "1 t. 30 min.",
      "45 min.",
      "2 dage 12 t.",
      "1 min. 30,5 sek.",
      "12 dage 05.30",
    ],
  ])(
    "%s: %s, %s, %s, %s, %s",
    (
      language: string,
      hourAndAHalf: string,
      threeQuarters: string,
      twoAndAHalfDays: string,
      minuteAndAHalf: string,
      uptime: string,
    ) => {
      expect(tick(5400, 1800, 7200, language)).toBe(nb(hourAndAHalf));
      expect(tick(2700, 900, 3600, language)).toBe(nb(threeQuarters));
      expect(tick(216000, 43200, 259200, language)).toBe(nb(twoAndAHalfDays));
      expect(tick(90.5, 0.5, 120, language)).toBe(nb(minuteAndAHalf));
      expect(tick(1056600, 900, 1058400, language)).toBe(nb(uptime));
    },
  );

  test("Arabic writes a figure before one day or two, which its own words leave out", () => {
    // Intl's Arabic writes one day as "يوم" and two as "يومان", with no figure.
    expect(tick(86400, 86400, 172800, "ar")).toBe(nb("1 يوم"));
    expect(tick(172800, 86400, 172800, "ar")).toBe(nb("2 يوم"));
  });

  test("a negative span in the language's minus", () => {
    expect(tick(-5400, 1800, 7200, "fa").replace(INVISIBLE_MARKS, "")).toBe(
      nb("−۱ ساعت ۳۰ دقیقه"),
    );
    expect(tick(-5401, 1, 5402, "sv")).toBe("−1:30:01");
  });

  test("English, and no language, write the axis's symbols", () => {
    expect(tick(5400, 1800, 7200, "en")).toBe(nb("1 h 30 min"));
    expect(tick(5400, 1800, 7200, "en-GB")).toBe(nb("1 h 30 min"));
    expect(tick(5400, 1800, 7200)).toBe(nb("1 h 30 min"));
  });
});

describe("every space in a tick is a no-break one: a tick never breaks over two lines", () => {
  test.each(["en", "de", "fa", "ar", "ja", "fr", "ru"])(
    "%s",
    (language: string) => {
      for (const [value, step, largestTick] of [
        [5400, 1800, 7200],
        [1056600, 900, 1058400],
        [90.5, 0.5, 120],
        [45, 15, 45],
        [216000, 43200, 259200],
      ] as Array<[number, number, number]>) {
        expect(tick(value, step, largestTick, language)).not.toMatch(/ /);
      }
    },
  );
});

describe("formatValueInParts and formatValueCompact with a step write the same units", () => {
  test("the whole tick as the value, no separate unit", () => {
    expect(
      ValueFormatter.formatValueInParts(5400, "s", {
        step: 1800,
        largestTick: 7200,
      }),
    ).toEqual({
      value: nb("1 h 30 min"),
      unit: "",
      formatted: nb("1 h 30 min"),
    });
    expect(
      ValueFormatter.formatValueCompact(5401, "s", {
        step: 1,
        largestTick: 5402,
      }).formatted,
    ).toBe("1:30:01");
  });

  test("the compact style writes a second as a value tile does: s", () => {
    expect(
      ValueFormatter.formatValueCompact(90, "s", {
        step: 30,
        largestTick: 120,
      }).formatted,
    ).toBe(nb("1 min 30 s"));
    expect(
      ValueFormatter.formatValueCompact(45, "s", {
        step: 15,
        largestTick: 45,
      }).formatted,
    ).toBe(nb("45 s"));
    // The readable style, a chart's, keeps "sec".
    expect(tick(90, 30, 120)).toBe(nb("1 min 30 sec"));
    // Compact, every language names a unit by its symbol, in its own figures.
    expect(
      ValueFormatter.formatValueCompact(90, "s", {
        step: 30,
        largestTick: 120,
        language: "de",
      }).formatted,
    ).toBe(nb("1 min 30 s"));
    expect(
      ValueFormatter.formatValueCompact(5400, "s", {
        step: 1800,
        largestTick: 7200,
        language: "fa",
      }).formatted,
    ).toBe(nb("۱ h ۳۰ min"));
    // And a value under a minute, as a value tile writes one.
    expect(
      ValueFormatter.formatValueCompact(45, "s", {
        step: 15,
        largestTick: 45,
        language: "de",
      }).formatted,
    ).toBe(nb("45 s"));
  });
});

/*
 * The natural steps of time a duration axis takes (ValueAxisTicks), and the
 * round decimal ones below a second.
 */
function getNaturalSteps(): Array<number> {
  const steps: Array<number> = [...DURATION_STEPS_IN_SECONDS];

  for (let power: number = -9; power <= -1; power++) {
    for (const mantissa of [1, 2, 2.5, 5]) {
      steps.push(Number((mantissa * Math.pow(10, power)).toPrecision(12)));
    }
  }

  for (const days of [20, 50, 100, 200, 500]) {
    steps.push(days * 86400);
  }

  return steps;
}

describe("a seeded sweep: every natural step, from milliseconds to weeks", () => {
  test("each tick reads its own value, a step from its neighbours, in units of time", () => {
    const random: SeededRandom = seededRandom(10118);
    const steps: Array<number> = getNaturalSteps();

    for (let index: number = 0; index < 3000; index++) {
      const step: number = steps[random(steps.length)] as number;
      const ticksPerAxis: number = 3 + random(4);
      const start: number = (random(200000) - 20000) * step;
      const ticks: Array<number> = [];

      for (let place: number = 0; place < ticksPerAxis; place++) {
        ticks.push(Number(((start / step + place) * step).toPrecision(12)));
      }

      const largestTick: number = Math.max(
        Math.abs(ticks[0] as number),
        Math.abs(ticks[ticks.length - 1] as number),
      );

      // Never finer than five figures of the axis's largest tick, as the axis steps.
      if (
        largestTick > 0 &&
        step < Math.pow(10, Math.floor(Math.log10(largestTick)) - 4)
      ) {
        continue;
      }

      const labels: Array<string> = ticks.map((value: number): string => {
        return tick(value, step, largestTick);
      });
      const kinds: Set<string> = new Set<string>();

      labels.forEach((label: string, place: number): void => {
        const read: ReadTick = readTick(label, { durationUnitInSeconds: 1 });
        const value: number = ticks[place] as number;

        kinds.add(read.kind === "clock" ? "clock" : "units");
        // Its own value, to its last figure.
        expect(Math.abs(read.value - value)).toBeLessThanOrEqual(
          read.resolution / 2 + Math.abs(value) * 1e-12,
        );
        // A unit of a minute or more never takes a figure after the point.
        expect(label).not.toMatch(/\d[.,]\d+\u00A0(min|h|d)$/);
        expect(label).not.toMatch(/\d[.,]\d+\u00A0(min|h|d)\u00A0/);
        if (place > 0) {
          expect(label).not.toBe(labels[place - 1]);
        }
      });

      // One axis is all clocks, or all units: never "59 min 59 sec" beside "1:00:00".
      expect(kinds.size).toBe(1);
    }
  });

  test.each(["de", "fa", "ar", "ja", "ru"])(
    "%s: neighbours read apart; Persian holds no Latin digit or letter past a minute, Arabic no Latin letter",
    (language: string) => {
      const random: SeededRandom = seededRandom(10118);
      const steps: Array<number> = getNaturalSteps().filter(
        (step: number): boolean => {
          return step >= 1;
        },
      );

      for (let index: number = 0; index < 600; index++) {
        const step: number = steps[random(steps.length)] as number;
        const start: number = random(5000) * step;
        const ticks: Array<number> = [0, 1, 2, 3, 4].map(
          (place: number): number => {
            return start + place * step;
          },
        );
        const largestTick: number = ticks[4] as number;

        if (largestTick < 60) {
          continue;
        }

        const labels: Array<string> = ticks.map((value: number): string => {
          return tick(value, step, largestTick, language).replace(
            INVISIBLE_MARKS,
            "",
          );
        });

        for (let place: number = 1; place < labels.length; place++) {
          expect(labels[place]).not.toBe(labels[place - 1]);
        }

        for (const label of labels) {
          if (language === "fa") {
            expect(LATIN_DIGIT.test(label)).toBe(false);
            expect(LATIN_LETTER.test(label)).toBe(false);
          }
          if (language === "ar") {
            expect(LATIN_LETTER.test(label)).toBe(false);
            expect(LATIN_DIGIT.test(label)).toBe(true);
          }
          expect(label).not.toMatch(/ /);
        }
      }
    },
  );
});

describe("the units a tick is read in", () => {
  test("the test's own reading of a tick", () => {
    expect(readTick(nb("1 h 30 min"), { durationUnitInSeconds: 1 }).value).toBe(
      5400,
    );
    expect(readTick(nb("12 d 05:30"), { durationUnitInSeconds: 1 }).value).toBe(
      12 * 86400 + 5 * 3600 + 30 * 60,
    );
    expect(readTick("1:30:00.5", { durationUnitInSeconds: 1 }).value).toBe(
      5400.5,
    );
    expect(
      readTick(nb("250 ms"), { durationUnitInSeconds: 0.001 }).value,
    ).toBeCloseTo(250, 9);
    expect(TIME_UNIT_SECONDS["h"]).toBe(3600);
    expect(() => {
      return readTick("1.5003 hours", { durationUnitInSeconds: 1 });
    }).toThrow();
  });
});
