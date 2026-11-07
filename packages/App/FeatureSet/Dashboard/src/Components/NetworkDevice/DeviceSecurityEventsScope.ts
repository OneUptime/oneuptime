import { ResourceSecurityScopeJson } from "Common/Types/SecurityCase/SecurityConnection";
import {
  SECURITY_EVENT_SCOPE_QUERY_KEY,
  hasSecurityEventScopeMatch,
} from "Common/Types/SecurityEvent/SecurityEventScope";
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
  translationKey("Its own logs");

export const DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION: string =
  translationKey(
    "Every security event read from the syslog this device sends the probe, whatever it names.",
  );

export const DEVICE_SECURITY_EVENTS_NAMING_LABEL: string =
  translationKey("Naming it");

export const DEVICE_SECURITY_EVENTS_NAMING_DESCRIPTION: string = translationKey(
  "Events from any source that name one of these. A private address is left out: another network can use it too.",
);

export const DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON: string = translationKey(
  "The Events search cannot spell this as one search: it reads the device's own logs, or what names it.",
);

/*
 * The locked chip for the device's scope: its name, and in its tooltip
 * the two ways an event is the device's - read from its own logs, and
 * naming one of its identities (only when it has one to name).
 */
export function getDeviceSecurityEventsChip(
  scope: ResourceSecurityScopeJson,
): ActiveFilter {
  const name: string = scope.name.trim() || scope.id;
  const matches: Array<{
    label: string;
    description: string;
    values: Array<string>;
  }> = [];

  if (
    scope.scope.attributeKey &&
    scope.scope.attributeValues &&
    scope.scope.attributeValues.length > 0
  ) {
    matches.push({
      label: DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL,
      description: DEVICE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
      values: [name],
    });
  }

  if (scope.values.length > 0 && scope.scope.observables.length > 0) {
    matches.push({
      label: DEVICE_SECURITY_EVENTS_NAMING_LABEL,
      description: DEVICE_SECURITY_EVENTS_NAMING_DESCRIPTION,
      values: [...scope.values],
    });
  }

  return {
    facetKey: SECURITY_EVENT_SCOPE_QUERY_KEY,
    value: scope.id,
    displayKey: DEVICE_SECURITY_EVENTS_CHIP_KEY,
    displayValue: name,
    readOnly: true,
    lockedDetail: {
      searchTokenUnavailableReason: DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
      scopeSummary: DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
      scopeMatches: matches,
    },
  };
}

// Whether the device's scope can match anything at all.
export function isDeviceSecurityEventsScopeReadable(
  scope: ResourceSecurityScopeJson,
): boolean {
  return hasSecurityEventScopeMatch(scope.scope);
}
