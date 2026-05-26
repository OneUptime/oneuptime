import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceOwnerRule from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";

const scheduledMaintenanceOwnerDocumentation: string = `
### How Scheduled Maintenance Owner Rules Work

Scheduled Maintenance Owner Rules add owner users and teams to a scheduled maintenance event automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches an event only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Event Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every user and team listed on the rule is added as an owner.
- If \`Inherit Owners From Monitors\` is on, every owner of the event's monitors is also added.
- If \`Inherit Owners From Hosts\` is on, every owner of the event's affected hosts is also added.
- If \`Inherit Owners From Kubernetes Clusters\` is on, every owner of the event's affected Kubernetes clusters is also added.
- If \`Inherit Owners From Docker Hosts\` is on, every owner of the event's affected Docker hosts is also added.
- If \`Inherit Owners From Services\` is on, every owner of the event's affected services is also added.

Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const ScheduledMaintenanceOwnerRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceOwnerRule>
        modelType={ScheduledMaintenanceOwnerRule}
        id="scheduled-maintenance-owner-rules-table"
        name="Settings > Scheduled Maintenance Owner Rules"
        userPreferencesKey="scheduled-maintenance-owner-rules-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-owner-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Scheduled Maintenance Owner Rules",
          description:
            "Auto-assign owner users and teams when matching scheduled maintenance events are created.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Owner Rules Work",
          description:
            "Match scheduled maintenance events and add owner users/teams automatically.",
          markdown: scheduledMaintenanceOwnerDocumentation,
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
            getElement: (item: ScheduledMaintenanceOwnerRule): ReactElement => {
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
          { title: "Owners", id: "owners", columns: 2 },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Assign DB team to database maintenance",
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
            field: { notifyOwners: true },
            title: "Notify Owners",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Notify owners when they are added by this rule. Disable to add silently.",
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
            field: { ownerTeams: true },
            title: "Owner Teams",
            stepId: "owners",
            sectionTitle: "Owners to Assign",
            sectionDescription:
              "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Teams",
          },
          {
            field: { ownerUsers: true },
            title: "Owner Users",
            stepId: "owners",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            required: false,
            placeholder: "Select Users",
          },
          {
            field: { inheritOwnersFromMonitors: true },
            title: "Inherit Owners From Monitors",
            stepId: "owners",
            sectionTitle: "Inherit Owners",
            sectionDescription:
              "Optionally assign owners from related entities to the event.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Assign every owner of the event's monitors as an owner of the event.",
          },
          {
            field: { inheritOwnersFromHosts: true },
            title: "Inherit Owners From Hosts",
            stepId: "owners",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Assign every owner of the event's affected hosts as an owner of the event.",
          },
          {
            field: { inheritOwnersFromKubernetesClusters: true },
            title: "Inherit Owners From Kubernetes Clusters",
            stepId: "owners",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Assign every owner of the event's affected Kubernetes clusters as an owner of the event.",
          },
          {
            field: { inheritOwnersFromDockerHosts: true },
            title: "Inherit Owners From Docker Hosts",
            stepId: "owners",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Assign every owner of the event's affected Docker hosts as an owner of the event.",
          },
          {
            field: { inheritOwnersFromServices: true },
            title: "Inherit Owners From Services",
            stepId: "owners",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Assign every owner of the event's affected services as an owner of the event.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceOwnerRulesPage;
