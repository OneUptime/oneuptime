import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ResourceDocumentationCard from "../../Components/TelemetryResource/ResourceDocumentationCard";
import { getRumDocMarkdown } from "../../Components/TelemetryResource/documentationMarkdown";

const RumApplications: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    ModelAPI.count({
      modelType: RumApplication,
      query: {},
    })
      .then(setCount)
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return <PageLoader isVisible={true} />;
  }

  if (count === 0) {
    return (
      <Fragment>
        <ResourceDocumentationCard
          title="Getting Started with Real User Monitoring"
          description="No RUM applications connected yet. Instrument your browser or mobile app with OpenTelemetry using the guide below — it appears here automatically once the first telemetry arrives."
          buildMarkdown={getRumDocMarkdown}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<RumApplication>
        modelType={RumApplication}
        id="rum-applications-table"
        userPreferencesKey="rum-applications-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        name="RUM Applications"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          appIdentifier: true,
          clientType: true,
        }}
        cardProps={{
          title: "RUM Applications",
          description:
            "Browser & mobile applications auto-discovered from OpenTelemetry RUM telemetry (browser.* / device.* resource attributes). One row per application.",
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "storefront-web",
          },
          {
            field: {
              appIdentifier: true,
            },
            title: "App Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "storefront-web",
            description:
              "This should match the service.name attribute reported by the browser / mobile OTel SDK.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Customer-facing storefront web app",
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
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              appIdentifier: true,
            },
            title: "App Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              clientType: true,
            },
            title: "Client Type",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const id: string = (item.appIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {showId && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {id}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              clientType: true,
            },
            title: "Client Type",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumApplication): ReactElement => {
              const clientType: string = (item.clientType as string) || "";
              if (!clientType) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700 capitalize">
                  {clientType}
                </span>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <Pill
                  text={isConnected ? "Connected" : "Disconnected"}
                  color={isConnected ? Green : Red}
                />
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
            getElement: (item: RumApplication): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: RumApplication): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default RumApplications;
