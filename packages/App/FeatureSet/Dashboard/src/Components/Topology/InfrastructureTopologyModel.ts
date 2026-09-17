import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  InventoryCategory,
  getInventoryTypeCategory,
} from "../Inventory/InventoryTypeCatalog";
import computeInfraParenting from "./InfrastructureNesting";
import { isEntityActive } from "./TopologyActivity";
import { metaForEntityType } from "./TopologyMeta";
import { nounForType } from "./ServiceMapViewModel";
import { workloadNameForReplica } from "./WorkloadNaming";

/*
 * The Infrastructure view model: "what runs where", as a tree a person can
 * walk from the top down instead of a canvas of every resource at once.
 *
 *   Category (Kubernetes, Hosts & containers, Virtualization, ...)
 *     └ Structural containers (cluster → namespace → deployment, node, host)
 *         └ Replica groups (the 12 pods of one workload, collapsed to one row)
 *             └ Resources
 *
 * Three decisions make a real estate readable here:
 *
 *   - Only resources that reported in the selected range are included by
 *     default (see TopologyActivity) — replaced pods do not linger.
 *   - Siblings that are replicas of one workload are grouped under it, so a
 *     fleet is one row with a count rather than a hundred boxes. That also
 *     rescues telemetry that reports pods as hosts: their names still say
 *     which workload they belong to.
 *   - Services are attached to where they run (and roll up to every
 *     container above), so every level answers "what is running in here".
 */

export type InfrastructureNodeKind = "category" | "resource" | "group";

export interface InfrastructureNode {
  id: string;
  kind: InfrastructureNodeKind;
  name: string;
  /** Entity type of the resource, or of every member of a group. */
  entityType: string | null;
  entity: InventoryItem | null;
  parentId: string | null;
  childIds: Array<string>;
  /** Resources at or below this node (a resource counts itself). */
  resourceCount: number;
  /** Resource counts below this node by entity type (self excluded). */
  countsByType: Map<string, number>;
  /** Services running on this node or anything below it. */
  serviceKeys: Array<string>;
  isActive: boolean;
  lastSeenAt: Date | null;
}

export interface InfrastructureTopologyModel {
  nodes: Map<string, InfrastructureNode>;
  /** Category node ids, in display order. */
  rootIds: Array<string>;
  serviceByKey: Map<string, InventoryItem>;
  resourceCount: number;
  inactiveCount: number;
  groupCount: number;
  /** Infrastructure edges between included resources (not services). */
  relationships: Array<InventoryItemRelationship>;
}

export interface BuildInfrastructureOptions {
  rangeStart?: Date | undefined;
  includeInactive?: boolean | undefined;
  /** Smallest number of replicas worth grouping. */
  minimumGroupSize?: number | undefined;
}

/*
 * Types the Service Map owns. They describe software and its dependencies,
 * not where anything runs, so they never become infrastructure rows.
 */
const APPLICATION_TYPES: Set<string> = new Set<string>([
  EntityType.Service,
  EntityType.ServiceInstance,
  EntityType.TelemetrySdk,
  EntityType.Database,
  EntityType.RemoteService,
  EntityType.Process,
]);

/* Replicas worth collapsing: leaf resources that come in fleets. */
const GROUPABLE_TYPES: Set<string> = new Set<string>([
  EntityType.Host,
  EntityType.KubernetesPod,
  EntityType.Container,
  EntityType.DockerSwarmTask,
  EntityType.ProxmoxGuest,
  EntityType.VMwareVirtualMachine,
]);

const PLACEMENT_RELATIONSHIPS: Set<string> = new Set<string>([
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.HostedOn,
]);

export interface InfrastructureCategory {
  id: string;
  name: string;
}

const CATEGORY_BY_INVENTORY_CATEGORY: Record<
  InventoryCategory,
  InfrastructureCategory
> = {
  [InventoryCategory.Kubernetes]: {
    id: "category:kubernetes",
    name: "Kubernetes",
  },
  [InventoryCategory.Compute]: {
    id: "category:compute",
    name: "Hosts & containers",
  },
  [InventoryCategory.Clusters]: {
    id: "category:virtualization",
    name: "Virtualization & clusters",
  },
  [InventoryCategory.Cloud]: { id: "category:cloud", name: "Cloud" },
  [InventoryCategory.Network]: {
    id: "category:network",
    name: "Network & devices",
  },
  [InventoryCategory.External]: {
    id: "category:external",
    name: "External",
  },
  [InventoryCategory.Applications]: {
    id: "category:applications",
    name: "Applications",
  },
};

const OTHER_CATEGORY: InfrastructureCategory = {
  id: "category:other",
  name: "Other",
};

