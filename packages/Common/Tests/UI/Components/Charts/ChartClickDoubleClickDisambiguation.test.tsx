import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A double-click is delivered as TWO plain clicks and only then a
 * `dblclick`. On a dashboard panel a plain click already means something —
 * it pins the bucket and opens the investigation inspector — so wiring
 * double-click-to-reset naively would pop that inspector twice on the way
 * to resetting the board, and leave it open on top of the result.
 *
 * The chart library solves it by holding the click open for
 * DOUBLE_CLICK_DISAMBIGUATION_MS and cancelling it when the double-click
 * lands. That delay is a real cost, so it is armed ONLY when a reset
 * handler is supplied — every other chart in the product keeps instant
 * clicks. These tests pin both halves of that bargain.
 *
 * recharts' own chart root is mocked here so the chart-level handlers can
 * be invoked with a known active index: jsdom reports every element as
 * 0x0, so a real click would never resolve to a bucket and the assertions
 * would pass for the wrong reason. The wiring from recharts' DOM into
 * these handlers is covered separately by ChartDoubleClickReset.test.tsx.
 */

/*
 * Deliberately NOT a React props interface: the mock chart below takes an
 * untyped bag and this is just how the captured handlers are read back.
 * Typing the mock's parameter would trip react/no-unused-prop-types, since
 * the mock renders none of them.
 */
type CapturedChartHandlers = {
  onClick?: ((chartState: Record<string, unknown>) => void) | undefined;
  onDoubleClick?: ((...args: Array<unknown>) => void) | undefined;
};

const mockChartPropsRef: { current: CapturedChartHandlers } = { current: {} };

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return children;
    },
    LineChart: (props: Record<string, unknown>): React.ReactElement => {
      mockChartPropsRef.current = props as CapturedChartHandlers;
      return React.createElement("div", { "data-testid": "chart-root" });
    },
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

const BUCKET_MS: number = 60 * 1000;
const FIRST_BUCKET: Date = new Date("2026-08-10T00:00:00.000Z");
const CLICKED_ROW_INDEX: number = 2;

function buildRows(): Array<Record<string, number | string>> {
  const rows: Array<Record<string, number | string>> = [];
  for (let index: number = 0; index < 6; index++) {
    const bucketDate: Date = new Date(
      FIRST_BUCKET.getTime() + index * BUCKET_MS,
    );
    rows.push({
      [CHART_DATA_POINT_X_AXIS_KEY]: bucketDate.toISOString(),
      [CHART_DATA_POINT_DATE_KEY]: bucketDate.getTime(),
      CPU: 10 + index,
    });
  }
  return rows;
}

function renderChart(options: {
  onBucketClick: MockFunction;
  onTimeRangeReset?: MockFunction | undefined;
}): void {
  render(
    <LineChart
      data={buildRows()}
      index={CHART_DATA_POINT_X_AXIS_KEY}
      categories={["CPU"]}
      showLegend={false}
      onBucketClick={
        options.onBucketClick as unknown as (
          bucketStart: Date,
          bucketEnd: Date,
          valuesAtBucket: Record<string, number | string>,
        ) => void
      }
      onTimeRangeReset={
        options.onTimeRangeReset as unknown as (() => void) | undefined
      }
    />,
  );
}

function clickBucket(): void {
  act(() => {
    mockChartPropsRef.current.onClick?.({
      activeTooltipIndex: CLICKED_ROW_INDEX,
    });
  });
}

function doubleClick(): void {
  act(() => {
    mockChartPropsRef.current.onDoubleClick?.({}, {});
  });
}

function advancePastTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS + 10);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockChartPropsRef.current = {};
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("chart click vs. double-click disambiguation", () => {
  test("with no reset handler, a bucket click is delivered immediately", () => {
    const onBucketClick: MockFunction = getJestMockFunction();
    renderChart({ onBucketClick });

    // No onDoubleClick is even handed to recharts when reset is off.
    expect(mockChartPropsRef.current.onDoubleClick).toBeUndefined();

    clickBucket();

    expect(onBucketClick.mock.calls.length).toBe(1);
    expect(onBucketClick.mock.calls[0]?.[0]).toEqual(
      new Date(FIRST_BUCKET.getTime() + CLICKED_ROW_INDEX * BUCKET_MS),
    );
    // The bucket covers its full width, derived from the adjacent rows.
    expect(onBucketClick.mock.calls[0]?.[1]).toEqual(
      new Date(FIRST_BUCKET.getTime() + (CLICKED_ROW_INDEX + 1) * BUCKET_MS),
    );
  });

  test("with a reset handler, a single click still reaches the bucket — just later", () => {
    const onBucketClick: MockFunction = getJestMockFunction();
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    renderChart({ onBucketClick, onTimeRangeReset });

    clickBucket();

    // Held open, in case a second click is coming.
    expect(onBucketClick.mock.calls.length).toBe(0);

    advancePastTheDoubleClickWindow();

    expect(onBucketClick.mock.calls.length).toBe(1);
    expect(onTimeRangeReset.mock.calls.length).toBe(0);
  });

  test("a double-click resets and never pins a bucket", () => {
    const onBucketClick: MockFunction = getJestMockFunction();
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    renderChart({ onBucketClick, onTimeRangeReset });

    // Exactly what the browser delivers: click, click, then dblclick.
    clickBucket();
    clickBucket();
    doubleClick();

    expect(onTimeRangeReset.mock.calls.length).toBe(1);

    advancePastTheDoubleClickWindow();

    // Neither click may survive the reset.
    expect(onBucketClick.mock.calls.length).toBe(0);
  });

  test("a click after a double-click still works", () => {
    const onBucketClick: MockFunction = getJestMockFunction();
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    renderChart({ onBucketClick, onTimeRangeReset });

    clickBucket();
    clickBucket();
    doubleClick();
    advancePastTheDoubleClickWindow();

    clickBucket();
    advancePastTheDoubleClickWindow();

    expect(onBucketClick.mock.calls.length).toBe(1);
    expect(onTimeRangeReset.mock.calls.length).toBe(1);
  });

  test("unmounting mid-gesture drops the pending click instead of firing it", () => {
    const onBucketClick: MockFunction = getJestMockFunction();
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    renderChart({ onBucketClick, onTimeRangeReset });

    clickBucket();
    cleanup();
    advancePastTheDoubleClickWindow();

    /*
     * A widget can be unmounted by the very reset the user is performing
     * (the board re-queries and re-renders); a timer that outlives it would
     * call back into a dead component.
     */
    expect(onBucketClick.mock.calls.length).toBe(0);
  });
});
