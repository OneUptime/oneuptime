import { getLabelRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import MonitorLabelRule from "Common/Models/DatabaseModels/MonitorLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const monitorLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "monitor", plural: "monitors" },
});

const MonitorLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<MonitorLabelRule>
      modelType={MonitorLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, MonitorLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.MONITORS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: MonitorLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.MONITORS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="monitor-label-rules-table"
      name="Settings > Monitor Label Rules"
      userPreferencesKey="monitor-label-rules-table"
      saveFilterProps={{
        tableId: "monitor-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Monitor Label Rules",
        description: "Auto-attach labels when matching monitors are created.",
      }}
      helpContent={{
        title: "How Monitor Label Rules Work",
        description: "Match monitors and attach labels automatically.",
        markdown: monitorLabelDocumentation,
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
          getElement: (item: MonitorLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<MonitorLabelRule>()}
      formFields={[
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for monitors that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<MonitorLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default MonitorLabelRulesPage;
