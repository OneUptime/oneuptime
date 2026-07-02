import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
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
import OneUptimeDate from "Common/Types/Date";
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
} from "Common/Types/Dashboard/DashboardViewConfig";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import ValueFormatter from "Common/Utils/ValueFormatter";
import {
  computeCounterRate,
  makeSeriesKeyFromAttributes,
  CounterRatePoint,
} from "../../../Utils/CounterRateUtils";
import GoldenMetricTile, {
  tileColorClasses,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  fetchProxmoxInventoryRows,
  formatBytes,
  routeParamFromExternalId,
  displayNameForResource,
  METRIC_STALE_MS,
} from "../Utils/ProxmoxResourceUtils";

type ClusterHealth = "Healthy" | "Degraded" | "Unhealthy";

interface GoldenStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  memorySizeBytes: number | null;
  networkInBytesPerSec: number | null;
  networkOutBytesPerSec: number | null;
}

interface TopGuestRow {
  externalId: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
}

interface DegradedItem {
  kind: "Node" | "Guest" | "Storage" | "Replication";
  /*
   * Detail-page link target. For Replication rows this is the guest's
   * externalId when the job's `guest` label resolved against the
   * inventory — empty means "no detail page", the row renders
   * unclickable.
   */
  externalId: string;
  name: string;
  reasons: Array<string>;
  /* true = drives Unhealthy (red), false = drives Degraded (amber). */
  isCritical: boolean;
}

interface InventorySummary {
  nodesOnline: number;
  nodesTotal: number;
  guestsRunning: number;
  guestsTotal: number;
  storageCount: number;
  worstStoragePercent: number | null;
  worstStorageName: string;
  haStateCounts: Record<string, number>;
  topGuestsByCpu: Array<TopGuestRow>;
  topGuestsByMemory: Array<TopGuestRow>;
  degradedItems: Array<DegradedItem>;
  health: ClusterHealth;
  /*
   * WI-24 backup-job coverage, derived from ProxmoxResource.backedUp
   * (tri-state: unset until the cluster reports the backup-info
   * series). guestsWithBackupInfo === 0 ⇒ coverage unknown — render
   * "—", never "all covered".
   */
  guestsWithBackupInfo: number;
  guestsNotBackedUp: number;
  /* vmid → guest identity, for joining replication `guest` labels. */
  guestsByVmid: Record<string, { name: string; externalId: string }>;
}

/*
 * WI-25 replication health — one row per pve_replication_info series
 * (node-level `replication` collector, default-on). All values are the
 * latest sample in the recent window.
 */
interface ReplicationJob {
  jobId: string;
  guestVmid: string;
  source: string;
  target: string;
  lastSyncTimestampSeconds: number | null;
  durationSeconds: number | null;
  failedSyncs: number | null;
}

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const TILE_WINDOW_MINUTES: number = 5;

const STORAGE_NEAR_FULL_PERCENT: number = 85;

/*
 * WI-25: replication gauges are scraped every 30s — a 30-minute lookback
 * is plenty to catch the latest sample of every series while keeping
 * the card "current" (an agent that has been dark longer than this
 * hides the card rather than showing stale sync ages).
 */
const REPLICATION_WINDOW_MINUTES: number = 30;

/*
 * Fixed, documented staleness thresholds for "last sync age" — the job
 * schedule itself is not exported by pve-exporter, so these cannot be
 * schedule-aware (most replication jobs run every 15 minutes).
 */
const REPLICATION_SYNC_WARN_SECONDS: number = 60 * 60; // 1 h → amber
const REPLICATION_SYNC_DANGER_SECONDS: number = 6 * 60 * 60; // 6 h → red

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "proxmox-overview-auto-refresh-interval";

const ProxmoxClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  /*
   * Per-section loaders so the page paints as soon as cluster metadata
   * arrives, then each section swaps its spinner for real data as its
   * request resolves. `isLoading` only gates the page shell; the
   * section loaders gate their respective independent fetches (no
   * Promise.all — the slowest request must not hold back the others).
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [inventory, setInventory] = useState<InventorySummary | null>(null);

  /*
   * WI-25: null = no pve_replication_info series in the recent window
   * (or the fetch failed) — the card stays hidden, an honest zero
   * state for clusters without storage replication.
   */
  const [replicationJobs, setReplicationJobs] =
    useState<Array<ReplicationJob> | null>(null);

  /*
   * WI-28: the CephCluster manually linked via cephClusterId on the
   * Settings page. null = not linked / fetch failed → card hidden.
   */
  const [linkedCephCluster, setLinkedCephCluster] =
    useState<CephCluster | null>(null);

  // Golden metrics state — independent of the inventory summary.
  const [goldenStats, setGoldenStats] = useState<GoldenStats | null>(null);
  const [isGoldenLoading, setIsGoldenLoading] = useState<boolean>(true);
  const [goldenError, setGoldenError] = useState<string>("");
  const [cpuSeries, setCpuSeries] = useState<Array<SeriesPoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<SeriesPoint>>([]);
  const [storageSeries, setStorageSeries] = useState<Array<SeriesPoint>>([]);
  const [networkSeries, setNetworkSeries] = useState<Array<SeriesPoint>>([]);
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

  /*
   * Inventory-derived summary — health, HA chips, top-5 guests, and
   * the "why degraded?" drill-down all come from the ProxmoxResource
   * Postgres table (instant; no ClickHouse).
   */
  const loadInventory: PromiseVoidFunction = async (): Promise<void> => {
    setInventoryError("");
    try {
      const rows: Array<ProxmoxResourceModel> = await fetchProxmoxInventoryRows(
        {
          proxmoxClusterId: modelId,
        },
      );

      const now: number = Date.now();

      let nodesOnline: number = 0;
      let nodesTotal: number = 0;
      let guestsRunning: number = 0;
      let guestsTotal: number = 0;
      let storageCount: number = 0;
      let worstStoragePercent: number | null = null;
      let worstStorageName: string = "";
      const haStateCounts: Record<string, number> = {};
      const guests: Array<TopGuestRow> = [];
      const degradedItems: Array<DegradedItem> = [];
      let guestsWithBackupInfo: number = 0;
      let guestsNotBackedUp: number = 0;
      const guestsByVmid: Record<string, { name: string; externalId: string }> =
        {};

      for (const row of rows) {
        const name: string = displayNameForResource(row);
        const externalId: string = row.externalId || "";

        if (row.haState) {
          haStateCounts[row.haState] = (haStateCounts[row.haState] || 0) + 1;
        }

        const haCritical: boolean =
          row.haState === "error" || row.haState === "fence";

        if (row.kind === "Node") {
          nodesTotal++;
          if (row.isUp) {
            nodesOnline++;
          } else if (row.isUp === false) {
            degradedItems.push({
              kind: "Node",
              externalId,
              name,
              reasons: ["Offline"],
              isCritical: true,
            });
          }
          if (haCritical) {
            degradedItems.push({
              kind: "Node",
              externalId,
              name,
              reasons: [`HA state: ${row.haState}`],
              isCritical: true,
            });
          }
        } else if (row.kind === "Guest") {
          guestsTotal++;
          if (row.isUp) {
            guestsRunning++;
          }

          if (row.vmid !== null && row.vmid !== undefined) {
            guestsByVmid[String(row.vmid)] = { name, externalId };
          }

          /*
           * WI-24 backup-job coverage. backedUp is tri-state: unset
           * means the cluster has not reported the backup-info
           * series — excluded from both counters so the tile renders
           * "unknown" instead of "all covered".
           */
          if (row.isBackedUp !== null && row.isBackedUp !== undefined) {
            guestsWithBackupInfo++;
            if (row.isBackedUp === false) {
              guestsNotBackedUp++;
            }
          }

          const reasons: Array<string> = [];
          let isCritical: boolean = false;
          if (haCritical) {
            reasons.push(`HA state: ${row.haState}`);
            isCritical = true;
          }
          if (row.onboot && row.isUp === false) {
            reasons.push("Stopped but configured to start on boot");
          }
          if (row.isBackedUp === false) {
            // Coverage gap, not a failed backup — amber, never red.
            reasons.push("Not covered by any backup job");
          }
          if (reasons.length > 0) {
            degradedItems.push({
              kind: "Guest",
              externalId,
              name,
              reasons,
              isCritical,
            });
          }

          // Top-N source: stale metric values render as no-data.
          let cpu: number | null = null;
          let mem: number | null = null;
          if (row.metricsUpdatedAt) {
            const ageMs: number =
              now - new Date(row.metricsUpdatedAt as Date).getTime();
            if (ageMs <= METRIC_STALE_MS) {
              if (
                row.latestCpuPercent !== null &&
                row.latestCpuPercent !== undefined
              ) {
                cpu = Number(row.latestCpuPercent);
              }
              if (
                row.latestMemoryBytes !== null &&
                row.latestMemoryBytes !== undefined
              ) {
                mem = Number(row.latestMemoryBytes);
              }
            }
          }
          guests.push({
            externalId,
            name,
            cpuPercent: cpu,
            memoryBytes: mem,
            memoryPercent:
              row.latestMemoryPercent !== null &&
              row.latestMemoryPercent !== undefined
                ? Number(row.latestMemoryPercent)
                : null,
          });
        } else if (row.kind === "Storage") {
          storageCount++;
          const used: number | null =
            row.latestDiskBytes !== null && row.latestDiskBytes !== undefined
              ? Number(row.latestDiskBytes)
              : null;
          const total: number | null =
            row.maxDiskBytes !== null && row.maxDiskBytes !== undefined
              ? Number(row.maxDiskBytes)
              : null;
          if (used !== null && total !== null && total > 0) {
            const pct: number = (used / total) * 100;
            if (worstStoragePercent === null || pct > worstStoragePercent) {
              worstStoragePercent = pct;
              worstStorageName = name;
            }
            if (pct > STORAGE_NEAR_FULL_PERCENT) {
              degradedItems.push({
                kind: "Storage",
                externalId,
                name,
                reasons: [`${pct.toFixed(1)}% used`],
                isCritical: false,
              });
            }
          }
        }
      }

      const topGuestsByCpu: Array<TopGuestRow> = guests
        .filter((g: TopGuestRow) => {
          return g.cpuPercent !== null;
        })
        .sort((a: TopGuestRow, b: TopGuestRow) => {
          return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
        })
        .slice(0, 5);

      const topGuestsByMemory: Array<TopGuestRow> = guests
        .filter((g: TopGuestRow) => {
          return g.memoryBytes !== null;
        })
        .sort((a: TopGuestRow, b: TopGuestRow) => {
          return (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0);
        })
        .slice(0, 5);

      /*
       * Health (spec WI-8): Unhealthy when any node is offline or any
       * HA resource sits in error/fence; Degraded when a storage is
       * >85% used, a guest with onboot=1 is stopped, or some nodes
       * are not online (the offline-node case already lands in
       * Unhealthy above).
       */
      let health: ClusterHealth = "Healthy";
      if (
        degradedItems.some((item: DegradedItem) => {
          return item.isCritical;
        })
      ) {
        health = "Unhealthy";
      } else if (degradedItems.length > 0 || nodesOnline < nodesTotal) {
        health = "Degraded";
      }

      setInventory({
        nodesOnline,
        nodesTotal,
        guestsRunning,
        guestsTotal,
        storageCount,
        worstStoragePercent,
        worstStorageName,
        haStateCounts,
        topGuestsByCpu,
        topGuestsByMemory,
        degradedItems,
        health,
        guestsWithBackupInfo,
        guestsNotBackedUp,
        guestsByVmid,
      });
    } catch (err) {
      /*
       * Surface the failure instead of silently rendering zero counts,
       * which is indistinguishable from a genuinely empty cluster.
       */
      setInventoryError(API.getFriendlyMessage(err));
    } finally {
      setIsInventoryLoading(false);
    }
  };

  /*
   * WI-25: storage replication health. pve-exporter's node-level
   * `replication` collector is default-on, so these series flow from
   * every agent today. The card renders ONLY when pve_replication_info
   * series exist in the recent window — clusters without replication
   * (or with a dark agent) show nothing. Best-effort: failures hide
   * the card instead of erroring the page.
   */
  const loadReplication: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -REPLICATION_WINDOW_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const baseAttributes: Record<string, string> = {
        "resource.proxmox.cluster.name": clusterName,
      };

      const buildAggregateBy: (metricName: string) => AggregateBy<Metric> = (
        metricName: string,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: { ...baseAttributes },
          } as AggregateBy<Metric>["query"],
          aggregationType: AggregationType.Max,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: startDate,
          endTimestamp: endDate,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            time: SortOrder.Descending,
          },
          // Preserve the `id` (job) label + info-series labels.
          groupBy: { attributes: true },
        };
      };

      const [infoResult, lastSyncResult, durationResult, failedResult]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy("pve_replication_info"),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_replication_last_sync_timestamp_seconds",
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy("pve_replication_duration_seconds"),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy("pve_replication_failed_syncs"),
        }),
      ]);

      type LatestEntry = {
        value: number;
        attributes: Record<string, unknown>;
      };

      // id (job) label → value at the latest bucket in the window.
      const latestPerJobId: (
        result: AggregatedResult,
      ) => Map<string, LatestEntry> = (
        result: AggregatedResult,
      ): Map<string, LatestEntry> => {
        const latestTs: Map<string, number> = new Map();
        const out: Map<string, LatestEntry> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const attributes: Record<string, unknown> =
            (p["attributes"] as Record<string, unknown>) || {};
          const jobId: string = (attributes["id"] as string) || "";
          if (!jobId) {
            continue;
          }
          const raw: unknown =
            p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
          const t: number =
            raw instanceof Date
              ? raw.getTime()
              : new Date(raw as string).getTime();
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          const prev: number | undefined = latestTs.get(jobId);
          if (prev === undefined || t > prev) {
            latestTs.set(jobId, t);
            out.set(jobId, { value: v, attributes });
          }
        }
        return out;
      };

      const infoByJob: Map<string, LatestEntry> = latestPerJobId(infoResult);
      if (infoByJob.size === 0) {
        setReplicationJobs(null);
        return;
      }
      const lastSyncByJob: Map<string, LatestEntry> =
        latestPerJobId(lastSyncResult);
      const durationByJob: Map<string, LatestEntry> =
        latestPerJobId(durationResult);
      const failedByJob: Map<string, LatestEntry> =
        latestPerJobId(failedResult);

      const jobs: Array<ReplicationJob> = Array.from(infoByJob.entries())
        .map(([jobId, info]: [string, LatestEntry]): ReplicationJob => {
          return {
            jobId: jobId,
            guestVmid: (info.attributes["guest"] as string) || "",
            source: (info.attributes["source"] as string) || "",
            target: (info.attributes["target"] as string) || "",
            lastSyncTimestampSeconds: lastSyncByJob.get(jobId)?.value ?? null,
            durationSeconds: durationByJob.get(jobId)?.value ?? null,
            failedSyncs: failedByJob.get(jobId)?.value ?? null,
          };
        })
        .sort((a: ReplicationJob, b: ReplicationJob) => {
          // Failing jobs first, then by job id for a stable table.
          const aFailed: number = a.failedSyncs ?? 0;
          const bFailed: number = b.failedSyncs ?? 0;
          if (aFailed !== bFailed) {
            return bFailed - aFailed;
          }
          return a.jobId.localeCompare(b.jobId);
        });

      setReplicationJobs(jobs);
    } catch {
      // Supplementary card — keep it hidden on failure.
    }
  };

  /*
   * Golden cluster metrics — aggregated across node series for the
   * selected time range. pve_cpu_usage_ratio is a true 0..1 ratio, so
   * cluster CPU% is capacity-weighted: Σ(ratio × pve_cpu_usage_limit)
   * ÷ Σ limit over node series (a 64-core node at 50% must outweigh a
   * 4-core node at 100%). Memory is Σ usage ÷ Σ size over node series.
   * Storage chart sums pve_disk_usage_bytes over storage series.
   * Network counters are cumulative — delta'd client-side via the
   * shared CounterRateUtils. Node/guest/storage series are split by
   * the `id` label prefix client-side (works with or without the
   * agent's pve.scope transform).
   */
  const loadGoldenMetrics: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
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
        "resource.proxmox.cluster.name": clusterName,
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
          /*
           * Grouping by attributes preserves the `id` dimension so we
           * can split node/guest/storage series and join CPU ratio
           * with its capacity client-side.
           */
          groupBy: { attributes: true },
        };
      };

      const [
        cpuRatioResult,
        cpuLimitResult,
        memUsageResult,
        memSizeResult,
        storageUsageResult,
        netRecvResult,
        netSendResult,
      ]: [
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
            "pve_cpu_usage_ratio",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_cpu_usage_limit",
            AggregationType.Max,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_memory_usage_bytes",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_memory_size_bytes",
            AggregationType.Max,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_disk_usage_bytes",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_network_receive_bytes",
            AggregationType.Max,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "pve_network_transmit_bytes",
            AggregationType.Max,
          ),
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

      const getId: (p: AggregatedModel) => string = (
        p: AggregatedModel,
      ): string => {
        const attrs: Record<string, unknown> =
          (p["attributes"] as Record<string, unknown>) || {};
        return (attrs["id"] as string) || "";
      };

      type TimeValuePoint = { x: Date; y: number };

      /*
       * Collect (bucket, id) → value for one metric, filtered to ids
       * with the given prefix ("node/" or "storage/").
       */
      const collectByBucketAndId: (
        result: AggregatedResult,
        idPrefix: string,
      ) => Map<number, Map<string, number>> = (
        result: AggregatedResult,
        idPrefix: string,
      ): Map<number, Map<string, number>> => {
        const out: Map<number, Map<string, number>> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const id: string = getId(p);
          if (!id.startsWith(idPrefix)) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let perId: Map<string, number> | undefined = out.get(t);
          if (!perId) {
            perId = new Map();
            out.set(t, perId);
          }
          perId.set(id, v);
        }
        return out;
      };

      const toSortedPoints: (
        perBucket: Map<number, number>,
      ) => Array<TimeValuePoint> = (
        perBucket: Map<number, number>,
      ): Array<TimeValuePoint> => {
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

      /*
       * Cluster CPU% per bucket — capacity-weighted across node
       * series: Σ(ratio × cores) / Σ cores × 100. Falls back to a
       * plain mean of the ratios when no pve_cpu_usage_limit series
       * exists in the window.
       */
      const cpuRatioByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndId(cpuRatioResult, "node/");
      const cpuLimitByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndId(cpuLimitResult, "node/");

      const cpuPerBucket: Map<number, number> = new Map();
      for (const [t, ratios] of cpuRatioByBucket.entries()) {
        const limits: Map<string, number> | undefined = cpuLimitByBucket.get(t);
        let weightedSum: number = 0;
        let weightTotal: number = 0;
        let plainSum: number = 0;
        let plainCount: number = 0;
        for (const [id, ratio] of ratios.entries()) {
          plainSum += ratio;
          plainCount++;
          const limit: number | undefined = limits?.get(id);
          if (limit !== undefined && limit > 0) {
            weightedSum += ratio * limit;
            weightTotal += limit;
          }
        }
        if (weightTotal > 0) {
          cpuPerBucket.set(t, (weightedSum / weightTotal) * 100);
        } else if (plainCount > 0) {
          cpuPerBucket.set(t, (plainSum / plainCount) * 100);
        }
      }
      const cpuPoints: Array<TimeValuePoint> = toSortedPoints(cpuPerBucket);

      // Memory: Σ usage and Σ size per bucket across node series.
      const memUsageByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndId(memUsageResult, "node/");
      const memSizeByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndId(memSizeResult, "node/");

      const memBytesPerBucket: Map<number, number> = new Map();
      const memPercentPerBucket: Map<number, number> = new Map();
      let latestMemUsed: number | null = null;
      let latestMemSize: number | null = null;
      let latestMemTs: number = 0;
      for (const [t, usages] of memUsageByBucket.entries()) {
        let usedSum: number = 0;
        for (const v of usages.values()) {
          usedSum += v;
        }
        memBytesPerBucket.set(t, usedSum);

        const sizes: Map<string, number> | undefined = memSizeByBucket.get(t);
        if (sizes && sizes.size > 0) {
          let sizeSum: number = 0;
          for (const v of sizes.values()) {
            sizeSum += v;
          }
          if (sizeSum > 0) {
            memPercentPerBucket.set(t, (usedSum / sizeSum) * 100);
            if (t > latestMemTs) {
              latestMemTs = t;
              latestMemUsed = usedSum;
              latestMemSize = sizeSum;
            }
          }
        }
      }
      const memoryPoints: Array<TimeValuePoint> =
        toSortedPoints(memBytesPerBucket);
      const memoryPercentPoints: Array<TimeValuePoint> =
        toSortedPoints(memPercentPerBucket);

      // Storage: Σ pve_disk_usage_bytes per bucket across storage series.
      const storageByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndId(storageUsageResult, "storage/");
      const storagePerBucket: Map<number, number> = new Map();
      for (const [t, usages] of storageByBucket.entries()) {
        let sum: number = 0;
        for (const v of usages.values()) {
          sum += v;
        }
        storagePerBucket.set(t, sum);
      }
      const storagePoints: Array<TimeValuePoint> =
        toSortedPoints(storagePerBucket);

      /*
       * Network — cumulative byte counters converted to per-second
       * rates, summed across all reporting resources (guests; nodes
       * don't carry these counters). Shared math with the insights
       * and detail-page rate charts via CounterRateUtils.
       */
      const networkInPoints: Array<CounterRatePoint> = computeCounterRate(
        netRecvResult,
        { getSeriesKey: makeSeriesKeyFromAttributes(["id"]) },
      );
      const networkOutPoints: Array<CounterRatePoint> = computeCounterRate(
        netSendResult,
        { getSeriesKey: makeSeriesKeyFromAttributes(["id"]) },
      );

      setCpuSeries(
        cpuPoints.length > 0 ? [{ seriesName: "CPU %", data: cpuPoints }] : [],
      );
      setMemorySeries(
        memoryPoints.length > 0
          ? [{ seriesName: "Memory", data: memoryPoints }]
          : [],
      );
      setStorageSeries(
        storagePoints.length > 0
          ? [{ seriesName: "Storage Used", data: storagePoints }]
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

      const cpuTile: number | null = meanInRecentWindow(cpuPoints);
      const memTile: number | null = meanInRecentWindow(memoryPercentPoints);
      const netInTile: number | null = meanInRecentWindow(networkInPoints);
      const netOutTile: number | null = meanInRecentWindow(networkOutPoints);

      setGoldenStats({
        cpuPercent: cpuTile,
        memoryPercent: memTile,
        memoryUsedBytes: latestMemUsed,
        memorySizeBytes: latestMemSize,
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
   * Ref pattern so the refresh interval picks up the latest closure
   * (timeRange / cluster name) without tearing the timer down on
   * every render.
   */
  const loadGoldenMetricsRef: React.MutableRefObject<
    (clusterName: string) => Promise<void>
  > = useRef<(clusterName: string) => Promise<void>>(loadGoldenMetrics);
  loadGoldenMetricsRef.current = loadGoldenMetrics;

  /*
   * WI-28: resolve the manually linked Ceph cluster (Settings page
   * dropdown) into its Postgres snapshot columns — instant, no
   * ClickHouse. Best-effort: failure (or no link) hides the card.
   */
  const loadLinkedCephCluster: (
    cephClusterId: ObjectID,
  ) => Promise<void> = async (cephClusterId: ObjectID): Promise<void> => {
    try {
      const cephCluster: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: cephClusterId,
        select: {
          name: true,
          healthStatus: true,
          capacityUsedPercent: true,
        },
      });
      setLinkedCephCluster(cephCluster);
    } catch {
      // Cross-link card is supplementary.
    }
  };

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
        id: modelId,
        select: {
          name: true,
          description: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          pveVersion: true,
          agentVersion: true,
          nodeCount: true,
          onlineNodeCount: true,
          guestCount: true,
          storageCount: true,
          guestsWithoutBackupCount: true,
          cephClusterId: true,
        },
      });
      setCluster(item);
      setIsLoading(false);

      if (item?.cephClusterId) {
        void loadLinkedCephCluster(new ObjectID(item.cephClusterId.toString()));
      }

      if (item?.name) {
        // Fire section fetches independently — no Promise.all.
        void loadInventory();
        void loadGoldenMetricsRef.current(item.name);
        void loadReplication(item.name);
      } else {
        setIsInventoryLoading(false);
        setIsGoldenLoading(false);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
      setIsInventoryLoading(false);
      setIsGoldenLoading(false);
    }
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Re-fetch golden metrics whenever the user picks a different time
   * range. Cluster metadata and inventory stay cached.
   */
  useEffect(() => {
    if (cluster?.name) {
      void loadGoldenMetricsRef.current(cluster.name);
    }
  }, [timeRange]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (cluster?.name) {
        void loadGoldenMetricsRef.current(cluster.name);
        void loadInventory();
        void loadReplication(cluster.name);
      }
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval, cluster?.name]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const onManualRefresh: () => void = (): void => {
    if (cluster?.name) {
      void loadGoldenMetricsRef.current(cluster.name);
      void loadInventory();
      void loadReplication(cluster.name);
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

  /*
   * Quorum proxy — derived from node visibility (onlineNodeCount vs
   * nodeCount; inventory first, snapshot columns as fallback).
   * pve-exporter exposes no corosync metric, so this is the honest
   * ceiling: at ≤50% nodes online the cluster has lost (or is about
   * to lose) corosync quorum. Do NOT present it as a corosync read.
   */
  const nodesTotal: number = inventory?.nodesTotal || cluster.nodeCount || 0;
  const nodesOnline: number = inventory
    ? inventory.nodesOnline
    : cluster.onlineNodeCount || 0;
  const quorumAtRisk: boolean =
    nodesTotal > 0 && nodesOnline / nodesTotal <= 0.5;
  const nodeAvailabilityPct: number | null =
    nodesTotal > 0 ? (nodesOnline / nodesTotal) * 100 : null;

  const guestsTotal: number = inventory?.guestsTotal || cluster.guestCount || 0;
  const guestsRunning: number = inventory ? inventory.guestsRunning : 0;
  const storageCount: number =
    inventory?.storageCount || cluster.storageCount || 0;

  /*
   * WI-25: failing replication jobs feed the "Why degraded?" list.
   * Amber (Degraded), not red — the documented Unhealthy drivers stay
   * node-offline / HA error-fence only. The linked Ceph cluster's
   * health (WI-28) deliberately does NOT feed this badge: separate
   * products, separate alerting — the Ceph card carries its own pill.
   */
  const replicationDegradedItems: Array<DegradedItem> = (replicationJobs || [])
    .filter((job: ReplicationJob) => {
      return (job.failedSyncs ?? 0) > 0;
    })
    .map((job: ReplicationJob): DegradedItem => {
      const guest: { name: string; externalId: string } | undefined =
        inventory?.guestsByVmid[job.guestVmid];
      const failed: number = job.failedSyncs ?? 0;
      return {
        kind: "Replication",
        externalId: guest?.externalId || "",
        name: guest
          ? `Replication job ${job.jobId} (${guest.name})`
          : `Replication job ${job.jobId}`,
        reasons: [`${failed} failed sync${failed === 1 ? "" : "s"}`],
        isCritical: false,
      };
    });

  const allDegradedItems: Array<DegradedItem> = [
    ...(inventory?.degradedItems || []),
    ...replicationDegradedItems,
  ];

  const inventoryHealth: ClusterHealth = inventory?.health || "Healthy";
  const clusterHealth: ClusterHealth =
    inventoryHealth === "Healthy" && replicationDegradedItems.length > 0
      ? "Degraded"
      : inventoryHealth;

  /*
   * When the collector is disconnected the inventory snapshot is stale, so
   * the derived health is no longer trustworthy. Surface "Unknown" instead
   * of a misleading last-known status (mirrors the hero badge).
   */
  const isClusterConnected: boolean = ["connected", "active"].includes(
    ((cluster?.otelCollectorStatus as string) || "").toLowerCase(),
  );
  const displayClusterHealth: string = isClusterConnected
    ? clusterHealth
    : "Unknown";

  const nodesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route,
    { modelId: modelId },
  );
  const guestsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUESTS] as Route,
    { modelId: modelId },
  );
  const storageRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_STORAGE] as Route,
    { modelId: modelId },
  );

  const navigateToDetail: (item: DegradedItem) => void = (
    item: DegradedItem,
  ): void => {
    // Replication rows link to the replicated guest when resolvable.
    if (!item.externalId) {
      return;
    }
    const pageMap: PageMap =
      item.kind === "Node"
        ? PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL
        : item.kind === "Guest" || item.kind === "Replication"
          ? PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL
          : PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL;
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
        modelId: modelId,
        subModelId: routeParamFromExternalId(item.externalId),
      }),
    );
  };

  const navigateToGuest: (externalId: string) => void = (
    externalId: string,
  ): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL] as Route,
        {
          modelId: modelId,
          subModelId: routeParamFromExternalId(externalId),
        },
      ),
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

  const renderHero: () => ReactElement = (): ReactElement => {
    const status: string = (cluster.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = cluster.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (cluster.name as string | undefined) || "Untitled Proxmox cluster";

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

    /*
     * Health is derived from the last inventory snapshot, which goes stale
     * once the collector disconnects. Reporting "Healthy" next to a
     * "Disconnected" badge is contradictory and misleading, so when the
     * cluster is not connected we surface health as "Unknown" (neutral grey)
     * rather than the last-known live status.
     */
    const healthLabel: string = isConnected ? clusterHealth : "Unknown";
    const healthBadgeClass: string = !isConnected
      ? "bg-gray-50 text-gray-600 ring-gray-200"
      : clusterHealth === "Healthy"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : clusterHealth === "Degraded"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-red-50 text-red-700 ring-red-200";
    const healthDotClass: string = !isConnected
      ? "bg-gray-400"
      : clusterHealth === "Healthy"
        ? "bg-emerald-500"
        : clusterHealth === "Degraded"
          ? "bg-amber-500"
          : "bg-red-500";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];
    if (nodesTotal > 0) {
      specChips.push({
        icon: IconProp.ServerStack,
        label: `${nodesOnline}/${nodesTotal} node${nodesTotal === 1 ? "" : "s"} online`,
      });
    }
    if (guestsTotal > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: inventory
          ? `${guestsRunning}/${guestsTotal} guest${guestsTotal === 1 ? "" : "s"} running`
          : `${guestsTotal} guest${guestsTotal === 1 ? "" : "s"}`,
      });
    }
    if (storageCount > 0) {
      specChips.push({
        icon: IconProp.Database,
        label: `${storageCount} storage volume${storageCount === 1 ? "" : "s"}`,
      });
    }
    if (cluster.pveVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: `PVE ${String(cluster.pveVersion)}`,
      });
    }
    if (cluster.agentVersion) {
      specChips.push({
        icon: IconProp.Terminal,
        label: `Agent ${String(cluster.agentVersion)}`,
      });
    }

    /*
     * HA state distribution chips — counts per pve_ha_state state
     * label from the inventory. error/fence = red, started = green,
     * stopped/disabled = gray, anything else (migrate, relocate,
     * recovery, ...) = amber.
     */
    const haChips: Array<{
      label: string;
      value: number;
      colorClass: string;
    }> = Object.entries(inventory?.haStateCounts || {})
      .sort(([a]: [string, number], [b]: [string, number]) => {
        return a.localeCompare(b);
      })
      .map(([state, count]: [string, number]) => {
        let colorClass: string = "bg-amber-50 text-amber-700 ring-amber-200";
        if (state === "error" || state === "fence") {
          colorClass = "bg-red-50 text-red-700 ring-red-200";
        } else if (state === "started") {
          colorClass = "bg-emerald-50 text-emerald-700 ring-emerald-200";
        } else if (state === "stopped" || state === "disabled") {
          colorClass = "bg-gray-50 text-gray-700 ring-gray-200";
        }
        return { label: `HA ${state}`, value: count, colorClass };
      });

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
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-orange-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-orange-200 shadow-sm">
                  <Icon
                    icon={IconProp.ServerStack}
                    className="h-6 w-6 text-orange-600"
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
                    {!isInventoryLoading && !inventoryError && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                        />
                        {healthLabel}
                      </span>
                    )}
                  </div>
                  {cluster.description && (
                    <div className="mt-1 truncate text-sm text-gray-500">
                      {String(cluster.description)}
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

            {haChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {haChips.map(
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
                        key={`ha-${idx}`}
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

  const renderGoldenMetrics: () => ReactElement = (): ReactElement => {
    if (isGoldenLoading && !goldenStats) {
      return (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_: unknown, idx: number) => {
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

    const guestsRunningPct: number | null =
      guestsTotal > 0 ? (guestsRunning / guestsTotal) * 100 : null;

    /*
     * WI-24 backup-JOB coverage. Tri-state by design: until the
     * cluster reports pve_not_backed_up_* the tile reads "—", never
     * "all covered". Inventory-derived counts win; the cluster
     * snapshot column (guestsWithoutBackupCount, written by the same
     * ingest scan) is the fallback while inventory is in flight.
     * "Covered" means a backup job selects the guest — backup
     * freshness/success is not expressible from pve-exporter (v4).
     */
    const backupInfoFromInventory: boolean =
      (inventory?.guestsWithBackupInfo ?? 0) > 0;
    const backupKnown: boolean =
      backupInfoFromInventory ||
      (cluster.guestsWithoutBackupCount !== null &&
        cluster.guestsWithoutBackupCount !== undefined);
    const guestsNotCovered: number = backupInfoFromInventory
      ? inventory?.guestsNotBackedUp ?? 0
      : Number(cluster.guestsWithoutBackupCount ?? 0);
    const guestsCovered: number = Math.max(guestsTotal - guestsNotCovered, 0);
    const backupCoveragePct: number | null =
      backupKnown && guestsTotal > 0
        ? (guestsCovered / guestsTotal) * 100
        : null;

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <GoldenMetricTile
          title="Node Availability"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={
            nodeAvailabilityPct === null ? "—" : `${nodesOnline}/${nodesTotal}`
          }
          sublabel="nodes online"
          percent={nodeAvailabilityPct}
          thresholds={{ warn: 99, danger: 51 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.cpuPercent)}
          sublabel="capacity-weighted across nodes"
          percent={s.cpuPercent}
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.memoryPercent)}
          sublabel={
            s.memoryUsedBytes !== null && s.memorySizeBytes !== null
              ? `${formatBytes(s.memoryUsedBytes)} of ${formatBytes(s.memorySizeBytes)}`
              : "of node memory"
          }
          percent={s.memoryPercent}
          thresholds={{ warn: 80, danger: 95 }}
        />
        <GoldenMetricTile
          title="Storage"
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(inventory?.worstStoragePercent ?? null)}
          sublabel={
            inventory?.worstStorageName
              ? `fullest: ${inventory.worstStorageName}`
              : "fullest volume"
          }
          percent={inventory?.worstStoragePercent ?? null}
          thresholds={{ warn: 75, danger: STORAGE_NEAR_FULL_PERCENT }}
        />
        <GoldenMetricTile
          title="Guests"
          icon={IconProp.Cube}
          iconColor="sky"
          value={guestsTotal > 0 ? `${guestsRunning}/${guestsTotal}` : "—"}
          sublabel={
            netTotal === null
              ? "running"
              : `running · net ${ValueFormatter.formatValue(netTotal, "By/s")}`
          }
          percent={guestsRunningPct}
          thresholds={{ warn: 99, danger: 50 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Backup Coverage"
          icon={IconProp.Archive}
          iconColor="emerald"
          value={
            backupKnown && guestsTotal > 0
              ? `${guestsCovered}/${guestsTotal}`
              : "—"
          }
          sublabel={
            backupKnown && guestsTotal > 0
              ? guestsNotCovered > 0
                ? `${guestsNotCovered} guest${guestsNotCovered === 1 ? "" : "s"} not in any backup job`
                : "guests in a backup job"
              : "backup-info not reported yet"
          }
          percent={backupCoveragePct}
          /*
           * Red whenever any guest is uncovered (spec WI-24); green
           * only at 100% coverage.
           */
          thresholds={{ warn: 100, danger: 100 }}
          higherIsBetter={true}
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
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
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
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid={`proxmox-overview-${modelId.toString()}`}
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

    const bytesYAxis: YAxis = {
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

    return (
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Cluster resource usage
            </h2>
            <p className="text-xs text-gray-500">
              Aggregated across nodes (CPU/memory), storage volumes, and guests
              (network) over the selected time range
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
            yAxis: bytesYAxis,
          })}
          {renderChartCard({
            title: "Storage",
            icon: IconProp.Database,
            iconColor: "amber",
            data: storageSeries,
            yAxis: bytesYAxis,
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
    );
  };

  const renderWhyDegraded: () => ReactElement = (): ReactElement => {
    if (clusterHealth === "Healthy" || allDegradedItems.length === 0) {
      return <Fragment />;
    }

    return (
      <Card
        title="Why is this cluster degraded?"
        description="Specific nodes, guests, storage volumes, and replication jobs that are driving the current health status. Click through to investigate."
      >
        <div className="divide-y divide-gray-100">
          {allDegradedItems.map((item: DegradedItem, index: number) => {
            const icon: IconProp =
              item.kind === "Node"
                ? IconProp.ServerStack
                : item.kind === "Guest"
                  ? IconProp.Cube
                  : item.kind === "Replication"
                    ? IconProp.ArrowPath
                    : IconProp.Database;
            const iconBgClass: string = item.isCritical
              ? "bg-red-100"
              : "bg-amber-100";
            const iconColorClass: string = item.isCritical
              ? "text-red-600"
              : "text-amber-600";
            const chipClass: string = item.isCritical
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-amber-50 text-amber-700 border-amber-200";
            return (
              <div
                key={`degraded-${index}`}
                onClick={() => {
                  navigateToDetail(item);
                }}
                className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${
                  item.externalId ? "hover:bg-gray-50 cursor-pointer" : ""
                }`}
              >
                <div
                  className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-full ${iconBgClass} flex items-center justify-center`}
                >
                  <Icon
                    icon={icon}
                    className={`h-3.5 w-3.5 ${iconColorClass}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {item.name}
                    </span>
                    <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-600">
                      {item.kind}
                    </span>
                    {item.reasons.map((reason: string) => {
                      return (
                        <span
                          key={reason}
                          className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded border ${chipClass}`}
                        >
                          {reason}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 font-mono">
                    {item.externalId}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  /*
   * WI-25: replication card. Rendered only when pve_replication_info
   * series exist in the recent window — no SaaS competitor surfaces
   * these (Datadog confirmed gap). Staleness is UI-only: a "last sync
   * age" ALERT needs wall-clock math the criteria engine doesn't have
   * (v4); the pve-replication-failing template covers failed syncs.
   */
  const renderReplication: () => ReactElement = (): ReactElement => {
    if (!replicationJobs || replicationJobs.length === 0) {
      return <Fragment />;
    }

    const nowSeconds: number = Date.now() / 1000;

    const formatDuration: (seconds: number | null) => string = (
      seconds: number | null,
    ): string => {
      if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
        return "—";
      }
      if (seconds < 60) {
        return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
      }
      const minutes: number = Math.floor(seconds / 60);
      const rest: number = Math.round(seconds % 60);
      return `${minutes}m ${rest}s`;
    };

    const formatAge: (ageSeconds: number) => string = (
      ageSeconds: number,
    ): string => {
      if (ageSeconds < 60) {
        return "just now";
      }
      if (ageSeconds < 60 * 60) {
        return `${Math.floor(ageSeconds / 60)}m ago`;
      }
      if (ageSeconds < 24 * 60 * 60) {
        return `${Math.floor(ageSeconds / (60 * 60))}h ago`;
      }
      return `${Math.floor(ageSeconds / (24 * 60 * 60))}d ago`;
    };

    return (
      <Card
        title="Replication"
        description="Storage replication jobs (pvesr) reported by this cluster — last successful sync, duration, and failed sync count per job."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr>
                {[
                  "Job",
                  "Guest",
                  "Source → Target",
                  "Last Sync",
                  "Duration",
                  "Failed Syncs",
                ].map((heading: string): ReactElement => {
                  return (
                    <th
                      key={heading}
                      className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {heading}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {replicationJobs.map((job: ReplicationJob): ReactElement => {
                const guest: { name: string; externalId: string } | undefined =
                  inventory?.guestsByVmid[job.guestVmid];

                const ageSeconds: number | null =
                  job.lastSyncTimestampSeconds !== null &&
                  job.lastSyncTimestampSeconds > 0
                    ? Math.max(nowSeconds - job.lastSyncTimestampSeconds, 0)
                    : null;
                const ageClass: string =
                  ageSeconds === null
                    ? "text-gray-400"
                    : ageSeconds > REPLICATION_SYNC_DANGER_SECONDS
                      ? "text-red-700 font-medium"
                      : ageSeconds > REPLICATION_SYNC_WARN_SECONDS
                        ? "text-amber-700 font-medium"
                        : "text-gray-700";

                const failed: number | null = job.failedSyncs;
                const failedClass: string =
                  failed !== null && failed > 0
                    ? "text-red-700 font-semibold"
                    : "text-gray-700";

                return (
                  <tr key={job.jobId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-sm font-mono text-gray-700">
                      {job.jobId}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {guest ? (
                        <span
                          className="cursor-pointer font-medium text-gray-900 hover:text-indigo-700 hover:underline"
                          onClick={() => {
                            navigateToGuest(guest.externalId);
                          }}
                        >
                          {guest.name}
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {job.guestVmid || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-700">
                      {job.source || "—"}
                      <span className="text-gray-400"> → </span>
                      {job.target || "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-sm ${ageClass}`}>
                      {ageSeconds === null ? "—" : formatAge(ageSeconds)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-700">
                      {formatDuration(job.durationSeconds)}
                    </td>
                    <td className={`px-4 py-2.5 text-sm ${failedClass}`}>
                      {failed === null ? "—" : failed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  /*
   * WI-28: hyperconverged PVE ↔ Ceph cross-link. Health pill +
   * capacity come straight from the linked CephCluster's Postgres
   * snapshot columns (instant). A degraded Ceph cluster reddens THIS
   * card only — it never feeds the Proxmox health badge (separate
   * products, separate alerting — documented decision).
   */
  const renderCephStorage: () => ReactElement = (): ReactElement => {
    if (!linkedCephCluster || !cluster.cephClusterId) {
      return <Fragment />;
    }

    const healthStatus: number | undefined =
      linkedCephCluster.healthStatus !== null &&
      linkedCephCluster.healthStatus !== undefined
        ? Number(linkedCephCluster.healthStatus)
        : undefined;

    // 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR (ceph_health_status).
    const pill: { label: string; badge: string; dot: string } =
      healthStatus === undefined
        ? {
            label: "Unknown",
            badge: "bg-gray-50 text-gray-600 ring-gray-200",
            dot: "bg-gray-400",
          }
        : healthStatus >= 2
          ? {
              label: "ERR",
              badge: "bg-red-50 text-red-700 ring-red-200",
              dot: "bg-red-500",
            }
          : healthStatus >= 1
            ? {
                label: "WARN",
                badge: "bg-amber-50 text-amber-700 ring-amber-200",
                dot: "bg-amber-500",
              }
            : {
                label: "OK",
                badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
                dot: "bg-emerald-500",
              };

    const capacityPercent: number | null =
      linkedCephCluster.capacityUsedPercent !== null &&
      linkedCephCluster.capacityUsedPercent !== undefined &&
      Number.isFinite(Number(linkedCephCluster.capacityUsedPercent))
        ? Number(linkedCephCluster.capacityUsedPercent)
        : null;
    const capacityClamped: number =
      capacityPercent === null
        ? 0
        : Math.min(100, Math.max(0, capacityPercent));
    const capacityBarColor: string =
      capacityPercent === null
        ? "bg-gray-300"
        : capacityPercent >= 90
          ? "bg-red-500"
          : capacityPercent >= 75
            ? "bg-amber-500"
            : "bg-emerald-500";

    const cephRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
      { modelId: new ObjectID(cluster.cephClusterId.toString()) },
    );

    return (
      <Card
        title="Ceph Storage"
        description="This Proxmox cluster is linked to a Ceph cluster monitored by OneUptime. Ceph health does not affect the Proxmox health badge — it alerts separately."
      >
        <div
          onClick={() => {
            Navigation.navigate(cephRoute);
          }}
          className="group flex cursor-pointer flex-col gap-4 rounded-xl border border-gray-200 p-4 transition-all duration-200 hover:border-indigo-300 hover:shadow-md sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-3 min-w-0 sm:w-1/3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <Icon
                icon={IconProp.Database}
                className="h-5 w-5 text-slate-600"
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                {linkedCephCluster.name || "Ceph cluster"}
              </div>
              <div className="text-xs text-gray-500">
                View Ceph cluster overview →
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:w-1/6">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
              {pill.label}
            </span>
          </div>
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>Capacity used</span>
              <span className="font-medium text-gray-700">
                {capacityPercent === null
                  ? "—"
                  : `${capacityPercent.toFixed(1)}%`}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200">
              <div
                className={`h-2 rounded-full ${capacityBarColor}`}
                style={{ width: `${capacityClamped}%` }}
              />
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const renderTopGuestList: (params: {
    rows: Array<TopGuestRow>;
    valueOf: (row: TopGuestRow) => string;
    percentOf: (row: TopGuestRow) => number;
    barColorClass: string;
  }) => ReactElement = (params: {
    rows: Array<TopGuestRow>;
    valueOf: (row: TopGuestRow) => string;
    percentOf: (row: TopGuestRow) => number;
    barColorClass: string;
  }): ReactElement => {
    if (params.rows.length === 0) {
      return (
        <p className="text-gray-400 text-sm py-8 text-center">
          No usage data available.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        {params.rows.map((row: TopGuestRow, index: number) => {
          const pct: number = Math.min(params.percentOf(row), 100);
          return (
            <div
              key={row.externalId}
              onClick={() => {
                navigateToGuest(row.externalId);
              }}
              className="group cursor-pointer rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="flex-shrink-0 text-xs font-medium text-gray-400 w-4">
                    {index + 1}.
                  </span>
                  <span className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700">
                    {row.name}
                  </span>
                  <span className="flex-shrink-0 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 font-mono">
                    {row.externalId}
                  </span>
                </div>
                <span className="flex-shrink-0 text-sm font-semibold text-gray-700 tabular-nums ml-2">
                  {params.valueOf(row)}
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
                          : params.barColorClass
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
    );
  };

  const renderTopGuests: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title="Top Resource Consumers"
        description="Guests with the highest resource utilization in this cluster — read from the Postgres inventory, instant."
      >
        {isInventoryLoading ? (
          <ComponentLoader />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-gray-100">
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
                  <p className="text-xs text-gray-500">Top 5 guests by CPU</p>
                </div>
              </div>
              {renderTopGuestList({
                rows: inventory?.topGuestsByCpu || [],
                valueOf: (row: TopGuestRow): string => {
                  return formatPercent(row.cpuPercent);
                },
                percentOf: (row: TopGuestRow): number => {
                  return row.cpuPercent ?? 0;
                },
                barColorClass: "bg-blue-500",
              })}
            </div>

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
                  <p className="text-xs text-gray-500">
                    Top 5 guests by memory
                  </p>
                </div>
              </div>
              {renderTopGuestList({
                rows: inventory?.topGuestsByMemory || [],
                valueOf: (row: TopGuestRow): string => {
                  return formatBytes(row.memoryBytes);
                },
                percentOf: (row: TopGuestRow): number => {
                  if (
                    row.memoryPercent !== null &&
                    row.memoryPercent !== undefined
                  ) {
                    return row.memoryPercent;
                  }
                  const maxMemory: number =
                    inventory?.topGuestsByMemory[0]?.memoryBytes ?? 1;
                  return maxMemory > 0
                    ? ((row.memoryBytes ?? 0) / maxMemory) * 100
                    : 0;
                },
                barColorClass: "bg-purple-500",
              })}
            </div>
          </div>
        )}
      </Card>
    );
  };

  const renderResourceLinks: () => ReactElement = (): ReactElement => {
    const links: Array<{
      title: string;
      description: string;
      route: Route;
      count: number | undefined;
      icon: IconProp;
      iconBgClass: string;
      iconTextClass: string;
    }> = [
      {
        title: "Nodes",
        description: "Cluster nodes with status, CPU, memory, and uptime",
        route: nodesRoute,
        count: nodesTotal > 0 ? nodesTotal : undefined,
        icon: IconProp.ServerStack,
        iconBgClass: "bg-slate-100",
        iconTextClass: "text-slate-600",
      },
      {
        title: "Guests",
        description: "QEMU VMs and LXC containers with live resource usage",
        route: guestsRoute,
        count: guestsTotal > 0 ? guestsTotal : undefined,
        icon: IconProp.Cube,
        iconBgClass: "bg-emerald-100",
        iconTextClass: "text-emerald-600",
      },
      {
        title: "Storage",
        description: "Storage volumes with usage and capacity",
        route: storageRoute,
        count: storageCount > 0 ? storageCount : undefined,
        icon: IconProp.Database,
        iconBgClass: "bg-amber-100",
        iconTextClass: "text-amber-600",
      },
    ];

    return (
      <Card
        title="Resources"
        description="Explore the resources in this cluster."
      >
        {isInventoryLoading ? (
          <ComponentLoader />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4 pr-4 pl-1">
            {links.map(
              (link: {
                title: string;
                description: string;
                route: Route;
                count: number | undefined;
                icon: IconProp;
                iconBgClass: string;
                iconTextClass: string;
              }) => {
                return (
                  <div
                    key={link.title}
                    onClick={() => {
                      Navigation.navigate(link.route);
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
              },
            )}
          </div>
        )}
      </Card>
    );
  };

  const renderSummaryValue: (value: ReactElement) => ReactElement = (
    value: ReactElement,
  ): ReactElement => {
    if (isInventoryLoading) {
      return <span className="text-2xl font-semibold text-gray-300">…</span>;
    }
    if (inventoryError) {
      return <span className="text-2xl font-semibold text-gray-300">—</span>;
    }
    return value;
  };

  return (
    <Fragment>
      {renderHero()}

      {/* Golden metrics — at-a-glance cluster health */}
      {renderGoldenMetrics()}

      {/* Golden charts — cluster resource usage (synced) */}
      {renderGoldenCharts()}

      {/* Why is this cluster degraded? */}
      {renderWhyDegraded()}

      {/* Storage replication health (WI-25) */}
      {renderReplication()}

      {/* Linked Ceph cluster (WI-28) */}
      {renderCephStorage()}

      {/* Summary InfoCards */}
      {inventoryError && (
        <div className="mb-5">
          <ErrorMessage message={inventoryError} />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">
        <InfoCard
          title="Cluster Health"
          value={renderSummaryValue(
            <span
              className={`text-2xl font-semibold ${
                !isClusterConnected
                  ? "text-gray-500"
                  : clusterHealth === "Healthy"
                    ? "text-emerald-600"
                    : clusterHealth === "Degraded"
                      ? "text-amber-600"
                      : "text-red-600"
              }`}
            >
              {displayClusterHealth}
            </span>,
          )}
        />
        <InfoCard
          title="Quorum"
          value={renderSummaryValue(
            <span
              className={`text-2xl font-semibold ${
                quorumAtRisk ? "text-red-600" : "text-gray-900"
              }`}
              title="Derived from node visibility (online nodes ÷ total). pve-exporter exposes no corosync metric."
            >
              {nodesTotal > 0 ? `${nodesOnline}/${nodesTotal}` : "—"}
            </span>,
          )}
        />
        <InfoCard
          title="Nodes"
          onClick={() => {
            Navigation.navigate(nodesRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {nodesTotal.toString()}
              {nodesTotal > 0 && nodesOnline < nodesTotal && (
                <span className="text-sm text-red-500 ml-1">
                  ({nodesTotal - nodesOnline} offline)
                </span>
              )}
            </span>,
          )}
        />
        <InfoCard
          title="Guests"
          onClick={() => {
            Navigation.navigate(guestsRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {guestsTotal.toString()}
            </span>,
          )}
        />
        <InfoCard
          title="Storage"
          onClick={() => {
            Navigation.navigate(storageRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {storageCount.toString()}
            </span>,
          )}
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

      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="proxmoxClusters"
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        incidentsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_INCIDENTS] as Route,
          { modelId: modelId },
        )}
        alertsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_ALERTS] as Route,
          { modelId: modelId },
        )}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_SCHEDULED_MAINTENANCE] as Route,
          { modelId: modelId },
        )}
      />

      {/* Quick Navigation */}
      {renderResourceLinks()}

      {/* Top Resource Consumers */}
      {renderTopGuests()}

      {/* Cluster Details */}
      <CardModelDetail<ProxmoxCluster>
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
          description: "Basic information about this Proxmox cluster.",
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
            placeholder: "pve-production",
            description:
              "This should match the proxmox.cluster.name resource attribute reported by the Proxmox Agent.",
          },
          {
            field: {
              description: true,
            },
            stepId: "cluster-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Proxmox cluster running in US East",
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
          modelType: ProxmoxCluster,
          id: "proxmox-cluster-overview",
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
                pveVersion: true,
              },
              title: "PVE Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
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
              getElement: (item: ProxmoxCluster): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default ProxmoxClusterOverview;
