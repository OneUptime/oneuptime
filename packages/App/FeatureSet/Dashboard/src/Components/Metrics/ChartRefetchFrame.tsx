import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The loading states of a chart that fetches its own data, such as the
 * client-side rate charts inside an EmbeddedMetricCard, in the same shape
 * MetricView gives the panels beside them.
 *
 * Only the first load has nothing to draw. Its skeleton takes the chart's
 * own height, so nothing below moves when the chart lands. Every later load
 * (a zoom, a reset, the card's Refresh, an auto-refresh tick) keeps the last
 * chart on screen, dimmed and marked "Refreshing", until the new points
 * arrive. Drag-to-zoom and double-click-to-reset (issue #4105) are gestures
 * made ON the chart, and each one reloads it: a chart swapped for a skeleton
 * then would vanish from under the pointer and shift everything below it,
 * and an auto-refresh tick would unmount a drag the reader is in the middle
 * of.
 */

export const CHART_LOADING_SKELETON_TEST_ID: string = "chart-loading-skeleton";
export const CHART_REFETCHING_TEST_ID: string = "chart-refetching";

export interface ChartLoadingSkeletonProps {
  // The height the chart will be drawn at.
  heightInPx: number;
}

export const ChartLoadingSkeleton: FunctionComponent<
  ChartLoadingSkeletonProps
> = (props: ChartLoadingSkeletonProps): ReactElement => {
  return (
    <div
      data-testid={CHART_LOADING_SKELETON_TEST_ID}
      className="animate-pulse rounded-md bg-gray-50"
      style={{ height: `${props.heightInPx}px` }}
    />
  );
};

export interface ComponentProps {
  // A load is in flight while the last chart stays on screen.
  isRefetching: boolean;
  /*
   * Why the latest load failed. The last chart stays, with the error above
   * it, as MetricView shows a failed refetch.
   */
  refetchError?: string | undefined;
  children: ReactNode;
}

/*
 * Wraps the last chart (or its empty state) once a load has landed. The
 * wrappers stay the same whether or not a load is in flight, so the chart
 * inside is never remounted by a reload.
 */
const ChartRefetchFrame: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div>
      {props.refetchError ? (
        <div
          role="alert"
          className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <Icon
            icon={IconProp.Error}
            className="h-4 w-4 shrink-0 text-red-500"
          />
          <span>
            {translator.translateTemplate(
              "Couldn't refresh — showing previously loaded data. {{error}}",
              { error: props.refetchError },
            )}
          </span>
        </div>
      ) : null}
      <div className="relative" aria-busy={props.isRefetching}>
        {props.isRefetching ? (
          <div
            data-testid={CHART_REFETCHING_TEST_ID}
            className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-500 shadow-sm"
          >
            <Icon
              icon={IconProp.Refresh}
              className="h-3 w-3 animate-spin text-gray-400"
            />
            {translator.translateText("Refreshing")}
          </div>
        ) : null}
        <div
          className={
            props.isRefetching
              ? "opacity-75 transition-opacity"
              : "transition-opacity"
          }
        >
          {props.children}
        </div>
      </div>
    </div>
  );
};

export default ChartRefetchFrame;
