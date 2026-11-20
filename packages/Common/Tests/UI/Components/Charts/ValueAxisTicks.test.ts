import { describe, expect, test } from "@jest/globals";
import { getNiceTickValues } from "recharts";
import ValueFormatter, {
  ValueFormatterOptions,
} from "../../../../Utils/ValueFormatter";
import {
  FINEST_TICK_FIGURES,
  ValueAxisTicks,
  areNeighboursApart,
  getChartAxisValues,
  getTickFormatter,
  getValueAxisTicks,
} from "../../../../UI/Components/Charts/Utils/ValueAxisTicks";
import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import {
  Y_AXIS_MAX_WIDTH_IN_PX,
  Y_AXIS_WIDTH_IN_PX,
  getYAxisWidthForLabelsInPx,
} from "../../../../UI/Components/Charts/Utils/YAxisWidth";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * ISSUE #10079: A VALUE AXIS OVER A NARROW RANGE WROTE THE SAME LABEL ON EVERY
 * TICK.
 *
 * A filesystem holding 17.2 GB give or take a few megabytes read "17.2 GB"
 * five times: recharts steps the axis in five ticks, and the formatter keeps
 * about three figures. The chart now works out each axis's ticks as recharts
 * does, and only when two neighbouring ticks would read alike steps the axis
 * itself, in round steps (1, 2, 2.5 or 5 times a power of ten), handing the
 * formatter the step: ValueFormatter then writes each tick with the fewest
 * figures after the point at which neighbouring ticks differ and every tick
 * reads its own value, in the unit scaling it always used. An axis whose
 * ticks already read apart is left exactly as it was.
 */

const NBSP: string = "\u00A0";

// An axis's formatter, as a metric chart builds it: a unit's, in a language.
function axisFormatter(
  unit: string,
  options?: ValueFormatterOptions,
): ValueAxisFormatter {
  return (value: number, precision?: ValueAxisPrecision): string => {
    return ValueFormatter.formatValue(value, unit, {
      ...options,
      step: precision?.step,
    });
  };
}

const bytes: ValueAxisFormatter = axisFormatter("By");
const percent: ValueAxisFormatter = axisFormatter("%");
const milliseconds: ValueAxisFormatter = axisFormatter("ms");
const count: ValueAxisFormatter = axisFormatter("{processes}");
const cpuFraction: ValueAxisFormatter = axisFormatter("1", {
  metricName: "system.cpu.utilization",
});

// What one of a unit's figures stands for, as the formatter scales it.
const SCALE: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  ns: 1e-6,
  µs: 1e-3,
  ms: 1,
  sec: 1e3,
  min: 6e4,
  hours: 3.6e6,
  days: 8.64e7,
};

const SCALE_LETTER: Record<string, number> = {
  "": 1,
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
  P: 1e15,
};

interface ReadLabel {
  // The value the label says, in the axis's unit.
  value: number;
  // How many figures it was written with after the point.
  decimals: number;
  // What one unit of its last figure is worth, in the axis's unit.
  resolution: number;
}

// An English label: its figure, its scale letter, its unit and its percent sign.
const ENGLISH_LABEL: RegExp =
  /^(-?\d+)(?:\.(\d+))?([KMBTP]?)(?:\u00A0(\S+))?(%?)$/;

/*
 * What an English label says: "17.205 GB" is 17.205e9 bytes, to three
 * figures; "119.200B" is 119.2e9; "99.995%" is 99.995. A fraction metric's
 * percent is read back into its 0-1 fraction by `percentScale`.
 */
function readLabel(label: string, percentScale: number = 1): ReadLabel {
  const match: RegExpExecArray | null = ENGLISH_LABEL.exec(label);

  if (!match) {
    throw new Error(`Not a label the formatter writes: ${label}`);
  }

  const fraction: string = match[2] || "";
  const unit: string = match[4] || "";
  const unitScale: number =
    (match[5] === "%" ? percentScale : SCALE[unit] ?? 1) *
    (SCALE_LETTER[match[3] || ""] as number);

  return {
    value: Number(`${match[1]}${fraction ? `.${fraction}` : ""}`) * unitScale,
    decimals: fraction.length,
    resolution: Math.pow(10, -fraction.length) * unitScale,
  };
}

/*
 * The fewest figures: none after the point, or, written with one figure
 * fewer, two neighbouring ticks would read alike, or a tick would no longer
 * read its own value.
 */
