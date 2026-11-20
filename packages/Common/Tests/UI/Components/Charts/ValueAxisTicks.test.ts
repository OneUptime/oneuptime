import { describe, expect, test } from "@jest/globals";
import { getNiceTickValues } from "recharts";
import ValueFormatter, {
  ValueFormatterOptions,
} from "../../../../Utils/ValueFormatter";
import {
  FEWEST_VALUE_AXIS_TICKS,
  FINEST_TICK_FIGURES,
  MOST_VALUE_AXIS_TICKS,
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
import {
  NBSP,
  ReadTick,
  getMantissa,
  isEveryTickExact,
  isOneFigureFewerWorse,
  isRoundDecimalStep,
  readTick,
} from "../../../Helpers/AxisTickLabels";

/*
 * ISSUES #10079 AND #10117: EVERY VALUE AXIS STEPS EVENLY, IN ROUND STEPS OF
 * THE UNIT IT IS WRITTEN IN.
 *
 * #10079: a filesystem holding 17.2 GB give or take a few megabytes read
 * "17.2 GB" five times: recharts steps the axis in five ticks, and the
 * formatter keeps about three figures. #10117: an axis whose ticks read
 * apart still stepped unevenly, as recharts' steps are any multiple of 0.05
 * times a power of ten: a node's memory read "7.57 GB", "7.65 GB", "7.74
 * GB". The chart now steps every axis itself, in round steps (1, 2, 2.5 or
 * 5 times a power of ten), and hands the formatter the step: ValueFormatter
 * writes each tick with the fewest figures after the point at which
 * neighbouring ticks differ and every tick reads its own value, in the unit
 * scaling it always used. The axis takes about five ticks, little blank
 * space past its values, and the simplest step (Talbot, Lin and Hanrahan's
 * scoring). An axis whose ticks recharts already stepped roundly keeps them.
 */

// An axis's formatter, as a metric chart builds it: a unit's, in a language.
function axisFormatter(
  unit: string,
  options?: ValueFormatterOptions,
): ValueAxisFormatter {
  return (value: number, precision?: ValueAxisPrecision): string => {
    return ValueFormatter.formatValue(value, unit, {
      ...options,
      step: precision?.step,
      largestTick: precision?.largestTick,
    });
  };
}

const bytes: ValueAxisFormatter = axisFormatter("By");
const byteRate: ValueAxisFormatter = axisFormatter("By/s");
const percent: ValueAxisFormatter = axisFormatter("%");
const count: ValueAxisFormatter = axisFormatter("{processes}");
const celsius: ValueAxisFormatter = axisFormatter("Cel");
const cpuFraction: ValueAxisFormatter = axisFormatter("1", {
  metricName: "system.cpu.utilization",
});

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

/*
 * An axis the chart stepped: its ticks a round step apart, in the unit each
 * tick is written in; neighbours apart; every tick its own value; the
 * fewest figures; every tick of a unit to as many figures.
 */
function expectRoundAndEven(
  axis: ValueAxisTicks,
  percentScale: number = 1,
): void {
  expect(axis.precision).toBeDefined();
  expect(axis.ticks).toBeDefined();

  const ticks: Array<number> = axis.ticks as Array<number>;
  const step: number = (axis.precision as ValueAxisPrecision).step;

  expect(areNeighboursApart(axis.labels)).toBe(true);
  expect(isEveryTickExact(ticks, axis.labels, { percentScale })).toBe(true);
  expect(
    isOneFigureFewerWorse(ticks, axis.labels, { percentScale }, step),
  ).toBe(true);

  // Evenly: each tick a step past the one below it.
  for (let index: number = 1; index < ticks.length; index++) {
    expect(
      Math.abs((ticks[index] as number) - (ticks[index - 1] as number) - step),
    ).toBeLessThanOrEqual(step * 1e-9);
  }

  // A round step in the unit each tick is written in.
  for (const label of axis.labels) {
    const read: ReadTick = readTick(label, { percentScale });

    expect(isRoundDecimalStep(step / read.unitScale)).toBe(true);
  }

  // The ticks of one unit are written with as many figures.
  const decimalsByUnit: Map<string, Set<number>> = new Map();
  for (const label of axis.labels) {
    const read: ReadTick = readTick(label, { percentScale });
    const decimals: Set<number> =
      decimalsByUnit.get(read.lastUnit) || new Set<number>();

    decimals.add(read.decimals);
    decimalsByUnit.set(read.lastUnit, decimals);
  }
  for (const decimals of decimalsByUnit.values()) {
    expect(decimals.size).toBe(1);
  }

  // The axis's precision names its largest tick, for a span of time's units.
  expect(axis.precision!.largestTick).toBe(
    Math.max(Math.abs(ticks[0] as number), Math.abs(ticks[ticks.length - 1]!)),
  );
}

describe("the issue's axes: round steps, read evenly (#10117)", () => {
  test("the node's memory, 7.53 GB to 7.94 GB: a tenth of a gigabyte a tick, not 85 MB", () => {
    const values: Array<number> = around(7.735e9, 0.41e9);
    const before: Array<string> = getNiceTickValues(
      [7.53e9, 7.94e9],
      5,
      true,
      "adaptive",
    ).map((tick: number): string => {
      return bytes(tick);
    });

    // What recharts' own steps read: a step of 150 MB, written to three figures.
    expect(before).toEqual([
      `7.5${NBSP}GB`,
      `7.65${NBSP}GB`,
      `7.8${NBSP}GB`,
      `7.95${NBSP}GB`,
      `8.1${NBSP}GB`,
    ]);

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: values,
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectRoundAndEven(axis);
    expect(axis.labels).toEqual([
      `7.5${NBSP}GB`,
      `7.6${NBSP}GB`,
      `7.7${NBSP}GB`,
      `7.8${NBSP}GB`,
      `7.9${NBSP}GB`,
      `8.0${NBSP}GB`,
    ]);
    // Recharts is handed the ticks, and a domain that runs over exactly them.
    expect(axis.domain).toEqual([7.5e9, 8e9]);
    // The tooltip keeps its own figures: the ticks already read apart.
    expect(axis.tooltipPrecision).toBeUndefined();
  });

  test("the issue's 85 MB steps: what an axis around them reads now", () => {
    // Recharts stepped 7.565 GB to 7.905 GB by 85 MB: "7.57", "7.65", "7.74".
    const recharts: Array<number> = getNiceTickValues(
      [7.57e9, 7.9e9],
      5,
      true,
      "adaptive",
    );
    expect(recharts[1]! - recharts[0]!).toBeCloseTo(0.085e9, -3);
    expect(
      recharts.map((tick: number): string => {
        return bytes(tick);
      }),
    ).toEqual([
      `7.57${NBSP}GB`,
      `7.65${NBSP}GB`,
      `7.74${NBSP}GB`,
      `7.82${NBSP}GB`,
      `7.91${NBSP}GB`,
    ]);

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [7.57e9, 7.66e9, 7.9e9],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectRoundAndEven(axis);
    expect(axis.labels).toEqual([
      `7.5${NBSP}GB`,
      `7.6${NBSP}GB`,
      `7.7${NBSP}GB`,
      `7.8${NBSP}GB`,
      `7.9${NBSP}GB`,
    ]);
  });

  test("0 to 55 steps to 60, as recharts' own did, never to 80 as recharts' round steps pad it", () => {
    expect(getNiceTickValues([0, 55], 5, true, "adaptive")).toEqual([
      0, 15, 30, 45, 60,
    ]);
    expect(getNiceTickValues([0, 55], 5, true, "snap125")).toEqual([
      0, 20, 40, 60, 80,
    ]);

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0, 12, 55],
      domain: [0, "auto"],
      allowDecimals: true,
      formatter: count,
    });

    expectRoundAndEven(axis);
    expect(axis.ticks).toEqual([0, 20, 40, 60]);
    expect(axis.domain).toEqual([0, 60]);
  });

  test("0 to 41 ends at 50, where recharts' own ended at 60", () => {
    expect(getNiceTickValues([0, 41], 5, true, "adaptive")).toEqual([
      0, 15, 30, 45, 60,
    ]);

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0, 41],
      domain: [0, "auto"],
      allowDecimals: true,
      formatter: count,
    });

    expectRoundAndEven(axis);
    expect(axis.ticks).toEqual([0, 10, 20, 30, 40, 50]);
  });
});

