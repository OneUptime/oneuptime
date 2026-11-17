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
import VMwareVCenterOwnerRule from "Common/Models/DatabaseModels/VMwareVCenterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const vmwareVCenterOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "vCenter", plural: "vCenters" },
});

const VMwareVCenterOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<VMwareVCenterOwnerRule>
      modelType={VMwareVCenterOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, VMwareVCenterOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.VMWARE_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: VMwareVCenterOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.VMWARE_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="vmwareVCenter-owner-rules-table"
      name="Settings > vCenter Owner Rules"
      userPreferencesKey="vmwareVCenter-owner-rules-table"
      saveFilterProps={{
        tableId: "vmware-vcenter-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "vCenter Owner Rules",
        description:
          "Auto-assign owner users and teams when matching vCenters are created.",
      }}
      helpContent={{
        title: "How vCenter Owner Rules Work",
        description: "Match vCenters and add owner users/teams automatically.",
        markdown: vmwareVCenterOwnerDocumentation,
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
          getElement: (item: VMwareVCenterOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<VMwareVCenterOwnerRule>()}
      formFields={[
        {
          field: { vmwareVCenterLabels: true },
          title: "vCenter Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter vCenters by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select vCenter Labels",
        },
        {
          field: { vmwareVCenterNamePattern: true },
          title: "vCenter Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the vCenter name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { vmwareVCenterDescriptionPattern: true },
          title: "vCenter Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<VMwareVCenterOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default VMwareVCenterOwnerRulesPage;