function isOneFigureFewerWorse(
  ticks: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
  percentScale: number = 1,
): boolean {
  if (
    labels.every((label: string): boolean => {
      return readLabel(label, percentScale).decimals === 0;
    })
  ) {
    return true;
  }

  const fewer: Array<string> = labels.map((label: string): string => {
    const read: ReadLabel = readLabel(label, percentScale);

    if (read.decimals === 0) {
      return label;
    }

    const coarser: number = read.resolution * 10;

    return String(Math.round(read.value / coarser));
  });
  const isFewerExact: boolean = ticks.every(
    (tick: number, index: number): boolean => {
      const read: ReadLabel = readLabel(labels[index] as string, percentScale);

      if (read.decimals === 0) {
        return true;
      }

      const coarser: number = read.resolution * 10;

      return (
        Math.abs(Math.round(tick / coarser) * coarser - tick) <=
        Math.abs(tick) * 1e-12 + coarser * 1e-9
      );
    },
  );

  return !areNeighboursApart(fewer) || !isFewerExact;
}

// Every label reads the tick it marks, to its last figure.
function isEveryTickExact(
  ticks: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
  percentScale: number = 1,
): boolean {
  return ticks.every((tick: number, index: number): boolean => {
    const read: ReadLabel = readLabel(labels[index] as string, percentScale);

    return (
      Math.abs(read.value - tick) <=
      read.resolution / 2 + Math.abs(tick) * 1e-12
    );
  });
}

// Two values a little apart, and the points between, as a series moves.
function around(
  center: number,
  span: number,
  points: number = 12,
): Array<number> {
  const values: Array<number> = [];

  for (let index: number = 0; index < points; index++) {
    values.push(center - span / 2 + (span * index) / (points - 1));
  }

  return values;
}

function expectSteppedApart(
  axis: ValueAxisTicks,
  percentScale: number = 1,
): void {
  expect(axis.precision).toBeDefined();
  expect(axis.ticks).toBeDefined();
  expect(areNeighboursApart(axis.labels)).toBe(true);
  expect(isEveryTickExact(axis.ticks!, axis.labels, percentScale)).toBe(true);
  expect(isOneFigureFewerWorse(axis.ticks!, axis.labels, percentScale)).toBe(
    true,
  );

  // Every tick of an axis is written with as many figures.
  const decimals: Set<number> = new Set<number>(
    axis.labels.map((label: string): number => {
      return readLabel(label, percentScale).decimals;
    }),
  );
  expect(decimals.size).toBe(1);

  // A round step: 1, 2, 2.5 or 5 times a power of ten.
  const step: number = axis.precision!.step;
  const mantissa: number = Number(
    (step / Math.pow(10, Math.floor(Math.log10(step)))).toPrecision(6),
  );
  expect([1, 2, 2.5, 5]).toContain(mantissa);
}

describe("an axis whose ticks already read apart is left as recharts steps it", () => {
  test.each([
    ["bytes from 0 to 20 GB", bytes, [0, 7.2e9, 19.6e9]],
    ["bytes over a disk's 40% to 60%", bytes, around(50e9, 20e9)],
    ["percent from 3% to 97%", percent, [3, 40, 97]],
    ["milliseconds from 12 to 1480", milliseconds, [12, 300, 1480]],
    ["a count from 2 to 214", count, [2, 70, 214]],
    ["a 0-1 fraction from 0.1 to 0.9", cpuFraction, [0.1, 0.5, 0.9]],
    ["negative bytes", bytes, [-3e9, -1e9, 2e9]],
    ["a counter in the billions", count, around(119.2e9, 0.2e9)],
  ])(
    "%s",
    (_name: string, formatter: ValueAxisFormatter, values: Array<number>) => {
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: values,
        domain: ["auto", "auto"],
        allowDecimals: true,
        formatter: formatter,
      });

      expect(axis.ticks).toBeUndefined();
      expect(axis.domain).toBeUndefined();
      expect(axis.precision).toBeUndefined();
      expect(areNeighboursApart(axis.labels)).toBe(true);

      // The labels are the formatter's own, at recharts' own ticks.
      const lowest: number = Math.min(...values);
      const highest: number = Math.max(...values);
      expect(axis.labels).toEqual(
        getNiceTickValues([lowest, highest], 5, true, "adaptive").map(
          (tick: number): string => {
            return formatter(tick);
          },
        ),
      );
    },
  );

  test("an axis from zero (a bar chart's, a rate chart's) reads apart, and needs more figures only for a percent near zero", () => {
    const random: SeededRandom = seededRandom(10079);

    for (let index: number = 0; index < 400; index++) {
      const top: number = Math.pow(10, random(18) - 4) * (1 + random() * 9);

      // Bytes, a duration and a count keep two figures however small: never stepped.
      for (const formatter of [bytes, milliseconds, count]) {
        const axis: ValueAxisTicks = getValueAxisTicks({
          values: around(top / 2, top),
          domain: [0, "auto"],
          allowDecimals: true,
          formatter: formatter,
        });

        expect(axis.precision).toBeUndefined();
        expect(areNeighboursApart(axis.labels)).toBe(true);
      }

      // A percent keeps two decimals: from 0% to 0.004%, it is stepped.
      const percentAxis: ValueAxisTicks = getValueAxisTicks({
        values: around(top / 2, top),
        domain: [0, "auto"],
        allowDecimals: true,
        formatter: percent,
      });

      expect(areNeighboursApart(percentAxis.labels)).toBe(true);
      if (top >= 0.1) {
        expect(percentAxis.precision).toBeUndefined();
      }
      if (top < 0.01) {
        expect(percentAxis.precision).toBeDefined();
      }
    }
  });

  test("a percent axis over its fixed 0% to 100% keeps recharts' ticks", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [12, 40, 63],
      domain: [0, 100],
      allowDecimals: true,
      formatter: percent,
    });

    expect(axis.ticks).toBeUndefined();
    expect(axis.labels).toEqual([
      "0.00%",
      "25.00%",
      "50.00%",
      "75.00%",
      "100.00%",
    ]);
  });
});

