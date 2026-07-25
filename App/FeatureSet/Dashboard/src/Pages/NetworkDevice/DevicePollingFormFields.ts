import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * Shared polling / data-collection form fields for the NetworkDevice.
 *
 * The device owns its own polling: its assigned probe walks it on this
 * schedule and reports inventory, interfaces, endpoints, and health-OID
 * metrics — no Monitor involved. Monitors reference the device purely to
 * alert on what these walks (and traps) report, which is why none of this
 * lives on the monitor form anymore.
 */
export function getDevicePollingFormFields(): Array<Field<NetworkDevice>> {
  return [
    {
      field: {
        isPollingEnabled: true,
      },
      title: "Polling Enabled",
      description:
        "The assigned probe polls this device via SNMP on the schedule below. Disable to pause polling without deleting the device.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: {
        pollingIntervalInMinutes: true,
      },
      title: "Polling Interval (Minutes)",
      description:
        "How often the probe polls this device. Minimum 1 minute; walks of large devices can take tens of seconds.",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      placeholder: "5",
    },
    {
      field: {
        walkInterfaces: true,
      },
      title: "Walk Interfaces",
      description:
        "Walk the interface tables (IF-MIB) on each poll to inventory every port with status, bandwidth, utilization, and errors — plus LLDP/CDP neighbors for the topology map. Individual interfaces can be muted from the device's Interfaces tab.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: {
        collectEndpoints: true,
      },
      title: "Collect Connected Endpoints (ARP + FDB)",
      description:
        "Off by default. When on, each poll also walks the device's ARP and bridge-forwarding tables to discover endpoints attached to it — POS terminals, printers, phones, laptops.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
  ];
}
