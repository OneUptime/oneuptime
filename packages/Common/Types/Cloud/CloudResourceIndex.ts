import ObjectID from "../ObjectID";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  isCloudRelationshipKind,
} from "./CloudInventory";

/*
 * FINDING A CLOUD RESOURCE BY THE NAME ANOTHER PART OF THE CLOUD GIVES IT.
 *
 * A change in an activity log, a relationship in an inventory and a
 * resource's own record each name a resource their own way: an ARN whole,
 * the plain id AWS gives network pieces ("subnet-0abc"), an ARM id, a
 * Google Cloud full resource name with or without its service. This module
 * is the one place those names are matched to the Cloud Resources an
 * account holds - for the change recorder, for OneUptime AI's cloud tools,
 * and for the dashboard's Connected Resources card and account topology -
 * so a relationship reads the same wherever it is drawn.
 *
 * Two rules keep a match honest: a short name two resources answer to is
 * never guessed, and two resources of different types are never the same
 * one (a subnet called "web" is not the instance called "web").
 */

// A Cloud Resource as the index knows it.
export interface CloudIndexedResource {
  id: ObjectID;
  name: string;
  providerResourceId: string;
  type: string;
}

// What a match gives back: the resource's row id and its name.
export interface CloudIndexEntry {
  id: ObjectID;
  name: string;
}

// A Cloud Resource with the relationships its inventory listed.
export interface CloudLinkedResource extends CloudIndexedResource {
  relationships: Array<CloudResourceRelationship>;
}

// The last segment of an ARN, an ARM id or a resource name: its own name or id.
function lastSegment(value: string): string {
  const slash: number = value.lastIndexOf("/");
  const colon: number = value.lastIndexOf(":");
  const cut: number = Math.max(slash, colon);

  return cut >= 0 && cut < value.length - 1 ? value.slice(cut + 1) : value;
}

/*
 * The Cloud Resources of one account, by every name a change may give
 * them: the provider id whole, its last segment with its type, its last
 * segment alone, and - for Google Cloud, whose audit log writes
 * "projects/p/zones/z/instances/web-1" for
 * "//compute.googleapis.com/projects/p/zones/z/instances/web-1" - the full
 * name without its service.
 */
export class CloudResourceIndex {
  private byKey: Map<string, CloudIndexEntry> = new Map();
  // Short names two resources answer to: neither is guessed.
  private ambiguous: Set<string> = new Set();

  public constructor(rows: Array<CloudIndexedResource>) {
    for (const row of rows) {
      const id: string = row.providerResourceId.trim().toLowerCase();

      if (!id) {
        continue;
      }

      const entry: CloudIndexEntry = {
        id: row.id,
        name: row.name,
      };
      this.add(id, entry);
      this.add(`${row.type.toLowerCase()}|${lastSegment(id)}`, entry);
      this.add(`|${lastSegment(id)}`, entry);

      if (id.startsWith("//")) {
        const serviceEnd: number = id.indexOf("/", 2);

        if (serviceEnd > 0) {
          this.add(id.slice(serviceEnd + 1), entry);
        }
      }
    }
  }

  private add(key: string, entry: CloudIndexEntry): void {
    const existing: CloudIndexEntry | undefined = this.byKey.get(key);

    if (existing && existing.id.toString() !== entry.id.toString()) {
      this.ambiguous.add(key);
      return;
    }

    this.byKey.set(key, entry);
  }

  // The resource a change's resource names, or null.
  public find(resource: {
    id: string;
    type?: string | undefined;
  }): CloudIndexEntry | null {
    const id: string = resource.id.trim().toLowerCase();

    if (!id) {
      return null;
    }

    const keys: Array<string> = [
      id,
      ...(resource.type
        ? [`${resource.type.toLowerCase()}|${lastSegment(id)}`]
        : []),
      `|${lastSegment(id)}`,
    ];

    for (const key of keys) {
      if (this.ambiguous.has(key)) {
        continue;
      }

      const found: CloudIndexEntry | undefined = this.byKey.get(key);

      if (found) {
        return found;
      }
    }

    return null;
  }
}

/*
 * The resource a relationship points at, among `resources`: found by the
 * index, and of the type the relationship names when it names one.
 */
