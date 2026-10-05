import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getInheritingLabelRuleActionFields,
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import IncidentEpisodeLabelRule from "Common/Models/DatabaseModels/IncidentEpisodeLabelRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const incidentLabelDocumentation: string = `
### How Incident Label Rules Work

Incident Label Rules attach labels to an incident automatically when it matches your criteria — including labels copied from the incident's monitors, hosts, Kubernetes clusters, Docker hosts, and Podman hosts.

### Match Criteria

A rule matches an incident only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Severities**, **Incident Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches:

- Every label listed under \`Labels to Add\` is attached to the incident.
- If \`Inherit Labels From Monitors\` is on, every label of the incident's monitors is also attached.
- If \`Inherit Labels From Hosts\` is on, every label of the incident's affected hosts is also attached.
- If \`Inherit Labels From Kubernetes Clusters\` is on, every label of the incident's affected Kubernetes clusters is also attached.
- If \`Inherit Labels From Docker Hosts\` is on, every label of the incident's affected Docker hosts is also attached.
- If \`Inherit Labels From Podman Hosts\` is on, every label of the incident's affected Podman hosts is also attached.

Labels already on the incident are not duplicated. Multiple matching rules contribute the union of their labels.
`;

const incidentEpisodeLabelDocumentation: string = `
### How Incident Episode Label Rules Work

Incident Episode Label Rules attach labels to an episode automatically when it matches your criteria.

### Match Criteria

A rule matches an episode only when **all** specified criteria pass. Empty criteria are skipped.

- **Severities**, **Episode Labels** — any-of (M2M)
- **Title / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed under \`Labels to Add\` is attached to the episode. Labels already on the episode are not duplicated.
`;

interface RulesTableProps {
  // Set when the page is routed as this rule's view page.
  viewRuleId?: ObjectID | undefined;
}

const IncidentRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <LabelRuleTable<IncidentLabelRule>
      modelType={IncidentLabelRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.INCIDENTS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: IncidentLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.INCIDENTS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="incident-label-rules-table"
      name="Settings > Incident Label Rules"
      userPreferencesKey="incident-label-rules-table"
      saveFilterProps={{
        tableId: "incident-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident Label Rules",
        description:
          "Auto-attach labels to incidents — including labels inherited from the incident's monitors, hosts, Kubernetes clusters, Docker hosts, and Podman hosts — when matching incidents are created.",
      }}
      helpContent={{
        title: "How Incident Label Rules Work",
        description:
          "Match incidents and attach labels (explicit and inherited) automatically.",
        markdown: incidentLabelDocumentation,
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
      formSteps={getLabelRuleFormSteps<IncidentLabelRule>()}
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
            sort: {
              order: SortOrder.Ascending,
            },
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
        ...getInheritingLabelRuleActionFields<IncidentLabelRule>("incident"),
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <LabelRuleTable<IncidentEpisodeLabelRule>
      modelType={IncidentEpisodeLabelRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.INCIDENTS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: IncidentEpisodeLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.INCIDENTS_SETTINGS_EPISODE_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="incident-episode-label-rules-table"
      name="Settings > Incident Episode Label Rules"
      userPreferencesKey="incident-episode-label-rules-table"
      saveFilterProps={{
        tableId: "incident-episode-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Incident Episode Label Rules",
        description:
          "Auto-attach labels to incident episodes when matching episodes are created.",
      }}
      helpContent={{
        title: "How Incident Episode Label Rules Work",
        description: "Match episodes and attach labels automatically.",
        markdown: incidentEpisodeLabelDocumentation,
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
          getElement: (item: IncidentEpisodeLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<IncidentEpisodeLabelRule>()}
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
        ...getLabelRuleActionFields<IncidentEpisodeLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

const IncidentLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  /*
   * Routed as a rule's view page, the page shows only that rule, through
   * the table that lists it, instead of the tabs.
   */
  const incidentRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    IncidentLabelRule,
  );
  const episodeRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    IncidentEpisodeLabelRule,
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

export default IncidentLabelRulesPage;
