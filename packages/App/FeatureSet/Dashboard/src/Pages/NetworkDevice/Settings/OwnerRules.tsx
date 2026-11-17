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
import NetworkDeviceOwnerRule from "Common/Models/DatabaseModels/NetworkDeviceOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const networkDeviceOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "network device", plural: "network devices" },
});

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
            return <EnabledPill isEnabled={item.isEnabled} />;
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
          placeholder: "Select Network Device Labels",
        },
        {
          field: { networkDeviceNamePattern: true },
          title: "Network Device Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "A regex or * pattern, such as *0664*, matched against the device's name and description.",
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
