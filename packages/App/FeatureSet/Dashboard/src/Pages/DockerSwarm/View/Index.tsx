import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResourceModel from "Common/Models/DatabaseModels/DockerSwarmResource";
import PageMap from "../../../Utils/PageMap";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getDockerSwarmClusterConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import ResourceAiAgentStatusSummaryCard from "../../../Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ResourceRecordDetailsCard from "../../../Components/TelemetryResource/ResourceRecordDetailsCard";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import DockerSwarmNodesCard from "../../../Components/DockerSwarm/DockerSwarmNodesCard";
import {
  DockerSwarmPartRoutes,
  getDockerSwarmPartRoutes,
} from "../../../Components/DockerSwarm/Part/DockerSwarmPartRoutes";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import Route from "Common/Types/API/Route";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import OneUptimeDate from "Common/Types/Date";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { fetchDockerSwarmInventoryRows } from "../Utils/DockerSwarmResourceUtils";
import {
  countDockerSwarmTasks,
  getDockerSwarmAttentionItems,
  getDockerSwarmHealth,
  getDockerSwarmManagerQuorum,
  DockerSwarmManagerQuorum,
  DockerSwarmTaskCount,
} from "../Utils/DockerSwarmHealth";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import ResourceHeroDescription from "../../../Components/TelemetryResource/ResourceHeroDescription";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../../Components/TelemetryResource/ResourceHeroLayout";
import {
  getResourceConnectionLabel,
  getResourceHealthLabel,
} from "../../../Components/TelemetryResource/ResourceHeroStatus";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatRelativeTime } from "../../../Components/Home/HomeRelativeTime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A Docker Swarm cluster's Overview, what `docker node ls` and
 * `docker service ls` would tell an administrator first:
 *
 *   - the hero: the agent's connection and the swarm's health by its rules
 *     (DockerSwarmHealth), and counts that open their lists - nodes ready,
 *     managers, services, tasks running, stacks;
 *   - Needs attention: what is broken or needs a look, the most urgent
 *     first, each with why and Docker's own words, one step from its page -
 *     while the agent reports (a disconnected swarm's last snapshot is no
 *     longer the truth, and the hero says Health Unknown instead);
 *   - each node at a glance, the ones in trouble first;
 *   - what is open on the cluster, its details, and its AI agent.
 *
 * Everything but the activity counts reads the DockerSwarmResource
 * inventory - the same rows the side menu counts and the lists read - in
 * one read, so a count, a list and a row here can never disagree.
 */

interface SpecChip {
  icon: IconProp;
  label: string;
  route?: Route | undefined;
  testId?: string | undefined;
}

interface InventorySummary {
  rows: Array<DockerSwarmResourceModel>;
  nodesReady: number;
  nodesTotal: number;
  servicesTotal: number;
  tasks: DockerSwarmTaskCount;
  stackCount: number;
  managers: DockerSwarmManagerQuorum | null;
}

function summarize(rows: Array<DockerSwarmResourceModel>): InventorySummary {
  let nodesReady: number = 0;
  let nodesTotal: number = 0;
  let servicesTotal: number = 0;
  let stackCount: number = 0;
  for (const row of rows) {
    if (row.kind === "Node") {
      nodesTotal++;
      if ((row.state || "").toLowerCase() === "ready") {
        nodesReady++;
      }
    } else if (row.kind === "Service") {
      servicesTotal++;
    } else if (row.kind === "Stack") {
      stackCount++;
    }
  }
  return {
    rows: rows,
    nodesReady: nodesReady,
    nodesTotal: nodesTotal,
    servicesTotal: servicesTotal,
    tasks: countDockerSwarmTasks(rows),
    stackCount: stackCount,
    managers: getDockerSwarmManagerQuorum(rows),
  };
}

const CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700";
const CHIP_LINK_CLASS_NAME: string = `${CHIP_CLASS_NAME} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;

const DockerSwarmClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [inventoryReadAt, setInventoryReadAt] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );
  // Only the newest inventory read lands (a refresh can overtake a slow one).
  const inventorySeq: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * Toggled on every auto and manual refresh, so the details card re-reads
   * the Docker and agent versions along with the rest of the page.
   */
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  const loadInventory: () => Promise<void> = async (): Promise<void> => {
    const seq: number = ++inventorySeq.current;
    try {
      const rows: Array<DockerSwarmResourceModel> =
        await fetchDockerSwarmInventoryRows({
          dockerSwarmClusterId: modelId,
        });
      if (seq !== inventorySeq.current) {
        return;
      }
      setInventory(summarize(rows));
      setInventoryError("");
      setInventoryReadAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      if (seq !== inventorySeq.current) {
        return;
      }
      // Said as such, not as a swarm of no nodes.
      setInventoryError(API.getFriendlyMessage(err));
    } finally {
      if (seq === inventorySeq.current) {
        setIsInventoryLoading(false);
      }
    }
  };

  const fetchCluster: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
      setDetailsRefresher((value: boolean): boolean => {
        return !value;
      });
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
        await loadInventory();
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

  const routes: DockerSwarmPartRoutes = getDockerSwarmPartRoutes(modelId);

  const status: string = (cluster.otelCollectorStatus as string) || "";
  const isConnected: boolean =
    status.toLowerCase() === "connected" || status.toLowerCase() === "active";

  /*
   * What needs attention, most urgent first (DockerSwarmHealth): the same
   * rules the lists, the part pages and the Topology use, so the health
   * pill, this list and a node's page can never disagree.
   */
  const attentionItems: Array<ResourceAttentionItem> = inventory
    ? getDockerSwarmAttentionItems({
        rows: inventory.rows,
        clusterName: (cluster.name as string | undefined) || "",
        routeFor: routes.getPartRoute,
        now: inventoryReadAt,
      })
    : [];
  const clusterHealth: ResourceHealth = getDockerSwarmHealth(attentionItems);

  // Inventory-first, cached snapshot columns as fallback.
  const nodesTotal: number = inventory?.nodesTotal ?? (cluster.nodeCount || 0);
  const nodesReady: number = inventory
    ? inventory.nodesReady
    : cluster.readyNodeCount || 0;
  const managersTotal: number = inventory
    ? inventory.managers?.total || 0
    : cluster.managerNodeCount || 0;
  const servicesTotal: number =
    inventory?.servicesTotal ?? (cluster.serviceCount || 0);
  const tasksTotal: number = inventory
    ? inventory.tasks.total
    : cluster.taskCount || 0;
  const tasksRunning: number = inventory
    ? inventory.tasks.running
    : cluster.runningTaskCount || 0;
  const stackCount: number = inventory?.stackCount ?? (cluster.stackCount || 0);

  const renderHero: () => ReactElement = (): ReactElement => {
    const lastSeenAt: Date | undefined = cluster.lastSeenAt;
    /*
     * One whole sentence either way: an English "never" in a translated
     * "Last seen {{time}}" would read in two languages at once.
     */
    const lastSeenText: string = lastSeenAt
      ? translator.translateTemplate("Last seen {{time}}", {
          // In the reader's language, as a part's page says it.
          time: formatRelativeTime({
            date: OneUptimeDate.fromString(lastSeenAt),
            now: new Date(),
            language: translator.language,
          }),
        })
      : translator.translateText("Never seen") || "Never seen";

    const displayName: string =
      (cluster.name as string | undefined) || "Untitled Docker Swarm cluster";

    const connectionBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const connectionDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const connectionLabel: string = getResourceConnectionLabel({
      translator: translator,
      isConnected: isConnected,
      status: status,
    });

    /*
     * Health is derived from the last inventory snapshot, which goes stale
     * once the collector disconnects. Reporting "Healthy" next to a
     * "Disconnected" badge is contradictory and misleading, so while the
     * swarm is not connected the pill says "Health Unknown" (neutral grey),
     * as a Ceph cluster's and a storage array's do, rather than the
     * last-known live status.
     */
    const healthLabel: string = getResourceHealthLabel({
      translator: translator,
      health: clusterHealth,
      isConnected: isConnected,
    });
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

    /*
     * The count chips open their list: the Overview's one step to the
     * nodes, the services, the tasks and the stacks (the side menu has the
     * rest).
     */
    const specChips: Array<SpecChip> = [];
    if (nodesTotal > 0) {
      specChips.push({
        icon: IconProp.Server,
        route: routes.nodesRoute,
        testId: "docker-swarm-hero-nodes",
        label: translator.translatePlural(
          {
            one: "{{ready}}/{{count}} node ready",
            other: "{{ready}}/{{count}} nodes ready",
          },
          nodesTotal,
          // In the reader's digits, as the count beside it is.
          { ready: translator.formatNumber(nodesReady) },
        ),
      });
    }
    if (managersTotal > 0) {
      specChips.push({
        icon: IconProp.Star,
        route: routes.nodesRoute,
        testId: "docker-swarm-hero-managers",
        label: translator.translatePlural(
          { one: "{{count}} manager", other: "{{count}} managers" },
          managersTotal,
        ),
      });
    }
    if (servicesTotal > 0) {
      specChips.push({
        icon: IconProp.SquareStack,
        route: routes.servicesRoute,
        testId: "docker-swarm-hero-services",
        label: translator.translatePlural(
          { one: "{{count}} service", other: "{{count}} services" },
          servicesTotal,
        ),
      });
    }
    if (tasksTotal > 0) {
      specChips.push({
        icon: IconProp.QueueList,
        route: routes.tasksRoute,
        testId: "docker-swarm-hero-tasks",
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} task running",
            other: "{{running}}/{{count}} tasks running",
          },
          tasksTotal,
          { running: translator.formatNumber(tasksRunning) },
        ),
      });
    }
    if (stackCount > 0) {
      specChips.push({
        icon: IconProp.RectangleStack,
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS] as Route,
          { modelId: modelId },
        ),
        testId: "docker-swarm-hero-stacks",
        label: translator.translatePlural(
          { one: "{{count}} stack", other: "{{count}} stacks" },
          stackCount,
        ),
      });
    }
    const hasCountChips: boolean = specChips.length > 0;
    if (cluster.dockerVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: translator.translateTemplate("Docker {{version}}", {
          version: String(cluster.dockerVersion),
        }),
      });
    }

    /*
     * A swarm that has reported no node yet has no health to tell:
     * "Healthy" there would be a guess.
     */
    const showsHealth: boolean =
      !isInventoryLoading &&
      !inventoryError &&
      (inventory?.rows.length ?? 0) > 0;

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-sky-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative px-6 py-5">
          {/*
           * The name keeps its room and the refresh control gives way: under
           * the name on a phone and beside the side menu, beside it in a
           * wide hero (ResourceHeroLayout, as every resource hero).
           */}
          <div
            data-testid={RESOURCE_HERO_TOP_ROW_TEST_ID}
            className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}
          >
            <div
              data-testid={RESOURCE_HERO_IDENTITY_TEST_ID}
              className={RESOURCE_HERO_IDENTITY_CLASS_NAME}
            >
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
                    data-testid="docker-swarm-hero-connection"
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${connectionBadgeClass}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${connectionDotClass}`}
                    />
                    {connectionLabel}
                  </span>
                  {showsHealth && (
                    <span className="inline-flex items-center gap-1">
                      <span
                        data-testid="docker-swarm-hero-health"
                        data-health={isConnected ? clusterHealth : "Unknown"}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                        />
                        {healthLabel}
                      </span>
                      <InfoTooltip
                        label="Swarm health"
                        text={DOCKER_SWARM_METRIC_DESCRIPTIONS.clusterHealth}
                      />
                    </span>
                  )}
                </div>
                <ResourceHeroDescription
                  text={cluster.description as string | undefined}
                />
                <div className="mt-1 text-xs text-gray-400">{lastSeenText}</div>
              </div>
            </div>
            <div
              data-testid={RESOURCE_HERO_CONTROLS_TEST_ID}
              className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
            >
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

          {(specChips.length > 0 || Boolean(cluster.agentVersion)) && (
            <div
              className="mt-4 flex flex-wrap items-center gap-1.5"
              data-testid="docker-swarm-hero-chips"
            >
              {specChips.map((chip: SpecChip, idx: number): ReactElement => {
                const content: ReactElement = (
                  <>
                    <Icon icon={chip.icon} className="h-3 w-3 text-gray-500" />
                    <span className="font-medium">{chip.label}</span>
                  </>
                );
                if (chip.route) {
                  return (
                    <Link
                      key={`spec-${idx}`}
                      to={chip.route}
                      dataTestId={chip.testId}
                      className={CHIP_LINK_CLASS_NAME}
                    >
                      {content}
                    </Link>
                  );
                }
                return (
                  <span key={`spec-${idx}`} className={CHIP_CLASS_NAME}>
                    {content}
                  </span>
                );
              })}
              {/*
               * The agent's version chip. A sign on it, when the agent is
               * behind the files this release ships, opens how to upgrade
               * it.
               */}
              <AgentVersion
                kind={AgentKind.DockerSwarmAgent}
                version={cluster.agentVersion}
                variant="chip"
              />
              {/*
               * Only the count chips need explaining; the version chips are
               * metadata, so a row of versions alone gets no (i).
               */}
              {hasCountChips && (
                <InfoTooltip
                  label="Swarm inventory counts"
                  text={DOCKER_SWARM_METRIC_DESCRIPTIONS.inventoryCounts}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderHero()}

      {/* How to connect it, while it is not connected */}
      <ResourceConnectionGuideCard
        status={cluster.otelCollectorStatus as string | undefined}
        lastSeenAt={cluster.lastSeenAt}
        guide={getDockerSwarmClusterConnectionGuide(
          (cluster.name as string | undefined) || "",
          getConfiguredOneUptimeUrl(),
        )}
        documentationRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION] as Route,
          { modelId: modelId },
        )}
      />

      {/*
       * What needs someone, most urgent first - while the agent reports: a
       * disconnected swarm's last snapshot is no longer the truth, and the
       * hero says Health Unknown instead. A read that fails says so in the
       * card's frame, with Refresh.
       */}
      {inventoryError ? (
        <NeedsAttentionCard
          testId="docker-swarm-needs-attention"
          items={[]}
          error={inventoryError}
          onRetry={(): void => {
            setIsInventoryLoading(true);
            loadInventory().catch(() => {});
          }}
        />
      ) : isConnected && !isInventoryLoading ? (
        <NeedsAttentionCard
          testId="docker-swarm-needs-attention"
          items={attentionItems}
        />
      ) : (
        <></>
      )}

      {/* Each node at a glance, the ones in trouble first */}
      {inventory ? (
        <DockerSwarmNodesCard
          rows={inventory.rows}
          getNodeRoute={(externalId: string): Route => {
            return routes.getPartRoute("Node", externalId);
          }}
          nodesRoute={routes.nodesRoute}
          now={inventoryReadAt}
        />
      ) : (
        <></>
      )}

      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="dockerSwarmClusters"
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        incidentsRoute={routes.incidentsRoute}
        alertsRoute={routes.alertsRoute}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[
            PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE
          ] as Route,
          { modelId: modelId },
        )}
      />

      {/*
       * What the swarm reported about itself, and only that
       * (ResourceRecordDetailsCard): its name, description and when it was
       * last seen are the hero's, its labels the header's. Edited on its
       * Settings page, in the card of the same title.
       */}
      <ResourceRecordDetailsCard<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        id="docker-swarm-cluster-overview"
        title="Cluster Details"
        refresher={detailsRefresher}
        settingsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS] as Route,
          { modelId: modelId },
        )}
        facts={[
          {
            field: {
              swarmId: true,
            },
            title: "Swarm ID",
            fieldType: FieldType.Text,
          },
          {
            field: {
              dockerVersion: true,
            },
            title: "Docker Version",
            fieldType: FieldType.Text,
          },
          {
            field: {
              agentVersion: true,
            },
            title: "Agent Version",
            fieldType: FieldType.Element,
            getElement: (item: DockerSwarmCluster): ReactElement => {
              return (
                <AgentVersion
                  kind={AgentKind.DockerSwarmAgent}
                  version={item.agentVersion}
                />
              );
            },
          },
        ]}
      />

      {/*
       * Last on the page: the Docker Swarm AI agent's connection, whether AI
       * may investigate, and how fixes run, linking to AI → AI agent.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(
          AiResourceType.DockerSwarmCluster,
        )}
        resourceId={modelId}
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
      />
    </div>
  );
};

export default DockerSwarmClusterOverview;
