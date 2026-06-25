import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResourceModel from "Common/Models/DatabaseModels/DockerSwarmResource";
import Card from "Common/UI/Components/Card/Card";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import OneUptimeDate from "Common/Types/Date";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  fetchDockerSwarmInventoryRows,
  routeParamFromExternalId,
  displayNameForResource,
} from "../Utils/DockerSwarmResourceUtils";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";

type ClusterHealth = "Healthy" | "Degraded" | "Unhealthy";

interface DegradedItem {
  kind: "Node" | "Service" | "Task";
  // Detail-page link target externalId (empty = unclickable row).
  externalId: string;
  name: string;
  reasons: Array<string>;
  // true = drives Unhealthy (red), false = drives Degraded (amber).
  isCritical: boolean;
}

interface InventorySummary {
  nodesReady: number;
  nodesTotal: number;
  servicesConverged: number;
  servicesTotal: number;
  tasksRunning: number;
  tasksTotal: number;
  stackCount: number;
  networkCount: number;
  secretCount: number;
  configCount: number;
  volumeCount: number;
  managerCount: number;
  degradedItems: Array<DegradedItem>;
  health: ClusterHealth;
}

const DockerSwarmClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [inventory, setInventory] = useState<InventorySummary | null>(null);

  /*
   * Inventory-derived summary — health, counts, and the "why degraded?"
   * drill-down all come from the DockerSwarmResource Postgres table
   * (instant; no ClickHouse), the same rows the sidebar badges and list
   * pages use, so they can never drift.
   */
  const loadInventory: PromiseVoidFunction = async (): Promise<void> => {
    setInventoryError("");
    try {
      const rows: Array<DockerSwarmResourceModel> =
        await fetchDockerSwarmInventoryRows({
          dockerSwarmClusterId: modelId,
        });

      let nodesReady: number = 0;
      let nodesTotal: number = 0;
      let managerCount: number = 0;
      let servicesConverged: number = 0;
      let servicesTotal: number = 0;
      let tasksRunning: number = 0;
      let tasksTotal: number = 0;
      let stackCount: number = 0;
      let networkCount: number = 0;
      let secretCount: number = 0;
      let configCount: number = 0;
      let volumeCount: number = 0;
      const degradedItems: Array<DegradedItem> = [];

      for (const row of rows) {
        const name: string = displayNameForResource(row);
        const externalId: string = row.externalId || "";

        if (row.kind === "Node") {
          nodesTotal++;
          if (row.role === "manager") {
            managerCount++;
          }
          if (row.isReady) {
            nodesReady++;
          } else if (row.isReady === false) {
            degradedItems.push({
              kind: "Node",
              externalId,
              name,
              reasons: [row.state ? `Node ${row.state}` : "Node not ready"],
              isCritical: true,
            });
          }
        } else if (row.kind === "Service") {
          servicesTotal++;
          if (row.isReady) {
            servicesConverged++;
          } else if (row.isReady === false) {
            const running: number = Number(row.runningReplicas ?? 0);
            const desired: number | null =
              row.desiredReplicas !== null && row.desiredReplicas !== undefined
                ? Number(row.desiredReplicas)
                : null;
            degradedItems.push({
              kind: "Service",
              externalId,
              name,
              reasons: [
                desired !== null
                  ? `${running}/${desired} replicas running`
                  : "Service not converged",
              ],
              isCritical: false,
            });
          }
        } else if (row.kind === "Task") {
          tasksTotal++;
          const state: string = (row.state || "").toLowerCase();
          if (state === "running") {
            tasksRunning++;
          } else if (
            state === "failed" ||
            state === "rejected" ||
            state === "orphaned"
          ) {
            degradedItems.push({
              kind: "Task",
              externalId,
              name,
              reasons: [`Task ${row.state}`],
              isCritical: false,
            });
          }
        } else if (row.kind === "Stack") {
          stackCount++;
        } else if (row.kind === "Network") {
          networkCount++;
        } else if (row.kind === "Secret") {
          secretCount++;
        } else if (row.kind === "Config") {
          configCount++;
        } else if (row.kind === "Volume") {
          volumeCount++;
        }
      }

      /*
       * Health: Unhealthy when any node is not ready; Degraded when a
       * service is not converged or a task has failed; Healthy otherwise.
       */
      let health: ClusterHealth = "Healthy";
      if (
        degradedItems.some((item: DegradedItem) => {
          return item.isCritical;
        })
      ) {
        health = "Unhealthy";
      } else if (degradedItems.length > 0) {
        health = "Degraded";
      }

      setInventory({
        nodesReady,
        nodesTotal,
        servicesConverged,
        servicesTotal,
        tasksRunning,
        tasksTotal,
        stackCount,
        networkCount,
        secretCount,
        configCount,
        volumeCount,
        managerCount,
        degradedItems,
        health,
      });
    } catch (err) {
      // Surface the failure instead of rendering misleading zero counts.
      setInventoryError(API.getFriendlyMessage(err));
    } finally {
      setIsInventoryLoading(false);
    }
  };

  const fetchCluster: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    try {
      const item: DockerSwarmCluster | null = await ModelAPI.getItem({
        modelType: DockerSwarmCluster,
        id: modelId,
        select: {
          name: true,
          description: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          dockerVersion: true,
          agentVersion: true,
          swarmId: true,
          nodeCount: true,
          readyNodeCount: true,
          managerNodeCount: true,
          serviceCount: true,
          taskCount: true,
          runningTaskCount: true,
          stackCount: true,
          networkCount: true,
        },
      });
      setCluster(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setIsLoading(false);
      setIsRefreshing(false);

      if (item?.name) {
        void loadInventory();
      } else {
        setIsInventoryLoading(false);
      }
    } catch (err) {
      /*
       * A background refresh keeps the current view; only the initial load
       * escalates a failure to a full-page error.
       */
      if (showLoader) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
      setIsRefreshing(false);
      setIsInventoryLoading(false);
    }
  };

  useEffect(() => {
    fetchCluster(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "docker-swarm-overview-auto-refresh-interval",
    onRefresh: (): void => {
      fetchCluster(false).catch(() => {});
    },
  });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  // Inventory-first, cached snapshot columns as fallback.
  const nodesTotal: number = inventory?.nodesTotal || cluster.nodeCount || 0;
  const nodesReady: number = inventory
    ? inventory.nodesReady
    : cluster.readyNodeCount || 0;
  const managerCount: number = inventory
    ? inventory.managerCount
    : cluster.managerNodeCount || 0;
  const servicesTotal: number =
    inventory?.servicesTotal || cluster.serviceCount || 0;
  const tasksTotal: number = inventory?.tasksTotal || cluster.taskCount || 0;
  const tasksRunning: number = inventory
    ? inventory.tasksRunning
    : cluster.runningTaskCount || 0;
  const stackCount: number = inventory?.stackCount || cluster.stackCount || 0;
  const networkCount: number =
    inventory?.networkCount || cluster.networkCount || 0;

  const clusterHealth: ClusterHealth = inventory?.health || "Healthy";
  const degradedItems: Array<DegradedItem> = inventory?.degradedItems || [];

  const navigateToDetail: (item: DegradedItem) => void = (
    item: DegradedItem,
  ): void => {
    if (!item.externalId) {
      return;
    }
    const pageMap: PageMap =
      item.kind === "Node"
        ? PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL
        : item.kind === "Service"
          ? PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL
          : PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL;
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
        modelId: modelId,
        subModelId: routeParamFromExternalId(item.externalId),
      }),
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
      (cluster.name as string | undefined) || "Untitled Docker Swarm cluster";

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
        label: `${nodesReady}/${nodesTotal} node${
          nodesTotal === 1 ? "" : "s"
        } ready`,
      });
    }
    if (managerCount > 0) {
      specChips.push({
        icon: IconProp.Star,
        label: `${managerCount} manager${managerCount === 1 ? "" : "s"}`,
      });
    }
    if (servicesTotal > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${servicesTotal} service${servicesTotal === 1 ? "" : "s"}`,
      });
    }
    if (tasksTotal > 0) {
      specChips.push({
        icon: IconProp.List,
        label: `${tasksRunning}/${tasksTotal} task${
          tasksTotal === 1 ? "" : "s"
        } running`,
      });
    }
    if (cluster.dockerVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: `Docker ${String(cluster.dockerVersion)}`,
      });
    }
    if (cluster.agentVersion) {
      specChips.push({
        icon: IconProp.Terminal,
        label: `Agent ${String(cluster.agentVersion)}`,
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-sky-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-sky-200 shadow-sm">
                <Icon
                  icon={IconProp.ServerStack}
                  className="h-6 w-6 text-sky-600"
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
            <div className="flex-shrink-0">
              <AutoRefreshControl
                autoRefreshInterval={autoRefreshInterval}
                onAutoRefreshIntervalChange={setAutoRefreshInterval}
                onManualRefresh={(): void => {
                  fetchCluster(false).catch(() => {});
                }}
                isRefreshing={isRefreshing}
                lastRefreshedAt={lastRefreshedAt}
              />
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
    );
  };

  const renderCountTile: (
    label: string,
    value: number,
    subline: string | null,
    pageMap: PageMap,
  ) => ReactElement = (
    label: string,
    value: number,
    subline: string | null,
    pageMap: PageMap,
  ): ReactElement => {
    return (
      <button
        key={label}
        type="button"
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
              modelId: modelId,
            }),
          );
        }}
        className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:shadow"
      >
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
        {subline && (
          <div className="mt-0.5 text-xs text-gray-500">{subline}</div>
        )}
      </button>
    );
  };

  return (
    <div>
      {renderHero()}

      {inventoryError && <ErrorMessage message={inventoryError} />}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {renderCountTile(
          "Nodes",
          nodesTotal,
          nodesTotal > 0 ? `${nodesReady}/${nodesTotal} ready` : null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES,
        )}
        {renderCountTile(
          "Services",
          servicesTotal,
          inventory && servicesTotal > 0
            ? `${inventory.servicesConverged}/${servicesTotal} converged`
            : null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES,
        )}
        {renderCountTile(
          "Tasks",
          tasksTotal,
          tasksTotal > 0 ? `${tasksRunning}/${tasksTotal} running` : null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS,
        )}
        {renderCountTile(
          "Stacks",
          stackCount,
          null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS,
        )}
        {renderCountTile(
          "Networks",
          networkCount,
          null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS,
        )}
        {renderCountTile(
          "Volumes",
          inventory?.volumeCount || 0,
          null,
          PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES,
        )}
      </div>

      <Card
        title="Cluster Health"
        description="Nodes, services and tasks that are not in a healthy steady state, derived from the latest inventory snapshot."
      >
        {isInventoryLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-gray-50" />
        ) : degradedItems.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
            <Icon
              icon={IconProp.CheckCircle}
              className="h-4 w-4 text-emerald-500"
            />
            Everything looks healthy — all reported nodes, services and tasks
            are in a steady state.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {degradedItems.map(
              (item: DegradedItem, idx: number): ReactElement => {
                return (
                  <li
                    key={`degraded-${idx}`}
                    className={`flex items-start justify-between gap-3 py-3 ${
                      item.externalId ? "cursor-pointer hover:bg-gray-50" : ""
                    }`}
                    onClick={() => {
                      navigateToDetail(item);
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            item.isCritical ? "bg-red-500" : "bg-amber-500"
                          }`}
                        />
                        <span className="text-sm font-medium text-gray-900">
                          {item.name}
                        </span>
                        <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {item.kind}
                        </span>
                      </div>
                      <div className="mt-0.5 ml-3.5 text-xs text-gray-500">
                        {item.reasons.join(", ")}
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default DockerSwarmClusterOverview;
