import React, { FunctionComponent, ReactElement } from "react";
import {
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_REVEAL_CLASSES,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { DashboardWidgetTimeRangeZoomHandlers } from "../Utils/DashboardWidgetTimeRangeZoom";

export const DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID: string =
  "dashboard-widget-zoom-hint";

export interface ComponentProps {
  // The gestures the widget's chart actually has (DashboardWidgetTimeRangeZoom).
  zoom: DashboardWidgetTimeRangeZoomHandlers;
  /*
   * Whether the widget is drawing its chart right now. There is nothing to
   * drag across on its loading, empty or error state - a public board never
   * draws a log or trace chart at all - but those states still take the
   * double-click that undoes a zoom.
   */
  isChartShown: boolean;
  className?: string | undefined;
}

/**
 * Names the drag-to-zoom gesture on a widget whose chart retimes the board,
 * in the words the metric chart panels beside it use. It is revealed only
 * while the pointer is over the widget (an ancestor with the named Tailwind
 * group, TIME_RANGE_ZOOM_HINT_GROUP_CLASS), so a board of small widgets stays
 * uncluttered, and it names only a gesture the widget has there and then:
 * the drag while a chart is drawn, the reset while the board is zoomed, and
 * nothing at all in edit mode or on a surface that owns no time range.
 */
const DashboardWidgetZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const canDrag: boolean =
    props.isChartShown && Boolean(props.zoom.onTimeRangeSelect);
  const canReset: boolean = Boolean(props.zoom.onTimeRangeReset);

  let text: string | null = null;

  if (canDrag && canReset) {
    text = `${TIME_RANGE_ZOOM_HINT_TEXT} · double-click to reset`;
  } else if (canDrag) {
    text = TIME_RANGE_ZOOM_HINT_TEXT;
  } else if (canReset) {
    text = TIME_RANGE_ZOOM_HINT_RESET_TEXT;
  }

  if (!text) {
    return null;
  }

  return (
    <span
      data-testid={DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID}
      /*
       * The card hints' reveal: on hover, or on KEYBOARD focus inside the
       * widget. Plain focus-within kept the hint up after a mouse drag,
       * since a press focuses recharts' own (tabindex -1) layer.
       */
      className={`pointer-events-none shrink-0 whitespace-nowrap text-[10px] text-gray-400 ${TIME_RANGE_ZOOM_HINT_REVEAL_CLASSES} ${props.className || ""}`}
    >
      {text}
    </span>
  );
};

export default DashboardWidgetZoomHint;
