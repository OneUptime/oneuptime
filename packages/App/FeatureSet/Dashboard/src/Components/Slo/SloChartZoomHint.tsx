import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The body class for an SLO chart Card that shows SloChartZoomHint: the
 * hint row replaces the body's usual top margin (mt-4) on desktop, so the
 * chart sits exactly where it did before.
 */
export const SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME: string = "mt-4 md:mt-0";

export interface ComponentProps {
  /*
   * Whether the card's body takes the gesture the hint would name: a chart
   * can be dragged, and a zoomed empty state takes the double-click. A
   * loader, an error or an empty state with nothing to reset takes
   * neither, and a hint over them promised a drag that did nothing. The
   * row stays either way, as it stands in for the body's top margin.
   */
  isShown: boolean;
}

/*
 * "Drag to zoom" (and, while zoomed, "Double-click to reset") at the top
 * right of an SLO chart card's body, shown while the pointer is over the
 * card - the Card needs the named group, className="group/zoomhint" - like
 * the hint in a TelemetryResource ChartCard header.
 *
 * It is a row of its own rather than a Card rightElement: a right element
 * gets its own margins in the stacked phone header, so an invisible hint
 * there left a gap under the title of every card, and it narrowed the
 * description beside a header that already holds a range picker. On a
 * phone, where there is no drag, the row is not rendered at all.
 */
const SloChartZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="max-md:hidden h-4 items-center justify-end md:flex">
      {props.isShown ? <TimeRangeZoomHint revealOnHover={true} /> : <></>}
    </div>
  );
};

type WithSloChartZoomHintFunction = (
  takesZoomGesture: boolean,
  body: ReactElement,
) => ReactElement;

/*
 * An SLO chart card's body under its hint row. Whatever picks the body
 * also says whether that body takes a zoom gesture, so the hint never
 * names a gesture the body does not have.
 */
export const withSloChartZoomHint: WithSloChartZoomHintFunction = (
  takesZoomGesture: boolean,
  body: ReactElement,
): ReactElement => {
  return (
    <>
      <SloChartZoomHint isShown={takesZoomGesture} />
      {body}
    </>
  );
};

export default SloChartZoomHint;
