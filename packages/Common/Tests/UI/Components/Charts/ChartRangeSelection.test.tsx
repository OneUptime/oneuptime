import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4105 makes drag-to-select the way into every chart's zoom, so the
 * drag itself has to be dependable on all three chart types. They share
 * one implementation (useChartRangeSelection); these tests run the same
 * gestures against the line, area and bar charts through it:
 *
 *   - the bucket under the pointer AT RELEASE wins: recharts delivers
 *     mousemove a frame late but mouseup at once, so a quick drag used to
 *     lose its last bucket;
 *   - a drag released outside the chart still selects (it used to be
 *     abandoned, with its band left painted);
 *   - a release heard twice (chart and window) selects once;
 *   - the plot does not select page text while dragging or double-clicking.
 *
 * recharts' chart roots are stood in for so the chart-level handlers can be
 * driven with a known bucket under the pointer (jsdom has no layout).
 */

type CapturedChartProps = {
  onMouseDown?: (state: Record<string, unknown>) => void;
  onMouseMove?: (
    state: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => void;
  onMouseUp?: (state?: Record<string, unknown> | null) => void;
  children?: React.ReactNode;
};

const mockChartPropsRef: { current: CapturedChartProps } = { current: {} };

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  const react: typeof React = jest.requireActual("react") as typeof React;
  const root: (props: Record<string, unknown>) => React.ReactElement | null = (
    props: Record<string, unknown>,
  ): React.ReactElement | null => {
    /*
     * To print a dev warning (the area chart's <linearGradient> rendered
     * into this stub's <div>), React describes the component stack by
     * calling each component once, bare, with no props
     * (describeNativeComponentFrame). That is not a render; ignore it.
     */
    if (!props) {
      return null;
    }
    mockChartPropsRef.current = props as CapturedChartProps;
    return react.createElement(
      "div",
      { "data-testid": "chart-root" },
      props["children"] as React.ReactNode,
    );
  };
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return children;
    },
    LineChart: root,
    AreaChart: root,
    BarChart: root,
    ReferenceArea: (props: { x1?: string; x2?: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import {
  getChartBucketStart,
  getChartBucketWindow,
  getChartRowIndex,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/UseChartRangeSelection";

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

type SelectHandler = (startTime: Date, endTime: Date) => void;

interface ChartUnderTest {
  name: string;
  render: (onTimeRangeSelect: SelectHandler | undefined) => React.ReactElement;
}

const CHARTS: Array<ChartUnderTest> = [
  {
    name: "line",
    render: (onTimeRangeSelect: SelectHandler | undefined) => {
      return (
        <LineChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={onTimeRangeSelect}
        />
      );
    },
  },
  {
    name: "area",
    render: (onTimeRangeSelect: SelectHandler | undefined) => {
      return (
        <AreaChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={onTimeRangeSelect}
        />
      );
    },
  },
  {
    name: "bar",
    render: (onTimeRangeSelect: SelectHandler | undefined) => {
      return (
        <BarChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={onTimeRangeSelect}
        />
      );
    },
  },
];

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

function release(state: Record<string, unknown> | null): void {
  act(() => {
    chart().onMouseUp?.(state);
  });
}

function selection(mock: MockFunction): Array<[string, string]> {
  return mock.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

beforeEach(() => {
  mockChartPropsRef.current = {};
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

for (const chartUnderTest of CHARTS) {
  describe(`${chartUnderTest.name} chart drag-to-select`, () => {
    test("a quick drag released before its last move landed still covers the release bucket", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(2);
      move(3);
      // The moves to 4-6 were still waiting for an animation frame.
      release({ activeTooltipIndex: 6 });

      expect(selection(onTimeRangeSelect)).toEqual([
        ["2026-09-28T10:02:00.000Z", "2026-09-28T10:07:00.000Z"],
      ]);
    });

    test("a drag released outside the chart still selects up to the last bucket reached", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(1);
      move(4);
      // The button comes up somewhere else on the page.
      fireEvent.mouseUp(window);

      expect(selection(onTimeRangeSelect)).toEqual([
        ["2026-09-28T10:01:00.000Z", "2026-09-28T10:05:00.000Z"],
      ]);
      expect(screen.queryByTestId("selection-band")).toBeNull();
    });

    test("a release heard by the chart and then the window selects once", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(1);
      move(4);
      release({ activeTooltipIndex: 4 });
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
    });

    test("a click outside the chart with no drag in progress does nothing", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      fireEvent.mouseUp(window);
      press(3);
      release({ activeTooltipIndex: 3 });
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("a press on one bucket released outside the chart is not a selection", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(3);
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("the band shows while dragging and clears when the drag ends outside", () => {
      render(
        chartUnderTest.render(
          getJestMockFunction() as unknown as SelectHandler,
        ),
      );

      press(1);
      move(5);
      expect(screen.getByTestId("selection-band")).toHaveAttribute(
        "data-x2",
        "10:05",
      );

      fireEvent.mouseUp(window);
      expect(screen.queryByTestId("selection-band")).toBeNull();
    });

    test("a drag abandoned with no button held selects nothing", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(1);
      move(4);
      move(5, 0);
      release({ activeTooltipIndex: 5 });
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("the plot does not select page text while it offers a drag", () => {
      render(
        chartUnderTest.render(
          getJestMockFunction() as unknown as SelectHandler,
        ),
      );

      const plot: Element | null = screen
        .getByTestId("chart-root")
        .closest(".cursor-crosshair");
      expect(plot).not.toBeNull();
      expect(plot).toHaveClass("select-none");
    });

    test("without a handler the plot is an ordinary, text-selectable chart", () => {
      render(chartUnderTest.render(undefined));

      expect(chart().onMouseDown).toBeUndefined();
      expect(
        screen.getByTestId("chart-root").closest(".select-none"),
      ).toBeNull();
      // And a stray window mouseup is harmless.
      fireEvent.mouseUp(window);
    });

    test("the latest handler is the one called, even if it changed mid-drag", () => {
      const first: MockFunction = getJestMockFunction();
      const second: MockFunction = getJestMockFunction();
      const rendered: ReturnType<typeof render> = render(
        chartUnderTest.render(first as unknown as SelectHandler),
      );

      press(1);
      move(3);
      rendered.rerender(
        chartUnderTest.render(second as unknown as SelectHandler),
      );
      fireEvent.mouseUp(window);

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
}

describe("chart bucket helpers", () => {
  test("getChartRowIndex prefers the tooltip index, then the label", () => {
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeTooltipIndex: 4,
      }),
    ).toBe(4);
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeTooltipIndex: "4",
      }),
    ).toBe(4);
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeLabel: "10:07",
      }),
    ).toBe(7);
  });

  test("getChartRowIndex rejects indexes outside the rows and unknown labels", () => {
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeTooltipIndex: 99,
      }),
    ).toBeNull();
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeTooltipIndex: -1,
      }),
    ).toBeNull();
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeTooltipIndex: "",
      }),
    ).toBeNull();
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, {
        activeLabel: "23:59",
      }),
    ).toBeNull();
    expect(
      getChartRowIndex(ROWS, CHART_DATA_POINT_X_AXIS_KEY, null),
    ).toBeNull();
  });

  test("getChartBucketStart reads the epoch ms each row carries", () => {
    expect(getChartBucketStart(ROWS, 3)?.toISOString()).toBe(
      "2026-09-28T10:03:00.000Z",
    );
    expect(getChartBucketStart(ROWS, 42)).toBeNull();
    expect(getChartBucketStart([{ Time: "10:00" }], 0)).toBeNull();
  });

  test("getChartBucketWindow runs to the end of the last bucket", () => {
    const window: { start: Date; end: Date } | null = getChartBucketWindow(
      ROWS,
      2,
      5,
    );
    expect(window?.start.toISOString()).toBe("2026-09-28T10:02:00.000Z");
    expect(window?.end.toISOString()).toBe("2026-09-28T10:06:00.000Z");
  });

  test("the first bucket takes its width from the one after it", () => {
    const window: { start: Date; end: Date } | null = getChartBucketWindow(
      ROWS,
      0,
      0,
    );
    expect(window?.end.toISOString()).toBe("2026-09-28T10:01:00.000Z");
  });

  test("a lone bucket with no neighbour has no width to add", () => {
    const window: { start: Date; end: Date } | null = getChartBucketWindow(
      [ROWS[0]!],
      0,
      0,
    );
    expect(window?.start.getTime()).toBe(window?.end.getTime());
  });

  test("rows without dates have no window", () => {
    expect(
      getChartBucketWindow([{ Time: "a" }, { Time: "b" }], 0, 1),
    ).toBeNull();
  });
});
