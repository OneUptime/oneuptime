import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, RenderResult } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

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

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

const MINUTE_MS: number = 60 * 1000;
const FIRST_BUCKET: number = Date.parse("2026-09-28T10:00:00.000Z");

const ROWS: Array<Record<string, number | string>> = Array.from(
  { length: 10 },
  (_: unknown, index: number): Record<string, number | string> => {
    return {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:${String(index).padStart(2, "0")}`,
      [CHART_DATA_POINT_DATE_KEY]: FIRST_BUCKET + index * MINUTE_MS,
      CPU: 40 + index,
    };
  },
);

afterEach(() => {
  cleanup();
});

describe("probe", () => {
  test("line", () => {
    const onSelect: MockFunction = getJestMockFunction();
    const rendered: RenderResult = render(
      <LineChart
        data={ROWS}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["CPU"]}
        showLegend={false}
        onTimeRangeSelect={onSelect as unknown as (a: Date, b: Date) => void}
      />,
    );
    const ticks: Array<Element> = Array.from(
      rendered.container.querySelectorAll(
        ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
      ),
    );
    // eslint-disable-next-line no-console
    console.log("html omitted");
    // eslint-disable-next-line no-console
    console.log(
      ticks.map((t: Element) => {
        return `${t.textContent}@${t.getAttribute("x")}`;
      }),
    );
    const wrapper: Element = rendered.container.querySelector(
      ".recharts-wrapper",
    )!;
    // eslint-disable-next-line no-console
    console.log(wrapper.getAttribute("style"));
    const xOf: (label: string) => number = (label: string): number => {
      const t: Element = ticks.find((e: Element) => {
        return e.textContent === label;
      })!;
      return Number(t.getAttribute("x"));
    };
    fireEvent.mouseMove(wrapper, { clientX: xOf("10:02"), clientY: 120 });
    fireEvent.mouseDown(wrapper, {
      clientX: xOf("10:02"),
      clientY: 120,
      button: 0,
      buttons: 1,
    });
    fireEvent.mouseMove(wrapper, {
      clientX: xOf("10:04"),
      clientY: 120,
      buttons: 1,
    });
    fireEvent.mouseMove(wrapper, {
      clientX: xOf("10:06"),
      clientY: 120,
      buttons: 1,
    });
    fireEvent.mouseUp(wrapper, { clientX: xOf("10:06"), clientY: 120 });
    // eslint-disable-next-line no-console
    console.log(
      onSelect.mock.calls.map((c: Array<unknown>) => {
        return [(c[0] as Date).toISOString(), (c[1] as Date).toISOString()];
      }),
    );
    expect(true).toBe(true);
  });

  test("bar", () => {
    const onSelect: MockFunction = getJestMockFunction();
    const rendered: RenderResult = render(
      <BarChart
        data={ROWS}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["CPU"]}
        showLegend={false}
        onTimeRangeSelect={onSelect as unknown as (a: Date, b: Date) => void}
      />,
    );
    const ticks: Array<Element> = Array.from(
      rendered.container.querySelectorAll(
        ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
      ),
    );
    // eslint-disable-next-line no-console
    console.log(
      ticks.map((t: Element) => {
        return `${t.textContent}@${t.getAttribute("x")}`;
      }),
    );
    const wrapper: Element = rendered.container.querySelector(
      ".recharts-wrapper",
    )!;
    const xOf: (label: string) => number = (label: string): number => {
      const t: Element = ticks.find((e: Element) => {
        return e.textContent === label;
      })!;
      return Number(t.getAttribute("x"));
    };
    fireEvent.mouseMove(wrapper, { clientX: xOf("10:02"), clientY: 120 });
    fireEvent.mouseDown(wrapper, {
      clientX: xOf("10:02"),
      clientY: 120,
      button: 0,
      buttons: 1,
    });
    fireEvent.mouseMove(wrapper, {
      clientX: xOf("10:06"),
      clientY: 120,
      buttons: 1,
    });
    fireEvent.mouseUp(wrapper, { clientX: xOf("10:06"), clientY: 120 });
    // eslint-disable-next-line no-console
    console.log(
      onSelect.mock.calls.map((c: Array<unknown>) => {
        return [(c[0] as Date).toISOString(), (c[1] as Date).toISOString()];
      }),
    );
    expect(true).toBe(true);
  });
});
