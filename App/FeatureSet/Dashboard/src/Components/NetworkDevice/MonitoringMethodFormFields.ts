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
 * The "Monitor" binding field, worded once for every NetworkDevice form.
 *
 * The binding is OPTIONAL everywhere, and the copy has to say so: a device is
 * a real part of the network whether or not anything reports its health yet —
 * it belongs to a site, carries labels and appears on the topology map — and
 * its status simply reads "No monitor" until one is bound. The create form
 * used to be the one place that demanded a monitor, which meant an operator
 * recording a device before its monitor existed was blocked there and
 * nowhere else (the Settings edit form, the topology map's "Add to
 * Monitoring" dialog, discovery import and the server all accept a device
 * without one). Sharing the sentence is what stops that happening again.
 */
export const MONITOR_BINDING_FIELD_DESCRIPTION: string =
  "The monitor whose status IS this device's status. A Ping or IP monitor on the device's address is the usual choice. Leave it empty to record the device now and bind a monitor later — it still belongs to a site and still appears on the map, and its status reads Pending, tagged \"No monitor\", until one is bound.";

export const MONITOR_BINDING_FIELD_PLACEHOLDER: string =
  "Select Monitor (optional)";

/*
 * The monitoring-method picker's own explanation, worded once so the create
 * form and the topology map's "Add to Monitoring" dialog cannot disagree
 * about what choosing Monitor commits an operator to — which is nothing
 * beyond the choice itself. The old sentence said "bind it to an existing
 * Ping or IP monitor", which read as a prerequisite; the binding is optional.
 */
export const MONITORING_METHOD_FIELD_DESCRIPTION: string =
  "SNMP devices are polled by a probe you assign, on their own schedule. Pick Monitor for gear that cannot be walked — a switch with SNMP disabled, a consumer access point, an IP phone, a PDU — and bind a Ping or IP monitor to it now or later. Either way the device belongs to a site, carries labels, and appears on the network topology map.";

/*
 * The create form's variant: it is the one form that can create the Ping
 * monitor on save, and it says so — but only when the operator may create
 * monitors, because a promise the form cannot keep (the opt-in is hidden
 * without that permission) is worse than none. The topology dialog has no
 * such opt-in and stays on the sentence above.
 */
export const MONITORING_METHOD_FIELD_DESCRIPTION_WITH_PING_OFFER: string =
  "SNMP devices are polled by a probe you assign, on their own schedule. Pick Monitor for gear that cannot be walked — a switch with SNMP disabled, a consumer access point, an IP phone, a PDU — and bind a Ping or IP monitor to it now or later, or have one created for you when you save. Either way the device belongs to a site, carries labels, and appears on the network topology map.";

/*
 * The hostname field is shown on four surfaces (the create form, the
 * topology dialog, the Overview card and the Settings form). Two of them
 * used to say the probe "will poll it via SNMP", which is false for a
 * monitor-backed device; one sentence for all four keeps that from
 * happening again.
 */
export const HOSTNAME_FIELD_DESCRIPTION: string =
  "The device's address — an IP or a hostname. An SNMP device is polled here by its probe; a monitor-backed device is identified by it, and it is the address a Ping monitor created for the device checks.";

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
