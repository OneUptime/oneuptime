import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../../Types/Icon/IconProp";
import TimeRange from "../../../../Types/Time/TimeRange";
import Icon from "../../Icon/Icon";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "./TimeRangeZoomContext";

export const RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID: string =
  "reset-time-range-zoom";

export interface ComponentProps {
  className?: string | undefined;
}

/**
 * "Reset zoom", shown only while the enclosing page is zoomed. The same
 * thing a double-click on any chart does, for readers who do not know that
 * gesture and for keyboard users, who cannot perform it.
 *
 * Renders nothing outside a zoomable page or while the page is not zoomed.
 */
const ResetTimeRangeZoomButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  if (!zoom || !zoom.isZoomed || !zoom.onTimeRangeReset) {
    return null;
  }

  const onTimeRangeReset: () => void = zoom.onTimeRangeReset;
  const previousRange: TimeRange | undefined = zoom.rangeBeforeZoom?.range;
  const title: string =
    previousRange && previousRange !== TimeRange.CUSTOM
      ? `Go back to ${previousRange}, the time range before the zoom`
      : "Go back to the time range before the zoom";

  return (
    <button
      type="button"
      data-testid={RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${props.className || ""}`}
      title={title}
      aria-label="Reset zoom"
      onClick={() => {
        onTimeRangeReset();
      }}
    >
      <Icon icon={IconProp.MagnifyingGlassMinus} className="h-3.5 w-3.5" />
      Reset zoom
    </button>
  );
};

export default ResetTimeRangeZoomButton;
