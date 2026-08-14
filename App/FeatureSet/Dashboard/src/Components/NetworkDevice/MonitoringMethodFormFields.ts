import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The monitoring-method picker, and the two predicates every form that shows
 * it needs. Shared by the create form on the Devices list and the edit form on
 * a device's Settings page so the two cannot drift into disagreeing about
 * which half of the form applies.
 */

export const MONITORING_METHOD_OPTIONS: Array<DropdownOption> = [
  {
    value: NetworkDeviceMonitoringMethod.Snmp,
    label: "SNMP — a probe polls this device",
  },
  {
    value: NetworkDeviceMonitoringMethod.Monitor,
    label: "Monitor — a Ping or IP monitor reports its health",
  },
];

/*
 * Read through the parser rather than compared directly: an unset value means
 * SNMP, which is what every device that predates the column is, and what an
 * untouched create form starts out as.
 */
export function isSnmpDevice(values: FormValues<NetworkDevice>): boolean {
  return !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
    (values as NetworkDevice).monitoringMethod,
  );
}

export function isMonitorBackedDevice(
  values: FormValues<NetworkDevice>,
): boolean {
  return !isSnmpDevice(values);
}
