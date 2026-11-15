import { describe, expect, test } from "@jest/globals";
import {
  getChartRowValues,
  getTickTextLength,
  getYAxisWidthForValuesInPx,
  getYAxisWidthInPx,
  Y_AXIS_MAX_WIDTH_IN_PX,
  Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX,
  Y_AXIS_TICK_PADDING_IN_PX,
  Y_AXIS_WIDTH_IN_PX,
} from "../../../../UI/Components/Charts/Utils/YAxisWidth";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";

/*
 * A value axis as wide as its widest tick, for the charts drawn straight
 * with recharts too (#8349): a Persian duration axis reads "۴۲ میلی‌ثانیه",
 * wider than "42 ms", and the axis gives it the room; the marks a tick
 * carries that are never drawn take none.
 */
const widthFor: (text: string, fontSize?: number) => number = (
  text: string,
  fontSize: number = 10,
): number => {
  return Math.ceil(
    (getTickTextLength(text) * Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX * fontSize) /
      10 +
      Y_AXIS_TICK_PADDING_IN_PX,
  );
};

describe("getTickTextLength", () => {
  test("a mark that is never drawn takes no room", () => {
    // Arabic's percent sign comes with a left-to-right mark on each side.
    expect(getTickTextLength("23.5‎%‎")).toBe(5);
    // Persian's zero-width non-joiner inside a word.
    expect(getTickTextLength("میلی‌ثانیه")).toBe(9);
    // Isolating marks around a value set apart.
    expect(getTickTextLength("⁨۴۲ ms⁩")).toBe(5);
    expect(getTickTextLength("؜-5")).toBe(2);
  });

  test("a letter, a digit or a sign is one each, as before", () => {
    expect(getTickTextLength("100 req/s")).toBe(9);
    expect(getTickTextLength("۱۰۰ req/s")).toBe(9);
    expect(getTickTextLength("")).toBe(0);
  });
});

describe("getYAxisWidthForValuesInPx", () => {
  test("short ticks keep the chart's own width", () => {
    expect(
      getYAxisWidthForValuesInPx({
        values: [0, 5, 10],
        formatter: String,
        minWidthInPx: 48,
      }),
    ).toBe(48);
    expect(getYAxisWidthForValuesInPx({ values: [0, 5, 10] })).toBe(
      Y_AXIS_WIDTH_IN_PX,
    );
  });

  test("no values keep the chart's own width", () => {
    expect(getYAxisWidthForValuesInPx({ values: [], minWidthInPx: 56 })).toBe(
      56,
    );
    expect(
      getYAxisWidthForValuesInPx({
        values: [Number.NaN, Number.POSITIVE_INFINITY],
        minWidthInPx: 56,
      }),
    ).toBe(56);
  });

  test("a long tick widens the axis to fit it", () => {
    const formatter: (value: number) => string = (value: number): string => {
      return `${value} میلی‌ثانیه`;
    };

    expect(
      getYAxisWidthForValuesInPx({
        values: [0, 950],
        formatter: formatter,
        minWidthInPx: 56,
      }),
    ).toBe(widthFor(formatter(10000)));
  });

  test("a larger tick font takes more room", () => {
    const formatter: (value: number) => string = (value: number): string => {
      return `${value} long unit`;
    };
    const atTen: number = getYAxisWidthForValuesInPx({
      values: [0, 90],
      formatter: formatter,
    });
    const atEleven: number = getYAxisWidthForValuesInPx({
      values: [0, 90],
      formatter: formatter,
      tickFontSizeInPx: 11,
    });

    expect(atEleven).toBeGreaterThan(atTen);
    expect(atEleven).toBe(widthFor(formatter(1000), 11));
  });

  test("a runaway tick is capped, so the plot keeps its room", () => {
    expect(
      getYAxisWidthForValuesInPx({
        values: [0, 100],
        formatter: (): string => {
          return "x".repeat(200);
        },
      }),
    ).toBe(Y_AXIS_MAX_WIDTH_IN_PX);
  });

  test("a chart wider than the cap of its own keeps its width", () => {
    expect(
      getYAxisWidthForValuesInPx({
        values: [0, 100],
        minWidthInPx: 200,
      }),
    ).toBe(200);
  });

  test("the ticks between the bottom and the top are measured: 500 ms under 1.5 s", () => {
    const formatter: (value: number) => string = (value: number): string => {
      return value < 1000
        ? `${Math.round(value)} milliseconds`
        : `${(value / 1000).toFixed(1)} s`;
    };

    expect(
      getYAxisWidthForValuesInPx({ values: [0, 1500], formatter: formatter }),
    ).toBeGreaterThanOrEqual(widthFor(formatter(750)));
  });

  test("a formatter that throws is measured by the value as written", () => {
    expect(
      getYAxisWidthForValuesInPx({
        values: [0, 12345678],
        formatter: (): string => {
          throw new Error("boom");
        },
      }),
    ).toBe(Math.max(Y_AXIS_WIDTH_IN_PX, widthFor(String(100000000))));
  });

  test("the shared charts measure with it as they did", () => {
    const data: Array<SeriesPoint> = [
      {
        seriesName: "a",
        data: [
          { x: new Date(0), y: 0 },
          { x: new Date(1), y: 85.7 },
        ],
      },
    ];

    expect(getYAxisWidthInPx({ data: data })).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(
      getYAxisWidthInPx({
        data: data,
        formatter: (value: number): string => {
          return `${value} req per Second`;
        },
      }),
    ).toBeGreaterThan(Y_AXIS_WIDTH_IN_PX);
  });
});

describe("getChartRowValues", () => {
  const rows: Array<{ time: string; a?: number; b?: number | string }> = [
    { time: "t1", a: 10, b: 5 },
    { time: "t2", a: 20, b: "n/a" },
    { time: "t3", b: 7 },
  ];

  test("each series' values, a stack's totals only when stacked", () => {
    expect(getChartRowValues(rows, ["a", "b"])).toEqual([10, 5, 20, 7]);
    expect(getChartRowValues(rows, ["a", "b"], { isStacked: true })).toEqual([
      10, 5, 15, 20, 20, 7, 7,
    ]);
  });

  test("no rows, no keys: nothing", () => {
    expect(getChartRowValues([], ["a"])).toEqual([]);
    expect(getChartRowValues(rows, [])).toEqual([]);
  });
});
