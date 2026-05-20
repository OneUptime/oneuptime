import LabelsElement from "Common/UI/Components/Label/Labels";
import ServiceElement from "../../Components/Service/ServiceElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Service from "Common/Models/DatabaseModels/Service";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServicesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Service>({ modelType: Service });

  const settingsButtons: Array<CardButtonSchema> = [
    {
      title: "Owner Rules",
      icon: IconProp.User,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_SETTINGS_OWNER_RULES] as Route,
          ),
        );
      },
    },
    {
      title: "Label Rules",
      icon: IconProp.Tag,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_SETTINGS_LABEL_RULES] as Route,
          ),
        );
      },
    },
  ];

  return (
    <Fragment>
      <ModelTable<Service>
        modelType={Service}
        id="service-table"
        userPreferencesKey="service-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...labelBulkActions],
        }}
        name="Services"
        isViewable={true}
        cardProps={{
          title: "Services",
          description: "List and manage services for this project here.",
          buttons: settingsButtons,
        }}
        showViewIdButton={true}
        noItemsMessage={"No services found."}
        selectMoreFields={{
          serviceColor: true,
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Service Name",
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
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Labels help you categorize and organize your services.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            placeholder: "Labels",
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description"]}
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
            type: FieldType.LongText,
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
            getElement: (service: Service): ReactElement => {
              return (
                <Fragment>
                  <ServiceElement service={service} />
                </Fragment>
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
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

            getElement: (item: Service): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
      {labelBulkActionModals}
    </Fragment>
  );
};

export default ServicesPage;
