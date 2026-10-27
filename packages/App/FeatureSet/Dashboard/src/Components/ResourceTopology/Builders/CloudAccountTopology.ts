import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "Common/Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResourceLink,
  getCloudResourceLinks,
} from "Common/Types/Cloud/CloudResourceIndex";
import {
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "Common/Types/Cloud/CloudResourceCatalog";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import { CLOUD_RELATIONSHIP_WORDS } from "../../Cloud/CloudRelationshipWords";
import {
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import { OpenIssueRecord, attachOpenIssues } from "../ResourceTopologyIssues";
import { isRecent } from "../ResourceTopologyFormat";

/*
 * A cloud account's topology: its regions, and in each its resources the
 * way its inventory relates them - a subnet in its network, an instance in
 * its subnet, the members of a scaling group or a cluster under it - with
 * what crosses the tree drawn as relations: a load balancer to its targets,
 * a security group to what it protects, a disk to its machine, a queue to
 * its dead-letter queue.
 *
 * A resource's parent is the resource it runs in, else the one it is part
 * of, when the account holds it (CloudResourceIndex's rules: never a guess,
 * never another type); otherwise its region, or the account for a resource
 * that is in none. Health is whether it is still listed or reporting, made
 * worse by the open incidents and alerts linked to it.
 */

export const CLOUD_ACCOUNT_ROOT_ID: string = "account";
export const CLOUD_ACCOUNT_REGION_PREFIX: string = "region:";
// A resource listed or reporting this recently is live; inventory lists every 30 minutes.
export const CLOUD_ACCOUNT_RESOURCE_STALE_MS: number = 2 * 60 * 60 * 1000;
// An account read this recently is being read.
export const CLOUD_ACCOUNT_STALE_MS: number = 60 * 60 * 1000;

// The kinds that make a resource another's parent, the first found winning.
const PARENT_KINDS: ReadonlyArray<CloudRelationshipKind> = [
  CloudRelationshipKind.RunsIn,
  CloudRelationshipKind.PartOf,
];

export interface CloudAccountTopologyResource {
  id: string;
  name: string;
  type: string;
  providerResourceId: string;
  region: string;
  relationships: Array<CloudResourceRelationship>;
  lastSeenAt: Date | null;
  isReporting: boolean;
}

export interface CloudAccountTopologyInput {
  account: {
    id: string;
    name: string;
    provider: string;
    lastSeenAt: Date | null;
  };
  resources: Array<CloudAccountTopologyResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

function text(value: string): ResourceTopologyText {
  return { text: value };
}

export function cloudRegionNodeId(region: string): string {
  return `${CLOUD_ACCOUNT_REGION_PREFIX}${region.trim().toLowerCase()}`;
}

// The kind of a resource's card: its catalog category, or a plain resource.
export function cloudResourceTopologyKind(
  provider: string,
  type: string,
): string {
  const descriptor: CloudResourceTypeDescriptor | null =
    getCloudResourceTypeDescriptor(provider, type);

  return descriptor ? `cloud.${descriptor.category}` : "cloud.resource";
}

/*
 * Each resource's parent among the others, by the link that makes it so:
 * its first RunsIn link, else its first PartOf. A parent that would make a
 * loop is dropped, so the resource sits in its region instead.
 */
export function getCloudResourceParents(
  links: Array<CloudResourceLink>,
): Map<string, CloudResourceLink> {
  const parents: Map<string, CloudResourceLink> = new Map<
    string,
    CloudResourceLink
  >();

  for (const kind of PARENT_KINDS) {
    for (const link of links) {
      if (link.kind === kind && !parents.has(link.fromId)) {
        parents.set(link.fromId, link);
      }
    }
  }

  // Cut every loop where it closes.
  const settled: Set<string> = new Set<string>();

  for (const start of Array.from(parents.keys())) {
    const onPath: Set<string> = new Set<string>();
    let cursor: string | undefined = start;

    while (cursor && !settled.has(cursor)) {
      if (onPath.has(cursor)) {
        parents.delete(cursor);
        break;
      }

      onPath.add(cursor);
      cursor = parents.get(cursor)?.toId;
    }

    for (const id of onPath) {
      settled.add(id);
    }
  }

  return parents;
}

export function buildCloudAccountTopology(
  input: CloudAccountTopologyInput,
): ResourceTopologyGraph {
  const provider: string = input.account.provider;
  const isRead: boolean = isRecent(
    input.account.lastSeenAt,
    input.now,
    CLOUD_ACCOUNT_STALE_MS,
  );

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: CLOUD_ACCOUNT_ROOT_ID,
      parentId: null,
      kind: "cloud.account",
      name: input.account.name || translationKey("Cloud Account"),
      health: isRead
        ? "healthy"
        : input.account.lastSeenAt
          ? "warning"
          : "unknown",
      status: isRead
        ? text(translationKey("Reading"))
        : input.account.lastSeenAt
          ? text(translationKey("Not read lately"))
          : text(translationKey("No data yet")),
      link: { page: PageMap.CLOUD_ACCOUNT_VIEW, modelId: input.account.id },
    },
  ];

  const linked: Array<CloudLinkedResource> = input.resources.map(
    (resource: CloudAccountTopologyResource): CloudLinkedResource => {
      return {
        id: new ObjectID(resource.id),
        name: resource.name,
        providerResourceId: resource.providerResourceId,
        type: resource.type,
        relationships: resource.relationships,
      };
    },
  );
  const links: Array<CloudResourceLink> = getCloudResourceLinks(linked);
  const parents: Map<string, CloudResourceLink> =
    getCloudResourceParents(links);
  const regions: Set<string> = new Set<string>();
  const resourceIds: Set<string> = new Set<string>();

  for (const resource of input.resources) {
    resourceIds.add(resource.id);
  }

  for (const resource of input.resources) {
    const region: string = resource.region.trim();
    const regionId: string | null = region ? cloudRegionNodeId(region) : null;

    if (region && regionId && !regions.has(regionId)) {
      regions.add(regionId);
      nodes.push({
        id: regionId,
        parentId: CLOUD_ACCOUNT_ROOT_ID,
        kind: "cloud.region",
        name: region,
        health: "healthy",
        keywords: [region],
      });
    }

    const live: boolean =
      resource.isReporting ||
      isRecent(resource.lastSeenAt, input.now, CLOUD_ACCOUNT_RESOURCE_STALE_MS);
    const health: ResourceTopologyHealth = live ? "healthy" : "unknown";
    const typeLabel: string = getCloudResourceTypeLabel(
      provider,
      resource.type,
    );

    nodes.push({
      id: resource.id,
      parentId:
        parents.get(resource.id)?.toId || regionId || CLOUD_ACCOUNT_ROOT_ID,
      kind: cloudResourceTopologyKind(provider, resource.type),
      name: resource.name || resource.providerResourceId || typeLabel,
      health: health,
      status: live
        ? text(translationKey("Reporting"))
        : text(translationKey("Not reporting")),
      context: typeLabel || undefined,
      keywords: [resource.providerResourceId, resource.type, region].filter(
        (keyword: string): boolean => {
          return Boolean(keyword);
        },
      ),
      link: { page: PageMap.CLOUD_RESOURCE_VIEW, modelId: resource.id },
    });
  }

  // What crosses the tree: every link but the one that makes a part's parent.
  const relations: Array<ResourceTopologyRelation> = [];

  for (const link of links) {
    if (parents.get(link.fromId) === link) {
      continue;
    }

    relations.push({
      from: link.fromId,
      to: link.toId,
      label: CLOUD_RELATIONSHIP_WORDS[link.kind].label,
      inverseLabel: CLOUD_RELATIONSHIP_WORDS[link.kind].inverseLabel,
    });
  }

  return buildResourceTopologyGraph({
    rootId: CLOUD_ACCOUNT_ROOT_ID,
    nodes: nodes,
    relations: relations,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: CLOUD_ACCOUNT_ROOT_ID,
      // On the resource it is linked to; on the account when it names none here.
      locate: (record: OpenIssueRecord): string | null => {
        for (const id of record.relatedIds["cloudResources"] || []) {
          if (resourceIds.has(id)) {
            return id;
          }
        }

        return null;
      },
    }),
    truncations: input.truncations,
  });
}
