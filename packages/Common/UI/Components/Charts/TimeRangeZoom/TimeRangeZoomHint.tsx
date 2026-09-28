import React, { FunctionComponent, ReactElement } from "react";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "./TimeRangeZoomContext";

export const TIME_RANGE_ZOOM_HINT_TEST_ID: string = "time-range-zoom-hint";

export interface ComponentProps {
  /*
   * Show the hint only while the pointer is over the card (an ancestor
   * with Tailwind's `group` class). Keeps a row of small chart cards
   * uncluttered; the hint appears exactly when the reader could drag.
   */
  revealOnHover?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Names the drag-to-zoom gesture in a chart card's header — the same
 * words ChartGroup cards use — whenever the enclosing page zooms. Renders
 * nothing outside a zoomable page.
 */
const TimeRangeZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  if (!zoom) {
    return null;
  }

  const revealClassName: string = props.revealOnHover
    ? "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    : "";

  return (
    <span
      data-testid={TIME_RANGE_ZOOM_HINT_TEST_ID}
      className={`shrink-0 whitespace-nowrap text-[10px] text-gray-400 ${revealClassName} ${props.className || ""}`}
    >
      {zoom.onTimeRangeReset
        ? "Drag to zoom · double-click to reset"
        : "Drag to zoom"}
    </span>
  );
};

export default TimeRangeZoomHint;
