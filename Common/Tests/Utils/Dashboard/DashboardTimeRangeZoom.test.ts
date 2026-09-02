import { describe, expect, test } from "@jest/globals";
import DashboardTimeRangeZoomUtil, {
  DashboardTimeRangeZoomState,
} from "../../../Utils/Dashboard/DashboardTimeRangeZoom";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The state machine behind dashboard-wide drag-to-zoom. Its whole job is to
 * make the gesture REVERSIBLE: a drag on any time-series panel retimes the
 * whole board, and one double-click has to land back exactly where the
 * investigation started — not one drag back, and not on "now".
 *
 * `baseline === null` is the contract the UI reads for "nothing to reset",
 * so the no-op cases below are as load-bearing as the happy path: a stray
 * double-click on an unzoomed board must not retime it, and must not even
 * hand React a new object to re-render every widget over.
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
const NARROWER_START: Date = new Date("2026-08-20T09:25:00.000Z");
const NARROWER_END: Date = new Date("2026-08-20T09:27:00.000Z");

describe("DashboardTimeRangeZoomUtil", () => {
  describe("getInitialState", () => {
    test("starts on the given range with nothing to reset", () => {
      const state: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR);

      expect(state.current).toBe(ROLLING_HOUR);
      expect(state.baseline).toBeNull();
      expect(DashboardTimeRangeZoomUtil.isZoomed(state)).toBe(false);
    });
  });

  describe("zoomToWindow", () => {
    test("pins the board to the dragged window and remembers the way back", () => {
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_START,
          DRAG_END,
        );

      expect(zoomed.current.range).toBe(TimeRange.CUSTOM);
      expect(zoomed.current.startAndEndDate?.startValue).toEqual(DRAG_START);
      expect(zoomed.current.startAndEndDate?.endValue).toEqual(DRAG_END);
      expect(zoomed.baseline).toBe(ROLLING_HOUR);
      expect(DashboardTimeRangeZoomUtil.isZoomed(zoomed)).toBe(true);
    });

    test("a right-to-left drag is the same window as left-to-right", () => {
      const forward: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_START,
          DRAG_END,
        );
      const backward: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_END,
          DRAG_START,
        );

      expect(backward.current.startAndEndDate?.startValue).toEqual(
        forward.current.startAndEndDate?.startValue,
      );
      expect(backward.current.startAndEndDate?.endValue).toEqual(
        forward.current.startAndEndDate?.endValue,
      );
    });

    test("zooming again keeps the ORIGINAL baseline, so one reset gets all the way out", () => {
      const once: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_START,
          DRAG_END,
        );
      const twice: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          once,
          NARROWER_START,
          NARROWER_END,
        );

      expect(twice.current.startAndEndDate?.startValue).toEqual(NARROWER_START);
      // NOT `once.current` — a reader should not have to climb out a drag at a time.
      expect(twice.baseline).toBe(ROLLING_HOUR);

      const reset: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.resetZoom(twice);
      expect(reset.current).toBe(ROLLING_HOUR);
      expect(reset.baseline).toBeNull();
    });

    test("a zero-width selection changes nothing at all", () => {
      const state: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR);

      /*
       * The chart library can hand back start === end when a drag never
       * leaves its starting bucket. Same reference back, so no widget
       * re-renders and no refetch is spent.
       */
      expect(
        DashboardTimeRangeZoomUtil.zoomToWindow(state, DRAG_START, DRAG_START),
      ).toBe(state);
    });

    test("an invalid date changes nothing at all", () => {
      const state: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR);

      expect(
        DashboardTimeRangeZoomUtil.zoomToWindow(
          state,
          new Date("not-a-date"),
          DRAG_END,
        ),
      ).toBe(state);
      expect(
        DashboardTimeRangeZoomUtil.zoomToWindow(
          state,
          DRAG_START,
          new Date("not-a-date"),
        ),
      ).toBe(state);
      expect(
        DashboardTimeRangeZoomUtil.zoomToWindow(
          state,
          null as unknown as Date,
          DRAG_END,
        ),
      ).toBe(state);
    });

    test("the stored window is a copy — mutating the dragged dates cannot move the board", () => {
      const dragStart: Date = new Date(DRAG_START.getTime());
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          dragStart,
          DRAG_END,
        );

      dragStart.setFullYear(1999);

      expect(zoomed.current.startAndEndDate?.startValue).toEqual(DRAG_START);
    });
  });

  describe("resetZoom", () => {
    test("restores the range the board had before the first drag", () => {
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(PINNED_DAY),
          DRAG_START,
          DRAG_END,
        );

      const reset: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.resetZoom(zoomed);

      expect(reset.current).toBe(PINNED_DAY);
      expect(reset.baseline).toBeNull();
      expect(DashboardTimeRangeZoomUtil.isZoomed(reset)).toBe(false);
    });

    test("is a true no-op when nothing is zoomed", () => {
      const state: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR);

      // Same reference: a stray double-click cannot even cost a render.
      expect(DashboardTimeRangeZoomUtil.resetZoom(state)).toBe(state);
    });

    test("a second reset does not keep unwinding", () => {
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_START,
          DRAG_END,
        );
      const once: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.resetZoom(zoomed);

      expect(DashboardTimeRangeZoomUtil.resetZoom(once)).toBe(once);
    });
  });

  describe("selectRange", () => {
    test("an explicit pick becomes the new baseline and retires the reset", () => {
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          DRAG_START,
          DRAG_END,
        );

      const picked: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.selectRange(zoomed, PINNED_DAY);

      expect(picked.current).toBe(PINNED_DAY);
      /*
       * The picker is not an undo stack: offering to jump back to a range
       * the user has deliberately left is worse than offering nothing.
       */
      expect(picked.baseline).toBeNull();
      expect(DashboardTimeRangeZoomUtil.isZoomed(picked)).toBe(false);
    });

    test("picking then zooming makes the PICKED range the way back", () => {
      const picked: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.selectRange(
          DashboardTimeRangeZoomUtil.getInitialState(ROLLING_HOUR),
          PINNED_DAY,
        );
      const zoomed: DashboardTimeRangeZoomState =
        DashboardTimeRangeZoomUtil.zoomToWindow(picked, DRAG_START, DRAG_END);

      expect(DashboardTimeRangeZoomUtil.resetZoom(zoomed).current).toBe(
        PINNED_DAY,
      );
    });
  });
});
