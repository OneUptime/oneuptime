import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
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
import DockerDocumentationCard from "../../Components/Docker/DocumentationCard";

const DockerHosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [hostCount, setHostCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DockerHost>({ modelType: DockerHost });

  const fetchHostCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: DockerHost,
        query: {},
      });
      setHostCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHostCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (hostCount === 0) {
    return (
      <Fragment>
        <DockerDocumentationCard
          title="Getting Started with Docker Monitoring"
          description="No Docker hosts connected yet. Install the agent using the guide below and your host will appear here automatically."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<DockerHost>
        modelType={DockerHost}
        id="docker-hosts-table"
        userPreferencesKey="docker-hosts-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...labelBulkActions],
        }}
        name="Docker Hosts"
        isViewable={true}
        filters={[]}
        cardProps={{
          title: "Docker Hosts",
          description:
            "Hosts being monitored in this project. Install the OneUptime Docker Agent to connect a host.",
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
            placeholder: "production-docker-host-1",
          },
          {
            field: {
              hostIdentifier: true,
            },
            title: "Host Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "docker-host-prod-1",
            description:
              "This should match the host.name attribute reported by the Docker Agent.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Docker host running in US East",
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
            type: FieldType.Text,
          },
          {
            field: {
              hostIdentifier: true,
            },
            title: "Host Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: DockerHost): ReactElement => {
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
            getElement: (item: DockerHost): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: DockerHost): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
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

export default DockerHosts;
