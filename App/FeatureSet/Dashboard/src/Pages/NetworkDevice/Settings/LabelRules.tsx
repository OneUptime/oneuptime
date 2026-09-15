import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
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

const networkDeviceLabelDocumentation: string = `
### How Network Device Label Rules Work

Network Device Label Rules attach labels to a network device automatically when it matches your criteria — so you don't have to remember to tag new network devices.

### Match Criteria

A rule matches a network device only when **all** specified criteria pass. Empty criteria are skipped.

- **Network Device Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex, or a \`*\` wildcard pattern like \`*0664*\` (the same syntax Network Site assignment rules use). Whichever you write, the pattern has to match for the rule to fire.

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the network device. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.

### Applying a Rule to Devices You Already Have

Rules fire when a network device is created, so a rule written after your devices were discovered does not reach them. **Run Now** on a rule evaluates it against every network device in the project and attaches its labels to the ones it matches. Labels are only ever added, so running it more than once is safe. A disabled rule will not run.
`;

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
          "Auto-attach labels when matching network devices are created. Use Run Now on a rule to apply it to devices that already exist.",
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
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Labels", id: "labels", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Tag matching network devices",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
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
          placeholder: "Select Network Device Labels (optional)",
        },
        {
          field: { networkDeviceNamePattern: true },
          title: "Network Device Name Pattern",
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
          title: "Network Device Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the network device. Already-attached labels are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default NetworkDeviceLabelRulesPage;
