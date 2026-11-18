import {
  RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION,
  RESOURCE_SECURITY_EVENTS_NAMING_LABEL,
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
  getResourceSecurityEventsChip,
  isResourceSecurityEventsScopeReadable,
} from "../ResourceSecurity/ResourceSecurityEventsScope";
import { ResourceSecurityScopeJson } from "Common/Types/SecurityCase/SecurityConnection";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";

/*
 * A NETWORK DEVICE'S SECURITY EVENTS PAGE (issue #5769): the Security Events
 * explorer on one device, as its Logs page is the Logs explorer on it.
 *
 * The page reads the events about the device - read from the syslog it
 * sends the probe (a firewall's blocked connections and threats, a VPN's
 * sign-ins), or naming it from any other source - the same events its
 * Security card counts (Types/SecurityEvent/SecurityEventScope). The scope
 * is a locked chip, "Network Device: core-fw-1", whose tooltip says what it
 * matches, so nobody has to guess why an event is on the page.
 *
 * Pure and React-free, so the chip and its words are pinned in a plain
 * test.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does, kept here so
 * this module stays free of i18next. The chip's tooltip looks each up.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export const DEVICE_SECURITY_EVENTS_CHIP_KEY: string = "Network Device";

export const DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY: string = translationKey(
  "The security events about this device: read from its own logs, or naming it.",
);

export const DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL: string =
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL;

export const DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION: string =
  translationKey(
    "Every security event read from the syslog this device sends the probe, whatever it names.",
  );

export const DEVICE_SECURITY_EVENTS_NAMING_LABEL: string =
  RESOURCE_SECURITY_EVENTS_NAMING_LABEL;

export const DEVICE_SECURITY_EVENTS_NAMING_DESCRIPTION: string =
  RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION;

export const DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON: string = translationKey(
  "The Events search cannot spell this as one search: it reads the device's own logs, or what names it.",
);

/*
 * The locked chip for the device's scope: its name, and in its tooltip
 * the two ways an event is the device's - read from its own logs, and
 * naming one of its identities (only when it has one to name). The shared
 * chip of a record's Security Events page (ResourceSecurityEventsScope),
 * in a device's own words: its logs are the syslog it sends the probe.
 */
export function getDeviceSecurityEventsChip(
  scope: ResourceSecurityScopeJson,
): ActiveFilter {
  return getResourceSecurityEventsChip(scope, {
    chipKey: DEVICE_SECURITY_EVENTS_CHIP_KEY,
    summary: DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
    ownLogsDescription: DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
    noSearchReason: DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
  });
}

// Whether the device's scope can match anything at all.
export function isDeviceSecurityEventsScopeReadable(
  scope: ResourceSecurityScopeJson,
): boolean {
  return isResourceSecurityEventsScopeReadable(scope);
}
