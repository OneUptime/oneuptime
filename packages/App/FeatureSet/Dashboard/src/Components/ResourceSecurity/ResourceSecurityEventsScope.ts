import {
  ResourceSecurityScopeJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SECURITY_EVENT_SCOPE_QUERY_KEY,
  hasSecurityEventScopeMatch,
} from "Common/Types/SecurityEvent/SecurityEventScope";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";

/*
 * A RESOURCE'S OWN SECURITY EVENTS PAGE (#5769, #9547): the Security Events
 * explorer on one host, cluster, device, cloud resource or service, as its
 * Logs page is the Logs explorer on it.
 *
 * The page reads exactly the events the resource's Security card counts
 * (POST /security-case/resource-security-scope): the events naming one of
 * its exact identities - its names, the public addresses it alone holds -
 * or read from its own logs. The scope is a locked chip, "Kubernetes
 * Cluster: prod-eu", whose tooltip says what it matches, so nobody has to
 * guess why an event is on the page.
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

// What the chip calls each kind of record, as its page's title does.
export const RESOURCE_SECURITY_EVENTS_CHIP_KEYS: Readonly<
  Record<SecurityConnectionKind, string>
> = {
  [SecurityConnectionKind.Host]: translationKey("Host"),
  [SecurityConnectionKind.DockerHost]: translationKey("Docker Host"),
  [SecurityConnectionKind.PodmanHost]: translationKey("Podman Host"),
  [SecurityConnectionKind.KubernetesCluster]:
    translationKey("Kubernetes Cluster"),
  [SecurityConnectionKind.OpenStackCloud]: translationKey("OpenStack Cloud"),
  [SecurityConnectionKind.NetworkDevice]: translationKey("Network Device"),
  [SecurityConnectionKind.CloudResource]: translationKey("Cloud Resource"),
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "Serverless Function",
  ),
  [SecurityConnectionKind.Service]: translationKey("Service"),
  [SecurityConnectionKind.Monitor]: translationKey("Monitor"),
  [SecurityConnectionKind.User]: translationKey("User"),
  [SecurityConnectionKind.InventoryItem]: translationKey("Inventory Item"),
};

export const RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH: string = translationKey(
  "The security events about it: read from its own logs, or naming it.",
);

export const RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING: string = translationKey(
  "The security events that name it, from any source.",
);

export const RESOURCE_SECURITY_EVENTS_SUMMARY_OWN_LOGS: string = translationKey(
  "The security events read from its own logs.",
);

export const RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL: string =
  translationKey("Its own logs");

export const RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION: string =
  translationKey(
    "Every security event read from its own logs, whatever it names.",
  );

export const RESOURCE_SECURITY_EVENTS_NAMING_LABEL: string =
  translationKey("Naming it");

export const RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION: string =
  translationKey(
    "Events from any source that name one of these. A private address is left out: another network can use it too.",
  );

/*
 * A kind whose own logs are not lines it wrote itself says what they are
 * (#9628): a Docker or Podman host's are its containers' logs, which are
 * filed under each container's service and reach the host by the host name
 * they were written on; a service's are its logs and its traces.
 */
const CONTAINER_HOST_SUMMARY_BOTH: string = translationKey(
  "The security events about it: read from its containers' logs, or naming it.",
);

const CONTAINER_HOST_OWN_LOGS_DESCRIPTION: string = translationKey(
  "Every security event read from its containers' logs, whatever it names.",
);

/*
 * A service's and a serverless function's own logs are their logs and
 * their traces (#9780): a function's are the ones carrying its faas.name,
 * whatever service they are filed under.
 */
const LOGS_AND_TRACES_SUMMARY_OWN_LOGS: string = translationKey(
  "The security events read from its own logs and traces.",
);

const LOGS_AND_TRACES_OWN_LOGS_DESCRIPTION: string = translationKey(
  "Every security event read from its own logs and traces, whatever it names.",
);

export const RESOURCE_SECURITY_EVENTS_SUMMARIES_BOTH: Readonly<
  Partial<Record<SecurityConnectionKind, string>>
> = {
  [SecurityConnectionKind.DockerHost]: CONTAINER_HOST_SUMMARY_BOTH,
  [SecurityConnectionKind.PodmanHost]: CONTAINER_HOST_SUMMARY_BOTH,
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "The security events about it: read from its own logs and traces, or naming it.",
  ),
};

