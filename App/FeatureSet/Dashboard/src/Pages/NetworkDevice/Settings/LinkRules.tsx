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
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const networkDeviceLinkRuleDocumentation: string = `
### How Network Device Link Rules Work

A link rule draws uplinks on the topology map from the labels your devices already carry — so thirty ping-monitored access points can be attached to their floor switch without drawing thirty links by hand.

### The shape is a star, not a mesh

A rule is **directed**. Every device carrying **all** the child labels gets **one** link to the **single** device carrying **all** the parent labels.

This is deliberately not "link devices that share a label". Forty devices sharing one site label would produce 780 links and a map nobody can read.

### The parent has to be exactly one device

- **No device** carries the parent labels → the rule draws nothing; there is no uplink to point at.
- **More than one device** carries them → the rule draws nothing, because picking one of them would be a guess about your cabling.

Either way the topology map tells you, rather than leaving you with an empty result and no explanation. Narrow the parent labels until they name one device.

### Rules are live, not stored

Links are worked out each time the map loads. Relabel a device and the map follows on the next refresh; delete a rule and its links simply stop being drawn. Nothing is left behind to clean up.

### Precedence

A link you drew by hand under **Device Links** wins over a rule covering the same pair — it keeps its own name and port labels. A rule link that discovery later confirms merges into the discovered link rather than doubling it.
`;

const NetworkDeviceLinkRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<NetworkDeviceLinkRule>
      modelType={NetworkDeviceLinkRule}
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
          "Draw uplinks on the topology map from labels: every device with the child labels is linked to the one device with the parent labels.",
      }}
      helpContent={{
        title: "How Network Device Link Rules Work",
        description:
          "Attach many devices to one uplink using the labels they already carry.",
        markdown: networkDeviceLinkRuleDocumentation,
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
          getElement: (item: NetworkDeviceLinkRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
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
        {
          field: { childDeviceLabels: true },
          title: "Child Device Labels",
          stepId: "devices",
          sectionTitle: "The devices that get an uplink",
          sectionDescription:
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
          sectionDescription:
            "These labels must identify exactly one device. If none or several carry them, the rule draws nothing and says so on the topology map.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default NetworkDeviceLinkRulesPage;
