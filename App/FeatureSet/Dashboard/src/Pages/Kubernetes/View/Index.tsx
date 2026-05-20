import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Card from "Common/UI/Components/Card/Card";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import {
  fetchClusterWarningEvents,
  KubernetesEvent,
} from "../Utils/KubernetesObjectFetcher";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import OneUptimeDate from "Common/Types/Date";
import StackedProgressBar, {
  type StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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

interface ResourceLink {
  title: string;
  description: string;
  pageMap: PageMap;
  count?: number | undefined;
  icon: IconProp;
  iconBgClass: string;
  iconTextClass: string;
}

interface GoldenStats {
  cpuPercent: number | null;
  memoryBytes: number | null;
  filesystemPercent: number | null;
  networkInBytesPerSec: number | null;
  networkOutBytesPerSec: number | null;
}

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
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

const formatBytesPerSec: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return ValueFormatter.formatValue(value, "By/s");
};

interface GoldenMetricTileProps {
  title: string;
  icon: IconProp;
  iconColor: "blue" | "violet" | "amber" | "emerald" | "slate" | "sky";
  value: string;
  sublabel?: string | undefined;
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
}

const tileColorClasses: Record<
  GoldenMetricTileProps["iconColor"],
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

const GoldenMetricTile: FunctionComponent<GoldenMetricTileProps> = (
  props: GoldenMetricTileProps,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    tileColorClasses[props.iconColor];

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

const TILE_WINDOW_MINUTES: number = 5;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "kubernetes-overview-auto-refresh-interval";

function formatRelativeTime(timestamp: string): string {
  try {
    const eventDate: Date = new Date(timestamp);
    const now: Date = new Date();
    const diffMs: number = now.getTime() - eventDate.getTime();
    const diffMins: number = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      return "just now";
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours: number = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays: number = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return timestamp;
  }
}

const KubernetesClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  /*
   * Per-section loaders so the page paints as soon as cluster metadata
   * arrives, then each section swaps its spinner for real data as its
   * request resolves. `isLoading` only gates the page shell (the
   * cluster metadata request); the three section loaders gate their
   * respective independent fetches.
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(true);
  const [isTopPodsLoading, setIsTopPodsLoading] = useState<boolean>(true);
  const [isWarningsLoading, setIsWarningsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [nodeCount, setNodeCount] = useState<number>(0);
  const [podCount, setPodCount] = useState<number>(0);
  const [namespaceCount, setNamespaceCount] = useState<number>(0);
  const [deploymentCount, setDeploymentCount] = useState<number>(0);
  const [statefulSetCount, setStatefulSetCount] = useState<number>(0);
  const [daemonSetCount, setDaemonSetCount] = useState<number>(0);
  const [jobCount, setJobCount] = useState<number>(0);
  const [cronJobCount, setCronJobCount] = useState<number>(0);
  const [containerCount, setContainerCount] = useState<number>(0);
  const [pvcCount, setPvcCount] = useState<number>(0);
  const [pvCount, setPvCount] = useState<number>(0);
  const [podHealthSummary, setPodHealthSummary] = useState<{
    running: number;
    pending: number;
    failed: number;
    succeeded: number;
  }>({ running: 0, pending: 0, failed: 0, succeeded: 0 });
  const [nodeHealthSummary, setNodeHealthSummary] = useState<{
    ready: number;
    notReady: number;
  }>({ ready: 0, notReady: 0 });
  const [clusterHealth, setClusterHealth] = useState<
    "Healthy" | "Degraded" | "Unhealthy"
  >("Healthy");
  const [topCpuPods, setTopCpuPods] = useState<Array<KubernetesResource>>([]);
  const [topMemoryPods, setTopMemoryPods] = useState<Array<KubernetesResource>>(
    [],
  );
  const [recentWarnings, setRecentWarnings] = useState<Array<KubernetesEvent>>(
    [],
  );
  const [nodePressure, setNodePressure] = useState<{
    memoryPressure: number;
    diskPressure: number;
    pidPressure: number;
  }>({ memoryPressure: 0, diskPressure: 0, pidPressure: 0 });
  const [degradedPods, setDegradedPods] = useState<
    Array<{
      name: string;
      namespace: string;
      phase: string;
      reason: string;
      message: string;
    }>
  >([]);
  const [degradedNodes, setDegradedNodes] = useState<
    Array<{
      name: string;
      isReady: boolean;
      hasMemoryPressure: boolean;
      hasDiskPressure: boolean;
      hasPidPressure: boolean;
      reason: string;
      message: string;
    }>
  >([]);

  // Golden metrics state — independent of the inventory summary.
  const [goldenStats, setGoldenStats] = useState<GoldenStats | null>(null);
  const [isGoldenLoading, setIsGoldenLoading] = useState<boolean>(true);
  const [goldenError, setGoldenError] = useState<string>("");
  const [cpuSeries, setCpuSeries] = useState<Array<SeriesPoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<SeriesPoint>>([]);
  const [filesystemSeries, setFilesystemSeries] = useState<Array<SeriesPoint>>(
    [],
  );
  const [networkSeries, setNetworkSeries] = useState<Array<SeriesPoint>>([]);
  const [availabilitySeries, setAvailabilitySeries] = useState<
    Array<SeriesPoint>
  >([]);
  const [availabilityPct, setAvailabilityPct] = useState<number | null>(null);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
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

  const loadSummary: (clusterId: ObjectID) => Promise<void> = async (
    clusterId: ObjectID,
  ): Promise<void> => {
    try {
      const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
        .addRoute("/kubernetes-resource/inventory-summary/")
        .addRoute(clusterId.toString());

      const summaryResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: summaryUrl,
          data: {},
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });
      if (summaryResponse instanceof HTTPErrorResponse) {
        throw summaryResponse;
      }
      const summary: JSONObject = summaryResponse.data;

      const readNum: (k: string) => number = (k: string): number => {
        const v: unknown = summary[k];
        return typeof v === "number" ? v : 0;
      };

      setNodeCount(readNum("nodeCount"));
      setPodCount(readNum("podCount"));
      setNamespaceCount(readNum("namespaceCount"));
      setDeploymentCount(readNum("deploymentCount"));
      setStatefulSetCount(readNum("statefulSetCount"));
      setDaemonSetCount(readNum("daemonSetCount"));
      setJobCount(readNum("jobCount"));
      setCronJobCount(readNum("cronJobCount"));
      setPvcCount(readNum("pvcCount"));
      setPvCount(readNum("pvCount"));
      setContainerCount(readNum("containerCount"));

      const podPhase: JSONObject =
        (summary["podPhaseCounts"] as JSONObject) || {};
      const running: number =
        typeof podPhase["running"] === "number" ? podPhase["running"] : 0;
      const pending: number =
        typeof podPhase["pending"] === "number" ? podPhase["pending"] : 0;
      const failed: number =
        typeof podPhase["failed"] === "number" ? podPhase["failed"] : 0;
      const succeeded: number =
        typeof podPhase["succeeded"] === "number" ? podPhase["succeeded"] : 0;
      setPodHealthSummary({ running, pending, failed, succeeded });

      const nodeReady: JSONObject =
        (summary["nodeReadyCounts"] as JSONObject) || {};
      const ready: number =
        typeof nodeReady["ready"] === "number" ? nodeReady["ready"] : 0;
      const notReady: number =
        typeof nodeReady["notReady"] === "number" ? nodeReady["notReady"] : 0;
      setNodeHealthSummary({ ready, notReady });

      const pressure: JSONObject =
        (summary["nodePressureCounts"] as JSONObject) || {};
      const memoryPressure: number =
        typeof pressure["memoryPressure"] === "number"
          ? pressure["memoryPressure"]
          : 0;
      const diskPressure: number =
        typeof pressure["diskPressure"] === "number"
          ? pressure["diskPressure"]
          : 0;
      const pidPressure: number =
        typeof pressure["pidPressure"] === "number"
          ? pressure["pidPressure"]
          : 0;
      setNodePressure({ memoryPressure, diskPressure, pidPressure });

      const degradedPodsRaw: unknown = summary["degradedPods"];
      if (Array.isArray(degradedPodsRaw)) {
        setDegradedPods(
          degradedPodsRaw.map((p: unknown) => {
            const item: Record<string, unknown> =
              (p as Record<string, unknown>) || {};
            return {
              name: typeof item["name"] === "string" ? item["name"] : "",
              namespace:
                typeof item["namespace"] === "string" ? item["namespace"] : "",
              phase: typeof item["phase"] === "string" ? item["phase"] : "",
              reason: typeof item["reason"] === "string" ? item["reason"] : "",
              message:
                typeof item["message"] === "string" ? item["message"] : "",
            };
          }),
        );
      } else {
        setDegradedPods([]);
      }

      const degradedNodesRaw: unknown = summary["degradedNodes"];
      if (Array.isArray(degradedNodesRaw)) {
        setDegradedNodes(
          degradedNodesRaw.map((n: unknown) => {
            const item: Record<string, unknown> =
              (n as Record<string, unknown>) || {};
            return {
              name: typeof item["name"] === "string" ? item["name"] : "",
              isReady: item["isReady"] === true,
              hasMemoryPressure: item["hasMemoryPressure"] === true,
              hasDiskPressure: item["hasDiskPressure"] === true,
              hasPidPressure: item["hasPidPressure"] === true,
              reason: typeof item["reason"] === "string" ? item["reason"] : "",
              message:
                typeof item["message"] === "string" ? item["message"] : "",
            };
          }),
        );
      } else {
        setDegradedNodes([]);
      }

      if (failed > 0 || notReady > 0) {
        setClusterHealth("Unhealthy");
      } else if (
        pending > 0 ||
        memoryPressure > 0 ||
        diskPressure > 0 ||
        pidPressure > 0
      ) {
        setClusterHealth("Degraded");
      } else {
        setClusterHealth("Healthy");
      }
    } catch {
      // Inventory summary is best-effort; leave counts at 0.
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const loadTopPods: (clusterIdentifier: string) => Promise<void> = async (
    clusterIdentifier: string,
  ): Promise<void> => {
    try {
      const pods: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: clusterIdentifier,
          metricName: "k8s.pod.cpu.utilization",
          resourceNameAttribute: "resource.k8s.pod.name",
          memoryMetricName: "k8s.pod.memory.usage",
        });

      const sortedByCpu: Array<KubernetesResource> = [...pods]
        .filter((p: KubernetesResource) => {
          return p.cpuUtilization !== null && p.cpuUtilization !== undefined;
        })
        .sort((a: KubernetesResource, b: KubernetesResource) => {
          return (b.cpuUtilization ?? 0) - (a.cpuUtilization ?? 0);
        })
        .slice(0, 5);
      setTopCpuPods(sortedByCpu);

      const sortedByMemory: Array<KubernetesResource> = [...pods]
        .filter((p: KubernetesResource) => {
          return (
            p.memoryUsageBytes !== null && p.memoryUsageBytes !== undefined
          );
        })
        .sort((a: KubernetesResource, b: KubernetesResource) => {
          return (b.memoryUsageBytes ?? 0) - (a.memoryUsageBytes ?? 0);
        })
        .slice(0, 5);
      setTopMemoryPods(sortedByMemory);
    } catch {
      // Top-N is supplementary; leave lists empty on failure.
    } finally {
      setIsTopPodsLoading(false);
    }
  };

  const loadWarnings: (clusterIdentifier: string) => Promise<void> = async (
    clusterIdentifier: string,
  ): Promise<void> => {
    try {
      const warnings: Array<KubernetesEvent> = await fetchClusterWarningEvents({
        clusterIdentifier: clusterIdentifier,
        limit: 5,
      });
      setRecentWarnings(warnings);
    } catch {
      // Warnings are supplementary.
    } finally {
      setIsWarningsLoading(false);
    }
  };

  /*
   * Golden cluster metrics — aggregate across all nodes for the
   * selected time range. CPU is an OTel `.utilization` ratio so we
   * multiply by 100. Memory and filesystem live in absolute bytes
   * client-side. Filesystem turns into a percent because
   * `k8s.node.filesystem.available` is also emitted, so
   * usage / (usage + available) is a clean per-node fraction we can
   * then average. Network counters are cumulative — we delta them
   * client-side to get rates.
   */
  const loadGoldenMetrics: (
    clusterIdentifier: string,
  ) => Promise<void> = async (clusterIdentifier: string): Promise<void> => {
    setIsRefreshing(true);
    setGoldenError("");
    try {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;
      const tileWindowStart: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -TILE_WINDOW_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const baseAttributes: Record<string, string> = {
        "resource.k8s.cluster.name": clusterIdentifier,
      };

      const buildAggregateBy: (
        metricName: string,
        aggType: AggregationType,
      ) => AggregateBy<Metric> = (
        metricName: string,
        aggType: AggregationType,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: { ...baseAttributes },
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

      const cpuAgg: AggregateBy<Metric> = buildAggregateBy(
        "k8s.node.cpu.utilization",
        AggregationType.Avg,
      );
      /*
       * Grouping by attributes preserves the node dimension so we
       * can average per-bucket across nodes client-side.
       */
      cpuAgg.groupBy = { attributes: true };

      const memAgg: AggregateBy<Metric> = buildAggregateBy(
        "k8s.node.memory.usage",
        AggregationType.Avg,
      );
      memAgg.groupBy = { attributes: true };

      const fsUsageAgg: AggregateBy<Metric> = buildAggregateBy(
        "k8s.node.filesystem.usage",
        AggregationType.Avg,
      );
      fsUsageAgg.groupBy = { attributes: true };

      const fsAvailableAgg: AggregateBy<Metric> = buildAggregateBy(
        "k8s.node.filesystem.available",
        AggregationType.Avg,
      );
      fsAvailableAgg.groupBy = { attributes: true };

      /*
       * kubeletstats v0.96 ships network IO as a single
       * `k8s.node.network.io` counter with `direction` attribute
       * (receive | transmit) per (node, interface). One query, then
       * split client-side on direction. The split-name variants
       * (`.receive` / `.transmit`) we used initially do not exist in
       * the schema — every chart was empty as a result.
       */
      const networkAgg: AggregateBy<Metric> = buildAggregateBy(
        "k8s.node.network.io",
        AggregationType.Max,
      );
      networkAgg.groupBy = { attributes: true };

      const heartbeatAgg: AggregateBy<Metric> = buildAggregateBy(
        "oneuptime.host.heartbeat",
        AggregationType.Count,
      );

      const [
        cpuResult,
        memResult,
        fsUsageResult,
        fsAvailableResult,
        networkResult,
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
          aggregateBy: cpuAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: memAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: fsUsageAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: fsAvailableAgg,
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: networkAgg,
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
       * Average per-bucket across nodes. A bucket's value is the
       * mean of every (node, mount, device, ...) datapoint in it —
       * for CPU and memory that collapses to "average node",
       * which is the closest single number to "how busy is the
       * cluster" without a true cluster-level metric.
       */
      const meanPerBucket: (
        result: AggregatedResult,
        scale: number,
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
        scale: number,
      ): Array<TimeValuePoint> => {
        const perBucket: Map<number, { sum: number; count: number }> =
          new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let entry: { sum: number; count: number } | undefined =
            perBucket.get(t);
          if (!entry) {
            entry = { sum: 0, count: 0 };
            perBucket.set(t, entry);
          }
          entry.sum += v;
          entry.count += 1;
        }
        const out: Array<TimeValuePoint> = [];
        for (const [t, e] of perBucket.entries()) {
          if (e.count === 0) {
            continue;
          }
          out.push({ x: new Date(t), y: (e.sum / e.count) * scale });
        }
        out.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return out;
      };

      /*
       * Total per-bucket across nodes — sum of nodal values per
       * bucket. Used by the memory series so the chart reflects
       * total cluster memory consumption, not just per-node mean.
       */
      const sumPerBucket: (
        result: AggregatedResult,
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
      ): Array<TimeValuePoint> => {
        const perBucket: Map<number, number> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
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

      const cpuPoints: Array<TimeValuePoint> = meanPerBucket(cpuResult, 100);
      const memoryPoints: Array<TimeValuePoint> = sumPerBucket(memResult);

      /*
       * Filesystem utilization = used / (used + available) per
       * (node, mount). We need the two metrics joined by their
       * shared attributes before averaging across nodes — otherwise
       * a node with two mounts double-counts. Join in a Map keyed
       * by (timestamp, node, mount, device) and average per-bucket
       * across the per-mount fractions.
       */
      const fsPoints: Array<TimeValuePoint> = (() => {
        type FsKey = string;
        const usageMap: Map<FsKey, number> = new Map();
        const availableMap: Map<FsKey, number> = new Map();
        const makeKey: (t: number, attrs: Record<string, unknown>) => FsKey = (
          t: number,
          attrs: Record<string, unknown>,
        ): FsKey => {
          const node: string =
            (attrs["resource.k8s.node.name"] as string) || "";
          const mount: string =
            (attrs["mountpoint"] as string) ||
            (attrs["resource.k8s.volume.name"] as string) ||
            "";
          const device: string = (attrs["device"] as string) || "";
          return `${t}|${node}|${mount}|${device}`;
        };
        for (const p of (fsUsageResult.data || []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          usageMap.set(makeKey(t, attrs), v);
        }
        for (const p of (fsAvailableResult.data ||
          []) as Array<AggregatedModel>) {
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          availableMap.set(makeKey(t, attrs), v);
        }
        // Group by bucket, average the per-mount fractions.
        const perBucket: Map<number, { sum: number; count: number }> =
          new Map();
        for (const [key, used] of usageMap.entries()) {
          const available: number | undefined = availableMap.get(key);
          if (available === undefined) {
            continue;
          }
          const total: number = used + available;
          if (total <= 0) {
            continue;
          }
          const t: number = Number(key.split("|")[0]);
          const frac: number = (used / total) * 100;
          let entry: { sum: number; count: number } | undefined =
            perBucket.get(t);
          if (!entry) {
            entry = { sum: 0, count: 0 };
            perBucket.set(t, entry);
          }
          entry.sum += frac;
          entry.count += 1;
        }
        const out: Array<TimeValuePoint> = [];
        for (const [t, e] of perBucket.entries()) {
          if (e.count === 0) {
            continue;
          }
          out.push({ x: new Date(t), y: e.sum / e.count });
        }
        out.sort((a: TimeValuePoint, b: TimeValuePoint): number => {
          return a.x.getTime() - b.x.getTime();
        });
        return out;
      })();

      /*
       * Network — cumulative byte counters per (node, interface,
       * direction). Convert to per-bucket rate by taking deltas
       * between consecutive buckets per series, clamping negatives
       * to 0, and summing rates across (node, interface) per
       * bucket per direction.
       */
      const computeNetRate: (
        result: AggregatedResult,
        direction: "receive" | "transmit",
      ) => Array<TimeValuePoint> = (
        result: AggregatedResult,
        direction: "receive" | "transmit",
      ): Array<TimeValuePoint> => {
        const perKey: Map<string, Array<{ t: number; v: number }>> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          const pointDirection: string =
            (attrs["direction"] as string) || "";
          if (pointDirection !== direction) {
            continue;
          }
          const node: string =
            (attrs["resource.k8s.node.name"] as string) || "";
          const interfaceName: string =
            (attrs["interface"] as string) ||
            (attrs["network.interface"] as string) ||
            "";
          if (!node) {
            continue;
          }
          const key: string = `${node}|${interfaceName}`;
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

      const networkInPoints: Array<TimeValuePoint> = computeNetRate(
        networkResult,
        "receive",
      );
      const networkOutPoints: Array<TimeValuePoint> = computeNetRate(
        networkResult,
        "transmit",
      );

      setCpuSeries(
        cpuPoints.length > 0 ? [{ seriesName: "CPU %", data: cpuPoints }] : [],
      );
      setMemorySeries(
        memoryPoints.length > 0
          ? [{ seriesName: "Memory", data: memoryPoints }]
          : [],
      );
      setFilesystemSeries(
        fsPoints.length > 0
          ? [{ seriesName: "Filesystem %", data: fsPoints }]
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
       * Availability — synthesize zero buckets across the grid so
       * silent periods explicitly render as Down.
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

      const cpuTile: number | null = meanInRecentWindow(cpuPoints);
      const memTile: number | null = meanInRecentWindow(memoryPoints);
      const fsTile: number | null = meanInRecentWindow(fsPoints);
      const netInTile: number | null = meanInRecentWindow(networkInPoints);
      const netOutTile: number | null = meanInRecentWindow(networkOutPoints);

      setGoldenStats({
        cpuPercent: cpuTile,
        memoryBytes: memTile,
        filesystemPercent: fsTile,
        networkInBytesPerSec: netInTile,
        networkOutBytesPerSec: netOutTile,
      });

      setChartWindow({ start: startDate, end: endDate });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      setGoldenError(API.getFriendlyMessage(err));
    } finally {
      setIsRefreshing(false);
      setIsGoldenLoading(false);
    }
  };

  /*
   * Ref pattern so the refresh interval picks up the latest
   * closure (timeRange / cluster identifier) without tearing the
   * timer down on every render.
   */
  const loadGoldenMetricsRef: React.MutableRefObject<
    (clusterIdentifier: string) => Promise<void>
  > = useRef<(clusterIdentifier: string) => Promise<void>>(loadGoldenMetrics);
  loadGoldenMetricsRef.current = loadGoldenMetrics;

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          name: true,
          clusterIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
        },
      });
      setCluster(item);
      setIsLoading(false);

      if (item?.clusterIdentifier) {
        /*
         * Fire all four section fetches independently so each section
         * paints its data as soon as its own request resolves. No
         * Promise.all — we don't want the slowest request to hold back
         * the other sections.
         */
        void loadSummary(modelId);
        void loadTopPods(item.clusterIdentifier);
        void loadWarnings(item.clusterIdentifier);
        void loadGoldenMetricsRef.current(item.clusterIdentifier);
      } else {
        // No cluster identifier means nothing to load from downstream stores.
        setIsSummaryLoading(false);
        setIsTopPodsLoading(false);
        setIsWarningsLoading(false);
        setIsGoldenLoading(false);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
      setIsSummaryLoading(false);
      setIsTopPodsLoading(false);
      setIsWarningsLoading(false);
      setIsGoldenLoading(false);
    }
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Re-fetch golden metrics whenever the user picks a different
   * time range. Cluster metadata stays cached.
   */
  useEffect(() => {
    if (cluster?.clusterIdentifier) {
      void loadGoldenMetricsRef.current(cluster.clusterIdentifier);
    }
    /*
     * We deliberately do not depend on cluster — fetchCluster does
     * the initial run; this effect handles user time-range changes.
     */
  }, [timeRange]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (cluster?.clusterIdentifier) {
        void loadGoldenMetricsRef.current(cluster.clusterIdentifier);
      }
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval, cluster?.clusterIdentifier]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const onManualRefresh: () => void = (): void => {
    if (cluster?.clusterIdentifier) {
      void loadGoldenMetricsRef.current(cluster.clusterIdentifier);
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const workloadLinks: Array<ResourceLink> = [
    {
      title: "Namespaces",
      description: "Logical partitions for resources",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
      count: namespaceCount > 0 ? namespaceCount : undefined,
      icon: IconProp.Folder,
      iconBgClass: "bg-indigo-100",
      iconTextClass: "text-indigo-600",
    },
    {
      title: "Pods",
      description: "Smallest deployable units",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
      count: podCount > 0 ? podCount : undefined,
      icon: IconProp.Circle,
      iconBgClass: "bg-emerald-100",
      iconTextClass: "text-emerald-600",
    },
    {
      title: "Deployments",
      description: "Manage replica sets and rollouts",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
      count: deploymentCount > 0 ? deploymentCount : undefined,
      icon: IconProp.Layers,
      iconBgClass: "bg-blue-100",
      iconTextClass: "text-blue-600",
    },
    {
      title: "StatefulSets",
      description: "Ordered, stateful pod management",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
      count: statefulSetCount > 0 ? statefulSetCount : undefined,
      icon: IconProp.Database,
      iconBgClass: "bg-purple-100",
      iconTextClass: "text-purple-600",
    },
    {
      title: "DaemonSets",
      description: "Run pods on every node",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
      count: daemonSetCount > 0 ? daemonSetCount : undefined,
      icon: IconProp.Settings,
      iconBgClass: "bg-orange-100",
      iconTextClass: "text-orange-600",
    },
    {
      title: "Jobs",
      description: "Run-to-completion workloads",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
      count: jobCount > 0 ? jobCount : undefined,
      icon: IconProp.Play,
      iconBgClass: "bg-amber-100",
      iconTextClass: "text-amber-600",
    },
    {
      title: "CronJobs",
      description: "Scheduled recurring tasks",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
      count: cronJobCount > 0 ? cronJobCount : undefined,
      icon: IconProp.Clock,
      iconBgClass: "bg-teal-100",
      iconTextClass: "text-teal-600",
    },
    {
      title: "Containers",
      description: "Running container instances",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
      count: containerCount > 0 ? containerCount : undefined,
      icon: IconProp.Cube,
      iconBgClass: "bg-cyan-100",
      iconTextClass: "text-cyan-600",
    },
  ];

  const infraLinks: Array<ResourceLink> = [
    {
      title: "Nodes",
      description: "Worker machines in the cluster",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
      count: nodeCount > 0 ? nodeCount : undefined,
      icon: IconProp.Server,
      iconBgClass: "bg-slate-100",
      iconTextClass: "text-slate-600",
    },
    {
      title: "PVCs",
      description: "Persistent volume claims",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PVCS,
      count: pvcCount > 0 ? pvcCount : undefined,
      icon: IconProp.Disc,
      iconBgClass: "bg-rose-100",
      iconTextClass: "text-rose-600",
    },
    {
      title: "PVs",
      description: "Persistent volumes",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PVS,
      count: pvCount > 0 ? pvCount : undefined,
      icon: IconProp.Disc,
      iconBgClass: "bg-fuchsia-100",
      iconTextClass: "text-fuchsia-600",
    },
  ];

  // Build pod health segments for StackedProgressBar
  const podHealthSegments: Array<StackedProgressBarSegment> = [
    {
      value: podHealthSummary.running,
      color: "bg-emerald-500",
      label: "Running",
    },
    {
      value: podHealthSummary.succeeded,
      color: "bg-blue-500",
      label: "Succeeded",
    },
    {
      value: podHealthSummary.pending,
      color: "bg-amber-500",
      label: "Pending",
    },
    {
      value: podHealthSummary.failed,
      color: "bg-red-500",
      label: "Failed",
    },
  ];

  // Build pressure badges
  const pressureBadges: Array<{ count: number; label: string }> = [];
  if (nodePressure.memoryPressure > 0) {
    pressureBadges.push({
      count: nodePressure.memoryPressure,
      label: "Memory Pressure",
    });
  }
  if (nodePressure.diskPressure > 0) {
    pressureBadges.push({
      count: nodePressure.diskPressure,
      label: "Disk Pressure",
    });
  }
  if (nodePressure.pidPressure > 0) {
    pressureBadges.push({
      count: nodePressure.pidPressure,
      label: "PID Pressure",
    });
  }

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

  const renderGoldenMetrics: () => ReactElement = (): ReactElement => {
    if (isGoldenLoading && !goldenStats) {
      return (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_: unknown, idx: number) => {
            return (
              <div
                key={`golden-skeleton-${idx}`}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                <div className="mt-3 h-8 w-24 rounded bg-gray-100 animate-pulse" />
                <div className="mt-2 h-3 w-20 rounded bg-gray-100 animate-pulse" />
                <div className="mt-3 h-1.5 w-full rounded bg-gray-100 animate-pulse" />
              </div>
            );
          })}
        </div>
      );
    }

    if (goldenError) {
      return (
        <div className="mb-6">
          <ErrorMessage message={goldenError} />
        </div>
      );
    }

    const s: GoldenStats | null = goldenStats;
    if (!s) {
      return <Fragment />;
    }

    const netTotal: number | null =
      s.networkInBytesPerSec === null && s.networkOutBytesPerSec === null
        ? null
        : (s.networkInBytesPerSec ?? 0) + (s.networkOutBytesPerSec ?? 0);

    const netSublabel: string | undefined = (() => {
      if (s.networkInBytesPerSec === null && s.networkOutBytesPerSec === null) {
        return undefined;
      }
      return `${formatBytesPerSec(s.networkInBytesPerSec)} in · ${formatBytesPerSec(
        s.networkOutBytesPerSec,
      )} out`;
    })();

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.cpuPercent)}
          sublabel={
            nodeCount > 0
              ? `across ${nodeCount} node${nodeCount === 1 ? "" : "s"}`
              : "across nodes"
          }
          percent={s.cpuPercent}
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatMemoryBytes(s.memoryBytes)}
          sublabel="total across nodes"
        />
        <GoldenMetricTile
          title="Filesystem"
          icon={IconProp.Cube}
          iconColor="amber"
          value={formatPercent(s.filesystemPercent)}
          sublabel="avg across mounts"
          percent={s.filesystemPercent}
          thresholds={{ warn: 75, danger: 90 }}
        />
        <GoldenMetricTile
          title="Network"
          icon={IconProp.Wifi}
          iconColor="sky"
          value={
            netTotal === null
              ? "—"
              : ValueFormatter.formatValue(netTotal, "By/s")
          }
          sublabel={netSublabel}
        />
        <GoldenMetricTile
          title="Availability"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={
            availabilityPct === null
              ? "—"
              : `${availabilityPct.toFixed(availabilityPct >= 99.95 ? 1 : 2)}%`
          }
          sublabel="heartbeat presence"
          percent={availabilityPct}
          thresholds={{ warn: 99, danger: 95 }}
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
      tileColorClasses[params.iconColor];

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
          syncid={`kubernetes-overview-${modelId.toString()}`}
          heightInPx={180}
          showLegend={params.showLegend ?? false}
        />
      </div>
    );
  };

  const renderGoldenCharts: () => ReactElement = (): ReactElement => {
    if (goldenError) {
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
                Per-bucket presence of cluster heartbeats over the selected time
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
                Cluster resource usage
              </h2>
              <p className="text-xs text-gray-500">
                Aggregated across nodes over the selected time range
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
              yAxis: memoryYAxis,
            })}
            {renderChartCard({
              title: "Filesystem",
              icon: IconProp.Cube,
              iconColor: "amber",
              data: filesystemSeries,
            })}
            {renderChartCard({
              title: "Network",
              icon: IconProp.Wifi,
              iconColor: "sky",
              data: networkSeries,
              yAxis: networkYAxis,
              showLegend: networkSeries.length > 1,
            })}
          </div>
        </div>
      </Fragment>
    );
  };

  const renderResourceLinks: (links: Array<ResourceLink>) => ReactElement = (
    links: Array<ResourceLink>,
  ): ReactElement => {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-4 pr-4 pl-1">
        {links.map((link: ResourceLink) => {
          return (
            <div
              key={link.title}
              onClick={() => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[link.pageMap] as Route,
                    { modelId: modelId },
                  ),
                );
              }}
              className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 group cursor-pointer"
            >
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${link.iconBgClass}`}
              >
                <Icon
                  icon={link.icon}
                  className={`h-5 w-5 ${link.iconTextClass}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 group-hover:text-indigo-700 flex items-center justify-between">
                  <span>{link.title}</span>
                  {link.count !== undefined && (
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700">
                      {link.count}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {link.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!cluster) {
      return null;
    }

    const status: string = (cluster.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = cluster.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (cluster.name as string | undefined) ||
      (cluster.clusterIdentifier as string | undefined) ||
      "Untitled cluster";

    const clusterIdentifier: string =
      (cluster.clusterIdentifier as string | undefined) || "";

    const connectionBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const connectionDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const connectionLabel: string = isConnected
      ? "Connected"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Disconnected";

    const healthBadgeClass: string =
      clusterHealth === "Healthy"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : clusterHealth === "Degraded"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-red-50 text-red-700 ring-red-200";
    const healthDotClass: string =
      clusterHealth === "Healthy"
        ? "bg-emerald-500"
        : clusterHealth === "Degraded"
          ? "bg-amber-500"
          : "bg-red-500";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];
    if (nodeCount > 0) {
      specChips.push({
        icon: IconProp.Server,
        label: `${nodeCount} node${nodeCount === 1 ? "" : "s"}`,
      });
    }
    if (podCount > 0) {
      specChips.push({
        icon: IconProp.Circle,
        label: `${podCount} pod${podCount === 1 ? "" : "s"}`,
      });
    }
    if (namespaceCount > 0) {
      specChips.push({
        icon: IconProp.Folder,
        label: `${namespaceCount} namespace${namespaceCount === 1 ? "" : "s"}`,
      });
    }
    if (deploymentCount > 0) {
      specChips.push({
        icon: IconProp.Layers,
        label: `${deploymentCount} deployment${deploymentCount === 1 ? "" : "s"}`,
      });
    }
    if (containerCount > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${containerCount} container${containerCount === 1 ? "" : "s"}`,
      });
    }

    const podStatusChips: Array<{
      label: string;
      value: number;
      colorClass: string;
    }> = [];
    if (podHealthSummary.running > 0) {
      podStatusChips.push({
        label: "Running",
        value: podHealthSummary.running,
        colorClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      });
    }
    if (podHealthSummary.pending > 0) {
      podStatusChips.push({
        label: "Pending",
        value: podHealthSummary.pending,
        colorClass: "bg-amber-50 text-amber-700 ring-amber-200",
      });
    }
    if (podHealthSummary.failed > 0) {
      podStatusChips.push({
        label: "Failed",
        value: podHealthSummary.failed,
        colorClass: "bg-red-50 text-red-700 ring-red-200",
      });
    }
    if (nodeHealthSummary.notReady > 0) {
      podStatusChips.push({
        label: "Nodes Not Ready",
        value: nodeHealthSummary.notReady,
        colorClass: "bg-red-50 text-red-700 ring-red-200",
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        {/*
         * `overflow-hidden` belongs on the gradient layer, not the
         * card itself — the time-range picker dropdown renders out
         * of the hero and would otherwise get clipped by the card's
         * rounded bounds.
         */}
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-violet-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-violet-200 shadow-sm">
                  <Icon
                    icon={IconProp.Kubernetes}
                    className="h-6 w-6 text-violet-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${connectionBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${connectionDotClass}`}
                      />
                      {connectionLabel}
                    </span>
                    {!isSummaryLoading && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                        />
                        {clusterHealth}
                      </span>
                    )}
                  </div>
                  {clusterIdentifier && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {clusterIdentifier}
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

            {podStatusChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {podStatusChips.map(
                  (
                    chip: {
                      label: string;
                      value: number;
                      colorClass: string;
                    },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`pod-${idx}`}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${chip.colorClass}`}
                      >
                        <span className="font-semibold">{chip.value}</span>
                        {chip.label}
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

  return (
    <Fragment>
      {renderHero()}

      {/* Golden metrics — at-a-glance cluster health */}
      {renderGoldenMetrics()}

      {/* Golden charts — availability + cluster resource usage */}
      {renderGoldenCharts()}

      {/* Why is this cluster degraded? */}
      {clusterHealth !== "Healthy" &&
        (degradedPods.length > 0 || degradedNodes.length > 0) && (
          <Card
            title="Why is this cluster degraded?"
            description="Specific pods and nodes that are driving the current health status. Click through to investigate."
          >
            <div className="divide-y divide-gray-100">
              {degradedNodes.map(
                (
                  node: {
                    name: string;
                    isReady: boolean;
                    hasMemoryPressure: boolean;
                    hasDiskPressure: boolean;
                    hasPidPressure: boolean;
                    reason: string;
                    message: string;
                  },
                  index: number,
                ) => {
                  const pressureLabels: Array<string> = [];
                  if (!node.isReady) {
                    pressureLabels.push("Not Ready");
                  }
                  if (node.hasMemoryPressure) {
                    pressureLabels.push("Memory Pressure");
                  }
                  if (node.hasDiskPressure) {
                    pressureLabels.push("Disk Pressure");
                  }
                  if (node.hasPidPressure) {
                    pressureLabels.push("PID Pressure");
                  }
                  const chipClass: string = !node.isReady
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-amber-50 text-amber-700 border-amber-200";
                  return (
                    <div
                      key={`node-${index}`}
                      onClick={() => {
                        Navigation.navigate(
                          RouteUtil.populateRouteParams(
                            RouteMap[
                              PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL
                            ] as Route,
                            {
                              modelId: modelId,
                              subModelId: new ObjectID(node.name),
                            },
                          ),
                        );
                      }}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                        <Icon
                          icon={IconProp.Server}
                          className="h-3.5 w-3.5 text-red-600"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {node.name}
                          </span>
                          <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-600">
                            Node
                          </span>
                          {pressureLabels.map((label: string) => {
                            return (
                              <span
                                key={label}
                                className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded border ${chipClass}`}
                              >
                                {label}
                              </span>
                            );
                          })}
                          {node.reason && (
                            <span className="inline-flex px-1.5 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-700">
                              {node.reason}
                            </span>
                          )}
                        </div>
                        {node.message && (
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {node.message}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                },
              )}

              {degradedPods.map(
                (
                  pod: {
                    name: string;
                    namespace: string;
                    phase: string;
                    reason: string;
                    message: string;
                  },
                  index: number,
                ) => {
                  const isFailed: boolean = pod.phase === "Failed";
                  const phaseChipClass: string = isFailed
                    ? "bg-red-100 text-red-700"
                    : pod.phase === "Pending"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-700";
                  const iconBgClass: string = isFailed
                    ? "bg-red-100"
                    : "bg-amber-100";
                  const iconColorClass: string = isFailed
                    ? "text-red-600"
                    : "text-amber-600";
                  return (
                    <div
                      key={`pod-${index}`}
                      onClick={() => {
                        Navigation.navigate(
                          RouteUtil.populateRouteParams(
                            RouteMap[
                              PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL
                            ] as Route,
                            {
                              modelId: modelId,
                              subModelId: new ObjectID(pod.name),
                            },
                          ),
                        );
                      }}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <div
                        className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-full ${iconBgClass} flex items-center justify-center`}
                      >
                        <Icon
                          icon={IconProp.Circle}
                          className={`h-3.5 w-3.5 ${iconColorClass}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {pod.name}
                          </span>
                          {pod.namespace && (
                            <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-50 text-indigo-600">
                              {pod.namespace}
                            </span>
                          )}
                          <span
                            className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${phaseChipClass}`}
                          >
                            {pod.phase}
                          </span>
                          {pod.reason && (
                            <span
                              className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded ${
                                isFailed
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {pod.reason}
                            </span>
                          )}
                        </div>
                        {pod.message ? (
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {pod.message}
                          </p>
                        ) : (
                          !pod.reason && (
                            <p className="text-sm text-gray-400 italic">
                              No reason reported yet — click to inspect the pod.
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        )}

      {/* Summary Cards — show a subtle placeholder for each value while
          the inventory summary is loading. Agent Status comes from
          cluster metadata and is always available at this point. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <InfoCard
          title="Cluster Health"
          value={
            isSummaryLoading ? (
              <span className="text-2xl font-semibold text-gray-300">…</span>
            ) : (
              <span
                className={`text-2xl font-semibold ${
                  clusterHealth === "Healthy"
                    ? "text-emerald-600"
                    : clusterHealth === "Degraded"
                      ? "text-amber-600"
                      : "text-red-600"
                }`}
              >
                {clusterHealth}
              </span>
            )
          }
        />
        <InfoCard
          title="Nodes"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODES] as Route,
                { modelId: modelId },
              ),
            );
          }}
          value={
            isSummaryLoading ? (
              <span className="text-2xl font-semibold text-gray-300">…</span>
            ) : (
              <span className="text-2xl font-semibold">
                {nodeCount.toString()}
                {nodeHealthSummary.notReady > 0 && (
                  <span className="text-sm text-red-500 ml-1">
                    ({nodeHealthSummary.notReady} not ready)
                  </span>
                )}
              </span>
            )
          }
        />
        <InfoCard
          title="Pods"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_PODS] as Route,
                { modelId: modelId },
              ),
            );
          }}
          value={
            isSummaryLoading ? (
              <span className="text-2xl font-semibold text-gray-300">…</span>
            ) : (
              <span className="text-2xl font-semibold">
                {podCount.toString()}
              </span>
            )
          }
        />
        <InfoCard
          title="Namespaces"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES] as Route,
                { modelId: modelId },
              ),
            );
          }}
          value={
            isSummaryLoading ? (
              <span className="text-2xl font-semibold text-gray-300">…</span>
            ) : (
              <span className="text-2xl font-semibold">
                {namespaceCount.toString()}
              </span>
            )
          }
        />
        <InfoCard
          title="Agent Status"
          value={
            <StatusBadge
              text={
                cluster.otelCollectorStatus === "connected"
                  ? "Connected"
                  : "Disconnected"
              }
              type={
                cluster.otelCollectorStatus === "connected"
                  ? StatusBadgeType.Success
                  : StatusBadgeType.Danger
              }
            />
          }
        />
      </div>

      {/* Quick Navigation - Workloads */}
      <Card
        title="Workloads"
        description="Explore workload resources in this cluster."
      >
        {isSummaryLoading ? (
          <ComponentLoader />
        ) : (
          renderResourceLinks(workloadLinks)
        )}
      </Card>

      {/* Quick Navigation - Infrastructure */}
      <Card
        title="Infrastructure"
        description="Explore infrastructure resources in this cluster."
      >
        {isSummaryLoading ? (
          <ComponentLoader />
        ) : (
          renderResourceLinks(infraLinks)
        )}
      </Card>

      {/* Node Pressure Indicators */}
      {pressureBadges.length > 0 && (
        <AlertBanner
          title="Node Pressure Detected"
          type={AlertBannerType.Danger}
          className="mb-5"
        >
          <div className="flex gap-3 mt-1">
            {pressureBadges.map((badge: { count: number; label: string }) => {
              return (
                <StatusBadge
                  key={badge.label}
                  text={`${badge.count} node${badge.count > 1 ? "s" : ""}: ${badge.label}`}
                  type={StatusBadgeType.Danger}
                />
              );
            })}
          </div>
        </AlertBanner>
      )}

      {/* Pod Health Visual Breakdown */}
      {podCount > 0 && (
        <Card
          title="Pod Health"
          description="Distribution of pod statuses across the cluster."
        >
          <div className="p-4">
            <StackedProgressBar
              segments={podHealthSegments}
              totalValue={podCount}
            />
          </div>
        </Card>
      )}

      {/* Top Resource Consumers */}
      <Card
        title="Top Resource Consumers"
        description="Pods with the highest resource utilization in this cluster."
      >
        {isTopPodsLoading ? (
          <ComponentLoader />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-gray-100">
            {/* CPU Usage */}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Icon
                    icon={IconProp.CPUChip}
                    className="h-4 w-4 text-blue-600"
                  />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">
                    CPU Usage
                  </h4>
                  <p className="text-xs text-gray-500">Top 5 pods by CPU</p>
                </div>
              </div>
              {topCpuPods.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">
                  No CPU usage data available.
                </p>
              ) : (
                <div className="space-y-3">
                  {topCpuPods.map((pod: KubernetesResource, index: number) => {
                    const pct: number = Math.min(pod.cpuUtilization ?? 0, 100);
                    return (
                      <div
                        key={index}
                        onClick={() => {
                          Navigation.navigate(
                            RouteUtil.populateRouteParams(
                              RouteMap[
                                PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL
                              ] as Route,
                              {
                                modelId: modelId,
                                subModelId: new ObjectID(pod.name),
                              },
                            ),
                          );
                        }}
                        className="group cursor-pointer rounded-lg p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="flex-shrink-0 text-xs font-medium text-gray-400 w-4">
                              {index + 1}.
                            </span>
                            <span className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700">
                              {pod.name}
                            </span>
                            {pod.namespace && (
                              <span className="flex-shrink-0 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-50 text-indigo-600">
                                {pod.namespace}
                              </span>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-sm font-semibold text-gray-700 tabular-nums ml-2">
                            {KubernetesResourceUtils.formatCpuValue(
                              pod.cpuUtilization,
                            )}
                          </span>
                        </div>
                        <div className="pl-6">
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                pct > 80
                                  ? "bg-red-500"
                                  : pct > 60
                                    ? "bg-amber-500"
                                    : "bg-blue-500"
                              }`}
                              style={{
                                width: `${Math.max(pct, 2)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Memory Usage */}
            <div className="p-5 border-t lg:border-t-0 border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Icon
                    icon={IconProp.Database}
                    className="h-4 w-4 text-purple-600"
                  />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">
                    Memory Usage
                  </h4>
                  <p className="text-xs text-gray-500">Top 5 pods by memory</p>
                </div>
              </div>
              {topMemoryPods.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">
                  No memory usage data available.
                </p>
              ) : (
                <div className="space-y-3">
                  {topMemoryPods.map(
                    (pod: KubernetesResource, index: number) => {
                      const maxMemory: number =
                        topMemoryPods[0]?.memoryUsageBytes ?? 1;
                      const memPercent: number =
                        maxMemory > 0
                          ? ((pod.memoryUsageBytes ?? 0) / maxMemory) * 100
                          : 0;
                      return (
                        <div
                          key={index}
                          onClick={() => {
                            Navigation.navigate(
                              RouteUtil.populateRouteParams(
                                RouteMap[
                                  PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL
                                ] as Route,
                                {
                                  modelId: modelId,
                                  subModelId: new ObjectID(pod.name),
                                },
                              ),
                            );
                          }}
                          className="group cursor-pointer rounded-lg p-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="flex-shrink-0 text-xs font-medium text-gray-400 w-4">
                                {index + 1}.
                              </span>
                              <span className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700">
                                {pod.name}
                              </span>
                              {pod.namespace && (
                                <span className="flex-shrink-0 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-50 text-indigo-600">
                                  {pod.namespace}
                                </span>
                              )}
                            </div>
                            <span className="flex-shrink-0 text-sm font-semibold text-gray-700 tabular-nums ml-2">
                              {KubernetesResourceUtils.formatMemoryValue(
                                pod.memoryUsageBytes,
                              )}
                            </span>
                          </div>
                          <div className="pl-6">
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                  memPercent > 85
                                    ? "bg-red-500"
                                    : memPercent > 70
                                      ? "bg-amber-500"
                                      : "bg-purple-500"
                                }`}
                                style={{
                                  width: `${Math.max(memPercent, 2)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Recent Warning Events */}
      {isWarningsLoading ? (
        <Card
          title="Recent Warnings"
          description="Latest warning events from the cluster."
        >
          <ComponentLoader />
        </Card>
      ) : (
        recentWarnings.length > 0 &&
        (() => {
          // Deduplicate warnings by reason+object, keep latest timestamp and count
          const deduped: Array<
            KubernetesEvent & { count: number; latestTime: string }
          > = [];
          const seen: Map<
            string,
            KubernetesEvent & { count: number; latestTime: string }
          > = new Map();

          for (const event of recentWarnings) {
            const dedupeKey: string = `${event.reason}:${event.objectKind}/${event.objectName}:${event.namespace}`;
            const existing:
              | (KubernetesEvent & { count: number; latestTime: string })
              | undefined = seen.get(dedupeKey);
            if (existing) {
              existing.count++;
            } else {
              const entry: KubernetesEvent & {
                count: number;
                latestTime: string;
              } = {
                ...event,
                count: 1,
                latestTime: event.timestamp,
              };
              seen.set(dedupeKey, entry);
              deduped.push(entry);
            }
          }

          return (
            <Card
              title="Recent Warnings"
              description="Latest warning events from the cluster."
            >
              <div className="divide-y divide-gray-100">
                {deduped.map(
                  (
                    event: KubernetesEvent & {
                      count: number;
                      latestTime: string;
                    },
                    index: number,
                  ) => {
                    return (
                      <div
                        key={index}
                        className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                          <Icon
                            icon={IconProp.Alert}
                            className="h-3.5 w-3.5 text-amber-600"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-gray-900">
                              {event.reason}
                            </span>
                            {event.count > 1 && (
                              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">
                                ×{event.count}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                              {formatRelativeTime(event.latestTime)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {event.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                              {event.objectKind}/{event.objectName}
                            </span>
                            <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-50 text-indigo-600">
                              {event.namespace}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
              <div className="px-5 py-3 border-t border-gray-100">
                <span
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS
                        ] as Route,
                        { modelId: modelId },
                      ),
                    );
                  }}
                  className="text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer font-medium"
                >
                  View All Events →
                </span>
              </div>
            </Card>
          );
        })()
      )}

      {/* Cluster Details */}
      <CardModelDetail<KubernetesCluster>
        name="Cluster Details"
        formSteps={[
          {
            title: "Cluster Info",
            id: "cluster-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        cardProps={{
          title: "Cluster Details",
          description: "Basic information about this Kubernetes cluster.",
        }}
        isEditable={true}
        editButtonText="Edit Cluster"
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "cluster-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east",
          },
          {
            field: {
              description: true,
            },
            stepId: "cluster-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production cluster running in US East",
          },
          {
            field: {
              clusterIdentifier: true,
            },
            stepId: "cluster-info",
            title: "Cluster Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east-1",
            description:
              "This should match the clusterName value in your kubernetes-agent Helm chart.",
          },
          {
            field: {
              labels: true,
            },
            stepId: "labels",
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: KubernetesCluster,
          id: "kubernetes-cluster-overview",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Cluster Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                clusterIdentifier: true,
              },
              title: "Cluster Identifier",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
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
              getElement: (item: KubernetesCluster): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterOverview;
