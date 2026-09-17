import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom,
 * so the chart renders nothing without a fixed size.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

/*
 * Compare-to-previous ghost series must be visually and interactively
 * second-class: dashed, and never part of the fat invisible click-target
 * lines that make live series selectable.
 */

type ChartRow = Record<string, any>;

const data: Array<ChartRow> = [
  { time: "10:00", live: 10, "live (previous)": 8 },
  { time: "10:05", live: 20, "live (previous)": 12 },
  { time: "10:10", live: 15, "live (previous)": 9 },
];

describe.each([
  ["LineChart", LineChart],
  ["AreaChart", AreaChart],
] as Array<[string, typeof LineChart | typeof AreaChart]>)(
  "%s ghost series",
  (_name: string, Chart: typeof LineChart | typeof AreaChart) => {
    test("ghost categories render dashed; live ones do not", () => {
      const { container } = render(
        <Chart
          data={data}
          index="time"
          categories={["live", "live (previous)"]}
          ghostCategories={["live (previous)"]}
        />,
      );

      const dashed: Array<Element> = Array.from(
        container.querySelectorAll('path[stroke-dasharray="6 4"]'),
      );
      expect(dashed.length).toBeGreaterThan(0);

      /*
       * The live series' curve must NOT be dashed — recharts names each
       * series path group; assert at least one series curve without the
       * ghost dash exists.
       */
      const allCurves: Array<Element> = Array.from(
        container.querySelectorAll(".recharts-layer path"),
      ).filter((el: Element) => {
        return el.getAttribute("stroke-dasharray") !== "6 4";
      });
      expect(allCurves.length).toBeGreaterThan(0);
    });

    test("ghosts are excluded from the fat click-target lines", () => {
      const { container } = render(
        <Chart
          data={data}
          index="time"
          categories={["live", "live (previous)"]}
          ghostCategories={["live (previous)"]}
          onValueChange={() => {
            // Enables the click-target machinery, like the wrappers do.
          }}
        />,
      );

      /*
       * LineChart renders invisible strokeWidth-12 click-targets per
       * SELECTABLE series; ghosts must not get one. (AreaChart has no
       * fat-line mechanism — zero is correct there.)
       */
      const fatLines: Array<Element> = Array.from(
        container.querySelectorAll('path[stroke-width="12"]'),
      );
      expect(fatLines.length).toBeLessThanOrEqual(1);
      for (const fatLine of fatLines) {
        expect(fatLine.getAttribute("name")).not.toContain("(previous)");
      }
    });
  },
);
