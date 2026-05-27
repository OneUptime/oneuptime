import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
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
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
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

/*
 * The OTel hostmetrics `process` scraper attaches per-process identity
 * (pid, executable name, command, owner) to the *resource*. OneUptime's
 * ingest prefixes resource attributes with `resource.`, so they land in
 * ClickHouse as `resource.process.*` — same convention the Processes
 * list and Docker container pages already use.
 */
const PROCESS_PID_ATTR: string = "resource.process.pid";
const PROCESS_NAME_ATTR: string = "resource.process.executable.name";
const PROCESS_COMMAND_ATTR: string = "resource.process.command";
const PROCESS_OWNER_ATTR: string = "resource.process.owner";

interface ProcessIdentity {
  pid: string;
  executable: string;
  command: string | null;
  user: string | null;
  latestSampleAt: Date | null;
}

interface ProcessStats {
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  virtualMemoryBytes: number | null;
  threads: number | null;
  openFds: number | null;
}

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

const formatBytes: (value: number | null | undefined) => string = (
  value: number | null | undefined,
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = value;
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
 * the chart window is — "what is this process doing right now" is what
 * the tile numbers answer, even when the chart shows a wider range.
 */
const TILE_WINDOW_MINUTES: number = 5;

/*
 * When we don't have an executable.name in the URL we resolve it from
 * the most recent sample over a short lookback. 15 min matches the
 * Processes list — a user clicking "View" on a row should always find
 * the process visible here.
 */
const IDENTITY_LOOKBACK_MINUTES: number = 15;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "host-process-view-auto-refresh-interval";

const HostProcessView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const pid: string = Navigation.getLastParamAsString();

  const [host, setHost] = useState<Host | null>(null);
  const [identity, setIdentity] = useState<ProcessIdentity | null>(null);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [cpuSeries, setCpuSeries] = useState<Array<SeriesPoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<SeriesPoint>>([]);
  const [diskSeries, setDiskSeries] = useState<Array<SeriesPoint>>([]);
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
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          name: true,
          hostIdentifier: true,
          cpuCores: true,
          totalMemoryBytes: true,
          osType: true,
        },
      });

      if (!item?.hostIdentifier) {
        setStatsError("Host not found.");
        setIsRefreshing(false);
        setIsInitialLoading(false);
        return;
      }

      setHost(item);

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;
      const tileWindowStart: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -TILE_WINDOW_MINUTES,
      );

      /*
       * Resolve executable name from the most recent sample for this
       * pid. We use it both to display process identity and to scope
       * subsequent metric queries — a pid is unique on a host at a
       * moment in time, but during a wide chart window the OS could
       * recycle a pid to a different process. Filtering by (pid + exe)
       * keeps us locked to one process.
       */
      const identityLookbackStart: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -IDENTITY_LOOKBACK_MINUTES,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const identityQuery: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: "process.cpu.utilization",
          time: new InBetween<Date>(identityLookbackStart, endDate),
          attributes: {
            "resource.host.name": item.hostIdentifier,
            [PROCESS_PID_ATTR]: pid,
          },
        },
        limit: 1,
        skip: 0,
        select: {
          time: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const identityResult: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(identityQuery);

      let resolvedExecutable: string = "";
      let resolvedCommand: string | null = null;
      let resolvedUser: string | null = null;
      let resolvedLatestSampleAt: Date | null = null;

      if (identityResult.data.length > 0) {
        const sample: Metric = identityResult.data[0]!;
        const attrs: Record<string, unknown> =
          (sample.attributes as Record<string, unknown>) || {};
        resolvedExecutable =
          (attrs[PROCESS_NAME_ATTR] as string | undefined) || "";
        resolvedCommand =
          (attrs[PROCESS_COMMAND_ATTR] as string | undefined) || null;
        resolvedUser =
          (attrs[PROCESS_OWNER_ATTR] as string | undefined) || null;
        if (sample.time) {
          const t: Date = new Date(sample.time as unknown as string | Date);
          if (!Number.isNaN(t.getTime())) {
            resolvedLatestSampleAt = t;
          }
        }
      }

      setIdentity({
        pid: pid,
        executable: resolvedExecutable || "(unknown)",
        command: resolvedCommand,
        user: resolvedUser,
        latestSampleAt: resolvedLatestSampleAt,
      });

      /*
       * Aggregation queries always scope by (host, pid). If we resolved
       * an executable name above, we add it as an extra filter so a
       * recycled pid doesn't smear two processes' values together. If
       * we couldn't resolve a name (no recent samples) we fall back to
       * pid-only and let the chart be empty.
       */
      const processFilter: Record<string, string> = {
        "resource.host.name": item.hostIdentifier as string,
        [PROCESS_PID_ATTR]: pid,
      };
      if (resolvedExecutable) {
        processFilter[PROCESS_NAME_ATTR] = resolvedExecutable;
      }

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
              ...processFilter,
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
       * `process.disk.io` is a cumulative byte counter per direction
       * (read / write). Grouping by attributes lets us split the two
       * directions client-side and convert to a rate (B/s).
       */
      const diskAggregate: AggregateBy<Metric> = buildAggregateBy(
        "process.disk.io",
        AggregationType.Max,
      );
      diskAggregate.groupBy = {
        attributes: true,
      };

      const [
        cpuResult,
        memUsageResult,
        memVirtualResult,
        threadsResult,
        openFdResult,
        diskResult,
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
          aggregateBy: buildAggregateBy(
            "process.cpu.utilization",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "process.memory.usage",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "process.memory.virtual",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy("process.threads", AggregationType.Avg),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "process.open_file_descriptors",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: diskAggregate,
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

      /*
       * `process.cpu.utilization` is a fraction (0..1) on Linux/macOS
       * and percent (0..100) on Windows. The Processes list uses the
       * x100 Linux convention; mirror that here. Windows hosts will
       * show inflated CPU numbers — same caveat the list page has.
       */
      const cpuPercent: number | null = meanFromBuckets(cpuResult, 100);

      const memoryBytes: number | null = meanFromBuckets(memUsageResult, 1);
      const virtualMemoryBytes: number | null = meanFromBuckets(
        memVirtualResult,
        1,
      );

      const totalMemoryBytes: number | null =
        item.totalMemoryBytes !== undefined && item.totalMemoryBytes !== null
          ? Number(item.totalMemoryBytes)
          : null;
      const memoryPercent: number | null =
        memoryBytes !== null &&
        totalMemoryBytes !== null &&
        totalMemoryBytes > 0
          ? (memoryBytes / totalMemoryBytes) * 100
          : null;

      setStats({
        cpuPercent: cpuPercent,
        memoryBytes: memoryBytes,
        memoryPercent: memoryPercent,
        virtualMemoryBytes: virtualMemoryBytes,
        threads: meanFromBuckets(threadsResult, 1),
        openFds: meanFromBuckets(openFdResult, 1),
      });

      const cpuPoints: Array<TimeValuePoint> = seriesFromBuckets(
        cpuResult,
        100,
      );
      const memoryPoints: Array<TimeValuePoint> = seriesFromBuckets(
        memUsageResult,
        1,
      );

      setCpuSeries(
        cpuPoints.length > 0 ? [{ seriesName: "CPU %", data: cpuPoints }] : [],
      );
      setMemorySeries(
        memoryPoints.length > 0
          ? [{ seriesName: "Memory", data: memoryPoints }]
          : [],
      );

      /*
       * `process.disk.io` is a cumulative counter per direction.
       * Convert to a per-bucket rate by computing positive deltas
       * between consecutive bucket values per direction, clamping
       * negatives to 0 (counter resets when the process restarts).
       */
      const perDirection: Map<
        string,
        Array<{ t: number; v: number }>
      > = new Map();
      for (const p of diskResult.data || []) {
        const attrs: Record<string, unknown> =
          (p["attributes"] as Record<string, unknown>) || {};
        const direction: string = (attrs["direction"] as string) || "";
        if (direction !== "read" && direction !== "write") {
          continue;
        }
        const t: number = getBucketTimestamp(p);
        const v: number = Number(p["value"]);
        if (!Number.isFinite(t) || !Number.isFinite(v)) {
          continue;
        }
        let arr: Array<{ t: number; v: number }> | undefined =
          perDirection.get(direction);
        if (!arr) {
          arr = [];
          perDirection.set(direction, arr);
        }
        arr.push({ t, v });
      }

      const ratesByDirection: {
        read: Array<TimeValuePoint>;
        write: Array<TimeValuePoint>;
      } = {
        read: [],
        write: [],
      };
      for (const [direction, arr] of perDirection.entries()) {
        arr.sort(
          (
            a: { t: number; v: number },
            b: { t: number; v: number },
          ): number => {
            return a.t - b.t;
          },
        );
        const out: Array<TimeValuePoint> = [];
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
          out.push({ x: new Date(cur.t), y: Math.max(0, dv) / dtSec });
        }
        if (direction === "read") {
          ratesByDirection.read = out;
        } else {
          ratesByDirection.write = out;
        }
      }

      setDiskSeries(
        [
          ratesByDirection.read.length > 0
            ? { seriesName: "Read", data: ratesByDirection.read }
            : null,
          ratesByDirection.write.length > 0
            ? { seriesName: "Write", data: ratesByDirection.write }
            : null,
        ].filter((s: SeriesPoint | null): s is SeriesPoint => {
          return s !== null;
        }),
      );

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
  }, [timeRange, pid]);

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

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!host || !identity) {
      return null;
    }

    const processesRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_PROCESSES] as Route,
      { modelId: modelId },
    );
    const hostRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW] as Route,
      { modelId: modelId },
    );

    const hostDisplayName: string =
      (host.name as string | undefined) ||
      (host.hostIdentifier as string | undefined) ||
      "host";

    const chips: Array<{ icon: IconProp; label: string }> = [];
    chips.push({ icon: IconProp.Hashtag, label: `pid ${identity.pid}` });
    if (identity.user) {
      chips.push({ icon: IconProp.User, label: identity.user });
    }
    if (identity.latestSampleAt) {
      chips.push({
        icon: IconProp.Clock,
        label: `Last sample ${OneUptimeDate.fromNow(identity.latestSampleAt)}`,
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
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
                    icon={IconProp.Cube}
                    className="h-6 w-6 text-indigo-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {identity.executable}
                    </h1>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    <Link
                      to={processesRoute}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      Processes
                    </Link>
                    <span className="mx-1.5 text-gray-300">/</span>
                    <Link
                      to={hostRoute}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {hostDisplayName}
                    </Link>
                  </div>
                  {identity.command && (
                    <div className="mt-2 max-w-2xl truncate font-mono text-xs text-gray-600">
                      {identity.command}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
                {renderRefreshControl()}
              </div>
            </div>

            {chips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {chips.map(
                  (
                    chip: { icon: IconProp; label: string },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`chip-${idx}`}
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

    const s: ProcessStats | null = stats;
    if (!s) {
      return <Fragment />;
    }

    const cores: number | undefined = host?.cpuCores ?? undefined;
    const totalMem: number | undefined = host?.totalMemoryBytes ?? undefined;

    const cpuSublabel: string | undefined =
      cores !== undefined
        ? `share of ${cores} core${cores === 1 ? "" : "s"}`
        : undefined;

    const memorySublabel: string | undefined = (() => {
      if (s.memoryPercent !== null && totalMem !== undefined) {
        return `${formatPercent(s.memoryPercent)} of ${formatBytes(totalMem)}`;
      }
      if (totalMem !== undefined) {
        return `of ${formatBytes(totalMem)} host memory`;
      }
      return "resident set size";
    })();

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          title="CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.cpuPercent)}
          sublabel={cpuSublabel}
          percent={s.cpuPercent}
        />
        <MetricTile
          title="Memory (RSS)"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatBytes(s.memoryBytes)}
          sublabel={memorySublabel}
          percent={s.memoryPercent}
        />
        <MetricTile
          title="Virtual Memory"
          icon={IconProp.Cube}
          iconColor="amber"
          value={formatBytes(s.virtualMemoryBytes)}
          sublabel="address space"
        />
        <MetricTile
          title="Threads"
          icon={IconProp.List}
          iconColor="slate"
          value={formatInt(s.threads)}
          sublabel={
            s.openFds !== null
              ? `${formatInt(s.openFds)} open fds`
              : "thread count"
          }
        />
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
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    curve?: ChartCurve;
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
        max: "auto",
        formatter: (value: number): string => {
          return `${value.toFixed(1)}%`;
        },
        precision: YAxisPrecision.NoDecimals,
      },
    };

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {params.title}
          </span>
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
          syncid={`host-process-view-${modelId.toString()}-${pid}`}
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

    const memoryYAxis: YAxis = {
      legend: "Bytes",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, "By");
        },
      },
    };

    const diskYAxis: YAxis = {
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

    return (
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Resource usage
            </h2>
            <p className="text-xs text-gray-500">
              Aggregated over the selected time range for this process
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {renderChartCard({
            title: "CPU",
            icon: IconProp.ChartBar,
            iconColor: "blue",
            data: cpuSeries,
          })}
          {renderChartCard({
            title: "Memory (RSS)",
            icon: IconProp.SquareStack,
            iconColor: "violet",
            data: memorySeries,
            yAxis: memoryYAxis,
          })}
          {renderChartCard({
            title: "Disk I/O",
            icon: IconProp.Cube,
            iconColor: "amber",
            data: diskSeries,
            yAxis: diskYAxis,
            showLegend: diskSeries.length > 1,
          })}
        </div>
      </div>
    );
  };

  const renderNoDataNote: () => ReactElement = (): ReactElement => {
    if (isInitialLoading || statsError) {
      return <Fragment />;
    }
    if (
      cpuSeries.length > 0 ||
      memorySeries.length > 0 ||
      diskSeries.length > 0
    ) {
      return <Fragment />;
    }
    return (
      <Card
        title="No process metrics in range"
        description="This process did not emit any samples during the selected time window. Pick a wider time range, or verify the OTel collector's hostmetrics `process` scraper is enabled on this host."
      >
        <Fragment />
      </Card>
    );
  };

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryCards()}
      {renderCharts()}
      {renderNoDataNote()}
    </Fragment>
  );
};

export default HostProcessView;
