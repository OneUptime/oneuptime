import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import AlertEpisodeOwnerRule from "Common/Models/DatabaseModels/AlertEpisodeOwnerRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";

const alertOwnerDocumentation: string = `
### How Alert Owner Rules Work

Alert Owner Rules add owner users and teams to an alert automatically when it matches your criteria.

### Match Criteria

A rule matches an alert only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Severities**, **Alert Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every user and team listed on the rule is added as an owner.
- If \`Inherit Owners From Monitors\` is on, every owner of the alert's monitor is also added.
- If \`Inherit Owners From Hosts\` is on, every owner of the alert's affected hosts is also added.

Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified.
`;

const alertEpisodeOwnerDocumentation: string = `
### How Alert Episode Owner Rules Work

Match an alert episode on creation and add owner users / teams automatically.
`;

const AlertRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertOwnerRule>
      modelType={AlertOwnerRule}
      id="alert-owner-rules-table"
      name="Settings > Alert Owner Rules"
      userPreferencesKey="alert-owner-rules-table"
      saveFilterProps={{
        tableId: "alert-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Owner Rules",
        description:
          "Auto-assign owner users and teams when matching alerts are created.",
      }}
      helpContent={{
        title: "How Alert Owner Rules Work",
        description: "Match alerts and add owner users/teams automatically.",
        markdown: alertOwnerDocumentation,
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
          getElement: (item: AlertOwnerRule): ReactElement => {
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
          placeholder: "Assign infra team to disk-pressure alerts",
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
            "Filter alerts by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
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
          field: { alertSeverities: true },
          title: "Alert Severities",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: AlertSeverity,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Severities (optional)",
        },
        {
          field: { alertLabels: true },
          title: "Alert Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Alert Labels (optional)",
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
          field: { alertTitlePattern: true },
          title: "Alert Title Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against alert and monitor text.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "CPU.*high",
        },
        {
          field: { alertDescriptionPattern: true },
          title: "Alert Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
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
            "Optionally assign owners from related entities to the alert.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Assign every owner of the alert's monitor as an owner of the alert.",
        },
        {
          field: { inheritOwnersFromHosts: true },
          title: "Inherit Owners From Hosts",
          stepId: "owners",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Assign every owner of the alert's affected hosts as an owner of the alert.",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertEpisodeOwnerRule>
      modelType={AlertEpisodeOwnerRule}
      id="alert-episode-owner-rules-table"
      name="Settings > Alert Episode Owner Rules"
      userPreferencesKey="alert-episode-owner-rules-table"
      saveFilterProps={{
        tableId: "alert-episode-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Episode Owner Rules",
        description:
          "Auto-assign owner users and teams when matching alert episodes are created.",
      }}
      helpContent={{
        title: "How Alert Episode Owner Rules Work",
        description: "Match episodes and add owner users/teams automatically.",
        markdown: alertEpisodeOwnerDocumentation,
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
          getElement: (item: AlertEpisodeOwnerRule): ReactElement => {
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
        },
        {
          field: { notifyOwners: true },
          title: "Notify Owners",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Notify owners when they are added by this rule.",
        },
        {
          field: { alertSeverities: true },
          title: "Alert Severities",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter episodes by severity and labels. Leave a filter empty to skip it.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: AlertSeverity,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Severities (optional)",
        },
        {
          field: { episodeLabels: true },
          title: "Episode Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels (optional)",
        },
        {
          field: { episodeTitlePattern: true },
          title: "Episode Title Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against episode title and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "CPU.*high",
        },
        {
          field: { episodeDescriptionPattern: true },
          title: "Episode Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
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
      ]}
      showRefreshButton={true}
    />
  );
};

const AlertOwnerRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Alert Rules",
            children: <AlertRulesTable />,
          },
          {
            name: "Episode Rules",
            children: <EpisodeRulesTable />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default AlertOwnerRulesPage;