const CATEGORY_ORDER: Array<string> = [
  "category:kubernetes",
  "category:compute",
  "category:virtualization",
  "category:cloud",
  "category:applications",
  "category:network",
  "category:external",
  "category:other",
];

export function categoryForType(entityType: string): InfrastructureCategory {
  const category: InventoryCategory | null =
    getInventoryTypeCategory(entityType);
  return category ? CATEGORY_BY_INVENTORY_CATEGORY[category] : OTHER_CATEGORY;
}

export function isInfrastructureType(entityType: string | undefined): boolean {
  return Boolean(entityType) && !APPLICATION_TYPES.has(entityType!);
}

function byName(
  nodes: Map<string, InfrastructureNode>,
): (a: string, b: string) => number {
  return (a: string, b: string): number => {
    const left: InfrastructureNode = nodes.get(a)!;
    const right: InfrastructureNode = nodes.get(b)!;
    const kindRank: (node: InfrastructureNode) => number = (
      node: InfrastructureNode,
    ): number => {
      // Containers and groups before plain resources.
      return node.childIds.length > 0 ? 0 : 1;
    };
    return (
      kindRank(left) - kindRank(right) ||
      // With inactive resources shown, what is running still reads first.
      Number(right.isActive) - Number(left.isActive) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  };
}

export function buildInfrastructureTopologyModel(
  entities: Array<InventoryItem>,
  relationships: Array<InventoryItemRelationship>,
  options: BuildInfrastructureOptions = {},
): InfrastructureTopologyModel {
  const minimumGroupSize: number = Math.max(2, options.minimumGroupSize || 2);
  const nodes: Map<string, InfrastructureNode> = new Map<
    string,
    InfrastructureNode
  >();
  const serviceByKey: Map<string, InventoryItem> = new Map<
    string,
    InventoryItem
  >();
  let inactiveCount: number = 0;

  for (const entity of entities) {
    if (!entity.entityKey) {
      continue;
    }
    if (entity.entityType === EntityType.Service) {
      serviceByKey.set(entity.entityKey, entity);
      continue;
    }
    if (!isInfrastructureType(entity.entityType)) {
      continue;
    }
    const active: boolean =
      !options.rangeStart || isEntityActive(entity, options.rangeStart);
    if (!active && !options.includeInactive) {
      inactiveCount++;
      continue;
    }
    nodes.set(entity.entityKey, {
      id: entity.entityKey,
      kind: "resource",
      name: entity.displayName || "Unnamed resource",
      entityType: entity.entityType || null,
      entity,
      parentId: null,
      childIds: [],
      resourceCount: 1,
      countsByType: new Map<string, number>(),
      serviceKeys: [],
      isActive: active,
      lastSeenAt: entity.lastSeenAt ? new Date(entity.lastSeenAt) : null,
    });
  }

  const infraRelationships: Array<InventoryItemRelationship> =
    relationships.filter((edge: InventoryItemRelationship): boolean => {
      return (
        edge.relationshipType !== EntityRelationshipType.DependsOn &&
        Boolean(edge.fromEntityKey && nodes.has(edge.fromEntityKey)) &&
        Boolean(edge.toEntityKey && nodes.has(edge.toEntityKey)) &&
        edge.fromEntityKey !== edge.toEntityKey
      );
    });

  // Structural containment only — services are attached separately below.
  const typeByKey: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();
  for (const node of nodes.values()) {
    typeByKey.set(node.id, node.entityType || undefined);
  }
  const { parentOf } = computeInfraParenting(
    infraRelationships.map((edge: InventoryItemRelationship) => {
      return {
        fromEntityKey: edge.fromEntityKey!,
        toEntityKey: edge.toEntityKey!,
        relationshipType: edge.relationshipType || "",
      };
    }),
    typeByKey,
  );
  for (const [child, parent] of Array.from(parentOf.entries())) {
    let cursor: string | undefined = parent;
    const seen: Set<string> = new Set<string>([child]);
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.delete(child);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  for (const [child, parent] of parentOf) {
    if (nodes.has(parent)) {
      nodes.get(child)!.parentId = parent;
      nodes.get(parent)!.childIds.push(child);
    }
  }

  // Categories hold every parentless resource.
  const categories: Map<string, InfrastructureNode> = new Map<
    string,
    InfrastructureNode
  >();
  for (const node of Array.from(nodes.values())) {
    if (node.parentId) {
      continue;
    }
    const category: InfrastructureCategory = categoryForType(
      node.entityType || "",
    );
    let categoryNode: InfrastructureNode | undefined = categories.get(
      category.id,
    );
    if (!categoryNode) {
      categoryNode = {
        id: category.id,
        kind: "category",
        name: category.name,
        entityType: null,
        entity: null,
        parentId: null,
        childIds: [],
        resourceCount: 0,
        countsByType: new Map<string, number>(),
        serviceKeys: [],
        isActive: false,
        lastSeenAt: null,
      };
      categories.set(category.id, categoryNode);
    }
    node.parentId = category.id;
    categoryNode.childIds.push(node.id);
  }
  for (const category of categories.values()) {
    nodes.set(category.id, category);
  }

  // Collapse replicas of one workload under a group, parent by parent.
  let groupCount: number = 0;
  for (const parent of Array.from(nodes.values())) {
    if (parent.childIds.length < minimumGroupSize) {
      continue;
    }
    /*
     * A deployment's children already ARE its replicas; grouping them again
     * would only add a level that says the same thing.
     */
    if (parent.entityType === EntityType.KubernetesDeployment) {
      continue;
    }
    const buckets: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    for (const childId of parent.childIds) {
      const child: InfrastructureNode = nodes.get(childId)!;
      if (
        child.kind !== "resource" ||
        child.childIds.length > 0 ||
        !GROUPABLE_TYPES.has(child.entityType || "")
      ) {
        continue;
      }
      const workload: string | null = workloadNameForReplica(child.name);
      if (!workload) {
        continue;
      }
      const bucketKey: string = `${child.entityType}|${workload}`;
      buckets.set(bucketKey, [...(buckets.get(bucketKey) || []), childId]);
    }
    for (const [bucketKey, memberIds] of buckets) {
      if (memberIds.length < minimumGroupSize) {
        continue;
      }
      const separator: number = bucketKey.indexOf("|");
      const entityType: string = bucketKey.substring(0, separator);
      const workload: string = bucketKey.substring(separator + 1);
      const groupId: string = `group:${parent.id}:${bucketKey}`;
      nodes.set(groupId, {
        id: groupId,
        kind: "group",
        name: workload,
        entityType,
        entity: null,
        parentId: parent.id,
        childIds: memberIds,
        resourceCount: 0,
        countsByType: new Map<string, number>(),
        serviceKeys: [],
        isActive: false,
        lastSeenAt: null,
      });
      for (const memberId of memberIds) {
        nodes.get(memberId)!.parentId = groupId;
      }
      const members: Set<string> = new Set<string>(memberIds);
      parent.childIds = [
        ...parent.childIds.filter((id: string): boolean => {
          return !members.has(id);
        }),
        groupId,
      ];
      groupCount++;
    }
  }

  // Attach services where they run.
  const serviceKeysByNode: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  for (const edge of relationships) {
    if (
      !PLACEMENT_RELATIONSHIPS.has(edge.relationshipType || "") ||
      !serviceByKey.has(edge.fromEntityKey || "") ||
      !nodes.has(edge.toEntityKey || "")
    ) {
      continue;
    }
    let cursor: string | null = edge.toEntityKey!;
    const guard: Set<string> = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const set: Set<string> =
        serviceKeysByNode.get(cursor) || new Set<string>();
      set.add(edge.fromEntityKey!);
      serviceKeysByNode.set(cursor, set);
      cursor = nodes.get(cursor)?.parentId || null;
    }
  }

  // Roll counts, activity and recency up from the leaves.
  const visited: Set<string> = new Set<string>();
  const rollUp: (id: string) => void = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const node: InfrastructureNode = nodes.get(id)!;
    for (const childId of node.childIds) {
      rollUp(childId);
      const child: InfrastructureNode = nodes.get(childId)!;
      node.resourceCount += child.resourceCount;
      if (child.kind === "resource" && child.entityType) {
        node.countsByType.set(
          child.entityType,
          (node.countsByType.get(child.entityType) || 0) + 1,
        );
      }
      for (const [type, count] of child.countsByType) {
        node.countsByType.set(type, (node.countsByType.get(type) || 0) + count);
      }
      node.isActive = node.isActive || child.isActive;
      if (
        child.lastSeenAt &&
        (!node.lastSeenAt || child.lastSeenAt > node.lastSeenAt)
      ) {
        node.lastSeenAt = child.lastSeenAt;
      }
    }
    node.childIds.sort(byName(nodes));
    node.serviceKeys = Array.from(serviceKeysByNode.get(id) || []).sort(
      (a: string, b: string): number => {
        return (serviceByKey.get(a)?.displayName || a).localeCompare(
          serviceByKey.get(b)?.displayName || b,
        );
      },
    );
  };

  const rootIds: Array<string> = CATEGORY_ORDER.filter((id: string) => {
    return nodes.has(id);
  });
  for (const rootId of rootIds) {
    rollUp(rootId);
  }

  let resourceCount: number = 0;
  for (const node of nodes.values()) {
    if (node.kind === "resource") {
      resourceCount++;
    }
  }

  return {
    nodes,
    rootIds,
    serviceByKey,
    resourceCount,
    inactiveCount,
    groupCount,
    relationships: infraRelationships,
  };
}

