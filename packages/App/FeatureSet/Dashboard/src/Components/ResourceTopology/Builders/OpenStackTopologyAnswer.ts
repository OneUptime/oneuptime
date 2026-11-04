import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_TOPOLOGY_FULL_PART_LIMIT } from "Common/Types/OpenStack/OpenStackTopology";
import { ResourceTopologyTruncation } from "../ResourceTopologyModel";
import {
  OPENSTACK_TOPOLOGY_SUMMARIZED,
  OpenStackInstancesByHost,
  getOpenStackTopologyGap,
} from "./OpenStackTopology";

/*
 * What the server's read of a cloud's map says, turned into what the page draws. Pure, so
 * a test can read it without a browser's globals.
 */

// One sentence over the map. The same shape ResourceTopologyMap takes.
export interface OpenStackTopologyNotice {
  id: string;
  text: string;
  values?: Record<string, string> | undefined;
}

// The kinds the map draws: what a truncation says it could not read of each.
const DRAWN_KINDS: ReadonlyArray<[OpenStackResourceKind, string]> = [
  [OpenStackResourceKind.Hypervisor, "openstack.hypervisor"],
  [OpenStackResourceKind.Instance, "openstack.instance"],
  [OpenStackResourceKind.Volume, "openstack.volume"],
  [OpenStackResourceKind.Network, "openstack.network"],
  [OpenStackResourceKind.Subnet, "openstack.subnet"],
  [OpenStackResourceKind.Router, "openstack.router"],
  [OpenStackResourceKind.FloatingIp, "openstack.floatingip"],
];

export interface OpenStackTopologyAnswer {
  rows: Array<OpenStackResource>;
  totalsByKind: Record<string, number>;
  instancesByHost: Array<OpenStackInstancesByHost>;
  isSummarized: boolean;
  projectNames: Record<string, string>;
}

export function toOpenStackRow(row: JSONObject): OpenStackResource {
  return Object.assign(new OpenStackResource(), row, {
    stateChangedAt: row["stateChangedAt"]
      ? new Date(row["stateChangedAt"] as string)
      : undefined,
    lastSeenAt: row["lastSeenAt"]
      ? new Date(row["lastSeenAt"] as string)
      : undefined,
  });
}

export function toOpenStackTopologyAnswer(
  data: JSONObject,
): OpenStackTopologyAnswer {
  return {
    rows: ((data["rows"] as Array<JSONObject>) || []).map(toOpenStackRow),
    totalsByKind: (data["totalsByKind"] as Record<string, number>) || {},
    instancesByHost:
      (data["instancesByHost"] as unknown as Array<OpenStackInstancesByHost>) ||
      [],
    isSummarized: data["isSummarized"] === true,
    projectNames: (data["projectNames"] as Record<string, string>) || {},
  };
}

/*
 * What the server left out, kind by kind. A summarized cloud always leaves out most of
 * its instances, which is the point, and this is how the map's count stays honest.
 */
export function getOpenStackTopologyTruncations(
  answer: OpenStackTopologyAnswer,
): Array<ResourceTopologyTruncation> {
  const shownByKind: Map<string, number> = new Map();
  for (const row of answer.rows) {
    shownByKind.set(row.kind || "", (shownByKind.get(row.kind || "") || 0) + 1);
  }

  const truncations: Array<ResourceTopologyTruncation> = [];
  for (const [kind, topologyKind] of DRAWN_KINDS) {
    const shown: number = shownByKind.get(kind) || 0;
    const total: number = answer.totalsByKind[kind] || 0;
    if (total > shown) {
      truncations.push({ kind: topologyKind, shown, total });
    }
  }
  return truncations;
}

export function getOpenStackTopologyNotices(
  answer: OpenStackTopologyAnswer,
): Array<OpenStackTopologyNotice> {
  const notices: Array<OpenStackTopologyNotice> = [];

  if (answer.isSummarized) {
    notices.push({
      id: "summarized",
      text: OPENSTACK_TOPOLOGY_SUMMARIZED,
      values: { limit: `${OPENSTACK_TOPOLOGY_FULL_PART_LIMIT}` },
    });
  }

  const gap: string | null = getOpenStackTopologyGap(answer.rows);
  if (gap) {
    notices.push({ id: "gap", text: gap });
  }

  return notices;
}
