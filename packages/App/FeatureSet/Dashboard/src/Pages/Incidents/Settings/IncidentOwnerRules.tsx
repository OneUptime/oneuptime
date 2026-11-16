import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getCreatorTeamOwnerRuleActionFields,
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
  getOwnerRuleOwningTeamsFields,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import IncidentOwnerRule from "Common/Models/DatabaseModels/IncidentOwnerRule";
import IncidentEpisodeOwnerRule from "Common/Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentOwnerRuleOwningTeam from "Common/Models/DatabaseModels/IncidentOwnerRuleOwningTeam";
import useRuleOwningTeams, {
  RuleOwningTeamsTable,
} from "../../../Components/TeamOwnedRule/RuleOwningTeams";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const incidentOwnerDocumentation: string = `
An owner rule makes people and teams owners of every incident it matches, so the right people own an incident from the moment it is declared.

## How It Works

- Rules run as each incident is declared, and again whenever its severity or labels change while it is open. An incident raised to a severity a rule matches, or labelled org-wide, gets that rule's owners then. This is how an oversight team takes over an incident that grows.
- Every rule that matches adds its owners. An owner the incident already has is not added twice, and nobody is removed when the incident stops matching.
- Whoever declares an incident owns it, whatever the rules say. The summary step of **Declare Incident** lists each rule that will run, and whom it will add.
- To add owners to incidents you already have, open a rule and select **Run Now**.

## Match Criteria

Add conditions on the incident, such as its monitors, severity, labels or title, and choose whether all of them or any one must match.

## Owners a Rule Copies

Under **Inherit Owners**, a rule can also add the owners of the incident's monitors, and of the hosts, Kubernetes clusters, Docker hosts, Podman hosts and services it affects.

**Creator's Team** adds each team you list that the person declaring the incident is in. An incident declared by a monitor, a workflow or an API key has no creator, so it gets none of these teams.

## Telling the New Owners

With **Notify Owners** on (the default), the people and teams a rule adds are told they now own the incident. Turn it off to add them quietly.

## Rules That Belong to Teams

Under **More fields**, **Owning Teams** limits who can change a rule: only members of the teams you pick, with those teams' permissions, and Project Admins. It does not change whom the rule adds to incidents. A rule with no owning teams can be changed by anyone who can edit rules.
`;

const incidentEpisodeOwnerDocumentation: string = `
An episode owner rule makes people and teams owners of every new incident episode it matches, so each episode has someone responsible for it.

## How It Works

- Rules run as each episode opens. To add owners to episodes you already have, open a rule and select **Run Now**.
- Every rule that matches adds its owners. An owner the episode already has is not added twice.
- With **Notify Owners** on (the default), the people and teams a rule adds are told.

## Match Criteria

Add conditions on the episode, such as its severity, labels or title, and choose whether all of them or any one must match.
`;

interface RulesTableProps {
  // Set when the page is routed as this rule's view page.
  viewRuleId?: ObjectID | undefined;
}

const IncidentRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  /*
   * Who owns each rule - who alone may change it, not the owners it adds to
   * incidents: its column, its form field and its row locks, and on the
   * rule's own page its Edit and Delete locks.
   */
  const owningTeams: RuleOwningTeamsTable<IncidentOwnerRule> =
    useRuleOwningTeams<IncidentOwnerRule>({
      ruleModelType: IncidentOwnerRule,
      owningTeamModelType: IncidentOwnerRuleOwningTeam,
      viewRuleId: props.viewRuleId,
    });

  return (
    <RuleTable<IncidentOwnerRule>
      modelType={IncidentOwnerRule}
      onFetchSuccess={owningTeams.onRulesFetched}
      getEditDisabledReason={owningTeams.getEditDisabledReason}
      getDeleteDisabledReason={owningTeams.getDeleteDisabledReason}
      onEditFormItemFetched={owningTeams.onEditFormItemFetched}
      ruleOwnership={owningTeams.viewRuleOwnership}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: IncidentOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.INCIDENTS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="incident-owner-rules-table"
      name="Settings > Incident Owner Rules"
      userPreferencesKey="incident-owner-rules-table"
      saveFilterProps={{
        tableId: "incident-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident Owner Rules",
        description:
          "Auto-assign owner users and teams when matching incidents are created.",
      }}
      helpContent={{
        title: "How Incident Owner Rules Work",
        description: "Match incidents and add owner users/teams automatically.",
        markdown: incidentOwnerDocumentation,
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
          getElement: (item: IncidentOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
        owningTeams.owningTeamsColumn,
      ]}
      formSteps={getOwnerRuleFormSteps<IncidentOwnerRule>()}
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
        ...getCreatorTeamOwnerRuleActionFields<IncidentOwnerRule>("incident"),
        ...getOwnerRuleOwningTeamsFields<IncidentOwnerRule>(
          IncidentOwnerRuleOwningTeam,
        ),
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <RuleTable<IncidentEpisodeOwnerRule>
      modelType={IncidentEpisodeOwnerRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: IncidentEpisodeOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.INCIDENTS_SETTINGS_EPISODE_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="incident-episode-owner-rules-table"
      name="Settings > Incident Episode Owner Rules"
      userPreferencesKey="incident-episode-owner-rules-table"
      saveFilterProps={{
        tableId: "incident-episode-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident Episode Owner Rules",
        description:
          "Auto-assign owner users and teams when matching incident episodes are created.",
      }}
      helpContent={{
        title: "How Incident Episode Owner Rules Work",
        description: "Match episodes and add owner users/teams automatically.",
        markdown: incidentEpisodeOwnerDocumentation,
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
          getElement: (item: IncidentEpisodeOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<IncidentEpisodeOwnerRule>()}
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
        ...getOwnerRuleActionFields<IncidentEpisodeOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

const IncidentOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  /*
   * Routed as a rule's view page, the page shows only that rule, through
   * the table that lists it, instead of the tabs.
   */
  const incidentRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    IncidentOwnerRule,
  );
  const episodeRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    IncidentEpisodeOwnerRule,
  );

  if (incidentRuleId) {
    return <IncidentRulesTable viewRuleId={incidentRuleId} />;
  }

  if (episodeRuleId) {
    return <EpisodeRulesTable viewRuleId={episodeRuleId} />;
  }

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

export default IncidentOwnerRulesPage;