describe("an axis over a narrow range is stepped so its neighbouring ticks read apart", () => {
  test("the issue's filesystem: 17.2 GB give or take a few megabytes", () => {
    const before: Array<string> = getNiceTickValues(
      [17.2013e9, 17.2047e9],
      5,
      true,
      "adaptive",
    ).map((tick: number): string => {
      return bytes(tick);
    });

    // What the axis read before: one label five times.
    expect(new Set<string>(before)).toEqual(new Set<string>([`17.2${NBSP}GB`]));

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(17.203e9, 3.4e6),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);
    expect(axis.labels).toEqual([
      `17.201${NBSP}GB`,
      `17.202${NBSP}GB`,
      `17.203${NBSP}GB`,
      `17.204${NBSP}GB`,
      `17.205${NBSP}GB`,
    ]);
    // The domain recharts is handed runs over exactly those ticks.
    expect(axis.domain).toEqual([17.201e9, 17.205e9]);
  });

  test.each([
    ["bytes", bytes, 17.2e9, 3e7, 1],
    ["bytes, a few kilobytes on a megabyte", bytes, 1.25e6, 2e3, 1],
    ["percent", percent, 99.995, 0.006, 1],
    ["milliseconds", milliseconds, 250.5, 0.04, 1],
    ["milliseconds past a second", milliseconds, 1840, 0.6, 1],
    ["a count", count, 70.5, 0.003, 1],
    ["a counter in the billions", count, 119.2e9, 4e6, 1],
    ["a 0-1 fraction drawn in percent", cpuFraction, 0.99991, 0.00006, 0.01],
  ])(
    "%s",
    (
      _name: string,
      formatter: ValueAxisFormatter,
      center: number,
      span: number,
      percentScale: number,
    ) => {
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: around(center, span),
        domain: ["auto", "auto"],
        allowDecimals: true,
        formatter: formatter,
      });

      expectSteppedApart(axis, percentScale);
      // Its ticks take the values in.
      expect(axis.ticks![0]!).toBeLessThanOrEqual(center - span / 2);
      expect(axis.ticks![axis.ticks!.length - 1]!).toBeGreaterThanOrEqual(
        center + span / 2,
      );
    },
  );

  test("a negative narrow range", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(-17.203e9, 3.4e6),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);
    expect(axis.labels).toEqual([
      `-17.205${NBSP}GB`,
      `-17.204${NBSP}GB`,
      `-17.203${NBSP}GB`,
      `-17.202${NBSP}GB`,
      `-17.201${NBSP}GB`,
    ]);
  });

  test("a range across zero that a percent axis's two decimals cannot tell apart", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [-0.0012, 0, 0.0021],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: percent,
    });

    expectSteppedApart(axis);
    expect(axis.labels).toContain("0.000%");
    // No minus before a zero.
    expect(axis.labels).not.toContain("-0.000%");
  });

  test("a near-zero percent on its fixed scale: the round ticks between its ends", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0.0003, 0.0009, 0.0016],
      domain: [0, 0.002],
      allowDecimals: true,
      formatter: percent,
    });

    expectSteppedApart(axis);
    // A fixed domain keeps its ends.
    expect(axis.domain).toEqual([0, 0.002]);
    for (const tick of axis.ticks!) {
      expect(tick).toBeGreaterThanOrEqual(0);
      expect(tick).toBeLessThanOrEqual(0.002);
    }
  });

  test("a huge value, petabytes give or take a hundred gigabytes", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(1.2345e15, 3e11),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);
    for (const label of axis.labels) {
      expect(label).toMatch(/^1\.234\d\u00A0PB$/);
    }
  });

  test("petabytes give or take a gigabyte: to five figures, the series drawn flat", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(1.2345e15, 2e9),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);
    expect(axis.precision!.step).toBe(1e11);
    expect(axis.labels).toContain(`1.2345${NBSP}PB`);
  });

  test("whole numbers only: a counter of thousands that moves by a few", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [1000, 1001, 1003],
      domain: ["auto", "auto"],
      allowDecimals: false,
      formatter: count,
    });

    expectSteppedApart(axis);
    for (const tick of axis.ticks!) {
      expect(Number.isInteger(tick)).toBe(true);
    }
  });

  test("a series that never moves reads its value, on ticks that read apart", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [17.2e9, 17.2e9, 17.2e9],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);
    expect(axis.labels).toContain(`17.200${NBSP}GB`);
  });

  test("a byte's rounding on 17.2 GB is never stretched over ticks a byte apart", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [17198482960, 17198482961, 17198482962],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectSteppedApart(axis);

    // Never finer than five figures of the value: ticks a megabyte apart or more.
    expect(axis.precision!.step).toBeGreaterThanOrEqual(
      Math.pow(10, 10 - FINEST_TICK_FIGURES + 1),
    );
    for (const label of axis.labels) {
      expect(readLabel(label).decimals).toBeLessThanOrEqual(3);
    }
  });

  test("a formatter that writes the same whatever it is handed leaves the axis as it was", () => {
    const rounded: ValueAxisFormatter = (value: number): string => {
      return `${Math.round(value / 1e9)} GB`;
    };
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(17.203e9, 3.4e6),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: rounded,
    });

    expect(axis.ticks).toBeUndefined();
    expect(axis.precision).toBeUndefined();
    expect(new Set<string>(axis.labels)).toEqual(new Set<string>(["17 GB"]));
  });

  test("no values: nothing to step", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expect(axis).toEqual({
      ticks: undefined,
      domain: undefined,
      precision: undefined,
      labels: [],
    });
  });
});

