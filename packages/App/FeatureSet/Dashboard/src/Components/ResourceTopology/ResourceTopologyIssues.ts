import { JSONObject } from "Common/Types/JSON";
import {
  ResourceTopologyIssue,
  ResourceTopologyIssueType,
} from "./ResourceTopologyModel";

/*
 * Pinning open incidents and alerts to the part of a resource they are
 * about.
 *
 * A monitor of a whole resource — a vCenter, a cluster, a container host —
 * opens one incident or alert per series that breaches, and links it to the
 * resource. Which part breached is said by the record's series labels
 * (`resource.vcenter.host.name`, `k8s.pod.name`, `container.name`, ...) and,
 * for a few products, by a link to the part's own inventory row (a
 * Kubernetes pod, a Docker container). Each product's topology knows how to
 * read its labels; this module holds what they share: reading a label the
 * way ingest writes it, and attaching every record to exactly one part, the
 * resource itself when nothing more precise is known.
 */

/* An open incident or alert as the topology reads it. */
export interface OpenIssueRecord {
  type: ResourceTopologyIssueType;
  id: string;
  title: string;
  number: string;
  severityName: string;
  severityColor: string | null;
  stateName: string;
  createdAt: Date | null;
  seriesLabels: JSONObject | null;
  /* Ids of the inventory rows it is linked to, by relation name. */
  relatedIds: Record<string, Array<string>>;
}

/*
 * A label's value, read as ingest writes it: resource attributes arrive
 * `resource.`-prefixed (`resource.k8s.pod.name`), datapoint attributes as
 * they are (`k8s.pod.name`). Blank values read as missing.
 */
export function readSeriesLabel(
  labels: JSONObject | null | undefined,
  key: string,
): string | null {
  if (!labels || typeof labels !== "object") {
    return null;
  }

  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = (labels as Record<string, unknown>)[candidate];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

/* Names compare the way people type them: case and edge spaces aside. */
export function sameName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }

  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function toTopologyIssue(
  record: OpenIssueRecord,
): ResourceTopologyIssue {
  return {
    type: record.type,
    id: record.id,
    title: record.title,
    number: record.number,
    severityName: record.severityName,
    severityColor: record.severityColor,
    stateName: record.stateName,
    createdAt: record.createdAt,
  };
}

/*
 * Every record on the one part `locate` names, or on the resource itself
 * (`rootId`) when it names none — a record the topology cannot place is
 * still about this resource, and must not go missing from the map. Within a
 * part, incidents come before alerts, each newest first.
 */
export function attachOpenIssues(data: {
  records: Array<OpenIssueRecord>;
  rootId: string;
  locate: (record: OpenIssueRecord) => string | null;
}): Map<string, Array<ResourceTopologyIssue>> {
  const byNode: Map<string, Array<ResourceTopologyIssue>> = new Map<
    string,
    Array<ResourceTopologyIssue>
  >();
  const seen: Set<string> = new Set<string>();

  for (const record of data.records) {
    const recordKey: string = `${record.type}:${record.id}`;

    if (seen.has(recordKey)) {
      continue;
    }

    seen.add(recordKey);

    let nodeId: string | null = null;

    try {
      nodeId = data.locate(record);
    } catch {
      nodeId = null;
    }

    const target: string = nodeId || data.rootId;
    const list: Array<ResourceTopologyIssue> = byNode.get(target) || [];
    list.push(toTopologyIssue(record));
    byNode.set(target, list);
  }

  for (const list of byNode.values()) {
    list.sort((a: ResourceTopologyIssue, b: ResourceTopologyIssue): number => {
      if (a.type !== b.type) {
        return a.type === "incident" ? -1 : 1;
      }

      const aTime: number = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime: number = b.createdAt ? b.createdAt.getTime() : 0;

      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  return byNode;
}
