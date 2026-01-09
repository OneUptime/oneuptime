import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Service from "Common/Models/DatabaseModels/Service";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import TelemetryServiceElement from "./TelemetryServiceElement";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export interface ComponentProps {
  query?: Query<Monitor> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  actionButtons?: Array<ActionButtonSchema<Monitor>> | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
}

const TelemetryServiceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<Service>
      modelType={Service}
      id="services-table"
      isDeleteable={false}
      isEditable={false}
      userPreferencesKey="telemetry-services-table"
      query={props.query || {}}
      // Default sort: by Name ascending
      sortBy={"name"}
      sortOrder={SortOrder.Ascending}
      actionButtons={props.actionButtons}
      isCreateable={!props.disableCreate}
      name="Services"
      isViewable={true}
      cardProps={{
        title: props.title || "Services",
        description:
          props.description || "Here is a list of services for this project.",
        buttons: props.cardButtons,
      }}
      showViewIdButton={true}
      noItemsMessage={props.noItemsMessage || "No services found."}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Service  Name",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Service Description",
        },
      ]}
      showRefreshButton={true}
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_ROOT]!,
      )}
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
            description: true,
          },
          title: "Description",
          type: FieldType.Text,
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

          filterEntityType: Label,
          filterQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
      ]}
      selectMoreFields={{
        serviceColor: true,
      }}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Element,
          getElement: (service: Service): ReactElement => {
            return (
              <Fragment>
                <TelemetryServiceElement telemetryService={service} />
              </Fragment>
            );
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          type: FieldType.Text,
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

          getElement: (item: Service): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default TelemetryServiceTable;
