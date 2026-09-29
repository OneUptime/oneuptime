import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ValueFormatter from "Common/Utils/ValueFormatter";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  computeCounterRate,
  makeSeriesKeyFromAttributes,
  CounterRatePoint,
} from "../../Utils/CounterRateUtils";
import { useEmbeddedMetricCardRefreshNonce } from "../Metrics/EmbeddedMetricCardRefresh";
import ChartRefetchFrame, {
  ChartLoadingSkeleton,
} from "../Metrics/ChartRefetchFrame";

/*
 * Cumulative-counter → per-second-rate chart for Ceph pages: the
 * ceph-mgr prometheus module exports pool I/O (`ceph_pool_rd/wr`,
 * `ceph_pool_rd_bytes/wr_bytes`) as raw counters, so charts must do
 * client-side delta math via the shared CounterRateUtils — the Ceph
 * analog of Pages/Kubernetes/View/KubernetesNetworkThroughputChart.tsx.
 *
 * Each entry in `series` becomes one chart line: its counter metric is
 * fetched over the window, deltas are clamped at counter resets, and
 * per-bucket rates are summed across all matching series (e.g. across
 * all pools).
 *
 * The line chart takes the zoom of the page (or card) around it on its
 * own, so a drag here retimes whatever the window came from; the window
 * then comes back down as startDate/endDate (issue #4105).
 *
 * A drag or a double-click here reloads this very chart, so a reload keeps
 * the last chart on screen (see ChartRefetchFrame). Only the first load
 * shows a skeleton.
 */

export interface CephRateChartSeries {
  metricName: string;
  label: string;
}

export interface ComponentProps {
  clusterName: string;
  series: Array<CephRateChartSeries>;
  /*
   * Datapoint attribute keys identifying a unique counter series —
   * ["pool_id"] for pool metrics, ["ceph_daemon"] for daemon metrics.
   */
  seriesKeyAttributes: Array<string>;
  /* Extra datapoint attribute equality filters, e.g. { pool_id: "2" }. */
  extraAttributes?: Dictionary<string> | undefined;
  startDate: Date;
  endDate: Date;
  /* ValueFormatter unit for the y axis, e.g. "By/s". Omit for ops/s. */
  yAxisUnit?: string | undefined;
  heightInPx?: number | undefined;
  syncId?: string | undefined;
  emptyMessage?: string | undefined;
}

/*
 * What a load drew, kept with the window it was fetched for. While the next
 * load is in flight the chart keeps these points on THEIR window: the new
 * window on the axis would put the old points in the wrong place.
 */
interface LoadedRates {
  // The cluster and filters the points were loaded for.
  scopeKey: string;
  series: Array<SeriesPoint>;
  startDate: Date;
  endDate: Date;
}

const CephRateChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // null until the first load lands.
  const [loaded, setLoaded] = useState<LoadedRates | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // The zoom the chart takes from the page or card around it.
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();
  /*
   * The Refresh count of the card around the chart. A zoomed window is a
   * Custom one that Refresh re-resolves to the same instants, so without it
   * Refresh could not reload the chart, not even to retry a failed load.
   */
  const refreshNonce: number = useEmbeddedMetricCardRefreshNonce();

  const startMs: number = props.startDate.getTime();
  const endMs: number = props.endDate.getTime();
  const extraAttributesKey: string = JSON.stringify(
    props.extraAttributes || {},
  );
  const scopeKey: string = `${props.clusterName}|${extraAttributesKey}`;

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * The error stays until this load settles, as MetricView's does, so
       * the error over a kept chart does not blink out and back while a
       * retry is in flight.
       */
      setIsLoading(true);
      try {
        const startDate: Date = new Date(startMs);
        const endDate: Date = new Date(endMs);

        const results: Array<AggregatedResult> = await Promise.all(
          props.series.map((s: CephRateChartSeries) => {
            return AnalyticsModelAPI.aggregate<Metric>({
              modelType: Metric,
              aggregateBy: {
                query: {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  time: new InBetween(startDate, endDate),
                  name: s.metricName,
                  attributes: {
                    "resource.ceph.cluster.name": props.clusterName,
                    ...(props.extraAttributes || {}),
                  } as Dictionary<string | number | boolean>,
                },
                /*
                 * Max preserves the raw counter value per bucket;
                 * averaging cumulative counters skews the deltas.
                 */
                aggregationType: AggregationType.Max,
                aggregateColumnName: "value",
                aggregationTimestampColumnName: "time",
                startTimestamp: startDate,
                endTimestamp: endDate,
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                groupBy: {
                  attributes: true,
                },
              },
            });
          }),
        );

        if (cancelled) {
          return;
        }

        const next: Array<SeriesPoint> = [];
        props.series.forEach((s: CephRateChartSeries, idx: number) => {
          const points: Array<CounterRatePoint> = computeCounterRate(
            results[idx]!,
            {
              getSeriesKey: makeSeriesKeyFromAttributes(
                props.seriesKeyAttributes,
              ),
            },
          );
          if (points.length > 0) {
            next.push({ seriesName: s.label, data: points });
          }
        });
        setLoaded({
          scopeKey: scopeKey,
          series: next,
          startDate: startDate,
          endDate: endDate,
        });
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      cancelled = true;
    };
    /*
     * startMs/endMs track the date props by value so identical ranges don't
     * refetch; refreshNonce reloads the same window when the card's Refresh
     * is pressed.
     */
  }, [props.clusterName, startMs, endMs, extraAttributesKey, refreshNonce]);

  const heightInPx: number = props.heightInPx ?? 300;

  /*
   * Only a reload of the same counters keeps the last chart. Another cluster
   * or another set of filters starts over from the skeleton, rather than
   * showing the previous one's rates under the new heading.
   */
  const shown: LoadedRates | null =
    loaded && loaded.scopeKey === scopeKey ? loaded : null;

  if (!shown) {
    // Nothing to keep yet: a retry after a failed first load is a skeleton.
    if (error && !isLoading) {
      return <ErrorMessage message={error} />;
    }
    return <ChartLoadingSkeleton heightInPx={heightInPx} />;
  }

  const series: Array<SeriesPoint> = shown.series;

  if (series.length === 0) {
    /*
     * A zoom into a quiet stretch lands here, with no chart left to
     * double-click. The empty plot area takes the double-click instead,
     * so the way back is where the reader's pointer already is (the same
     * as ChartCard's empty state). The reset is only set while zoomed.
     * It keeps the chart's height, so the zoom does not move the page,
     * and select-none, so the double-click does not select a word.
     */
    return (
      <ChartRefetchFrame isRefetching={isLoading} refetchError={error}>
        <div
          className="flex select-none items-center justify-center text-sm text-gray-400"
          style={{ height: `${heightInPx}px` }}
          onDoubleClick={zoom?.onTimeRangeReset}
        >
          {props.emptyMessage ||
            "No data reported for the selected time range."}
        </div>
      </ChartRefetchFrame>
    );
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: shown.startDate,
      max: shown.endDate,
      aggregateType: XAxisAggregateType.Average,
    },
  };

  const yAxis: YAxis = {
    legend: props.yAxisUnit || "ops/s",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: (value: number): string => {
        if (props.yAxisUnit) {
          return ValueFormatter.formatValue(value, props.yAxisUnit);
        }
        return `${Math.round(value)} ops/s`;
      },
    },
  };

  const syncId: string = props.syncId || `ceph-rate-chart-${props.clusterName}`;

  return (
    <ChartRefetchFrame isRefetching={isLoading} refetchError={error}>
      <LineChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        heightInPx={heightInPx}
        showLegend={series.length > 1}
        sync={true}
        syncid={syncId}
      />
    </ChartRefetchFrame>
  );
};

export default CephRateChart;
