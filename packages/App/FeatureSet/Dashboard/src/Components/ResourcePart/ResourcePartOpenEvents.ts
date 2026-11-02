import ObjectID from "Common/Types/ObjectID";
import {
  OpenIssuesResult,
  loadOpenIssues,
} from "../ResourceTopology/ResourceTopologyIssuesLoader";
import { OpenIssueRecord } from "../ResourceTopology/ResourceTopologyIssues";

/*
 * The unresolved incidents and alerts about one part of a resource - a
 * Proxmox node or guest, a Kubernetes node, an ESXi host.
 *
 * A monitor of a whole resource links what it opens to the resource, and
 * only the record's series labels say which part crossed the line (a
 * Proxmox template groups by `id`: "node/pve2", "qemu/102"). So this reads
 * the resource's open records - few at any one time - with the topology's
 * loader (ResourceTopologyIssuesLoader, one read per kind, each kind on its
 * own so a role that may read alerts but not incidents still sees them) and
 * keeps the ones the product says are about the part.
 *
 * React-free beyond the data layer it calls, so App tests can read it.
 */

export interface ResourcePartOpenEvents {
  // Incidents first, then alerts, each newest first.
  records: Array<OpenIssueRecord>;
  // False when either kind could not be read (a role without access).
  isComplete: boolean;
}

/*
 * Incidents first, then alerts, each newest first: in one timeline of both
 * kinds, fresh warnings would push a part's critical incident below them,
 * and an incident is the one a reader must not miss.
 */
export function sortResourcePartOpenEvents(
  records: Array<OpenIssueRecord>,
): Array<OpenIssueRecord> {
  return [...records].sort((a: OpenIssueRecord, b: OpenIssueRecord): number => {
    if (a.type !== b.type) {
      return a.type === "incident" ? -1 : 1;
    }
    const aTime: number = a.createdAt ? a.createdAt.getTime() : 0;
    const bTime: number = b.createdAt ? b.createdAt.getTime() : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.title.localeCompare(b.title);
  });
}

export async function loadResourcePartOpenEvents(data: {
  projectId: ObjectID;
  // The relation that links a record to the resource: "proxmoxClusters".
  resourceRelation: string;
  resourceId: ObjectID;
  // Whether a record is about this part, read from its series labels.
  isAbout: (record: OpenIssueRecord) => boolean;
}): Promise<ResourcePartOpenEvents> {
  const result: OpenIssuesResult = await loadOpenIssues({
    projectId: data.projectId,
    resourceRelation: data.resourceRelation,
    resourceId: data.resourceId,
  });

  const records: Array<OpenIssueRecord> = result.records.filter(
    (record: OpenIssueRecord): boolean => {
      try {
        return data.isAbout(record);
      } catch {
        return false;
      }
    },
  );

  return {
    records: sortResourcePartOpenEvents(records),
    isComplete: result.incidentCount !== null && result.alertCount !== null,
  };
}
