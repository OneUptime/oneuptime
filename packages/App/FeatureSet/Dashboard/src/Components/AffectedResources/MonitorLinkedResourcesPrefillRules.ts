import {
  AffectedResourceType,
  AffectedResourcesPayload,
} from "./AffectedResourcesPicker";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * PREFILLING WHAT A NEW INCIDENT, ALERT OR MAINTENANCE EVENT AFFECTS FROM
 * WHAT ITS MONITORS ARE LINKED TO.
 *
 * A monitor can say what it watches (Monitor > Overview > Linked
 * Resources): the cluster, hosts, databases and services behind it. Every
 * incident and alert the monitor raises is linked to them on the server.
 * When someone declares an incident, creates an alert or schedules
 * maintenance and picks such a monitor, the form adds those resources to
 * Other Affected Resources too - where they can still remove any of them
 * before saving - so a hand-made record is linked like a monitor-made one,
 * and OneUptime AI can investigate and fix it on the cluster or host.
 *
 * Only added, never removed: taking a monitor off leaves what it brought,
 * since the person may have meant to keep it. And each monitor brings its
 * resources once per form, so a resource someone removed does not come back
 * while they keep working on the form.
 *
 * React-free, so App's tests can read it; the component is
 * MonitorLinkedResourcesPrefill.tsx.
 */

// What a monitor can be linked to - an incident's Other Affected Resources.
export const MONITOR_LINKED_RESOURCE_TYPES: Array<AffectedResourceType> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "Service",
];

export type MonitorLinkedResourceKey =
  | "hosts"
  | "kubernetesClusters"
  | "dockerHosts"
  | "podmanHosts"
  | "proxmoxClusters"
  | "vmwareVCenters"
  | "cephClusters"
  | "dockerSwarmClusters"
  | "iotFleets"
  | "databaseServers"
  | "services";

// The relation each linked resource type is held in, on a monitor and a form.
export const MONITOR_LINKED_RESOURCE_KEYS: Array<MonitorLinkedResourceKey> = [
  "hosts",
  "kubernetesClusters",
  "dockerHosts",
  "podmanHosts",
  "proxmoxClusters",
  "vmwareVCenters",
  "cephClusters",
  "dockerSwarmClusters",
  "iotFleets",
  "databaseServers",
  "services",
];

export type AffectedResourcesPayloadKey = Exclude<
  keyof AffectedResourcesPayload,
  "__affectedResourcesPayload"
>;

// What the Other Affected Resources field of each create form writes.
export const INCIDENT_PREFILL_PAYLOAD_KEYS: Array<AffectedResourcesPayloadKey> =
  [...MONITOR_LINKED_RESOURCE_KEYS];
export const ALERT_PREFILL_PAYLOAD_KEYS: Array<AffectedResourcesPayloadKey> = [
  ...MONITOR_LINKED_RESOURCE_KEYS,
];
export const SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS: Array<AffectedResourcesPayloadKey> =
  [...MONITOR_LINKED_RESOURCE_KEYS, "networkSites"];

// Read for each picked monitor: its linked resources, named.
export const MONITOR_LINKED_RESOURCES_SELECT: Record<
  string,
  true | { _id: true; name: true }
> = {
  _id: true,
  hosts: { _id: true, name: true },
  kubernetesClusters: { _id: true, name: true },
  dockerHosts: { _id: true, name: true },
  podmanHosts: { _id: true, name: true },
  proxmoxClusters: { _id: true, name: true },
  vmwareVCenters: { _id: true, name: true },
  cephClusters: { _id: true, name: true },
  dockerSwarmClusters: { _id: true, name: true },
  iotFleets: { _id: true, name: true },
  databaseServers: { _id: true, name: true },
  services: { _id: true, name: true },
};

export interface MonitorLinkedResource {
  key: MonitorLinkedResourceKey;
  // Lower-cased, as the form's other ids are compared.
  id: string;
  name: string;
}

/*
 * Said under Other Affected Resources once something was added, naming
 * what is still there.
 */
export const PREFILLED_FROM_MONITORS_LABEL: PluralTemplate = {
  one: "Added from what the picked monitor is linked to: {{names}}.",
  other: "Added from what the picked monitors are linked to: {{names}}.",
};

