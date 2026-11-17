import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import { getOwnerRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import RunbookOwnerRule from "Common/Models/DatabaseModels/RunbookOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const runbookOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "runbook", plural: "runbooks" },
});

const RunbookOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<RunbookOwnerRule>
      modelType={RunbookOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, RunbookOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.RUNBOOKS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: RunbookOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.RUNBOOKS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="runbook-owner-rules-table"
      name="Settings > Runbook Owner Rules"
      userPreferencesKey="runbook-owner-rules-table"
      saveFilterProps={{
        tableId: "runbook-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Runbook Owner Rules",
        description:
          "Auto-assign owner users and teams when matching runbooks are created.",
      }}
      helpContent={{
        title: "How Runbook Owner Rules Work",
        description: "Match runbooks and add owner users/teams automatically.",
        markdown: runbookOwnerDocumentation,
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
          getElement: (item: RunbookOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<RunbookOwnerRule>()}
      formFields={[
        {
          field: { runbookLabels: true },
          title: "Runbook Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter runbooks by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Runbook Labels",
        },
        {
          field: { runbookNamePattern: true },
          title: "Runbook Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the runbook name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { runbookDescriptionPattern: true },
          title: "Runbook Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<RunbookOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default RunbookOwnerRulesPage;
