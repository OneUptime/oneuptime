import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomUtil from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * Issue #4105. A page owns its time range (component state, the URL, a
 * saved view); useTimeRangeZoom layers drag-to-zoom and double-click-to-reset
 * on top of it without taking that ownership away. These tests drive the
 * hook through a real host component that keeps the range in its own state,
 * the way the resource overview pages do.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const ROLLING_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const ROLLING_DAY: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

let latestZoom: TimeRangeZoom | null = null;
let latestSetRange: ((range: RangeStartAndEndDateTime) => void) | null = null;
const onRangeChangeSpy: MockFunction = getJestMockFunction();
const zoomCallbacks: Array<unknown> = [];
const resetCallbacks: Array<unknown> = [];

const Host: FunctionComponent<{
  initial?: RangeStartAndEndDateTime;
}> = (props: { initial?: RangeStartAndEndDateTime }): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(
    props.initial || ROLLING_HOUR,
  );

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: range,
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      onRangeChangeSpy(next);
      setRange(next);
    },
  });

  latestZoom = zoom;
  latestSetRange = setRange;
  zoomCallbacks.push(zoom.zoomToTimeRange);
  resetCallbacks.push(zoom.resetZoom);

  return (
    <div>
      <span data-testid="range">{range.range}</span>
      <span data-testid="start">
        {range.startAndEndDate?.startValue?.toISOString() || ""}
      </span>
      <span data-testid="end">
        {range.startAndEndDate?.endValue?.toISOString() || ""}
      </span>
      <span data-testid="is-zoomed">{String(zoom.isZoomed)}</span>
      <span data-testid="before-zoom">
        {zoom.rangeBeforeZoom ? zoom.rangeBeforeZoom.range : "none"}
      </span>
    </div>
  );
};

function zoomApi(): TimeRangeZoom {
  if (!latestZoom) {
    throw new Error("host has not rendered");
  }
  return latestZoom;
}

function read(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

function zoomTo(startIso: string, endIso: string): void {
  act(() => {
    zoomApi().zoomToTimeRange(new Date(startIso), new Date(endIso));
  });
}

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  latestZoom = null;
  latestSetRange = null;
  onRangeChangeSpy.mockReset();
  zoomCallbacks.length = 0;
  resetCallbacks.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useTimeRangeZoom", () => {
  test("starts unzoomed on the page's own range", () => {
    render(<Host />);

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
    expect(onRangeChangeSpy).not.toHaveBeenCalled();
  });

  test("a drag moves the page onto the window dragged out", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");

    expect(read("range")).toBe(TimeRange.CUSTOM);
    expect(read("start")).toBe("2026-09-28T11:10:00.000Z");
    expect(read("end")).toBe("2026-09-28T11:25:00.000Z");
    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(1);
  });

  test("a reset puts the page back on the range it had before the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("start")).toBe("");
    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
    expect(onRangeChangeSpy).toHaveBeenLastCalledWith(ROLLING_HOUR);
  });

  test("zooming again keeps the ORIGINAL range, so one reset climbs all the way out", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:15:00.000Z");
    zoomTo("2026-09-28T11:11:00.000Z", "2026-09-28T11:12:00.000Z");

    expect(read("start")).toBe("2026-09-28T11:11:00.000Z");
    expect(read("end")).toBe("2026-09-28T11:12:00.000Z");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("a custom range the page started on is what a reset returns to", () => {
    const start: RangeStartAndEndDateTime = custom(
      "2026-09-20T00:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
    );
    render(<Host initial={start} />);

    zoomTo("2026-09-20T09:00:00.000Z", "2026-09-20T10:00:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("start")).toBe("2026-09-20T00:00:00.000Z");
    expect(read("end")).toBe("2026-09-21T00:00:00.000Z");
    expect(read("is-zoomed")).toBe("false");
  });

  test("resetting a page that is not zoomed does nothing at all", () => {
    render(<Host />);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a second reset after the first does nothing", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });
    act(() => {
      zoomApi().resetZoom();
    });

    expect(onRangeChangeSpy).toHaveBeenCalledTimes(2);
  });

  test("a zero-width selection neither zooms nor spends a refetch", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:10:00.000Z");

    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("is-zoomed")).toBe("false");
  });

  test("a zoom out of a rolling range stops at now", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:55:00.000Z", "2026-09-28T12:01:00.000Z");

    expect(read("end")).toBe(NOW.toISOString());
  });

  test("picking a range elsewhere (the time picker) ends the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(ROLLING_DAY);
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
    expect(read("is-zoomed")).toBe("false");

    // And a reset now must not drag the page back to the old hour.
    onRangeChangeSpy.mockReset();
    act(() => {
      zoomApi().resetZoom();
    });
    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("a new zoom after the picker moved on remembers the NEW starting point", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(ROLLING_DAY);
    });
    zoomTo("2026-09-28T02:00:00.000Z", "2026-09-28T03:00:00.000Z");

    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_DAY);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("the page re-stating the zoomed window in a new object keeps the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    // e.g. a round trip through the URL: equal instants, new objects.
    act(() => {
      latestSetRange?.(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      );
    });

    expect(read("is-zoomed")).toBe("true");
    act(() => {
      zoomApi().resetZoom();
    });
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("picking a custom range by hand is a new starting point, not a zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:26:00.000Z"),
      );
    });

    expect(read("is-zoomed")).toBe("false");
  });

  test("two gestures before the page re-renders still see each other", () => {
    render(<Host />);

    act(() => {
      zoomApi().zoomToTimeRange(
        new Date("2026-09-28T11:00:00.000Z"),
        new Date("2026-09-28T11:30:00.000Z"),
      );
      zoomApi().zoomToTimeRange(
        new Date("2026-09-28T11:10:00.000Z"),
        new Date("2026-09-28T11:20:00.000Z"),
      );
    });

    expect(read("start")).toBe("2026-09-28T11:10:00.000Z");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      zoomApi().resetZoom();
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    // One zoom, one more zoom, one reset. The second reset had nothing to undo.
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(3);
  });

  test("zoomToTimeRange and resetZoom keep their identity across every render", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    zoomTo("2026-09-28T11:12:00.000Z", "2026-09-28T11:20:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(zoomCallbacks.length).toBeGreaterThan(3);
    expect(new Set(zoomCallbacks).size).toBe(1);
    expect(new Set(resetCallbacks).size).toBe(1);
  });

  test("a callback captured before a zoom still acts on the latest range", () => {
    render(<Host />);

    const staleZoom: (startTime: Date, endTime: Date) => void =
      zoomApi().zoomToTimeRange;
    const staleReset: () => void = zoomApi().resetZoom;

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    act(() => {
      staleZoom(
        new Date("2026-09-28T11:05:00.000Z"),
        new Date("2026-09-28T11:10:00.000Z"),
      );
    });

    expect(read("start")).toBe("2026-09-28T11:05:00.000Z");
    // The original hour, not the 30-minute window the stale closure saw.
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      staleReset();
    });
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the zoom it hands the page is exactly the range it reports", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");

    const handedToPage: RangeStartAndEndDateTime = onRangeChangeSpy.mock
      .calls[0]![0] as RangeStartAndEndDateTime;

    expect(
      TimeRangeZoomUtil.isSameRange(
        handedToPage,
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      ),
    ).toBe(true);
  });
});
