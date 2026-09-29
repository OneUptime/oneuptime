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
 *   - the bucket under the pointer AT RELEASE wins, and the chart takes
 *     mousemove unthrottled so recharts has resolved that bucket by the
 *     release (it used to be a frame behind, and a quick drag lost its
 *     last buckets);
 *   - a press renders nothing until it becomes a drag: a render under the
 *     press swapped out the line dot it landed on, and the browser then
 *     sent no click and no dblclick, so a double-click on a line never
 *     reset the zoom;
 *   - a drag released outside the chart still selects (it used to be
 *     abandoned, with its band left painted);
 *   - a release heard twice (chart and window) selects once;
 *   - the plot does not select page text while dragging or double-clicking.
 *
 * recharts' chart roots are stood in for so the chart-level handlers can be
 * driven with a known bucket under the pointer (jsdom has no layout).
 */

type CapturedChartProps = {
  onMouseDown?: (
    state: Record<string, unknown>,
    event?: Record<string, unknown>,
  ) => void;
  onMouseMove?: (
    state: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => void;
  onMouseUp?: (state?: Record<string, unknown> | null) => void;
  throttledEvents?: ReadonlyArray<string>;
  children?: React.ReactNode;
};

const mockChartPropsRef: { current: CapturedChartProps } = { current: {} };
// How many times the chart root has rendered.
const mockChartRenderCountRef: { current: number } = { current: 0 };

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
    mockChartRenderCountRef.current += 1;
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

function renders(): number {
  return mockChartRenderCountRef.current;
}

beforeEach(() => {
  mockChartPropsRef.current = {};
  mockChartRenderCountRef.current = 0;
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

    test("a press renders nothing, so the node it landed on is still there for its click and dblclick", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );
      const before: number = renders();

      // Both presses of a double-click, with a jiggle inside the bucket.
      press(4);
      move(4);
      release({ activeTooltipIndex: 4 });
      fireEvent.mouseUp(window);
      press(4);
      release({ activeTooltipIndex: 4 });

      expect(renders()).toBe(before);
      expect(screen.queryByTestId("selection-band")).toBeNull();
      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("the band appears once the pointer reaches another bucket, from the pressed one", () => {
      render(
        chartUnderTest.render(
          getJestMockFunction() as unknown as SelectHandler,
        ),
      );

      press(2);
      move(2);
      expect(screen.queryByTestId("selection-band")).toBeNull();

      move(3);
      const band: HTMLElement = screen.getByTestId("selection-band");
      expect(band).toHaveAttribute("data-x1", "10:02");
      expect(band).toHaveAttribute("data-x2", "10:03");

      // Back over the pressed bucket: still a (one-bucket) band, not a click.
      move(2);
      expect(screen.getByTestId("selection-band")).toHaveAttribute(
        "data-x2",
        "10:02",
      );
    });

    test("a right-to-left drag's band runs between its buckets in row order", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(6);
      move(5);
      // Two neighbours: the band covers both (a bar chart drew none).
      let band: HTMLElement = screen.getByTestId("selection-band");
      expect(band).toHaveAttribute("data-x1", "10:05");
      expect(band).toHaveAttribute("data-x2", "10:06");

      move(2);
      band = screen.getByTestId("selection-band");
      expect(band).toHaveAttribute("data-x1", "10:02");
      expect(band).toHaveAttribute("data-x2", "10:06");

      // Crossing back over the pressed bucket flips the band's far edge.
      move(8);
      band = screen.getByTestId("selection-band");
      expect(band).toHaveAttribute("data-x1", "10:06");
      expect(band).toHaveAttribute("data-x2", "10:08");

      move(2);
      release({ activeTooltipIndex: 2 });
      expect(selection(onTimeRangeSelect)).toEqual([
        ["2026-09-28T10:02:00.000Z", "2026-09-28T10:07:00.000Z"],
      ]);
    });

    test("a drag that comes back to its first bucket is released as a click", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(2);
      move(5);
      move(2);
      release({ activeTooltipIndex: 2 });

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      expect(screen.queryByTestId("selection-band")).toBeNull();
    });

    test("the chart takes mousemove unthrottled, so press and release read the bucket under the pointer now", () => {
      render(
        chartUnderTest.render(
          getJestMockFunction() as unknown as SelectHandler,
        ),
      );

      const throttled: ReadonlyArray<string> | undefined =
        chart().throttledEvents;
      expect(throttled).toBeDefined();
      expect(throttled).not.toContain("mousemove");
      // The rest of recharts' defaults stay throttled.
      expect([...(throttled || [])].sort()).toEqual([
        "pointermove",
        "scroll",
        "touchmove",
        "wheel",
      ]);
    });

    test("a chart with no drag keeps recharts' default throttling", () => {
      render(chartUnderTest.render(undefined));

      expect(chart().throttledEvents).toBeUndefined();
    });

    test("only the main button drags: a right-click press selects nothing", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      act(() => {
        chart().onMouseDown?.({ activeTooltipIndex: 2 }, { button: 2 });
      });
      move(6);
      release({ activeTooltipIndex: 6 });
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      expect(screen.queryByTestId("selection-band")).toBeNull();
    });

    test("a main-button press with its event still drags", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      act(() => {
        chart().onMouseDown?.({ activeTooltipIndex: 2 }, { button: 0 });
      });
      move(4);
      release({ activeTooltipIndex: 4 });

      expect(selection(onTimeRangeSelect)).toEqual([
        ["2026-09-28T10:02:00.000Z", "2026-09-28T10:05:00.000Z"],
      ]);
    });

    test("a press off the rows starts nothing and leaves no page-wide listener", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const addListener: jest.SpiedFunction<typeof window.addEventListener> =
        jest.spyOn(window, "addEventListener");
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );
      addListener.mockClear();

      press(42);
      move(3);
      fireEvent.mouseUp(window);

      expect(
        addListener.mock.calls.filter((call: Array<unknown>) => {
          return call[0] === "mouseup";
        }),
      ).toHaveLength(0);
      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      addListener.mockRestore();
    });

    test("every press's page-wide listener is gone once the press ends", () => {
      const addListener: jest.SpiedFunction<typeof window.addEventListener> =
        jest.spyOn(window, "addEventListener");
      const removeListener: jest.SpiedFunction<
        typeof window.removeEventListener
      > = jest.spyOn(window, "removeEventListener");
      render(
        chartUnderTest.render(
          getJestMockFunction() as unknown as SelectHandler,
        ),
      );

      // A click, a drag released on the chart, and one released outside.
      press(1);
      release({ activeTooltipIndex: 1 });
      press(1);
      move(3);
      release({ activeTooltipIndex: 3 });
      press(2);
      move(5);
      fireEvent.mouseUp(window);

      const added: Array<unknown> = addListener.mock.calls
        .filter((call: Array<unknown>) => {
          return call[0] === "mouseup";
        })
        .map((call: Array<unknown>) => {
          return call[1];
        });
      const removed: Array<unknown> = removeListener.mock.calls
        .filter((call: Array<unknown>) => {
          return call[0] === "mouseup";
        })
        .map((call: Array<unknown>) => {
          return call[1];
        });
      expect(added).toHaveLength(3);
      for (const listener of added) {
        expect(removed).toContain(listener);
      }
      addListener.mockRestore();
      removeListener.mockRestore();
    });

    test("a chart unmounted mid-drag stops listening for the release", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const rendered: ReturnType<typeof render> = render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      press(1);
      move(4);
      rendered.unmount();
      fireEvent.mouseUp(window);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("a new press after a lost release starts over from the new bucket", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      render(
        chartUnderTest.render(onTimeRangeSelect as unknown as SelectHandler),
      );

      // The release of this drag never reaches the page.
      press(1);
      move(8);
      press(5);
      move(6);
      release({ activeTooltipIndex: 6 });

      expect(selection(onTimeRangeSelect)).toEqual([
        ["2026-09-28T10:05:00.000Z", "2026-09-28T10:07:00.000Z"],
      ]);
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
