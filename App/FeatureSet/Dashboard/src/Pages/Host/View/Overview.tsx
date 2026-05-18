import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Detail from "Common/UI/Components/Detail/Detail";
import DetailField from "Common/UI/Components/Detail/Field";
import OsVersionDisplay, {
  getOsVersionPrimary,
} from "Common/UI/Components/OsVersionDisplay/OsVersionDisplay";
import IpAddressList from "Common/UI/Components/IpAddressList/IpAddressList";
import FieldType from "Common/UI/Components/Types/FieldType";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
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
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import ValueFormatter from "Common/Utils/ValueFormatter";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

interface OverviewStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  filesystemPercent: number | null;
  load1m: number | null;
  runningProcessCount: number | null;
}

interface MountInfo {
  mountpoint: string;
  device: string | null;
  type: string | null;
  totalBytes: number;
  usedBytes: number;
  utilizationPercent: number;
}

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatNumber: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return value.toFixed(2);
};

const formatInt: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return Math.round(value).toString();
};

const formatMemoryBytes: (bytes: number | null | undefined) => string = (
  bytes: number | null | undefined,
): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = bytes;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

interface MetricTileProps {
  title: string;
  icon: IconProp;
  iconColor: "blue" | "violet" | "amber" | "emerald" | "slate";
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
 * the chart window is — "what's the host doing right now" is what
 * the numbers in the tiles answer, even when the chart is showing a
 * month. `meanFromBuckets` falls back to the full window if no
 * bucket is recent enough so tiles never go blank on slow hosts.
 */
const TILE_WINDOW_MINUTES: number = 5;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "host-overview-auto-refresh-interval";

const HostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [host, setHost] = useState<Host | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [mounts, setMounts] = useState<Array<MountInfo> | null>(null);
  const [cpuSeries, setCpuSeries] = useState<Array<SeriesPoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<SeriesPoint>>([]);
  const [diskSeries, setDiskSeries] = useState<Array<SeriesPoint>>([]);
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
  /*
   * Initial-load flag drives the full-page skeleton. Refresh ticks
   * (auto + manual) keep this `false` so the rendered tiles, charts,
   * and tables stay mounted and just swap in new numbers — no
   * flicker between refreshes. The button spinner uses `isRefreshing`
   * instead so users still see something is happening on click.
   */
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
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          name: true,
          description: true,
          hostIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          dockerHostId: true,
          kubernetesClusterId: true,
          containerRuntime: true,
          cpuCores: true,
          totalMemoryBytes: true,
          processCount: true,
          osType: true,
          osVersion: true,
          hostArch: true,
          hostType: true,
          hostIpAddresses: true,
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

