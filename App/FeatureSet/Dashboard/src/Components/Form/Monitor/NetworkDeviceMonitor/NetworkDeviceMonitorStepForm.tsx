import React, { FunctionComponent, ReactElement } from "react";
import MonitorStepNetworkDeviceMonitor from "Common/Types/Monitor/MonitorStepNetworkDeviceMonitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import SnmpOidEditor from "../SnmpMonitor/SnmpOidEditor";

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
