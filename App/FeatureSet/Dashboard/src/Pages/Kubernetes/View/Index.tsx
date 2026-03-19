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
          nodeCount: true,
          podCount: true,
          namespaceCount: true,
        },
      });
      setCluster(item);
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
  ];

  return (
    <Fragment>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <InfoCard
          title="Nodes"
          value={
            <span className="text-2xl font-semibold">
              {cluster.nodeCount?.toString() || "0"}
            </span>
          }
        />
        <InfoCard
          title="Pods"
          value={
            <span className="text-2xl font-semibold">
              {cluster.podCount?.toString() || "0"}
            </span>
          }
        />
        <InfoCard
          title="Namespaces"
          value={
            <span className="text-2xl font-semibold">
              {cluster.namespaceCount?.toString() || "0"}
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
              <a
                key={link.title}
                href={RouteUtil.populateRouteParams(
                  RouteMap[link.pageMap] as Route,
                  { modelId: modelId },
                ).toString()}
                className="flex items-center p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
              >
                <div>
                  <div className="font-medium text-gray-900 group-hover:text-indigo-700">
                    {link.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {link.description}
                  </div>
                </div>
              </a>
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
              <a
                key={link.title}
                href={RouteUtil.populateRouteParams(
                  RouteMap[link.pageMap] as Route,
                  { modelId: modelId },
                ).toString()}
                className="flex items-center p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
              >
                <div>
                  <div className="font-medium text-gray-900 group-hover:text-indigo-700">
                    {link.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {link.description}
                  </div>
                </div>
              </a>
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
