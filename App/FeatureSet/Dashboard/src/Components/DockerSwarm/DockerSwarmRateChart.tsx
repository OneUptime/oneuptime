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

/*
 * Cumulative-counter → per-second-rate chart for Docker Swarm pages.
 * The docker_stats receiver exports container network and block I/O
 * (e.g. `container.network.io.usage.{rx,tx}_bytes`,
 * `container.blockio.io_service_bytes_recursive`) as monotonically
 * increasing counters, so charts must do client-side delta math via the
 * shared CounterRateUtils — the Docker Swarm analog of
 * Pages/Kubernetes/View/KubernetesNetworkThroughputChart.tsx.
 *
 * Each entry in `series` becomes one chart line: its counter metric is
 * fetched over the window, deltas are clamped at counter resets, and
 * per-bucket rates are summed across all matching series (e.g. across
 * all tasks of a service).
 */

export interface DockerSwarmRateChartSeries {
  metricName: string;
  label: string;
}

export interface ComponentProps {
  clusterName: string;
  series: Array<DockerSwarmRateChartSeries>;
  /*
   * Extra datapoint attribute equality filters, e.g.
   * { "container.name": "web.1.xyz" } to scope the rates to one task.
   */
  extraAttributes?: Dictionary<string> | undefined;
  startDate: Date;
  endDate: Date;
  /* ValueFormatter unit for the y axis. Defaults to "By/s". */
  yAxisUnit?: string | undefined;
  heightInPx?: number | undefined;
  syncId?: string | undefined;
  emptyMessage?: string | undefined;
}

const DockerSwarmRateChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [series, setSeries] = useState<Array<SeriesPoint>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const startMs: number = props.startDate.getTime();
  const endMs: number = props.endDate.getTime();
  const extraAttributesKey: string = JSON.stringify(
    props.extraAttributes || {},
  );

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const startDate: Date = new Date(startMs);
        const endDate: Date = new Date(endMs);

        const results: Array<AggregatedResult> = await Promise.all(
          props.series.map((s: DockerSwarmRateChartSeries) => {
            return AnalyticsModelAPI.aggregate<Metric>({
              modelType: Metric,
              aggregateBy: {
                query: {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  time: new InBetween(startDate, endDate),
                  name: s.metricName,
                  attributes: {
                    "resource.docker.swarm.cluster.name": props.clusterName,
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
        props.series.forEach((s: DockerSwarmRateChartSeries, idx: number) => {
          /*
           * The pve `id` label uniquely identifies the counter series
           * (one per node/guest/storage) — the per-resource analog of
           * K8s' node|interface key.
           */
          const points: Array<CounterRatePoint> = computeCounterRate(
            results[idx]!,
            {
              getSeriesKey: makeSeriesKeyFromAttributes(["id"]),
            },
          );
          if (points.length > 0) {
            next.push({ seriesName: s.label, data: points });
          }
        });
        setSeries(next);
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
    // startMs/endMs track the date props by value so identical ranges don't refetch.
  }, [props.clusterName, startMs, endMs, extraAttributesKey]);

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-md bg-gray-50" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (series.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400">
        {props.emptyMessage || "No data reported for the selected time range."}
      </div>
    );
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: props.startDate,
      max: props.endDate,
      aggregateType: XAxisAggregateType.Average,
    },
  };

  const yAxisUnit: string = props.yAxisUnit || "By/s";

  const yAxis: YAxis = {
    legend: yAxisUnit,
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: (value: number): string => {
        return ValueFormatter.formatValue(value, yAxisUnit);
      },
    },
  };

  const syncId: string =
    props.syncId || `docker-swarm-rate-chart-${props.clusterName}`;

  return (
    <LineChartElement
      data={series}
      xAxis={xAxis}
      yAxis={yAxis}
      curve={ChartCurve.MONOTONE}
      heightInPx={props.heightInPx ?? 300}
      showLegend={series.length > 1}
      sync={true}
      syncid={syncId}
    />
  );
};

export default DockerSwarmRateChart;
