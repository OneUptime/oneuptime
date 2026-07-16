import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import "@testing-library/jest-dom/extend-expect";
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so the
 * chart renders nothing without a fixed size.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

type ChartData = Record<string, any>;

const data: ChartData[] = [
  { time: "10:00", Requests: 1200 },
  { time: "10:05", Requests: 2400 },
  { time: "10:10", Requests: 1800 },
];

const CHARTS: Array<[string, React.ReactElement]> = [
  [
    "LineChart",
    <LineChart data={data} index="time" categories={["Requests"]} />,
  ],
  [
    "AreaChart",
    <AreaChart data={data} index="time" categories={["Requests"]} />,
  ],
  ["BarChart", <BarChart data={data} index="time" categories={["Requests"]} />],
];

describe("Chart axis tick colour", () => {
  /*
   * Recharts >= 3.4 portals tick labels into a separate z-index layer, outside the
   * axis <g>. Anything that relies on the axis's class or on fill inheritance to
   * colour them silently paints black, which is invisible in dark mode. The tick
   * must therefore carry its own fill.
   */
  test.each(CHARTS)(
    "%s gives axis ticks an explicit themeable fill",
    (_name: string, element: React.ReactElement) => {
      const { container } = render(element);

      const ticks: Array<Element> = Array.from(
        container.querySelectorAll(".recharts-cartesian-axis-tick-value"),
      );

      expect(ticks.length).toBeGreaterThan(0);

      for (const tick of ticks) {
        expect(tick.getAttribute("fill")).toBe("var(--ou-chart-tick)");
      }
    },
  );
});
