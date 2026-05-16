import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageLabelRule from "Common/Models/DatabaseModels/StatusPageLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const statusPageLabelDocumentation: string = `
### How Status Page Label Rules Work

Status Page Label Rules attach labels to a status page automatically when it matches your criteria — so you don't have to remember to tag new status pages.

### Match Criteria

A rule matches a status page only when **all** specified criteria pass. Empty criteria are skipped.

- **Status Page Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the status page. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const StatusPageLabelRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<StatusPageLabelRule>
      modelType={StatusPageLabelRule}
      id="status-page-label-rules-table"
      name="Settings > Status Page Label Rules"
      userPreferencesKey="status-page-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Status Page Label Rules",
        description:
          "Auto-attach labels when matching status pages are created.",
      }}
      helpContent={{
        title: "How Status Page Label Rules Work",
        description: "Match status pages and attach labels automatically.",
        markdown: statusPageLabelDocumentation,
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
          getElement: (item: StatusPageLabelRule): ReactElement => {
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
          placeholder: "Tag public status pages with external-label",
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
          field: { statusPageLabels: true },
          title: "Status Page Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for status pages that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Status Page Labels (optional)",
        },
        {
          field: { statusPageNamePattern: true },
          title: "Status Page Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the status page name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "public-.*",
        },
        {
          field: { statusPageDescriptionPattern: true },
          title: "Status Page Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer|external",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the status page. Already-attached labels are not duplicated.",
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

export default StatusPageLabelRulesPage;
