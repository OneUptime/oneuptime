import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import AlertPrivacyRule from "Common/Models/DatabaseModels/AlertPrivacyRule";
import AlertEpisodePrivacyRule from "Common/Models/DatabaseModels/AlertEpisodePrivacyRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const alertPrivacyDocumentation: string = `
### How Alert Privacy Rules Work

Alert Privacy Rules automatically mark matching alerts as **private** when they are created — visible only to their owners (users + members of owner teams), project admins, and project owners.

### Match Criteria

A rule matches an alert only when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors**, **Severities**, **Alert Labels**, **Monitor Labels** — any-of (M2M)
- **Title / Description Pattern**, **Monitor Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, the alert's \`isPrivate\` flag is set to \`true\`. Multiple matching rules behave additively — once any rule matches, the alert is private. The rule fires before workspace channel creation, so private alerts also get private Slack/Teams channels.
`;

const alertEpisodePrivacyDocumentation: string = `
### How Alert Episode Privacy Rules Work

Match an alert episode on creation and mark it as **private** automatically. Empty criteria are skipped.

- **Severities** — any-of
- **Episode Labels** — any-of
- **Title / Description Pattern** — case-insensitive regex
`;

interface RulesTableProps {
  // Set when the page is routed as this rule's view page.
  viewRuleId?: ObjectID | undefined;
}

const AlertRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <RuleTable<AlertPrivacyRule>
      modelType={AlertPrivacyRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.ALERTS_SETTINGS_PRIVACY_RULES,
      )}
      getRuleViewRoute={(rule: AlertPrivacyRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.ALERTS_SETTINGS_PRIVACY_RULE_VIEW,
          rule,
        );
      }}
      id="alert-privacy-rules-table"
      name="Settings > Alert Privacy Rules"
      userPreferencesKey="alert-privacy-rules-table"
      saveFilterProps={{
        tableId: "alert-privacy-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Privacy Rules",
        description: "Auto-mark alerts as private when they match these rules.",
      }}
      helpContent={{
        title: "How Alert Privacy Rules Work",
        description: "Match alerts and automatically set them to private.",
        markdown: alertPrivacyDocumentation,
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
          getElement: (item: AlertPrivacyRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Mark database alerts as private",
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
      ]}
      showRefreshButton={true}
    />
  );
};

const EpisodeRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <RuleTable<AlertEpisodePrivacyRule>
      modelType={AlertEpisodePrivacyRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.ALERTS_SETTINGS_PRIVACY_RULES,
      )}
      getRuleViewRoute={(rule: AlertEpisodePrivacyRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.ALERTS_SETTINGS_EPISODE_PRIVACY_RULE_VIEW,
          rule,
        );
      }}
      id="alert-episode-privacy-rules-table"
      name="Settings > Alert Episode Privacy Rules"
      userPreferencesKey="alert-episode-privacy-rules-table"
      saveFilterProps={{
        tableId: "alert-episode-privacy-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Alert Episode Privacy Rules",
        description:
          "Auto-mark alert episodes as private when they match these rules.",
      }}
      helpContent={{
        title: "How Alert Episode Privacy Rules Work",
        description: "Match episodes and automatically set them to private.",
        markdown: alertEpisodePrivacyDocumentation,
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
          getElement: (item: AlertEpisodePrivacyRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
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
      ]}
      showRefreshButton={true}
    />
  );
};

const AlertPrivacyRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  /*
   * Routed as a rule's view page, the page shows only that rule, through
   * the table that lists it, instead of the tabs.
   */
  const alertRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    AlertPrivacyRule,
  );
  const episodeRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    AlertEpisodePrivacyRule,
  );

  if (alertRuleId) {
    return <AlertRulesTable viewRuleId={alertRuleId} />;
  }

  if (episodeRuleId) {
    return <EpisodeRulesTable viewRuleId={episodeRuleId} />;
  }

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

export default AlertPrivacyRulesPage;
