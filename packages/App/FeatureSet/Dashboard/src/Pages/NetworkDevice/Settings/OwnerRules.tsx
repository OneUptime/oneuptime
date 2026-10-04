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
import NetworkDeviceOwnerRule from "Common/Models/DatabaseModels/NetworkDeviceOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const networkDeviceOwnerDocumentation: string = `
### How Network Device Owner Rules Work

Network Device Owner Rules add owner users and teams to a network device automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a network device only when **all** specified criteria pass. Empty criteria are skipped.

- **Network Device Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex, or a \`*\` wildcard pattern like \`*0664*\` (the same syntax Network Site assignment rules use).

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const NetworkDeviceOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<NetworkDeviceOwnerRule>
      modelType={NetworkDeviceOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, NetworkDeviceOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: NetworkDeviceOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="networkDevice-owner-rules-table"
      name="Settings > Network Device Owner Rules"
      userPreferencesKey="networkDevice-owner-rules-table"
      saveFilterProps={{
        tableId: "network-device-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Network Device Owner Rules",
        description:
          "Auto-assign owner users and teams when matching network devices are created.",
      }}
      helpContent={{
        title: "How Network Device Owner Rules Work",
        description:
          "Match network devices and add owner users/teams automatically.",
        markdown: networkDeviceOwnerDocumentation,
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
          getElement: (item: NetworkDeviceOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<NetworkDeviceOwnerRule>()}
      formFields={[
        {
          field: { networkDeviceLabels: true },
          title: "Network Device Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter network devices by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Network Device Labels (optional)",
        },
        {
          field: { networkDeviceNamePattern: true },
          title: "Network Device Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex — or a '*' wildcard pattern such as *0664* — matched against the network device name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "core-switch-.* or *0664*",
        },
        {
          field: { networkDeviceDescriptionPattern: true },
          title: "Network Device Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<NetworkDeviceOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default NetworkDeviceOwnerRulesPage;
