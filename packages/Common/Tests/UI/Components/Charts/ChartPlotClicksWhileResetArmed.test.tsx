import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Clicks on a chart's plot while a double-click reset is on offer (issue
 * #4105, found driving the zoom in a real browser).
 *
 * A double-click on a line never reset the zoom. Its clicks landed on the
 * line's transparent click target, which toggled the series highlight at
 * once; that re-render re-keyed the line's path, and Chrome sends dblclick
 * to the node the second click landed on, straight after that click - the
 * node was gone, so the chart never heard the dblclick. Every click on the
 * plot (series, dot, bar, empty plot) now waits out the double-click window
 * while a reset is on offer, and the dblclick drops it.
 *
 * Also pinned here, on real recharts:
 *   - a bar highlighted by a click no longer dims every bar after the chart
 *     is redrawn over other buckets (a zoom or a reset);
 *   - the crosshair that says "drag me" is on the chart root, where it
 *     beats recharts' inline cursor: default.
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

import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

const MINUTE_MS: number = 60 * 1000;
const START: Date = new Date("2026-08-10T00:00:00.000Z");

function series(
  name: string,
  from: Date,
  count: number,
  base: number,
): SeriesPoint {
  const data: Array<DataPoint> = [];
  for (let index: number = 0; index < count; index++) {
    data.push({
      x: new Date(from.getTime() + index * MINUTE_MS),
      y: base + index,
    });
  }
  return { seriesName: name, data: data };
}

function xAxis(from: Date, minutes: number): ChartXAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: from,
      max: new Date(from.getTime() + minutes * MINUTE_MS),
      aggregateType: XAxisAggregateType.Average,
      precision: XAxisPrecision.EVERY_MINUTE,
    },
  };
}

const Y_AXIS: YAxis = {
  legend: "%",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: 200,
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return `${value}%`;
    },
  },
};

interface ResetProps {
  onTimeRangeReset?: (() => void) | undefined;
  onTimeRangeSelect?: ((start: Date, end: Date) => void) | undefined;
}

function lineChart(props: ResetProps): React.ReactElement {
  return (
    <LineChartElement
      data={[series("CPU", START, 10, 10), series("Memory", START, 10, 100)]}
      xAxis={xAxis(START, 10)}
      yAxis={Y_AXIS}
      curve={ChartCurve.LINEAR}
      heightInPx={300}
      showLegend={false}
      sync={false}
      syncid="plot-clicks-line"
      {...props}
    />
  );
}

function barChart(
  props: ResetProps & { from?: Date | undefined },
): React.ReactElement {
  const from: Date = props.from || START;
  return (
    <BarChartElement
      data={[series("Requests", from, 10, 10)]}
      xAxis={xAxis(from, 10)}
      yAxis={Y_AXIS}
      heightInPx={300}
      showLegend={false}
      sync={false}
      syncid="plot-clicks-bar"
      onTimeRangeReset={props.onTimeRangeReset}
      onTimeRangeSelect={props.onTimeRangeSelect}
    />
  );
}

// The transparent 12px click target drawn over a series' line.
function lineClickTarget(container: HTMLElement, index: number): Element {
  const targets: NodeListOf<Element> = container.querySelectorAll(
    "g.recharts-line.cursor-pointer path.recharts-line-curve",
  );
  const target: Element | undefined = targets[index];
  if (!target) {
    throw new Error(`no click target #${index} (${targets.length} drawn)`);
  }
  return target;
}

// stroke-opacity of each drawn (visible) line.
function visibleLineOpacities(container: HTMLElement): Array<string | null> {
  return Array.from(
    container.querySelectorAll(
      "g.recharts-line:not(.cursor-pointer) path.recharts-line-curve",
    ),
  ).map((path: Element): string | null => {
    return path.getAttribute("stroke-opacity");
  });
}

function bars(container: HTMLElement): Array<Element> {
  return Array.from(container.querySelectorAll(".recharts-bar-rectangle path"));
}

