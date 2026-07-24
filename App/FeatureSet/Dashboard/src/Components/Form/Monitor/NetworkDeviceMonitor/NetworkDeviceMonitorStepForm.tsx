import React, { FunctionComponent, ReactElement } from "react";
import MonitorStepNetworkDeviceMonitor from "Common/Types/Monitor/MonitorStepNetworkDeviceMonitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import SnmpOidEditor from "../SnmpMonitor/SnmpOidEditor";

const vendorTemplateOptions: Array<DropdownOption> =
  SnmpVendorTemplateUtil.getAll().map((template: SnmpVendorTemplate) => {
    return {
      label: template.label,
      value: template.id,
    };
  });

export interface ComponentProps {
  monitorStepNetworkDeviceMonitor: MonitorStepNetworkDeviceMonitor;
  onChange: (value: MonitorStepNetworkDeviceMonitor) => void;
}

/*
 * Step form for Network Device monitors. Connection details (hostname,
 * SNMP credentials, polling probe) live on the NetworkDevice resource —
 * the monitor only picks the device and what to watch on it.
 */
const NetworkDeviceMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Network Device"
          description="The registered device to monitor. Manage devices (hostname, SNMP credentials, polling probe) on the Network Devices page."
          required={true}
        />
        <EntityDropdown
          modelType={NetworkDevice}
          labelField="name"
          valueField="_id"
          placeholder="Select a network device"
          value={props.monitorStepNetworkDeviceMonitor.networkDeviceId}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepNetworkDeviceMonitor,
              networkDeviceId: value ? value.toString() : undefined,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Monitor Network Interfaces"
          description="Walk the device's interface tables (IF-MIB) on every check to track per-interface status, bandwidth, utilization, and errors. Individual interfaces can be muted on the device's page."
          required={false}
        />
        <Toggle
          value={props.monitorStepNetworkDeviceMonitor.monitorInterfaces}
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepNetworkDeviceMonitor,
              monitorInterfaces: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Collect connected endpoints (ARP + FDB)"
          description="Off by default. When on, every check also walks the device's ARP and bridge-forwarding tables and records the MAC and IP address of each attached device — POS terminals, printers, phones, laptops."
          required={false}
        />
        {/*
         * Endpoint collection is strictly opt-in: the probe walks the
         * tables only for an explicit `true`, so anything else — a step
         * saved before this field existed, or one saved with it off —
         * means no collection. Rendering that as `=== true` is what keeps
         * the switch from claiming to be off while a MAC address is
         * written for every device in the store.
         */}
        <Toggle
          value={
            props.monitorStepNetworkDeviceMonitor.collectEndpoints === true
          }
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepNetworkDeviceMonitor,
              collectEndpoints: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Vendor Health Template"
          description="Apply a prebuilt set of CPU, memory, and temperature OIDs for your device's vendor. The OIDs are added below, where you can prune or extend them."
          required={false}
        />
        <Dropdown
          options={vendorTemplateOptions}
          value={undefined}
          placeholder="Apply a vendor template…"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (!value) {
              return;
            }
            props.onChange({
              ...props.monitorStepNetworkDeviceMonitor,
              oids: SnmpVendorTemplateUtil.mergeOids(
                props.monitorStepNetworkDeviceMonitor.oids || [],
                value.toString(),
              ),
            });
          }}
        />
      </div>

      <SnmpOidEditor
        value={props.monitorStepNetworkDeviceMonitor.oids}
        onChange={(oids: Array<SnmpOid>) => {
          props.onChange({
            ...props.monitorStepNetworkDeviceMonitor,
            oids: oids,
          });
        }}
      />
    </div>
  );
};

export default NetworkDeviceMonitorStepForm;
