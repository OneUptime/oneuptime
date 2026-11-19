import { describe, expect, test } from "@jest/globals";
import ValueFormatter, {
  ValueFormatterOptions,
} from "../../Utils/ValueFormatter";

/*
 * ISSUE #10079: A VALUE WRITTEN ON AN AXIS THAT HANDS ITS STEP OVER.
 *
 * Given the step between its axis's ticks (options.step), a value is written
 * with the figures after the point that step needs in the unit the value is
 * written in, every one of them kept, so the ticks of an axis line up and no
 * two neighbouring ticks read alike: "17.200 GB", "17.205 GB". Without a step,
 * a value is written exactly as it always was.
 */

const NBSP: string = "\u00A0";

function write(
  value: number,
  unit: string,
  options?: ValueFormatterOptions,
): string {
  return ValueFormatter.formatValue(value, unit, options);
}

describe("without a step, every value is written as it always was", () => {
  test.each([
    [17.2034e9, "By", `17.2${NBSP}GB`],
    [119.2e9, "1", "119.2B"],
    [99.995, "%", "100.00%"],
    [1200.5, "ms", `1.2${NBSP}sec`],
    [0, "By", `0${NBSP}B`],
    [70.5, "{processes}", "70.5"],
  ])("%s %s reads %s", (value: number, unit: string, expected: string) => {
    expect(write(value, unit)).toBe(expected);
    // A step of 0, or one that is no number, is no step.
    expect(write(value, unit, { step: 0 })).toBe(expected);
    expect(write(value, unit, { step: Number.NaN })).toBe(expected);
    expect(write(value, unit, { step: Number.POSITIVE_INFINITY })).toBe(
      expected,
    );
  });
});

describe("with a step, a value takes the figures the step needs, in its own unit", () => {
  test.each([
    // Bytes, scaled as they always are, each to the step's figures.
    [17.205e9, "By", 5e6, `17.205${NBSP}GB`],
    [17.2e9, "By", 5e6, `17.200${NBSP}GB`],
    [17.21e9, "By", 1e7, `17.21${NBSP}GB`],
    [17.225e9, "By", 2.5e7, `17.225${NBSP}GB`],
    [999.8e6, "By", 2e5, `999.8${NBSP}MB`],
    [1.0002e9, "By", 2e5, `1.0002${NBSP}GB`],
    [0, "By", 1e6, `0${NBSP}B`],
    [1.2345005e15, "By", 5e8, `1.2345005${NBSP}PB`],
    [-17.205e9, "By", 5e6, `-17.205${NBSP}GB`],
    // A rate keeps its slash.
    [1.2005e6, "By/s", 500, `1.2005${NBSP}MB/s`],
    // Percent: as many decimals as the step needs, past the usual two.
    [99.995, "%", 0.005, "99.995%"],
    [0, "%", 0.001, "0.000%"],
    // A duration, scaled as it always is.
    [250.25, "ms", 0.25, `250.25${NBSP}ms`],
    [1200.5, "ms", 0.5, `1.2005${NBSP}sec`],
    // A count, its scale letter kept.
    [119.2e9, "1", 1e6, "119.200B"],
    [1000, "", 1, "1.000K"],
    [999, "", 1, "999"],
    [70.5, "{processes}", 0.5, "70.5"],
    [0.0005, "", 0.0001, "0.0005"],
    // A unit written by its symbol.
    [23.25, "Cel", 0.25, `23.25${NBSP}°C`],
  ])(
    "%s %s on an axis stepping %s reads %s",
    (value: number, unit: string, step: number, expected: string) => {
      expect(write(value, unit, { step: step })).toBe(expected);
    },
  );

  test("a 0-1 fraction drawn in percent takes its step in percent too", () => {
    expect(
      write(0.99995, "1", {
        step: 0.00005,
        metricName: "system.cpu.utilization",
      }),
    ).toBe("99.995%");
  });

  test("a value that rounds to zero has no minus", () => {
    expect(write(-0.0000001, "", { step: 0.001 })).toBe("0.000");
    expect(write(-0.0004, "%", { step: 0.001 })).toBe("0.000%");
  });

  test("a negative step is the same step", () => {
    expect(write(17.205e9, "By", { step: -5e6 })).toBe(`17.205${NBSP}GB`);
  });

  test("a step no figures write exactly (a second, in hours) gets the fewest that keep neighbours apart", () => {
    expect(write(5400, "s", { step: 1 })).toBe(`1.5000${NBSP}hours`);
    expect(write(5401, "s", { step: 1 })).toBe(`1.5003${NBSP}hours`);
  });

  test("neighbouring ticks a step apart always read apart", () => {
    for (const [first, unit, step] of [
      [17.2e9, "By", 1e6],
      [99.99, "%", 0.001],
      [119.2e9, "1", 1e6],
      [1840, "ms", 0.1],
      [0.5, "", 0.0001],
    ] as Array<[number, string, number]>) {
      const labels: Array<string> = [0, 1, 2, 3, 4].map(
        (index: number): string => {
          return write(first + index * step, unit, { step: step });
        },
      );

      expect(new Set<string>(labels).size).toBe(labels.length);
    }
  });
});

describe("with a step, in the reader's language", () => {
  test.each([
    ["de", 17.205e9, "By", 5e6, `17,205${NBSP}GB`],
    ["fa", 17.205e9, "By", 5e6, `۱۷٫۲۰۵${NBSP}GB`],
    ["de", 99.995, "%", 0.005, `99,995${NBSP}%`],
    ["de", 119.201e9, "1", 1e6, `119,201${NBSP}Mrd.`],
    ["fa", 119.201e9, "1", 1e6, `۱۱۹٫۲۰۱${NBSP}میلیارد`],
    ["ja", 119.201e9, "1", 1e6, "1192.01億"],
    ["de", 5400.5, "s", 0.5, `1,5001${NBSP}Stunden`],
  ])(
    "%s: %s %s on an axis stepping %s reads %s",
    (
      language: string,
      value: number,
      unit: string,
      step: number,
      expected: string,
    ) => {
      expect(write(value, unit, { step: step, language: language })).toBe(
        expected,
      );
    },
  );

  test("a scaled number keeps every figure in the language's own scale, zeros too", () => {
    expect(write(119.2e9, "1", { step: 1e7, language: "de" })).toBe(
      `119,20${NBSP}Mrd.`,
    );
    // And without a step, as it always was.
    expect(write(119.2e9, "1", { language: "de" })).toBe(`119,2${NBSP}Mrd.`);
  });
});

describe("getDecimalsForStep", () => {
  test.each([
    [0.005, 3],
    [0.01, 2],
    [0.025, 3],
    [0.1 + 0.2, 1],
    [0.000999999999991, 3],
    [1, 0],
    [2.5, 1],
    [50, 0],
    [1 / 3600, 4],
  ])("a step of %s takes %s decimals", (step: number, decimals: number) => {
    expect(ValueFormatter.getDecimalsForStep(step)).toBe(decimals);
  });

  test("no usable step: undefined", () => {
    expect(ValueFormatter.getDecimalsForStep(undefined)).toBeUndefined();
    expect(ValueFormatter.getDecimalsForStep(0)).toBeUndefined();
    expect(ValueFormatter.getDecimalsForStep(Number.NaN)).toBeUndefined();
  });
});