describe("in every unit and at every scale, neighbouring ticks read apart with the fewest figures", () => {
  const units: Array<{
    name: string;
    formatter: ValueAxisFormatter;
    percentScale: number;
  }> = [
    { name: "bytes", formatter: bytes, percentScale: 1 },
    { name: "percent", formatter: percent, percentScale: 1 },
    { name: "milliseconds", formatter: milliseconds, percentScale: 1 },
    { name: "a count", formatter: count, percentScale: 1 },
    { name: "a 0-1 fraction", formatter: cpuFraction, percentScale: 0.01 },
  ];

  test.each(units)(
    "$name: a seeded sweep of 600 ranges, narrow and wide, positive and negative",
    ({
      formatter,
      percentScale,
    }: {
      formatter: ValueAxisFormatter;
      percentScale: number;
    }) => {
      const random: SeededRandom = seededRandom(10079);
      let stepped: number = 0;

      for (let index: number = 0; index < 600; index++) {
        const magnitude: number = Math.pow(10, random(20) - 6);
        const center: number =
          magnitude * (1 + random() * 9) * (random(4) === 0 ? -1 : 1);
        const span: number =
          Math.abs(center) * Math.pow(10, -(1 + random() * 8));
        const axis: ValueAxisTicks = getValueAxisTicks({
          values: around(center, span, 2 + random(20)),
          domain: ["auto", "auto"],
          allowDecimals: true,
          formatter: formatter,
        });

        // Whatever the range, no two neighbouring ticks read alike.
        expect(areNeighboursApart(axis.labels)).toBe(true);

        if (axis.precision) {
          stepped++;
          expect(isEveryTickExact(axis.ticks!, axis.labels, percentScale)).toBe(
            true,
          );
          expect(
            isOneFigureFewerWorse(axis.ticks!, axis.labels, percentScale),
          ).toBe(true);
        }
      }

      // The sweep reaches ranges the formatter's own figures cannot tell apart.
      expect(stepped).toBeGreaterThan(100);
    },
  );
});

