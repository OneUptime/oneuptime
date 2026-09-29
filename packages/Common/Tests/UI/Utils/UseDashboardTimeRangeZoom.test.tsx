import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import useDashboardTimeRangeZoom, {
  DashboardTimeRangeZoom,
} from "../../../UI/Utils/UseDashboardTimeRangeZoom";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The dashboard shells hand this hook's three callbacks straight into a
 * canvas full of React.memo'd widgets whose comparators deliberately do NOT
 * compare function identity. So identity stability is not a nicety here —
 * a callback that changes reference every render would be blocked from
 * reaching the widget, leaving it holding a closure over a stale range, and
 * the SECOND zoom of a session would silently do nothing.
 *
 * These tests read the hook through a real component lifecycle, and pin the
 * identity contract explicitly.
 */

const ROLLING_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const PINNED_DAY: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-08-20T00:00:00.000Z"),
    new Date("2026-08-21T00:00:00.000Z"),
  ),
};

const DRAG_START: Date = new Date("2026-08-20T09:20:00.000Z");
const DRAG_END: Date = new Date("2026-08-20T09:35:00.000Z");

let latest: DashboardTimeRangeZoom | null = null;
let renderCount: number = 0;
const seenCallbacks: {
  set: Array<unknown>;
  zoom: Array<unknown>;
  reset: Array<unknown>;
} = { set: [], zoom: [], reset: [] };

const ZoomProbe: FunctionComponent = (): ReactElement => {
  const zoom: DashboardTimeRangeZoom = useDashboardTimeRangeZoom(ROLLING_HOUR);

  latest = zoom;
  renderCount++;
  seenCallbacks.set.push(zoom.setStartAndEndDate);
  seenCallbacks.zoom.push(zoom.zoomToTimeRange);
  seenCallbacks.reset.push(zoom.resetZoom);

  return (
    <div>
      <span data-testid="range">{zoom.startAndEndDate.range}</span>
      <span data-testid="start">
        {zoom.startAndEndDate.startAndEndDate?.startValue?.toISOString() || ""}
      </span>
      <span data-testid="end">
        {zoom.startAndEndDate.startAndEndDate?.endValue?.toISOString() || ""}
      </span>
      <span data-testid="is-zoomed">{String(zoom.isZoomed)}</span>
    </div>
  );
};

function read(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

function zoomApi(): DashboardTimeRangeZoom {
  if (!latest) {
    throw new Error("probe has not rendered");
  }
  return latest;
}

function renderProbe(): void {
  latest = null;
  renderCount = 0;
  seenCallbacks.set = [];
  seenCallbacks.zoom = [];
  seenCallbacks.reset = [];
  render(<ZoomProbe />);
}

afterEach(() => {
  cleanup();
});

describe("useDashboardTimeRangeZoom", () => {
  test("starts on the initial range with nothing to reset", () => {
    renderProbe();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("a panel drag pins the board to the selected window", () => {
    renderProbe();

    act(() => {
      zoomApi().zoomToTimeRange(DRAG_START, DRAG_END);
    });

    expect(read("range")).toBe(TimeRange.CUSTOM);
    expect(read("start")).toBe(DRAG_START.toISOString());
    expect(read("end")).toBe(DRAG_END.toISOString());
    expect(read("is-zoomed")).toBe("true");
  });

  test("a double-click reset puts the board back on the pre-zoom range", () => {
    renderProbe();

    act(() => {
      zoomApi().zoomToTimeRange(DRAG_START, DRAG_END);
    });
    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("resetting an unzoomed board does not even re-render", () => {
    renderProbe();
    const rendersBefore: number = renderCount;

    act(() => {
      zoomApi().resetZoom();
    });

    /*
     * The util returns the same state object, so React bails out of the
     * update — a stray double-click on an unzoomed dashboard costs nothing
     * and cannot make every widget refetch.
     */
    expect(renderCount).toBe(rendersBefore);
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("an explicit picker change replaces the range and retires the reset", () => {
    renderProbe();

    act(() => {
      zoomApi().zoomToTimeRange(DRAG_START, DRAG_END);
    });
    expect(read("is-zoomed")).toBe("true");

    act(() => {
      zoomApi().setStartAndEndDate(PINNED_DAY);
    });

    expect(read("start")).toBe("2026-08-20T00:00:00.000Z");
    expect(read("is-zoomed")).toBe("false");
  });

  test("the three callbacks keep their identity across every re-render", () => {
    renderProbe();

    act(() => {
      zoomApi().zoomToTimeRange(DRAG_START, DRAG_END);
    });
    act(() => {
      zoomApi().setStartAndEndDate(PINNED_DAY);
    });
    act(() => {
      zoomApi().zoomToTimeRange(DRAG_START, DRAG_END);
    });
    act(() => {
      zoomApi().resetZoom();
    });

    expect(renderCount).toBeGreaterThan(1);
    for (const captured of [
      seenCallbacks.set,
      seenCallbacks.zoom,
      seenCallbacks.reset,
    ]) {
      expect(new Set(captured).size).toBe(1);
    }
  });
});
