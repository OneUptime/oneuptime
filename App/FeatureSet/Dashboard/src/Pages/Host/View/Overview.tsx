import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ExpandableText from "Common/UI/Components/ExpandableText/ExpandableText";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
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
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface OverviewStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  filesystemPercent: number | null;
  load1m: number | null;
  processCount: number | null;
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

const HostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [host, setHost] = useState<Host | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState<boolean>(true);
  const [statsError, setStatsError] = useState<string>("");

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    setIsStatsLoading(true);
    setStatsError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          name: true,
          hostIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          dockerHostId: true,
          kubernetesClusterId: true,
          containerRuntime: true,
          cpuCores: true,
          totalMemoryBytes: true,
          osType: true,
          osVersion: true,
          hostArch: true,
          hostType: true,
          hostIpAddresses: true,
          labels: {
            name: true,
            color: true,
          },
        },
      });

      if (!item?.hostIdentifier) {
        setStatsError("Host not found.");
        setIsStatsLoading(false);
        return;
      }

      setHost(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);
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
      const [
        cpuUserResult,
        cpuSystemResult,
        memResult,
        fsResult,
        loadResult,
        procResult,
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
            "system.filesystem.utilization",
            AggregationType.Avg,
            { mountpoint: "/" },
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
          ),
        }),
      ]);

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
        let sum: number = 0;
        let count: number = 0;
        for (const p of points) {
          /*
           * Each bucket already holds an Avg over its 1-minute
           * window. Averaging those with equal weight is a
           * reasonable approximation of the 5-minute mean for
           * the dashboard tile (the windows are uniform). For
           * exact weighted means we'd need bucket sample counts;
           * the tile UX doesn't justify that precision.
           */
          const v: number = Number(p["value"]);
          if (!Number.isFinite(v)) {
            continue;
          }
          sum += v;
          count++;
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
          /*
           * AggregatedModel exposes the bucket timestamp on
           * `timestamp`. The MV statement aliases its time column to
           * `time`, so depending on the path either field may be
           * populated — read whichever is present rather than locking
           * to one and silently dropping every row.
           */
          const tRaw: unknown =
            p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
          const t: number =
            tRaw instanceof Date
              ? tRaw.getTime()
              : new Date(tRaw as string).getTime();
          if (Number.isFinite(t) && t > latestTime) {
            latestTime = t;
            latestVal = v;
          }
        }
        return latestVal;
      };

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

      setStats({
        cpuPercent: cpuPct,
        memoryPercent: meanFromBuckets(memResult, 100),
        filesystemPercent: meanFromBuckets(fsResult, 100),
        load1m: latestFromBuckets(loadResult),
        processCount: latestFromBuckets(procResult),
      });
    } catch (err) {
      setStatsError(API.getFriendlyMessage(err));
    }
    setIsStatsLoading(false);
  };

  useEffect(() => {
    fetchStats().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  }, []);

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

    const labelList: Array<Label> = (host["labels"] as Array<Label>) || [];

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
      specChips.push({
        icon: IconProp.Info,
        label: String(host.osVersion),
      });
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
      <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="relative">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
            aria-hidden="true"
          />
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

            {labelList.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <LabelsElement labels={labelList} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSummaryCards: () => ReactElement = (): ReactElement => {
    if (isStatsLoading) {
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

    const cpuSublabel: string | undefined =
      cores !== undefined
        ? `across ${cores} core${cores === 1 ? "" : "s"}`
        : undefined;
    const memSublabel: string | undefined =
      totalMem !== undefined ? `of ${formatMemoryBytes(totalMem)}` : undefined;

    const loadColor: number | null =
      cores && cores > 0 && s.load1m !== null ? (s.load1m / cores) * 100 : null;

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
          title="Load (1m)"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={formatNumber(s.load1m)}
          sublabel={
            cores !== undefined
              ? `across ${cores} core${cores === 1 ? "" : "s"}`
              : undefined
          }
          percent={loadColor}
          thresholds={{ warn: 70, danger: 100 }}
        />
        <MetricTile
          title="Processes"
          icon={IconProp.List}
          iconColor="slate"
          value={formatInt(s.processCount)}
          sublabel={s.processCount !== null ? "running" : undefined}
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
    const ipString: string = (item.hostIpAddresses as string) || "";
    if (!ipString) {
      return <span className="text-sm text-gray-400">—</span>;
    }
    const ips: Array<string> = ipString
      .split(",")
      .map((s: string) => {
        return s.trim();
      })
      .filter((s: string) => {
        return s.length > 0;
      });
    if (ips.length === 0) {
      return <span className="text-sm text-gray-400">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {ips.map((ip: string) => {
          return (
            <span
              key={ip}
              className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-mono text-gray-700"
            >
              {ip}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryCards()}
      <div className="mb-6">{renderCrossLinks()}</div>

      <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
        <CardModelDetail<Host>
          name="Identification"
          cardProps={{
            title: "Identification",
            description: "How this host is named and classified.",
          }}
          modelDetailProps={{
            modelType: Host,
            id: "host-identification",
            modelId: modelId,
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
                showIf: (item: Host): boolean => {
                  return Boolean(item.name);
                },
              },
              {
                field: {
                  hostIdentifier: true,
                },
                title: "Host Identifier",
                fieldType: FieldType.Text,
                showIf: (item: Host): boolean => {
                  return Boolean(item.hostIdentifier);
                },
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                fieldType: FieldType.Text,
                showIf: (item: Host): boolean => {
                  return Boolean(item.description);
                },
              },
              {
                field: {
                  hostType: true,
                },
                title: "Host Type",
                fieldType: FieldType.Text,
                showIf: (item: Host): boolean => {
                  return Boolean(item.hostType);
                },
              },
            ],
          }}
        />

        <CardModelDetail<Host>
          name="Operating System"
          cardProps={{
            title: "Operating System",
            description: "Operating system details reported by the agent.",
          }}
          modelDetailProps={{
            modelType: Host,
            id: "host-os",
            modelId: modelId,
            fields: [
              {
                field: {
                  osType: true,
                },
                title: "OS Type",
                fieldType: FieldType.Element,
                getElement: renderOsTypeChip,
                showIf: (item: Host): boolean => {
                  return Boolean(item.osType);
                },
              },
              {
                field: {
                  osVersion: true,
                },
                title: "OS Version",
                fieldType: FieldType.Element,
                getElement: (item: Host): ReactElement => {
                  const osVersion: string | undefined =
                    (item.osVersion as string | undefined) ?? undefined;
                  if (!osVersion) {
                    return <span className="text-sm text-gray-400">—</span>;
                  }
                  return (
                    <ExpandableText
                      text={osVersion}
                      maxLength={48}
                      className="text-sm text-gray-900"
                    />
                  );
                },
                showIf: (item: Host): boolean => {
                  return Boolean(item.osVersion);
                },
              },
              {
                field: {
                  hostArch: true,
                },
                title: "Architecture",
                fieldType: FieldType.Element,
                getElement: renderArchChip,
                showIf: (item: Host): boolean => {
                  return Boolean(item.hostArch);
                },
              },
            ],
          }}
        />

        <CardModelDetail<Host>
          name="Hardware & Runtime"
          cardProps={{
            title: "Hardware & Runtime",
            description: "CPU, memory, processes, and container runtime.",
          }}
          modelDetailProps={{
            modelType: Host,
            id: "host-hardware",
            modelId: modelId,
            showDetailsInNumberOfColumns: 2,
            fields: [
              {
                field: {
                  cpuCores: true,
                },
                title: "CPU Cores",
                fieldType: FieldType.Element,
                getElement: (item: Host): ReactElement => {
                  const cores: number | undefined =
                    (item.cpuCores as number | undefined) ?? undefined;
                  if (cores === undefined || cores === null) {
                    return <span className="text-sm text-gray-400">—</span>;
                  }
                  return (
                    <span className="text-sm text-gray-900">
                      {cores} core{cores === 1 ? "" : "s"}
                    </span>
                  );
                },
                showIf: (item: Host): boolean => {
                  return item.cpuCores !== undefined && item.cpuCores !== null;
                },
              },
              {
                field: {
                  totalMemoryBytes: true,
                },
                title: "Total Memory",
                fieldType: FieldType.Element,
                getElement: (item: Host): ReactElement => {
                  const bytes: number | undefined =
                    (item.totalMemoryBytes as number | undefined) ?? undefined;
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
                field: {
                  processCount: true,
                },
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
                field: {
                  containerRuntime: true,
                },
                title: "Container Runtime",
                fieldType: FieldType.Text,
                showIf: (item: Host): boolean => {
                  return Boolean(item.containerRuntime);
                },
              },
            ],
          }}
        />

        <CardModelDetail<Host>
          name="Network"
          cardProps={{
            title: "Network",
            description: "IP addresses observed on this host.",
          }}
          modelDetailProps={{
            modelType: Host,
            id: "host-network",
            modelId: modelId,
            fields: [
              {
                field: {
                  hostIpAddresses: true,
                },
                title: "IP Addresses",
                fieldType: FieldType.Element,
                getElement: renderIpAddresses,
                showIf: (item: Host): boolean => {
                  return Boolean(item.hostIpAddresses);
                },
              },
            ],
          }}
        />
      </div>
    </Fragment>
  );
};

export default HostOverview;
