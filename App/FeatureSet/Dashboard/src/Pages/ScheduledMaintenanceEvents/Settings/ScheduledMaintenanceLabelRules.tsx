import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceLabelRule from "Common/Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";

const scheduledMaintenanceLabelDocumentation: string = `
### How Scheduled Maintenance Label Rules Work

Scheduled Maintenance Label Rules attach labels to a scheduled maintenance event automatically when it matches your criteria — including labels copied from the event's monitors, hosts, Kubernetes clusters, and Docker hosts.

### Match Criteria

A rule matches an event only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Event Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every label listed under \`Labels to Add\` is attached to the event.
- If \`Inherit Labels From Monitors\` is on, every label of the event's monitors is also attached.
- If \`Inherit Labels From Hosts\` is on, every label of the event's affected hosts is also attached.
- If \`Inherit Labels From Kubernetes Clusters\` is on, every label of the event's affected Kubernetes clusters is also attached.
- If \`Inherit Labels From Docker Hosts\` is on, every label of the event's affected Docker hosts is also attached.

Labels already on the event are not duplicated. Multiple matching rules contribute the union of their labels.
`;

const ScheduledMaintenanceLabelRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceLabelRule>
        modelType={ScheduledMaintenanceLabelRule}
        id="scheduled-maintenance-label-rules-table"
        name="Settings > Scheduled Maintenance Label Rules"
        userPreferencesKey="scheduled-maintenance-label-rules-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-label-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Scheduled Maintenance Label Rules",
          description:
            "Auto-attach labels to scheduled maintenance events — including labels inherited from the event's monitors, hosts, Kubernetes clusters, and Docker hosts — when matching events are created.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Label Rules Work",
          description:
            "Match events and attach labels (explicit and inherited) automatically.",
          markdown: scheduledMaintenanceLabelDocumentation,
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
            getElement: (item: ScheduledMaintenanceLabelRule): ReactElement => {
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
          { title: "Labels", id: "labels" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Inherit monitor labels onto maintenance events",
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
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter events by which monitor they affect and their labels. Leave a filter empty to skip it.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors (optional)",
          },
          {
            field: { scheduledMaintenanceLabels: true },
            title: "Event Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Event Labels (optional)",
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
            field: { titlePattern: true },
            title: "Title Pattern",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against event and monitor text.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "DB.*maintenance",
          },
          {
            field: { descriptionPattern: true },
            title: "Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "upgrade|migration",
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
            placeholder: "production|critical",
          },
          {
            field: { labelsToAdd: true },
            title: "Labels to Add",
            stepId: "labels",
            sectionTitle: "Labels to Attach",
            sectionDescription:
              "When this rule matches, every selected label is attached to the event. Existing labels are preserved.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Labels",
          },
          {
            field: { inheritLabelsFromMonitors: true },
            title: "Inherit Labels From Monitors",
            stepId: "labels",
            sectionTitle: "Inherit Labels",
            sectionDescription:
              "Optionally copy labels from related entities onto the event.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Copy every label of the event's monitors onto the event.",
          },
          {
            field: { inheritLabelsFromHosts: true },
            title: "Inherit Labels From Hosts",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Copy every label of the event's affected hosts onto the event.",
          },
          {
            field: { inheritLabelsFromKubernetesClusters: true },
            title: "Inherit Labels From Kubernetes Clusters",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Copy every label of the event's affected Kubernetes clusters onto the event.",
          },
          {
            field: { inheritLabelsFromDockerHosts: true },
            title: "Inherit Labels From Docker Hosts",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Copy every label of the event's affected Docker hosts onto the event.",
          },
          {
            field: { inheritLabelsFromServices: true },
            title: "Inherit Labels From Services",
            stepId: "labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Copy every label of the event's affected services onto the event.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceLabelRulesPage;
