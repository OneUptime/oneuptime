import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "Common/Types/Dashboard/DashboardComponents/DashboardSloComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceList from "../Utils/DashboardResourceList";
import SloWidgetData from "../Utils/SloWidgetData";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import {
  getSloStatusColor,
  getSloStatusText,
} from "Common/Utils/Slo/SloStatusColor";
import {
  formatSloChartValue,
  getSloChartAggregationInterval,
  getSloHistoryMetricName,
  getSloMetricLabel,
  getSloWidgetTileDisplay,
  getSloWidgetTitle,
  SLO_NOT_EVALUATED_TEXT,
  SloWidgetTileDisplay,
} from "Common/Utils/Slo/SloWidgetFormat";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
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

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSloComponent;
}

/*
 * Chrome shared by the "nothing to render" states so the setup, error and
 * empty-history cases all read the same as the sibling widgets' (Gauge /
 * Value) centred icon-plus-caption treatment.
 */
type GetPlaceholderFunction = (data: {
  icon: IconProp;
  iconClassName: string;
  iconBackgroundClassName: string;
  title?: string | undefined;
  message: string;
}) => ReactElement;

const getPlaceholder: GetPlaceholderFunction = (data: {
  icon: IconProp;
  iconClassName: string;
  iconBackgroundClassName: string;
  title?: string | undefined;
  message: string;
}): ReactElement => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center ${data.iconBackgroundClassName}`}
      >
        <div className={`h-5 w-5 ${data.iconClassName}`}>
          <Icon icon={data.icon} />
        </div>
      </div>
      {data.title ? (
        <p className="text-xs font-medium text-gray-500 truncate max-w-full">
          {data.title}
        </p>
      ) : (
        <></>
      )}
      <p className="text-xs text-gray-400 text-center max-w-40">
        {data.message}
      </p>
    </div>
  );
};

const DashboardSloComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);
  const [chartPoints, setChartPoints] = useState<Array<DataPoint>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const serviceLevelObjectiveId: string | undefined =
    props.component.arguments.serviceLevelObjectiveId;
  const sloMetric: SloWidgetMetric =
    props.component.arguments.sloMetric || SloWidgetMetric.Sli;
  const displayType: SloWidgetDisplayType =
    props.component.arguments.displayType || SloWidgetDisplayType.Tile;
  const isChart: boolean = displayType === SloWidgetDisplayType.Chart;

  /*
   * The public endpoints resolve the widget — and therefore the SLO they are
   * allowed to read — from this id, so the fetch depends on it. Depend on the
   * STRING: a re-render can hand us a fresh ObjectID for the same widget, and
   * an identity-based dep would refetch on every one of those (arePropsEqual
   * below compares the same way).
   */
  const componentIdKey: string = props.componentId.toString();

  /*
   * refreshTick is a dep so each auto-refresh re-resolves a relative range
   * ("Past 1 hour") into a fresh concrete window; without it the window is
   * frozen at mount and every refresh re-queries the same stale span. Same
   * reasoning as DashboardGaugeComponent.
   */
  const startAndEndDate: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  /*
   * Guard against an out-of-order response overwriting a newer one: the
   * time-range picker and auto-refresh can both fire while a request is in
   * flight (mirrors DashboardLogChartComponent's sequence ref).
   */
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      setIsLoading(true);

      if (!serviceLevelObjectiveId) {
        // Unconfigured widget — the setup state below explains what to do.
        setSlo(null);
        setChartPoints([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      /*
       * A public dashboard has no session and no "current project" — its
       * reads go through the dashboard-scoped public endpoints instead, which
       * derive the SLO and the project from the stored widget server-side.
       */
      const isPublicDashboard: boolean = DashboardResourceList.isPublic();
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!isPublicDashboard && !projectId) {
        setError("No project selected.");
        setIsLoading(false);
        return;
      }

      const sloId: ObjectID = new ObjectID(serviceLevelObjectiveId);

      try {
        const fetchedSlo: ServiceLevelObjective | null =
          await SloWidgetData.fetchSlo({
            serviceLevelObjectiveId: sloId,
            componentId: props.componentId,
          });

        if (isStale()) {
          return;
        }

        setSlo(fetchedSlo);

        if (!isChart) {
          setChartPoints([]);
          setError(null);
          setIsLoading(false);
          return;
        }

        const startDate: Date = startAndEndDate.startValue;
        const endDate: Date = startAndEndDate.endValue;
        const rangeInMinutes: number = OneUptimeDate.getMinutesBetweenTwoDates(
          startDate,
          endDate,
        );
        const aggregationInterval: AggregationInterval =
          getSloChartAggregationInterval(rangeInMinutes);

        /*
         * Read the series through SloHistory's `/aggregate` endpoint rather
         * than getList: the worker writes one row per metric every ~5 minutes,
         * so a long window holds far more rows than a single unpaginated page
         * can return, and a row-count cap silently truncates the newest data.
         * Aggregating server-side bounds the response by the WINDOW instead,
         * and the GROUP BY also collapses the rare un-merged duplicate row a
         * ReplacingMergeTree can expose. (Same approach as the SLO detail
         * page's charts.)
         */
        const result: AggregatedResult =
          await SloWidgetData.aggregateSloHistory({
            componentId: props.componentId,
            aggregateBy: {
              query: {
                /*
                 * On a public dashboard there is no current project and the
                 * server pins the scope itself; the ObjectID cast keeps the
                 * authenticated query shape unchanged.
                 */
                projectId: projectId as ObjectID,
                sloId: sloId,
                metricName: getSloHistoryMetricName(sloMetric),
                bucketStart: new InBetween(startDate, endDate),
              },
              /*
               * All three series are instantaneous gauges, so averaging the
               * buckets that fall inside one chart point is the right roll-up.
               */
              aggregationType: AggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "bucketStart",
              aggregationInterval: aggregationInterval,
              startTimestamp: startDate,
              endTimestamp: endDate,
              // Oldest -> newest so the line renders left to right.
              sort: {
                bucketStart: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
            },
          });

        if (isStale()) {
          return;
        }

        const points: Array<DataPoint> = [];

        for (const row of result.data) {
          /*
           * `SloHistory.value` is a ClickHouse Decimal, so it can arrive as a
           * string — coerce, and drop anything non-finite so a bad row cannot
           * render as a NaN gap in the line.
           */
          const value: number = Number(row.value);

          if (!row.timestamp || !isFinite(value)) {
            continue;
          }

          points.push({
            x: OneUptimeDate.fromString(row.timestamp),
            y: value,
          });
        }

        setChartPoints(points);
        setError(null);
      } catch (err: unknown) {
        if (!isStale()) {
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      serviceLevelObjectiveId,
      sloMetric,
      isChart,
      startAndEndDate,
      componentIdKey,
    ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, props.refreshTick]);

  const metricLabel: string = getSloMetricLabel(sloMetric);
  const title: string = getSloWidgetTitle({
    widgetTitle: props.component.arguments.widgetTitle,
    sloName: slo?.name,
    sloMetric: sloMetric,
  });

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading && !slo) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center rounded-md animate-pulse">
        <div className="h-3 w-20 bg-gray-100 rounded mb-3"></div>
        <div
          className={`bg-gray-100 rounded mb-2 ${isChart ? "h-20 w-full" : "h-8 w-24"}`}
        ></div>
        <div className="h-4 w-28 bg-gray-50 rounded mt-1"></div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return getPlaceholder({
      icon: IconProp.Percent,
      iconClassName: "text-gray-300",
      iconBackgroundClassName: "bg-gray-50",
      message: error,
    });
  }

  // ── Not configured ─────────────────────────────────────────────────────
  if (!serviceLevelObjectiveId) {
    return getPlaceholder({
      icon: IconProp.Percent,
      iconClassName: "text-emerald-300",
      iconBackgroundClassName: "bg-emerald-50",
      title: props.component.arguments.widgetTitle || "SLO Widget",
      message: "Click to select an SLO",
    });
  }

  // ── Configured, but the SLO is gone (deleted after the widget was saved)
  if (!slo) {
    return getPlaceholder({
      icon: IconProp.Percent,
      iconClassName: "text-gray-300",
      iconBackgroundClassName: "bg-gray-50",
      title: props.component.arguments.widgetTitle || metricLabel,
      message: "This SLO no longer exists.",
    });
  }

  const sloStatus: SloStatus | undefined = slo.sloStatus;
  const statusColor: Color = getSloStatusColor(sloStatus);

  const statusPill: ReactElement = (
    <Pill
      text={getSloStatusText(sloStatus)}
      color={statusColor}
      size={PillSize.Small}
    />
  );

  const titleElement: ReactElement = (
    <div className="text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center">
      {title}
    </div>
  );

  // ── Chart ──────────────────────────────────────────────────────────────
  if (isChart) {
    if (chartPoints.length === 0) {
      return getPlaceholder({
        icon: IconProp.Percent,
        iconClassName: "text-gray-300",
        iconBackgroundClassName: "bg-gray-50",
        title: title,
        message:
          "No history for the selected time range — the SLO is evaluated every few minutes.",
      });
    }

    const target: number | undefined = slo.targetPercentage;
    const referenceLines: Array<ChartReferenceLineProps> | undefined =
      sloMetric === SloWidgetMetric.Sli &&
      typeof target === "number" &&
      isFinite(target)
        ? [
            {
              value: target,
              label: `Target ${target}%`,
              color: "#f59e0b",
              strokeDasharray: "4 4",
            },
          ]
        : undefined;

    const xAxis: ChartXAxis = {
      legend: "",
      options: {
        type: XAxisType.Time,
        min: startAndEndDate.startValue,
        max: startAndEndDate.endValue,
        aggregateType: XAxisAggregateType.Average,
      },
    };

    const yAxis: YAxis = {
      legend: sloMetric === SloWidgetMetric.BurnRate ? "×" : "%",
      options: {
        type: YAxisType.Number,
        /*
         * Burn rate has no ceiling and starts at 0; the two percentage
         * series are capped at 100 but can dip far below it (and error
         * budget remaining can go negative), so let the floor auto-fit.
         */
        min: sloMetric === SloWidgetMetric.BurnRate ? 0 : "auto",
        max: sloMetric === SloWidgetMetric.BurnRate ? "auto" : 100,
        precision: YAxisPrecision.TwoDecimals,
        formatter: (value: number): string => {
          return formatSloChartValue(sloMetric, value);
        },
      },
    };

    const series: Array<SeriesPoint> = [
      {
        seriesName: metricLabel,
        data: chartPoints,
      },
    ];

    /*
     * Reserve the title row and the status row out of the widget height so
     * the chart never overflows its tile at small sizes.
     */
    const chartHeightInPx: number = Math.max(
      props.dashboardComponentHeightInPx - 58,
      80,
    );

    return (
      <div
        className="w-full h-full flex flex-col"
        style={{
          opacity: isLoading ? 0.5 : 1,
          transition: "opacity 0.2s ease-in-out",
        }}
      >
        {titleElement}
        <div className="flex-1 min-h-0">
          <LineChartElement
            data={series}
            xAxis={xAxis}
            yAxis={yAxis}
            curve={ChartCurve.MONOTONE}
            heightInPx={chartHeightInPx}
            showLegend={false}
            /*
             * Each SLO widget is an independent tile with its own metric and
             * y-axis scale, so crosshair syncing across widgets would be
             * misleading rather than helpful.
             */
            sync={false}
            syncid={`slo-widget-${props.componentId.toString()}`}
            referenceLines={referenceLines}
          />
        </div>
        <div className="flex justify-center pt-1">{statusPill}</div>
      </div>
    );
  }

  // ── Tile ───────────────────────────────────────────────────────────────
  const tile: SloWidgetTileDisplay = getSloWidgetTileDisplay({
    sloMetric: sloMetric,
    slo: slo,
  });

  /*
   * Scale the big number to the tile. The not-evaluated placeholder is a
   * sentence rather than a number, so it gets a fixed small size instead —
   * at the value font size it would overflow every tile.
   */
  const valueFontPx: number = Math.max(
    Math.min(
      props.dashboardComponentHeightInPx * 0.3,
      props.dashboardComponentWidthInPx * 0.22,
      44,
    ),
    18,
  );

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1 overflow-hidden"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {titleElement}

      {tile.isEvaluated ? (
        <div
          className="text-center font-bold text-gray-900 tabular-nums truncate max-w-full"
          style={{
            fontSize: `${valueFontPx}px`,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
          }}
        >
          {tile.value}
        </div>
      ) : (
        <div className="text-sm text-gray-400 text-center">
          {SLO_NOT_EVALUATED_TEXT}
        </div>
      )}

      {tile.subline ? (
        <div className="text-[11px] text-gray-400 text-center tabular-nums truncate max-w-full">
          {tile.subline}
        </div>
      ) : (
        <></>
      )}

      <div className="pt-0.5">{statusPill}</div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardSloComponentElement, arePropsEqual);
