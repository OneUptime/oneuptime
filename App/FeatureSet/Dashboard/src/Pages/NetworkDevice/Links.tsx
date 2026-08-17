import PageComponentProps from "../PageComponentProps";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLink from "Common/Models/DatabaseModels/NetworkDeviceLink";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Cables that discovery cannot see.
 *
 * LLDP and CDP only report what both ends agree to advertise, so a switch
 * with discovery disabled, a firewall that speaks neither, or a device
 * monitored by ping alone leaves a real cable invisible — and the device on
 * the far end of it floating unconnected on the map. A link drawn here is
 * merged with a discovered one between the same pair rather than doubling
 * the line, so declaring a link that discovery later finds costs nothing.
 */
const NetworkDeviceLinks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkDeviceLink>
        modelType={NetworkDeviceLink}
        id="network-device-links-table"
        userPreferencesKey="network-device-links-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        name="Network Device Links"
        cardProps={{
          title: "Device Links",
          description:
            "Links you declare between two devices, for cables LLDP and CDP cannot see. They are drawn on the topology map alongside discovered links; bind a monitor to one and the edge takes that monitor's status color.",
        }}
        noItemsMessage="No device links yet. Add one to connect two devices the discovery protocols cannot see between."
        filters={[
          {
            field: {
              fromDevice: {
                name: true,
              },
            },
            title: "From Device",
            type: FieldType.Entity,
            filterEntityType: NetworkDevice,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              toDevice: {
                name: true,
              },
            },
            title: "To Device",
            type: FieldType.Entity,
            filterEntityType: NetworkDevice,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "IDF-2 uplink to core",
          },
          {
            field: {
              fromDevice: true,
            },
            title: "From Device",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Device",
          },
          {
            field: {
              toDevice: true,
            },
            title: "To Device",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Device",
          },
          {
            field: {
              fromPortName: true,
            },
            title: "From Port",
            description:
              "Optional. Free text — nothing resolves it to an interface, since a link is usually drawn by hand precisely because the port is not discoverable.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Gi1/0/24",
          },
          {
            field: {
              toPortName: true,
            },
            title: "To Port",
            description: "Optional. Free text, same as above.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "eth0",
          },
          {
            field: {
              parentDevice: true,
            },
            title: "Parent Device",
            description:
              "Optional, and it must be one of the two devices above. Set it to say which end is upstream — the router in a router-to-switch link, the switch in a switch-to-access-point one — and the Parent-Child view on the topology map draws the other end beneath it. Left empty, the map works the hierarchy out from device roles and connection counts, which is a good guess on SNMP gear and no guess at all on a device that only answers ping.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDevice,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Peers — infer the hierarchy",
          },
          {
            field: {
              monitor: true,
            },
            title: "Monitor",
            description:
              "Optional. The monitor watching this link — its status colors the edge on the topology map. A discovered link's own interface counters always win over it, so this only ever supplies state nothing else measured.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor (optional)",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              fromDevice: {
                name: true,
              },
            },
            title: "From Device",
            type: FieldType.Entity,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.fromDevice?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              toDevice: {
                name: true,
              },
            },
            title: "To Device",
            type: FieldType.Entity,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.toDevice?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              parentDevice: {
                name: true,
              },
            },
            title: "Parent",
            type: FieldType.Entity,
            hideOnMobile: true,
            /*
             * "Inferred" rather than a dash: an empty parent is not missing
             * data, it is the map being left to work the direction out, and
             * the difference is the whole point of the column.
             */
            getElement: (item: NetworkDeviceLink): ReactElement => {
              if (!item.parentDevice?.name) {
                return <span className="text-sm text-gray-400">Inferred</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.parentDevice.name}
                </span>
              );
            },
          },
          {
            field: {
              monitor: {
                name: true,
              },
            },
            title: "Bound Monitor",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceLink): ReactElement => {
              if (!item.monitor?.name) {
                return <span className="text-sm text-gray-400">None</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.monitor.name}
                </span>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkDeviceLinks;
