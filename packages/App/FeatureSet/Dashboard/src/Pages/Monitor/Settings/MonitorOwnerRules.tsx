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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import MonitorOwnerRule from "Common/Models/DatabaseModels/MonitorOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const monitorOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "monitor", plural: "monitors" },
});

const MonitorOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<MonitorOwnerRule>
      modelType={MonitorOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, MonitorOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.MONITORS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: MonitorOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.MONITORS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="monitor-owner-rules-table"
      name="Settings > Monitor Owner Rules"
      userPreferencesKey="monitor-owner-rules-table"
      saveFilterProps={{
        tableId: "monitor-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Monitor Owner Rules",
        description:
          "Auto-assign owner users and teams when matching monitors are created.",
      }}
      helpContent={{
        title: "How Monitor Owner Rules Work",
        description: "Match monitors and add owner users/teams automatically.",
        markdown: monitorOwnerDocumentation,
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
          getElement: (item: MonitorOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<MonitorOwnerRule>()}
      formFields={[
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter monitors by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitor Labels",
          // Its section's description says what it matches.
          hideColumnDescription: true,
        },
        {
          field: { monitorNamePattern: true },
          title: "Monitor Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the monitor name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
          hideColumnDescription: true,
        },
        {
          field: { monitorDescriptionPattern: true },
          title: "Monitor Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
          hideColumnDescription: true,
        },
        ...getOwnerRuleActionFields<MonitorOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default MonitorOwnerRulesPage;
