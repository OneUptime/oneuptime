import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
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

interface TopGuestRow {
  guestId: string;
  guestName: string;
  cpuPercent: number;
}

interface OverviewStats {
  nodesOnline: number;
  nodesTotal: number;
  guestsRunning: number;
  guestsTotal: number;
  storageCount: number;
  avgNodeCpu: number | null;
  memoryUsedPercent: number | null;
  memoryUsedBytes: number | null;
  memorySizeBytes: number | null;
  topGuestsByCpu: Array<TopGuestRow>;
}

const CLUSTER_ATTR: string = "resource.proxmox.cluster.name";
const ID_ATTR: string = "id";

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
 * Stats are computed from the latest datapoint per `id` label over a short
 * recent window — "what's happening right now" — mirroring the Docker
 * overview's tile semantics. pve-exporter keeps resource identity in the
 * `id` datapoint label (`node/...`, `qemu/...`, `lxc/...`, `storage/...`).
 */
const STATS_WINDOW_MINUTES: number = 5;

const ProxmoxClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string>("");

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    setIsRefreshing(true);
    setStatsError("");
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
        "pve_up",
        "pve_cpu_usage_ratio",
        "pve_memory_usage_bytes",
        "pve_memory_size_bytes",
        "pve_guest_info",
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

      // For each metric, take the latest value per `id` label.
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perId: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const id: string = (attrs[ID_ATTR] as string) || "";
          if (!id) {
            continue;
          }
          if (!perId.has(id)) {
            perId.set(id, metric);
          }
        }
        latestByMetric.set(name, perId);
      });

      const upById: Map<string, Metric> =
        latestByMetric.get("pve_up") || new Map();
      const cpuById: Map<string, Metric> =
        latestByMetric.get("pve_cpu_usage_ratio") || new Map();
      const memUsageById: Map<string, Metric> =
        latestByMetric.get("pve_memory_usage_bytes") || new Map();
      const memSizeById: Map<string, Metric> =
        latestByMetric.get("pve_memory_size_bytes") || new Map();
      const guestInfoById: Map<string, Metric> =
        latestByMetric.get("pve_guest_info") || new Map();

      const isGuestId: (id: string) => boolean = (id: string): boolean => {
        return id.startsWith("qemu/") || id.startsWith("lxc/");
      };

      let nodesOnline: number = 0;
      let nodesTotal: number = 0;
      let guestsRunning: number = 0;
      let guestsTotal: number = 0;
      let storageCount: number = 0;

      for (const [id, metric] of upById.entries()) {
        const isUp: boolean = Number(metric.value) >= 1;
        if (id.startsWith("node/")) {
          nodesTotal++;
          if (isUp) {
            nodesOnline++;
          }
        } else if (isGuestId(id)) {
          guestsTotal++;
          if (isUp) {
            guestsRunning++;
          }
        } else if (id.startsWith("storage/")) {
          storageCount++;
        }
      }

      // Average CPU across nodes (ratio 0..1 → %).
      let nodeCpuSum: number = 0;
      let nodeCpuCount: number = 0;
      for (const [id, metric] of cpuById.entries()) {
        if (!id.startsWith("node/")) {
          continue;
        }
        const v: number = Number(metric.value);
        if (!Number.isFinite(v)) {
          continue;
        }
        nodeCpuSum += v;
        nodeCpuCount++;
      }
      const avgNodeCpu: number | null =
        nodeCpuCount > 0 ? (nodeCpuSum / nodeCpuCount) * 100 : null;

      // Memory pressure across nodes — sum usage / sum size.
      let memUsedBytes: number = 0;
      let memSizeBytes: number = 0;
      for (const [id, metric] of memUsageById.entries()) {
        if (!id.startsWith("node/")) {
          continue;
        }
        const v: number = Number(metric.value);
        if (Number.isFinite(v)) {
          memUsedBytes += v;
        }
      }
      for (const [id, metric] of memSizeById.entries()) {
        if (!id.startsWith("node/")) {
          continue;
        }
        const v: number = Number(metric.value);
        if (Number.isFinite(v)) {
          memSizeBytes += v;
        }
      }
      const memoryUsedPercent: number | null =
        memSizeBytes > 0 ? (memUsedBytes / memSizeBytes) * 100 : null;

      // Top guests by CPU — name enriched from pve_guest_info labels.
      const guestRows: Array<TopGuestRow> = [];
      for (const [id, metric] of cpuById.entries()) {
        if (!isGuestId(id)) {
          continue;
        }
        const v: number = Number(metric.value);
        if (!Number.isFinite(v)) {
          continue;
        }
        const infoMetric: Metric | undefined = guestInfoById.get(id);
        const infoAttrs: Record<string, unknown> =
          (infoMetric?.attributes as Record<string, unknown>) || {};
        const guestName: string = (infoAttrs["name"] as string) || id;
        guestRows.push({
          guestId: id,
          guestName: guestName,
          cpuPercent: v * 100,
        });
      }
      const topGuestsByCpu: Array<TopGuestRow> = guestRows
        .sort((a: TopGuestRow, b: TopGuestRow) => {
          return b.cpuPercent - a.cpuPercent;
        })
        .slice(0, 5);

      setStats({
        nodesOnline: nodesOnline,
        nodesTotal: nodesTotal,
        guestsRunning: guestsRunning,
        guestsTotal: guestsTotal,
        storageCount: storageCount,
        avgNodeCpu: avgNodeCpu,
        memoryUsedPercent: memoryUsedPercent,
        memoryUsedBytes: memSizeBytes > 0 ? memUsedBytes : null,
        memorySizeBytes: memSizeBytes > 0 ? memSizeBytes : null,
        topGuestsByCpu: topGuestsByCpu,
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

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_LOGS] as Route,
    { modelId: modelId },
  );

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
      (cluster.name as string | undefined) || "Untitled Proxmox cluster";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (stats && stats.nodesTotal > 0) {
      specChips.push({
        icon: IconProp.ServerStack,
        label: `${stats.nodesOnline}/${stats.nodesTotal} node${stats.nodesTotal === 1 ? "" : "s"} online`,
      });
    }
    if (stats && stats.guestsTotal > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${stats.guestsRunning}/${stats.guestsTotal} guest${stats.guestsTotal === 1 ? "" : "s"} running`,
      });
    }
    if (cluster.pveVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: `PVE ${String(cluster.pveVersion)}`,
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
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
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

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          title="Nodes Online"
          icon={IconProp.ServerStack}
          iconColor="emerald"
          value={s.nodesTotal > 0 ? `${s.nodesOnline}/${s.nodesTotal}` : "—"}
          sublabel="cluster nodes"
        />
        <MetricTile
          title="Guests Running"
          icon={IconProp.Cube}
          iconColor="sky"
          value={s.guestsTotal > 0 ? `${s.guestsRunning}/${s.guestsTotal}` : "—"}
          sublabel="VMs and containers"
        />
        <MetricTile
          title="Storage Volumes"
          icon={IconProp.Database}
          iconColor="slate"
          value={s.storageCount > 0 ? String(s.storageCount) : "—"}
          sublabel="reporting"
        />
        <MetricTile
          title="Avg Node CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.avgNodeCpu)}
          sublabel="across nodes"
          percent={s.avgNodeCpu}
        />
        <MetricTile
          title="Memory Used"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.memoryUsedPercent)}
          sublabel={
            s.memoryUsedBytes !== null && s.memorySizeBytes !== null
              ? `${formatBytes(s.memoryUsedBytes)} of ${formatBytes(s.memorySizeBytes)}`
              : "of node memory"
          }
          percent={s.memoryUsedPercent}
          thresholds={{ warn: 80, danger: 95 }}
        />
      </div>
    );
  };

  const renderTopGuests: () => ReactElement = (): ReactElement => {
    if (!stats || stats.topGuestsByCpu.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title="Top CPU Consumers"
          description={`Top ${stats.topGuestsByCpu.length} guests by CPU usage (last ${STATS_WINDOW_MINUTES} minutes).`}
        >
          <div className="divide-y divide-gray-200">
            {stats.topGuestsByCpu.map((row: TopGuestRow) => {
              return (
                <div
                  key={row.guestId}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <Link
                      to={guestsRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                    >
                      {row.guestName}
                    </Link>
                    <div className="text-xs text-gray-400 font-mono">
                      {row.guestId}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatPercent(row.cpuPercent)}
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
        description="Jump to key views for this Proxmox cluster."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Link
            to={nodesRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Nodes</div>
            <div className="text-xs text-gray-500">
              Cluster nodes with status, CPU, memory, and uptime.
            </div>
          </Link>
          <Link
            to={guestsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Guests</div>
            <div className="text-xs text-gray-500">
              QEMU VMs and LXC containers with live resource usage.
            </div>
          </Link>
          <Link
            to={storageRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Storage</div>
            <div className="text-xs text-gray-500">
              Storage volumes with usage and capacity.
            </div>
          </Link>
          <Link
            to={metricsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Metrics</div>
            <div className="text-xs text-gray-500">
              Aggregated CPU, memory, storage, and network charts.
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
      {renderTopGuests()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<ProxmoxCluster>
        name="Proxmox Cluster Details"
        cardProps={{
          title: "Proxmox Cluster Details",
          description: "Overview of this Proxmox cluster.",
        }}
        modelDetailProps={{
          modelType: ProxmoxCluster,
          id: "proxmox-cluster-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
              showIf: (item: ProxmoxCluster): boolean => {
                return Boolean(item.name);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: ProxmoxCluster): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
              showIf: (item: ProxmoxCluster): boolean => {
                return Boolean(item.otelCollectorStatus);
              },
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: ProxmoxCluster): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                pveVersion: true,
              },
              title: "PVE Version",
              fieldType: FieldType.Text,
              showIf: (item: ProxmoxCluster): boolean => {
                return Boolean(item.pveVersion);
              },
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
              showIf: (item: ProxmoxCluster): boolean => {
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
              getElement: (item: ProxmoxCluster): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: ProxmoxCluster): boolean => {
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

export default ProxmoxClusterOverview;
