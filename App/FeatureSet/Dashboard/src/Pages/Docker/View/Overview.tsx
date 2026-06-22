import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import OsVersionDisplay, {
  getOsVersionPrimary,
} from "Common/UI/Components/OsVersionDisplay/OsVersionDisplay";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
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
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
} from "Common/Types/Dashboard/DashboardViewConfig";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import HeartbeatAvailabilityUtil, {
  HeartbeatAvailabilityResult,
} from "Common/Utils/Telemetry/HeartbeatAvailability";
import ValueFormatter from "Common/Utils/ValueFormatter";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

interface TopContainerRow {
  name: string;
  cpuPercent: number;
  memoryPercent: number;
}

interface OverviewStats {
  containerCount: number;
  avgCpu: number | null;
  maxCpu: number | null;
  avgMemory: number | null;
  maxMemory: number | null;
  totalPids: number | null;
  topByCpu: Array<TopContainerRow>;
  topByMemory: Array<TopContainerRow>;
}

const CONTAINER_NAME_ATTR: string = "resource.container.name";

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatInt: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return Math.round(value).toString();
};

interface MetricTileProps {
  title: string;
  icon: IconProp;
  iconColor: "blue" | "violet" | "amber" | "emerald" | "slate" | "sky";
  value: string;
  sublabel?: string | undefined;
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
}

const colorClasses: Record<
  MetricTileProps["iconColor"],
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  slate: { bg: "bg-slate-50", ring: "ring-slate-200", text: "text-slate-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
};

const MetricTile: FunctionComponent<MetricTileProps> = (
  props: MetricTileProps,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    colorClasses[props.iconColor];

  const barColor: string = (() => {
    if (props.percent === null || props.percent === undefined) {
      return "bg-gray-300";
    }
    const t: { warn: number; danger: number } = props.thresholds || {
      warn: 70,
      danger: 90,
    };
    if (props.percent >= t.danger) {
      return "bg-red-500";
    }
    if (props.percent >= t.warn) {
      return "bg-amber-500";
    }
    return "bg-emerald-500";
  })();

  const safePercent: number =
    props.percent === null || props.percent === undefined
      ? 0
      : Math.min(100, Math.max(0, props.percent));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {props.title}
        </span>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900 leading-none">
        {props.value}
      </div>
      {props.sublabel ? (
        <div className="mt-1 text-xs text-gray-500">{props.sublabel}</div>
      ) : (
        <div className="mt-1 text-xs text-gray-400">&nbsp;</div>
      )}
      {props.percent !== undefined && props.percent !== null && (
        <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`${barColor} h-1.5 rounded-full transition-all`}
            style={{ width: `${safePercent}%` }}
          />
        </div>
      )}
    </div>
  );
};

/*
 * Tile values use a short recent-window mean regardless of how wide
 * the chart window is — "what's happening right now" is what the
 * numbers in the tiles answer, even when the chart is showing a
 * month. `meanFromBuckets` falls back to the full window if no
 * bucket is recent enough so tiles never go blank on slow hosts.
 */
const TILE_WINDOW_MINUTES: number = 5;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "docker-overview-auto-refresh-interval";

const DockerHostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [host, setHost] = useState<DockerHost | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [cpuAvgSeries, setCpuAvgSeries] = useState<Array<SeriesPoint>>([]);
  const [cpuMaxSeries, setCpuMaxSeries] = useState<Array<SeriesPoint>>([]);
  const [memoryAvgSeries, setMemoryAvgSeries] = useState<Array<SeriesPoint>>(
    [],
  );
  const [memoryMaxSeries, setMemoryMaxSeries] = useState<Array<SeriesPoint>>(
    [],
  );
  const [networkSeries, setNetworkSeries] = useState<Array<SeriesPoint>>([]);
  const [availabilitySeries, setAvailabilitySeries] = useState<
    Array<SeriesPoint>
  >([]);
  const [availabilityPct, setAvailabilityPct] = useState<number | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] =
    useState<AutoRefreshInterval>(() => {
      if (typeof window === "undefined") {
        return AutoRefreshInterval.THIRTY_SECONDS;
      }
      const stored: string | null =
        window.localStorage?.getItem(REFRESH_STORAGE_KEY) ?? null;
      if (
        stored &&
        (Object.values(AutoRefreshInterval) as Array<string>).includes(stored)
      ) {
        return stored as AutoRefreshInterval;
      }
      return AutoRefreshInterval.THIRTY_SECONDS;
    });

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    setIsRefreshing(true);
    setStatsError("");
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          name: true,
          description: true,
          hostIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          osType: true,
          osVersion: true,
        },
      });

      if (!item?.hostIdentifier) {
        setStatsError("Host not found.");
        setIsRefreshing(false);
        setIsInitialLoading(false);
        return;
      }

      setHost(item);

      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;
      const tileWindowStart: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -TILE_WINDOW_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const dockerAttributes: Record<string, string> = {
        "resource.host.name": item.hostIdentifier as string,
        "resource.container.runtime": "docker",
      };

      const buildAggregateBy: (
        metricName: string,
        aggType: AggregationType,
        attrs?: Record<string, string>,
      ) => AggregateBy<Metric> = (
        metricName: string,
        aggType: AggregationType,
        attrs?: Record<string, string>,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: {
              ...dockerAttributes,
              ...(attrs || {}),
            },
          } as AggregateBy<Metric>["query"],
          aggregationType: aggType,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: startDate,
          endTimestamp: endDate,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            time: SortOrder.Descending,
          },
        };
      };

      /*
       * Per-container aggregates that we then collapse client-side.
       * Avg = mean across containers at each bucket; Max = the
       * busiest single container in the bucket. Grouping by
       * attributes preserves the container name dimension so we can
       * also compute Top-N consumers from the same query.
       */
      const cpuPerContainerAgg: AggregateBy<Metric> = buildAggregateBy(
        "container.cpu.utilization",
        AggregationType.Avg,
      );
      cpuPerContainerAgg.groupBy = {
        attributes: true,
      };

      const memPerContainerAgg: AggregateBy<Metric> = buildAggregateBy(
        "container.memory.percent",
        AggregationType.Avg,
      );
      memPerContainerAgg.groupBy = {
        attributes: true,
      };

      /*
       * `container.network.io.usage.{rx,tx}_bytes` are cumulative
       * counters per (container, interface). Pull the max per bucket
       * so any in-bucket datapoint count doesn't smear the cumulative
       * value — we convert to a rate (B/s) client-side by taking
       * deltas between consecutive buckets per (container, interface)
       * direction, clamping negatives to 0 to absorb counter resets
       * (containers restarting / interfaces coming and going).
       */
      const netRxAgg: AggregateBy<Metric> = buildAggregateBy(
        "container.network.io.usage.rx_bytes",
        AggregationType.Max,
      );
      netRxAgg.groupBy = {
        attributes: true,
      };

      const netTxAgg: AggregateBy<Metric> = buildAggregateBy(
        "container.network.io.usage.tx_bytes",
        AggregationType.Max,
      );
      netTxAgg.groupBy = {
        attributes: true,
      };

      /*
       * `container.pids.count` is the number of processes inside each
       * container. Summing it across containers gives the total
       * process load contributed by Docker on this host.
       */
      const pidsAgg: AggregateBy<Metric> = buildAggregateBy(
        "container.pids.count",
        AggregationType.Avg,
      );
      pidsAgg.groupBy = {
        attributes: true,
      };

      /*
       * Heartbeat uses the synthetic per-host beat. For Docker, the
       * heartbeat row carries `resource.host.name=<docker host>` so
       * the same `resource.host.name` filter we use everywhere else
       * picks it up. Count > 0 per bucket = collector emitted at least
       * one batch for this host in that bucket.
       */
      const heartbeatAgg: AggregateBy<Metric> = {
        query: {
          projectId: projectId,
          time: new InBetween<Date>(startDate, endDate),
          name: "oneuptime.host.heartbeat",
          attributes: {
            "resource.host.name": item.hostIdentifier as string,
          },
        } as AggregateBy<Metric>["query"],
        aggregationType: AggregationType.Count,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startDate,
        endTimestamp: endDate,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          time: SortOrder.Descending,
        },
      };

      const [
        cpuResult,
        memResult,
        netRxResult,
        netTxResult,
        pidsResult,
        heartbeatResult,
      ]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: cpuPerContainerAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: memPerContainerAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: netRxAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: netTxAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: pidsAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: heartbeatAgg,
        }),
      ]);

      const getBucketTimestamp: (p: AggregatedModel) => number = (
        p: AggregatedModel,
      ): number => {
        const raw: unknown =
          p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
        if (raw instanceof Date) {
          return raw.getTime();
        }
        if (typeof raw === "string" || typeof raw === "number") {
          return new Date(raw).getTime();
        }
        return NaN;
      };

      type TimeValuePoint = { x: Date; y: number };

      /*
       * For per-container metrics, reduce each bucket across the
       * containers present in it. Avg = sum/count of containers in
       * that bucket; Max = the busiest container. Building both off
       * one query keeps the network round-trip minimal.
       */
      const reduceAcrossContainers: (
        result: AggregatedResult,
        reducer: "avg" | "max",
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
        reducer: "avg" | "max",
      ): Array<TimeValuePoint> => {
        const perBucket: Map<
          number,
          { sum: number; count: number; max: number }
        > = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let entry: { sum: number; count: number; max: number } | undefined =
            perBucket.get(t);
          if (!entry) {
            entry = { sum: 0, count: 0, max: -Infinity };
            perBucket.set(t, entry);
          }
          entry.sum += v;
          entry.count += 1;
          if (v > entry.max) {
            entry.max = v;
          }
        }
        const out: Array<TimeValuePoint> = [];
        for (const [t, e] of perBucket.entries()) {
          if (e.count === 0) {
            continue;
          }
          const y: number = reducer === "avg" ? e.sum / e.count : e.max;
          out.push({ x: new Date(t), y: y });
        }
        out.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return out;
      };

      const meanInRecentWindow: (
        series: Array<TimeValuePoint>,
      ) => number | null = (series: Array<TimeValuePoint>): number | null => {
        if (series.length === 0) {
          return null;
        }
        const tileWindowStartMs: number = tileWindowStart.getTime();
        let sum: number = 0;
        let count: number = 0;
        for (const p of series) {
          if (p.x.getTime() < tileWindowStartMs) {
            continue;
          }
          sum += p.y;
          count++;
        }
        if (count === 0) {
          for (const p of series) {
            sum += p.y;
            count++;
          }
        }
        return count > 0 ? sum / count : null;
      };

      const cpuAvgPoints: Array<TimeValuePoint> = reduceAcrossContainers(
        cpuResult,
        "avg",
      );
      const cpuMaxPoints: Array<TimeValuePoint> = reduceAcrossContainers(
        cpuResult,
        "max",
      );
      const memoryAvgPoints: Array<TimeValuePoint> = reduceAcrossContainers(
        memResult,
        "avg",
      );
      const memoryMaxPoints: Array<TimeValuePoint> = reduceAcrossContainers(
        memResult,
        "max",
      );

      /*
       * Total PIDs across containers per bucket — sum across the
       * containers visible in that bucket. The tile reports the mean
       * of this total in the recent window.
       */
      const pidsTotalPoints: Array<TimeValuePoint> = (() => {
        const perBucket: Map<number, number> = new Map();
        for (const p of (pidsResult.data || []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          perBucket.set(t, (perBucket.get(t) || 0) + v);
        }
        return Array.from(perBucket.entries())
          .map(([t, y]: [number, number]): TimeValuePoint => {
            return { x: new Date(t), y: y };
          })
          .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
            return a.x.getTime() - b.x.getTime();
          });
      })();

      /*
       * Top-N container lists use the most recent bucket per container
       * inside the tile window — gives an honest snapshot of "who's
       * hot right now" regardless of the chart window width.
       */
      const latestPerContainer: (
        result: AggregatedResult,
      ) => Map<string, number> = (
        result: AggregatedResult,
      ): Map<string, number> => {
        const latestTime: Map<string, number> = new Map();
        const latestVal: Map<string, number> = new Map();
        const tileWindowStartMs: number = tileWindowStart.getTime();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          const name: string = (attrs[CONTAINER_NAME_ATTR] as string) || "";
          if (!name) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          if (t < tileWindowStartMs) {
            continue;
          }
          const prev: number | undefined = latestTime.get(name);
          if (prev === undefined || t > prev) {
            latestTime.set(name, t);
            latestVal.set(name, v);
          }
        }
        /*
         * Fallback: if the tile window had no data for a container,
         * use the most recent bucket from anywhere in the chart window
         * so the Top-N list isn't empty for slow hosts.
         */
        if (latestVal.size === 0) {
          for (const p of (result.data || []) as Array<AggregatedModel>) {
            const attrs: Record<string, unknown> =
              (p["attributes"] as Record<string, unknown>) || {};
            const name: string = (attrs[CONTAINER_NAME_ATTR] as string) || "";
            if (!name) {
              continue;
            }
            const t: number = getBucketTimestamp(p);
            const v: number = Number(p["value"]);
            if (!Number.isFinite(t) || !Number.isFinite(v)) {
              continue;
            }
            const prev: number | undefined = latestTime.get(name);
            if (prev === undefined || t > prev) {
              latestTime.set(name, t);
              latestVal.set(name, v);
            }
          }
        }
        return latestVal;
      };

      const latestCpu: Map<string, number> = latestPerContainer(cpuResult);
      const latestMem: Map<string, number> = latestPerContainer(memResult);

      const containerNames: Set<string> = new Set([
        ...latestCpu.keys(),
        ...latestMem.keys(),
      ]);
      const rows: Array<TopContainerRow> = [];
      for (const name of containerNames) {
        rows.push({
          name: name,
          cpuPercent: latestCpu.get(name) ?? 0,
          memoryPercent: latestMem.get(name) ?? 0,
        });
      }

      const topByCpu: Array<TopContainerRow> = [...rows]
        .sort((a: TopContainerRow, b: TopContainerRow) => {
          return b.cpuPercent - a.cpuPercent;
        })
        .slice(0, 5);

      const topByMemory: Array<TopContainerRow> = [...rows]
        .sort((a: TopContainerRow, b: TopContainerRow) => {
          return b.memoryPercent - a.memoryPercent;
        })
        .slice(0, 5);

      const avgCpu: number | null = meanInRecentWindow(cpuAvgPoints);
      const maxCpu: number | null = meanInRecentWindow(cpuMaxPoints);
      const avgMem: number | null = meanInRecentWindow(memoryAvgPoints);
      const maxMem: number | null = meanInRecentWindow(memoryMaxPoints);
      const totalPids: number | null = meanInRecentWindow(pidsTotalPoints);

      setStats({
        containerCount: containerNames.size,
        avgCpu: avgCpu,
        maxCpu: maxCpu,
        avgMemory: avgMem,
        maxMemory: maxMem,
        totalPids: totalPids,
        topByCpu: topByCpu,
        topByMemory: topByMemory,
      });

      setCpuAvgSeries(
        cpuAvgPoints.length > 0
          ? [{ seriesName: "Avg CPU %", data: cpuAvgPoints }]
          : [],
      );
      setCpuMaxSeries(
        cpuMaxPoints.length > 0
          ? [{ seriesName: "Peak CPU %", data: cpuMaxPoints }]
          : [],
      );
      setMemoryAvgSeries(
        memoryAvgPoints.length > 0
          ? [{ seriesName: "Avg Memory %", data: memoryAvgPoints }]
          : [],
      );
      setMemoryMaxSeries(
        memoryMaxPoints.length > 0
          ? [{ seriesName: "Peak Memory %", data: memoryMaxPoints }]
          : [],
      );

      /*
       * Network rate by direction (B/s). Deltas per (container,
       * interface, direction) bucket-to-bucket, clamped to 0, summed
       * across containers and interfaces per direction.
       */
      const computeNetworkRate: (
        result: AggregatedResult,
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
      ): Array<TimeValuePoint> => {
        const perKey: Map<string, Array<{ t: number; v: number }>> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          const container: string =
            (attrs[CONTAINER_NAME_ATTR] as string) || "";
          const interfaceName: string =
            (attrs["interface"] as string) ||
            (attrs["network.interface"] as string) ||
            "";
          if (!container) {
            continue;
          }
          const key: string = `${container}|${interfaceName}`;
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let arr: Array<{ t: number; v: number }> | undefined =
            perKey.get(key);
          if (!arr) {
            arr = [];
            perKey.set(key, arr);
          }
          arr.push({ t, v });
        }
        const perBucket: Map<number, number> = new Map();
        for (const arr of perKey.values()) {
          arr.sort(
            (
              a: { t: number; v: number },
              b: { t: number; v: number },
            ): number => {
              return a.t - b.t;
            },
          );
          for (let i: number = 1; i < arr.length; i++) {
            const prev: { t: number; v: number } = arr[i - 1]!;
            const cur: { t: number; v: number } = arr[i]!;
            const dtSec: number = (cur.t - prev.t) / 1000;
            if (dtSec <= 0) {
              continue;
            }
            const dv: number = cur.v - prev.v;
            if (!Number.isFinite(dv)) {
              continue;
            }
            const rate: number = Math.max(0, dv) / dtSec;
            perBucket.set(cur.t, (perBucket.get(cur.t) || 0) + rate);
          }
        }
        return Array.from(perBucket.entries())
          .map(([t, y]: [number, number]): TimeValuePoint => {
            return { x: new Date(t), y: y };
          })
          .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
            return a.x.getTime() - b.x.getTime();
          });
      };

      const networkInPoints: Array<TimeValuePoint> =
        computeNetworkRate(netRxResult);
      const networkOutPoints: Array<TimeValuePoint> =
        computeNetworkRate(netTxResult);

      setNetworkSeries(
        [
          networkInPoints.length > 0
            ? { seriesName: "In", data: networkInPoints }
            : null,
          networkOutPoints.length > 0
            ? { seriesName: "Out", data: networkOutPoints }
            : null,
        ].filter((s: SeriesPoint | null): s is SeriesPoint => {
          return s !== null;
        }),
      );

      /*
       * Availability — same heartbeat-presence model used by the host
       * overview, via the shared builder: it synthesizes the zero
       * buckets ClickHouse never returns rows for, excludes trailing
       * buckets the ingest pipeline can't have filled yet (so the
       * right edge doesn't flap down/up on every auto-refresh), and
       * bridges single-bucket gaps caused by export jitter. See
       * HeartbeatAvailabilityUtil for the rules.
       */
      const availability: HeartbeatAvailabilityResult =
        HeartbeatAvailabilityUtil.buildAvailabilitySeries({
          heartbeatData: heartbeatResult.data || [],
          windowStart: startDate,
          windowEnd: endDate,
          now: OneUptimeDate.getCurrentDate(),
        });
      setAvailabilitySeries(
        availability.points.length > 0
          ? [{ seriesName: "Up", data: availability.points }]
          : [],
      );
      setAvailabilityPct(availability.uptimePercent);

      setChartWindow({ start: startDate, end: endDate });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      setStatsError(API.getFriendlyMessage(err));
    }
    setIsRefreshing(false);
    setIsInitialLoading(false);
  };

  const fetchStatsRef: React.MutableRefObject<PromiseVoidFunction> =
    useRef<PromiseVoidFunction>(fetchStats);
  fetchStatsRef.current = fetchStats;

  useEffect(() => {
    fetchStatsRef.current().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  }, [timeRange]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      fetchStatsRef.current().catch((err: Error) => {
        setStatsError(API.getFriendlyMessage(err));
      });
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const onManualRefresh: () => void = (): void => {
    fetchStatsRef.current().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  };

  const containersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINERS] as Route,
    { modelId: modelId },
  );

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_LOGS] as Route,
    { modelId: modelId },
  );

  const renderRefreshControl: () => ReactElement = (): ReactElement => {
    return (
      <AutoRefreshControl
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
        onManualRefresh={onManualRefresh}
        isRefreshing={isRefreshing}
        lastRefreshedAt={lastRefreshedAt}
        timeRangePicker={
          <TelemetryTimeRangePicker
            value={timeRange}
            onChange={(value: RangeStartAndEndDateTime): void => {
              setTimeRange(value);
            }}
          />
        }
      />
    );
  };

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!host) {
      return null;
    }

    const status: string = (host.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = host.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (host.name as string | undefined) ||
      (host.hostIdentifier as string | undefined) ||
      "Untitled Docker host";

    const hostIdentifier: string =
      (host.hostIdentifier as string | undefined) || "";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (stats && stats.containerCount > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${stats.containerCount} container${stats.containerCount === 1 ? "" : "s"}`,
      });
    }
    if (host.osType) {
      specChips.push({
        icon: IconProp.Cog,
        label: String(host.osType),
      });
    }
    if (host.osVersion) {
      const osVersionLabel: string = getOsVersionPrimary(
        String(host.osVersion),
      );
      if (osVersionLabel) {
        specChips.push({
          icon: IconProp.Info,
          label: osVersionLabel,
        });
      }
    }

    const statusBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const statusDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const statusLabel: string = isConnected
      ? "Connected"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Disconnected";

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-sky-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-sky-200 shadow-sm">
                  <Icon
                    icon={IconProp.Docker}
                    className="h-6 w-6 text-sky-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
                  </div>
                  {hostIdentifier && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {hostIdentifier}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    Last seen {lastSeenText}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
                {renderRefreshControl()}
              </div>
            </div>

            {specChips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {specChips.map(
                  (
                    chip: { icon: IconProp; label: string },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`spec-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        <Icon
                          icon={chip.icon}
                          className="h-3 w-3 text-gray-500"
                        />
                        <span className="font-medium">{chip.label}</span>
                      </span>
                    );
                  },
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSummaryCards: () => ReactElement = (): ReactElement => {
    if (isInitialLoading) {
      return (
        <div className="mb-6">
          <PageLoader isVisible={true} />
        </div>
      );
    }

    if (statsError) {
      return (
        <div className="mb-6">
          <ErrorMessage message={statsError} />
        </div>
      );
    }

    const s: OverviewStats | null = stats;
    if (!s) {
      return <Fragment />;
    }

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          title="Containers"
          icon={IconProp.Cube}
          iconColor="sky"
          value={formatInt(s.containerCount)}
          sublabel="reporting"
        />
        <MetricTile
          title="Avg CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.avgCpu)}
          sublabel="across containers"
          percent={s.avgCpu}
        />
        <MetricTile
          title="Peak CPU"
          icon={IconProp.Activity}
          iconColor="amber"
          value={formatPercent(s.maxCpu)}
          sublabel="busiest container"
          percent={s.maxCpu}
          thresholds={{ warn: 75, danger: 95 }}
        />
        <MetricTile
          title="Avg Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.avgMemory)}
          sublabel="of container limit"
          percent={s.avgMemory}
        />
        <MetricTile
          title="Peak Memory"
          icon={IconProp.Database}
          iconColor="emerald"
          value={formatPercent(s.maxMemory)}
          sublabel="hottest container"
          percent={s.maxMemory}
          thresholds={{ warn: 80, danger: 95 }}
        />
      </div>
    );
  };

  const renderChartCard: (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    curve?: ChartCurve;
    headerExtra?: ReactElement;
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    curve?: ChartCurve;
    headerExtra?: ReactElement;
  }): ReactElement => {
    const colors: { bg: string; ring: string; text: string } =
      colorClasses[params.iconColor];

    if (!chartWindow) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {params.title}
            </span>
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
            >
              <Icon
                icon={params.icon}
                className={`h-3.5 w-3.5 ${colors.text}`}
              />
            </div>
          </div>
          <div className="h-48 animate-pulse rounded-md bg-gray-50" />
        </div>
      );
    }

    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: chartWindow.start,
        max: chartWindow.end,
        aggregateType: XAxisAggregateType.Average,
      },
    };
    const yAxis: YAxis = params.yAxis ?? {
      legend: "%",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: 100,
        formatter: (value: number): string => {
          return `${Math.round(value)}%`;
        },
        precision: YAxisPrecision.NoDecimals,
      },
    };

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {params.title}
            </span>
            {params.headerExtra ?? null}
          </div>
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
          >
            <Icon icon={params.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
          </div>
        </div>
        <LineChartElement
          data={params.data}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={params.curve ?? ChartCurve.MONOTONE}
          sync={true}
          syncid={`docker-overview-${modelId.toString()}`}
          heightInPx={180}
          showLegend={params.showLegend ?? false}
        />
      </div>
    );
  };

  const renderCharts: () => ReactElement = (): ReactElement => {
    if (statsError) {
      return <Fragment />;
    }

    const networkYAxis: YAxis = {
      legend: "B/s",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, "By/s");
        },
      },
    };

    const availabilityYAxis: YAxis = {
      legend: "",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: 100,
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          if (value >= 100) {
            return "Up";
          }
          if (value <= 0) {
            return "Down";
          }
          return `${Math.round(value)}%`;
        },
      },
    };

    const availabilityBadge: ReactElement =
      availabilityPct === null ? (
        <Fragment />
      ) : (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
            availabilityPct >= 99
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : availabilityPct >= 90
                ? "bg-amber-50 text-amber-700 ring-amber-200"
                : "bg-red-50 text-red-700 ring-red-200"
          }`}
        >
          {availabilityPct.toFixed(availabilityPct >= 99.95 ? 1 : 2)}% uptime
        </span>
      );

    return (
      <Fragment>
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Availability
              </h2>
              <p className="text-xs text-gray-500">
                Per-bucket presence of host heartbeats over the selected time
                range
              </p>
            </div>
          </div>
          {renderChartCard({
            title: "Availability",
            icon: IconProp.Heartbeat,
            iconColor: "emerald",
            data: availabilitySeries,
            yAxis: availabilityYAxis,
            curve: ChartCurve.STEP,
            headerExtra: availabilityBadge,
          })}
        </div>
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Container resource usage
              </h2>
              <p className="text-xs text-gray-500">
                Aggregated across containers over the selected time range
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {renderChartCard({
              title: "Avg CPU",
              icon: IconProp.ChartBar,
              iconColor: "blue",
              data: cpuAvgSeries,
            })}
            {renderChartCard({
              title: "Peak CPU",
              icon: IconProp.Activity,
              iconColor: "amber",
              data: cpuMaxSeries,
            })}
            {renderChartCard({
              title: "Avg Memory",
              icon: IconProp.SquareStack,
              iconColor: "violet",
              data: memoryAvgSeries,
            })}
            {renderChartCard({
              title: "Peak Memory",
              icon: IconProp.Database,
              iconColor: "emerald",
              data: memoryMaxSeries,
            })}
          </div>
        </div>
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Network</h2>
              <p className="text-xs text-gray-500">
                Aggregate receive / transmit rate across all containers
              </p>
            </div>
          </div>
          {renderChartCard({
            title: "Network",
            icon: IconProp.Wifi,
            iconColor: "sky",
            data: networkSeries,
            yAxis: networkYAxis,
            showLegend: networkSeries.length > 1,
          })}
        </div>
      </Fragment>
    );
  };

  const renderTopContainers: () => ReactElement = (): ReactElement => {
    if (
      !stats ||
      (stats.topByCpu.length === 0 && stats.topByMemory.length === 0)
    ) {
      return <Fragment />;
    }

    const renderList: (
      title: string,
      rows: Array<TopContainerRow>,
      metric: "cpu" | "memory",
    ) => ReactElement = (
      title: string,
      rows: Array<TopContainerRow>,
      metric: "cpu" | "memory",
    ): ReactElement => {
      return (
        <Card
          title={title}
          description={`Top ${rows.length} containers by ${metric === "cpu" ? "CPU" : "memory"} usage (last 5 minutes).`}
        >
          <div className="divide-y divide-gray-200">
            {rows.length === 0 ? (
              <div className="py-4 text-sm text-gray-500">
                No data available yet.
              </div>
            ) : (
              rows.map((row: TopContainerRow) => {
                const value: number =
                  metric === "cpu" ? row.cpuPercent : row.memoryPercent;
                const detailRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL] as Route,
                  { modelId: modelId, subModelId: row.name },
                );
                return (
                  <div
                    key={`${metric}-${row.name}`}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <Link
                        to={detailRoute}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                      >
                        {row.name}
                      </Link>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatPercent(value)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      );
    };

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderList("Top CPU Consumers", stats.topByCpu, "cpu")}
        {renderList("Top Memory Consumers", stats.topByMemory, "memory")}
      </div>
    );
  };

  const renderQuickLinks: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title="Quick Links"
        description="Jump to key views for this Docker host."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            to={containersRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">
              Containers
            </div>
            <div className="text-xs text-gray-500">
              Live list of running containers with CPU, memory, and network.
            </div>
          </Link>
          <Link
            to={metricsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Metrics</div>
            <div className="text-xs text-gray-500">
              Aggregated CPU, memory, network, and process charts.
            </div>
          </Link>
          <Link
            to={logsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Logs</div>
            <div className="text-xs text-gray-500">
              Structured container logs ingested via OpenTelemetry.
            </div>
          </Link>
        </div>
      </Card>
    );
  };

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryCards()}
      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="dockerHosts"
        incidentsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW_INCIDENTS] as Route,
          { modelId: modelId },
        )}
        alertsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW_ALERTS] as Route,
          { modelId: modelId },
        )}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW_SCHEDULED_MAINTENANCE] as Route,
          { modelId: modelId },
        )}
      />
      {renderCharts()}
      {renderTopContainers()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<DockerHost>
        name="Docker Host Details"
        cardProps={{
          title: "Docker Host Details",
          description: "Overview of this Docker host.",
        }}
        modelDetailProps={{
          modelType: DockerHost,
          id: "docker-host-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.name);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                hostIdentifier: true,
              },
              title: "Host Identifier",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.hostIdentifier);
              },
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.otelCollectorStatus);
              },
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                osType: true,
              },
              title: "OS Type",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                const osType: string | undefined =
                  (item.osType as string | undefined) ?? undefined;
                if (!osType) {
                  return <span className="text-sm text-gray-400">—</span>;
                }
                return (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 text-sm font-medium ring-1 ring-inset ring-slate-200 capitalize">
                    {osType}
                  </span>
                );
              },
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.osType);
              },
            },
            {
              field: {
                osVersion: true,
              },
              title: "OS Version",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                const osVersion: string | undefined =
                  (item.osVersion as string | undefined) ?? undefined;
                if (!osVersion) {
                  return <span className="text-sm text-gray-400">—</span>;
                }
                return <OsVersionDisplay text={osVersion} />;
              },
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.osVersion);
              },
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.agentVersion);
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: DockerHost): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default DockerHostOverview;