describe("charts that already looked right keep their ticks", () => {
  test.each([
    [
      "a percent axis over its fixed 0% to 100%",
      percent,
      [12, 40, 63],
      [0, 100],
    ],
    [
      "a 0-1 fraction over its fixed 0 to 1",
      cpuFraction,
      [0.1, 0.5, 0.9],
      [0, 1],
    ],
    ["a count from 0 to 7.3", count, [0, 3, 7.3], [0, "auto"]],
    ["a count from 0 to 80", count, [0, 30, 80], [0, "auto"]],
    ["a count from 0 to 19", count, [0, 7, 19], [0, "auto"]],
    ["bytes from 0 to 20 GB", bytes, [0, 7.2e9, 19.6e9], [0, "auto"]],
  ])(
    "%s: recharts' own ticks",
    (
      _name: string,
      formatter: ValueAxisFormatter,
      values: Array<number>,
      domain: Array<number | "auto">,
    ) => {
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: values,
        domain: domain,
        allowDecimals: true,
        formatter: formatter,
      });
      const lowest: number = Math.min(
        ...values,
        typeof domain[0] === "number" ? domain[0] : Infinity,
      );
      const highest: number = Math.max(
        ...values,
        typeof domain[1] === "number" ? domain[1] : -Infinity,
      );

      expect(axis.ticks).toEqual(
        getNiceTickValues([lowest, highest], 5, true, "adaptive"),
      );
    },
  );

  test("0% to 100%: in quarters, with the fewest figures, the tooltip as it always wrote", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [12, 40, 63],
      domain: [0, 100],
      allowDecimals: true,
      formatter: percent,
    });

    expectRoundAndEven(axis);
    expect(axis.labels).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    // A fixed domain keeps its ends.
    expect(axis.domain).toEqual([0, 100]);
    expect(axis.tooltipPrecision).toBeUndefined();
  });

  test("a state chart's ranks: 0, 2, 4, 6 and 8, each a state's name", () => {
    const names: Array<string> = [
      "Failed",
      "",
      "Inactive",
      "",
      "Activating",
      "",
      "Active",
      "",
      "",
    ];
    // A page's own formatter: no step, no figures, a name for each rank.
    const rank: ValueAxisFormatter = (value: number): string => {
      return names[Math.round(value)] ?? "";
    };
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0, 2, 6, 4],
      domain: [0, 8],
      allowDecimals: true,
      formatter: rank,
    });

    expect(axis.ticks).toEqual([0, 2, 4, 6, 8]);
    expect(axis.labels).toEqual([
      "Failed",
      "Inactive",
      "Activating",
      "Active",
      "",
    ]);
    expect(axis.domain).toEqual([0, 8]);
  });

  test("an availability chart's Down and Up, at its fixed 0 and 100", () => {
    const upDown: ValueAxisFormatter = (value: number): string => {
      if (value >= 100) {
        return "Up";
      }
      if (value <= 0) {
        return "Down";
      }
      return `${Math.round(value)}%`;
    };
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [100, 100, 0, 100],
      domain: [0, 100],
      allowDecimals: true,
      formatter: upDown,
    });

    expect(axis.labels).toEqual(["Down", "25%", "50%", "75%", "Up"]);
  });

  test("a percent's soft range under 25%: round ticks between its fixed ends, none at its odd top", () => {
    // Before: recharts' fixed-domain ticks ended on the domain's top, "9.13%".
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [3, 5.5, 7.3],
      domain: [0, 9.125],
      allowDecimals: true,
      formatter: percent,
    });

    expectRoundAndEven(axis);
    expect(axis.labels).toEqual(["0%", "2%", "4%", "6%", "8%"]);
    expect(axis.domain).toEqual([0, 9.125]);
  });
});

