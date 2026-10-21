/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useViewerTimeRangeZoom, {
  ViewerTimeRangeZoom,
  ViewerTimeRangeZoomOptions,
} from "../../../../UI/Components/TelemetryViewer/useViewerTimeRangeZoom";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4105. An explorer (the logs viewer, and the traces, exceptions and
 * security events viewers on the telemetry shell) does not own its window:
 * its host does. useViewerTimeRangeZoom is what lets every chart in the
 * explorer - the volume histogram, the analytics timeseries, the picker's
 * "Reset zoom" - share one zoom over that window, and what decides when the
 * zoom is over.
 *
 * Two kinds of host are driven here: a real one that keeps the window in its
 * own state and applies what it is handed (the Dashboard viewers), and a
 * static one that never re-renders with the zoomed window (the Common
 * viewer's own tests are written that way, and must keep working).
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
const PAST_DAY: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

// Dates restored from a URL can arrive as strings; print both the same way.
function iso(date: unknown): string {
  return new Date(date as Date | string).toISOString();
}

function windowOf(range: RangeStartAndEndDateTime | null | undefined): string {
  if (!range) {
    return "none";
  }

  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }

  return `${iso(range.startAndEndDate!.startValue)}..${iso(
    range.startAndEndDate!.endValue,
  )}`;
}

/*
 * A host that owns the window, the way DashboardLogsViewer and TracesViewer
 * do: a drag becomes a custom window, a pick is applied as it comes.
 */
let latest: ViewerTimeRangeZoom | null = null;
let setHostRange: ((range: RangeStartAndEndDateTime) => void) | null = null;
const hostSelectSpy: MockFunction = getJestMockFunction();
const hostChangeSpy: MockFunction = getJestMockFunction();

const StatefulHost: FunctionComponent<{
  initial: RangeStartAndEndDateTime;
  withoutChangeHandler?: boolean;
}> = (props: {
  initial: RangeStartAndEndDateTime;
  withoutChangeHandler?: boolean;
}): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(props.initial);

  const zoom: ViewerTimeRangeZoom = useViewerTimeRangeZoom({
    timeRange: range,
    onTimeRangeSelect: (startTime: Date, endTime: Date): void => {
      hostSelectSpy(startTime, endTime);
      setRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(startTime, endTime),
      });
    },
    onTimeRangeChange: props.withoutChangeHandler
      ? undefined
      : (next: RangeStartAndEndDateTime): void => {
          hostChangeSpy(next);
          setRange(next);
        },
  });

  latest = zoom;
  setHostRange = setRange;

  return (
    <div>
      <span data-testid="window">{windowOf(range)}</span>
      <span data-testid="is-zoomed">
        {String(Boolean(zoom.zoom?.isZoomed))}
      </span>
      <span data-testid="before-zoom">
        {windowOf(zoom.zoom?.rangeBeforeZoom || null)}
      </span>
      <span data-testid="can-zoom-out">{String(Boolean(zoom.onZoomOut))}</span>
    </div>
  );
};

function api(): ViewerTimeRangeZoom {
  if (!latest) {
    throw new Error("the host has not rendered");
  }
  return latest;
}

