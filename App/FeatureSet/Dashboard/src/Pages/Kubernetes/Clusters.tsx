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
} from "../../Components/ResourceOwners/useResourceOwners";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import KubernetesDocumentationCard from "../../Components/Kubernetes/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

const KubernetesClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<KubernetesCluster>({ modelType: KubernetesCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<KubernetesCluster>({
      ownerUserModelType: KubernetesClusterOwnerUser,
      ownerTeamModelType: KubernetesClusterOwnerTeam,
      resourceIdField: "kubernetesClusterId",
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
      toQueryValue: (values: Array<string>): unknown => {
        return values[0];
      },
    },
  ];

  const {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
  } = useResourceOwners<KubernetesCluster>({
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

  useEffect(() => {
    fetchClusterCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
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
      <ModelTable<KubernetesCluster>
        modelType={KubernetesCluster}
        id="kubernetes-clusters-table"
        userPreferencesKey="kubernetes-clusters-table"
        topContent={filterBar}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<KubernetesCluster>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
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
              const id: string | undefined = item.id?.toString();
              return (
                <OwnersCell
                  owners={id ? ownersByResourceId[id] : undefined}
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