function dimmedBars(container: HTMLElement): number {
  return bars(container).filter((bar: Element): boolean => {
    return (
      bar.getAttribute("opacity") === "0.3" ||
      bar.getAttribute("fill-opacity") === "0.3"
    );
  }).length;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a click on a line while a reset is on offer", () => {
  test("waits out the double-click window before it highlights the series", () => {
    const { container } = render(
      lineChart({ onTimeRangeReset: getJestMockFunction() }),
    );
    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);

    fireEvent.click(lineClickTarget(container, 0));
    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });
    // CPU picked: Memory dims.
    expect(visibleLineOpacities(container)).toEqual(["1", "0.3"]);
  });

  test("a double-click on the line resets, and the node it landed on is still there for the dblclick", () => {
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    const { container } = render(
      lineChart({ onTimeRangeReset: onTimeRangeReset as () => void }),
    );

    const target: Element = lineClickTarget(container, 1);
    fireEvent.click(target, { detail: 1 });
    // Nothing re-rendered under the pointer between the two clicks...
    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);
    fireEvent.click(target, { detail: 2 });
    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);
    // ...so the node the second click landed on is there for the dblclick.
    expect(target.isConnected).toBe(true);
    fireEvent.doubleClick(target, { detail: 2 });

    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    });
    // Neither click toggled the series on its way past.
    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);
  });

  test("with nothing to reset, a click highlights the series at once", () => {
    const { container } = render(lineChart({}));

    fireEvent.click(lineClickTarget(container, 0));

    expect(visibleLineOpacities(container)).toEqual(["1", "0.3"]);
  });

  test("the click that ends a drag highlights nothing", () => {
    const onTimeRangeSelect: MockFunction = getJestMockFunction();
    const { container } = render(
      lineChart({
        onTimeRangeSelect: onTimeRangeSelect as (s: Date, e: Date) => void,
        onTimeRangeReset: getJestMockFunction(),
      }),
    );
    const wrapper: Element = container.querySelector(".recharts-wrapper")!;
    const ticks: Array<Element> = Array.from(
      container.querySelectorAll(
        ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
      ),
    );
    const x: (tick: number) => number = (tick: number): number => {
      return Number(ticks[tick]!.getAttribute("x"));
    };

    fireEvent.mouseMove(wrapper, { clientX: x(1), clientY: 150 });
    fireEvent.mouseDown(wrapper, { clientX: x(1), clientY: 150, button: 0 });
    fireEvent.mouseMove(wrapper, {
      clientX: x(3),
      clientY: 150,
      buttons: 1,
    });
    fireEvent.mouseUp(wrapper, { clientX: x(3), clientY: 150 });
    fireEvent.click(lineClickTarget(container, 0));
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    });

    expect(visibleLineOpacities(container)).toEqual(["1", "1"]);
  });
});

describe("a click on a bar while a reset is on offer", () => {
  test("waits out the double-click window before it highlights the bar", () => {
    const { container } = render(
      barChart({ onTimeRangeReset: getJestMockFunction() }),
    );
    expect(bars(container).length).toBeGreaterThan(5);

    fireEvent.click(bars(container)[2]!);
    expect(dimmedBars(container)).toBe(0);

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });
    expect(dimmedBars(container)).toBe(bars(container).length - 1);
  });

  test("a double-click on a bar resets without highlighting it", () => {
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    const { container } = render(
      barChart({ onTimeRangeReset: onTimeRangeReset as () => void }),
    );

    const bar: Element = bars(container)[4]!;
    fireEvent.click(bar, { detail: 1 });
    fireEvent.click(bar, { detail: 2 });
    fireEvent.doubleClick(bar, { detail: 2 });
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    });

    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
    expect(dimmedBars(container)).toBe(0);
  });

  test("with nothing to reset, a click highlights the bar at once", () => {
    const { container } = render(barChart({}));

    fireEvent.click(bars(container)[2]!);

    expect(dimmedBars(container)).toBe(bars(container).length - 1);
  });
});

describe("a highlighted bar across a zoom or a reset", () => {
  test("a redraw over other buckets drops the highlight instead of dimming every bar", () => {
    const { container, rerender } = render(barChart({}));
    fireEvent.click(bars(container)[3]!);
    expect(dimmedBars(container)).toBe(bars(container).length - 1);

    // Zoomed: the chart now draws other minutes.
    rerender(barChart({ from: new Date(START.getTime() + 30 * MINUTE_MS) }));

    expect(bars(container).length).toBeGreaterThan(5);
    expect(dimmedBars(container)).toBe(0);
  });

  test("a redraw over the same buckets keeps the highlight", () => {
    const { container, rerender } = render(barChart({}));
    fireEvent.click(bars(container)[3]!);

    rerender(barChart({}));

    expect(dimmedBars(container)).toBe(bars(container).length - 1);
  });
});

describe("the drag cursor", () => {
  const charts: Array<{
    name: string;
    render: (props: ResetProps) => React.ReactElement;
  }> = [
    { name: "line", render: lineChart },
    { name: "bar", render: barChart },
    {
      name: "area",
      render: (props: ResetProps): React.ReactElement => {
        return (
          <AreaChartElement
            data={[series("CPU", START, 10, 10)]}
            xAxis={xAxis(START, 10)}
            yAxis={Y_AXIS}
            curve={ChartCurve.LINEAR}
            heightInPx={300}
            showLegend={false}
            sync={false}
            syncid="plot-clicks-area"
            {...props}
          />
        );
      },
    },
  ];

  for (const chart of charts) {
    test(`the ${chart.name} chart's plot shows a crosshair while a drag zooms`, () => {
      const { container } = render(
        chart.render({ onTimeRangeSelect: getJestMockFunction() }),
      );

      expect(container.querySelector(".recharts-wrapper")).toHaveStyle({
        cursor: "crosshair",
      });
    });

    test(`the ${chart.name} chart keeps recharts' own cursor when nothing zooms`, () => {
      const { container } = render(
        chart.render({ onTimeRangeSelect: undefined }),
      );

      expect(container.querySelector(".recharts-wrapper")).toHaveStyle({
        cursor: "default",
      });
    });
  }
});
