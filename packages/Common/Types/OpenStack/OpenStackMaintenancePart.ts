import { JSONObject } from "../JSON";
import { getOpenStackShortHostName } from "./OpenStackHealthRules";

/*
 * THE PARTS OF A CLOUD A MAINTENANCE EVENT IS ON.
 *
 * Linked to a cloud alone, an event is about the whole of it. Most planned work is on one host, or on
 * one availability zone being drained, so an event can name those: it then quiets what those parts
 * say (MonitorMaintenanceSuppression), names who they hold when it is created
 * (OpenStackMaintenanceReach), and tells the projects that asked to be told. Every other part of the
 * cloud goes on paging.
 *
 * Kept on the event as JSON, as its Data Observability databases are, because an inventory row is
 * dropped when a part stops being reported: the work planned on a host has to outlive the row.
 *
 * Pure, so a page, a test and the server can all read it.
 */

export enum OpenStackMaintenancePartKind {
  Hypervisor = "Hypervisor",
  AvailabilityZone = "AvailabilityZone",
}

export interface OpenStackMaintenancePart {
  openStackCloudId: string;
  kind: OpenStackMaintenancePartKind;
  // A host name or a zone name, as the inventory has it.
  name: string;
  regionName: string | null;
}

/*
 * A part as what quiets it reads it: which hosts it comes to. A zone comes to the hosts the inventory
 * has in it now, so a host added to it during the work is under the work too.
 */
export interface OpenStackMaintainedPart {
  regionName: string | null;
  hostNames: Array<string>;
}

// A cloud's name, for a monitor reading by name, with what is under maintenance in it.
export interface OpenStackMaintainedCloud {
  cloudId: string;
  cloudName: string | null;
  parts: Array<OpenStackMaintainedPart>;
}

// Step JSON and event JSON are not schema-checked, so every part is read for what it holds.
export function readOpenStackMaintenanceParts(
  value: unknown,
): Array<OpenStackMaintenancePart> {
  if (!Array.isArray(value)) {
    return [];
  }

  const parts: Array<OpenStackMaintenancePart> = [];

  for (const item of value as Array<unknown>) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const part: JSONObject = item as JSONObject;
    const cloudId: unknown = part["openStackCloudId"];
    const kind: unknown = part["kind"];
    const name: unknown = part["name"];
    const regionName: unknown = part["regionName"];

    if (
      typeof cloudId !== "string" ||
      !cloudId.trim() ||
      typeof name !== "string" ||
      !name.trim() ||
      (kind !== OpenStackMaintenancePartKind.Hypervisor &&
        kind !== OpenStackMaintenancePartKind.AvailabilityZone)
    ) {
      continue;
    }

    parts.push({
      openStackCloudId: cloudId.trim().toLowerCase(),
      kind: kind as OpenStackMaintenancePartKind,
      name: name.trim(),
      regionName:
        typeof regionName === "string" && regionName.trim()
          ? regionName.trim()
          : null,
    });
  }

  return parts;
}

// The labels a series names its machine by, and the one that says its region.
const OPENSTACK_SERIES_HOST_LABELS: ReadonlyArray<string> = [
  "hostname",
  "hypervisor_hostname",
  "openstack.hypervisor.name",
  "host",
];
const OPENSTACK_SERIES_REGION_LABEL: string = "openstack.region.name";

function readLabel(labels: JSONObject | undefined, key: string): string | null {
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = labels?.[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/*
 * The machine a name means. Nova names a service by its short host name and a hypervisor by its full
 * one (isSameOpenStackHost), and a cinder-volume is host@backend, or host@backend#pool.
 */
export function getOpenStackMachineOfHost(
  name: string | null | undefined,
): string {
  const host: string = (name || "").trim();
  const at: number = host.indexOf("@");
  return getOpenStackShortHostName(at > 0 ? host.substring(0, at) : host);
}

/*
 * Whether one series is about a machine under maintenance. A host name repeats between regions, so a
 * part that says its region only takes that region's, and a series that says none is taken only by a
 * part that says none: nothing here assumes a series it cannot place is under anything.
 */
export function isOpenStackSeriesOnMaintainedPart(data: {
  labels: JSONObject | undefined;
  parts: ReadonlyArray<OpenStackMaintainedPart>;
}): boolean {
  if (data.parts.length === 0) {
    return false;
  }

  const machines: Array<string> = OPENSTACK_SERIES_HOST_LABELS.map(
    (label: string): string => {
      return getOpenStackMachineOfHost(readLabel(data.labels, label));
    },
  ).filter(Boolean);

  if (machines.length === 0) {
    return false;
  }

  const region: string | null = readLabel(
    data.labels,
    OPENSTACK_SERIES_REGION_LABEL,
  );

  return data.parts.some((part: OpenStackMaintainedPart): boolean => {
    if ((part.regionName || null) !== region) {
      return false;
    }

    return part.hostNames.some((hostName: string): boolean => {
      const machine: string = getOpenStackMachineOfHost(hostName);
      return Boolean(machine) && machines.includes(machine);
    });
  });
}
