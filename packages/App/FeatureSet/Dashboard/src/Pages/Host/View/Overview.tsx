import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import OsVersionDisplay, {
  getOsVersionPrimary,
} from "Common/UI/Components/OsVersionDisplay/OsVersionDisplay";
import IpAddressList from "Common/UI/Components/IpAddressList/IpAddressList";
import FieldType from "Common/UI/Components/Types/FieldType";
import Card from "Common/UI/Components/Card/Card";
import ResourceRecordDetailsCard from "../../../Components/TelemetryResource/ResourceRecordDetailsCard";
import ResourceHeroDescription from "../../../Components/TelemetryResource/ResourceHeroDescription";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getHostConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ResourceSecurityCard from "../../../Components/SecurityConnections/ResourceSecurityCard";
import { OpenStackPlacementOfHost } from "../../../Components/OpenStack/Part/OpenStackPlacementOfHost";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import ResourceAiAgentStatusSummaryCard from "../../../Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import GoldenMetricTile, {
  tileColorClasses,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import { HOST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/HostMetricDescriptions";
import HostFilesystemsTable, {
  HostMount,
} from "../../../Components/Host/HostFilesystemsTable";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
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
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import { withTranslatedSeriesNames } from "Common/UI/Components/Charts/Utils/SeriesNames";
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
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../../Components/TelemetryResource/ResourceHeroLayout";
import {
  ResourceHealth,
  getResourceConnectionLabel,
  getResourceHealthLabel,
} from "../../../Components/TelemetryResource/ResourceHeroStatus";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import {
  figureInSentence,
  withSentenceDigits,
} from "../../../Components/ResourcePart/SentenceDigits";
import ResourcePartAlertsCard from "../../../Components/ResourcePart/ResourcePartAlertsCard";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../../Components/Recommendations/RecommendationFilterUtil";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  HostAlertTemplate,
  getAllHostAlertTemplates,
} from "Common/Types/Monitor/HostAlertTemplates";
import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_MEMORY_CRITICAL_PERCENT,
  HOST_MEMORY_HIGH_PERCENT,
  HostHealthAssessment,
  assessHost,
  isHostReporting,
} from "Common/Types/Host/HostHealth";
import {
  HOST_ATTENTION_CURRENT,
  getHostOwnAttentionItems,
} from "../Utils/HostAttention";
import {
  HOST_CPU_BUSY_PERCENT,
  HOST_LOAD_QUEUING_PERCENT,
  formatHostBytes,
  getHostUptimeSeconds,
  isHostStarting,
} from "../Utils/HostFacts";
import { encodeUnitNameForUrl } from "../Utils/SystemdUnits";
import { getHostCollectorConfigLabel } from "../../../Components/HostCollector/HostCollectorStatus";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import HeartbeatAvailabilityUtil, {
  HeartbeatAvailabilityResult,
} from "Common/Utils/Telemetry/HeartbeatAvailability";
import { ReceivingGap } from "Common/Utils/Telemetry/ReceivingGaps";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import {
  fetchReceivingGaps,
  getNotMonitoredRegions,
} from "../../../Utils/ReceivingGaps";
import ValueFormatter from "Common/Utils/ValueFormatter";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import { formatReaderFigure } from "Common/Types/DateLanguage";

// Every alert OneUptime recommends for a host, as its Recommendations lists.
const HOST_ALERT_TEMPLATE_IDS: Array<string> = getAllHostAlertTemplates().map(
  (template: HostAlertTemplate): string => {
    return template.id;
  },
);

// The five tiles: one a row on a phone, two, three, then five from xl.
export const HOST_OVERVIEW_TILES_GRID_CLASS_NAME: string =
  "mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

interface OverviewStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  // How full the fullest mount is, and which one it is.
  filesystemPercent: number | null;
  filesystemMountpoint: string | null;
  load1m: number | null;
  runningProcessCount: number | null;
}

// One mount point the host reports (HostFilesystemsTable).
type MountInfo = HostMount;

/*
 * A tile's figure in the reader's digits, decimal sign and percent sign
 * ("۹۷٫۵٪" in Persian, "97,5 %" in German), as the sentences under the
 * tiles write theirs; English reads exactly as toFixed wrote it (#7106).
 */
const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return formatReaderFigure(value, { decimals: 1, isPercent: true });
};

const formatNumber: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return formatReaderFigure(value, { decimals: 2 });
};

const formatInt: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return formatReaderFigure(Math.round(value), { decimals: 0 });
};

// Sizes as every host page writes them: "64 GiB", plain bytes whole (HostFacts).
const formatMemoryBytes: (bytes: number | null | undefined) => string =
  formatHostBytes;