      /*
       * Aggregate via the metrics API instead of pulling raw rows.
       * load_average and processes.count carry only the
       * `resource.host.name` filter and route through the per-host
       * MV (MetricItemAggMV1mByHost) for the 5-min window, yielding
       * the average from merged Sum/Count states. CPU / memory /
       * filesystem add a `state` or `mountpoint` filter so those
       * fall through to the base MetricItemV2 — necessary because
       * the per-host MV does not preserve those attributes, and
       * averaging across them produces a number that doesn't match
       * what `top`/`df` show. Direct map subscript on the base table
       * keeps that path fast.
       */
      const buildAggregateBy: (
        metricName: string,
        aggType: AggregationType,
        extraAttributes?: Record<string, string>,
      ) => AggregateBy<Metric> = (
        metricName: string,
        aggType: AggregationType,
        extraAttributes?: Record<string, string>,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: {
              "resource.host.name": item.hostIdentifier as string,
              ...(extraAttributes || {}),
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
       * `system.cpu.utilization` is per-(cpu, state). Averaging every
       * datapoint across all states gives a number that depends on the
       * mix of states the OS exposes (idle, user, system, …) rather
       * than the actual busy-CPU fraction. Pulling only `state=user` +
       * `state=system` and summing — handled below — yields the same
       * "fraction of CPU time spent doing work" that everyone reads
       * from `top`.
       *
       * `system.memory.utilization` is also per-state — `used`, `free`,
       * `inactive`. The three states sum to 1, so a naive avg lands at
       * ~33 % regardless of how busy memory is. Filter to `used`.
       *
       * `system.filesystem.utilization` is per-mountpoint. The Mac
       * `devfs` and other system mounts sit at 100 % by design, so a
       * naive Max gives 100 % every time. Filter to the root
       * mountpoint, which is what the "largest mount" sublabel and
       * every infra dashboard cares about by default.
       */
      /*
       * `system.processes.count` is partitioned by the `status`
       * attribute (running / sleeping / blocked / idle / …). The
       * tile shows only `running` because that's what tells you
       * how much work is contending for CPU right now — the
       * sleeping count dwarfs running and obscures that signal.
       * The total (sum of all statuses) lives on
       * `host.processCount`, surfaced as a sublabel for context.
       */
      /*
       * `system.filesystem.usage` is per-(mountpoint, device, state)
       * with state ∈ {used, free, reserved}. Pulling it grouped by
       * attributes lets us list every mount the host reports, sum
       * the per-state values to recover total capacity, and derive
       * a utilization that matches the bytes the user sees in `df`.
       */
      const fsUsageAggregate: AggregateBy<Metric> = buildAggregateBy(
        "system.filesystem.usage",
        AggregationType.Avg,
      );
      fsUsageAggregate.groupBy = {
        attributes: true,
      };

      /*
       * `system.network.io` is a cumulative counter per (device,
       * direction). Pull the max value per bucket so the in-bucket
       * datapoint count doesn't smear the cumulative value — we
       * convert to a rate (B/s) client-side by taking deltas between
       * consecutive buckets per (device, direction), clamping
       * negatives to 0 to absorb counter resets.
       */
      const networkAggregate: AggregateBy<Metric> = buildAggregateBy(
        "system.network.io",
        AggregationType.Max,
      );
      networkAggregate.groupBy = {
        attributes: true,
      };

      /*
       * `process.cpu.utilization` aggregated by attributes gives one
       * datapoint per active process — used as the Windows fallback
       * for the Processes tile because the `processes` hostmetrics
       * scraper that emits `system.processes.count` is Linux-only.
       * The query window is the tile window (last 5 min) so the
       * distinct-PID count reflects "what's running now", not
       * everything seen over the chart window.
       */
      const processFallbackAggregate: AggregateBy<Metric> = buildAggregateBy(
        "process.cpu.utilization",
        AggregationType.Avg,
      );
      processFallbackAggregate.groupBy = {
        attributes: true,
      };
      processFallbackAggregate.query.time = new InBetween<Date>(
        tileWindowStart,
        endDate,
      );
      processFallbackAggregate.startTimestamp = tileWindowStart;

      /*
       * `oneuptime.host.heartbeat` is the per-collector liveness
       * ping. Count per bucket lets us tell "alive at any point in
       * this bucket" from "completely silent" — a missing row means
       * the host emitted zero heartbeats during that bucket, which
       * we render as a downtime gap on the availability chart.
       */
      const heartbeatAggregate: AggregateBy<Metric> = buildAggregateBy(
        "oneuptime.host.heartbeat",
        AggregationType.Count,
      );

      const [
        cpuUserResult,
        cpuSystemResult,
        memResult,
        loadResult,
        runningProcResult,
        fsUsageResult,
        networkResult,
        processFallbackResult,
        heartbeatResult,
      ]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "system.cpu.utilization",
            AggregationType.Avg,
            { state: "user" },
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "system.cpu.utilization",
            AggregationType.Avg,
            { state: "system" },
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "system.memory.utilization",
            AggregationType.Avg,
            { state: "used" },
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "system.cpu.load_average.1m",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "system.processes.count",
            AggregationType.Avg,
            { status: "running" },
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: fsUsageAggregate,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: networkAggregate,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: processFallbackAggregate,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: heartbeatAggregate,
        }),
      ]);

      const getBucketTimestamp: (p: AggregatedModel) => number = (
        p: AggregatedModel,
      ): number => {
        /*
         * AggregatedModel exposes the bucket timestamp on `timestamp`.
         * The MV statement aliases its time column to `time`, so
         * depending on the path either field may be populated — read
         * whichever is present so we never silently drop rows.
         */
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

      const meanFromBuckets: (
        result: AggregatedResult,
        scale: number,
      ) => number | null = (
        result: AggregatedResult,
        scale: number,
      ): number | null => {
        const points: Array<AggregatedModel> = result.data || [];
        if (points.length === 0) {
          return null;
        }
        const tileWindowStartMs: number = tileWindowStart.getTime();
        let sum: number = 0;
        let count: number = 0;
        for (const p of points) {
          /*
           * The chart query pulls CHART_WINDOW_MINUTES of buckets but
           * the tile should still reflect the recent-window mean
           * (TILE_WINDOW_MINUTES). Filter older buckets out here so
           * the displayed tile value matches what users saw before
           * charts were added. Fall back to the full window if no
           * bucket is recent enough — rare but keeps the tile from
           * going blank for hosts emitting slow.
           */
          const t: number = getBucketTimestamp(p);
          if (Number.isFinite(t) && t < tileWindowStartMs) {
            continue;
          }
          const v: number = Number(p["value"]);
          if (!Number.isFinite(v)) {
            continue;
          }
          sum += v;
          count++;
        }
        if (count === 0) {
          for (const p of points) {
            const v: number = Number(p["value"]);
            if (!Number.isFinite(v)) {
              continue;
            }
            sum += v;
            count++;
          }
        }
        if (count === 0) {
          return null;
        }
        return (sum / count) * scale;
      };

      const latestFromBuckets: (result: AggregatedResult) => number | null = (
        result: AggregatedResult,
      ): number | null => {
        const points: Array<AggregatedModel> = result.data || [];
        let latestTime: number = -Infinity;
        let latestVal: number | null = null;
        for (const p of points) {
          const v: number = Number(p["value"]);
          if (!Number.isFinite(v)) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          if (Number.isFinite(t) && t > latestTime) {
            latestTime = t;
            latestVal = v;
          }
        }
        return latestVal;
      };

      type TimeValuePoint = { x: Date; y: number };

      const seriesFromBuckets: (
        result: AggregatedResult,
        scale: number,
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
        scale: number,
      ): Array<TimeValuePoint> => {
        const out: Array<TimeValuePoint> = [];
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          out.push({ x: new Date(t), y: v * scale });
        }
        out.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return out;
      };

      const sumSeriesByTimestamp: (
        seriesA: Array<TimeValuePoint>,
        seriesB: Array<TimeValuePoint>,
      ) => Array<TimeValuePoint> = (
        seriesA: Array<TimeValuePoint>,
        seriesB: Array<TimeValuePoint>,
      ): Array<TimeValuePoint> => {
        /*
         * CPU% on the tile is `user + system`. For the chart we want
         * the same combined series. Each side is already on the same
         * 1-min bucket grid (the aggregator uses uniform intervals),
         * but a state may be missing from a bucket on a slow host —
         * merge by timestamp instead of zipping by index so a
         * missing system or user point doesn't shift the rest of the
         * line by one slot.
         */
        const byTime: Map<number, number> = new Map<number, number>();
        for (const p of seriesA) {
          byTime.set(p.x.getTime(), (byTime.get(p.x.getTime()) || 0) + p.y);
        }
        for (const p of seriesB) {
          byTime.set(p.x.getTime(), (byTime.get(p.x.getTime()) || 0) + p.y);
        }
        const merged: Array<TimeValuePoint> = [];
        for (const [t, y] of byTime.entries()) {
          merged.push({ x: new Date(t), y: y });
        }
        merged.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return merged;
      };

      /*
       * `system.filesystem.usage` rows come back as one entry per
       * (time bucket × mountpoint × device × state). Average each
       * (mountpoint, state) across buckets — a 5-min window of a
       * gauge is essentially flat, so the avg matches what `df`
       * reports right now. Total capacity is used + free + reserved;
       * any mount missing both used and free is dropped (typically
       * pseudo-fs the OS reports without size, e.g. `tmpfs` of 0 B).
       */
      type StateBucket = { sum: number; count: number };
      const mountAggregation: Map<
        string,
        {
          device: string | null;
          type: string | null;
          byState: Map<string, StateBucket>;
        }
      > = new Map();

      for (const point of fsUsageResult.data || []) {
        const attrs: Record<string, unknown> =
          (point["attributes"] as Record<string, unknown>) || {};
        const mountpoint: string = (attrs["mountpoint"] as string) || "";
        const state: string = (attrs["state"] as string) || "";
        const value: number = Number(point["value"]);

        if (!mountpoint || !state || !Number.isFinite(value)) {
          continue;
        }

        let entry:
          | {
              device: string | null;
              type: string | null;
              byState: Map<string, StateBucket>;
            }
          | undefined = mountAggregation.get(mountpoint);

        if (!entry) {
          entry = {
            device: (attrs["device"] as string) || null,
            type: (attrs["type"] as string) || null,
            byState: new Map<string, StateBucket>(),
          };
          mountAggregation.set(mountpoint, entry);
        }

        let bucket: StateBucket | undefined = entry.byState.get(state);
        if (!bucket) {
          bucket = { sum: 0, count: 0 };
          entry.byState.set(state, bucket);
        }
        bucket.sum += value;
        bucket.count += 1;
      }

      const avgFor: (
        byState: Map<string, StateBucket>,
        state: string,
      ) => number = (
        byState: Map<string, StateBucket>,
        state: string,
      ): number => {
        const acc: StateBucket | undefined = byState.get(state);
        if (!acc || acc.count === 0) {
          return 0;
        }
        return acc.sum / acc.count;
      };

      const mountList: Array<MountInfo> = [];
      for (const [mountpoint, info] of mountAggregation.entries()) {
        const used: number = avgFor(info.byState, "used");
        const free: number = avgFor(info.byState, "free");
        const reserved: number = avgFor(info.byState, "reserved");
        const total: number = used + free + reserved;
        if (total <= 0) {
          continue;
        }
        mountList.push({
          mountpoint: mountpoint,
          device: info.device,
          type: info.type,
          totalBytes: total,
          usedBytes: used,
          utilizationPercent: (used / total) * 100,
        });
      }
      mountList.sort((a: MountInfo, b: MountInfo): number => {
        return b.totalBytes - a.totalBytes;
      });
      setMounts(mountList);

      /*
       * Filesystem tile reads from the largest mount by capacity
       * (mountList is sorted desc on totalBytes), so the tile works
       * regardless of OS — Linux hosts get `/`, Windows hosts get
       * `C:`. The previous hardcoded `mountpoint=/` filter left the
       * tile blank on Windows even though the Filesystems table
       * below it rendered fine. `null` when no mount produced a
       * non-zero capacity.
       */
      const largestMount: MountInfo | undefined = mountList[0];
      const filesystemPercent: number | null = largestMount
        ? largestMount.utilizationPercent
        : null;

      /*
       * CPU busy fraction = user + system. Each piece is itself an
       * average of per-cpu/per-state datapoints over the 5-min
       * window, so summing two means is fine; the alternative
       * (`1 - idle`) would also work but breaks if `idle` ever
       * stops being emitted.
       */
      const cpuUserPct: number | null = meanFromBuckets(cpuUserResult, 100);
      const cpuSystemPct: number | null = meanFromBuckets(cpuSystemResult, 100);
      const cpuPct: number | null =
        cpuUserPct === null && cpuSystemPct === null
          ? null
          : (cpuUserPct ?? 0) + (cpuSystemPct ?? 0);

      /*
       * `system.processes.count` only fires from the `processes`
       * hostmetrics scraper, which is Linux-only. On Windows the
       * `process` scraper still emits per-process metrics, so we
       * fall back to counting distinct PIDs from
       * `process.cpu.utilization` over the tile window. The
       * fallback gives total active processes rather than just
       * `running` — Windows doesn't expose the state breakdown —
       * which is still useful and labelled the same way.
       */
      let runningProcessCount: number | null =
        latestFromBuckets(runningProcResult);
      if (runningProcessCount === null) {
        const pids: Set<string> = new Set<string>();
        for (const p of processFallbackResult.data || []) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          const pid: unknown = attrs["resource.process.pid"];
          if (pid !== undefined && pid !== null && String(pid) !== "") {
            pids.add(String(pid));
          }
        }
        if (pids.size > 0) {
          runningProcessCount = pids.size;
        }
      }

      setStats({
        cpuPercent: cpuPct,
        memoryPercent: meanFromBuckets(memResult, 100),
        filesystemPercent: filesystemPercent,
        load1m: latestFromBuckets(loadResult),
        runningProcessCount: runningProcessCount,
      });

      const cpuUserSeries: Array<TimeValuePoint> = seriesFromBuckets(
        cpuUserResult,
        100,
      );
      const cpuSystemSeries: Array<TimeValuePoint> = seriesFromBuckets(
        cpuSystemResult,
        100,
      );
      const cpuTotalSeries: Array<TimeValuePoint> = sumSeriesByTimestamp(
        cpuUserSeries,
        cpuSystemSeries,
      );
      const memoryUsedSeries: Array<TimeValuePoint> = seriesFromBuckets(
        memResult,
        100,
      );

      /*
       * Disk-utilization chart series tracks the same mount the tile
       * shows (largest by capacity). We walk fsUsageResult bucket by
       * bucket for that mountpoint, summing used + free + reserved
       * per bucket to recover total capacity at that moment, then
       * divide used by total. Doing this in the client avoids a
       * second mountpoint-specific query — the per-mount data is
       * already in fsUsageResult thanks to groupBy attributes.
       */
      const largestMountSeries: Array<TimeValuePoint> = (() => {
        if (!largestMount) {
          return [];
        }
        const buckets: Map<number, Map<string, number>> = new Map();
        for (const p of fsUsageResult.data || []) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          if (attrs["mountpoint"] !== largestMount.mountpoint) {
            continue;
          }
          const state: string = (attrs["state"] as string) || "";
          if (!state) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let perState: Map<string, number> | undefined = buckets.get(t);
          if (!perState) {
            perState = new Map<string, number>();
            buckets.set(t, perState);
          }
          perState.set(state, (perState.get(state) || 0) + v);
        }
        const out: Array<TimeValuePoint> = [];
        for (const [t, perState] of buckets.entries()) {
          const used: number = perState.get("used") || 0;
          const free: number = perState.get("free") || 0;
          const reserved: number = perState.get("reserved") || 0;
          const total: number = used + free + reserved;
          if (total <= 0) {
            continue;
          }
          out.push({ x: new Date(t), y: (used / total) * 100 });
        }
        out.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return out;
      })();

      /*
       * `system.network.io` is a cumulative byte counter per (device,
       * direction). Convert to a per-bucket rate by computing deltas
       * between consecutive bucket values per device + direction,
       * clamping negative deltas to 0 (handles counter resets when
       * the agent restarts or a NIC re-attaches), then summing the
       * positive deltas across devices per direction per bucket. The
       * result is bytes/sec aggregated across all NICs — one "In"
       * line and one "Out" line on the chart.
       */
      const networkSeriesByDirection: {
        receive: Map<number, number>;
        transmit: Map<number, number>;
      } = {
        receive: new Map<number, number>(),
        transmit: new Map<number, number>(),
      };
      const perDeviceDirection: Map<
        string,
        Array<{ t: number; v: number }>
      > = new Map();
      for (const p of networkResult.data || []) {
        const attrs: Record<string, unknown> =
          (p["attributes"] as Record<string, unknown>) || {};
        const device: string = (attrs["device"] as string) || "";
        const direction: string = (attrs["direction"] as string) || "";
        if (!device || (direction !== "receive" && direction !== "transmit")) {
          continue;
        }
        const t: number = getBucketTimestamp(p);
        const v: number = Number(p["value"]);
        if (!Number.isFinite(t) || !Number.isFinite(v)) {
          continue;
        }
        const key: string = `${device}|${direction}`;
        let arr: Array<{ t: number; v: number }> | undefined =
          perDeviceDirection.get(key);
        if (!arr) {
          arr = [];
          perDeviceDirection.set(key, arr);
        }
        arr.push({ t, v });
      }
      for (const [key, arr] of perDeviceDirection.entries()) {
        const direction: "receive" | "transmit" = key.endsWith("|transmit")
          ? "transmit"
          : "receive";
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
          const bucket: Map<number, number> =
            networkSeriesByDirection[direction];
          bucket.set(cur.t, (bucket.get(cur.t) || 0) + rate);
        }
      }
      const networkInPoints: Array<TimeValuePoint> = Array.from(
        networkSeriesByDirection.receive.entries(),
      )
        .map(([t, v]: [number, number]): TimeValuePoint => {
          return { x: new Date(t), y: v };
        })
        .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
      const networkOutPoints: Array<TimeValuePoint> = Array.from(
        networkSeriesByDirection.transmit.entries(),
      )
        .map(([t, v]: [number, number]): TimeValuePoint => {
          return { x: new Date(t), y: v };
        })
        .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });

      setCpuSeries(
        cpuTotalSeries.length > 0
          ? [{ seriesName: "CPU %", data: cpuTotalSeries }]
          : [],
      );
      setMemorySeries(
        memoryUsedSeries.length > 0
          ? [{ seriesName: "Memory %", data: memoryUsedSeries }]
          : [],
      );
      setDiskSeries(
        largestMountSeries.length > 0
          ? [{ seriesName: "Disk %", data: largestMountSeries }]
          : [],
      );
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
       * Availability is a step series at 100% when the bucket
       * contains any heartbeat and 0% when it doesn't. ClickHouse
       * returns rows only for buckets with data, so we have to
       * synthesize the zero-buckets ourselves — infer the bucket
       * size from the smallest gap between present buckets (defaults
       * to 60s, matching the aggregator's <=3h grid), align the grid
       * to a present bucket so the present points sit exactly on the
       * grid, then walk start→end filling in 0 wherever the bucket
       * is missing. The overall uptime % we surface in the card
       * header is the fraction of grid buckets that had heartbeats.
       */
      const heartbeatRows: Array<{ t: number; count: number }> = [];
      for (const p of heartbeatResult.data || []) {
        const t: number = getBucketTimestamp(p);
        const c: number = Number(p["value"]);
        if (Number.isFinite(t) && Number.isFinite(c) && c > 0) {
          heartbeatRows.push({ t, count: c });
        }
      }
      heartbeatRows.sort(
        (
          a: { t: number; count: number },
          b: { t: number; count: number },
        ): number => {
          return a.t - b.t;
        },
      );

      let bucketMs: number = 60_000;
      if (heartbeatRows.length >= 2) {
        let smallest: number = Number.POSITIVE_INFINITY;
        for (let i: number = 1; i < heartbeatRows.length; i++) {
          const d: number = heartbeatRows[i]!.t - heartbeatRows[i - 1]!.t;
          if (d > 0 && d < smallest) {
            smallest = d;
          }
        }
        if (Number.isFinite(smallest)) {
          bucketMs = smallest;
        }
      }

      const presentBuckets: Set<number> = new Set<number>(
        heartbeatRows.map((r: { t: number; count: number }): number => {
          return r.t;
        }),
      );
      const windowStartMs: number = startDate.getTime();
      const windowEndMs: number = endDate.getTime();
      const anchorMs: number =
        heartbeatRows.length > 0 ? heartbeatRows[0]!.t : windowStartMs;
      const stepsBack: number = Math.ceil(
        (anchorMs - windowStartMs) / bucketMs,
      );
      const gridStartMs: number = anchorMs - stepsBack * bucketMs;

      const availabilityPoints: Array<TimeValuePoint> = [];
      let presentCount: number = 0;
      let totalCount: number = 0;
      for (let t: number = gridStartMs; t <= windowEndMs; t += bucketMs) {
        if (t < windowStartMs) {
          continue;
        }
        const up: boolean = presentBuckets.has(t);
        availabilityPoints.push({ x: new Date(t), y: up ? 100 : 0 });
        if (up) {
          presentCount++;
        }
        totalCount++;
      }
      setAvailabilitySeries(
        availabilityPoints.length > 0
          ? [{ seriesName: "Up", data: availabilityPoints }]
          : [],
      );
      setAvailabilityPct(
        totalCount > 0 ? (presentCount / totalCount) * 100 : null,
      );

      setChartWindow({ start: startDate, end: endDate });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      setStatsError(API.getFriendlyMessage(err));
    }
    setIsRefreshing(false);
    setIsInitialLoading(false);
  };

  /*
   * Keep a stable ref to fetchStats. The interval re-arms whenever
   * `autoRefreshInterval` changes, so without the ref the timer would
   * fire the original closure with a stale state setter and rebuilt
   * dependencies. The ref pattern lets us swap intervals without
   * tearing down/refetching on every render.
   */
  const fetchStatsRef: React.MutableRefObject<PromiseVoidFunction> =
    useRef<PromiseVoidFunction>(fetchStats);
  fetchStatsRef.current = fetchStats;

  useEffect(() => {
    fetchStatsRef.current().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
    /*
     * Re-fetch whenever the user picks a different time range. The
     * picker hands a fresh object each click so React's identity
     * compare always triggers; CUSTOM ranges still re-fetch when the
     * user tweaks the start/end inputs because that also yields a
     * new object reference.
     */
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
      "Untitled host";

    const hostIdentifier: string =
      (host.hostIdentifier as string | undefined) || "";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

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
    if (host.hostArch) {
      specChips.push({
        icon: IconProp.Cube,
        label: String(host.hostArch),
      });
    }
    if (host.cpuCores !== undefined && host.cpuCores !== null) {
      const cores: number = Number(host.cpuCores);
      specChips.push({
        icon: IconProp.ChartBar,
        label: `${cores} core${cores === 1 ? "" : "s"}`,
      });
    }
    if (host.totalMemoryBytes !== undefined && host.totalMemoryBytes !== null) {
      specChips.push({
        icon: IconProp.SquareStack,
        label: formatMemoryBytes(Number(host.totalMemoryBytes)),
      });
    }
    if (host.containerRuntime) {
      specChips.push({
        icon: IconProp.ServerStack,
        label: String(host.containerRuntime),
      });
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
        {/*
         * `overflow-hidden` belongs on the gradient layer, not the
         * card itself — the time-range picker dropdown renders out
         * of the hero and would otherwise get clipped by the card's
         * rounded bounds. Clipping only the gradient layer keeps the
         * rounded corners crisp without trapping floating menus.
         */}
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-indigo-200 shadow-sm">
                  <Icon
                    icon={IconProp.Server}
                    className="h-6 w-6 text-indigo-600"
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

    const cores: number | undefined = host?.cpuCores ?? undefined;
    const totalMem: number | undefined = host?.totalMemoryBytes ?? undefined;
    const totalProcessCount: number | null =
      host?.processCount !== undefined && host?.processCount !== null
        ? Number(host.processCount)
        : null;
    const runningProcessCount: number | null = s.runningProcessCount;

    const cpuSublabel: string | undefined =
      cores !== undefined
        ? `across ${cores} core${cores === 1 ? "" : "s"}`
        : undefined;
    const memSublabel: string | undefined =
      totalMem !== undefined ? `of ${formatMemoryBytes(totalMem)}` : undefined;

    /*
     * Load average isn't a percent — it's the average number of
     * runnable + IO-waiting processes. To make the bar meaningful
     * we normalize by core count: load / cores * 100. >100 % means
     * the system has more demand than CPU capacity.
     */
    const loadSaturationPct: number | null =
      cores && cores > 0 && s.load1m !== null ? (s.load1m / cores) * 100 : null;

    const loadSublabel: string | undefined = (() => {
      if (loadSaturationPct !== null && cores !== undefined) {
        return `${Math.round(loadSaturationPct)}% of ${cores} core${
          cores === 1 ? "" : "s"
        }`;
      }
      if (cores !== undefined) {
        return `across ${cores} core${cores === 1 ? "" : "s"}`;
      }
      return undefined;
    })();

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          title="CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.cpuPercent)}
          sublabel={cpuSublabel}
          percent={s.cpuPercent}
        />
        <MetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.memoryPercent)}
          sublabel={memSublabel}
          percent={s.memoryPercent}
        />
        <MetricTile
          title="Filesystem"
          icon={IconProp.Cube}
          iconColor="amber"
          value={formatPercent(s.filesystemPercent)}
          sublabel="largest mount"
          percent={s.filesystemPercent}
          thresholds={{ warn: 75, danger: 90 }}
        />
        <MetricTile
          title="Load avg (1m)"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={formatNumber(s.load1m)}
          sublabel={loadSublabel}
          percent={loadSaturationPct}
          thresholds={{ warn: 70, danger: 100 }}
        />
        <MetricTile
          title="Processes"
          icon={IconProp.List}
          iconColor="slate"
          value={formatInt(runningProcessCount)}
          sublabel={(() => {
            if (runningProcessCount === null) {
              return undefined;
            }
            if (totalProcessCount !== null) {
              return `running · ${totalProcessCount} total`;
            }
            return "running";
          })()}
        />
      </div>
    );
  };

  const renderCrossLinks: () => ReactElement = (): ReactElement => {
    if (!host) {
      return <Fragment />;
    }

    const dockerHostId: ObjectID | undefined = host.dockerHostId
      ? new ObjectID(host.dockerHostId.toString())
      : undefined;
    const k8sClusterId: ObjectID | undefined = host.kubernetesClusterId
      ? new ObjectID(host.kubernetesClusterId.toString())
      : undefined;

    if (!dockerHostId && !k8sClusterId) {
      return <Fragment />;
    }

    const dockerRoute: Route | null = dockerHostId
      ? RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
          { modelId: dockerHostId },
        )
      : null;

    const k8sRoute: Route | null = k8sClusterId
      ? RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
          { modelId: k8sClusterId },
        )
      : null;

    return (
      <Card
        title="Linked Resources"
        description="Other OneUptime resources that describe this same host."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {dockerRoute && (
            <Link
              to={dockerRoute}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="text-sm font-semibold text-gray-900">
                Docker Host
              </div>
              <div className="text-xs text-gray-500">
                Containers, container metrics, and Docker-specific logs.
              </div>
            </Link>
          )}
          {k8sRoute && (
            <Link
              to={k8sRoute}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="text-sm font-semibold text-gray-900">
                Kubernetes Cluster
              </div>
              <div className="text-xs text-gray-500">
                Cluster nodes, pods, and namespaces this host belongs to.
              </div>
            </Link>
          )}
        </div>
      </Card>
    );
  };

  const renderMounts: () => ReactElement = (): ReactElement => {
    if (isInitialLoading) {
      return <Fragment />;
    }

    if (statsError) {
      return <Fragment />;
    }

    const mountList: Array<MountInfo> = mounts || [];
    if (mountList.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title="Filesystems"
          description="Mount points reported by the host with capacity and utilization."
        >
          <div className="border-t border-gray-200 -m-6 -mt-2">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Mount
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Device
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      Used / Total
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3"
                    >
                      Utilization
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {mountList.map((m: MountInfo): ReactElement => {
                    const pct: number = Math.min(
                      100,
                      Math.max(0, m.utilizationPercent),
                    );
                    const barColor: string =
                      pct >= 90
                        ? "bg-red-500"
                        : pct >= 75
                          ? "bg-amber-500"
                          : "bg-emerald-500";
                    return (
                      <tr key={m.mountpoint}>
                        <td className="px-4 py-3 text-sm font-mono text-gray-900 break-all">
                          {m.mountpoint}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {m.type ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 text-xs font-medium ring-1 ring-inset ring-slate-200">
                              {m.type}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-700 break-all">
                          {m.device || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 whitespace-nowrap tabular-nums">
                          <span className="text-gray-900 font-medium">
                            {formatMemoryBytes(m.usedBytes)}
                          </span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span>{formatMemoryBytes(m.totalBytes)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                              <div
                                className={`${barColor} h-1.5 rounded-full transition-all`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-600 w-12 text-right tabular-nums">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const renderChartCard: (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    curve?: ChartCurve;
    headerExtra?: ReactElement;
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald";
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
          syncid={`host-overview-${modelId.toString()}`}
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

    /*
     * Bytes/sec formatter is shared between the y-axis ticks and the
     * tooltip — using ValueFormatter keeps the scaled unit consistent
     * with what Metrics tab and dashboards display (e.g. "1.5 MB/s"
     * instead of raw byte counts).
     */
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

    /*
     * Availability y-axis is binary — 0% (silent) or 100% (alive).
     * The Up/Down labels read more naturally on a step chart than
     * the percentages, and we still surface the numeric uptime % in
     * the card header for users who want a single-number summary.
     */
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
                Resource usage
              </h2>
              <p className="text-xs text-gray-500">
                Aggregated over the selected time range
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {renderChartCard({
              title: "CPU",
              icon: IconProp.ChartBar,
              iconColor: "blue",
              data: cpuSeries,
            })}
            {renderChartCard({
              title: "Memory",
              icon: IconProp.SquareStack,
              iconColor: "violet",
              data: memorySeries,
            })}
            {renderChartCard({
              title: "Disk space",
              icon: IconProp.Cube,
              iconColor: "amber",
              data: diskSeries,
            })}
            {renderChartCard({
              title: "Network",
              icon: IconProp.Wifi,
              iconColor: "emerald",
              data: networkSeries,
              yAxis: networkYAxis,
              showLegend: networkSeries.length > 1,
            })}
          </div>
        </div>
      </Fragment>
    );
  };

  const renderRefreshControl: () => ReactElement = (): ReactElement => {
    const intervals: Array<AutoRefreshInterval> = [
      AutoRefreshInterval.OFF,
      AutoRefreshInterval.THIRTY_SECONDS,
      AutoRefreshInterval.ONE_MINUTE,
      AutoRefreshInterval.FIVE_MINUTES,
      AutoRefreshInterval.FIFTEEN_MINUTES,
    ];

    const lastRefreshedLabel: string = lastRefreshedAt
      ? `Updated ${OneUptimeDate.fromNow(lastRefreshedAt)}`
      : "Not refreshed yet";

    const isOff: boolean = autoRefreshInterval === AutoRefreshInterval.OFF;

    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <TelemetryTimeRangePicker
            value={timeRange}
            onChange={(value: RangeStartAndEndDateTime): void => {
              setTimeRange(value);
            }}
          />
          <button
            type="button"
            onClick={onManualRefresh}
            disabled={isRefreshing}
            title="Refresh now"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon
              icon={IconProp.Refresh}
              className={`h-3.5 w-3.5 ${
                isRefreshing ? "animate-spin text-gray-400" : "text-gray-500"
              }`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="hidden sm:inline">Auto-refresh</span>
            <select
              value={autoRefreshInterval}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                onAutoRefreshIntervalChange(
                  e.target.value as AutoRefreshInterval,
                );
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              {intervals.map((interval: AutoRefreshInterval): ReactElement => {
                return (
                  <option key={interval} value={interval}>
                    {interval === AutoRefreshInterval.OFF
                      ? "Off"
                      : `Every ${getAutoRefreshIntervalLabel(interval)}`}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isRefreshing
                ? "bg-amber-500 animate-pulse"
                : isOff
                  ? "bg-gray-300"
                  : "bg-emerald-500"
            }`}
          />
          <span>{lastRefreshedLabel}</span>
        </div>
      </div>
    );
  };

  const renderOsTypeChip: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
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
  };

  const renderArchChip: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
    const arch: string | undefined =
      (item.hostArch as string | undefined) ?? undefined;
    if (!arch) {
      return <span className="text-sm text-gray-400">—</span>;
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 text-xs font-mono ring-1 ring-inset ring-gray-200">
        {arch}
      </span>
    );
  };

  const renderIpAddresses: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
    return <IpAddressList text={(item.hostIpAddresses as string) || ""} />;
  };

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryCards()}
      {renderCharts()}
      <div className="mb-6">{renderCrossLinks()}</div>
      {renderMounts()}

      {host && (
        <div className="flex flex-col gap-x-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <Card
              title="Identification"
              description="How this host is named and classified."
            >
              <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                <Detail<Host>
                  id="host-identification"
                  item={host}
                  fields={
                    [
                      {
                        key: "name",
                        title: "Name",
                        fieldType: FieldType.Text,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.name);
                        },
                      },
                      {
                        key: "hostIdentifier",
                        title: "Host Identifier",
                        fieldType: FieldType.Text,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.hostIdentifier);
                        },
                      },
                      {
                        key: "description",
                        title: "Description",
                        fieldType: FieldType.Text,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.description);
                        },
                      },
                      {
                        key: "hostType",
                        title: "Host Type",
                        fieldType: FieldType.Text,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.hostType);
                        },
                      },
                    ] as Array<DetailField<Host>>
                  }
                />
              </div>
            </Card>

            <Card
              title="Hardware & Runtime"
              description="CPU, memory, processes, and container runtime."
            >
              <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                <Detail<Host>
                  id="host-hardware"
                  item={host}
                  showDetailsInNumberOfColumns={2}
                  fields={
                    [
                      {
                        key: "cpuCores",
                        title: "CPU Cores",
                        fieldType: FieldType.Element,
                        getElement: (item: Host): ReactElement => {
                          const cores: number | undefined =
                            (item.cpuCores as number | undefined) ?? undefined;
                          if (cores === undefined || cores === null) {
                            return (
                              <span className="text-sm text-gray-400">—</span>
                            );
                          }
                          return (
                            <span className="text-sm text-gray-900">
                              {cores} core{cores === 1 ? "" : "s"}
                            </span>
                          );
                        },
                        showIf: (item: Host): boolean => {
                          return (
                            item.cpuCores !== undefined &&
                            item.cpuCores !== null
                          );
                        },
                      },
                      {
                        key: "totalMemoryBytes",
                        title: "Total Memory",
                        fieldType: FieldType.Element,
                        getElement: (item: Host): ReactElement => {
                          const bytes: number | undefined =
                            (item.totalMemoryBytes as number | undefined) ??
                            undefined;
                          return (
                            <span className="text-sm text-gray-900">
                              {formatMemoryBytes(bytes)}
                            </span>
                          );
                        },
                        showIf: (item: Host): boolean => {
                          return (
                            item.totalMemoryBytes !== undefined &&
                            item.totalMemoryBytes !== null
                          );
                        },
                      },
                      {
                        key: "processCount",
                        title: "Process Count (cached)",
                        fieldType: FieldType.Number,
                        showIf: (item: Host): boolean => {
                          return (
                            item.processCount !== undefined &&
                            item.processCount !== null
                          );
                        },
                      },
                      {
                        key: "containerRuntime",
                        title: "Container Runtime",
                        fieldType: FieldType.Text,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.containerRuntime);
                        },
                      },
                    ] as Array<DetailField<Host>>
                  }
                />
              </div>
            </Card>
          </div>

          <div className="min-w-0 flex-1">
            <Card
              title="Operating System"
              description="Operating system details reported by the agent."
            >
              <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                <Detail<Host>
                  id="host-os"
                  item={host}
                  fields={
                    [
                      {
                        key: "osType",
                        title: "OS Type",
                        fieldType: FieldType.Element,
                        getElement: renderOsTypeChip,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.osType);
                        },
                      },
                      {
                        key: "osVersion",
                        title: "OS Version",
                        fieldType: FieldType.Element,
                        getElement: (item: Host): ReactElement => {
                          const osVersion: string | undefined =
                            (item.osVersion as string | undefined) ?? undefined;
                          if (!osVersion) {
                            return (
                              <span className="text-sm text-gray-400">—</span>
                            );
                          }
                          return <OsVersionDisplay text={osVersion} />;
                        },
                        showIf: (item: Host): boolean => {
                          return Boolean(item.osVersion);
                        },
                      },
                      {
                        key: "hostArch",
                        title: "Architecture",
                        fieldType: FieldType.Element,
                        getElement: renderArchChip,
                        showIf: (item: Host): boolean => {
                          return Boolean(item.hostArch);
                        },
                      },
                    ] as Array<DetailField<Host>>
                  }
                />
              </div>
            </Card>

            {host.hostIpAddresses ? (
              <Card
                title="Network"
                description="IP addresses observed on this host."
              >
                <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                  <Detail<Host>
                    id="host-network"
                    item={host}
                    fields={
                      [
                        {
                          key: "hostIpAddresses",
                          title: "IP Addresses",
                          fieldType: FieldType.Element,
                          getElement: renderIpAddresses,
                        },
                      ] as Array<DetailField<Host>>
                    }
                  />
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </Fragment>
  );
};

export default HostOverview;
