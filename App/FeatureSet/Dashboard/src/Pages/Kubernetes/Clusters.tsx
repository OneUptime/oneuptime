import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerTeam from "Common/Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "Common/Models/DatabaseModels/KubernetesClusterOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import KubernetesDocumentationCard from "../../Components/Kubernetes/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";

interface FleetStats {
  totalClusters: number;
  connectedClusters: number;
  disconnectedClusters: number;
  totalNodes: number;
  totalPods: number;
}

interface KubeletVersionCount {
  version: string;
  count: number;
}

const KubernetesClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [fleetStats, setFleetStats] = useState<FleetStats | null>(null);
  const [kubeletVersions, setKubeletVersions] = useState<
    Array<KubeletVersionCount>
  >([]);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<KubernetesCluster>({ modelType: KubernetesCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<KubernetesCluster>({
      ownerUserModelType: KubernetesClusterOwnerUser,
      ownerTeamModelType: KubernetesClusterOwnerTeam,
      resourceIdField: "kubernetesClusterId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<KubernetesCluster>({
    modelType: KubernetesCluster,
  });

  const kubernetesExtraFacets: Array<ResourceFacet> = [
    {
      key: "otelCollectorStatus",
      label: "Status",
      icon: IconProp.Wifi,
      isMultiSelect: false,
      options: [
        { value: "connected", label: "Connected" },
        { value: "disconnected", label: "Disconnected" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, false);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<KubernetesCluster>({
    persistKey: "kubernetes-clusters-table",
    ownerUserModelType: KubernetesClusterOwnerUser,
    ownerTeamModelType: KubernetesClusterOwnerTeam,
    resourceIdField: "kubernetesClusterId",
    showLabelsFacet: true,
    extraFacets: kubernetesExtraFacets,
  });

  const fetchClusterCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: KubernetesCluster,
        query: {},
      });
      setClusterCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  /*
   * Fleet rollup — cached per-cluster counts reduced client-side, plus
   * the kubelet version distribution from Node inventory rows. Entirely
   * supplementary: any failure hides the cards and never blocks the table.
   */
  const fetchFleetRollup: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const clustersResult: ListResult<KubernetesCluster> =
        await ModelAPI.getList<KubernetesCluster>({
          modelType: KubernetesCluster,
          query: {
            isArchived: false,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          select: {
            name: true,
            otelCollectorStatus: true,
            nodeCount: true,
            podCount: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      const clusters: Array<KubernetesCluster> = clustersResult.data;
      let connectedClusters: number = 0;
      let totalNodes: number = 0;
      let totalPods: number = 0;
      for (const clusterItem of clusters) {
        if (clusterItem.otelCollectorStatus === "connected") {
          connectedClusters++;
        }
        totalNodes += clusterItem.nodeCount ?? 0;
        totalPods += clusterItem.podCount ?? 0;
      }

      setFleetStats({
        totalClusters: clusters.length,
        connectedClusters: connectedClusters,
        disconnectedClusters: clusters.length - connectedClusters,
        totalNodes: totalNodes,
        totalPods: totalPods,
      });
    } catch {
      // Rollup is supplementary — hide the cards on failure.
    }

    try {
      const nodesResult: ListResult<KubernetesResourceModel> =
        await ModelAPI.getList<KubernetesResourceModel>({
          modelType: KubernetesResourceModel,
          query: {
            kind: "Node",
          },
          skip: 0,
          limit: 200,
          select: {
            status: true,
            kubernetesClusterId: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      const versionCounts: Map<string, number> = new Map<string, number>();
      for (const node of nodesResult.data) {
        const status: JSONObject | undefined = node.status;
        const nodeInfo: unknown = status ? status["nodeInfo"] : undefined;
        if (
          !nodeInfo ||
          typeof nodeInfo !== "object" ||
          Array.isArray(nodeInfo)
        ) {
          continue;
        }
        const kubeletVersion: unknown = (nodeInfo as JSONObject)[
          "kubeletVersion"
        ];
        if (typeof kubeletVersion !== "string" || !kubeletVersion) {
          continue;
        }
        versionCounts.set(
          kubeletVersion,
          (versionCounts.get(kubeletVersion) || 0) + 1,
        );
      }

      const topVersions: Array<KubeletVersionCount> = Array.from(
        versionCounts.entries(),
      )
        .map(([version, count]: [string, number]): KubeletVersionCount => {
          return { version, count };
        })
        .sort((a: KubeletVersionCount, b: KubeletVersionCount): number => {
          return b.count - a.count;
        })
        .slice(0, 3);
      setKubeletVersions(topVersions);
    } catch {
      // Version distribution is supplementary — skip the card on failure.
    }
  };

  useEffect(() => {
    fetchClusterCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
    fetchFleetRollup().catch(() => {
      // Rollup failures are swallowed inside fetchFleetRollup already.
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (clusterCount === 0) {
    return (
      <Fragment>
        <KubernetesDocumentationCard
          clusterName="my-cluster"
          title="Getting Started with Kubernetes Monitoring"
          description="No Kubernetes clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      {clusterCount !== null && clusterCount > 0 && fleetStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
          <InfoCard
            title="Total Clusters"
            value={
              <span className="text-2xl font-semibold">
                {fleetStats.totalClusters.toString()}
              </span>
            }
          />
          <InfoCard
            title="Connected"
            value={
              <span className="text-2xl font-semibold text-emerald-600">
                {fleetStats.connectedClusters.toString()}
              </span>
            }
          />
          <InfoCard
            title="Disconnected"
            value={
              <span
                className={`text-2xl font-semibold ${
                  fleetStats.disconnectedClusters > 0
                    ? "text-red-600"
                    : "text-gray-900"
                }`}
              >
                {fleetStats.disconnectedClusters.toString()}
              </span>
            }
          />
          <InfoCard
            title="Total Nodes"
            value={
              <span className="text-2xl font-semibold">
                {fleetStats.totalNodes.toString()}
              </span>
            }
          />
          <InfoCard
            title="Total Pods"
            value={
              <span className="text-2xl font-semibold">
                {fleetStats.totalPods.toString()}
              </span>
            }
          />
        </div>
      )}
      {clusterCount !== null &&
        clusterCount > 0 &&
        kubeletVersions.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 mb-5">
            <div className="text-sm font-medium text-gray-500">
              Kubernetes Versions
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {kubeletVersions.map(
                (entry: KubeletVersionCount): ReactElement => {
                  return (
                    <span
                      key={entry.version}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                    >
                      <span className="font-mono font-medium">
                        {entry.version}
                      </span>
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700">
                        {entry.count} node{entry.count === 1 ? "" : "s"}
                      </span>
                    </span>
                  );
                },
              )}
            </div>
          </div>
        )}
      <ModelTable<KubernetesCluster>
        modelType={KubernetesCluster}
        id="kubernetes-clusters-table"
        userPreferencesKey="kubernetes-clusters-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<KubernetesCluster>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Kubernetes Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Kubernetes Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime kubernetes-agent Helm chart to connect a cluster.",
        }}
        showViewIdButton={true}
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
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production cluster running in US East",
          },
          {
            field: {
              labels: true,
            },
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
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: KubernetesCluster): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              clusterIdentifier: true,
            },
            title: "Cluster Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: KubernetesCluster): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      isConnected ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isConnected ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: KubernetesCluster): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: KubernetesCluster): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: KubernetesCluster): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default KubernetesClusters;
