/** @timezone UTC */

import useHistogramZoom, {
  HistogramZoomOptions,
  HistogramZoomState,
} from "../../../UI/Components/Charts/Utils/useHistogramZoom";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
const PAST_DAY: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };

function customRange(start: string, end: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(start), new Date(end)),
  };
}

const DRAGGED_START: Date = new Date("2026-08-05T11:58:00Z");
const DRAGGED_END: Date = new Date("2026-08-05T12:00:00Z");

interface ZoomHarness {
  result: { current: HistogramZoomState };
  rerender: (options: HistogramZoomOptions) => void;
  onTimeRangeSelect: MockFunction;
  onTimeRangeChange: MockFunction;
  /** Drags a range out of the histogram, the way the chart would. */
  dragZoom: () => void;
  /** Double-clicks the chart, the way the chart would. */
  zoomOut: () => void;
  /** Picks a range from the toolbar, the way the picker would. */
  pickTimeRange: (timeRange: RangeStartAndEndDateTime) => void;
}

function renderZoom(
  timeRange: RangeStartAndEndDateTime | undefined = PAST_HOUR,
): ZoomHarness {
  const onTimeRangeSelect: MockFunction = getJestMockFunction();
  const onTimeRangeChange: MockFunction = getJestMockFunction();

  const { result, rerender } = renderHook(
    (options: HistogramZoomOptions) => {
      return useHistogramZoom(options);
    },
    {
      initialProps: {
        timeRange: timeRange,
        onTimeRangeSelect: onTimeRangeSelect,
        onTimeRangeChange: onTimeRangeChange,
      } as HistogramZoomOptions,
    },
  );

  return {
    result: result,
    rerender: rerender,
    onTimeRangeSelect: onTimeRangeSelect,
    onTimeRangeChange: onTimeRangeChange,
    dragZoom: (): void => {
      act(() => {
        result.current.onTimeRangeSelect?.(DRAGGED_START, DRAGGED_END);
      });
    },
    zoomOut: (): void => {
      act(() => {
        result.current.onZoomOut?.();
      });
    },
    pickTimeRange: (next: RangeStartAndEndDateTime): void => {
      act(() => {
        result.current.onTimeRangeChange?.(next);
      });
    },
  };
}

