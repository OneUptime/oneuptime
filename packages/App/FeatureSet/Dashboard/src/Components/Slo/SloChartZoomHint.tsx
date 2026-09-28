import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The body class for an SLO chart Card that shows SloChartZoomHint: the
 * hint row replaces the body's usual top margin (mt-4) on desktop, so the
 * chart sits exactly where it did before.
 */
export const SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME: string = "mt-4 md:mt-0";

/*
 * "Drag to zoom" (and, while zoomed, "· double-click to reset") at the top
 * right of an SLO chart card's body, shown while the pointer is over the
 * card - the Card needs className="group" - like the hint in a
 * TelemetryResource ChartCard header.
 *
 * It is a row of its own rather than a Card rightElement: a right element
 * gets its own margins in the stacked phone header, so an invisible hint
 * there left a gap under the title of every card, and it narrowed the
 * description beside a header that already holds a range picker. On a
 * phone, where there is no drag, the row is not rendered at all.
 */
const SloChartZoomHint: FunctionComponent = (): ReactElement => {
  return (
    <div className="hidden h-4 items-center justify-end md:flex">
      <TimeRangeZoomHint revealOnHover={true} />
    </div>
  );
};

export default SloChartZoomHint;
