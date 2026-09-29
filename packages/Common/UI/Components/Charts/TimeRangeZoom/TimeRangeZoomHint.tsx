import React, { FunctionComponent, ReactElement } from "react";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "./TimeRangeZoomContext";

export const TIME_RANGE_ZOOM_HINT_TEST_ID: string = "time-range-zoom-hint";

/*
 * The class a chart card puts on its root so the hint can reveal itself on
 * hover. A NAMED Tailwind group on purpose: a plain `group` on the card
 * would also light up every descendant's own `group-hover:` styles - the
 * chart legends darken their labels on `group-hover` - whenever the pointer
 * is anywhere over the card.
 */
export const TIME_RANGE_ZOOM_HINT_GROUP_CLASS: string = "group/zoomhint";

export const TIME_RANGE_ZOOM_HINT_TEXT: string = "Drag to zoom";
export const TIME_RANGE_ZOOM_HINT_RESET_TEXT: string = "Double-click to reset";

export interface ComponentProps {
  /*
   * Show the hint only while the pointer is over the card (an ancestor
   * with TIME_RANGE_ZOOM_HINT_GROUP_CLASS). Keeps a row of small chart
   * cards uncluttered; the hint appears exactly when the reader could drag.
   */
  revealOnHover?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Names the drag-to-zoom gesture in a chart card's header whenever the
 * enclosing page zooms: "Drag to zoom", and "Double-click to reset" while a
 * zoom is active. The words are short on purpose - four of these cards can
 * share a row. Renders nothing outside a zoomable page.
 */
const TimeRangeZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  if (!zoom) {
    return null;
  }

  const revealClassName: string = props.revealOnHover
    ? "opacity-0 transition-opacity group-hover/zoomhint:opacity-100 group-focus-within/zoomhint:opacity-100"
    : "";

  return (
    <span
      data-testid={TIME_RANGE_ZOOM_HINT_TEST_ID}
      className={`shrink-0 whitespace-nowrap text-[10px] text-gray-400 ${revealClassName} ${props.className || ""}`}
    >
      {zoom.onTimeRangeReset
        ? TIME_RANGE_ZOOM_HINT_RESET_TEXT
        : TIME_RANGE_ZOOM_HINT_TEXT}
    </span>
  );
};

export default TimeRangeZoomHint;
