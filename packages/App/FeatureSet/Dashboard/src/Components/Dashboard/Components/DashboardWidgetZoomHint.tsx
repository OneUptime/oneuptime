import React, { FunctionComponent, ReactElement } from "react";
import { DashboardWidgetTimeRangeZoomHandlers } from "../Utils/DashboardWidgetTimeRangeZoom";

export const DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID: string =
  "dashboard-widget-zoom-hint";

export interface ComponentProps {
  // The gestures the widget's chart actually has (DashboardWidgetTimeRangeZoom).
  zoom: DashboardWidgetTimeRangeZoomHandlers;
  className?: string | undefined;
}

/**
 * Names the drag-to-zoom gesture on a widget whose chart retimes the board,
 * in the words the metric chart panels beside it use. It is revealed only
 * while the pointer is over the widget (an ancestor with Tailwind's `group`
 * class), so a board of small widgets stays uncluttered, and it says nothing
 * at all where the widget cannot zoom: in edit mode, or on a surface that
 * owns no time range.
 */
const DashboardWidgetZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  if (!props.zoom.onTimeRangeSelect) {
    return null;
  }

  return (
    <span
      data-testid={DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID}
      className={`pointer-events-none shrink-0 whitespace-nowrap text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${props.className || ""}`}
    >
      {props.zoom.onTimeRangeReset
        ? "Drag to zoom · double-click to reset"
        : "Drag to zoom"}
    </span>
  );
};

export default DashboardWidgetZoomHint;
