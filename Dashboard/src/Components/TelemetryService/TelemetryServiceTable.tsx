import LabelsElement from "../../Components/Label/Labels";
import DashboardNavigation from "../../Utils/Navigation";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ActionButtonSchema from "CommonUI/src/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "CommonUI/src/Components/Card/Card";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import TelemetryServiceElement from "./TelemetryServiceElement";

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
    <ModelTable<TelemetryService>
      modelType={TelemetryService}
      id="services-table"
      isDeleteable={false}
      isEditable={false}
      query={props.query || {}}
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
          required: true,
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
            projectId: DashboardNavigation.getProjectId()?.toString(),
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
          getElement: (service: TelemetryService): ReactElement => {
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

          getElement: (item: TelemetryService): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default TelemetryServiceTable;