/** Root-to-node path, excluding nothing. */
export function getInfrastructurePath(
  model: InfrastructureTopologyModel,
  id: string | null,
): Array<InfrastructureNode> {
  const path: Array<InfrastructureNode> = [];
  const seen: Set<string> = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node: InfrastructureNode | undefined = model.nodes.get(cursor);
    if (!node) {
      break;
    }
    path.unshift(node);
    cursor = node.parentId;
  }
  return path;
}

/** Every resource below a node (groups and categories excluded). */
export function getInfrastructureResourcesBelow(
  model: InfrastructureTopologyModel,
  id: string,
): Array<InfrastructureNode> {
  const out: Array<InfrastructureNode> = [];
  const queue: Array<string> = [...(model.nodes.get(id)?.childIds || [])];
  const seen: Set<string> = new Set<string>();
  while (queue.length > 0) {
    const current: string = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const node: InfrastructureNode | undefined = model.nodes.get(current);
    if (!node) {
      continue;
    }
    if (node.kind === "resource") {
      out.push(node);
    }
    queue.push(...node.childIds);
  }
  return out;
}

/**
 * Search across every resource and group. Each whitespace-separated term must
 * appear in the name, the type label, or the name of a service running there.
 */
export function searchInfrastructure(
  model: InfrastructureTopologyModel,
  query: string,
): Array<InfrastructureNode> {
  const terms: Array<string> = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) {
    return [];
  }
  return Array.from(model.nodes.values())
    .filter((node: InfrastructureNode): boolean => {
      if (node.kind === "category") {
        return false;
      }
      const services: string = node.serviceKeys
        .map((key: string): string => {
          return model.serviceByKey.get(key)?.displayName || "";
        })
        .join(" ");
      const haystack: string =
        `${node.name} ${describeInfrastructureNode(node)} ${services}`.toLowerCase();
      return terms.every((term: string): boolean => {
        return haystack.includes(term);
      });
    })
    .sort((a: InfrastructureNode, b: InfrastructureNode): number => {
      return (
        Number(a.kind === "resource") - Number(b.kind === "resource") ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    });
}

