import DashboardTimeRangeZoomUtil, {
  DashboardTimeRangeZoomState,
} from "../../Utils/Dashboard/DashboardTimeRangeZoom";
import RangeStartAndEndDateTime from "../../Types/Time/RangeStartAndEndDateTime";
import { useCallback, useState } from "react";

export interface DashboardTimeRangeZoom {
  /** The window to hand every widget on the board. */
  startAndEndDate: RangeStartAndEndDateTime;
  /** True while a panel drag-selection is narrowing the board. */
  isZoomed: boolean;
  /** An explicit pick from the time-range picker — a new baseline. */
  setStartAndEndDate: (range: RangeStartAndEndDateTime) => void;
  /** A drag-selection on a time-series panel — zooms the whole board. */
  zoomToTimeRange: (startTime: Date, endTime: Date) => void;
  /** Double-click on a panel, or the toolbar's reset — undoes the zoom. */
  resetZoom: () => void;
}

export type UseDashboardTimeRangeZoomFunction = (
  initialRange: RangeStartAndEndDateTime,
) => DashboardTimeRangeZoom;

/**
 * Owns the dashboard-wide time range and the one level of undo that makes
 * drag-to-zoom reversible. Both dashboard shells (the authenticated
 * DashboardView and the public DashboardViewPage) use this so a panel
 * gesture means the same thing on both.
 *
 * All three callbacks are identity-stable for the life of the dashboard:
 * they are handed down through the canvas into React.memo'd widgets whose
 * comparators do not look at function props, so a changing reference would
 * leave a widget holding a stale closure.
 */
const useDashboardTimeRangeZoom: UseDashboardTimeRangeZoomFunction = (
  initialRange: RangeStartAndEndDateTime,
): DashboardTimeRangeZoom => {
  const [state, setState] = useState<DashboardTimeRangeZoomState>(() => {
    return DashboardTimeRangeZoomUtil.getInitialState(initialRange);
  });

  const setStartAndEndDate: (range: RangeStartAndEndDateTime) => void =
    useCallback((range: RangeStartAndEndDateTime): void => {
      setState((previous: DashboardTimeRangeZoomState) => {
        return DashboardTimeRangeZoomUtil.selectRange(previous, range);
      });
    }, []);

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      setState((previous: DashboardTimeRangeZoomState) => {
        return DashboardTimeRangeZoomUtil.zoomToWindow(
          previous,
          startTime,
          endTime,
        );
      });
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    setState((previous: DashboardTimeRangeZoomState) => {
      return DashboardTimeRangeZoomUtil.resetZoom(previous);
    });
  }, []);

  return {
    startAndEndDate: state.current,
    isZoomed: DashboardTimeRangeZoomUtil.isZoomed(state),
    setStartAndEndDate,
    zoomToTimeRange,
    resetZoom,
  };
};

export default useDashboardTimeRangeZoom;