describe("useHistogramZoom", () => {
  afterEach(() => {
    cleanup();
  });

  describe("before anything has been zoomed", () => {
    test("offers no way out, because there is nowhere to go back to", () => {
      const { result } = renderZoom();

      expect(result.current.onZoomOut).toBeUndefined();
    });

    test("still passes a dragged range straight through to the host", () => {
      const { dragZoom, onTimeRangeSelect } = renderZoom();

      dragZoom();

      expect(onTimeRangeSelect).toHaveBeenCalledWith(
        DRAGGED_START,
        DRAGGED_END,
      );
    });
  });

  describe("after a drag-zoom", () => {
    test("offers a way back out", () => {
      const { dragZoom, result } = renderZoom();

      dragZoom();

      expect(result.current.onZoomOut).toBeDefined();
    });

    test("restores the window the reader started on", () => {
      const { dragZoom, zoomOut, onTimeRangeChange } = renderZoom(PAST_DAY);

      dragZoom();
      zoomOut();

      expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
      expect(onTimeRangeChange).toHaveBeenCalledWith(PAST_DAY);
    });

    test("restores a custom window just as faithfully", () => {
      const original: RangeStartAndEndDateTime = customRange(
        "2026-08-05T00:00:00Z",
        "2026-08-05T23:59:00Z",
      );
      const { dragZoom, zoomOut, onTimeRangeChange } = renderZoom(original);

      dragZoom();
      zoomOut();

      expect(onTimeRangeChange).toHaveBeenCalledWith(original);
    });

    test("takes the way out away again once it has been used", () => {
      const { dragZoom, zoomOut, result } = renderZoom();

      dragZoom();
      zoomOut();

      expect(result.current.onZoomOut).toBeUndefined();
    });
  });

  /*
   * Drilling down twice is normal: an hour to a minute, a minute to ten
   * seconds. One double-click has to return the whole hour, not the minute
   * on the way — "zoom out to the original", as the report puts it.
   */
  describe("after drilling down more than once", () => {
    test("still returns the window the reader started from", () => {
      const harness: ZoomHarness = renderZoom(PAST_DAY);

      harness.dragZoom();
      // The host applies the dragged window, so the hook sees it next render.
      harness.rerender({
        timeRange: customRange("2026-08-05T11:58:00Z", "2026-08-05T12:00:00Z"),
        onTimeRangeSelect: harness.onTimeRangeSelect,
        onTimeRangeChange: harness.onTimeRangeChange,
      });
      harness.dragZoom();

      harness.zoomOut();

      expect(harness.onTimeRangeChange).toHaveBeenCalledTimes(1);
      expect(harness.onTimeRangeChange).toHaveBeenCalledWith(PAST_DAY);
    });
  });

  /*
   * Picking a range anywhere else is the reader choosing a new starting
   * point. Holding on to the old one would send a later double-click to a
   * window they had already moved on from.
   */
  describe("when the range is changed by other means", () => {
    test("forgets the remembered window", () => {
      const { dragZoom, pickTimeRange, result } = renderZoom(PAST_DAY);

      dragZoom();
      pickTimeRange(PAST_HOUR);

      expect(result.current.onZoomOut).toBeUndefined();
    });

    test("passes the picked range on to the host untouched", () => {
      const { pickTimeRange, onTimeRangeChange } = renderZoom();

      pickTimeRange(PAST_DAY);

      expect(onTimeRangeChange).toHaveBeenCalledWith(PAST_DAY);
    });

    test("remembers the new starting point on the next drag", () => {
      const harness: ZoomHarness = renderZoom(PAST_DAY);

      harness.dragZoom();
      harness.pickTimeRange(PAST_HOUR);
      harness.rerender({
        timeRange: PAST_HOUR,
        onTimeRangeSelect: harness.onTimeRangeSelect,
        onTimeRangeChange: harness.onTimeRangeChange,
      });
      harness.dragZoom();
      harness.zoomOut();

      expect(harness.onTimeRangeChange).toHaveBeenLastCalledWith(PAST_HOUR);
    });
  });

  /*
   * The newest bar is usually still filling up, and the last bar of a fixed
   * window can reach past its end. Zooming into either whole would open a
   * window ending in the future, or one holding rows the bar never counted.
   */
  describe("keeping a zoom inside the window it zooms out of", () => {
    const FIXED_WINDOW: RangeStartAndEndDateTime = customRange(
      "2026-08-05T10:07:23Z",
      "2026-08-05T12:52:10Z",
    );

    function selectOn(
      timeRange: RangeStartAndEndDateTime,
      start: string,
      end: string,
    ): Array<string> {
      const harness: ZoomHarness = renderZoom(timeRange);

      act(() => {
        harness.result.current.onTimeRangeSelect?.(
          new Date(start),
          new Date(end),
        );
      });

      const [selectedStart, selectedEnd] = harness.onTimeRangeSelect.mock
        .calls[0] as [Date, Date];

      return [selectedStart.toISOString(), selectedEnd.toISOString()];
    }

    test("stops a bar that runs past the window's end at that end", () => {
      expect(
        selectOn(FIXED_WINDOW, "2026-08-05T12:45:00Z", "2026-08-05T13:00:00Z"),
      ).toEqual(["2026-08-05T12:45:00.000Z", "2026-08-05T12:52:10.000Z"]);
    });

    test("leaves a selection that ends inside the window as it is", () => {
      expect(
        selectOn(FIXED_WINDOW, "2026-08-05T11:00:00Z", "2026-08-05T11:15:00Z"),
      ).toEqual(["2026-08-05T11:00:00.000Z", "2026-08-05T11:15:00.000Z"]);
    });

    /*
     * A relative window's start slides forward with the clock while the
     * chart drawn a few minutes earlier stays put; cutting the first bar to
     * the current start would take rows away from a bar still on screen.
     */
    test("leaves the start of the first bar alone", () => {
      expect(
        selectOn(FIXED_WINDOW, "2026-08-05T10:00:00Z", "2026-08-05T10:15:00Z"),
      ).toEqual(["2026-08-05T10:00:00.000Z", "2026-08-05T10:15:00.000Z"]);
    });

    test("does not empty a selection the window has already moved past", () => {
      expect(
        selectOn(FIXED_WINDOW, "2026-08-05T13:00:00Z", "2026-08-05T13:15:00Z"),
      ).toEqual(["2026-08-05T13:00:00.000Z", "2026-08-05T13:15:00.000Z"]);
    });

    test("stops the newest bar of a relative window at now", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-08-05T12:52:10Z"));

      try {
        expect(
          selectOn(PAST_HOUR, "2026-08-05T12:45:00Z", "2026-08-05T13:00:00Z"),
        ).toEqual(["2026-08-05T12:45:00.000Z", "2026-08-05T12:52:10.000Z"]);
      } finally {
        jest.useRealTimers();
      }
    });

    test("still remembers the window to zoom back out to", () => {
      const harness: ZoomHarness = renderZoom(FIXED_WINDOW);

      act(() => {
        harness.result.current.onTimeRangeSelect?.(
          new Date("2026-08-05T12:45:00Z"),
          new Date("2026-08-05T13:00:00Z"),
        );
      });
      harness.zoomOut();

      expect(harness.onTimeRangeChange).toHaveBeenCalledWith(FIXED_WINDOW);
    });
  });

  describe("hosts that wire up only part of this", () => {
    test("a host with no time range gets no zoom-out to offer", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onTimeRangeChange: MockFunction = getJestMockFunction();

      const { result } = renderHook(() => {
        return useHistogramZoom({
          onTimeRangeSelect: onTimeRangeSelect,
          onTimeRangeChange: onTimeRangeChange,
        });
      });

      act(() => {
        result.current.onTimeRangeSelect?.(DRAGGED_START, DRAGGED_END);
      });

      // The drag still applies; there is simply no window to hand back.
      expect(onTimeRangeSelect).toHaveBeenCalled();
      expect(result.current.onZoomOut).toBeUndefined();
    });

    test("a host with no select handler leaves the chart unzoomable", () => {
      const { result } = renderHook(() => {
        return useHistogramZoom({ timeRange: PAST_HOUR });
      });

      expect(result.current.onTimeRangeSelect).toBeUndefined();
      expect(result.current.onZoomOut).toBeUndefined();
      expect(result.current.onTimeRangeChange).toBeUndefined();
    });

    test("a host that cannot apply a range change offers no zoom-out", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();

      const { result } = renderHook(() => {
        return useHistogramZoom({
          timeRange: PAST_HOUR,
          onTimeRangeSelect: onTimeRangeSelect,
        });
      });

      act(() => {
        result.current.onTimeRangeSelect?.(DRAGGED_START, DRAGGED_END);
      });

      expect(onTimeRangeSelect).toHaveBeenCalled();
      expect(result.current.onZoomOut).toBeUndefined();
    });
  });
});
