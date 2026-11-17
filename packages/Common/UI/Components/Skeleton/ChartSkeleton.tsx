import SkeletonStatus, { SKELETON_BAR_CLASS_NAME } from "./SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a card shows while a chart loads: the chart's area, at the chart's
 * height, with a legend line above it, faint gridlines across it and the
 * time axis under it (#9220). A chart group draws its plot at least 20rem
 * tall (ChartGroup's min-h-80), and so does this by default; a chart drawn
 * at a height of its own passes it, so the card does not move when the
 * lines arrive.
 */

export const CHART_SKELETON_TEST_ID: string = "chart-skeleton";

// A chart group's plot: at least 20rem (ChartGroup's min-h-80).
export const DEFAULT_CHART_SKELETON_HEIGHT_IN_PX: number = 320;

const GRIDLINE_COUNT: number = 4;
const AXIS_LABEL_COUNT: number = 6;

export interface BarsProps {
  // The plot's height, as the chart it stands in for draws it.
  heightInPx?: number | undefined;
  /*
   * Fill the box it is drawn in instead (a dashboard widget, a canvas of a
   * fixed height), as the chart there takes the whole box.
   */
  fillsHeight?: boolean | undefined;
  // Leave out the legend line, for a chart that draws none.
  hasLegend?: boolean | undefined;
}

export interface ComponentProps extends BarsProps {
  className?: string | undefined;
}

export const ChartSkeletonBars: FunctionComponent<BarsProps> = (
  props: BarsProps,
): ReactElement => {
  const heightInPx: number =
    props.heightInPx ?? DEFAULT_CHART_SKELETON_HEIGHT_IN_PX;

  return (
    <div
      className={`flex w-full min-w-0 flex-col${props.fillsHeight ? " h-full" : ""}`}
      style={props.fillsHeight ? undefined : { height: `${heightInPx}px` }}
    >
      {props.hasLegend !== false && (
        <div className="flex h-6 shrink-0 items-center gap-4">
          <div className={`h-3 w-20 ${SKELETON_BAR_CLASS_NAME}`} />
          <div className={`h-3 w-16 ${SKELETON_BAR_CLASS_NAME}`} />
        </div>
      )}
      {/* The plot: gridlines over a faint fill, the y-axis labels beside it. */}
      <div className="flex min-h-0 flex-1 gap-3 pt-2">
        <div className="flex w-8 shrink-0 flex-col justify-between py-1">
          {Array.from(Array(GRIDLINE_COUNT).keys()).map((index: number) => {
            return (
              <div
                key={index}
                className={`h-2 w-8 ${SKELETON_BAR_CLASS_NAME}`}
              />
            );
          })}
        </div>
        <div
          className="relative flex min-w-0 flex-1 flex-col justify-between rounded border-b border-gray-200"
          data-testid={`${CHART_SKELETON_TEST_ID}-plot`}
        >
          {Array.from(Array(GRIDLINE_COUNT).keys()).map((index: number) => {
            return (
              <div
                key={index}
                className="border-t border-dashed border-gray-100"
              />
            );
          })}
          <div
            className={`absolute inset-x-0 bottom-0 h-1/2 ${SKELETON_BAR_CLASS_NAME}`}
          />
        </div>
      </div>
      {/* The time axis. */}
      <div className="flex h-6 shrink-0 items-center justify-between ps-11">
        {Array.from(Array(AXIS_LABEL_COUNT).keys()).map((index: number) => {
          return (
            <div
              key={index}
              className={`h-2 w-10 ${SKELETON_BAR_CLASS_NAME}${
                index % 2 === 1 ? " max-sm:hidden" : ""
              }`}
            />
          );
        })}
      </div>
    </div>
  );
};

const ChartSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SkeletonStatus
      dataTestId={CHART_SKELETON_TEST_ID}
      className={props.className}
      fillsHeight={props.fillsHeight}
    >
      <ChartSkeletonBars {...props} />
    </SkeletonStatus>
  );
};

export default ChartSkeleton;