export const UNNAMED_LINKED_RESOURCE: string =
  translationKey("Unnamed resource");

/*
 * The ids the form holds for one relation. Right after a pick, and until
 * the field splits it, the anchor field (`hosts`) holds the picker's whole
 * payload and the other relations their previous lists: the payload is
 * what the form is about to hold, so it is read instead.
 */
function getFormIds(
  values: Record<string, unknown>,
  key: AffectedResourcesPayloadKey,
): Array<string> {
  const anchor: unknown = values["hosts"];

  if (
    anchor &&
    typeof anchor === "object" &&
    !Array.isArray(anchor) &&
    "__affectedResourcesPayload" in anchor
  ) {
    return getIdsFromFormValue((anchor as Record<string, unknown>)[key]);
  }

  return getIdsFromFormValue(values[key]);
}

interface RelatedRow {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
}

function readId(row: RelatedRow | null | undefined): string {
  const raw: unknown = row?._id ?? row?.id;
  return raw ? String(raw).trim().toLowerCase() : "";
}

/*
 * The resources the monitors (read with MONITOR_LINKED_RESOURCES_SELECT)
 * are linked to: each once, in the order the monitors and their relations
 * name them.
 */
export function getLinkedResourcesOfMonitors(
  monitors: Array<unknown>,
): Array<MonitorLinkedResource> {
  const resources: Array<MonitorLinkedResource> = [];
  const seen: Set<string> = new Set<string>();

  for (const monitor of monitors) {
    if (!monitor || typeof monitor !== "object") {
      continue;
    }

    for (const key of MONITOR_LINKED_RESOURCE_KEYS) {
      const rows: unknown = (monitor as Record<string, unknown>)[key];

      if (!Array.isArray(rows)) {
        continue;
      }

      for (const row of rows as Array<RelatedRow | null | undefined>) {
        const id: string = readId(row);

        if (!id || seen.has(`${key}:${id}`)) {
          continue;
        }

        seen.add(`${key}:${id}`);
        resources.push({
          key,
          id,
          name: typeof row?.name === "string" ? row.name : "",
        });
      }
    }
  }

  return resources;
}

// The linked resources the form does not hold yet.
export function getLinkedResourcesToAdd(data: {
  values: Record<string, unknown>;
  linked: Array<MonitorLinkedResource>;
}): Array<MonitorLinkedResource> {
  return data.linked.filter((resource: MonitorLinkedResource): boolean => {
    return !getFormIds(data.values, resource.key).includes(resource.id);
  });
}

/*
 * What the Other Affected Resources field is handed to add them: its own
 * payload shape (AffectedResourcesPayload), so the field splits it back into
 * its relations exactly as when someone picks in it. Every relation the
 * field writes carries what the form holds plus what is added; the monitors
 * stay the other picker's.
 */
export function buildPrefillPayload(data: {
  values: Record<string, unknown>;
  toAdd: Array<MonitorLinkedResource>;
  payloadKeys: Array<AffectedResourcesPayloadKey>;
}): AffectedResourcesPayload {
  const payload: AffectedResourcesPayload = {
    __affectedResourcesPayload: true,
    monitors: undefined,
    hosts: undefined,
    kubernetesClusters: undefined,
    dockerHosts: undefined,
    podmanHosts: undefined,
    proxmoxClusters: undefined,
    vmwareVCenters: undefined,
    cephClusters: undefined,
    dockerSwarmClusters: undefined,
    iotFleets: undefined,
    databaseServers: undefined,
    networkSites: undefined,
    services: undefined,
  };

  for (const key of data.payloadKeys) {
    if (key === "monitors") {
      continue;
    }

    const ids: Array<string> = getFormIds(data.values, key);

    for (const resource of data.toAdd) {
      if (resource.key === key && !ids.includes(resource.id)) {
        ids.push(resource.id);
      }
    }

    payload[key] = ids;
  }

  return payload;
}

// The added resources the form still holds, for the line under the field.
export function getPrefilledResourcesStillPresent(data: {
  values: Record<string, unknown>;
  added: Array<MonitorLinkedResource>;
}): Array<MonitorLinkedResource> {
  return data.added.filter((resource: MonitorLinkedResource): boolean => {
    return getFormIds(data.values, resource.key).includes(resource.id);
  });
}