describe("an axis over a narrow range is stepped so its neighbouring ticks read apart (#10079)", () => {
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

    expectRoundAndEven(axis);
    expect(axis.labels).toEqual([
      `17.201${NBSP}GB`,
      `17.202${NBSP}GB`,
      `17.203${NBSP}GB`,
      `17.204${NBSP}GB`,
      `17.205${NBSP}GB`,
    ]);
    // The domain recharts is handed runs over exactly those ticks.
    expect(axis.domain).toEqual([17.201e9, 17.205e9]);
    // Its own figures read "17.2 GB" on every tick: the tooltip takes the step's.
    expect(axis.tooltipPrecision).toEqual(axis.precision);
  });

  test.each([
    ["bytes", bytes, 17.2e9, 3e7, 1],
    ["bytes, a few kilobytes on a megabyte", bytes, 1.25e6, 2e3, 1],
    ["percent", percent, 99.995, 0.006, 1],
    ["a count", count, 70.5, 0.003, 1],
    ["a counter in the billions", count, 119.2e9, 4e6, 1],
    ["a 0-1 fraction drawn in percent", cpuFraction, 0.99991, 0.00006, 0.01],
    ["a byte rate", byteRate, 1.2005e6, 400, 1],
    ["a temperature", celsius, 23.25, 0.04, 1],
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

      expectRoundAndEven(axis, percentScale);
      // Its ticks take the values in.
      expect(axis.ticks![0]!).toBeLessThanOrEqual(center - span / 2);
      expect(axis.ticks![axis.ticks!.length - 1]!).toBeGreaterThanOrEqual(
        center + span / 2,
      );
      // The tooltip takes the step where the formatter's own figures fail.
      expect(axis.tooltipPrecision).toEqual(
        areNeighboursApart(
          axis.ticks!.map((tick: number): string => {
            return formatter(tick);
          }),
        )
          ? undefined
          : axis.precision,
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
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

    expectRoundAndEven(axis);
    expect(axis.labels).toContain(`17.200${NBSP}GB`);
  });

  test("a series of nothing but zero: 0 to 4, as recharts draws it", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0, 0, 0],
      domain: [0, "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expect(axis.ticks).toEqual(getNiceTickValues([0, 0], 5, true, "adaptive"));
    expect(axis.labels).toEqual([
      `0${NBSP}B`,
      `1${NBSP}B`,
      `2${NBSP}B`,
      `3${NBSP}B`,
      `4${NBSP}B`,
    ]);
  });

  test("a byte's rounding on 17.2 GB is never stretched over ticks a byte apart", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [17198482960, 17198482961, 17198482962],
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: bytes,
    });

    expectRoundAndEven(axis);

    // Never finer than five figures of the value: ticks a megabyte apart or more.
    expect(axis.precision!.step).toBeGreaterThanOrEqual(
      Math.pow(10, 10 - FINEST_TICK_FIGURES + 1),
    );
    for (const label of axis.labels) {
      expect(readTick(label).decimals).toBeLessThanOrEqual(3);
    }
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
      tooltipPrecision: undefined,
      labels: [],
    });
  });
});

