import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import AlertEpisodeOnCallRule from "Common/Models/DatabaseModels/AlertEpisodeOnCallRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const alertOnCallDocumentation: string = `
### How Alert On-Call Rules Work

Alert On-Call Rules let you automatically execute on-call duty policies when an alert is created that matches your criteria — without having to remember to attach the policy by hand.

\`\`\`mermaid
flowchart TD
    A[New Alert Created] --> B{Match Against On-Call Rules}
    B -->|Rule Matches| C[Add Rule's On-Call Policies to Alert]
    B -->|No Match| D[Use Only Manually Attached Policies]
    C --> E[Execute All Attached Policies]
    D --> E
\`\`\`

### Match Criteria

A rule matches an alert only when **all** specified criteria pass. Empty criteria are skipped (don't filter on that field).

- **Monitors** — alert must come from one of these monitors
- **Alert Severities** — alert must have one of these severities (any-of)
- **Alert Labels** — alert must carry at least one of these labels (any-of)
- **Monitor Labels** — the alert's monitor must carry at least one of these labels
- **Alert Title / Description Pattern** — case-insensitive regex match
- **Monitor Name / Description Pattern** — case-insensitive regex match against the alert's monitor

### Action

When a rule matches, every on-call duty policy listed on the rule is executed for the alert. Policies are deduped against any policies already attached to the alert, so each policy runs at most once.

### Multiple Matching Rules

All matching rules fire — there is no priority or short-circuit. The set of policies that ends up executing is the union of every matching rule's policies, plus any policies attached to the alert manually.
`;

const alertEpisodeOnCallDocumentation: string = `
### How Alert Episode On-Call Rules Work

Match an alert episode on creation and execute on-call duty policies automatically. Empty criteria are skipped.

- **Severities** — any-of
- **Episode Labels** — any-of
- **Title / Description Pattern** — case-insensitive regex

All matching rules fire — the union of their on-call policies is executed (deduped).
`;

const AlertRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertOnCallRule>
      modelType={AlertOnCallRule}
      id="alert-on-call-rules-table"
      name="Settings > Alert On-Call Rules"
      userPreferencesKey="alert-on-call-rules-table"
      saveFilterProps={{
        tableId: "alert-on-call-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert On-Call Rules",
        description:
          "Define rules to automatically execute on-call duty policies when matching alerts are created.",
      }}
      helpContent={{
        title: "How Alert On-Call Rules Work",
        description:
          "Match alerts against criteria and fire on-call policies automatically.",
        markdown: alertOnCallDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AlertOnCallRule): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "On-Call Policies", id: "on-call" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Page database team for any DB alert",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder:
            "Fires the database on-call rotation whenever an alert with the 'database' label is created.",
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
          field: { onCallDutyPolicies: true },
          title: "On-Call Duty Policies",
          stepId: "on-call",
          sectionTitle: "Policies to Execute",
          sectionDescription:
            "When this rule matches, every selected policy is fired. Already-attached policies are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: OnCallDutyPolicy,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select On-Call Policies",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertEpisodeOnCallRule>
      modelType={AlertEpisodeOnCallRule}
      id="alert-episode-on-call-rules-table"
      name="Settings > Alert Episode On-Call Rules"
      userPreferencesKey="alert-episode-on-call-rules-table"
      saveFilterProps={{
        tableId: "alert-episode-on-call-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Episode On-Call Rules",
        description:
          "Auto-execute on-call policies when matching alert episodes are created.",
      }}
      helpContent={{
        title: "How Alert Episode On-Call Rules Work",
        description: "Match episodes and fire on-call policies.",
        markdown: alertEpisodeOnCallDocumentation,
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
          getElement: (item: AlertEpisodeOnCallRule): ReactElement => {
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
        { title: "On-Call Policies", id: "on-call" },
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
          field: { onCallDutyPolicies: true },
          title: "On-Call Duty Policies",
          stepId: "on-call",
          sectionTitle: "Policies to Execute",
          sectionDescription:
            "When this rule matches, every selected policy is fired. Already-attached policies are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: OnCallDutyPolicy,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select On-Call Policies",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const AlertOnCallRulesPage: FunctionComponent<
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

export default AlertOnCallRulesPage;
