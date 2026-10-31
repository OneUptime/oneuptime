import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
// English keys: the forms look their descriptions and placeholders up.
export const MONITOR_BINDING_FIELD_DESCRIPTION: string = translationKey(
  'Its status becomes the device\'s status. Leave it empty to bind a monitor later: until then the device reads Pending, tagged "No monitor".',
);

export const MONITOR_BINDING_FIELD_PLACEHOLDER: string =
  translationKey("Select Monitor");

/*
 * The monitoring-method picker's own explanation, worded once so the create
 * form and the topology map's "Add to Monitoring" dialog cannot disagree
 * about what choosing Monitor commits an operator to — which is nothing
 * beyond the choice itself. The old sentence said "bind it to an existing
 * Ping or IP monitor", which read as a prerequisite; the binding is optional.
 */
export const MONITORING_METHOD_FIELD_DESCRIPTION: string = translationKey(
  "Probe is the normal choice: a device with no SNMP credentials is simply pinged. Pick Bound monitor only when no probe can reach it.",
);

/*
 * The hostname field is shown on four surfaces (the create form, the
 * topology dialog, the Overview card and the Settings form). Two of them
 * used to say the probe "will poll it via SNMP", which is false twice over:
 * for a monitor-backed device, which is not polled at all, and for a
 * probe-polled device without credentials, which is pinged and never
 * walked. One sentence for all four keeps that from happening again.
 */
export const HOSTNAME_FIELD_DESCRIPTION: string = translationKey(
  "A probe-polled device is pinged here, and walked over SNMP once it has credentials. A monitor-backed device is only identified by it.",
);

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
export const SNMP_STEP_DESCRIPTION: string = translationKey(
  "Without credentials the device is only pinged. Add them to also read its interfaces, inventory and health.",
);

export const PROBE_FIELD_DESCRIPTION: string = translationKey(
  "Pings the device, walks it over SNMP and receives its traps, syslog and flows. It must reach the device directly.",
);
