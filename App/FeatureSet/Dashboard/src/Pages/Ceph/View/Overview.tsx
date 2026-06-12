import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import StackedProgressBar, {
  StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import CephRateChart from "../../../Components/Ceph/CephRateChart";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import CephResourceUtils from "../Utils/CephResourceUtils";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * Ceph cluster overview hero (WI-8) — the Kubernetes View/Index.tsx
 * analog. Counts and health ride the CephCluster snapshot columns and
 * the CephResource Postgres inventory (single-source with the sidebar
 * badges); ClickHouse is only touched for the parts Postgres cannot
 * answer: the ceph_health_detail named-checks breakdown, the PG state
 * distribution, raw capacity bytes + the linear-fit growth projection,
 * and the golden charts. Each section has its own loader so a slow
 * ClickHouse never blanks the Postgres-served hero (K8s lesson: no
 * Promise.all gating across sections).
 */

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";

/*
 * ceph_health_status / healthStatus column: 0 = HEALTH_OK,
 * 1 = HEALTH_WARN, 2 = HEALTH_ERR. null means no batch carried the
 * health series yet.
 */
type HealthState = "ok" | "warning" | "error" | "unknown";

interface HealthCheckRow {
  name: string;
  severity: string;
}

interface PgStats {
  total: number | null;
  active: number | null;
  clean: number | null;
  degraded: number | null;
  undersized: number | null;
}

interface CapacityStats {
  totalBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
  /*
   * Days until used capacity crosses 85% of total (the default Ceph
   * nearfull ratio) assuming the linear growth observed over the
   * projection window. null = unknown; Infinity = not growing.
   */
  daysToNearfull: number | null;
}

interface OsdMatrix {
  upIn: number;
  upOut: number;
  downIn: number;
  downOut: number;
  total: number;
}

interface TopPoolRow {
  poolId: string;
  poolName: string;
  storedBytes: number | null;
  usedPercent: number | null;
}

const PROJECTION_WINDOW_HOURS: number = 24;
const NEARFULL_RATIO: number = 0.85;

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

const healthStateFromStatus: (
  healthStatus: number | undefined,
) => HealthState = (healthStatus: number | undefined): HealthState => {
  if (healthStatus === null || healthStatus === undefined) {
    return "unknown";
  }
  if (healthStatus >= 2) {
    return "error";
  }
  if (healthStatus >= 1) {
    return "warning";
  }
  return "ok";
};

const CephClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>("");

  // Inventory-backed sections (Postgres, instant).
  const [osdMatrix, setOsdMatrix] = useState<OsdMatrix | null>(null);
  const [monsInQuorum, setMonsInQuorum] = useState<number | null>(null);
  const [monsTotal, setMonsTotal] = useState<number | null>(null);
  const [topPoolsByStored, setTopPoolsByStored] = useState<Array<TopPoolRow>>(
    [],
  );
  const [topPoolsByUsed, setTopPoolsByUsed] = useState<Array<TopPoolRow>>([]);

  // ClickHouse-backed sections (best-effort).
  const [healthChecks, setHealthChecks] = useState<Array<HealthCheckRow>>([]);
  const [healthChecksAvailable, setHealthChecksAvailable] =
    useState<boolean>(false);
  const [pgStats, setPgStats] = useState<PgStats | null>(null);
  const [capacity, setCapacity] = useState<CapacityStats | null>(null);

  // Shared time range for the golden charts.
  const [chartTimeRange, setChartTimeRange] =
    useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_HOUR,
    });
  const [chartDateRange, setChartDateRange] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleChartTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setChartTimeRange(newTimeRange);
    setChartDateRange(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    const item: CephCluster | null = await ModelAPI.getItem({
      modelType: CephCluster,
      id: modelId,
      select: {
        name: true,
        description: true,
        fsid: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
        cephVersion: true,
        agentVersion: true,
        healthStatus: true,
        monCount: true,
        osdCount: true,
        osdUpCount: true,
        osdInCount: true,
        poolCount: true,
        capacityUsedPercent: true,
      },
    });

    if (!item?.name) {
      setPageError("Cluster not found.");
      return;
    }

    setCluster(item);
  };

  const fetchInventory: PromiseVoidFunction = async (): Promise<void> => {
    const rows: Array<CephResourceModel> =
      await CephResourceUtils.fetchCephResources({
        cephClusterId: modelId,
        kinds: ["Osd", "Pool", "Mon"],
      });

    const matrix: OsdMatrix = {
      upIn: 0,
      upOut: 0,
      downIn: 0,
      downOut: 0,
      total: 0,
    };
    let quorum: number = 0;
    let monTotal: number = 0;
    const pools: Array<TopPoolRow> = [];

    for (const row of rows) {
      if (row.kind === "Osd") {
        matrix.total++;
        if (row.isUp && row.isIn) {
          matrix.upIn++;
        } else if (row.isUp && !row.isIn) {
          matrix.upOut++;
        } else if (!row.isUp && row.isIn) {
          matrix.downIn++;
        } else {
          matrix.downOut++;
        }
      } else if (row.kind === "Mon") {
        monTotal++;
        if (row.inQuorum) {
          quorum++;
        }
      } else if (row.kind === "Pool") {
        const storedBytes: number | null = CephResourceUtils.freshMetricValue(
          row,
          row.storedBytes,
        );
        const maxAvailBytes: number | null = CephResourceUtils.freshMetricValue(
          row,
          row.maxAvailBytes,
        );
        const usedPercent: number | null =
          storedBytes !== null &&
          maxAvailBytes !== null &&
          storedBytes + maxAvailBytes > 0
            ? (storedBytes / (storedBytes + maxAvailBytes)) * 100
            : null;
        pools.push({
          poolId: row.externalId || "",
          poolName: row.name || `pool ${row.externalId || ""}`,
          storedBytes: storedBytes,
          usedPercent: usedPercent,
        });
      }
    }

    setOsdMatrix(matrix.total > 0 ? matrix : null);
    setMonsTotal(monTotal > 0 ? monTotal : null);
    setMonsInQuorum(monTotal > 0 ? quorum : null);
    setTopPoolsByStored(
      [...pools]
        .filter((p: TopPoolRow) => {
          return p.storedBytes !== null;
        })
        .sort((a: TopPoolRow, b: TopPoolRow) => {
          return (b.storedBytes || 0) - (a.storedBytes || 0);
        })
        .slice(0, 5),
    );
    setTopPoolsByUsed(
      [...pools]
        .filter((p: TopPoolRow) => {
          return p.usedPercent !== null;
        })
        .sort((a: TopPoolRow, b: TopPoolRow) => {
          return (b.usedPercent || 0) - (a.usedPercent || 0);
        })
        .slice(0, 5),
    );
  };

  type LatestPerLabel = Map<
    string,
    { value: number; attrs: Record<string, unknown> }
  >;

  const fetchLatestSeries: (
    clusterName: string,
    metricName: string,
    labelAttr: string,
    windowMinutes: number,
  ) => Promise<LatestPerLabel> = async (
    clusterName: string,
    metricName: string,
    labelAttr: string,
    windowMinutes: number,
  ): Promise<LatestPerLabel> => {
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveMinutes(
      endDate,
      -windowMinutes,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      modelType: Metric,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!.toString(),
        name: metricName,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          [CLUSTER_ATTR]: clusterName,
        },
      },
      limit: 500,
      skip: 0,
      select: {
        time: true,
        value: true,
        attributes: true,
      },
      sort: {
        time: SortOrder.Descending,
      },
      requestOptions: {},
    };

    const listResult: ListResult<Metric> =
      await AnalyticsModelAPI.getList<Metric>(queryOptions);

    /*
     * Results are sorted time-descending, so the first row per label
     * value is the most recent.
     */
    const perKey: LatestPerLabel = new Map();
    for (const metric of listResult.data) {
      const attrs: Record<string, unknown> =
        (metric.attributes as Record<string, unknown>) || {};
      const key: string = String(attrs[labelAttr] ?? "");
      if (!key && labelAttr) {
        continue;
      }
      if (!perKey.has(key)) {
        const v: number = Number(metric.value);
        if (Number.isFinite(v)) {
          perKey.set(key, { value: v, attrs: attrs });
        }
      }
    }
    return perKey;
  };

  const fetchHealthChecks: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      /*
       * ceph_health_detail (one series per named check, value 1 while
       * active) is exported by the mgr prometheus module on Quincy and
       * newer — render gracefully when absent on older releases.
       */
      const perCheck: LatestPerLabel = await fetchLatestSeries(
        clusterName,
        "ceph_health_detail",
        "name",
        10,
      );

      const active: Array<HealthCheckRow> = [];
      for (const [name, entry] of perCheck.entries()) {
        if (entry.value >= 1) {
          active.push({
            name: name,
            severity: String(entry.attrs["severity"] || ""),
          });
        }
      }
      active.sort((a: HealthCheckRow, b: HealthCheckRow) => {
        // HEALTH_ERR sorts above HEALTH_WARN.
        if (a.severity !== b.severity) {
          return a.severity.includes("ERR") ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setHealthChecksAvailable(perCheck.size > 0);
      setHealthChecks(active);
    } catch {
      // Best-effort — the breakdown card simply stays hidden.
    }
  };

  const fetchPgStats: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const metricNames: Array<string> = [
        "ceph_pg_total",
        "ceph_pg_active",
        "ceph_pg_clean",
        "ceph_pg_degraded",
        "ceph_pg_undersized",
      ];

      /*
       * PG counts are exported per pool on recent releases (pool_id
       * label) and cluster-wide on older ones — sum the latest per pool
       * with a cluster-wide fallback when no pool label exists.
       */
      const sums: Array<number | null> = await Promise.all(
        metricNames.map(async (metricName: string): Promise<number | null> => {
          const perPool: LatestPerLabel = await fetchLatestSeries(
            clusterName,
            metricName,
            "pool_id",
            10,
          );
          if (perPool.size === 0) {
            const clusterWide: LatestPerLabel = await fetchLatestSeries(
              clusterName,
              metricName,
              "",
              10,
            );
            const entry: { value: number } | undefined = clusterWide.get("");
            return entry ? entry.value : null;
          }
          let sum: number = 0;
          for (const entry of perPool.values()) {
            sum += entry.value;
          }
          return sum;
        }),
      );

      setPgStats({
        total: sums[0] ?? null,
        active: sums[1] ?? null,
        clean: sums[2] ?? null,
        degraded: sums[3] ?? null,
        undersized: sums[4] ?? null,
      });
    } catch {
      // Best-effort — the PG card simply stays hidden.
    }
  };

  const fetchCapacity: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(
        endDate,
        -PROJECTION_WINDOW_HOURS,
      );

      const aggregateUsed: AggregatedResult =
        await AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              time: new InBetween(startDate, endDate),
              name: "ceph_cluster_total_used_bytes",
              attributes: {
                [CLUSTER_ATTR]: clusterName,
              } as Dictionary<string | number | boolean>,
            },
            aggregationType: AggregationType.Avg,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: startDate,
            endTimestamp: endDate,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          },
        });

      type Sample = { t: number; v: number };
      const samples: Array<Sample> = [];
      for (const p of (aggregateUsed.data || []) as Array<AggregatedModel>) {
        const raw: unknown =
          p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
        const t: number =
          raw instanceof Date
            ? raw.getTime()
            : new Date(raw as string).getTime();
        const v: number = Number(p["value"]);
        if (Number.isFinite(t) && Number.isFinite(v)) {
          samples.push({ t, v });
        }
      }
      samples.sort((a: Sample, b: Sample) => {
        return a.t - b.t;
      });

      const latestTotal: LatestPerLabel = await fetchLatestSeries(
        clusterName,
        "ceph_cluster_total_bytes",
        "",
        10,
      );
      const totalBytes: number | null = latestTotal.get("")?.value ?? null;
      const usedBytes: number | null =
        samples.length > 0 ? samples[samples.length - 1]!.v : null;
      const usedPercent: number | null =
        totalBytes !== null && usedBytes !== null && totalBytes > 0
          ? (usedBytes / totalBytes) * 100
          : null;

      /*
       * Least-squares linear fit of used bytes over the projection
       * window → growth in bytes/ms → "85% (nearfull) in ~N days".
       * Pure client math, no server-side forecasting (K8s raw-fetch
       * precedent).
       */
      let daysToNearfull: number | null = null;
      if (samples.length >= 3 && totalBytes !== null && usedBytes !== null) {
        const n: number = samples.length;
        const meanT: number =
          samples.reduce((sum: number, s: Sample) => {
            return sum + s.t;
          }, 0) / n;
        const meanV: number =
          samples.reduce((sum: number, s: Sample) => {
            return sum + s.v;
          }, 0) / n;
        let num: number = 0;
        let den: number = 0;
        for (const s of samples) {
          num += (s.t - meanT) * (s.v - meanV);
          den += (s.t - meanT) * (s.t - meanT);
        }
        const slopePerMs: number = den > 0 ? num / den : 0;
        const targetBytes: number = NEARFULL_RATIO * totalBytes;
        if (usedBytes >= targetBytes) {
          daysToNearfull = 0;
        } else if (slopePerMs > 0) {
          daysToNearfull =
            (targetBytes - usedBytes) / (slopePerMs * 1000 * 60 * 60 * 24);
        } else {
          daysToNearfull = Number.POSITIVE_INFINITY;
        }
      }

      setCapacity({
        totalBytes: totalBytes,
        usedBytes: usedBytes,
        usedPercent: usedPercent,
        daysToNearfull: daysToNearfull,
      });
    } catch {
      // Best-effort — the tile falls back to the snapshot column.
    }
  };

  const fetchAll: PromiseVoidFunction = async (): Promise<void> => {
    setIsRefreshing(true);
    setPageError("");
    try {
      await fetchCluster();
    } catch (err) {
      setPageError(API.getFriendlyMessage(err));
      setIsRefreshing(false);
      setIsInitialLoading(false);
      return;
    }
    setIsInitialLoading(false);

    // Inventory is Postgres-fast; failures only blank its sections.
    fetchInventory().catch(() => {});

    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchAll().catch((err: Error) => {
      setPageError(API.getFriendlyMessage(err));
    });
  }, []);

  // ClickHouse sections load independently once the cluster name is known.
  useEffect(() => {
    if (!cluster?.name) {
      return;
    }
    fetchHealthChecks(cluster.name).catch(() => {});
    fetchPgStats(cluster.name).catch(() => {});
    fetchCapacity(cluster.name).catch(() => {});
  }, [cluster?.name]);

  const osdsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSDS] as Route,
    { modelId: modelId },
  );
  const poolsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOLS] as Route,
    { modelId: modelId },
  );
  const daemonsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_DAEMONS] as Route,
    { modelId: modelId },
  );
  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  const renderHealthPill: (health: HealthState) => ReactElement = (
    health: HealthState,
  ): ReactElement => {
    const pill: { label: string; badge: string; dot: string } = (() => {
      switch (health) {
        case "ok":
          return {
            label: "Health OK",
            badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
            dot: "bg-emerald-500",
          };
        case "warning":
          return {
            label: "Health Warning",
            badge: "bg-amber-50 text-amber-700 ring-amber-200",
            dot: "bg-amber-500",
          };
        case "error":
          return {
            label: "Health Error",
            badge: "bg-red-50 text-red-700 ring-red-200",
            dot: "bg-red-500",
          };
        default:
          return {
            label: "Health Unknown",
            badge: "bg-gray-50 text-gray-600 ring-gray-200",
            dot: "bg-gray-400",
          };
      }
    })();

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.badge}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
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
      (cluster.name as string | undefined) || "Untitled Ceph cluster";

    const health: HealthState = healthStateFromStatus(cluster.healthStatus);

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (cluster.osdCount) {
      specChips.push({
        icon: IconProp.Database,
        label: `${cluster.osdUpCount || 0}/${cluster.osdCount} OSD${cluster.osdCount === 1 ? "" : "s"} up`,
      });
    }
    if (monsTotal !== null) {
      specChips.push({
        icon: IconProp.CheckCircle,
        label: `${monsInQuorum || 0}/${monsTotal} mon${monsTotal === 1 ? "" : "s"} in quorum`,
      });
    } else if (cluster.monCount) {
      specChips.push({
        icon: IconProp.CheckCircle,
        label: `${cluster.monCount} mon${cluster.monCount === 1 ? "" : "s"}`,
      });
    }
    if (cluster.poolCount) {
      specChips.push({
        icon: IconProp.SquareStack,
        label: `${cluster.poolCount} pool${cluster.poolCount === 1 ? "" : "s"}`,
      });
    }
    if (cluster.cephVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: String(cluster.cephVersion),
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
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-red-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-red-200 shadow-sm">
                  <Icon
                    icon={IconProp.Database}
                    className="h-6 w-6 text-red-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    {renderHealthPill(health)}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
                  </div>
                  {cluster.fsid && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {String(cluster.fsid)}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    Last seen {lastSeenText}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
                <button
                  type="button"
                  onClick={() => {
                    fetchAll().catch(() => {});
                  }}
                  disabled={isRefreshing}
                  title="Refresh now"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon
                    icon={IconProp.Refresh}
                    className={`h-3.5 w-3.5 ${
                      isRefreshing
                        ? "animate-spin text-gray-400"
                        : "text-gray-500"
                    }`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
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

  /*
   * "Why is this cluster unhealthy?" — active ceph_health_detail checks
   * (e.g. OSD_DOWN, PG_DEGRADED) with their severity. Gracefully points
   * at the metric's availability when the series is absent (pre-Quincy
   * mgr modules don't export it).
   */
  const renderHealthChecks: () => ReactElement = (): ReactElement => {
    const health: HealthState = healthStateFromStatus(cluster?.healthStatus);

    if (health === "ok" || health === "unknown") {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title="Active Health Checks"
          description="Named checks currently raised by the cluster — the reason behind the health state."
        >
          {healthChecks.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {healthChecks.map((check: HealthCheckRow) => {
                const isErr: boolean = check.severity.includes("ERR");
                return (
                  <div
                    key={check.name}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="font-mono text-sm font-medium text-gray-900">
                      {check.name}
                    </div>
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                        isErr
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {check.severity || "HEALTH_WARN"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              {healthChecksAvailable
                ? "No active checks reported in the last 10 minutes."
                : "Check details are unavailable — the ceph_health_detail metric is exported by the ceph-mgr prometheus module on Ceph Quincy and newer. Run `ceph health detail` on the cluster for the full breakdown."}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderGoldenTiles: () => ReactElement = (): ReactElement => {
    if (!cluster) {
      return <Fragment />;
    }

    const usedPercent: number | null =
      capacity?.usedPercent ??
      (cluster.capacityUsedPercent !== null &&
      cluster.capacityUsedPercent !== undefined
        ? Number(cluster.capacityUsedPercent)
        : null);

    const capacitySublabel: string = (() => {
      if (
        capacity?.usedBytes !== null &&
        capacity?.usedBytes !== undefined &&
        capacity?.totalBytes !== null &&
        capacity?.totalBytes !== undefined
      ) {
        const base: string = `${CephResourceUtils.formatBytes(capacity.usedBytes)} of ${CephResourceUtils.formatBytes(capacity.totalBytes)}`;
        if (capacity.daysToNearfull === null) {
          return base;
        }
        if (capacity.daysToNearfull === 0) {
          return `${base} — above 85% nearfull`;
        }
        if (!Number.isFinite(capacity.daysToNearfull)) {
          return `${base} — not growing`;
        }
        if (capacity.daysToNearfull > 365) {
          return `${base} — 85% in >1 year`;
        }
        return `${base} — 85% in ~${Math.max(1, Math.round(capacity.daysToNearfull))}d at current growth`;
      }
      return "of raw capacity";
    })();

    const osdTotal: number = cluster.osdCount || 0;
    const osdUp: number = cluster.osdUpCount || 0;
    const osdIn: number = cluster.osdInCount || 0;

    const pgProblemCount: number | null =
      pgStats === null
        ? null
        : (pgStats.degraded || 0) + (pgStats.undersized || 0);

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <GoldenMetricTile
          title="Capacity Used"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(usedPercent)}
          sublabel={capacitySublabel}
          percent={usedPercent}
          thresholds={{ warn: 75, danger: 85 }}
        />
        <GoldenMetricTile
          title="OSDs Up"
          icon={IconProp.Database}
          iconColor="emerald"
          value={osdTotal > 0 ? `${osdUp}/${osdTotal}` : "—"}
          sublabel={osdTotal > 0 ? `${osdIn} in` : "object storage daemons"}
          percent={osdTotal > 0 ? (osdUp / osdTotal) * 100 : null}
          thresholds={{ warn: 100, danger: 90 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Mons In Quorum"
          icon={IconProp.CheckCircle}
          iconColor="sky"
          value={
            monsTotal !== null
              ? `${monsInQuorum || 0}/${monsTotal}`
              : cluster.monCount
                ? String(cluster.monCount)
                : "—"
          }
          sublabel="monitor daemons"
        />
        <GoldenMetricTile
          title="Pools"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={cluster.poolCount ? String(cluster.poolCount) : "—"}
          sublabel="reporting"
        />
        <GoldenMetricTile
          title="Problem PGs"
          icon={IconProp.Alert}
          iconColor="amber"
          value={formatInt(pgProblemCount)}
          sublabel={
            pgStats !== null
              ? `${formatInt(pgStats.degraded)} degraded, ${formatInt(pgStats.undersized)} undersized`
              : "degraded + undersized"
          }
        />
      </div>
    );
  };

  /*
   * OSD up/in matrix — client-side join of the inventory's isUp × isIn
   * flags (themselves the latest ceph_osd_up × ceph_osd_in values per
   * daemon). down&in is the dangerous quadrant: data placement still
   * expects those OSDs.
   */
  const renderOsdMatrix: () => ReactElement = (): ReactElement => {
    if (!osdMatrix) {
      return <Fragment />;
    }

    const cells: Array<{
      label: string;
      sublabel: string;
      count: number;
      className: string;
    }> = [
      {
        label: "Up + In",
        sublabel: "healthy",
        count: osdMatrix.upIn,
        className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      },
      {
        label: "Up + Out",
        sublabel: "draining / rebalancing",
        count: osdMatrix.upOut,
        className: "bg-sky-50 text-sky-800 ring-sky-200",
      },
      {
        label: "Down + In",
        sublabel: "failed but still mapped",
        count: osdMatrix.downIn,
        className: "bg-red-50 text-red-800 ring-red-200",
      },
      {
        label: "Down + Out",
        sublabel: "removed from placement",
        count: osdMatrix.downOut,
        className: "bg-gray-50 text-gray-700 ring-gray-200",
      },
    ];

    return (
      <div className="mb-6">
        <Card
          title="OSD States"
          description={`Up/in matrix across ${osdMatrix.total} OSD${osdMatrix.total === 1 ? "" : "s"}.`}
          rightElement={
            <Link
              to={osdsRoute}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
            >
              View OSDs
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cells.map(
              (cell: {
                label: string;
                sublabel: string;
                count: number;
                className: string;
              }): ReactElement => {
                return (
                  <div
                    key={cell.label}
                    className={`rounded-lg p-4 ring-1 ring-inset ${cell.className}`}
                  >
                    <div className="text-2xl font-semibold leading-none">
                      {cell.count}
                    </div>
                    <div className="mt-1 text-sm font-medium">{cell.label}</div>
                    <div className="text-xs opacity-75">{cell.sublabel}</div>
                  </div>
                );
              },
            )}
          </div>
        </Card>
      </div>
    );
  };

  const renderPgDistribution: () => ReactElement = (): ReactElement => {
    if (!pgStats || pgStats.total === null || pgStats.total <= 0) {
      return <Fragment />;
    }

    const total: number = pgStats.total;
    const clean: number = pgStats.clean || 0;
    const degraded: number = pgStats.degraded || 0;
    const undersized: number = pgStats.undersized || 0;
    const other: number = Math.max(0, total - clean - degraded - undersized);

    const segments: Array<StackedProgressBarSegment> = [
      {
        value: clean,
        color: "bg-emerald-500",
        label: "Active + Clean",
      },
      {
        value: degraded,
        color: "bg-amber-500",
        label: "Degraded",
      },
      {
        value: undersized,
        color: "bg-orange-500",
        label: "Undersized",
      },
      {
        value: other,
        color: "bg-gray-400",
        label: "Other",
      },
    ];

    return (
      <div className="mb-6">
        <Card
          title="Placement Group States"
          description={`${Math.round(total)} placement groups (${formatInt(pgStats.active)} active).`}
        >
          <StackedProgressBar segments={segments} totalValue={total} />
        </Card>
      </div>
    );
  };

  const renderGoldenCharts: () => ReactElement = (): ReactElement => {
    if (!cluster?.name) {
      return <Fragment />;
    }

    const clusterName: string = cluster.name;

    const capacityQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_used_bytes",
        title: "Capacity Used",
        description: "Raw storage used across all OSDs (bytes).",
        legend: "Used",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_cluster_total_used_bytes",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const latencyQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "osd_apply_latency",
        title: "Average OSD Apply Latency",
        description: "Apply latency averaged across all OSDs (ms).",
        legend: "Apply",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_osd_apply_latency_ms",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const commitLatencyQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "osd_commit_latency",
        title: "Average OSD Commit Latency",
        description: "Commit latency averaged across all OSDs (ms).",
        legend: "Commit",
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_osd_commit_latency_ms",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const gaugeViewData: MetricViewData = {
      startAndEndDate: chartDateRange,
      queryConfigs: [capacityQuery, latencyQuery, commitLatencyQuery],
      formulaConfigs: [],
    };

    return (
      <div className="mb-6">
        <Card
          title="Golden Signals"
          description="Capacity, client I/O, and OSD latency for this cluster."
          rightElement={
            <RangeStartAndEndDateView
              dashboardStartAndEndDate={chartTimeRange}
              onChange={handleChartTimeRangeChange}
            />
          }
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">
                  Client IOPS
                </div>
                <CephRateChart
                  clusterName={clusterName}
                  series={[
                    { metricName: "ceph_pool_rd", label: "Read" },
                    { metricName: "ceph_pool_wr", label: "Write" },
                  ]}
                  seriesKeyAttributes={["pool_id"]}
                  startDate={chartDateRange.startValue}
                  endDate={chartDateRange.endValue}
                  heightInPx={220}
                  syncId={`ceph-overview-${clusterName}`}
                  emptyMessage="No client I/O reported in the selected time range."
                />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">
                  Client Throughput
                </div>
                <CephRateChart
                  clusterName={clusterName}
                  series={[
                    { metricName: "ceph_pool_rd_bytes", label: "Read" },
                    { metricName: "ceph_pool_wr_bytes", label: "Write" },
                  ]}
                  seriesKeyAttributes={["pool_id"]}
                  startDate={chartDateRange.startValue}
                  endDate={chartDateRange.endValue}
                  yAxisUnit="By/s"
                  heightInPx={220}
                  syncId={`ceph-overview-${clusterName}`}
                  emptyMessage="No throughput reported in the selected time range."
                />
              </div>
            </div>
            <MetricView
              data={gaugeViewData}
              hideQueryElements={true}
              hideStartAndEndDate={true}
              hideCardInCharts={true}
              onChange={() => {}}
            />
          </div>
        </Card>
      </div>
    );
  };

  const renderTopPoolList: (
    title: string,
    description: string,
    rows: Array<TopPoolRow>,
    renderValue: (row: TopPoolRow) => string,
  ) => ReactElement = (
    title: string,
    description: string,
    rows: Array<TopPoolRow>,
    renderValue: (row: TopPoolRow) => string,
  ): ReactElement => {
    return (
      <Card title={title} description={description}>
        {rows.length === 0 ? (
          <div className="text-sm text-gray-500">
            No pools in the inventory yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rows.map((row: TopPoolRow) => {
              const detailRoute: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route,
                {
                  modelId: modelId,
                  subModelId: new ObjectID(row.poolId),
                },
              );
              return (
                <div
                  key={row.poolId}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <Link
                      to={detailRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                    >
                      {row.poolName}
                    </Link>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {renderValue(row)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  const renderTopPools: () => ReactElement = (): ReactElement => {
    if (topPoolsByStored.length === 0 && topPoolsByUsed.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {renderTopPoolList(
          "Largest Pools",
          "Top pools by stored bytes.",
          topPoolsByStored,
          (row: TopPoolRow) => {
            return CephResourceUtils.formatBytes(row.storedBytes);
          },
        )}
        {renderTopPoolList(
          "Fullest Pools",
          "Top pools by used capacity (stored / (stored + max avail)).",
          topPoolsByUsed,
          (row: TopPoolRow) => {
            return formatPercent(row.usedPercent);
          },
        )}
      </div>
    );
  };

  const renderQuickLinks: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title="Quick Links"
        description="Jump to key views for this Ceph cluster."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to={osdsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">OSDs</div>
            <div className="text-xs text-gray-500">
              Object storage daemons with up / in state.
            </div>
          </Link>
          <Link
            to={poolsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Pools</div>
            <div className="text-xs text-gray-500">
              Storage pools with stored bytes, capacity, and IOPS.
            </div>
          </Link>
          <Link
            to={daemonsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Daemons</div>
            <div className="text-xs text-gray-500">
              Mon / mgr / mds / rgw daemons with quorum status.
            </div>
          </Link>
          <Link
            to={metricsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Metrics</div>
            <div className="text-xs text-gray-500">
              Explore every metric this cluster reports.
            </div>
          </Link>
        </div>
      </Card>
    );
  };

  if (isInitialLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  return (
    <Fragment>
      {renderHero()}
      {renderHealthChecks()}
      {renderGoldenTiles()}
      {renderOsdMatrix()}
      {renderPgDistribution()}
      {renderGoldenCharts()}
      {renderTopPools()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<CephCluster>
        name="Ceph Cluster Details"
        cardProps={{
          title: "Ceph Cluster Details",
          description: "Overview of this Ceph cluster.",
        }}
        modelDetailProps={{
          modelType: CephCluster,
          id: "ceph-cluster-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.name);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                fsid: true,
              },
              title: "Cluster fsid",
              fieldType: FieldType.Text,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.fsid);
              },
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.otelCollectorStatus);
              },
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                cephVersion: true,
              },
              title: "Ceph Version",
              fieldType: FieldType.Text,
              showIf: (item: CephCluster): boolean => {
                return Boolean(item.cephVersion);
              },
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
              showIf: (item: CephCluster): boolean => {
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
              getElement: (item: CephCluster): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: CephCluster): boolean => {
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

export default CephClusterOverview;