function makeTargetFinder(
  resources: Array<CloudLinkedResource>,
): (relationship: CloudResourceRelationship) => CloudLinkedResource | null {
  const index: CloudResourceIndex = new CloudResourceIndex(resources);
  const byId: Map<string, CloudLinkedResource> = new Map();

  for (const resource of resources) {
    byId.set(resource.id.toString(), resource);
  }

  return (
    relationship: CloudResourceRelationship,
  ): CloudLinkedResource | null => {
    const found: CloudIndexEntry | null = index.find({
      id: relationship.target,
      type: relationship.targetType,
    });
    const resource: CloudLinkedResource | undefined = found
      ? byId.get(found.id.toString())
      : undefined;

    if (!resource) {
      return null;
    }

    // Two resources of different types are never the same one.
    if (
      relationship.targetType &&
      resource.type.toLowerCase() !== relationship.targetType.toLowerCase()
    ) {
      return null;
    }

    return resource;
  };
}

export type CloudRelationshipDirection = "out" | "in";

/*
 * One relationship of a resource, read from either end: "out" is one the
 * resource itself lists (it runs in a subnet), "in" one another resource
 * lists naming it (a load balancer sends traffic to it).
 */
export interface CloudResolvedRelationship {
  kind: CloudRelationshipKind;
  direction: CloudRelationshipDirection;
  // The resource at the other end, when the account holds it.
  other: CloudLinkedResource | null;
  // How the other end is named: its name, or the id the cloud gave it.
  otherName: string;
  // Its type, when known: "AWS::EC2::Subnet".
  otherType: string;
}

/*
 * One resource's relationships, both ways, named after the resources the
 * account holds: what it points at (its own relationships) and what points
 * at it (theirs, naming it). Out first, in the order listed, then in.
 */
export function resolveCloudRelationships(data: {
  resource: Omit<CloudIndexedResource, "name">;
  relationships: Array<CloudResourceRelationship>;
  neighbours: Array<CloudLinkedResource>;
}): Array<CloudResolvedRelationship> {
  const findTarget: (
    relationship: CloudResourceRelationship,
  ) => CloudLinkedResource | null = makeTargetFinder(data.neighbours);
  const resolved: Array<CloudResolvedRelationship> = [];

  for (const relationship of data.relationships) {
    if (!isCloudRelationshipKind(relationship.kind)) {
      continue;
    }

    const other: CloudLinkedResource | null = findTarget(relationship);

    resolved.push({
      kind: relationship.kind,
      direction: "out",
      other: other,
      otherName: other?.name || relationship.target,
      otherType: relationship.targetType || other?.type || "",
    });
  }

  // What names this resource: its id whole, or its own name with its type.
  const self: CloudResourceIndex = new CloudResourceIndex([
    { ...data.resource, name: "" },
  ]);
  const selfId: string = data.resource.id.toString();

  for (const neighbour of data.neighbours) {
    if (neighbour.id.toString() === selfId) {
      continue;
    }

    for (const relationship of neighbour.relationships) {
      if (
        !isCloudRelationshipKind(relationship.kind) ||
        (relationship.targetType &&
          relationship.targetType.toLowerCase() !==
            data.resource.type.toLowerCase()) ||
        !self.find({ id: relationship.target, type: relationship.targetType })
      ) {
        continue;
      }

      resolved.push({
        kind: relationship.kind,
        direction: "in",
        other: neighbour,
        otherName: neighbour.name || neighbour.providerResourceId,
        otherType: neighbour.type,
      });
    }
  }

  return resolved;
}

// One relationship between two resources of the same account.
export interface CloudResourceLink {
  // The resource that lists the relationship, by row id.
  fromId: string;
  // The resource it names, by row id.
  toId: string;
  kind: CloudRelationshipKind;
}

/*
 * Every relationship between the resources given that both ends of are
 * among them: what an account's topology draws. A resource is never linked
 * to itself, and one relationship is one link however often it is listed.
 */
export function getCloudResourceLinks(
  resources: Array<CloudLinkedResource>,
): Array<CloudResourceLink> {
  const findTarget: (
    relationship: CloudResourceRelationship,
  ) => CloudLinkedResource | null = makeTargetFinder(resources);
  const links: Array<CloudResourceLink> = [];
  const seen: Set<string> = new Set<string>();

  for (const resource of resources) {
    const fromId: string = resource.id.toString();

    for (const relationship of resource.relationships) {
      if (!isCloudRelationshipKind(relationship.kind)) {
        continue;
      }

      const target: CloudLinkedResource | null = findTarget(relationship);

      if (!target) {
        continue;
      }

      const toId: string = target.id.toString();

      if (toId === fromId) {
        continue;
      }

      const key: string = `${fromId}|${relationship.kind}|${toId}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      links.push({ fromId, toId, kind: relationship.kind });
    }
  }

  return links;
}
