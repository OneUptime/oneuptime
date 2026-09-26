import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  PLACEMENT_RELATIONSHIP_TYPES,
  REPLICA_GROUPABLE_TYPES,
  isTopologyInfrastructureType,
} from "Common/Types/Topology/TopologyTypeRules";
import {
  InventoryCategory,
  getInventoryTypeCategory,
  getInventoryTypeDescriptor,
} from "../Inventory/InventoryTypeCatalog";
import computeInfraParenting from "./InfrastructureNesting";
import { isEntityActive } from "./TopologyActivity";
import {
  InfrastructureCollection,
  TopologyEntity,
  TopologyRelationship,
} from "./TopologyData";
import {
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  TrafficHealth,
  healthForErrorRate,
  metaForEntityType,
} from "./TopologyMeta";
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
 *     └ Collections (a flat type too large to ship row by row, e.g. 40,000
 *       IoT devices: one node with exact counts, rows paged from the server)
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
 *   - Calls between those services are kept too, so a map can draw the
 *     traffic between the resources they run on (computeInfrastructureTraffic).
 *
 * The model is built from the Topology API's view-shaped rows (at most two
 * containment relationships per resource, chosen by the server with the same
 * nesting rules), and has to stay fast at that API's caps — a hundred
 * thousand resources — so every pass here is linear or n log n.
 */

export type InfrastructureNodeKind =
  | "category"
  | "resource"
  | "group"
  | "collection";

export interface InfrastructureNode {
  id: string;
  kind: InfrastructureNodeKind;
  name: string;
  /** Entity type of the resource, of every member of a group, or of a collection. */
  entityType: string | null;
  entity: TopologyEntity | null;
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
  serviceByKey: Map<string, TopologyEntity>;
  /** Resources shown, collections' items included. */
  resourceCount: number;
  inactiveCount: number;
  groupCount: number;
  /** Infrastructure edges between included resources (not services). */
  relationships: Array<TopologyRelationship>;
  /*
   * In-range calls between two services that both run on something in this
   * model (`depends-on`), ordered by (caller, callee) key. Traffic is only
   * ever measured per service pair, so this is what every line a map draws
   * between two resources is made of.
   */
  serviceCalls: Array<InfrastructureServiceCall>;
}

/** One service calling another, with the traffic of the latest window. */
export interface InfrastructureServiceCall {
  from: string;
  to: string;
  calls: number;
  errors: number;
  /** Call-weighted average, or null when the call reported no duration. */
  avgDurationMs: number | null;
}

export interface BuildInfrastructureOptions {
  rangeStart?: Date | undefined;
  includeInactive?: boolean | undefined;
  /** Smallest number of replicas worth grouping. */
  minimumGroupSize?: number | undefined;
  /* Flat types the server summarized instead of listing (see TopologyApi). */
  collections?: Array<InfrastructureCollection> | undefined;
}

export const COLLECTION_ID_PREFIX: string = "collection:";

export function collectionNodeId(entityType: string): string {
  return `${COLLECTION_ID_PREFIX}${entityType}`;
}

/*
 * A node that holds other things: it opens as a scope, appears in the tree
 * and says what it contains. A collection holds its items even though they
 * are not in the model — they are paged from the server when it is opened.
 */
export function isContainerNode(node: InfrastructureNode): boolean {
  return node.childIds.length > 0 || node.kind === "collection";
}

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

/*
 * One collator for every name comparison. `a.localeCompare(b)` with no
 * locale argument orders exactly like this, but builds its collation state
 * on every call, which is what made sorting a hundred thousand names slow.
 */
const NAME_COLLATOR: Intl.Collator = new Intl.Collator();

export function compareNames(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b);
}

/*
 * Code-unit order: the final, locale-free tie-break for orders only this page
 * makes. (Where the server's choice must be matched — which container a
 * resource nests in — InfrastructureNesting compares code points, as
 * COLLATE "C" does; the two differ only beyond U+FFFF.)
 */
