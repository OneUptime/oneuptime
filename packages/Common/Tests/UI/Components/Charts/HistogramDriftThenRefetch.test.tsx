/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  RenderHookResult,
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4116. Right after a zoom an explorer's histogram refetches, and
 * the answer can land while the reader holds the button down on a bar. A
 * press that stayed put is a click on the bar it pressed - but not when
 * that bar is no longer on the chart: then it zooms nowhere.
 *
 * Telling the two apart is subtle once the hand has drifted a pixel or two
 * inside the pressed bar before the new bars land. recharts works out the
 * bar under the pointer again only when the pointer moves, and it clamps a
 * stale spot on the axis onto the last bar of shorter data: pressed on bar
 * 25 of 30, the release of a 10-bar refetch reports bar 9, a different
 * spot, although the pointer has not moved since recharts last reported.
 * The rule pinned here: a report at the same place as the one before it
 * that names another bar means new data landed under the press, however
 * much the hand drifted before that. These cases zoomed into the bar that
 * was gone before that rule.
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

import useHistogramRangeSelection, {
  HistogramRangeSelectionOptions,
  HistogramRangeSelectionState,
} from "../../../../UI/Components/Charts/Utils/useHistogramRangeSelection";
import TelemetryHistogram from "../../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramBucket } from "../../../../UI/Components/TelemetryViewer/types";

const MINUTE_MS: number = 60 * 1000;
// Bar 25 of the 30 one-minute bars from 10:00.
const PRESSED_BAR: string = "2026-09-28T10:25:00.000Z";
// The last of the 10 one-minute bars from 11:00 that land mid-press.
const REFETCH_LAST_BAR: string = "2026-09-28T11:09:00.000Z";
// The refetch's bar recharts hit-tests at the pointer once it moves again.
const REFETCH_BAR_UNDER_POINTER: string = "2026-09-28T11:08:00.000Z";

type SelectionHook = RenderHookResult<
  HistogramRangeSelectionState,
  HistogramRangeSelectionOptions
>;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-09-28T11:30:00.000Z") });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function renderSelection(onTimeRangeSelect: MockFunction): SelectionHook {
  const initialProps: HistogramRangeSelectionOptions = {
    onTimeRangeSelect: onTimeRangeSelect as unknown as (
      startTime: Date,
      endTime: Date,
    ) => void,
    bucketIntervalMs: MINUTE_MS,
  };

  return renderHook(
    (options: HistogramRangeSelectionOptions): HistogramRangeSelectionState => {
      return useHistogramRangeSelection(options);
    },
    { initialProps: initialProps },
  );
}

function letTimePass(): void {
  act(() => {
    jest.advanceTimersByTime(1000);
  });
}

