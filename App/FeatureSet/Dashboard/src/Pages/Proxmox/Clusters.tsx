import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ProxmoxDocumentationCard from "../../Components/Proxmox/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

const ProxmoxClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<ProxmoxCluster>({ modelType: ProxmoxCluster });

  const fetchClusterCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: ProxmoxCluster,
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
        <ProxmoxDocumentationCard
          title="Getting Started with Proxmox Monitoring"
          description="No Proxmox clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<ProxmoxCluster>
        modelType={ProxmoxCluster}
        id="proxmox-clusters-table"
        userPreferencesKey="proxmox-clusters-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [...labelBulkActions],
        }}
        name="Proxmox Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Proxmox Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime Proxmox Agent to connect a cluster.",
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
            placeholder: "pve-production",
            description:
              "This should match the proxmox.cluster.name resource attribute reported by the Proxmox Agent.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Proxmox cluster running in US East",
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
            getElement: (item: ProxmoxCluster): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
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
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: ProxmoxCluster): ReactElement => {
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
              pveVersion: true,
            },
            title: "PVE Version",
            type: FieldType.Text,
            hideOnMobile: true,
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
            getElement: (item: ProxmoxCluster): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: ProxmoxCluster): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {labelBulkActionModals}
    </Fragment>
  );
};

export default ProxmoxClusters;
