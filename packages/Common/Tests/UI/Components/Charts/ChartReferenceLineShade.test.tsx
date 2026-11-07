/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";

/*
 * A monitor's threshold shades the side of its line that alerts (issue
 * #5759): "above 45" shades everything above 45, so the stretches the
 * metric spent past it stand out. Drawn through REAL recharts, which works
 * out where the band goes: only ResponsiveContainer is stood in for, as it
 * measures a parent jsdom reports as 0x0 and would draw nothing.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return react.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import ChartReferenceLineProps from "../../../../UI/Components/Charts/Types/ReferenceLineProps";
import {
  REFERENCE_LINE_SHADE_OPACITY,
  getReferenceLineShade,
} from "../../../../UI/Components/Charts/Utils/ReferenceLineShade";

const MINUTE_MS: number = 60 * 1000;
const FIRST_BUCKET_MS: number = Date.parse("2026-11-07T10:00:00.000Z");

// Ten one-minute buckets climbing from 30 to 57.
const ROWS: Array<Record<string, number | string>> = Array.from(
  { length: 10 },
  (_: unknown, index: number): Record<string, number | string> => {
    return {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:0${index}`,
      [CHART_DATA_POINT_DATE_KEY]: FIRST_BUCKET_MS + index * MINUTE_MS,
      CPU: 30 + index * 3,
    };
  },
);

type ChartFunction = (
  referenceLines: Array<ChartReferenceLineProps>,
) => React.ReactElement;

const CHARTS: Array<[string, ChartFunction]> = [
  [
    "line",
    (referenceLines: Array<ChartReferenceLineProps>): React.ReactElement => {
      return (
        <LineChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          referenceLines={referenceLines}
        />
      );
    },
  ],
  [
    "area",
    (referenceLines: Array<ChartReferenceLineProps>): React.ReactElement => {
      return (
        <AreaChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          referenceLines={referenceLines}
        />
      );
    },
  ],
  [
    "bar",
    (referenceLines: Array<ChartReferenceLineProps>): React.ReactElement => {
      return (
        <BarChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          referenceLines={referenceLines}
        />
      );
    },
  ],
];

interface Box {
  top: number;
  bottom: number;
}

// The band's top and bottom, read off the path recharts draws for it.
function bandsOf(container: HTMLElement): Array<Box> {
  return Array.from(
    container.querySelectorAll("path.recharts-reference-area-rect"),
  ).map((element: Element): Box => {
    const numbers: Array<number> = (element.getAttribute("d") || "")
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    // "M x,y h width v height h -width Z"
    const y: number = numbers[1]!;
    const height: number = numbers[3]!;
    return {
      top: Math.min(y, y + height),
      bottom: Math.max(y, y + height),
    };
  });
}

// Where recharts drew the threshold line across the plot.
function lineY(container: HTMLElement): number {
  const line: Element | null = container.querySelector(
    ".recharts-reference-line-line",
  );
  if (!line) {
    throw new Error("recharts drew no reference line");
  }
  return Number(line.getAttribute("y1"));
}

afterEach(() => {
  cleanup();
});

describe("getReferenceLineShade", () => {
  test("above a line: from the top of the plot down to it", () => {
    expect(
      getReferenceLineShade({ value: 90, color: "#ef4444", shade: "above" }),
    ).toEqual({
      y2: 90,
      fill: "#ef4444",
      fillOpacity: REFERENCE_LINE_SHADE_OPACITY,
    });
  });

  test("below a line: from the bottom of the plot up to it", () => {
    expect(
      getReferenceLineShade({ value: 5, color: "#f59e0b", shade: "below" }),
    ).toEqual({
      y1: 5,
      fill: "#f59e0b",
      fillOpacity: REFERENCE_LINE_SHADE_OPACITY,
    });
  });

  test("a band stretches the axis when its line does", () => {
    expect(
      getReferenceLineShade({
        value: 90,
        color: "red",
        shade: "above",
        extendsDomain: true,
      })?.ifOverflow,
    ).toBe("extendDomain");
  });

  test("no side, or a value that is no number, shades nothing", () => {
    expect(getReferenceLineShade({ value: 90, color: "red" })).toBeNull();
    expect(
      getReferenceLineShade({
        value: 90,
        color: "red",
        shade: "left" as unknown as "above",
      }),
    ).toBeNull();
    expect(
      getReferenceLineShade({ value: Number.NaN, color: "red", shade: "above" }),
    ).toBeNull();
    expect(
      getReferenceLineShade({
        value: "90" as unknown as number,
        color: "red",
        shade: "above",
      }),
    ).toBeNull();
  });
});

describe.each(CHARTS)("a %s chart", (_name: string, chart: ChartFunction) => {
  test("shades above a line from the top of the plot down to the line, in its colour", () => {
    const { container } = render(
      chart([{ value: 45, color: "#ef4444", shade: "above", label: "High CPU" }]),
    );

    const bands: Array<Box> = bandsOf(container);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.bottom).toBeCloseTo(lineY(container), 0);
    expect(bands[0]!.top).toBeLessThan(lineY(container));

    const band: Element = container.querySelector(
      "path.recharts-reference-area-rect",
    )!;
    expect(band.getAttribute("fill")).toBe("#ef4444");
    expect(Number(band.getAttribute("fill-opacity"))).toBe(
      REFERENCE_LINE_SHADE_OPACITY,
    );
    expect(band.getAttribute("stroke")).toBe("none");
  });

  test("shades below a line from the line down to the bottom of the plot", () => {
    const { container } = render(
      chart([{ value: 40, color: "#f59e0b", shade: "below" }]),
    );

    const bands: Array<Box> = bandsOf(container);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.top).toBeCloseTo(lineY(container), 0);
    expect(bands[0]!.bottom).toBeGreaterThan(lineY(container));
  });

  test("a line with no side shades nothing, and keeps its label", () => {
    const { container } = render(
      chart([{ value: 45, color: "#ef4444", label: "Critical: 45" }]),
    );

    expect(bandsOf(container)).toHaveLength(0);
    expect(container.querySelector(".recharts-reference-line-line")).not.toBeNull();
    expect(container).toHaveTextContent("Critical: 45");
  });

  test("a line past the data, stretching the axis, shades all the way to it", () => {
    const { container } = render(
      chart([
        { value: 90, color: "#ef4444", shade: "above", extendsDomain: true },
      ]),
    );

    const bands: Array<Box> = bandsOf(container);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.bottom).toBeCloseTo(lineY(container), 0);
  });
});
