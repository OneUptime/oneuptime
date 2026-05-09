import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const documentationMarkdown: string = `
### How Incident Label Rules Work

Incident Label Rules attach labels to an incident automatically when it matches your criteria — including labels copied from the incident's monitors and hosts.

### Match Criteria

A rule matches an incident only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Severities**, **Incident Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every label listed under \`Labels to Add\` is attached to the incident.
- If \`Inherit Labels From Monitors\` is on, every label of the incident's monitors is also attached.
- If \`Inherit Labels From Hosts\` is on, every label of the incident's affected hosts is also attached.

Labels already on the incident are not duplicated. Multiple matching rules contribute the union of their labels.
`;

const IncidentLabelRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentLabelRule>
        modelType={IncidentLabelRule}
        id="incident-label-rules-table"
        name="Settings > Incident Label Rules"
        userPreferencesKey="incident-label-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incident Label Rules",
          description:
            "Auto-attach labels to incidents — including labels inherited from the incident's monitors and hosts — when matching incidents are created.",
        }}
        helpContent={{
          title: "How Incident Label Rules Work",
          description:
            "Match incidents and attach labels (explicit and inherited) automatically.",
          markdown: documentationMarkdown,
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
            getElement: (item: IncidentLabelRule): ReactElement => {
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
          { title: "Match Criteria", id: "match-criteria" },
          { title: "Labels", id: "labels" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Inherit monitor labels onto database incidents",
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
            field: { monitors: true },
            title: "Monitors",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for incidents from these monitors. Leave empty to match any monitor.",
            placeholder: "Select Monitors (optional)",
          },
          {
            field: { incidentSeverities: true },
            title: "Incident Severities",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Severities (optional)",
          },
          {
            field: { incidentLabels: true },
            title: "Incident Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incident Labels (optional)",
          },
          {
            field: { monitorLabels: true },
            title: "Monitor Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: { incidentTitlePattern: true },
            title: "Incident Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Case-insensitive regex matched against the incident title.",
          },
          {
            field: { incidentDescriptionPattern: true },
            title: "Incident Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
          },
          {
            field: { labelsToAdd: true },
            title: "Labels to Add",
            stepId: "labels",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Labels to attach to the incident when this rule matches.",
            placeholder: "Select Labels",
          },
          {
            field: { inheritLabelsFromMonitors: true },
            title: "Inherit Labels From Monitors",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When this rule matches, also copy every label of the incident's monitors onto the incident.",
          },
          {
            field: { inheritLabelsFromHosts: true },
            title: "Inherit Labels From Hosts",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When this rule matches, also copy every label of the incident's affected hosts onto the incident.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentLabelRulesPage;
