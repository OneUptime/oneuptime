import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The monitoring-method picker, and the predicates every form that shows it
 * needs. The picker lives on a device's Settings page only: a new device is
 * probe-polled by default (pinged, and walked over SNMP once it has
 * credentials), so the create form and the topology dialog no longer ask.
 * Sharing the copy keeps the Settings page, the create form's optional SNMP
 * step and the topology dialog from drifting into disagreeing about what a
 * probe-polled device is.
 */

export const MONITORING_METHOD_OPTIONS: Array<DropdownOption> = [
  {
    value: NetworkDeviceMonitoringMethod.Probe,
    label:
      "Probe — pinged by the assigned probe on its schedule; walked over SNMP when credentials are set",
  },
  {
    value: NetworkDeviceMonitoringMethod.Monitor,
    label:
      "Bound monitor — an existing monitor's status is this device's status (override)",
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
  'The monitor whose status IS this device\'s status — the override for gear a probe cannot reach, or whose health is better judged by an HTTP or port check. Leave it empty to record the device now and bind a monitor later — it still belongs to a site and still appears on the map, and its status reads Pending, tagged "No monitor", until one is bound. Most devices do not need this: switch the method to Probe and the assigned probe pings the device itself.';

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
  "Probe is the normal choice: the assigned probe pings this device on its schedule, and walks it over SNMP as well whenever it has credentials — a phone, a camera or a PDU with no SNMP is simply pinged. Pick Bound monitor only when nothing can reach the device from a probe, or when an existing HTTP, port or Ping monitor already judges its health; that monitor's status then becomes the device's status and polling stops. Either way the device belongs to a site, carries labels, and appears on the network topology map.";

/*
 * The hostname field is shown on four surfaces (the create form, the
 * topology dialog, the Overview card and the Settings form). Two of them
 * used to say the probe "will poll it via SNMP", which is false twice over:
 * for a monitor-backed device, which is not polled at all, and for a
 * probe-polled device without credentials, which is pinged and never
 * walked. One sentence for all four keeps that from happening again.
 */
export const HOSTNAME_FIELD_DESCRIPTION: string =
  "The device's address — an IP or a hostname. A probe-polled device is pinged here on its schedule, and walked over SNMP at the same address once it has credentials; a monitor-backed device is only identified by it. It is also the address a Ping monitor created for the device checks.";

/*
 * Read through the parser rather than compared directly: an unset value means
 * Probe (the legacy "SNMP" too), which is what every device that predates the
 * column is, and what an untouched create form starts out as.
 *
 * A probe-polled device is pinged whether or not it has SNMP credentials, so
 * the SNMP step is shown for every one of them — the credentials are optional
 * on it. Only a bound-monitor override hides it: nothing polls such a device.
 */
export function isProbePolledDevice(
  values: FormValues<NetworkDevice>,
): boolean {
  return NetworkDeviceMonitoringMethodUtil.isProbePolled(
    (values as NetworkDevice).monitoringMethod,
  );
}

/** Kept under its old name for the forms that predate ping-first polling. */
export const isSnmpDevice: (values: FormValues<NetworkDevice>) => boolean =
  isProbePolledDevice;

export function isMonitorBackedDevice(
  values: FormValues<NetworkDevice>,
): boolean {
  return !isProbePolledDevice(values);
}

/*
 * The SNMP step is optional on every probe-polled device: with no
 * credentials the probe still pings it, so the device has a status from its
 * first poll, and the walk starts the moment credentials (or a credential
 * profile) are added. Said once so the create form, the Settings form and the
 * topology dialog agree about what an empty community string means.
 */
export const SNMP_STEP_DESCRIPTION: string =
  "Optional. Leave the community string (or v3 username) empty and this device is pinged only — it still gets a status from its first poll. Add credentials, or pick a credential profile, to walk it over SNMP as well: interfaces, hardware inventory, neighbours and health OIDs.";

export const PROBE_FIELD_DESCRIPTION: string =
  "The probe that pings this device on its schedule, walks it over SNMP when it has credentials, and receives its traps, syslog and NetFlow. It has to be able to reach the device directly, so pick one deployed on the device's network — a probe on the public internet cannot reach a private address. Polling starts as soon as the device is created.";
