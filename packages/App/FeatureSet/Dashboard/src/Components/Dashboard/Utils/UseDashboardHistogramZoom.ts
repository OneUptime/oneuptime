import React, { useCallback, useRef } from "react";
import useHistogramRangeSelection, {
  HistogramRangeSelectionState,
} from "Common/UI/Components/Charts/Utils/useHistogramRangeSelection";
import { HistogramSelectionWindow } from "Common/UI/Components/Charts/Utils/HistogramSelection";
import DashboardWidgetTimeRangeZoom, {
  DashboardHistogramWindow,
  DashboardWidgetTimeRangeZoomHandlers,
} from "./DashboardWidgetTimeRangeZoom";

export interface UseDashboardHistogramZoomOptions {
  // The board's gestures, from DashboardWidgetTimeRangeZoom.getHandlers.
  zoom: DashboardWidgetTimeRangeZoomHandlers;
  // What the bars on screen were fetched for; null before the first fetch.
  fetchedWindow: DashboardHistogramWindow | null;
}

export type UseDashboardHistogramZoomFunction = (
  options: UseDashboardHistogramZoomOptions,
) => HistogramRangeSelectionState;

/**
 * Drag-to-zoom and double-click-to-reset for the raw recharts histograms
 * on a dashboard (the log and trace chart widgets), handing both gestures
 * to the board the way the metric chart panels do.
 *
 * - A drag across bars zooms the board to the window they cover, the last
 *   bar included (see DashboardWidgetTimeRangeZoom.getHistogramZoomWindow).
 * - A plain click never zooms. The shared selection hook zooms into one
 *   bar on a click whenever it knows the bucket width - right for the logs
 *   explorer, whose histogram exists to filter the list beneath it, but on
 *   a dashboard a casual click (on the way to selecting the widget, say)
 *   would retime every panel on the board. The metric panels beside these
 *   select only on a real drag, so these do too: the width is withheld
 *   from the hook, which makes a single bar no window at all, and added
 *   back here for a real drag.
 * - A double-click undoes the zoom, and does nothing while there is none.
 */
const useDashboardHistogramZoom: UseDashboardHistogramZoomFunction = (
  options: UseDashboardHistogramZoomOptions,
): HistogramRangeSelectionState => {
  /*
   * Read when a drag lands rather than closed over: the bars under the
   * pointer are the ones on screen, and their window and bucket width are
   * replaced together only when the next fetch lands.
   */
  const latest: React.MutableRefObject<UseDashboardHistogramZoomOptions> =
    useRef<UseDashboardHistogramZoomOptions>(options);
  latest.current = options;

  const handleTimeRangeSelect: (
    firstBucketStart: Date,
    lastBucketStart: Date,
  ) => void = useCallback(
    (firstBucketStart: Date, lastBucketStart: Date): void => {
      const onTimeRangeSelect:
        | ((startTime: Date, endTime: Date) => void)
        | undefined = latest.current.zoom.onTimeRangeSelect;

      if (!onTimeRangeSelect) {
        return;
      }

      const zoomWindow: HistogramSelectionWindow =
        DashboardWidgetTimeRangeZoom.getHistogramZoomWindow({
          firstBucketStart: firstBucketStart,
          lastBucketStart: lastBucketStart,
          fetchedWindow: latest.current.fetchedWindow,
        });

      onTimeRangeSelect(zoomWindow.startTime, zoomWindow.endTime);
    },
    [],
  );

  return useHistogramRangeSelection({
    onTimeRangeSelect: options.zoom.onTimeRangeSelect
      ? handleTimeRangeSelect
      : undefined,
    onZoomOut: options.zoom.onTimeRangeReset,
  });
};

export default useDashboardHistogramZoom;
