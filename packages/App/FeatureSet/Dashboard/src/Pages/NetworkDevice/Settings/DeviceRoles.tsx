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
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const networkDeviceRoleDocumentation: string = `
A device role says what a device does on your network: Router, Switch, Firewall, Wireless AP and so on. Rename the roles, drag them into the order you want, delete the ones you do not use, or add your own, such as \`PoS Terminal\`, \`SD-WAN Edge\` or \`Kiosk\`.

## Where a Device's Role Comes From

The first of these wins:

1. **The role you give it**, on the device's **Settings** (Network > Devices > a device). This is the only role that is not worked out.
2. **SNMP**: left without one, a device's role is worked out from its own identity, its \`sysDescr\`, \`sysObjectId\`, model and hostname.

A device nothing walks, such as a ping-only device or one whose health comes from a monitor, has no identity to work from: give it a role, or it is drawn as a plain node.

## Key

A role's **Key** is made from its name when it is created and never changes. SNMP matches devices to it, so renaming \`Wireless AP\` to \`Access Point\` keeps every access point already found pointing at it. The eleven roles OneUptime starts with keep the keys SNMP gives, which is why a new name does not change them.

## Shape, Core Layer and SNMP Walkable

- **Topology Shape** is how devices of the role are drawn on the network map, as engineers draw them by hand: a circle for a router, a rounded square for a switch, a diamond for a firewall, a triangle for an access point.
- **Is Core Layer** marks the roles at the top of the network, the ones everything else reaches the world through. The tiered and radial layouts put them above everything else, and the parent-child layout starts its trees from them. Router, Firewall and Load balancer are core to begin with. A switch is not: it hangs off a router.
- **Is SNMP Walkable** says whether a device of the role is worth polling over SNMP. A handset, a camera or a desk printer only answers a ping, so adding one from the map gives it a monitor instead of an SNMP poll that would never answer.

## Deleting a Role

Deleting a role does not delete its devices: they go back to having their role worked out from SNMP. Delete one of the roles OneUptime starts with, and SNMP can still give it: such a device is drawn as a plain node until you add the role back.
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
            "What a device can be, such as Router or Switch. Rename them, change how each is drawn, or add your own.",
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
        /*
         * The order of the role picker and the map legend: drag the rows.
         * A new role goes to the end.
         */
        enableDragAndDrop={true}
        dragDropIndexField="order"
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
                  {item.key || <TableEmptyValue />}
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
              "How devices of this role are drawn on the map. Empty draws a plain circle.",
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
              "Drawn at the top of the map, as the root of the tree. Routers, firewalls and load balancers are core.",
          },
          {
            field: { isSnmpWalkable: true },
            title: "Is SNMP Walkable",
            stepId: "monitoring",
            sectionTitle: "How it is checked",
            sectionDescription: "Some devices answer ping and nothing else.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Turn it off for roles that do not speak SNMP. Adding one from the map then uses a monitor.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkDeviceRolesPage;
