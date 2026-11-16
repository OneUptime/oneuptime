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
import NetworkDeviceLabelRule from "Common/Models/DatabaseModels/NetworkDeviceLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const networkDeviceLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "network device", plural: "network devices" },
});

const NetworkDeviceLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  /*
   * "Run Now" - on each row, in the bulk actions and on the rule's own page -
   * comes from LabelRuleTable, the same as on every other label rule table.
   */
  return (
    <LabelRuleTable<NetworkDeviceLabelRule>
      modelType={NetworkDeviceLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, NetworkDeviceLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: NetworkDeviceLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="networkDevice-label-rules-table"
      name="Settings > Network Device Label Rules"
      userPreferencesKey="networkDevice-label-rules-table"
      saveFilterProps={{
        tableId: "network-device-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Network Device Label Rules",
        description:
          "Add labels to network devices as they are created. Run Now applies a rule to existing devices.",
      }}
      helpContent={{
        title: "How Network Device Label Rules Work",
        description: "Match network devices and attach labels automatically.",
        markdown: networkDeviceLabelDocumentation,
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
          getElement: (item: NetworkDeviceLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<NetworkDeviceLabelRule>()}
      formFields={[
        {
          field: { networkDeviceLabels: true },
          title: "Network Device Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for network devices that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<NetworkDeviceLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default NetworkDeviceLabelRulesPage;
