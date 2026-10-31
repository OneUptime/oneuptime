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
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import {
  getOnCallRuleActionFields,
  getOnCallRuleFormSteps,
} from "../../../Utils/Form/EventRuleForm";
import { OnCallRuleNameCell } from "../../../Components/OnCallRule/WorkingHoursSummary";
import { OnCallRuleRecord } from "../../../Components/OnCallRule/WorkingHoursText";

const alertOnCallDocumentation: string = `
### How Alert On-Call Rules Work

An on-call rule pages on-call policies for every new alert it matches, so nobody has to remember to add the policy by hand.

\`\`\`mermaid
flowchart TD
    A[New Alert Created] --> B{Match Against On-Call Rules}
    B -->|Rule Matches| C[Add the Rule's On-Call Policies]
    B -->|No Match| D[Only the Policies Added by Hand]
    C --> E[Each Policy Pages Its People]
    D --> E
\`\`\`

### Match Criteria

The conditions a new alert must meet.

### What It Does

When a rule matches, each of its on-call policies pages its people for the alert. A policy already on the alert is not run twice.

### Several Matching Rules

Every rule that matches runs: there is no order and no first match. Their policies are added to any added by hand, and each policy runs once.
`;

const alertEpisodeOnCallDocumentation: string = `
### How Alert Episode On-Call Rules Work

An episode on-call rule pages on-call policies for every new alert episode it matches.

### Match Criteria

The conditions a new episode must meet.

### What It Does

When a rule matches, each of its on-call policies pages its people for the episode. Every rule that matches runs, and each policy runs once.
`;

const AlertRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertOnCallRule>
      modelType={AlertOnCallRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
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
          "Page on-call policies automatically for new alerts that match.",
      }}
      helpContent={{
        title: "How Alert On-Call Rules Work",
        description: "Which new alerts page which on-call policies.",
        markdown: alertOnCallDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        whenToPage: true,
        workingHours: true,
        workingHoursTimezone: true,
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
          getElement: (item: AlertOnCallRule): ReactElement => {
            return <OnCallRuleNameCell name={item.name || ""} rule={item} />;
          },
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
      formSteps={getOnCallRuleFormSteps<AlertOnCallRule>()}
      formFields={[
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
          placeholder: "Select Monitors",
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
            sort: {
              order: SortOrder.Ascending,
            },
          },
          required: false,
          placeholder: "Select Severities",
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
          placeholder: "Select Alert Labels",
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
          placeholder: "Select Monitor Labels",
        },
        {
          field: { alertTitlePattern: true },
          title: "Alert Title",
          description: "Leave empty to match any title.",
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
          title: "Alert Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        {
          field: { monitorNamePattern: true },
          title: "Monitor Name",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { monitorDescriptionPattern: true },
          title: "Monitor Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOnCallRuleActionFields<AlertOnCallRule>(OnCallRuleRecord.Alert),
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AlertEpisodeOnCallRule>
      modelType={AlertEpisodeOnCallRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
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
          "Page on-call policies automatically for new alert episodes that match.",
      }}
      helpContent={{
        title: "How Alert Episode On-Call Rules Work",
        description: "Which new episodes page which on-call policies.",
        markdown: alertEpisodeOnCallDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        whenToPage: true,
        workingHours: true,
        workingHoursTimezone: true,
      }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
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
          getElement: (item: AlertEpisodeOnCallRule): ReactElement => {
            return <OnCallRuleNameCell name={item.name || ""} rule={item} />;
          },
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
      formSteps={getOnCallRuleFormSteps<AlertEpisodeOnCallRule>()}
      formFields={[
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
            sort: {
              order: SortOrder.Ascending,
            },
          },
          required: false,
          placeholder: "Select Severities",
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
          placeholder: "Select Labels",
        },
        {
          field: { episodeTitlePattern: true },
          title: "Episode Title",
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
          title: "Episode Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        ...getOnCallRuleActionFields<AlertEpisodeOnCallRule>(
          OnCallRuleRecord.AlertEpisode,
        ),
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