export const RESOURCE_SECURITY_EVENTS_SUMMARIES_OWN_LOGS: Readonly<
  Partial<Record<SecurityConnectionKind, string>>
> = {
  [SecurityConnectionKind.Service]: LOGS_AND_TRACES_SUMMARY_OWN_LOGS,
  [SecurityConnectionKind.ServerlessFunction]: LOGS_AND_TRACES_SUMMARY_OWN_LOGS,
};

export const RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTIONS: Readonly<
  Partial<Record<SecurityConnectionKind, string>>
> = {
  [SecurityConnectionKind.DockerHost]: CONTAINER_HOST_OWN_LOGS_DESCRIPTION,
  [SecurityConnectionKind.PodmanHost]: CONTAINER_HOST_OWN_LOGS_DESCRIPTION,
  [SecurityConnectionKind.Service]: LOGS_AND_TRACES_OWN_LOGS_DESCRIPTION,
  [SecurityConnectionKind.ServerlessFunction]:
    LOGS_AND_TRACES_OWN_LOGS_DESCRIPTION,
};

export const RESOURCE_SECURITY_EVENTS_NO_SEARCH_REASON: string = translationKey(
  "The Events search cannot spell this as one search: it reads the record's own logs, or what names it.",
);

// The words a page may give its chip instead of the shared ones (a device's own).
export interface ResourceSecurityEventsChipWords {
  chipKey?: string | undefined;
  summary?: string | undefined;
  ownLogsDescription?: string | undefined;
  noSearchReason?: string | undefined;
}

function hasOwnLogs(scope: ResourceSecurityScopeJson): boolean {
  return Boolean(
    scope.scope.attributeKey &&
      scope.scope.attributeValues &&
      scope.scope.attributeValues.length > 0,
  );
}

function hasNames(scope: ResourceSecurityScopeJson): boolean {
  return scope.values.length > 0 && scope.scope.observables.length > 0;
}

// The tooltip's first line: what the scope reads, by what it holds.
export function getResourceSecurityEventsSummary(
  scope: ResourceSecurityScopeJson,
): string {
  if (hasOwnLogs(scope) && hasNames(scope)) {
    return (
      RESOURCE_SECURITY_EVENTS_SUMMARIES_BOTH[scope.kind] ||
      RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH
    );
  }

  return hasOwnLogs(scope)
    ? RESOURCE_SECURITY_EVENTS_SUMMARIES_OWN_LOGS[scope.kind] ||
        RESOURCE_SECURITY_EVENTS_SUMMARY_OWN_LOGS
    : RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING;
}

/*
 * The locked chip for a record's scope: its kind and name, and in its
 * tooltip the ways an event is the record's - read from its own logs, and
 * naming one of its identities (each only when it has one).
 */
export function getResourceSecurityEventsChip(
  scope: ResourceSecurityScopeJson,
  words: ResourceSecurityEventsChipWords = {},
): ActiveFilter {
  const name: string = scope.name.trim() || scope.id;
  const matches: Array<{
    label: string;
    description: string;
    values: Array<string>;
  }> = [];

  if (hasOwnLogs(scope)) {
    matches.push({
      label: RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
      description:
        words.ownLogsDescription ||
        RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTIONS[scope.kind] ||
        RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
      values: [name],
    });
  }

  if (hasNames(scope)) {
    matches.push({
      label: RESOURCE_SECURITY_EVENTS_NAMING_LABEL,
      description: RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION,
      values: [...scope.values],
    });
  }

  return {
    facetKey: SECURITY_EVENT_SCOPE_QUERY_KEY,
    value: scope.id,
    displayKey:
      words.chipKey ||
      RESOURCE_SECURITY_EVENTS_CHIP_KEYS[scope.kind] ||
      RESOURCE_SECURITY_EVENTS_CHIP_KEYS[SecurityConnectionKind.Host],
    displayValue: name,
    readOnly: true,
    lockedDetail: {
      searchTokenUnavailableReason:
        words.noSearchReason || RESOURCE_SECURITY_EVENTS_NO_SEARCH_REASON,
      scopeSummary: words.summary || getResourceSecurityEventsSummary(scope),
      scopeMatches: matches,
    },
  };
}

// Whether the record's scope can match anything at all.
export function isResourceSecurityEventsScopeReadable(
  scope: ResourceSecurityScopeJson,
): boolean {
  return hasSecurityEventScopeMatch(scope.scope);
}