/** "Kubernetes Pod", "12 pods", "3 namespaces · 48 pods". */
export function describeInfrastructureNode(node: InfrastructureNode): string {
  if (node.kind === "resource") {
    return metaForEntityType(node.entityType || undefined).label;
  }
  if (node.kind === "group") {
    return `${node.childIds.length} ${nounForType(node.entityType || "", node.childIds.length)}`;
  }
  return summarizeCounts(node.countsByType) || "Empty";
}

export function summarizeCounts(
  counts: Map<string, number>,
  limit: number = 3,
): string {
  return Array.from(counts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([type, count]: [string, number]): string => {
      return `${count} ${nounForType(type, count)}`;
    })
    .join(" · ");
}

/*
 * Grouping levels a map looks straight through. A cluster, a namespace or a
 * vCenter is a place, not a thing that runs anything, so drawing it as a
 * single card ("oneuptime-prod · 55 resources") answers nothing. The map
 * draws the first level below them that does: workloads (deployments, swarm
 * services, replica groups) and machines (nodes, hosts, VMs, devices).
 */
const PASS_THROUGH_TYPES: Set<string> = new Set<string>([
  EntityType.KubernetesCluster,
  EntityType.KubernetesNamespace,
  EntityType.ProxmoxCluster,
  EntityType.VMwareVCenter,
  EntityType.VMwareCluster,
  EntityType.CephCluster,
  EntityType.DockerSwarmCluster,
]);

/**
 * The cards a map of `scopeId` (null = everything) should draw, in tree
 * order: everything below the scope, looking through pure grouping levels
 * but never into a workload or machine.
 */
export function collectMapCards(
  model: InfrastructureTopologyModel,
  scopeId: string | null,
): Array<string> {
  const start: Array<string> = scopeId
    ? model.nodes.get(scopeId)?.childIds || []
    : [...model.rootIds];
  const cards: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  const visit: (id: string) => void = (id: string): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const node: InfrastructureNode | undefined = model.nodes.get(id);
    if (!node) {
      return;
    }
    const passThrough: boolean =
      node.kind === "category" ||
      (node.kind === "resource" &&
        node.childIds.length > 0 &&
        PASS_THROUGH_TYPES.has(node.entityType || ""));
    if (passThrough) {
      for (const childId of node.childIds) {
        visit(childId);
      }
      return;
    }
    cards.push(id);
  };
  for (const id of start) {
    visit(id);
  }
  return cards;
}