function compareKeys(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function categoryForType(entityType: string): InfrastructureCategory {
  const category: InventoryCategory | null =
    getInventoryTypeCategory(entityType);
  return category ? CATEGORY_BY_INVENTORY_CATEGORY[category] : OTHER_CATEGORY;
}

export function isInfrastructureType(
  entityType: string | undefined | null,
): boolean {
  return isTopologyInfrastructureType(entityType);
}

/*
 * What a collection is called: the Inventory's plural label ("IoT Devices",
 * "Network Devices"), which names the type unambiguously where the short
 * nouns used in counts ("devices") would not. A type this build does not
 * know keeps its raw name, as it does everywhere else in Inventory.
 */
export function collectionName(entityType: string): string {
  return getInventoryTypeDescriptor(entityType)?.pluralLabel || entityType;
}

function kindRank(node: InfrastructureNode): number {
  // Containers, groups and collections before plain resources.
  return isContainerNode(node) ? 0 : 1;
}

function byName(
  nodes: Map<string, InfrastructureNode>,
): (a: string, b: string) => number {
  return (a: string, b: string): number => {
    const left: InfrastructureNode = nodes.get(a)!;
    const right: InfrastructureNode = nodes.get(b)!;
    return (
      kindRank(left) - kindRank(right) ||
      // With inactive resources shown, what is running still reads first.
      Number(right.isActive) - Number(left.isActive) ||
      compareNames(left.name, right.name) ||
      compareKeys(left.id, right.id)
    );
  };
}

/*
 * Breaks containment cycles so the tree is a tree. Each cycle is cut at its
 * member with the smallest key (code-unit order), which is exactly what
 * walking the children in key order and cutting the one whose walk returns to
 * itself produces — so the result never depends on the order relationships
 * arrived in. A resource that merely leads INTO a cycle keeps its parent.
 *
 * Linear: a walk stops at the first resource already known to reach a root.
 */
export function breakContainmentCycles(parentOf: Map<string, string>): void {
  const resolved: Set<string> = new Set<string>();
  const children: Array<string> = Array.from(parentOf.keys()).sort(compareKeys);
  for (const child of children) {
    if (resolved.has(child)) {
      continue;
    }
    const walk: Array<string> = [];
    const onWalk: Set<string> = new Set<string>();
    let cursor: string | undefined = child;
    while (cursor !== undefined && !resolved.has(cursor)) {
      if (onWalk.has(cursor)) {
        /*
         * `cursor` starts a cycle that no earlier walk cut: cut it at its
         * smallest member. The walk from that member returns to it first.
         */
        const cycleStart: number = walk.indexOf(cursor);
        let smallest: string = cursor;
        for (let index: number = cycleStart; index < walk.length; index++) {
          if (compareKeys(walk[index]!, smallest) < 0) {
            smallest = walk[index]!;
          }
        }
        parentOf.delete(smallest);
        break;
      }
      onWalk.add(cursor);
      walk.push(cursor);
      cursor = parentOf.get(cursor);
    }
    // Everything walked now reaches a root (the cut, if any, made one).
    for (const key of walk) {
      resolved.add(key);
    }
  }
}

export function buildInfrastructureTopologyModel(
  entities: Array<TopologyEntity>,
  relationships: Array<TopologyRelationship>,
  options: BuildInfrastructureOptions = {},
): InfrastructureTopologyModel {
  const minimumGroupSize: number = Math.max(2, options.minimumGroupSize || 2);
  const nodes: Map<string, InfrastructureNode> = new Map<
    string,
    InfrastructureNode
  >();
  const serviceByKey: Map<string, TopologyEntity> = new Map<
    string,
    TopologyEntity
  >();
  let inactiveCount: number = 0;

  /*
   * A collected type's items are counted by its collection; a stray row of
   * that type must not be counted a second time.
   */
  const collectedTypes: Set<string> = new Set<string>(
    (options.collections || []).map(
      (collection: InfrastructureCollection): string => {
        return collection.entityType;
      },
    ),
  );

  for (const entity of entities) {
    if (!entity.entityKey) {
      continue;
    }
    if (entity.entityType === EntityType.Service) {
      serviceByKey.set(entity.entityKey, entity);
      continue;
    }
    if (
      !isInfrastructureType(entity.entityType) ||
      collectedTypes.has(entity.entityType || "")
    ) {
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

  const infraRelationships: Array<TopologyRelationship> = relationships.filter(
    (edge: TopologyRelationship): boolean => {
      return (
        edge.relationshipType !== EntityRelationshipType.DependsOn &&
        Boolean(edge.fromEntityKey && nodes.has(edge.fromEntityKey)) &&
        Boolean(edge.toEntityKey && nodes.has(edge.toEntityKey)) &&
        edge.fromEntityKey !== edge.toEntityKey
      );
    },
  );

  // Structural containment only — services are attached separately below.
  const typeByKey: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();
  for (const node of nodes.values()) {
    typeByKey.set(node.id, node.entityType || undefined);
  }
  const { parentOf } = computeInfraParenting(
    infraRelationships.map((edge: TopologyRelationship) => {
      return {
        fromEntityKey: edge.fromEntityKey!,
        toEntityKey: edge.toEntityKey!,
        relationshipType: edge.relationshipType || "",
      };
    }),
    typeByKey,
  );
  breakContainmentCycles(parentOf);
  for (const [child, parent] of parentOf) {
    if (nodes.has(parent)) {
      nodes.get(child)!.parentId = parent;
      nodes.get(parent)!.childIds.push(child);
    }
  }

  // Categories hold every parentless resource, and every collection.
  const categories: Map<string, InfrastructureNode> = new Map<
    string,
    InfrastructureNode
  >();
  const categoryFor: (entityType: string) => InfrastructureNode = (
    entityType: string,
  ): InfrastructureNode => {
    const category: InfrastructureCategory = categoryForType(entityType);
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
    return categoryNode;
  };
  for (const node of Array.from(nodes.values())) {
    if (node.parentId) {
      continue;
    }
    const categoryNode: InfrastructureNode = categoryFor(node.entityType || "");
    node.parentId = categoryNode.id;
    categoryNode.childIds.push(node.id);
  }

  /*
   * A collection counts what the page shows: every item with inactive
   * resources included, the ones that reported otherwise. One whose items
   * are all hidden is left out and counted as hidden, like any resource.
   */
  const collectionNodes: Array<InfrastructureNode> = [];
  for (const collection of options.collections || []) {
    const shown: number = options.includeInactive
      ? collection.total
      : collection.active;
    if (!options.includeInactive) {
      inactiveCount += Math.max(0, collection.total - collection.active);
    }
    if (shown <= 0) {
      continue;
    }
    const categoryNode: InfrastructureNode = categoryFor(collection.entityType);
    const lastSeenAt: Date | null = options.includeInactive
      ? collection.lastSeenAt
      : collection.activeLastSeenAt;
    const node: InfrastructureNode = {
      id: collectionNodeId(collection.entityType),
      kind: "collection",
      name: collectionName(collection.entityType),
      entityType: collection.entityType,
      entity: null,
      parentId: categoryNode.id,
      childIds: [],
      resourceCount: shown,
      countsByType: new Map<string, number>([[collection.entityType, shown]]),
      serviceKeys: [],
      isActive: collection.active > 0,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : null,
    };
    collectionNodes.push(node);
    categoryNode.childIds.push(node.id);
  }
  for (const node of collectionNodes) {
    nodes.set(node.id, node);
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
        !REPLICA_GROUPABLE_TYPES.has(child.entityType || "")
      ) {
        continue;
      }
      const workload: string | null = workloadNameForReplica(child.name);
      if (!workload) {
        continue;
      }
      const bucketKey: string = `${child.entityType}|${workload}`;
      const bucket: Array<string> | undefined = buckets.get(bucketKey);
      if (bucket) {
        bucket.push(childId);
      } else {
        buckets.set(bucketKey, [childId]);
      }
    }
    /*
     * The parent's child list is rebuilt once, after every bucket is known:
     * filtering it once per group made a parent with thousands of children
     * and hundreds of workloads quadratic.
     */
    const grouped: Set<string> = new Set<string>();
    const groupIds: Array<string> = [];
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
        grouped.add(memberId);
      }
      groupIds.push(groupId);
      groupCount++;
    }
    if (groupIds.length > 0) {
      parent.childIds = [
        ...parent.childIds.filter((id: string): boolean => {
          return !grouped.has(id);
        }),
        ...groupIds,
      ];
    }
  }

  // Attach services where they run.
  const serviceKeysByNode: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  for (const edge of relationships) {
    if (
      !PLACEMENT_RELATIONSHIP_TYPES.has(edge.relationshipType || "") ||
      !serviceByKey.has(edge.fromEntityKey || "") ||
      !nodes.has(edge.toEntityKey || "")
    ) {
      continue;
    }
    let cursor: string | null = edge.toEntityKey!;
    const guard: Set<string> = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      let set: Set<string> | undefined = serviceKeysByNode.get(cursor);
      if (!set) {
        set = new Set<string>();
        serviceKeysByNode.set(cursor, set);
      }
      /*
       * Every walk goes all the way up, so a node that already lists this
       * service has every ancestor listing it too.
       */
      if (set.has(edge.fromEntityKey!)) {
        break;
      }
      set.add(edge.fromEntityKey!);
      cursor = nodes.get(cursor)?.parentId || null;
    }
  }

  /*
   * Calls between placed services. A service that runs on nothing here has
   * no resource to draw its calls from or to, so its calls are left out —
   * which is also exactly what the Topology API ships (calls between
   * services placed on a shipped resource), so the reduced payload and the
   * whole inventory keep the same calls.
   */
  const placedServiceKeys: Set<string> = new Set<string>();
  for (const keys of serviceKeysByNode.values()) {
    for (const key of keys) {
      placedServiceKeys.add(key);
    }
  }
  const serviceCalls: Array<InfrastructureServiceCall> = [];
  const seenCalls: Set<string> = new Set<string>();
  for (const edge of relationships) {
    if (edge.relationshipType !== EntityRelationshipType.DependsOn) {
      continue;
    }
    const from: string = edge.fromEntityKey || "";
    const to: string = edge.toEntityKey || "";
    if (
      from === to ||
      !placedServiceKeys.has(from) ||
      !placedServiceKeys.has(to)
    ) {
      continue;
    }
    const callId: string = `${from}\u0000${to}`;
    if (seenCalls.has(callId)) {
      continue;
    }
    seenCalls.add(callId);
    serviceCalls.push({
      from,
      to,
      calls: Math.max(0, edge.callCount || 0),
      errors: Math.max(0, edge.errorCount || 0),
      avgDurationMs:
        typeof edge.avgDurationMs === "number" && edge.avgDurationMs >= 0
          ? edge.avgDurationMs
          : null,
    });
  }
  serviceCalls.sort(
    (left: InfrastructureServiceCall, right: InfrastructureServiceCall) => {
      return (
        compareKeys(left.from, right.from) || compareKeys(left.to, right.to)
      );
    },
  );

  const byServiceName: (a: string, b: string) => number = (
    a: string,
    b: string,
  ): number => {
    return (
      compareNames(
        serviceByKey.get(a)?.displayName || a,
        serviceByKey.get(b)?.displayName || b,
      ) || compareKeys(a, b)
    );
  };

  /*
   * Roll counts, activity and recency up from the leaves. Iterative (children
   * are finished before their parent), so an adversarially deep containment
   * chain cannot overflow the stack.
   */
  const rootIds: Array<string> = CATEGORY_ORDER.filter((id: string) => {
    return nodes.has(id);
  });
  const entered: Set<string> = new Set<string>();
  const finish: (node: InfrastructureNode) => void = (
    node: InfrastructureNode,
  ): void => {
    for (const childId of node.childIds) {
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
    const services: Set<string> | undefined = serviceKeysByNode.get(node.id);
    node.serviceKeys = services ? Array.from(services).sort(byServiceName) : [];
  };
  for (const rootId of rootIds) {
    const stack: Array<{ id: string; expanded: boolean }> = [
      { id: rootId, expanded: false },
    ];
    entered.add(rootId);
    while (stack.length > 0) {
      const top: { id: string; expanded: boolean } = stack[stack.length - 1]!;
      if (top.expanded) {
        stack.pop();
        finish(nodes.get(top.id)!);
        continue;
      }
      top.expanded = true;
      for (const childId of nodes.get(top.id)!.childIds) {
        if (!entered.has(childId)) {
          entered.add(childId);
          stack.push({ id: childId, expanded: false });
        }
      }
    }
  }

  let resourceCount: number = 0;
  for (const node of nodes.values()) {
    if (node.kind === "resource") {
      resourceCount++;
    } else if (node.kind === "collection") {
      resourceCount += node.resourceCount;
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
    serviceCalls,
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
    path.push(node);
    cursor = node.parentId;
  }
  return path.reverse();
}

/** Every resource below a node (groups, categories and collections excluded). */
export function getInfrastructureResourcesBelow(
  model: InfrastructureTopologyModel,
  id: string,
): Array<InfrastructureNode> {
  const out: Array<InfrastructureNode> = [];
  const queue: Array<string> = [...(model.nodes.get(id)?.childIds || [])];
  const seen: Set<string> = new Set<string>();
  for (let index: number = 0; index < queue.length; index++) {
    const current: string = queue[index]!;
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
    for (const childId of node.childIds) {
      queue.push(childId);
    }
  }
  return out;
}

/** A query as every search in this view reads it: lowercase, whitespace-split. */
export function infrastructureSearchTerms(query: string): Array<string> {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export interface InfrastructureSearchEntry {
  id: string;
  /** Name, type description and the services running there, lowercased. */
  haystack: string;
}

/*
 * Everything search needs, computed once per model rather than per
 * keystroke: the lowercased text each node is matched against, already in
 * result order (groups and containers first, then by name).
 *
 * Categories are not results, and neither are collections: their items are
 * not in the model, so the page asks the server how many of them match.
 */
export type InfrastructureSearchIndex = Array<InfrastructureSearchEntry>;

export function buildInfrastructureSearchIndex(
  model: InfrastructureTopologyModel,
): InfrastructureSearchIndex {
  const searchable: Array<InfrastructureNode> = [];
  for (const node of model.nodes.values()) {
    if (node.kind !== "category" && node.kind !== "collection") {
      searchable.push(node);
    }
  }
  searchable.sort((a: InfrastructureNode, b: InfrastructureNode): number => {
    return (
      Number(a.kind === "resource") - Number(b.kind === "resource") ||
      compareNames(a.name, b.name) ||
      compareKeys(a.id, b.id)
    );
  });
  return searchable.map(
    (node: InfrastructureNode): InfrastructureSearchEntry => {
      const services: string = node.serviceKeys
        .map((key: string): string => {
          return model.serviceByKey.get(key)?.displayName || "";
        })
        .join(" ");
      return {
        id: node.id,
        haystack:
          `${node.name} ${describeInfrastructureNode(node)} ${services}`.toLowerCase(),
      };
    },
  );
}

/**
 * Search across every resource and group. Each whitespace-separated term must
 * appear in the name, the type label, or the name of a service running there.
 */
export function searchInfrastructure(
  model: InfrastructureTopologyModel,
  query: string,
  index?: InfrastructureSearchIndex | undefined,
): Array<InfrastructureNode> {
  const terms: Array<string> = infrastructureSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const entries: InfrastructureSearchIndex =
    index || buildInfrastructureSearchIndex(model);
  const results: Array<InfrastructureNode> = [];
  for (const entry of entries) {
    if (
      terms.every((term: string): boolean => {
        return entry.haystack.includes(term);
      })
    ) {
      const node: InfrastructureNode | undefined = model.nodes.get(entry.id);
      if (node) {
        results.push(node);
      }
    }
  }
  return results;
}

/*
 * The terms a collection's items must match by NAME for a search. In-browser
 * search matches a resource when every term appears in its name OR its type
 * label, and every item of a collection shares one label — so the terms the
 * label already satisfies are dropped, and the server matches the rest
 * against display names. An empty result means every item matches.
 */
export function collectionNameTerms(
  entityType: string,
  terms: Array<string>,
): Array<string> {
  const label: string = metaForEntityType(entityType).label.toLowerCase();
  return terms.filter((term: string): boolean => {
    return !label.includes(term);
  });
}

/** "Kubernetes Pod", "12 pods", "3 namespaces · 48 pods", "40,000 IoT devices". */
export function describeInfrastructureNode(node: InfrastructureNode): string {
  if (node.kind === "resource") {
    return metaForEntityType(node.entityType || undefined).label;
  }
  if (node.kind === "group") {
    return `${node.childIds.length.toLocaleString()} ${nounForType(node.entityType || "", node.childIds.length)}`;
  }
  if (node.kind === "collection") {
    return `${node.resourceCount.toLocaleString()} ${nounForType(node.entityType || "", node.resourceCount)}`;
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
      return `${count.toLocaleString()} ${nounForType(type, count)}`;
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
 * but never into a workload, a machine or a collection (which is one card).
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
        isContainerNode(node) &&
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

/** Traffic along one line of a map: from one card to another. */
export interface InfrastructureTrafficLink {
  /* Unique per (from, to); not meant for display. */
  id: string;
  from: string;
  to: string;
  calls: number;
  errors: number;
  /** Call-weighted average, or null when no call reported a duration. */
  avgDurationMs: number | null;
  health: TrafficHealth;
  /** The service calls this line stands for, busiest first. */
  serviceCalls: Array<InfrastructureServiceCall>;
}

export interface InfrastructureTraffic {
  links: Array<InfrastructureTrafficLink>;
  /* MAX_TRAFFIC_PAIRS was reached, so some lines are missing. */
  isPartial: boolean;
}

/*
 * The most (call, pair of cards) combinations one map adds up. Each call is
 * counted once per pair of cards its two services run on, which stays small
 * wherever a card holds a workload or a machine; this only bounds a scope in
 * which hundreds of services run on nearly every card.
 */
export const MAX_TRAFFIC_PAIRS: number = 200_000;

function compareServiceCalls(
  left: InfrastructureServiceCall,
  right: InfrastructureServiceCall,
): number {
  return (
    right.calls - left.calls ||
    compareKeys(left.from, right.from) ||
    compareKeys(left.to, right.to)
  );
}

/**
 * The traffic between the cards a map draws: a line from card X to card Y
 * for every service running on X that calls a service running on Y (as
 * `serviceKeys` says, so a card counts what runs anywhere below it).
 *
 * Calls are only measured per service pair, never per pod or host, so a
 * line carries the whole of each call it stands for, and a call whose two
 * services run on several cards appears on each line between them. Calls
 * between two services on the same card stay inside it and draw nothing.
 */
export function computeInfrastructureTraffic(
  model: InfrastructureTopologyModel,
  cardIds: Array<string>,
  maxPairs: number = MAX_TRAFFIC_PAIRS,
): InfrastructureTraffic {
  const cardsByService: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const seenCards: Set<string> = new Set<string>();
  for (const cardId of cardIds) {
    const node: InfrastructureNode | undefined = model.nodes.get(cardId);
    if (!node || seenCards.has(cardId)) {
      continue;
    }
    seenCards.add(cardId);
    for (const serviceKey of node.serviceKeys) {
      let cards: Array<string> | undefined = cardsByService.get(serviceKey);
      if (!cards) {
        cards = [];
        cardsByService.set(serviceKey, cards);
      }
      cards.push(cardId);
    }
  }

  const links: Map<string, InfrastructureTrafficLink> = new Map<
    string,
    InfrastructureTrafficLink
  >();
  let remaining: number = maxPairs;
  let isPartial: boolean = false;
  for (const call of model.serviceCalls) {
    const fromCards: Array<string> | undefined = cardsByService.get(call.from);
    const toCards: Array<string> | undefined = cardsByService.get(call.to);
    if (!fromCards || !toCards) {
      continue;
    }
    for (const from of fromCards) {
      for (const to of toCards) {
        if (from === to) {
          continue;
        }
        if (remaining <= 0) {
          isPartial = true;
          break;
        }
        remaining--;
        const id: string = `${from}\u0000${to}`;
        let link: InfrastructureTrafficLink | undefined = links.get(id);
        if (!link) {
          link = {
            id,
            from,
            to,
            calls: 0,
            errors: 0,
            avgDurationMs: null,
            health: "unknown",
            serviceCalls: [],
          };
          links.set(id, link);
        }
        /*
         * Durations average by calls, like the Service Map's totals; a call
         * with no count adds the line but no traffic.
         */
        if (call.calls > 0) {
          if (call.avgDurationMs !== null) {
            link.avgDurationMs =
              ((link.avgDurationMs || 0) * link.calls +
                call.avgDurationMs * call.calls) /
              (link.calls + call.calls);
          }
          link.calls += call.calls;
          link.errors += call.errors;
        }
        link.serviceCalls.push(call);
      }
      if (isPartial) {
        break;
      }
    }
    if (isPartial) {
      break;
    }
  }

  const result: Array<InfrastructureTrafficLink> = Array.from(links.values());
  for (const link of result) {
    link.health = healthForErrorRate(
      link.calls,
      link.errors,
      SERVICE_MAP_TOLERATED_ERROR_RATE,
    );
    link.serviceCalls.sort(compareServiceCalls);
  }
  return { links: result, isPartial };
}
