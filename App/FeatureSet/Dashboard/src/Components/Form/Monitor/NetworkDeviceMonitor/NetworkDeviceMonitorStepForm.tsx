import React, { FunctionComponent, ReactElement } from "react";
import MonitorStepNetworkDeviceMonitor from "Common/Types/Monitor/MonitorStepNetworkDeviceMonitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";

export interface ComponentProps {
  monitorStepNetworkDeviceMonitor: MonitorStepNetworkDeviceMonitor;
  onChange: (value: MonitorStepNetworkDeviceMonitor) => void;
}

/*
 * Step form for Network Device monitors. The monitor is purely the
 * alerting layer: it picks a device and (via criteria) what to alert on.
 * Everything about data collection — hostname, SNMP credentials, polling
 * probe and schedule, interface walks, endpoint discovery, and health
 * OIDs — is configured on the NetworkDevice resource, which is polled on
 * its own schedule whether or not any monitor exists.
 */
const NetworkDeviceMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Network Device"
          description="The registered device to alert on. The device is polled by its assigned probe on the device's own schedule — this monitor evaluates its criteria against every poll result and incoming trap."
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

      <Alert
        type={AlertType.INFO}
        strongTitle="Data collection is configured on the device"
        title="Polling schedule, interface walks, endpoint discovery, and health OIDs (CPU, memory, temperature) are set in the device's Settings. Use the criteria below to choose what to alert on — reachability, interface status, bandwidth, OID thresholds, or traps."
      />
    </div>
  );
};

export default NetworkDeviceMonitorStepForm;
