import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDeviceLinkRule from "Common/Models/DatabaseModels/NetworkDeviceLinkRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Blue, Grey } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";
import NetworkDeviceLinkRuleScope, {
  NetworkDeviceLinkRuleScopeUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceLinkRuleScope";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

const networkDeviceLinkRuleDocumentation: string = `
A link rule draws uplinks on the topology map from the labels your devices already carry, so thirty ping-monitored access points are attached to their floor switch without drawing thirty links by hand.

## How a Rule Draws Links

A rule is one-way, a star rather than a mesh: every device carrying **all** the child labels gets one link to the **one** device carrying **all** the parent labels. It never links every device that shares a label: forty devices of one site would make 780 links nobody can read.

The parent must be exactly one device. With none, there is nothing to point at; with several, picking one would be a guess about your cabling. Either way the rule draws nothing, and the topology map says why: narrow the parent labels until they name one device.

## One Rule for Every Site

**Parent Scope** says where to look for the one parent:

- **Project**, to begin with: one parent across the whole project.
- **Site**: one parent in each site. If every building has a router labelled the same way, one rule draws the uplinks in all of them.

A site-scoped rule looks only in each device's own site, and skips a device in no site, saying how many. A parent on a parent site is not found for children on the sites below it: put the parent in the same site, or use Project scope.

## What the Map Tells You

A site-scoped rule that works in thirteen sites and fails in a fourteenth draws the thirteen and names the one that failed. A site where nothing carries the child labels is not a failure: the rule does not apply there.

Across hundreds of sites the map names the first few and counts the rest. Expand **Show the N sites that need attention** for every one, with whether it has no parent or several, and how many devices there have no uplink.

## Rules Are Live

Links are worked out each time the map loads. Relabel a device and the map follows on the next refresh; delete a rule and its links stop being drawn. Nothing is left behind.

## Which Link Wins

- A link you drew by hand under **Device Links** wins over a rule for the same pair, with its own name and port labels.
- A rule's link that discovery confirms merges into the discovered link rather than doubling it.
- A link learned from a switch's forwarding table merges the same way: its measured port replaces a typed one, and a parent you declared, by hand or by a rule, beats the one the table implies.
`;

const LINK_RULE_SCOPE_OPTIONS: Array<DropdownOption> = [
  {
    value: NetworkDeviceLinkRuleScope.Project,
    label: "Project — one parent device for the whole project",
  },
  {
    value: NetworkDeviceLinkRuleScope.Site,
    label: "Site — one parent device in each site",
  },
];

const NetworkDeviceLinkRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<NetworkDeviceLinkRule>
      modelType={NetworkDeviceLinkRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      id="network-device-link-rules-table"
      name="Settings > Network Device Link Rules"
      userPreferencesKey="network-device-link-rules-table"
      saveFilterProps={{
        tableId: "network-device-link-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Network Device Link Rules",
        description:
          "Draw uplinks on the map from labels: devices with the child labels link to the one with the parent labels.",
      }}
      helpContent={{
        title: "How Network Device Link Rules Work",
        description:
          "Attach many devices to one uplink using the labels they already carry.",
        markdown: networkDeviceLinkRuleDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true, scope: true }}
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
          getElement: (item: NetworkDeviceLinkRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
        {
          field: { scope: true },
          title: "Parent Scope",
          type: FieldType.Text,
          getElement: (item: NetworkDeviceLinkRule): ReactElement => {
            return NetworkDeviceLinkRuleScopeUtil.isSiteScoped(item.scope) ? (
              <Pill color={Blue} text="Per site" />
            ) : (
              <Pill color={Grey} text="Project" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Devices to Link", id: "devices", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Floor 1 access points uplink to the floor switch",
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
          description:
            "Disable to take this rule's links off the map without deleting it.",
        },
        /*
         * Each label field says its rule itself, and the section only names
         * the side: a field with no description of its own shows the
         * column's, written for the API reference and two lines longer, under
         * the section's sentence that already said the same.
         */
        {
          field: { childDeviceLabels: true },
          title: "Child Device Labels",
          stepId: "devices",
          sectionTitle: "The devices that get an uplink",
          description:
            "Every device carrying ALL of these labels gets one link drawn to the parent device below.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Labels",
        },
        {
          field: { parentDeviceLabels: true },
          title: "Parent Device Labels",
          stepId: "devices",
          sectionTitle: "The device they uplink to",
          description:
            "These labels must pick out exactly one device, or the rule draws nothing.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Labels",
        },
        {
          field: { scope: true },
          title: "Parent Scope",
          stepId: "devices",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: LINK_RULE_SCOPE_OPTIONS,
          required: false,
          defaultValue: NetworkDeviceLinkRuleScope.Project,
          placeholder: "Project",
          description:
            "Project: one parent across the project. Site: one parent in each site; devices without a site are skipped.",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default NetworkDeviceLinkRulesPage;
