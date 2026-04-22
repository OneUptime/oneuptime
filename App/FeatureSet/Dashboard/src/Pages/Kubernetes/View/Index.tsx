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
import StackedProgressBar, {
  type StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

interface ResourceLink {
  title: string;
  description: string;
  pageMap: PageMap;
  count?: number | undefined;
  icon: IconProp;
  iconBgClass: string;
  iconTextClass: string;
}

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
            const item: Record<string, unknown> = (p as Record<
              string,
              unknown
            >) || {};
            return {
              name: typeof item["name"] === "string" ? item["name"] : "",
              namespace:
                typeof item["namespace"] === "string" ? item["namespace"] : "",
              phase: typeof item["phase"] === "string" ? item["phase"] : "",
              reason:
                typeof item["reason"] === "string" ? item["reason"] : "",
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
            const item: Record<string, unknown> = (n as Record<
              string,
              unknown
            >) || {};
            return {
              name: typeof item["name"] === "string" ? item["name"] : "",
              isReady: item["isReady"] === true,
              hasMemoryPressure: item["hasMemoryPressure"] === true,
              hasDiskPressure: item["hasDiskPressure"] === true,
              hasPidPressure: item["hasPidPressure"] === true,
              reason:
                typeof item["reason"] === "string" ? item["reason"] : "",
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
         * Fire all three section fetches independently so each section
         * paints its data as soon as its own request resolves. No
         * Promise.all — we don't want the slowest request to hold back
         * the other two sections.
         */
        void loadSummary(modelId);
        void loadTopPods(item.clusterIdentifier);
        void loadWarnings(item.clusterIdentifier);
      } else {
        // No cluster identifier means nothing to load from downstream stores.
        setIsSummaryLoading(false);
        setIsTopPodsLoading(false);
        setIsWarningsLoading(false);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
      setIsSummaryLoading(false);
      setIsTopPodsLoading(false);
      setIsWarningsLoading(false);
    }
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const healthBannerType: AlertBannerType =
    clusterHealth === "Healthy"
      ? AlertBannerType.Success
      : clusterHealth === "Degraded"
        ? AlertBannerType.Warning
        : AlertBannerType.Danger;

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

  return (
    <Fragment>
      {/* Cluster Health Banner — only render once summary data has loaded,
          otherwise the banner flashes "Healthy" with zero counts before
          the real data arrives. */}
      {!isSummaryLoading && (
        <AlertBanner
          title={`Cluster ${clusterHealth}`}
          type={healthBannerType}
          className="mb-5"
          rightElement={
            <div className="flex gap-4 text-sm">
              <span className="text-gray-600">
                <span className="font-medium text-emerald-700">
                  {podHealthSummary.running}
                </span>{" "}
                Running
              </span>
              {podHealthSummary.pending > 0 && (
                <span className="text-gray-600">
                  <span className="font-medium text-amber-700">
                    {podHealthSummary.pending}
                  </span>{" "}
                  Pending
                </span>
              )}
              {podHealthSummary.failed > 0 && (
                <span className="text-gray-600">
                  <span className="font-medium text-red-700">
                    {podHealthSummary.failed}
                  </span>{" "}
                  Failed
                </span>
              )}
              {nodeHealthSummary.notReady > 0 && (
                <span className="text-gray-600">
                  <span className="font-medium text-red-700">
                    {nodeHealthSummary.notReady}
                  </span>{" "}
                  Nodes Not Ready
                </span>
              )}
            </div>
          }
        />
      )}

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
                {topMemoryPods.map((pod: KubernetesResource, index: number) => {
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
                })}
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