describe("a formatter that writes its own figures", () => {
  test("one that writes too few figures for the best step takes the next it writes apart", () => {
    // A topology edge's calls: whole numbers, whatever it is handed.
    const wholeNumbers: ValueAxisFormatter = (value: number): string => {
      return String(Math.round(value));
    };
    // Recharts' own ticks read "0", "0", "1", "1", "1".
    expect(
      getNiceTickValues([0, 1.4], 5, true, "adaptive").map(wholeNumbers),
    ).toEqual(["0", "0", "1", "1", "1"]);

    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [0, 1, 1.4],
      domain: [0, "auto"],
      allowDecimals: true,
      formatter: wholeNumbers,
    });

    expect(axis.ticks).toEqual([0, 1, 2]);
    expect(axis.labels).toEqual(["0", "1", "2"]);
  });

  test("one that writes the same whatever it is handed leaves the axis as recharts steps it", () => {
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
    expect(axis.tooltipPrecision).toBeUndefined();
    expect(new Set<string>(axis.labels)).toEqual(new Set<string>(["17 GB"]));
  });

  test("one that ignores the step writes the round ticks in its own figures", () => {
    const own: ValueAxisFormatter = (value: number): string => {
      return `${value.toFixed(2)} ms`;
    };
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: [12, 300, 1480],
      domain: [0, "auto"],
      allowDecimals: true,
      formatter: own,
    });

    expect(axis.ticks).toEqual([0, 500, 1000, 1500]);
    expect(axis.labels).toEqual([
      "0.00 ms",
      "500.00 ms",
      "1000.00 ms",
      "1500.00 ms",
    ]);
  });
});

