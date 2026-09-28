import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4105 asks for drag-to-zoom on EVERY chart, bar charts included.
 * Until now only the line and area charts could start a zoom; a bar chart
 * could at most end one with a double-click. These tests pin the bar
 * chart's own drag-to-select at the chart library level.
 *
 * recharts' chart root is stood in for so the chart-level handlers can be
 * invoked with a known bucket under the pointer: jsdom reports every
 * element as 0x0, so a real pointer would never resolve to a bar.
 */

type CapturedChartProps = {
  onMouseDown?: (state: Record<string, unknown>) => void;
  onMouseMove?: (
    state: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => void;
  onMouseUp?: (state?: Record<string, unknown> | null) => void;
  onClick?: (state: Record<string, unknown>) => void;
  onDoubleClick?: () => void;
  children?: React.ReactNode;
};

const mockChartPropsRef: { current: CapturedChartProps } = { current: {} };

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return children;
    },
    BarChart: (props: Record<string, unknown>): React.ReactElement => {
      mockChartPropsRef.current = props as CapturedChartProps;
      return react.createElement(
        "div",
        { "data-testid": "chart-root" },
        props["children"] as React.ReactNode,
      );
    },
    ReferenceArea: (props: { x1?: string; x2?: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

const BUCKET_MS: number = 5 * 60 * 1000;
const FIRST_BUCKET: number = Date.parse("2026-09-28T10:00:00.000Z");

// Eight five-minute bars, the shape the time-series wrapper hands down.
const ROWS: Array<Record<string, number | string>> = Array.from(
  { length: 8 },
  (_: unknown, index: number): Record<string, number | string> => {
    const at: number = FIRST_BUCKET + index * BUCKET_MS;
    return {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:${String(index * 5).padStart(2, "0")}`,
      [CHART_DATA_POINT_DATE_KEY]: at,
      Requests: 10 + index,
    };
  },
);

function renderBar(props: {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  layout?: "vertical" | "horizontal";
}): void {
  render(
    <BarChart
      data={ROWS}
      index={CHART_DATA_POINT_X_AXIS_KEY}
      categories={["Requests"]}
      showLegend={false}
      {...(props.layout ? { layout: props.layout } : {})}
      onTimeRangeSelect={props.onTimeRangeSelect}
      onTimeRangeReset={props.onTimeRangeReset}
    />,
  );
}

function chart(): CapturedChartProps {
  return mockChartPropsRef.current;
}

function press(index: number): void {
  act(() => {
    chart().onMouseDown?.({ activeTooltipIndex: index });
  });
}

function move(index: number, buttons: number = 1): void {
  act(() => {
    chart().onMouseMove?.({ activeTooltipIndex: index }, { buttons: buttons });
  });
}

function release(index: number | null): void {
  act(() => {
    chart().onMouseUp?.(index === null ? null : { activeTooltipIndex: index });
  });
}

function asSelectHandler(
  mock: MockFunction,
): (startTime: Date, endTime: Date) => void {
  return mock as unknown as (startTime: Date, endTime: Date) => void;
}

function selectedWindow(mock: MockFunction): [string, string] {
  const call: Array<unknown> | undefined = mock.mock.calls[0];
  if (!call) {
    throw new Error("nothing was selected");
  }
  return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
}

beforeEach(() => {
  mockChartPropsRef.current = {};
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("BarChart drag-to-select", () => {
  test("without a select handler the chart attaches no drag handlers at all", () => {
    renderBar({});

    expect(chart().onMouseDown).toBeUndefined();
    expect(chart().onMouseMove).toBeUndefined();
    expect(chart().onMouseUp).toBeUndefined();
    expect(
      screen.getByTestId("chart-root").closest(".cursor-crosshair"),
    ).toBeNull();
  });

  test("with a select handler the plot shows the crosshair", () => {
    renderBar({ onTimeRangeSelect: asSelectHandler(getJestMockFunction()) });

    expect(
      screen.getByTestId("chart-root").closest(".cursor-crosshair"),
    ).not.toBeNull();
  });

  test("a drag covers every bar it crossed, the last one whole", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(2);
    move(3);
    move(5);
    release(5);

    expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
    expect(selectedWindow(onTimeRangeSelect)).toEqual([
      "2026-09-28T10:10:00.000Z",
      "2026-09-28T10:30:00.000Z",
    ]);
  });

  test("a right-to-left drag selects the same window", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(5);
    move(2);
    release(2);

    expect(selectedWindow(onTimeRangeSelect)).toEqual([
      "2026-09-28T10:10:00.000Z",
      "2026-09-28T10:30:00.000Z",
    ]);
  });

  test("the bar under the pointer at release wins over a stale last move", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(1);
    move(2);
    // recharts delivers mousemove a frame late; mouseup knows better.
    release(4);

    expect(selectedWindow(onTimeRangeSelect)).toEqual([
      "2026-09-28T10:05:00.000Z",
      "2026-09-28T10:25:00.000Z",
    ]);
  });

  test("a release with no bar under the pointer falls back to the last move", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(1);
    move(3);
    release(null);

    expect(selectedWindow(onTimeRangeSelect)).toEqual([
      "2026-09-28T10:05:00.000Z",
      "2026-09-28T10:20:00.000Z",
    ]);
  });

  test("the last bar of the chart takes its width from the bar before it", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(6);
    move(7);
    release(7);

    expect(selectedWindow(onTimeRangeSelect)).toEqual([
      "2026-09-28T10:30:00.000Z",
      "2026-09-28T10:40:00.000Z",
    ]);
  });

  test("a press and release on one bar is a click, not a selection", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(3);
    move(3);
    release(3);

    expect(onTimeRangeSelect).not.toHaveBeenCalled();
  });

  test("letting go outside the chart abandons the selection", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({ onTimeRangeSelect: asSelectHandler(onTimeRangeSelect) });

    press(1);
    move(3);
    // The button came up outside: the next move reports no buttons held.
    move(4, 0);
    release(4);

    expect(onTimeRangeSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("the selection band follows the drag and clears on release", () => {
    renderBar({ onTimeRangeSelect: asSelectHandler(getJestMockFunction()) });

    press(1);
    expect(screen.queryByTestId("selection-band")).toBeNull();

    move(4);
    const band: HTMLElement = screen.getByTestId("selection-band");
    expect(band).toHaveAttribute("data-x1", "10:05");
    expect(band).toHaveAttribute("data-x2", "10:20");

    release(4);
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("a vertical (category) bar chart never selects a time range", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    renderBar({
      onTimeRangeSelect: asSelectHandler(onTimeRangeSelect),
      layout: "vertical",
    });

    expect(chart().onMouseDown).toBeUndefined();
    expect(
      screen.getByTestId("chart-root").closest(".cursor-crosshair"),
    ).toBeNull();
  });

  test("rows without a bucket date cannot be zoomed into", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    render(
      <BarChart
        data={ROWS.map((row: Record<string, number | string>) => {
          const withoutDate: Record<string, number | string> = { ...row };
          delete withoutDate[CHART_DATA_POINT_DATE_KEY];
          return withoutDate;
        })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["Requests"]}
        showLegend={false}
        onTimeRangeSelect={asSelectHandler(onTimeRangeSelect)}
      />,
    );

    press(1);
    move(3);
    release(3);

    expect(onTimeRangeSelect).not.toHaveBeenCalled();
  });

  test("the double-click reset keeps working alongside the drag", () => {
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    renderBar({
      onTimeRangeSelect: asSelectHandler(getJestMockFunction()),
      onTimeRangeReset: onTimeRangeReset as unknown as () => void,
    });

    act(() => {
      chart().onDoubleClick?.();
    });

    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
  });
});
