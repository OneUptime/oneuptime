import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import DashboardLabelRule from "Common/Models/DatabaseModels/DashboardLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const dashboardLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "dashboard", plural: "dashboards" },
});

const DashboardLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<DashboardLabelRule>
      modelType={DashboardLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DashboardLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DASHBOARDS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: DashboardLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DASHBOARDS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="dashboard-label-rules-table"
      name="Settings > Dashboard Label Rules"
      userPreferencesKey="dashboard-label-rules-table"
      saveFilterProps={{
        tableId: "dashboard-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Dashboard Label Rules",
        description: "Auto-attach labels when matching dashboards are created.",
      }}
      helpContent={{
        title: "How Dashboard Label Rules Work",
        description: "Match dashboards and attach labels automatically.",
        markdown: dashboardLabelDocumentation,
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
          getElement: (item: DashboardLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<DashboardLabelRule>()}
      formFields={[
        {
          field: { dashboardLabels: true },
          title: "Dashboard Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for dashboards that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Dashboard Labels",
        },
        {
          field: { dashboardNamePattern: true },
          title: "Dashboard Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the dashboard name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { dashboardDescriptionPattern: true },
          title: "Dashboard Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<DashboardLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DashboardLabelRulesPage;