/*
 * Tile values use a short recent-window mean regardless of how wide
 * the chart window is — "what's the host doing right now" is what
 * the numbers in the tiles answer, even when the chart is showing a
 * month. `meanFromBuckets` falls back to the full window if no
 * bucket is recent enough so tiles never go blank on slow hosts.
 *
 * It keeps buckets that START inside the window, and past 12 hours a
 * bucket is 15 minutes or wider, so on those ranges the fallback is the
 * usual case, not the exception. HostMetricDescriptions says so in the
 * CPU and Memory tooltips; change the words if this changes.
 */
const TILE_WINDOW_MINUTES: number = 5;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "host-overview-auto-refresh-interval";

const HostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

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
  // When OneUptime itself was not receiving, inside the chart window.
  const [receivingGaps, setReceivingGaps] = useState<Array<ReceivingGap>>([]);
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
  /*
   * Toggled on every auto and manual refresh, so Host Details re-reads the
   * agent's version and what it reports along with the rest of the page.
   */
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);
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

  /*
   * A chart zoom, its reset, the picker and Refresh can each start a fetch
   * while another is still in flight. Only the most recently started one
   * may commit: a slow response for the window the reader just left would
   * otherwise repaint the charts, tiles and Filesystems table with it (a
   * double-click right after a drag is exactly that race).
   */
  const fetchSeqRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * Set while the newest fetch is still running. The auto-refresh timer
   * skips its tick then instead of superseding that fetch with one for the
   * same window: were every fetch to outlast the interval, none would ever
   * land, and the page would sit on skeletons with Refresh spinning.
   */
  const fetchInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    const seq: number = ++fetchSeqRef.current;
    const isStale: () => boolean = (): boolean => {
      return seq !== fetchSeqRef.current;
    };

    fetchInFlightRef.current = true;
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
          agentVersion: true,
          collectorInstanceUid: true,
          collectorRegisteredAt: true,
          // What its health and Needs attention are worked out from.
          createdAt: true,
          collectorConfigStatus: true,
          isCollectorHealthy: true,
          collectorConfig: {
            name: true,
          },
          latestCpuPercent: true,
          latestMemoryPercent: true,
          latestSwapPercent: true,
          latestDiskPercent: true,
          latestDiskMountpoint: true,
          latestInodesPercent: true,
          latestInodesMountpoint: true,
          latestLoadAverage15m: true,
          bootedAt: true,
          failedSystemdUnitCount: true,
          failedSystemdUnits: true,
          readingsUpdatedAt: true,
        },
      });

      if (isStale()) {
        return;
      }

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
      /*
       * When OneUptime itself was not receiving data in this window, asked
       * for alongside the metrics: those stretches are "Not monitored",
       * never "Down" (issue #2825). Never rejects.
       */
      const receivingGapsPromise: Promise<Array<ReceivingGap>> =
        fetchReceivingGaps({ startsAt: startDate, endsAt: endDate });
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
       * this bucket" from "completely silent". How missing rows are
       * rendered (down, bridged jitter, or not-yet-evaluable) is
       * decided by HeartbeatAvailabilityUtil below.
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

      const receivingGapsInWindow: Array<ReceivingGap> =
        await receivingGapsPromise;

      if (isStale()) {
        return;
      }

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
       * reports right now. Size is used + free + reserved, as df's
       * Size; how full a mount is, is used over used + free - df's Use%,
       * the collector's own system.filesystem.utilization and what the
       * host's Needs attention and the Hosts list read (HostReadingsScan):
       * space reserved for root is space nobody else can write. Any mount
       * missing both used and free is dropped (typically pseudo-fs the OS
       * reports without size, e.g. `tmpfs` of 0 B).
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
        if (total <= 0 || used + free <= 0) {
          continue;
        }
        mountList.push({
          mountpoint: mountpoint,
          device: info.device,
          type: info.type,
          totalBytes: total,
          usedBytes: used,
          utilizationPercent: (used / (used + free)) * 100,
        });
      }
      mountList.sort((a: MountInfo, b: MountInfo): number => {
        return b.totalBytes - a.totalBytes;
      });
      setMounts(mountList);

      /*
       * The Filesystem tile reads the fullest mount - whichever is filling
       * up, `/` on one host, `C:` or `/var` on another - so it says what
       * the host's Needs attention and the Hosts list say, and names the
       * mount under the number. The Filesystems table below lists every
       * mount. `null` when no mount produced a non-zero capacity.
       */
      const fullestMount: MountInfo | undefined = mountList.reduce(
        (
          fullest: MountInfo | undefined,
          mount: MountInfo,
        ): MountInfo | undefined => {
          return !fullest ||
            mount.utilizationPercent > fullest.utilizationPercent
            ? mount
            : fullest;
        },
        undefined,
      );
      const filesystemPercent: number | null = fullestMount
        ? fullestMount.utilizationPercent
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
        filesystemMountpoint: fullestMount ? fullestMount.mountpoint : null,
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
       * shows (the fullest). We walk fsUsageResult bucket by bucket for
       * that mountpoint and divide used by used + free per bucket, as
       * the tile does. Doing this in the client avoids a second
       * mountpoint-specific query — the per-mount data is already in
       * fsUsageResult thanks to groupBy attributes.
       */
      const fullestMountSeries: Array<TimeValuePoint> = (() => {
        if (!fullestMount) {
          return [];
        }
        const buckets: Map<number, Map<string, number>> = new Map();
        for (const p of fsUsageResult.data || []) {
          const attrs: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          if (attrs["mountpoint"] !== fullestMount.mountpoint) {
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
          if (used + free <= 0) {
            continue;
          }
          out.push({ x: new Date(t), y: (used / (used + free)) * 100 });
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
        fullestMountSeries.length > 0
          ? [{ seriesName: "Disk %", data: fullestMountSeries }]
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
       * contains any heartbeat and 0% when it doesn't. The shared
       * builder synthesizes the zero-buckets ClickHouse never returns
       * rows for, excludes trailing buckets the ingest pipeline can't
       * have filled yet (so the right edge doesn't flap down/up on
       * every auto-refresh), and bridges single-bucket gaps caused by
       * export jitter. See HeartbeatAvailabilityUtil for the rules.
       */
      const availability: HeartbeatAvailabilityResult =
        HeartbeatAvailabilityUtil.buildAvailabilitySeries({
          heartbeatData: heartbeatResult.data || [],
          windowStart: startDate,
          windowEnd: endDate,
          now: OneUptimeDate.getCurrentDate(),
          receivingGaps: receivingGapsInWindow,
          /*
           * The zone AnalyticsModelAPI.aggregate put on the heartbeat
           * request - the reader's, for day buckets and longer - so its
           * days are walked on the calendar the server cut them on.
           */
          timezone: AggregationIntervalUtil.getReaderTimezone({
            startDate: startDate,
            endDate: endDate,
          }),
        });
      setReceivingGaps(receivingGapsInWindow);
      setAvailabilitySeries(
        availability.points.length > 0
          ? [{ seriesName: "Up", data: availability.points }]
          : [],
      );
      setAvailabilityPct(availability.uptimePercent);

      setChartWindow({ start: startDate, end: endDate });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      if (isStale()) {
        return;
      }
      setStatsError(API.getFriendlyMessage(err));
    } finally {
      // However the newest fetch ended, the timer may start the next one.
      if (!isStale()) {
        fetchInFlightRef.current = false;
      }
    }
    // A superseded fetch leaves the spinner to the fetch that replaced it.
    if (isStale()) {
      return;
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
      // Let a fetch that is still running land (see fetchInFlightRef).
      if (fetchInFlightRef.current) {
        return;
      }
      fetchStatsRef.current().catch((err: Error) => {
        setStatsError(API.getFriendlyMessage(err));
      });
      /*
       * Host Details reads the host again with every load the tick starts,
       * so its agent version and what it reports keep up with the page; a
       * tick that waits for a load still running asks for nothing.
       */
      setDetailsRefresher((prev: boolean) => {
        return !prev;
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
    setDetailsRefresher((prev: boolean) => {
      return !prev;
    });
  };

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!host) {
      return null;
    }

    const status: string = (host.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = host.lastSeenAt;
    /*
     * One whole sentence either way: an English "never" in a translated
     * "Last seen {{time}}" would read in two languages at once.
     */
    const lastSeenText: string = lastSeenAt
      ? translator.translateTemplate("Last seen {{time}}", {
          time: OneUptimeDate.fromNow(lastSeenAt),
        })
      : translator.translateText("Never seen") || "Never seen";

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
        label: translator.translatePlural(
          { one: "{{count}} core", other: "{{count}} cores" },
          cores,
        ),
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
    /*
     * How long it has been up, from when its collector says it started
     * (system.uptime), in the reader's words: "Up 12d 4h".
     */
    const uptimeSeconds: number | null = getHostUptimeSeconds({
      row: host,
      now: new Date(),
    });
    if (uptimeSeconds !== null) {
      specChips.push({
        icon: IconProp.Clock,
        label: translator.translateTemplate(
          "Up {{duration}}",
          {
            duration: composedValue((sentence: Translator): string => {
              return formatDurationCompactInLanguage(
                uptimeSeconds,
                sentence.language,
              );
            }),
          },
          { setsValuesApart: true },
        ),
      });
    }

    /*
     * Its health beside its connection, by the rules its Needs attention
     * card and the Hosts list follow (HostHealth). While it is not
     * reporting, what it last reported is no longer the truth: "Health
     * Unknown", as every hero says it. A host that reports but has sent
     * nothing to judge yet - or never reported at all - shows no health:
     * "Healthy" would be a guess.
     */
    const assessment: HostHealthAssessment = assessHost(host, {
      now: new Date(),
    });

    /*
     * A host OneUptime installed the collector on, still waiting for its
     * first metrics, says "Starting" - as its row in the Hosts list and the
     * "This host is starting" card under the hero say - not an amber
     * "Disconnected" a minute after Add Host. A host set up by hand keeps
     * "Disconnected", which its card explains.
     */
    const isStarting: boolean = isHostStarting({
      row: host,
      now: new Date(),
    });

    const statusBadgeClass: string = isStarting
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : isConnected
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";
    const statusDotClass: string = isStarting
      ? "bg-blue-500"
      : isConnected
        ? "bg-emerald-500"
        : "bg-amber-500";
    const statusLabel: string = getResourceConnectionLabel({
      translator: translator,
      isConnected: isConnected,
      status: status,
      isStarting: isStarting,
    });
    const health: ResourceHealth =
      assessment.state === "unhealthy"
        ? "Unhealthy"
        : assessment.state === "degraded"
          ? "Degraded"
          : "Healthy";
    const showHealth: boolean = assessment.isReporting
      ? assessment.hasFreshReadings || assessment.severity !== null
      : Boolean(host.lastSeenAt);
    const healthLabel: string = getResourceHealthLabel({
      translator: translator,
      health: health,
      isConnected: assessment.isReporting,
    });
    const healthBadgeClass: string = !assessment.isReporting
      ? "bg-gray-50 text-gray-600 ring-gray-200"
      : health === "Healthy"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : health === "Degraded"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-red-50 text-red-700 ring-red-200";
    const healthDotClass: string = !assessment.isReporting
      ? "bg-gray-400"
      : health === "Healthy"
        ? "bg-emerald-500"
        : health === "Degraded"
          ? "bg-amber-500"
          : "bg-red-500";

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
            <div
              data-testid={RESOURCE_HERO_TOP_ROW_TEST_ID}
              className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}
            >
              <div
                data-testid={RESOURCE_HERO_IDENTITY_TEST_ID}
                className={RESOURCE_HERO_IDENTITY_CLASS_NAME}
              >
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
                      data-testid="host-hero-connection"
                      data-starting={isStarting ? "true" : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      {/*
                       * Starting pulses, as the Hosts list's pill does
                       * (Pill's isPulsing); still for anyone who asked
                       * for less motion.
                       */}
                      <span className="relative flex h-1.5 w-1.5">
                        {isStarting ? (
                          <span
                            className={`absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping ${statusDotClass}`}
                          />
                        ) : (
                          <></>
                        )}
                        <span
                          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                        />
                      </span>
                      {statusLabel}
                    </span>
                    {showHealth ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          data-testid="host-hero-health"
                          data-health={assessment.state}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                          />
                          {healthLabel}
                        </span>
                        <InfoTooltip
                          label="Host Health"
                          text={HOST_METRIC_DESCRIPTIONS.hostHealth}
                        />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                  {/*
                   * What the host is, in its owner's words: under its
                   * name, as every resource hero says it. It used to be a
                   * Description row of the Identification card at the
                   * page's foot.
                   */}
                  <ResourceHeroDescription
                    text={host.description as string | undefined}
                  />
                  {hostIdentifier && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {hostIdentifier}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {lastSeenText}
                  </div>
                </div>
              </div>
              <div
                data-testid={RESOURCE_HERO_CONTROLS_TEST_ID}
                className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
              >
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
                        {/*
                         * Each chip reads the way it is written: "64 GiB"
                         * stays "64 GiB" on a Persian page.
                         */}
                        <span className="font-medium">
                          <bdi>{chip.label}</bdi>
                        </span>
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
        ? translator.translatePlural(
            { one: "across {{count}} core", other: "across {{count}} cores" },
            cores,
          )
        : undefined;
    // "of 64 GiB", the size set apart in a Persian sentence.
    const memSublabel: string | undefined =
      totalMem !== undefined
        ? translator.translateTemplate(
            "of {{total}}",
            { total: formatMemoryBytes(totalMem) },
            { setsValuesApart: true },
          )
        : undefined;

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
        return translator.translatePlural(
          {
            one: "{{percent}}% of {{count}} core",
            other: "{{percent}}% of {{count}} cores",
          },
          cores,
          withSentenceDigits({
            percent: String(Math.round(loadSaturationPct)),
          }),
          { setsValuesApart: true },
        );
      }
      return cpuSublabel;
    })();

    /*
     * Each bar is coloured where the Hosts list colours it (HostFacts): a
     * busy CPU amber, never red - a host at work, its load says when work
     * queues; memory amber and red where Needs attention lists it.
     *
     * Five tiles a row only from xl, as a Proxmox cluster's page lays its
     * tiles: at 1024 beside the side menu each was some 110px wide and
     * their titles broke inside the word ("MEMO RY", "PROC ESSES").
     */
    return (
      <div className={HOST_OVERVIEW_TILES_GRID_CLASS_NAME}>
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.cpuPercent)}
          sublabel={cpuSublabel}
          percent={s.cpuPercent}
          thresholds={{
            warn: HOST_CPU_BUSY_PERCENT,
            danger: Number.POSITIVE_INFINITY,
          }}
          description={HOST_METRIC_DESCRIPTIONS.cpu}
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.memoryPercent)}
          sublabel={memSublabel}
          percent={s.memoryPercent}
          thresholds={{
            warn: HOST_MEMORY_HIGH_PERCENT,
            danger: HOST_MEMORY_CRITICAL_PERCENT,
          }}
          description={HOST_METRIC_DESCRIPTIONS.memory}
        />
        {/*
         * The fullest mount, named under its number as the host wrote it
         * (its slashes where they are on a Persian page); amber and red
         * where the host's Needs attention starts to list it.
         */}
        <GoldenMetricTile
          title="Filesystem"
          icon={IconProp.Cube}
          iconColor="amber"
          value={formatPercent(s.filesystemPercent)}
          sublabel={s.filesystemMountpoint || undefined}
          isSublabelAsWritten={true}
          percent={s.filesystemPercent}
          thresholds={{
            warn: HOST_DISK_NEAR_FULL_PERCENT,
            danger: HOST_DISK_FULL_PERCENT,
          }}
          description={HOST_METRIC_DESCRIPTIONS.filesystem}
        />
        {/*
         * Amber once there is more work than cores, never red: the rules
         * call a high load one to look at, never critical, and the host's
         * Needs attention says so in amber.
         */}
        <GoldenMetricTile
          title="Load avg (1m)"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={formatNumber(s.load1m)}
          sublabel={loadSublabel}
          percent={loadSaturationPct}
          thresholds={{
            warn: HOST_LOAD_QUEUING_PERCENT,
            danger: Number.POSITIVE_INFINITY,
          }}
          description={HOST_METRIC_DESCRIPTIONS.loadAverage}
        />
        <GoldenMetricTile
          title="Processes"
          icon={IconProp.List}
          iconColor="slate"
          value={formatInt(runningProcessCount)}
          sublabel={(() => {
            if (runningProcessCount === null) {
              return undefined;
            }
            if (totalProcessCount !== null) {
              return translator.translateTemplate(
                "running · {{total}} total",
                withSentenceDigits({ total: String(totalProcessCount) }),
                { setsValuesApart: true },
              );
            }
            return tx("running");
          })()}
          description={HOST_METRIC_DESCRIPTIONS.processes}
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
                {translator.translateText("Docker Host")}
              </div>
              <div className="text-xs text-gray-500">
                {translator.translateText(
                  "Containers, container metrics, and Docker-specific logs.",
                )}
              </div>
            </Link>
          )}
          {k8sRoute && (
            <Link
              to={k8sRoute}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="text-sm font-semibold text-gray-900">
                {translator.translateText("Kubernetes Cluster")}
              </div>
              <div className="text-xs text-gray-500">
                {translator.translateText(
                  "Cluster nodes, pods, and namespaces this host belongs to.",
                )}
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
        <HostFilesystemsTable
          mounts={mountList}
          formatBytes={formatMemoryBytes}
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
    headerExtra?: ReactElement;
    // What the chart plots, shown in an (i) tooltip beside the title.
    description?: string;
    // Shaded stretches, such as when OneUptime was not monitoring.
    referenceRegions?: Array<ChartReferenceRegionProps>;
    // false breaks the line where it has no points.
    connectNulls?: boolean;
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    curve?: ChartCurve;
    headerExtra?: ReactElement;
    // What the chart plots, shown in an (i) tooltip beside the title.
    description?: string;
    referenceRegions?: Array<ChartReferenceRegionProps>;
    connectNulls?: boolean;
  }): ReactElement => {
    const colors: { bg: string; ring: string; text: string } =
      tileColorClasses[params.iconColor];

    if (!chartWindow) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex min-w-0 items-center gap-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {translator.translateText(params.title)}
              </span>
              <InfoTooltip label={params.title} text={params.description} />
            </div>
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
            <div className="flex min-w-0 items-center gap-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {translator.translateText(params.title)}
              </span>
              <InfoTooltip label={params.title} text={params.description} />
            </div>
            {params.headerExtra ?? null}
          </div>
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
          >
            <Icon icon={params.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
          </div>
        </div>
        <LineChartElement
          data={withTranslatedSeriesNames(params.data, translator)}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={params.curve ?? ChartCurve.MONOTONE}
          sync={true}
          syncid={`host-overview-${modelId.toString()}`}
          heightInPx={180}
          showLegend={params.showLegend ?? false}
          referenceRegions={params.referenceRegions}
          connectNulls={params.connectNulls}
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
        // Up and Down in the reader's words, as the chart's (i) says them.
        formatter: (value: number): string => {
          if (value >= 100) {
            return tx("Up");
          }
          if (value <= 0) {
            return tx("Down");
          }
          return `${Math.round(value)}%`;
        },
      },
    };

    // Time OneUptime itself was not receiving, shaded as Not monitored.
    const notMonitoredRegions: Array<ChartReferenceRegionProps> =
      getNotMonitoredRegions({
        gaps: receivingGaps,
        translator,
      });

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
          {translator.translateTemplate("{{percent}}% uptime", {
            percent: figureInSentence(availabilityPct, {
              decimals: availabilityPct >= 99.95 ? 1 : 2,
            }),
          })}
        </span>
      );

    /*
     * Drag-to-zoom is named once per section, at the right of its heading,
     * while the pointer is anywhere over the section: the chart cards are a
     * few hundred pixels wide, too narrow to hold the hint beside a title
     * and the icon without wrapping the title.
     */
    return (
      <Fragment>
        <div className="group/zoomhint mb-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {translator.translateText("Availability")}
              </h2>
              <p className="text-xs text-gray-500">
                {/*
                 * What the chart shows in plain words, as the Docker and
                 * Podman hosts' pages say it: "Per-bucket presence of host
                 * heartbeats" was the code's own name for it.
                 */}
                {translator.translateText(
                  "Whether metrics arrived from this host, over the selected time range",
                )}
              </p>
            </div>
            <TimeRangeZoomHint revealOnHover={true} />
          </div>
          {renderChartCard({
            title: "Availability",
            icon: IconProp.Heartbeat,
            iconColor: "emerald",
            data: availabilitySeries,
            yAxis: availabilityYAxis,
            curve: ChartCurve.STEP,
            headerExtra: availabilityBadge,
            referenceRegions: notMonitoredRegions,
            connectNulls: false,
            description: HOST_METRIC_DESCRIPTIONS.availabilityChart,
          })}
        </div>
        <div className="group/zoomhint mb-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {translator.translateText("Resource usage")}
              </h2>
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  "Aggregated over the selected time range",
                )}
              </p>
            </div>
            <TimeRangeZoomHint revealOnHover={true} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {renderChartCard({
              title: "CPU",
              icon: IconProp.ChartBar,
              iconColor: "blue",
              data: cpuSeries,
              description: HOST_METRIC_DESCRIPTIONS.cpuChart,
            })}
            {renderChartCard({
              title: "Memory",
              icon: IconProp.SquareStack,
              iconColor: "violet",
              data: memorySeries,
              description: HOST_METRIC_DESCRIPTIONS.memoryChart,
            })}
            {renderChartCard({
              title: "Disk space",
              icon: IconProp.Cube,
              iconColor: "amber",
              data: diskSeries,
              description: HOST_METRIC_DESCRIPTIONS.diskSpaceChart,
            })}
            {renderChartCard({
              title: "Network",
              icon: IconProp.Wifi,
              iconColor: "emerald",
              data: networkSeries,
              yAxis: networkYAxis,
              showLegend: networkSeries.length > 1,
              description: HOST_METRIC_DESCRIPTIONS.networkChart,
            })}
          </div>
        </div>
      </Fragment>
    );
  };

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

  const renderOsTypeChip: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 text-sm font-medium ring-1 ring-inset ring-slate-200 capitalize">
        {String(item.osType)}
      </span>
    );
  };

  const renderArchChip: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 text-xs font-mono ring-1 ring-inset ring-gray-200">
        {String(item.hostArch)}
      </span>
    );
  };

  const renderIpAddresses: (item: Host) => ReactElement = (
    item: Host,
  ): ReactElement => {
    return <IpAddressList text={(item.hostIpAddresses as string) || ""} />;
  };

  /*
   * Issue #4105: a drag on any chart sets the page's range to the window
   * dragged out, so every chart, tile and the Filesystems table refetch for
   * it; a double-click on any chart (or Reset zoom beside the picker in the
   * hero, which is why the scope wraps the whole page) puts the range from
   * before the zoom back. The existing [timeRange] effect does the refetch.
   */
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      {renderHero()}

      {/* How to connect it, while it is not connected */}
      {host ? (
        <ResourceConnectionGuideCard
          status={host.otelCollectorStatus as string | undefined}
          lastSeenAt={host.lastSeenAt}
          guide={getHostConnectionGuide(
            (host.hostIdentifier as string | undefined) ||
              (host.name as string | undefined) ||
              "",
            {
              isManaged: Boolean(host.collectorInstanceUid),
              osType: host.osType,
              registeredAt: host.collectorRegisteredAt,
            },
          )}
          documentationRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOST_VIEW_DOCUMENTATION] as Route,
            { modelId: modelId },
          )}
        />
      ) : (
        <></>
      )}
      {/*
       * What on this host needs someone, the most urgent first, before any
       * number: the host itself ("This host": memory, swap, load), each
       * filesystem, its collector and each failed systemd unit, by the rules
       * the Hosts list follows (HostHealth). Nothing to look at draws no
       * card. A host that is not reporting has the connection card above
       * instead: what it last reported is no longer the truth, and "Not
       * reporting" would only say again what that card says.
       */}
      {host && isHostReporting(host) ? (
        <NeedsAttentionCard
          testId="host-needs-attention"
          items={getHostOwnAttentionItems({
            host: host,
            now: new Date(),
            collectorName: getHostCollectorConfigLabel(
              {
                configName: host.collectorConfig?.name,
                osType: host.osType,
              },
              translator,
            ),
            collectorRoute: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_VIEW_DOCUMENTATION] as Route,
              { modelId: modelId },
            ),
            getUnitRoute: (unitName: string): Route => {
              return RouteUtil.populateRouteParams(
                RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW] as Route,
                {
                  modelId: modelId,
                  subModelId: encodeUnitNameForUrl(unitName),
                },
              );
            },
          })}
          current={HOST_ATTENTION_CURRENT}
        />
      ) : (
        <></>
      )}
      {renderSummaryCards()}
      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="hosts"
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        incidentsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.HOST_VIEW_INCIDENTS] as Route,
          { modelId: modelId },
        )}
        alertsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.HOST_VIEW_ALERTS] as Route,
          { modelId: modelId },
        )}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE] as Route,
          { modelId: modelId },
        )}
      />
      {/*
       * What Security Events found about it this week, for whoever
       * may read it (Components/SecurityConnections).
       */}
      <OpenStackPlacementOfHost hostId={modelId} />
      <ResourceSecurityCard
        kind={SecurityConnectionKind.Host}
        modelId={modelId}
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
      />
      {renderCharts()}
      <div className="mb-6">{renderCrossLinks()}</div>
      {renderMounts()}
      {/*
       * "Will I hear about it when this host is in trouble?": the alerts
       * OneUptime recommends for a host, which are on for this one, and one
       * step to turn on the rest - its Recommendations, with exactly those
       * ticked. After what the host is doing (its numbers, charts and
       * filesystems), before its Details, as a Proxmox node's page puts its
       * alerts: ten rows above the charts pushed them a screen down.
       */}
      {host?.hostIdentifier ? (
        <ResourcePartAlertsCard
          testId="host-alerts"
          title="Host alerts"
          description="The alerts OneUptime recommends for a host: which watch this one, and one step to turn on the rest."
          resourceType={MonitorRecommendationResourceType.Host}
          templateIds={HOST_ALERT_TEMPLATE_IDS}
          resourceId={modelId}
          resourceIdentifier={host.hostIdentifier}
          getRecommendationsRoute={(
            recommendationIds: Array<string>,
          ): Route => {
            return RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_VIEW_RECOMMENDATIONS] as Route,
              { modelId: modelId },
            ).addQueryParams({
              [RECOMMENDATION_SELECTION_QUERY_PARAM]:
                RecommendationFilterUtil.toSelectionQuery(recommendationIds),
            });
          }}
          getMonitorRoute={(monitorId: ObjectID): Route => {
            return RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW] as Route,
              { modelId: monitorId },
            );
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * One Host Details card, as every resource Overview ends with: what
       * the host reported about itself, and only that
       * (ResourceRecordDetailsCard), in two columns. Its name, description
       * and when it was last seen are the hero's, its labels the header's
       * (a phone's own card under this one).
       *
       * It was four cards - Identification, Hardware & Runtime, Operating
       * System and Network - in one column or two, the first repeating the
       * hero's name and description. Edited on the host's Settings page, in
       * the card of the same title. Drawn once the host is read, as those
       * were: a host that is not found has nothing to detail.
       */}
      {host ? (
        <ResourceRecordDetailsCard<Host>
          modelType={Host}
          modelId={modelId}
          id="host-details"
          title="Host Details"
          refresher={detailsRefresher}
          settingsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOST_VIEW_SETTINGS] as Route,
            { modelId: modelId },
          )}
          facts={[
            {
              field: {
                hostIdentifier: true,
              },
              title: "Host Name (host.name)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                hostType: true,
              },
              title: "Host Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                osType: true,
              },
              title: "OS Type",
              fieldType: FieldType.Element,
              getElement: renderOsTypeChip,
            },
            {
              field: {
                osVersion: true,
              },
              title: "OS Version",
              fieldType: FieldType.Element,
              getElement: (item: Host): ReactElement => {
                return <OsVersionDisplay text={String(item.osVersion)} />;
              },
            },
            {
              field: {
                hostArch: true,
              },
              title: "Architecture",
              fieldType: FieldType.Element,
              getElement: renderArchChip,
            },
            {
              field: {
                cpuCores: true,
              },
              title: "CPU Cores",
              fieldType: FieldType.Element,
              getElement: (item: Host): ReactElement => {
                return (
                  <span>
                    {translator.translatePlural(
                      {
                        one: "{{count}} core",
                        other: "{{count}} cores",
                      },
                      Number(item.cpuCores),
                    )}
                  </span>
                );
              },
            },
            {
              field: {
                totalMemoryBytes: true,
              },
              title: "Total Memory",
              fieldType: FieldType.Element,
              getElement: (item: Host): ReactElement => {
                /*
                 * A size set apart, as the hero's chip and the Filesystems
                 * table write theirs: "۶۴ GiB" on a Persian page, never
                 * "GiB ۶۴".
                 */
                return (
                  <bdi>{formatMemoryBytes(Number(item.totalMemoryBytes))}</bdi>
                );
              },
            },
            {
              field: {
                containerRuntime: true,
              },
              title: "Container Runtime",
              fieldType: FieldType.Text,
            },
            /*
             * When it last started, from the uptime its collector reports:
             * the hero's "Up 12d 4h" chip, as a date to look up.
             */
            {
              field: {
                bootedAt: true,
              },
              title: "Booted",
              description: HOST_METRIC_DESCRIPTIONS.booted,
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                processCount: true,
              },
              title: "Process Count (cached)",
              description: HOST_METRIC_DESCRIPTIONS.processCountCached,
              fieldType: FieldType.Element,
              // In the reader's digits, as the Processes tile's "۲۱۴" (#7106).
              getElement: (item: Host): ReactElement => {
                return item.processCount === undefined ||
                  item.processCount === null ? (
                  <EmptyValue />
                ) : (
                  <span>
                    {translator.formatNumber(Number(item.processCount))}
                  </span>
                );
              },
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Element,
              getElement: (item: Host): ReactElement => {
                /*
                 * A sign beside a collector older than the release the host
                 * guide pins opens how to upgrade it: the config saved again
                 * from the setup guide (it holds the ingestion key), then the
                 * new release, for the install methods this host's OS can
                 * have.
                 */
                return (
                  <AgentVersion
                    kind={AgentKind.HostCollector}
                    version={item.agentVersion}
                    setupGuideRoute={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.HOST_VIEW_DOCUMENTATION] as Route,
                      { modelId: modelId },
                    )}
                    upgradeGuideContext={{
                      hostOsType: item.osType,
                      isHostCollectorManaged: Boolean(
                        item.collectorInstanceUid,
                      ),
                    }}
                  />
                );
              },
            },
            /*
             * A row of its own: a host can report a dozen addresses, IPv6
             * among them.
             */
            {
              field: {
                hostIpAddresses: true,
              },
              title: "IP Addresses",
              fieldType: FieldType.Element,
              colSpan: 2,
              getElement: renderIpAddresses,
            },
          ]}
          selectMoreFields={{
            collectorInstanceUid: true,
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * Last on the page: the Host AI agent's connection, whether AI may
       * investigate, and how fixes run, linking to AI → AI agent.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.Host)}
        resourceId={modelId}
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
      />
    </TimeRangeZoomScope>
  );
};

export default HostOverview;
