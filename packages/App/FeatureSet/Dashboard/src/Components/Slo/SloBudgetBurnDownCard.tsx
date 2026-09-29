import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getSloBurnDownZoomRange,
  getSloIdealBurnPointsInWindow,
} from "./SloBurnDownZoom";
import SloChartZoomHint, {
  SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME,
} from "./SloChartZoomHint";
import SloOverviewActionLink from "./SloOverviewActionLink";
import SloOverviewEmptyState from "./SloOverviewEmptyState";
import useSloHistorySeries, {
  UseSloHistorySeriesResult,
} from "./useSloHistorySeries";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SloHistoryMetricName from "Common/Types/ServiceLevelObjective/SloHistoryMetricName";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import { ChartColorValue } from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import XAxisUtil from "Common/UI/Components/Charts/Utils/XAxis";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import { DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE } from "Common/Utils/Slo/SloHealth";
import { getSloWindowPhrase } from "Common/Utils/Slo/SloOverviewText";
import {
  getSloChartBucketSeconds,
  getSloComplianceWindowRange,
  SloComplianceWindowRange,
  SloIdealBurnPoint,
} from "Common/Utils/Slo/SloProjection";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

export const BURN_DOWN_BUDGET_SERIES_NAME: string = "Budget remaining";
export const BURN_DOWN_IDEAL_SERIES_NAME: string = "Even burn";

const AT_RISK_LINE_COLOR: string = "#f59e0b";
const EXHAUSTED_LINE_COLOR: string = "#ef4444";

// Budget first (indigo), the ideal line second (a quiet gray ghost).
const SERIES_COLORS: Array<ChartColorValue> = ["indigo", "gray"];

export interface ComponentProps {
  sloId: ObjectID;
  slo: ServiceLevelObjective;
  /*
   * Changes whenever new history can exist. The page passes the SLO's
   * lastEvaluatedAt: SloHistory rows are written by the evaluation and by
   * nothing else, so re-reading on every 60-second page poll would fetch
   * the same buckets four times out of five.
   */
  refreshToken: string;
}

/*
 * How the error budget has been spent over the CURRENT compliance window —
 * the span the KPI strip's numbers describe — with the SLO's own at-risk
 * and exhausted lines drawn in, so a dip reads as "that is when it went At
 * Risk" without the reader having to remember the threshold.
 *
 * Calendar-month SLOs also get the even-burn line from 100% at the start of
 * the month to 0% at the reset: spending exactly at 1x lands on it, so a
 * budget line below it is burning too fast for the month. A rolling window
 * has no such line — a steady 1x keeps its remaining budget flat — so it is
 * not drawn there rather than drawn wrong.
 *
 * The full SLI, budget and burn history with a range picker lives on the
 * Metrics page, linked from the header.
 *
 * Drag-to-zoom (issue #4105): a drag across the chart narrows the card to
 * the window dragged out, fetched at a finer bucket size, and a
 * double-click (or "Reset zoom" in the header) returns to the whole
 * compliance window. The zoom is the card's own: the overview has no time
 * range for it to change.
 */
const SloBudgetBurnDownCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const slo: ServiceLevelObjective = props.slo;
  const isCalendarMonth: boolean =
    slo.windowType === SloWindowType.CalendarMonth;

  /*
   * Resolved against "now" once per refresh token, never per render — a
   * window recomputed on every render would hand the history hook a new
   * range each time and fetch in a loop.
   */
  const complianceWindow: SloComplianceWindowRange =
    useMemo((): SloComplianceWindowRange => {
      return getSloComplianceWindowRange({
        windowType: slo.windowType,
        windowDays: slo.windowDays,
        timezone: slo.timezone,
        now: OneUptimeDate.getCurrentDate(),
      });
    }, [slo.windowType, slo.windowDays, slo.timezone, props.refreshToken]);

  /*
   * A calendar month is fetched through to its reset, not just to now, so
   * the bucket size is chosen for the whole month: early in the month a
   * start-to-now span would pick five-minute buckets and then have to stretch
   * them across a month-long axis.
   */
  const complianceTimeRange: RangeStartAndEndDateTime =
    useMemo((): RangeStartAndEndDateTime => {
      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          complianceWindow.startDate,
          complianceWindow.axisEndDate,
        ),
      };
    }, [complianceWindow]);

  /*
   * The zoomed window, or null for the live compliance window. A reset
   * returns to the window as it is NOW - re-resolved on every evaluation -
   * rather than to a snapshot of it taken when the zoom was made, which is
   * why this is not useTimeRangeZoom over a copy of the window.
   */
  const [zoomedTimeRange, setZoomedTimeRange] =
    useState<RangeStartAndEndDateTime | null>(null);

  // Read by the identity-stable zoom callback below, so it never goes stale.
  const complianceWindowStartRef: React.MutableRefObject<Date> = useRef<Date>(
    complianceWindow.startDate,
  );
  complianceWindowStartRef.current = complianceWindow.startDate;

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const zoomed: RangeStartAndEndDateTime | null = getSloBurnDownZoomRange({
        startTime: startTime,
        endTime: endTime,
        complianceWindowStart: complianceWindowStartRef.current,
        now: OneUptimeDate.getCurrentDate(),
      });

      if (zoomed) {
        setZoomedTimeRange(zoomed);
      }
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    setZoomedTimeRange(null);
  }, []);

  /*
   * Offered to everything in the card: the chart (drag and double-click),
   * the header's "Reset zoom" and the drag hint. It also shadows any zoom
   * a page around the card might offer, so a drag here never retimes
   * anything else.
   */
  const zoom: TimeRangeZoom = {
    isZoomed: zoomedTimeRange !== null,
    rangeBeforeZoom: zoomedTimeRange ? complianceTimeRange : null,
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
  };

  const series: UseSloHistorySeriesResult = useSloHistorySeries({
    sloId: props.sloId,
    metricName: SloHistoryMetricName.ErrorBudgetRemainingPercent,
    timeRange: zoomedTimeRange || complianceTimeRange,
    refreshToken: props.refreshToken,
  });

  const atRiskThreshold: number =
    typeof slo.atRiskThresholdPercentage === "number" &&
    isFinite(slo.atRiskThresholdPercentage)
      ? slo.atRiskThresholdPercentage
      : DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_METRICS] as Route,
    { modelId: props.sloId },
  );

  const windowPhrase: string = getSloWindowPhrase({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    timezone: slo.timezone,
  });

  const description: string = isCalendarMonth
    ? `Error budget left over ${windowPhrase}. The faded line spends the budget evenly by the reset — below it, the month is burning too fast.`
    : `Error budget left over ${windowPhrase}, with the at-risk and exhausted lines this SLO is judged against.`;

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    /*
     * The loader replaces the chart only before the first load. A refresh
     * after the next evaluation keeps the line up instead of flashing.
     */
    if (!series.hasLoaded && series.error) {
      return (
        <ErrorMessage message={series.error} onRefreshClick={series.retry} />
      );
    }

    if (!series.hasLoaded) {
      return <ComponentLoader />;
    }

    if (series.points.length === 0 && zoomedTimeRange) {
      /*
       * A zoom into a stretch with no history leaves no chart to
       * double-click, so the empty state takes the double-click instead.
       */
      return (
        <div onDoubleClick={resetZoom}>
          <SloOverviewEmptyState
            dataTestId="slo-burn-down-empty"
            icon={IconProp.ChartBar}
            title="No budget history in the zoomed window"
            description="Double-click here, or use Reset zoom, to go back to the whole compliance window."
          />
        </div>
      );
    }

    if (series.points.length === 0) {
      return (
        <SloOverviewEmptyState
          dataTestId="slo-burn-down-empty"
          icon={IconProp.ChartBar}
          title={
            slo.lastEvaluatedAt
              ? "No budget history in this window yet"
              : "No budget history yet"
          }
          description={`Each evaluation records the remaining budget, every ${SLO_EVALUATION_CADENCE_MINUTES} minutes. The line appears after the next one.`}
        />
      );
    }

    /*
     * The window the history was fetched for - the compliance window, or
     * the zoom - which also sets the bucket size: finer for a zoom.
     */
    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: series.startDate,
        max: series.endDate,
        aggregateType: XAxisAggregateType.Average,
        /*
         * Pinned to the bucket size the data was actually aggregated at, so
         * each axis slot maps to exactly one history bucket — and the
         * even-burn line below, generated at the same step, fills every
         * slot (the chart does not join lines across empty ones).
         */
        precision: XAxisUtil.getPrecisionForAggregationInterval(
          series.aggregationInterval,
        ),
      },
    };

    const yAxis: YAxis = {
      legend: "Budget remaining",
      options: {
        type: YAxisType.Number,
        // An overspent budget goes negative; "auto" keeps it on the chart.
        min: "auto",
        max: 100,
        precision: YAxisPrecision.OneDecimal,
        formatter: (value: number): string => {
          return formatSloPercent(value, 1) || "";
        },
      },
    };

    const data: Array<SeriesPoint> = [
      {
        seriesName: BURN_DOWN_BUDGET_SERIES_NAME,
        data: series.points,
      },
    ];

    if (isCalendarMonth) {
      // The month's own line, over whatever part of the month is shown.
      const idealPoints: Array<SloIdealBurnPoint> =
        getSloIdealBurnPointsInWindow({
          budgetStartDate: complianceWindow.startDate,
          budgetResetDate: complianceWindow.axisEndDate,
          windowStartDate: series.startDate,
          windowEndDate: series.endDate,
          stepSeconds:
            getSloChartBucketSeconds(series.aggregationInterval) || 0,
        });

      data.push({
        seriesName: BURN_DOWN_IDEAL_SERIES_NAME,
        data: idealPoints.map((point: SloIdealBurnPoint): DataPoint => {
          return { x: point.x, y: point.y };
        }),
      });
    }

    const referenceLines: Array<ChartReferenceLineProps> = [
      {
        value: 0,
        label: "Budget exhausted",
        color: EXHAUSTED_LINE_COLOR,
      },
      {
        value: atRiskThreshold,
        label: `At risk (${formatSloPercent(atRiskThreshold)})`,
        color: AT_RISK_LINE_COLOR,
        strokeDasharray: "4 4",
      },
    ];

    return (
      <div data-testid="slo-burn-down-chart">
        <LineChartElement
          data={data}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={ChartCurve.MONOTONE}
          heightInPx={260}
          sync={false}
          syncid={`slo-burn-down-${props.sloId.toString()}`}
          showLegend={isCalendarMonth}
          colors={SERIES_COLORS}
          ghostSeriesNames={
            isCalendarMonth ? [BURN_DOWN_IDEAL_SERIES_NAME] : undefined
          }
          referenceLines={referenceLines}
        />
      </div>
    );
  };

  return (
    <TimeRangeZoomProvider zoom={zoom}>
      <Card
        className="group/zoomhint"
        bodyClassName={SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME}
        title="Error budget burn-down"
        description={description}
        rightElement={
          <div className="flex items-center gap-2">
            <ResetTimeRangeZoomButton />
            <SloOverviewActionLink
              title="Open metrics"
              icon={IconProp.ChartBar}
              to={metricsRoute}
            />
          </div>
        }
      >
        <SloChartZoomHint />
        {getBody()}
      </Card>
    </TimeRangeZoomProvider>
  );
};

export default SloBudgetBurnDownCard;
