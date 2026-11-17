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
import DashboardOwnerRule from "Common/Models/DatabaseModels/DashboardOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const dashboardOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "dashboard", plural: "dashboards" },
});

const DashboardOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<DashboardOwnerRule>
      modelType={DashboardOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DashboardOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DASHBOARDS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DashboardOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DASHBOARDS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="dashboard-owner-rules-table"
      name="Settings > Dashboard Owner Rules"
      userPreferencesKey="dashboard-owner-rules-table"
      saveFilterProps={{
        tableId: "dashboard-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Dashboard Owner Rules",
        description:
          "Auto-assign owner users and teams when matching dashboards are created.",
      }}
      helpContent={{
        title: "How Dashboard Owner Rules Work",
        description:
          "Match dashboards and add owner users/teams automatically.",
        markdown: dashboardOwnerDocumentation,
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
          getElement: (item: DashboardOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DashboardOwnerRule>()}
      formFields={[
        {
          field: { dashboardLabels: true },
          title: "Dashboard Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter dashboards by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<DashboardOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DashboardOwnerRulesPage;
