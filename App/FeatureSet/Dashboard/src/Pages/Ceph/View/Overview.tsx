import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface TopPoolRow {
  poolKey: string;
  poolName: string;
  storedBytes: number;
}

/*
 * ceph_health_status is 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR.
 * null means no datapoint arrived in the stats window.
 */
type HealthState = "ok" | "warning" | "error" | "unknown";

interface OverviewStats {
  health: HealthState;
  osdsUp: number;
  osdsTotal: number;
  osdsIn: number;
  monsInQuorum: number;
  monsTotal: number;
  poolCount: number;
  pgDegraded: number | null;
  pgUndersized: number | null;
  usedBytes: number | null;
  totalBytes: number | null;
  usedPercent: number | null;
  topPoolsByStored: Array<TopPoolRow>;
}

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";
const OSD_ATTR: string = "ceph_daemon";
const POOL_ID_ATTR: string = "pool_id";
const POOL_NAME_ATTR: string = "name";

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatBytes: (bytes: number | null) => string = (
  bytes: number | null,
): string => {
  if (bytes === null || !isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
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
 * Stats are computed from the latest datapoint per series over a short
 * recent window — "what's happening right now" — mirroring the Docker /
 * Proxmox overview tile semantics. The ceph-mgr prometheus module keeps
 * OSD identity in the `ceph_daemon` datapoint label (`osd.3`) and pool
 * identity in the `pool_id` / `name` labels.
 */
const STATS_WINDOW_MINUTES: number = 5;

const CephClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string>("");

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    setIsRefreshing(true);
    setStatsError("");
    try {
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
        },
      });

      if (!item?.name) {
        setStatsError("Cluster not found.");
        setIsRefreshing(false);
        setIsInitialLoading(false);
        return;
      }

      setCluster(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -STATS_WINDOW_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const metricNames: Array<string> = [
        "ceph_health_status",
        "ceph_cluster_total_bytes",
        "ceph_cluster_total_used_bytes",
        "ceph_osd_up",
        "ceph_osd_in",
        "ceph_mon_quorum_status",
        "ceph_pg_degraded",
        "ceph_pg_undersized",
        "ceph_pool_stored",
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              [CLUSTER_ATTR]: item.name,
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
      };

      const results: Array<ListResult<Metric>> = await Promise.all(
        metricNames.map((n: string) => {
          return AnalyticsModelAPI.getList<Metric>(buildQuery(n));
        }),
      );

      const resultByMetric: Map<string, ListResult<Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        resultByMetric.set(name, results[idx]!);
      });

      /*
       * Latest value per series, keyed by the given datapoint label.
       * Results are sorted time-descending, so the first row per key
       * is the most recent.
       */
      const latestByLabel: (
        metricName: string,
        labelAttr: string,
      ) => Map<string, Metric> = (
        metricName: string,
        labelAttr: string,
      ): Map<string, Metric> => {
        const perKey: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> | undefined =
          resultByMetric.get(metricName);
        for (const metric of listResult?.data || []) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const key: string = String(attrs[labelAttr] ?? "");
          if (!key) {
            continue;
          }
          if (!perKey.has(key)) {
            perKey.set(key, metric);
          }
        }
        return perKey;
      };

      // Latest single value for cluster-wide gauges (no label dimension).
      const latestValue: (metricName: string) => number | null = (
        metricName: string,
      ): number | null => {
        const listResult: ListResult<Metric> | undefined =
          resultByMetric.get(metricName);
        for (const metric of listResult?.data || []) {
          const v: number = Number(metric.value);
          if (Number.isFinite(v)) {
            return v;
          }
        }
        return null;
      };

      const healthValue: number | null = latestValue("ceph_health_status");
      let health: HealthState = "unknown";
      if (healthValue !== null) {
        if (healthValue >= 2) {
          health = "error";
        } else if (healthValue >= 1) {
          health = "warning";
        } else {
          health = "ok";
        }
      }

      const totalBytes: number | null = latestValue("ceph_cluster_total_bytes");
      const usedBytes: number | null = latestValue(
        "ceph_cluster_total_used_bytes",
      );
      const usedPercent: number | null =
        totalBytes !== null && usedBytes !== null && totalBytes > 0
          ? (usedBytes / totalBytes) * 100
          : null;

      // OSD up / in counts — one series per `ceph_daemon` label.
      const osdUpById: Map<string, Metric> = latestByLabel(
        "ceph_osd_up",
        OSD_ATTR,
      );
      const osdInById: Map<string, Metric> = latestByLabel(
        "ceph_osd_in",
        OSD_ATTR,
      );
      let osdsUp: number = 0;
      for (const metric of osdUpById.values()) {
        if (Number(metric.value) >= 1) {
          osdsUp++;
        }
      }
      let osdsIn: number = 0;
      for (const metric of osdInById.values()) {
        if (Number(metric.value) >= 1) {
          osdsIn++;
        }
      }
      const osdsTotal: number = osdUpById.size;

      // Monitor quorum — one series per mon daemon; 1 = in quorum.
      const monById: Map<string, Metric> = latestByLabel(
        "ceph_mon_quorum_status",
        OSD_ATTR,
      );
      let monsInQuorum: number = 0;
      for (const metric of monById.values()) {
        if (Number(metric.value) >= 1) {
          monsInQuorum++;
        }
      }
      const monsTotal: number = monById.size;

      // PG problem counts are exported per pool — sum the latest per pool.
      const sumLatestPerPool: (metricName: string) => number | null = (
        metricName: string,
      ): number | null => {
        const perPool: Map<string, Metric> = latestByLabel(
          metricName,
          POOL_ID_ATTR,
        );
        if (perPool.size === 0) {
          // No pool label — fall back to the latest cluster-wide value.
          return latestValue(metricName);
        }
        let sum: number = 0;
        for (const metric of perPool.values()) {
          const v: number = Number(metric.value);
          if (Number.isFinite(v)) {
            sum += v;
          }
        }
        return sum;
      };

      const pgDegraded: number | null = sumLatestPerPool("ceph_pg_degraded");
      const pgUndersized: number | null =
        sumLatestPerPool("ceph_pg_undersized");

      // Top pools by stored bytes — name enriched from the `name` label.
      const poolStoredById: Map<string, Metric> = latestByLabel(
        "ceph_pool_stored",
        POOL_ID_ATTR,
      );
      const poolRows: Array<TopPoolRow> = [];
      for (const [poolId, metric] of poolStoredById.entries()) {
        const v: number = Number(metric.value);
        if (!Number.isFinite(v)) {
          continue;
        }
        const attrs: Record<string, unknown> =
          (metric.attributes as Record<string, unknown>) || {};
        const poolName: string =
          (attrs[POOL_NAME_ATTR] as string) || `pool ${poolId}`;
        poolRows.push({
          poolKey: poolId,
          poolName: poolName,
          storedBytes: v,
        });
      }
      const topPoolsByStored: Array<TopPoolRow> = poolRows
        .sort((a: TopPoolRow, b: TopPoolRow) => {
          return b.storedBytes - a.storedBytes;
        })
        .slice(0, 5);

      setStats({
        health: health,
        osdsUp: osdsUp,
        osdsTotal: osdsTotal,
        osdsIn: osdsIn,
        monsInQuorum: monsInQuorum,
        monsTotal: monsTotal,
        poolCount: poolStoredById.size,
        pgDegraded: pgDegraded,
        pgUndersized: pgUndersized,
        usedBytes: usedBytes,
        totalBytes: totalBytes,
        usedPercent: usedPercent,
        topPoolsByStored: topPoolsByStored,
      });
    } catch (err) {
      setStatsError(API.getFriendlyMessage(err));
    }
    setIsRefreshing(false);
    setIsInitialLoading(false);
  };

  useEffect(() => {
    fetchStats().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  }, []);

  const osdsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSDS] as Route,
    { modelId: modelId },
  );

  const poolsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOLS] as Route,
    { modelId: modelId },
  );

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_LOGS] as Route,
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

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (stats && stats.osdsTotal > 0) {
      specChips.push({
        icon: IconProp.Database,
        label: `${stats.osdsUp}/${stats.osdsTotal} OSD${stats.osdsTotal === 1 ? "" : "s"} up`,
      });
    }
    if (stats && stats.monsTotal > 0) {
      specChips.push({
        icon: IconProp.CheckCircle,
        label: `${stats.monsInQuorum}/${stats.monsTotal} mon${stats.monsTotal === 1 ? "" : "s"} in quorum`,
      });
    }
    if (stats && stats.poolCount > 0) {
      specChips.push({
        icon: IconProp.SquareStack,
        label: `${stats.poolCount} pool${stats.poolCount === 1 ? "" : "s"}`,
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
                    {stats && renderHealthPill(stats.health)}
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
                    fetchStats().catch(() => {});
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

    const pgProblemCount: number | null =
      s.pgDegraded === null && s.pgUndersized === null
        ? null
        : (s.pgDegraded || 0) + (s.pgUndersized || 0);

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          title="Capacity Used"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.usedPercent)}
          sublabel={
            s.usedBytes !== null && s.totalBytes !== null
              ? `${formatBytes(s.usedBytes)} of ${formatBytes(s.totalBytes)}`
              : "of raw capacity"
          }
          percent={s.usedPercent}
          thresholds={{ warn: 75, danger: 90 }}
        />
        <MetricTile
          title="OSDs Up"
          icon={IconProp.Database}
          iconColor="emerald"
          value={s.osdsTotal > 0 ? `${s.osdsUp}/${s.osdsTotal}` : "—"}
          sublabel={s.osdsTotal > 0 ? `${s.osdsIn} in` : "object storage daemons"}
        />
        <MetricTile
          title="Mons In Quorum"
          icon={IconProp.CheckCircle}
          iconColor="sky"
          value={s.monsTotal > 0 ? `${s.monsInQuorum}/${s.monsTotal}` : "—"}
          sublabel="monitor daemons"
        />
        <MetricTile
          title="Pools"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={s.poolCount > 0 ? String(s.poolCount) : "—"}
          sublabel="reporting"
        />
        <MetricTile
          title="Problem PGs"
          icon={IconProp.Alert}
          iconColor="amber"
          value={formatInt(pgProblemCount)}
          sublabel={
            pgProblemCount !== null
              ? `${formatInt(s.pgDegraded)} degraded, ${formatInt(s.pgUndersized)} undersized`
              : "degraded + undersized"
          }
        />
      </div>
    );
  };

  const renderTopPools: () => ReactElement = (): ReactElement => {
    if (!stats || stats.topPoolsByStored.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title="Largest Pools"
          description={`Top ${stats.topPoolsByStored.length} pools by stored bytes (last ${STATS_WINDOW_MINUTES} minutes).`}
        >
          <div className="divide-y divide-gray-200">
            {stats.topPoolsByStored.map((row: TopPoolRow) => {
              return (
                <div
                  key={row.poolKey}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <Link
                      to={poolsRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                    >
                      {row.poolName}
                    </Link>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatBytes(row.storedBytes)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
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
              Storage pools with stored bytes, capacity, and objects.
            </div>
          </Link>
          <Link
            to={metricsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Metrics</div>
            <div className="text-xs text-gray-500">
              Health, capacity, quorum, PG, and throughput charts.
            </div>
          </Link>
          <Link
            to={logsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Logs</div>
            <div className="text-xs text-gray-500">
              Logs ingested with this cluster&apos;s resource attributes.
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
