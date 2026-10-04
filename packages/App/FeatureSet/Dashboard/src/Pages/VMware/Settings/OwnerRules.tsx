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
import VMwareVCenterOwnerRule from "Common/Models/DatabaseModels/VMwareVCenterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const vmwareVCenterOwnerDocumentation: string = `
### How vCenter Owner Rules Work

vCenter Owner Rules add owner users and teams to a vCenter automatically when it matches your criteria — without anyone having to remember to assign owners when a new vCenter registers itself.

### Match Criteria

A rule matches a vCenter only when **all** specified criteria pass. Empty criteria are skipped.

- **vCenter Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

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
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
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
          placeholder: "Select vCenter Labels (optional)",
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