describe("in every unit and at every scale, every axis steps evenly in round steps, with the fewest figures", () => {
  const units: Array<{
    name: string;
    formatter: ValueAxisFormatter;
    percentScale: number;
  }> = [
    { name: "bytes", formatter: bytes, percentScale: 1 },
    { name: "a byte rate", formatter: byteRate, percentScale: 1 },
    { name: "percent", formatter: percent, percentScale: 1 },
    { name: "a count", formatter: count, percentScale: 1 },
    { name: "a temperature", formatter: celsius, percentScale: 1 },
    { name: "a 0-1 fraction", formatter: cpuFraction, percentScale: 0.01 },
  ];

  test.each(units)(
    "$name: a seeded sweep of 600 ranges, narrow and wide, from zero and fixed, positive and negative",
    ({
      formatter,
      percentScale,
    }: {
      formatter: ValueAxisFormatter;
      percentScale: number;
    }) => {
      const random: SeededRandom = seededRandom(10117);
      let narrow: number = 0;
      let wide: number = 0;

      for (let index: number = 0; index < 600; index++) {
        const magnitude: number = Math.pow(10, random(20) - 6);
        const center: number =
          magnitude * (1 + random() * 9) * (random(4) === 0 ? -1 : 1);
        const span: number =
          Math.abs(center) * Math.pow(10, -(random() * 9) + 0.3);
        const values: Array<number> = around(center, span, 2 + random(20));
        const lowest: number = Math.min(...values);
        const highest: number = Math.max(...values);
        // Lines fit their values; bars and rates stand on zero; a host may fix both ends.
        const shape: number = random(3);
        const domain: Array<number | "auto"> =
          shape === 0
            ? ["auto", "auto"]
            : shape === 1
              ? [0, "auto"]
              : [
                  Math.min(0, lowest) - span * random(),
                  Math.max(0, highest) + span * random(),
                ];
        const axis: ValueAxisTicks = getValueAxisTicks({
          values: values,
          domain: domain,
          allowDecimals: true,
          formatter: formatter,
        });
        const ticks: Array<number> = axis.ticks as Array<number>;

        // Every axis is stepped: evenly, roundly, apart, exactly, to the fewest figures.
        expectRoundAndEven(axis, percentScale);

        // About five ticks: never fewer than three, never more than six.
        expect(ticks.length).toBeGreaterThanOrEqual(FEWEST_VALUE_AXIS_TICKS);
        expect(ticks.length).toBeLessThanOrEqual(MOST_VALUE_AXIS_TICKS);

        // Never finer than five figures of the axis's largest end.
        const axisEnds: [number, number] = [
          Math.min(lowest, typeof domain[0] === "number" ? domain[0] : lowest),
          Math.max(
            highest,
            typeof domain[1] === "number" ? domain[1] : highest,
          ),
        ];
        const largest: number = Math.max(...axisEnds.map(Math.abs));
        expect(axis.precision!.step).toBeGreaterThanOrEqual(
          Math.pow(
            10,
            Math.floor(Math.log10(largest)) - FINEST_TICK_FIGURES + 1,
          ) *
            (1 - 1e-9),
        );

        if (typeof domain[0] === "number" && typeof domain[1] === "number") {
          // A fixed domain keeps its ends, its ticks between them.
          expect(axis.domain).toEqual(axisEnds);
          expect(ticks[0]!).toBeGreaterThanOrEqual(
            axisEnds[0] - 1e-9 * largest,
          );
          expect(ticks[ticks.length - 1]!).toBeLessThanOrEqual(
            axisEnds[1] + 1e-9 * largest,
          );
        } else {
          // An "auto" one runs over its ticks, which take every value in.
          expect(axis.domain).toEqual([ticks[0], ticks[ticks.length - 1]]);
          expect(ticks[0]!).toBeLessThanOrEqual(axisEnds[0]);
          expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(axisEnds[1]);
        }

        // The tooltip takes the step only where the formatter's own figures fail.
        const ownFigures: Array<string> = ticks.map((tick: number): string => {
          return formatter(tick);
        });
        expect(axis.tooltipPrecision).toEqual(
          areNeighboursApart(ownFigures) ? undefined : axis.precision,
        );

        if (axis.tooltipPrecision) {
          narrow++;
        } else {
          wide++;
        }
      }

      // The sweep reaches both: ranges the formatter's own figures tell apart, and not.
      expect(narrow).toBeGreaterThan(50);
      expect(wide).toBeGreaterThan(50);
    },
  );

  test("the blank space past the values: less than recharts' on an axis from zero, and never half the plot", () => {
    const random: SeededRandom = seededRandom(10117);
    let mine: number = 0;
    let recharts: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const highest: number = Math.pow(10, random(10) - 3) * (1 + random() * 9);
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: [0, highest],
        domain: [0, "auto"],
        allowDecimals: true,
        formatter: bytes,
      });
      const top: number = axis.ticks![axis.ticks!.length - 1]!;
      const rechartsTicks: Array<number> = getNiceTickValues(
        [0, highest],
        5,
        true,
        "adaptive",
      );
      const blank: number = (top - highest) / top;

      // At most a quarter of the plot is above the highest value.
      expect(blank).toBeLessThanOrEqual(0.25 + 1e-9);
      mine += blank;
      recharts +=
        (rechartsTicks[rechartsTicks.length - 1]! - highest) /
        rechartsTicks[rechartsTicks.length - 1]!;
    }

    expect(mine).toBeLessThan(recharts);
  });
});

