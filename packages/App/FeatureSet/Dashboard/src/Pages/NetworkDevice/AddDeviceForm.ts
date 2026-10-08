import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IconProp from "Common/Types/Icon/IconProp";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SnmpVersionUtil } from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * The Add Device form, rethought from what someone adding a device knows.
 *
 * "Can we please make it as simple as possible to use? ... it should
 * basically wow users." (the maintainer) Adding a device used to be a
 * three-step wizard of fourteen fields: name, description, role, hostname
 * and MAC, then site, probe and a monitor opt-in, then a whole SNMP step.
 * What a person adding one device actually knows is its address, and what
 * they want is to see it come up.
 *
 * So the form is one page, and asks, in this order:
 *
 *   1. Hostname - the address, the one thing only they know (required);
 *   2. Name - optional: left empty, the device is named after its address;
 *   3. Site - optional: where it is, and picking one fills in the probe;
 *   4. Probe - required, and filled in whenever there is one answer: the
 *      site's default probe, or the project's only custom probe.
 *
 * Everything else folds away, open with one click and never lost:
 *
 *   - SNMP: the credentials that let the probe read the device's interfaces
 *     and health as well as ping it. Optional - a device is pinged without
 *     them - so the fold says that in one sentence instead of asking.
 *   - More fields: description, role, MAC address and the per-device Ping
 *     monitor, which most devices never need.
 *
 * This module holds the parts that are plain logic and words, free of React
 * and of the routes, so App/Tests can read them; Devices.tsx puts the form
 * together around them.
 */

// What the form's own action and the list's header button say: "Add Device".
export const ADD_DEVICE_CREATE_VERB: string = translationKey("Add");
export const ADD_DEVICE_SINGULAR_NAME: string = translationKey("Device");
export const ADD_DEVICE_PLURAL_NAME: string = translationKey("Devices");

export const ADD_DEVICE_HOSTNAME_DESCRIPTION: string = translationKey(
  "The IP address or hostname the probe pings.",
);

export const ADD_DEVICE_NAME_PLACEHOLDER: string = translationKey(
  "Same as the hostname",
);

export const ADD_DEVICE_NAME_DESCRIPTION: string = translationKey(
  "What you call this device. Leave it empty to name it after its hostname.",
);

export const ADD_DEVICE_SITE_DESCRIPTION: string = translationKey(
  "Where the device is. A site with a default probe fills in the probe below.",
);

export const ADD_DEVICE_SITE_PLACEHOLDER: string = translationKey("No site");

export const ADD_DEVICE_PROBE_DESCRIPTION: string = translationKey(
  "The probe that pings this device. It has to reach the device's address, so pick one on the same network.",
);

/*
 * The SNMP fold, folded, says what leaving it alone means. One sentence, in
 * the user's terms: what they get now, and what SNMP adds.
 */
export const ADD_DEVICE_SNMP_NOT_SET_SUMMARY: string = translationKey(
  "Optional. Without it the device is pinged, so it gets a status and a response time. Add its SNMP community string to also see its interfaces, traffic and health.",
);

export const ADD_DEVICE_SNMP_SECTION_TITLE: string = translationKey("SNMP");

export const ADD_DEVICE_SNMP_SECTION_DESCRIPTION: string = translationKey(
  "The credentials the probe reads the device with, as well as pinging it. A v1 or v2c community string is all most devices need.",
);

export const ADD_DEVICE_SNMP_SECTION_ID: string = "snmp";

export const ADD_DEVICE_CREDENTIAL_PROFILE_DESCRIPTION: string = translationKey(
  "Or use a saved set of credentials that other devices share. Credentials typed above win when both are set; the device's site can carry a default set too.",
);

export const ADD_DEVICE_CREDENTIAL_PROFILE_PLACEHOLDER: string =
  translationKey("No saved credentials");

export const ADD_DEVICE_PING_MONITOR_TITLE: string = translationKey(
  "Create a Ping monitor for incidents",
);

