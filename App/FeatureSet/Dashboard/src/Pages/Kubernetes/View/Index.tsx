import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import {
  fetchK8sObjectsBatch,
  KubernetesObjectType,
} from "../Utils/KubernetesObjectFetcher";
import {
  KubernetesPodObject,
  KubernetesNodeObject,
} from "../Utils/KubernetesObjectParser";

interface ResourceLink {
  title: string;
  description: string;
  pageMap: PageMap;
}

const KubernetesClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [nodeCount, setNodeCount] = useState<number>(0);
  const [podCount, setPodCount] = useState<number>(0);
  const [namespaceCount, setNamespaceCount] = useState<number>(0);
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

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          name: true,
          clusterIdentifier: true,
          provider: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
        },
      });
      setCluster(item);

      if (item?.clusterIdentifier) {
        // Fetch counts dynamically from metrics data
        const [nodes, pods, namespaces]: [
          Array<KubernetesResource>,
          Array<KubernetesResource>,
          Array<KubernetesResource>,
        ] = await Promise.all([
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: item.clusterIdentifier,
            metricName: "k8s.node.cpu.utilization",
            resourceNameAttribute: "resource.k8s.node.name",
            namespaceAttribute: "resource.k8s.node.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: item.clusterIdentifier,
            metricName: "k8s.pod.cpu.utilization",
            resourceNameAttribute: "resource.k8s.pod.name",
          }),
          KubernetesResourceUtils.fetchResourceList({
            clusterIdentifier: item.clusterIdentifier,
            metricName: "k8s.pod.cpu.utilization",
            resourceNameAttribute: "resource.k8s.namespace.name",
            namespaceAttribute: "resource.k8s.namespace.name",
          }),
        ]);

        setNodeCount(nodes.length);
        setPodCount(pods.length);
        setNamespaceCount(namespaces.length);

        // Fetch pod and node objects for health status
        try {
          const [podObjects, nodeObjects]: [
            Map<string, KubernetesObjectType>,
            Map<string, KubernetesObjectType>,
          ] = await Promise.all([
            fetchK8sObjectsBatch({
              clusterIdentifier: item.clusterIdentifier,
              resourceType: "pods",
            }),
            fetchK8sObjectsBatch({
              clusterIdentifier: item.clusterIdentifier,
              resourceType: "nodes",
            }),
          ]);

          // Calculate pod health
          let running: number = 0;
          let pending: number = 0;
          let failed: number = 0;
          let succeeded: number = 0;

          for (const podObj of podObjects.values()) {
            const pod: KubernetesPodObject =
              podObj as KubernetesPodObject;
            const phase: string = pod.status.phase || "Unknown";
            if (phase === "Running") {
              running++;
            } else if (phase === "Pending") {
              pending++;
            } else if (phase === "Failed") {
              failed++;
            } else if (phase === "Succeeded") {
              succeeded++;
            }
          }
          setPodHealthSummary({ running, pending, failed, succeeded });

          // Calculate node health
          let ready: number = 0;
          let notReady: number = 0;

          for (const nodeObj of nodeObjects.values()) {
            const node: KubernetesNodeObject =
              nodeObj as KubernetesNodeObject;
            const readyCondition: boolean = node.status.conditions.some(
              (c: { type: string; status: string }) =>
                c.type === "Ready" && c.status === "True",
            );
            if (readyCondition) {
              ready++;
            } else {
              notReady++;
            }
          }
          setNodeHealthSummary({ ready, notReady });

          // Determine overall health
          if (failed > 0 || notReady > 0) {
            setClusterHealth("Unhealthy");
          } else if (pending > 0) {
            setClusterHealth("Degraded");
          } else {
            setClusterHealth("Healthy");
          }
        } catch {
          // Health data is supplementary, don't fail
        }
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
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

  const statusColor: string =
    cluster.otelCollectorStatus === "connected"
      ? "text-green-600"
      : "text-red-600";

  const workloadLinks: Array<ResourceLink> = [
    {
      title: "Namespaces",
      description: "View all namespaces",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
    },
    {
      title: "Pods",
      description: "View all pods",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
    },
    {
      title: "Deployments",
      description: "View all deployments",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
    },
    {
      title: "StatefulSets",
      description: "View all statefulsets",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
    },
    {
      title: "DaemonSets",
      description: "View all daemonsets",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
    },
    {
      title: "Jobs",
      description: "View all jobs",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
    },
    {
      title: "CronJobs",
      description: "View all cron jobs",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
    },
  ];

  const infraLinks: Array<ResourceLink> = [
    {
      title: "Nodes",
      description: "View all nodes",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
    },
    {
      title: "Containers",
      description: "View all containers",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
    },
    {
      title: "PVCs",
      description: "View persistent volume claims",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PVCS,
    },
    {
      title: "PVs",
      description: "View persistent volumes",
      pageMap: PageMap.KUBERNETES_CLUSTER_VIEW_PVS,
    },
  ];

  return (
    <Fragment>
      {/* Cluster Health Banner */}
      <div
        className={`mb-5 rounded-lg border p-4 ${
          clusterHealth === "Healthy"
            ? "bg-green-50 border-green-200"
            : clusterHealth === "Degraded"
              ? "bg-yellow-50 border-yellow-200"
              : "bg-red-50 border-red-200"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-3 w-3 rounded-full ${
                clusterHealth === "Healthy"
                  ? "bg-green-500"
                  : clusterHealth === "Degraded"
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
            />
            <span
              className={`text-lg font-semibold ${
                clusterHealth === "Healthy"
                  ? "text-green-800"
                  : clusterHealth === "Degraded"
                    ? "text-yellow-800"
                    : "text-red-800"
              }`}
            >
              Cluster {clusterHealth}
            </span>
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-gray-600">
              <span className="font-medium text-green-700">
                {podHealthSummary.running}
              </span>{" "}
              Running
            </span>
            {podHealthSummary.pending > 0 && (
              <span className="text-gray-600">
                <span className="font-medium text-yellow-700">
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
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <InfoCard
          title="Cluster Health"
          value={
            <span
              className={`text-2xl font-semibold ${
                clusterHealth === "Healthy"
                  ? "text-green-600"
                  : clusterHealth === "Degraded"
                    ? "text-yellow-600"
                    : "text-red-600"
              }`}
            >
              {clusterHealth}
            </span>
          }
        />
        <InfoCard
          title="Nodes"
          value={
            <span className="text-2xl font-semibold">
              {nodeCount.toString()}
              {nodeHealthSummary.notReady > 0 && (
                <span className="text-sm text-red-500 ml-1">
                  ({nodeHealthSummary.notReady} not ready)
                </span>
              )}
            </span>
          }
        />
        <InfoCard
          title="Pods"
          value={
            <span className="text-2xl font-semibold">
              {podCount.toString()}
            </span>
          }
        />
        <InfoCard
          title="Namespaces"
          value={
            <span className="text-2xl font-semibold">
              {namespaceCount.toString()}
            </span>
          }
        />
        <InfoCard
          title="Agent Status"
          value={
            <span className={`text-2xl font-semibold ${statusColor}`}>
              {cluster.otelCollectorStatus === "connected"
                ? "Connected"
                : "Disconnected"}
            </span>
          }
        />
      </div>

      {/* Quick Navigation - Workloads */}
      <Card
        title="Workloads"
        description="Explore workload resources in this cluster."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
          {workloadLinks.map((link: ResourceLink) => {
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
                className="flex items-center p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group cursor-pointer"
              >
                <div>
                  <div className="font-medium text-gray-900 group-hover:text-indigo-700">
                    {link.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {link.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Quick Navigation - Infrastructure */}
      <Card
        title="Infrastructure"
        description="Explore infrastructure resources in this cluster."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
          {infraLinks.map((link: ResourceLink) => {
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
                className="flex items-center p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group cursor-pointer"
              >
                <div>
                  <div className="font-medium text-gray-900 group-hover:text-indigo-700">
                    {link.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {link.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Cluster Details */}
      <CardModelDetail<KubernetesCluster>
        name="Cluster Details"
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
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production cluster running in US East",
          },
          {
            field: {
              clusterIdentifier: true,
            },
            title: "Cluster Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east-1",
            description:
              "This should match the clusterName value in your kubernetes-agent Helm chart.",
          },
          {
            field: {
              provider: true,
            },
            title: "Provider",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "EKS, GKE, AKS, etc.",
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
                provider: true,
              },
              title: "Provider",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterOverview;
