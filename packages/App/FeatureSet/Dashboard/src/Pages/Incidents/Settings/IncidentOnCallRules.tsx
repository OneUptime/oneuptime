import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import IncidentEpisodeOnCallRule from "Common/Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRuleOwningTeam from "Common/Models/DatabaseModels/IncidentOnCallRuleOwningTeam";
import IncidentEpisodeOnCallRuleOwningTeam from "Common/Models/DatabaseModels/IncidentEpisodeOnCallRuleOwningTeam";
import useRuleOwningTeams, {
  RuleOwningTeamsTable,
} from "../../../Components/TeamOwnedRule/RuleOwningTeams";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import {
  getOnCallRuleActionFields,
  getOnCallRuleFormSteps,
} from "../../../Utils/Form/EventRuleForm";
import { OnCallRuleNameCell } from "../../../Components/OnCallRule/WorkingHoursSummary";
import { OnCallRuleRecord } from "../../../Components/OnCallRule/WorkingHoursText";

const incidentOnCallDocumentation: string = `
### How Incident On-Call Rules Work

An on-call rule pages on-call policies for every new incident it matches, so nobody has to remember to add the policy by hand.

\`\`\`mermaid
flowchart TD
    A[New Incident Created] --> B{Match Against On-Call Rules}
    B -->|Rule Matches| C[Add the Rule's On-Call Policies]
    B -->|No Match| D[Only the Policies Added by Hand]
    C --> E[Each Policy Pages Its People]
    D --> E
\`\`\`

### Match Criteria

The conditions a new incident must meet.

### What It Does

When a rule matches, each of its on-call policies pages its people for the incident. A policy already on the incident is not run twice.

### Responders or Observers

A rule pages its policies' people as **responders** - they take the incident on, and acknowledging the page acknowledges it - or, under More fields, as **observers**: kept informed while the people responding stay on it. An observer's answer only says they've seen the page: the incident is not acknowledged, nobody else's page stops, and they don't become its Incident Commander. Use it to tell an oversight team about every critical incident another team owns.

### When the Severity or Labels Change

Rules run when an incident is declared, and again whenever its severity or labels change while it is open: raised to a severity a rule pages for, or labelled org-wide, the incident pages that rule's policies then. Nothing is undone when it stops matching.

### Several Matching Rules

Every rule that matches runs: there is no order and no first match. Their policies are added to any added by hand or by a template, and each policy runs once. A policy that one rule pages as responders and another as observers pages responders.

### Rules That Belong to Teams

Under More fields, **Owning Teams** keeps a rule to the teams you pick: only their members, with those teams' permissions, and project admins can edit or delete it. Everyone else who can see rules still sees it, read-only. A rule with no owning teams can be changed by everyone who can edit rules.
`;

const incidentEpisodeOnCallDocumentation: string = `
### How Incident Episode On-Call Rules Work

An episode on-call rule pages on-call policies for every new incident episode it matches.

### Match Criteria

The conditions a new episode must meet.

### What It Does

When a rule matches, each of its on-call policies pages its people for the episode. Every rule that matches runs, and each policy runs once.
`;

const IncidentRulesTable: FunctionComponent = (): ReactElement => {
  // Who owns each rule: its column, its form field and its row locks.
  const owningTeams: RuleOwningTeamsTable<IncidentOnCallRule> =
    useRuleOwningTeams<IncidentOnCallRule>({
      ruleModelType: IncidentOnCallRule,
      owningTeamModelType: IncidentOnCallRuleOwningTeam,
    });

  return (
    <ModelTable<IncidentOnCallRule>
      modelType={IncidentOnCallRule}
      onFetchSuccess={owningTeams.onRulesFetched}
      getEditDisabledReason={owningTeams.getEditDisabledReason}
      getDeleteDisabledReason={owningTeams.getDeleteDisabledReason}
      onEditFormItemFetched={owningTeams.onEditFormItemFetched}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      id="incident-on-call-rules-table"
      name="Settings > Incident On-Call Rules"
      userPreferencesKey="incident-on-call-rules-table"
      saveFilterProps={{
        tableId: "incident-on-call-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident On-Call Rules",
        description:
          "Page on-call policies automatically for incidents that match - as responders, or as observers kept informed.",
      }}
      helpContent={{
        title: "How Incident On-Call Rules Work",
        description: "Which new incidents page which on-call policies.",
        markdown: incidentOnCallDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        whenToPage: true,
        workingHours: true,
        workingHoursTimezone: true,
        pageAs: true,
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
          getElement: (item: IncidentOnCallRule): ReactElement => {
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
          getElement: (item: IncidentOnCallRule): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
        owningTeams.owningTeamsColumn,
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={getOnCallRuleFormSteps<IncidentOnCallRule>()}
      formFields={[
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter incidents by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
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
          field: { incidentSeverities: true },
          title: "Incident Severities",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: IncidentSeverity,
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
          placeholder: "Select Incident Labels",
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
          field: { incidentTitlePattern: true },
          title: "Incident Title",
          description: "Leave empty to match any title.",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against incident and monitor text.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "CPU.*high",
        },
        {
          field: { incidentDescriptionPattern: true },
          title: "Incident Description",
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
        ...getOnCallRuleActionFields<IncidentOnCallRule>(
          OnCallRuleRecord.Incident,
        ),
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent = (): ReactElement => {
  // Who owns each rule: its column, its form field and its row locks.
  const owningTeams: RuleOwningTeamsTable<IncidentEpisodeOnCallRule> =
    useRuleOwningTeams<IncidentEpisodeOnCallRule>({
      ruleModelType: IncidentEpisodeOnCallRule,
      owningTeamModelType: IncidentEpisodeOnCallRuleOwningTeam,
    });

  return (
    <ModelTable<IncidentEpisodeOnCallRule>
      modelType={IncidentEpisodeOnCallRule}
      onFetchSuccess={owningTeams.onRulesFetched}
      getEditDisabledReason={owningTeams.getEditDisabledReason}
      getDeleteDisabledReason={owningTeams.getDeleteDisabledReason}
      onEditFormItemFetched={owningTeams.onEditFormItemFetched}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      id="incident-episode-on-call-rules-table"
      name="Settings > Incident Episode On-Call Rules"
      userPreferencesKey="incident-episode-on-call-rules-table"
      saveFilterProps={{
        tableId: "incident-episode-on-call-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident Episode On-Call Rules",
        description:
          "Page on-call policies automatically for new incident episodes that match.",
      }}
      helpContent={{
        title: "How Incident Episode On-Call Rules Work",
        description: "Which new episodes page which on-call policies.",
        markdown: incidentEpisodeOnCallDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        whenToPage: true,
        workingHours: true,
        workingHoursTimezone: true,
        pageAs: true,
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
          getElement: (item: IncidentEpisodeOnCallRule): ReactElement => {
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
          getElement: (item: IncidentEpisodeOnCallRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
        owningTeams.owningTeamsColumn,
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={getOnCallRuleFormSteps<IncidentEpisodeOnCallRule>()}
      formFields={[
        {
          field: { incidentSeverities: true },
          title: "Incident Severities",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter episodes by severity and labels. Leave a filter empty to skip it.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: IncidentSeverity,
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
        ...getOnCallRuleActionFields<IncidentEpisodeOnCallRule>(
          OnCallRuleRecord.IncidentEpisode,
        ),
      ]}
      showRefreshButton={true}
    />
  );
};

const IncidentOnCallRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Incident Rules",
            children: <IncidentRulesTable />,
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

export default IncidentOnCallRulesPage;
