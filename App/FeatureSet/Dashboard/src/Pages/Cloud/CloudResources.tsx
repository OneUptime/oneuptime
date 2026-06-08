import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

const CloudResources: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        id="cloud-resources-table"
        userPreferencesKey="cloud-resources-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        name="Cloud Resources"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          resourceIdentifier: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
        }}
        cardProps={{
          title: "Cloud Resources",
          description:
            "Managed cloud compute auto-discovered from OpenTelemetry cloud.platform (AWS ECS/Fargate, GCP Cloud Run, Azure Container Apps, Elastic Beanstalk, App Runner).",
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "checkout-service",
          },
          {
            field: {
              resourceIdentifier: true,
            },
            title: "Resource Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "checkout-service",
            description:
              "This should match the service.name attribute reported by the OTel collector.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Runs on AWS ECS Fargate",
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
              resourceIdentifier: true,
            },
            title: "Resource Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              cloudPlatform: true,
            },
            title: "Cloud Platform",
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
            getElement: (item: CloudResource): ReactElement => {
              const id: string = (item.resourceIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
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
              cloudPlatform: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              const platform: string = (item.cloudPlatform as string) || "";
              const region: string = (item.cloudRegion as string) || "";
              if (!platform && !region) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="text-sm text-gray-700">
                  <span className="font-mono">{platform || "unknown"}</span>
                  {region && (
                    <span className="ml-1.5 text-xs text-gray-500">
                      {region}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
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
            getElement: (item: CloudResource): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: CloudResource): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
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

export default CloudResources;