export const ADD_DEVICE_PING_MONITOR_DESCRIPTION: string = translationKey(
  "The probe already gives the device a status. A Ping monitor is what raises an incident when it stops answering: it is created on the hostname, bound to the device, and counts towards your plan. Incidents are off on it until you turn them on from the monitor's page. To alert on many devices at once, use Alert Policies instead.",
);

export const ADD_DEVICE_PING_PROBES_DESCRIPTION: string = translationKey(
  "The probes the Ping monitor checks from. They have to reach the device's network. Leave it empty to use the project's default probes.",
);

type FormValuesRecord = Record<string, unknown>;

// A form value as trimmed text: a picked option reads as its value.
function readText(values: FormValuesRecord, key: string): string {
  const value: unknown = values[key];

  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "object" && "value" in (value as object)) {
    return String((value as { value: unknown }).value ?? "").trim();
  }

  if (typeof value === "object" && "_id" in (value as object)) {
    return String((value as { _id: unknown })._id ?? "").trim();
  }

  return String(value).trim();
}

/**
 * Whether the device will be read over SNMP as well as pinged: a v1/v2c
 * community string, a v3 username, or a saved credential profile picked.
 * The version on its own is not credentials - it defaults to V2c whatever
 * the device speaks.
 */
export function hasSnmpCredentials(
  values: FormValues<NetworkDevice> | undefined | null,
): boolean {
  const record: FormValuesRecord = (values || {}) as FormValuesRecord;

  if (readText(record, "snmpCredentialProfile")) {
    return true;
  }

  if (SnmpVersionUtil.isV3(readText(record, "snmpVersion"))) {
    return readText(record, "snmpV3Username").length > 0;
  }

  return readText(record, "snmpCommunityString").length > 0;
}

/**
 * What the folded SNMP section says. Nothing set: the one sentence that
 * explains it is optional and what it adds. Credentials set: nothing, so the
 * header shows which fields are set instead (a secret by its name only).
 */
export function getAddDeviceSnmpSummary(
  values: FormValues<NetworkDevice> | undefined | null,
): Array<string> | undefined {
  if (hasSnmpCredentials(values)) {
    return undefined;
  }

  return [ADD_DEVICE_SNMP_NOT_SET_SUMMARY];
}

/*
 * The SNMP fold. Built once, at module level: BasicForm joins consecutive
 * fields into one section by the section's id, and FormStepsScan by how the
 * section is written - one constant on every field.
 *
 * It never opens by itself on the create form (openWhenConfigured: false)
 * except to show a field that fails validation - a v3 key left empty, say.
 * It is configured exactly when the device has credentials, so a version
 * changed to V3 with no user yet does not claim the device will be walked.
 */
export const ADD_DEVICE_SNMP_SECTION: FormFieldCollapsibleSection<NetworkDevice> =
  {
    id: ADD_DEVICE_SNMP_SECTION_ID,
    title: ADD_DEVICE_SNMP_SECTION_TITLE,
    description: ADD_DEVICE_SNMP_SECTION_DESCRIPTION,
    icon: IconProp.Key,
    openWhenConfigured: false,
    isConfigured: (values: FormValues<NetworkDevice>): boolean => {
      return hasSnmpCredentials(values);
    },
    getSummary: (
      values: FormValues<NetworkDevice>,
    ): Array<string> | undefined => {
      return getAddDeviceSnmpSummary(values);
    },
  };

/*
 * More fields: description, role, MAC address and the per-device Ping
 * monitor - what most devices never need, listed by name on the folded
 * header so nothing is hidden.
 */
export const ADD_DEVICE_MORE_FIELDS: FormFieldCollapsibleSection<NetworkDevice> =
  getAdvancedFormSection<NetworkDevice>();

/*
 * The name a new device is saved under: what was typed, trimmed, or - when
 * nothing was - its hostname. One rule for the form and the server
 * (NetworkDeviceService), so a device added through the API without a name
 * is named the same way.
 */
export { getDeviceNameForCreate } from "Common/Utils/NetworkDevice/DeviceNameDefault";
