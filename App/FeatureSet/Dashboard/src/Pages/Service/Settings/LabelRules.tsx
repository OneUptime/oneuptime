import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceLabelRule from "Common/Models/DatabaseModels/ServiceLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const serviceLabelDocumentation: string = `
### How Service Label Rules Work

Service Label Rules attach labels to a service automatically when it matches your criteria — so you don't have to remember to tag new services.

### Match Criteria

A rule matches a service only when **all** specified criteria pass. Empty criteria are skipped.

- **Service Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the service. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const ServiceLabelRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const navButtons: Array<CardButtonSchema> = [
    {
      title: "All Services",
      icon: IconProp.List,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICES] as Route),
        );
      },
    },
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
  ];

  return (
    <ModelTable<ServiceLabelRule>
      modelType={ServiceLabelRule}
      id="service-label-rules-table"
      name="Settings > Service Label Rules"
      userPreferencesKey="service-label-rules-table"
      saveFilterProps={{
        tableId: "service-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Service Label Rules",
        description: "Auto-attach labels when matching services are created.",
        buttons: navButtons,
      }}
      helpContent={{
        title: "How Service Label Rules Work",
        description: "Match services and attach labels automatically.",
        markdown: serviceLabelDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: ServiceLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Labels", id: "labels", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Tag matching services",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
        {
          field: { serviceLabels: true },
          title: "Service Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for services that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Service Labels (optional)",
        },
        {
          field: { serviceNamePattern: true },
          title: "Service Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the service name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { serviceDescriptionPattern: true },
          title: "Service Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the service. Already-attached labels are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default ServiceLabelRulesPage;