function read(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

function drag(startIso: string, endIso: string): void {
  act(() => {
    api().onTimeRangeSelect?.(new Date(startIso), new Date(endIso));
  });
}

function zoomOut(): void {
  act(() => {
    api().onZoomOut?.();
  });
}

function pick(range: RangeStartAndEndDateTime): void {
  act(() => {
    api().onTimeRangeChange?.(range);
  });
}

function hostMovesTo(range: RangeStartAndEndDateTime): void {
  act(() => {
    setHostRange!(range);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  latest = null;
  setHostRange = null;
  hostSelectSpy.mockReset();
  hostChangeSpy.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a host that owns the window and applies the zoom", () => {
  test("a drag reaches the host's select handler and the explorer is zoomed", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    expect(read("is-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");

    expect(hostSelectSpy).toHaveBeenCalledTimes(1);
    expect(iso(hostSelectSpy.mock.calls[0]![0])).toBe(
      "2026-09-28T11:20:00.000Z",
    );
    expect(iso(hostSelectSpy.mock.calls[0]![1])).toBe(
      "2026-09-28T11:30:00.000Z",
    );
    expect(read("window")).toBe(
      "2026-09-28T11:20:00.000Z..2026-09-28T11:30:00.000Z",
    );
    expect(read("is-zoomed")).toBe("true");
    expect(read("can-zoom-out")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the way back goes to the host's change handler, with the window from before the zoom", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomOut();

    expect(hostChangeSpy).toHaveBeenCalledTimes(1);
    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(PAST_HOUR);
    expect(read("window")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");
  });

  test("the zoom's reset, handed to a provider, does the same", () => {
    render(<StatefulHost initial={PAST_DAY} />);

    drag("2026-09-28T09:00:00.000Z", "2026-09-28T10:00:00.000Z");
    act(() => {
      api().zoom!.resetZoom();
    });

    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(PAST_DAY);
    expect(read("is-zoomed")).toBe("false");
  });

  test("only the first zoom is remembered: one reset climbs all the way out", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:00:00.000Z", "2026-09-28T11:40:00.000Z");
    drag("2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    drag("2026-09-28T11:12:00.000Z", "2026-09-28T11:13:00.000Z");

    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    zoomOut();

    expect(hostChangeSpy).toHaveBeenCalledTimes(1);
    expect(read("window")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a custom window comes back exactly", () => {
    const original: RangeStartAndEndDateTime = custom(
      "2026-09-27T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    );
    render(<StatefulHost initial={original} />);

    drag("2026-09-27T06:00:00.000Z", "2026-09-27T07:00:00.000Z");

    expect(read("before-zoom")).toBe(
      "2026-09-27T00:00:00.000Z..2026-09-28T00:00:00.000Z",
    );

    zoomOut();

    expect(read("window")).toBe(
      "2026-09-27T00:00:00.000Z..2026-09-28T00:00:00.000Z",
    );
  });

  test("a bar that runs past the end of a fixed window is cut at that end", () => {
    render(
      <StatefulHost
        initial={custom("2026-09-28T09:00:00.000Z", "2026-09-28T10:17:30.000Z")}
      />,
    );

    drag("2026-09-28T10:17:00.000Z", "2026-09-28T10:18:00.000Z");

    expect(iso(hostSelectSpy.mock.calls[0]![1])).toBe(
      "2026-09-28T10:17:30.000Z",
    );
  });

  test("the newest bar of a relative window stops at now", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:59:00.000Z", "2026-09-28T12:01:00.000Z");

    expect(iso(hostSelectSpy.mock.calls[0]![1])).toBe(NOW.toISOString());
  });

  test("a right-to-left drag is the same window", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:30:00.000Z", "2026-09-28T11:20:00.000Z");

    expect(iso(hostSelectSpy.mock.calls[0]![0])).toBe(
      "2026-09-28T11:20:00.000Z",
    );
    expect(iso(hostSelectSpy.mock.calls[0]![1])).toBe(
      "2026-09-28T11:30:00.000Z",
    );
  });

  test("a zero-width selection is not a window and changes nothing", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:30:00.000Z", "2026-09-28T11:30:00.000Z");

    expect(hostSelectSpy).not.toHaveBeenCalled();
    expect(read("is-zoomed")).toBe("false");
  });

  test("a double-click before any zoom leaves the window alone", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    act(() => {
      api().zoom!.resetZoom();
    });

    expect(hostChangeSpy).not.toHaveBeenCalled();
    expect(read("window")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the way back is spent once it has been taken", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomOut();
    act(() => {
      api().zoom!.resetZoom();
    });

    expect(hostChangeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the zoom is over once the window is anything else", () => {
  test("a pick from the toolbar ends it and reaches the host untouched", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    pick(PAST_DAY);

    expect(hostChangeSpy).toHaveBeenCalledWith(PAST_DAY);
    expect(read("is-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");
  });

  test("picking the window the zoom started from ends it too", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    pick(PAST_HOUR);

    expect(read("window")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  /*
   * The bug the older useHistogramZoom had: it kept the pre-zoom window
   * until the picker was used, so after a saved view (or a shared time
   * cursor, or "show time range") moved the explorer, "zoom out" jumped to a
   * window from before that.
   */
  test("a host moving the window by other means (a saved view) ends it", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    hostMovesTo(PAST_DAY);

    expect(read("is-zoomed")).toBe("false");
    expect(read("can-zoom-out")).toBe("false");

    act(() => {
      api().zoom!.resetZoom();
    });
    expect(hostChangeSpy).not.toHaveBeenCalled();
    expect(read("window")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("the next zoom after that starts from the new window", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    hostMovesTo(PAST_DAY);
    drag("2026-09-28T06:00:00.000Z", "2026-09-28T07:00:00.000Z");

    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_DAY);

    zoomOut();

    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(PAST_DAY);
  });

  test("a host that goes back to the pre-zoom window by other means does not bring the zoom back", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    hostMovesTo(PAST_DAY);
    hostMovesTo(PAST_HOUR);

    expect(read("is-zoomed")).toBe("false");
  });

  test("an equal but new window object from the host keeps the zoom", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    hostMovesTo(custom("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z"));

    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a window restored with string dates (a URL, a saved view) still compares by value", () => {
    render(<StatefulHost initial={PAST_HOUR} />);

    drag("2026-09-28T11:20:00.000Z", "2026-09-28T11:30:00.000Z");
    hostMovesTo({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        "2026-09-28T11:20:00.000Z" as unknown as Date,
        "2026-09-28T11:30:00.000Z" as unknown as Date,
      ),
    });

    expect(read("is-zoomed")).toBe("true");
  });
});

describe("a host that never re-renders with the zoomed window", () => {
  interface StaticHarness {
    result: { current: ViewerTimeRangeZoom };
    rerender: (options: ViewerTimeRangeZoomOptions) => void;
    select: MockFunction;
    change: MockFunction;
  }

  function renderStatic(
    timeRange: RangeStartAndEndDateTime | undefined,
    handlers: { select?: boolean; change?: boolean } = {},
  ): StaticHarness {
    const select: MockFunction = getJestMockFunction();
    const change: MockFunction = getJestMockFunction();
    const options: ViewerTimeRangeZoomOptions = {
      timeRange: timeRange,
      onTimeRangeSelect: handlers.select === false ? undefined : select,
      onTimeRangeChange: handlers.change === false ? undefined : change,
    };

    const { result, rerender } = renderHook(
      (hookOptions: ViewerTimeRangeZoomOptions) => {
        return useViewerTimeRangeZoom(hookOptions);
      },
      { initialProps: options },
    );

    return { result, rerender, select, change };
  }

  test("still counts as zoomed after a drag, and zooms back out to where it was", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY);

    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T09:00:00.000Z"),
        new Date("2026-09-28T10:00:00.000Z"),
      );
    });

    expect(harness.select).toHaveBeenCalledTimes(1);
    expect(harness.result.current.onZoomOut).toBeDefined();
    expect(harness.result.current.zoom?.isZoomed).toBe(true);

    act(() => {
      harness.result.current.onZoomOut?.();
    });

    expect(harness.change).toHaveBeenCalledWith(PAST_DAY);
    expect(harness.result.current.onZoomOut).toBeUndefined();
  });

  test("a second drag still remembers the first window", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY);

    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T09:00:00.000Z"),
        new Date("2026-09-28T10:00:00.000Z"),
      );
    });
    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T09:10:00.000Z"),
        new Date("2026-09-28T09:20:00.000Z"),
      );
    });

    expect(harness.result.current.zoom?.rangeBeforeZoom).toEqual(PAST_DAY);
  });

  test("with no select handler the charts get no zoom and no provider value", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY, { select: false });

    expect(harness.result.current.zoom).toBeNull();
    expect(harness.result.current.onTimeRangeSelect).toBeUndefined();
    expect(harness.result.current.onZoomOut).toBeUndefined();
    // The picker still works.
    expect(harness.result.current.onTimeRangeChange).toBeDefined();
  });

  test("with no change handler a drag still narrows, but there is no way back to offer", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY, { change: false });

    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T09:00:00.000Z"),
        new Date("2026-09-28T10:00:00.000Z"),
      );
    });

    expect(harness.select).toHaveBeenCalledTimes(1);
    expect(harness.result.current.onZoomOut).toBeUndefined();
    expect(harness.result.current.zoom?.isZoomed).toBe(false);
    expect(harness.result.current.onTimeRangeChange).toBeUndefined();
  });

  test("with no window at all a drag passes straight through, unclamped", () => {
    const harness: StaticHarness = renderStatic(undefined);

    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T13:00:00.000Z"),
        new Date("2026-09-28T14:00:00.000Z"),
      );
    });

    expect(iso(harness.select.mock.calls[0]![1])).toBe(
      "2026-09-28T14:00:00.000Z",
    );
    expect(harness.result.current.onZoomOut).toBeUndefined();
  });

  test("the callbacks keep their identity across renders", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY);
    const firstSelect: unknown = harness.result.current.onTimeRangeSelect;
    const firstPick: unknown = harness.result.current.onTimeRangeChange;
    const firstZoom: unknown = harness.result.current.zoom;

    harness.rerender({
      timeRange: { range: TimeRange.PAST_ONE_DAY },
      onTimeRangeSelect: harness.select,
      onTimeRangeChange: harness.change,
    });

    expect(harness.result.current.onTimeRangeSelect).toBe(firstSelect);
    expect(harness.result.current.onTimeRangeChange).toBe(firstPick);
    expect(harness.result.current.zoom).toBe(firstZoom);
  });

  test("a handler swapped by the host is the one a later gesture reaches", () => {
    const harness: StaticHarness = renderStatic(PAST_DAY);
    const newerSelect: MockFunction = getJestMockFunction();

    harness.rerender({
      timeRange: PAST_DAY,
      onTimeRangeSelect: newerSelect,
      onTimeRangeChange: harness.change,
    });

    act(() => {
      harness.result.current.onTimeRangeSelect?.(
        new Date("2026-09-28T09:00:00.000Z"),
        new Date("2026-09-28T10:00:00.000Z"),
      );
    });

    expect(harness.select).not.toHaveBeenCalled();
    expect(newerSelect).toHaveBeenCalledTimes(1);
  });
});
