import { CloudRelationshipKind } from "Common/Types/Cloud/CloudInventory";
import {
  CloudRelationshipDirection,
  CloudResolvedRelationship,
} from "Common/Types/Cloud/CloudResourceIndex";

/*
 * A resource's relationships as its Connected Resources card lists them:
 * one line per kind and direction ("Runs in", "Gets traffic from"), each
 * other end once. Kept apart from the card (CloudResourceInventoryCards)
 * so App's tests can read it without React.
 */

// Resources of the account read to name a resource's neighbours, at most.
export const CLOUD_NEIGHBOUR_READ_LIMIT: number = 2000;

// One line of the Connected Resources card: a relationship and its ends.
export interface CloudConnectionGroup {
  kind: CloudRelationshipKind;
  direction: CloudRelationshipDirection;
  relationships: Array<CloudResolvedRelationship>;
}

/*
 * The relationships, one group per kind and direction, in the order first
 * met: its own first, then what names it. An end listed twice (a load
 * balancer that names a target by its id and by its ARN) is shown once.
 */
export function groupCloudConnections(
  relationships: Array<CloudResolvedRelationship>,
): Array<CloudConnectionGroup> {
  const groups: Array<CloudConnectionGroup> = [];
  const byKey: Map<string, CloudConnectionGroup> = new Map();
  const seen: Set<string> = new Set<string>();

  for (const relationship of relationships) {
    const key: string = `${relationship.direction}|${relationship.kind}`;
    const end: string = relationship.other
      ? relationship.other.id.toString()
      : relationship.otherName.toLowerCase();

    if (seen.has(`${key}|${end}`)) {
      continue;
    }

    seen.add(`${key}|${end}`);

    let group: CloudConnectionGroup | undefined = byKey.get(key);

    if (!group) {
      group = {
        kind: relationship.kind,
        direction: relationship.direction,
        relationships: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    group.relationships.push(relationship);
  }

  return groups;
}