function windows(select: MockFunction): Array<[string, string]> {
  return select.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

describe("a still press whose bar leaves the chart after the hand drifted inside it", () => {
  test("zooms nowhere when the shorter refetch clamps the release onto its last bar", () => {
    const select: MockFunction = getJestMockFunction();
    const hook: SelectionHook = renderSelection(select);

    act(() => {
      hook.result.current.onMouseDown(
        { activeLabel: PRESSED_BAR, activeTooltipIndex: "25" },
        { clientX: 500, detail: 1, button: 0 },
      );
    });
    // The hand drifts 2px, still over the pressed bar.
    act(() => {
      hook.result.current.onMouseMove(
        { activeLabel: PRESSED_BAR, activeTooltipIndex: "25" },
        { clientX: 502, detail: 0, button: 0 },
      );
    });
    // The 10-bar refetch lands; the release, where the drift left the pointer.
    act(() => {
      hook.result.current.onMouseUp(
        { activeLabel: REFETCH_LAST_BAR, activeTooltipIndex: "9" },
        { clientX: 502, detail: 1, button: 0 },
      );
    });
    letTimePass();

    expect(windows(select)).toEqual([]);
    expect(hook.result.current.selectionStart).toBeNull();
  });

  test("zooms nowhere when Chrome's made-up move after the new bars are drawn names another bar", () => {
    const select: MockFunction = getJestMockFunction();
    const hook: SelectionHook = renderSelection(select);

    act(() => {
      hook.result.current.onMouseDown(
        { activeLabel: PRESSED_BAR, activeTooltipIndex: "25" },
        { clientX: 500, detail: 1, button: 0 },
      );
    });
    act(() => {
      hook.result.current.onMouseMove(
        { activeLabel: PRESSED_BAR, activeTooltipIndex: "25" },
        { clientX: 502, detail: 0, button: 0 },
      );
    });
    // No movement: the browser re-hit-tests the pointer over the new bars.
    act(() => {
      hook.result.current.onMouseMove(
        { activeLabel: REFETCH_BAR_UNDER_POINTER, activeTooltipIndex: "8" },
        { clientX: 502, detail: 0, button: 0 },
      );
    });
    act(() => {
      hook.result.current.onMouseUp(
        { activeLabel: REFETCH_BAR_UNDER_POINTER, activeTooltipIndex: "8" },
        { clientX: 502, detail: 1, button: 0 },
      );
    });
    letTimePass();

    expect(windows(select)).toEqual([]);
    expect(hook.result.current.isDragging).toBe(false);
  });

  test("still zooms into the bar it pressed when the drift, not new data, crossed into the next bar", () => {
    const select: MockFunction = getJestMockFunction();
    const hook: SelectionHook = renderSelection(select);
    const nextBar: string = "2026-09-28T10:26:00.000Z";

    act(() => {
      hook.result.current.onMouseDown(
        { activeLabel: PRESSED_BAR, activeTooltipIndex: "25" },
        { clientX: 500, detail: 1, button: 0 },
      );
    });
    act(() => {
      hook.result.current.onMouseMove(
        { activeLabel: nextBar, activeTooltipIndex: "26" },
        { clientX: 502, detail: 0, button: 0 },
      );
    });
    act(() => {
      hook.result.current.onMouseUp(
        { activeLabel: nextBar, activeTooltipIndex: "26" },
        { clientX: 502, detail: 1, button: 0 },
      );
    });
    letTimePass();

    expect(windows(select)).toEqual([
      [PRESSED_BAR, "2026-09-28T10:26:00.000Z"],
    ]);
  });
});

function minuteBars(
  from: string,
  count: number,
  base: number,
): Array<HistogramBucket> {
  return Array.from(
    { length: count },
    (_: unknown, index: number): HistogramBucket => {
      return {
        time: new Date(Date.parse(from) + index * MINUTE_MS).toISOString(),
        series: "error",
        count: base + (index % 4),
      };
    },
  );
}

describe("the same with real recharts", () => {
  test("a 1px drift inside bar 25, the 10-bar refetch lands, the release where the drift left the pointer: no zoom", () => {
    const select: MockFunction = getJestMockFunction();
    const show: (buckets: Array<HistogramBucket>) => React.ReactElement = (
      buckets: Array<HistogramBucket>,
    ): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={buckets}
          isLoading={false}
          series={[{ key: "error", label: "Error", color: "#dc2626" }]}
          onTimeRangeSelect={
            select as unknown as (startTime: Date, endTime: Date) => void
          }
          bucketIntervalMs={MINUTE_MS}
        />
      );
    };
    const rendered: RenderResult = render(
      show(minuteBars("2026-09-28T10:00:00.000Z", 30, 5)),
    );
    const bars: Array<Element> = Array.from(
      rendered.container.querySelectorAll(
        ".recharts-bar-rectangle path.recharts-rectangle",
      ),
    );
    const bar: Element = bars[25]!;
    const x: number = Math.round(
      Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2,
    );
    const wrapper: () => Element = (): Element => {
      return rendered.container.querySelector(".recharts-wrapper")!;
    };

    fireEvent.mouseMove(wrapper(), { clientX: x, clientY: 250, buttons: 0 });
    fireEvent.mouseDown(wrapper(), {
      clientX: x,
      clientY: 250,
      button: 0,
      buttons: 1,
      detail: 1,
    });
    // The hand drifts 1px, still over bar 25.
    fireEvent.mouseMove(wrapper(), {
      clientX: x + 1,
      clientY: 250,
      buttons: 1,
    });
    rendered.rerender(show(minuteBars("2026-09-28T11:00:00.000Z", 10, 20)));
    fireEvent.mouseUp(wrapper(), {
      clientX: x + 1,
      clientY: 250,
      button: 0,
      buttons: 0,
      detail: 1,
    });
    letTimePass();

    expect(windows(select)).toEqual([]);
  });
});