describe("in the reader's language", () => {
  test.each([
    ["de", "17,201", "17,205"],
    ["fa", "۱۷٫۲۰۱", "۱۷٫۲۰۵"],
    ["en", "17.201", "17.205"],
  ])(
    "%s: the stepped ticks keep their figures in the language's digits",
    (language: string, first: string, last: string) => {
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: around(17.203e9, 3.4e6),
        domain: ["auto", "auto"],
        allowDecimals: true,
        formatter: axisFormatter("By", { language: language }),
      });

      expect(areNeighboursApart(axis.labels)).toBe(true);
      expect(axis.labels[0]).toContain(first);
      expect(axis.labels[axis.labels.length - 1]).toContain(last);
    },
  );

  test("a counter in the billions keeps its figures in German's own scale", () => {
    // Before: German's own two decimals wrote two of its ticks alike.
    expect(
      getValueAxisTicks({
        values: around(119.2e9, 1e7),
        domain: ["auto", "auto"],
        allowDecimals: true,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, "1", { language: "de" });
        },
      }).labels,
    ).toContain("119,2\u00A0Mrd.");

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(119.2e9, 1e7),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: axisFormatter("1", { language: "de" }),
    });

    expect(axis.precision).toBeDefined();
    expect(areNeighboursApart(axis.labels)).toBe(true);
    // Every tick to the hundredth of a billion: "119,20 Mrd.", not "119,2 Mrd.".
    expect(axis.labels).toContain("119,20\u00A0Mrd.");
    for (const label of axis.labels) {
      expect(label).toMatch(/^119,\d{2}\u00A0Mrd\.$/);
    }
  });

  test("a range German's own figures already tell apart reads as it always has", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(119.2e9, 8e7),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: axisFormatter("1", { language: "de" }),
    });

    expect(axis.precision).toBeUndefined();
    expect(axis.labels).toContain("119,2\u00A0Mrd.");
  });
});

describe("the values an axis is drawn over", () => {
  const rows: Array<Record<string, unknown>> = [
    { time: "a", used: 5, free: 3, low: 1, high: 9 },
    { time: "b", used: 7, free: undefined, low: 2, high: "x" },
    { time: "c", used: -2, free: 4, low: 0, high: 8 },
  ];

  test("each series' values, and the lines that stretch the axis", () => {
    expect(
      getChartAxisValues({
        rows: rows,
        categories: ["used", "free"],
        lineValues: [42, undefined],
      }),
    ).toEqual([5, 3, 7, -2, 4, 42]);
  });

  test("stacked bars reach each running sum, from 0", () => {
    expect(
      getChartAxisValues({
        rows: rows,
        categories: ["used", "free"],
        isStacked: true,
      }),
    ).toEqual([0, 5, 8, 0, 7, 7, 0, -2, 2]);
  });

  test("a band's two ends, where both are numbers", () => {
    expect(
      getChartAxisValues({
        rows: rows,
        categories: [],
        bandKeys: ["low", "high"],
      }),
    ).toEqual([1, 9, 0, 8]);
  });
});

describe("the tick formatter recharts is handed", () => {
  test("writes with the axis's precision, and never takes recharts' tick index for it", () => {
    const seen: Array<ValueAxisPrecision | undefined> = [];
    const formatter: ValueAxisFormatter = (
      value: number,
      precision?: ValueAxisPrecision,
    ): string => {
      seen.push(precision);
      return String(value);
    };
    const asRechartsCallsIt: (value: number, index: number) => string =
      getTickFormatter(formatter, undefined) as unknown as (
        value: number,
        index: number,
      ) => string;

    asRechartsCallsIt(5, 3);
    expect(seen).toEqual([undefined]);

    const stepped: (value: number, index: number) => string = getTickFormatter(
      formatter,
      { step: 1 },
    ) as unknown as (value: number, index: number) => string;

    stepped(5, 3);
    expect(seen[1]).toEqual({ step: 1 });
    expect(seen).toHaveLength(2);
  });
});

describe("the axis's width over ticks it has written", () => {
  test("as wide as the widest, never under the chart's own width, and capped", () => {
    expect(getYAxisWidthForLabelsInPx({ labels: [] })).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(getYAxisWidthForLabelsInPx({ labels: ["1 GB"] })).toBe(
      Y_AXIS_WIDTH_IN_PX,
    );
    expect(getYAxisWidthForLabelsInPx({ labels: [`17.20005${NBSP}GB`] })).toBe(
      Math.ceil(11 * 6.2 + 12),
    );
    expect(getYAxisWidthForLabelsInPx({ labels: ["x".repeat(60)] })).toBe(
      Y_AXIS_MAX_WIDTH_IN_PX,
    );
    expect(
      getYAxisWidthForLabelsInPx({ labels: ["1 GB"], minWidthInPx: 90 }),
    ).toBe(90);
  });
});
