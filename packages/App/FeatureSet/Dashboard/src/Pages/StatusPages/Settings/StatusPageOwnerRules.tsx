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
import StatusPageOwnerRule from "Common/Models/DatabaseModels/StatusPageOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const statusPageOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "status page", plural: "status pages" },
});

const StatusPageOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<StatusPageOwnerRule>
      modelType={StatusPageOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, StatusPageOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: StatusPageOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.STATUS_PAGES_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="status-page-owner-rules-table"
      name="Settings > Status Page Owner Rules"
      userPreferencesKey="status-page-owner-rules-table"
      saveFilterProps={{
        tableId: "status-page-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Status Page Owner Rules",
        description:
          "Auto-assign owner users and teams when matching status pages are created.",
      }}
      helpContent={{
        title: "How Status Page Owner Rules Work",
        description:
          "Match status pages and add owner users/teams automatically.",
        markdown: statusPageOwnerDocumentation,
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
          /*
           * An element, not a Boolean: a phone's card leaves out a Boolean
           * that is off, so a disabled rule showed no status at all.
           */
          type: FieldType.Element,
          getElement: (item: StatusPageOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<StatusPageOwnerRule>()}
      formFields={[
        {
          field: { statusPageLabels: true },
          title: "Status Page Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter status pages by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Status Page Labels",
        },
        {
          field: { statusPageNamePattern: true },
          title: "Status Page Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the status page name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "public-.*",
        },
        {
          field: { statusPageDescriptionPattern: true },
          title: "Status Page Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer|external",
        },
        ...getOwnerRuleActionFields<StatusPageOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default StatusPageOwnerRulesPage;
