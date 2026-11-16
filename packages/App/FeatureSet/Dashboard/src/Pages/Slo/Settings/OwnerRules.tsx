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
import ServiceLevelObjectiveOwnerRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const sloOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "SLO", plural: "SLOs" },
});

const SloOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<ServiceLevelObjectiveOwnerRule>
      modelType={ServiceLevelObjectiveOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        ServiceLevelObjectiveOwnerRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.SLOS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: ServiceLevelObjectiveOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.SLOS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="slo-owner-rules-table"
      name="Settings > SLO Owner Rules"
      userPreferencesKey="slo-owner-rules-table"
      saveFilterProps={{
        tableId: "slo-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "SLO Owner Rules",
        description:
          "Auto-assign owner users and teams when matching SLOs are created.",
      }}
      helpContent={{
        title: "How SLO Owner Rules Work",
        description: "Match SLOs and add owner users/teams automatically.",
        markdown: sloOwnerDocumentation,
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
          getElement: (item: ServiceLevelObjectiveOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<ServiceLevelObjectiveOwnerRule>()}
      formFields={[
        {
          field: { serviceLevelObjectiveLabels: true },
          title: "SLO Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter SLOs by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select SLO Labels",
        },
        {
          field: { serviceLevelObjectiveNamePattern: true },
          title: "SLO Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex, or a * wildcard, matched against the SLO name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "checkout-.*",
        },
        {
          field: { serviceLevelObjectiveDescriptionPattern: true },
          title: "SLO Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer-facing|tier-1",
        },
        ...getOwnerRuleActionFields<ServiceLevelObjectiveOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default SloOwnerRulesPage;
