import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import AlertEpisodeLabelRule from "Common/Models/DatabaseModels/AlertEpisodeLabelRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const alertLabelDocumentation: string = `
### How Alert Label Rules Work

Alert Label Rules attach labels to an alert automatically when it matches your criteria — including labels copied from the alert's monitor, hosts, Kubernetes clusters, Docker hosts, and Podman hosts.

### Match Criteria

A rule matches an alert only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Severities**, **Alert Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every label listed under \`Labels to Add\` is attached to the alert.
- If \`Inherit Labels From Monitor\` is on, every label of the alert's monitor is also attached.
- If \`Inherit Labels From Hosts\` is on, every label of the alert's affected hosts is also attached.
- If \`Inherit Labels From Kubernetes Clusters\` is on, every label of the alert's affected Kubernetes clusters is also attached.
- If \`Inherit Labels From Docker Hosts\` is on, every label of the alert's affected Docker hosts is also attached.
- If \`Inherit Labels From Podman Hosts\` is on, every label of the alert's affected Podman hosts is also attached.

Labels already on the alert are not duplicated. Multiple matching rules contribute the union of their labels.
`;

const alertEpisodeLabelDocumentation: string = `
### How Alert Episode Label Rules Work

Alert Episode Label Rules attach labels to an episode automatically when it matches your criteria.

### Match Criteria

A rule matches an episode only when **all** specified criteria pass. Empty criteria are skipped.

- **Severities**, **Episode Labels** — any-of (M2M)
- **Title / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed under \`Labels to Add\` is attached to the episode. Labels already on the episode are not duplicated.
`;

const AlertRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertLabelRule>
      modelType={AlertLabelRule}
      id="alert-label-rules-table"
      name="Settings > Alert Label Rules"
      userPreferencesKey="alert-label-rules-table"
      saveFilterProps={{
        tableId: "alert-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Label Rules",
        description:
          "Auto-attach labels to alerts — including labels inherited from the alert's monitor, hosts, Kubernetes clusters, Docker hosts, and Podman hosts — when matching alerts are created.",
      }}
      helpContent={{
        title: "How Alert Label Rules Work",
        description:
          "Match alerts and attach labels (explicit and inherited) automatically.",
        markdown: alertLabelDocumentation,
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
          getElement: (item: AlertLabelRule): ReactElement => {
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
          placeholder: "Inherit monitor labels onto database alerts",
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
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the alert. Existing labels are preserved.",
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
          title: "Inherit Labels From Monitor",
          stepId: "labels",
          sectionTitle: "Inherit Labels",
          sectionDescription:
            "Optionally copy labels from related entities onto the alert.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "When this rule matches, also copy every label of the alert's monitor onto the alert.",
        },
        {
          field: { inheritLabelsFromHosts: true },
          title: "Inherit Labels From Hosts",
          stepId: "labels",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Copy every label of the alert's affected hosts onto the alert.",
        },
        {
          field: { inheritLabelsFromKubernetesClusters: true },
          title: "Inherit Labels From Kubernetes Clusters",
          stepId: "labels",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Copy every label of the alert's affected Kubernetes clusters onto the alert.",
        },
        {
          field: { inheritLabelsFromDockerHosts: true },
          title: "Inherit Labels From Docker Hosts",
          stepId: "labels",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Copy every label of the alert's affected Docker hosts onto the alert.",
        },
        {
          field: { inheritLabelsFromPodmanHosts: true },
          title: "Inherit Labels From Podman Hosts",
          stepId: "labels",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Copy every label of the alert's affected Podman hosts onto the alert.",
        },
        {
          field: { inheritLabelsFromServices: true },
          title: "Inherit Labels From Services",
          stepId: "labels",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Copy every label of the alert's affected services onto the alert.",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertEpisodeLabelRule>
      modelType={AlertEpisodeLabelRule}
      id="alert-episode-label-rules-table"
      name="Settings > Alert Episode Label Rules"
      userPreferencesKey="alert-episode-label-rules-table"
      saveFilterProps={{
        tableId: "alert-episode-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Episode Label Rules",
        description:
          "Auto-attach labels to alert episodes when matching episodes are created.",
      }}
      helpContent={{
        title: "How Alert Episode Label Rules Work",
        description: "Match episodes and attach labels automatically.",
        markdown: alertEpisodeLabelDocumentation,
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
          getElement: (item: AlertEpisodeLabelRule): ReactElement => {
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
          placeholder: "Tag P1 episodes with critical label",
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
          placeholder: "Select Episode Labels (optional)",
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
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the episode. Existing labels are preserved.",
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

const AlertLabelRulesPage: FunctionComponent<
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

export default AlertLabelRulesPage;