describe("in the reader's language", () => {
  test.each([
    ["de", "17,201", "17,205"],
    ["fa", "۱۷٫۲۰۱", "۱۷٫۲۰۵"],
    ["ar", "17.201", "17.205"],
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

  test.each([
    ["de", ["0 %", "25 %", "50 %", "75 %", "100 %"]],
    ["fa", ["۰٪", "۲۵٪", "۵۰٪", "۷۵٪", "۱۰۰٪"]],
    [
      "ar",
      [
        "0\u200E%\u200E",
        "25\u200E%\u200E",
        "50\u200E%\u200E",
        "75\u200E%\u200E",
        "100\u200E%\u200E",
      ],
    ],
  ])(
    "%s: a percent axis's quarters, with no figure after the point",
    (language: string, expected: Array<string>) => {
      const axis: ValueAxisTicks = getValueAxisTicks({
        values: [12, 63],
        domain: [0, 100],
        allowDecimals: true,
        formatter: axisFormatter("%", { language: language }),
      });

      expect(
        axis.labels.map((label: string): string => {
          return label.replace(/\u00A0/g, " ");
        }),
      ).toEqual(expected);
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

  test("a range German's own figures already tell apart: round tenths of a billion", () => {
    const axis: ValueAxisTicks = getValueAxisTicks({
      values: around(119.2e9, 8e7),
      domain: ["auto", "auto"],
      allowDecimals: true,
      formatter: axisFormatter("1", { language: "de" }),
    });

    expect(axis.precision!.step).toBe(2e7);
    expect(axis.labels).toEqual([
      "119,16\u00A0Mrd.",
      "119,18\u00A0Mrd.",
      "119,20\u00A0Mrd.",
      "119,22\u00A0Mrd.",
      "119,24\u00A0Mrd.",
    ]);
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
      { step: 1, largestTick: 8 },
    ) as unknown as (value: number, index: number) => string;

    stepped(5, 3);
    expect(seen[1]).toEqual({ step: 1, largestTick: 8 });
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

describe("the round steps themselves", () => {
  test("first figures of 1, 2, 2.5 or 5", () => {
    expect(getMantissa(0.025)).toBe(2.5);
    expect(isRoundDecimalStep(0.025)).toBe(true);
    expect(isRoundDecimalStep(5e9)).toBe(true);
    expect(isRoundDecimalStep(8.5e7)).toBe(false);
    expect(isRoundDecimalStep(15)).toBe(false);
  });
});
