import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import { TOPOLOGY_SHAPE_OPTIONS } from "../../../Components/NetworkDevice/TopologyShapeOptions";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const networkDeviceRoleDocumentation: string = `
### How Device Roles Work

A device role is what a device DOES on your network — Router, Switch, Firewall, Wireless AP and so on. The defaults are a starting point: rename them, reorder them, delete the ones you don't use, or add your own (\`PoS Terminal\`, \`SD-WAN Edge\`, \`Kiosk\`) to match the estate you actually run.

### Where a device's role comes from

Two places, and the first one wins:

1. **The role you assign it** on the device itself (Network > Devices > a device > Settings). This is the only statement about a role that is not a guess.
2. **SNMP classification.** Left unassigned, OneUptime works the role out from the device's own identity — its \`sysDescr\`, \`sysObjectId\`, model and hostname. That is more reliable than a guess, which is why it is the default for anything with SNMP to read.

A device nothing walks — a ping-only device, or one whose health comes from a monitor — has no identity to classify, so assigning it a role here is the only way it is drawn as anything but an anonymous node.

### Key

Each role has a **Key**, derived from its name when the role is created and never changed afterwards. The key is the role's identity: SNMP classification matches against it, so renaming \`Wireless AP\` to \`Access Point\` keeps every access point already classified pointing at the renamed role. The eleven seeded roles keep the keys the classifier emits, which is why they cannot be re-derived from a new name.

### Shape

\`Topology Shape\` is the silhouette devices of this role are drawn with on the network map, following the conventions network engineers already draw with by hand — a circle for a router, a rounded square for a switch, a diamond for a firewall, a triangle for an access point.

### Core Layer

\`Is Core Layer\` is load-bearing, not a label. It marks the roles that sit at the **top of the network** — the boxes everything else reaches the rest of the world through. The tiered and radial topology layouts band core devices above everything else, and the parent-child layout prefers them when it picks the root of a tree.

Router, Firewall and Load balancer are core by default. Switch deliberately is not: a switch is infrastructure, but it is infrastructure that hangs off a router.

### SNMP Walkable

\`Is SNMP Walkable\` says whether a device of this role is worth polling with SNMP. A handset, a camera and a desk printer answer a ping and nothing else. Adopting one from the topology map therefore opens on a **monitor** rather than SNMP polling, so you don't end up with a device that is permanently unreachable.

### Deleting a role

Deleting a role does **not** delete the devices using it. They go back to being classified from their own SNMP identity — exactly what an unassigned role has always meant. Delete a *seeded* role and SNMP classification can still produce it; such a device is drawn as a neutral node until you add the role back.
`;

/*
 * Per-project configuration of what a device can be on the network. This
 * replaces what used to be a fixed union with the label, the silhouette and
 * the core-layer flag hardcoded in three different modules, which is why
 * isCoreLayer and isSnmpWalkable get so much explanatory copy here: they are
 * the two fields on this page that change app behaviour rather than just
 * labelling.
 */
const NetworkDeviceRolesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkDeviceRole>
        modelType={NetworkDeviceRole}
        id="network-device-roles-table"
        name="Settings > Network Device Roles"
        userPreferencesKey="network-device-roles-table"
        saveFilterProps={{
          tableId: "network-device-roles-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Device Roles",
          description:
            "What a device can be on your network — Router, Switch, Firewall and so on. Rename them, change how each is drawn on the map, or add your own.",
        }}
        helpContent={{
          title: "How Device Roles Work",
          description:
            "Configure your roles, pick their shapes, and mark which ones sit at the core of the network.",
          markdown: networkDeviceRoleDocumentation,
        }}
        noItemsMessage="No device roles yet. Add one to start describing what your devices do."
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "description", "key"]}
        selectMoreFields={{ isCoreLayer: true, isSnmpWalkable: true }}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          { field: { key: true }, title: "Key", type: FieldType.Text },
          {
            field: { isCoreLayer: true },
            title: "Core Layer",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { key: true },
            title: "Key",
            type: FieldType.Text,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceRole): ReactElement => {
              return (
                <span className="text-sm font-mono text-gray-500">
                  {item.key || "-"}
                </span>
              );
            },
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: { topologyShape: true },
            title: "Shape",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: { order: true },
            title: "Order",
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: { isCoreLayer: true },
            title: "Layer",
            type: FieldType.Boolean,
            getElement: (item: NetworkDeviceRole): ReactElement => {
              return item.isCoreLayer ? (
                <Pill color={Green} text="Core" />
              ) : (
                <Pill color={Gray500} text="Access" />
              );
            },
          },
          {
            field: { isSnmpWalkable: true },
            title: "Monitoring",
            type: FieldType.Boolean,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceRole): ReactElement => {
              return item.isSnmpWalkable ? (
                <Pill color={Green} text="SNMP" />
              ) : (
                <Pill color={Gray500} text="Monitor" />
              );
            },
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Topology", id: "topology" },
          { title: "Monitoring", id: "monitoring" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Router",
            validation: { minLength: 2 },
            description:
              "What this kind of device is called on your network. Renaming a role later is safe — devices follow it.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Moves traffic between networks.",
          },
          {
            field: { order: true },
            title: "Order",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1",
            description:
              "Where this role appears in the role picker and the map legend. Lower numbers come first.",
          },
          {
            field: { topologyShape: true },
            title: "Topology Shape",
            stepId: "topology",
            sectionTitle: "How it is drawn",
            sectionDescription:
              "Reading a map should not mean reading it word by word, so a device's role picks its silhouette.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TOPOLOGY_SHAPE_OPTIONS,
            required: false,
            placeholder: "Select a shape",
            description:
              "The shape devices of this role are drawn with on the network topology map. Left empty they are drawn as a neutral circle.",
          },
          {
            field: { isCoreLayer: true },
            title: "Is Core Layer",
            stepId: "topology",
            sectionTitle: "Where it sits",
            sectionDescription:
              "The top of the network is the handful of devices everything else reaches the world through.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Devices of this role are banded at the top of the topology map and preferred as the root of a parent-child tree. Router, Firewall and Load balancer are core by default; Switch is not, because a switch hangs off a router.",
          },
          {
            field: { isSnmpWalkable: true },
            title: "Is SNMP Walkable",
            stepId: "monitoring",
            sectionTitle: "How it is checked",
            sectionDescription:
              "Some devices answer a ping and nothing else. Adopting one as an SNMP device produces a device that is permanently unreachable.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Devices of this role usually speak SNMP. Turn it off for roles that do not — adopting one from the topology map then opens on a monitor rather than SNMP polling.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkDeviceRolesPage;
