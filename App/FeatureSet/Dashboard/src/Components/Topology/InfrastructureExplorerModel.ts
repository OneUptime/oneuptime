import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import { metaForEntityType } from "./TopologyMeta";
import computeInfraParenting from "./InfrastructureNesting";
import { getInfrastructureGraphNodeKeys } from "./TopologyInventoryData";

export interface InfrastructureResource {
  key: string;
  name: string;
  type: string;
  entity: InventoryItem | undefined;
}

export interface InfrastructureExplorerModel {
  resources: Map<string, InfrastructureResource>;
  relationships: Array<InventoryItemRelationship>;
  parentOf: Map<string, string>;
  childrenOf: Map<string, Array<string>>;
  neighborsOf: Map<string, Set<string>>;
  roots: Array<string>;
  unlinkedCount: number;
}

/** Keep every catalog resource reachable, including isolated and unresolved items. */
export function buildInfrastructureExplorerModel(
  entities: Array<InventoryItem>,
  relationships: Array<InventoryItemRelationship>,
): InfrastructureExplorerModel {
  const seenEdges: Set<string> = new Set<string>();
  const infraEdges: Array<InventoryItemRelationship> = relationships.filter(
    (edge: InventoryItemRelationship): boolean => {
      if (
        edge.relationshipType === EntityRelationshipType.DependsOn ||
        !edge.fromEntityKey ||
        !edge.toEntityKey ||
        edge.fromEntityKey === edge.toEntityKey
      ) {
        return false;
      }
      const id: string = JSON.stringify([
        edge.fromEntityKey,
        edge.relationshipType,
        edge.toEntityKey,
      ]);
      if (seenEdges.has(id)) {
        return false;
      }
      seenEdges.add(id);
      return true;
    },
  );
  const entityByKey: Map<string, InventoryItem> = new Map();
  for (const entity of entities) {
    if (entity.entityKey) {
      entityByKey.set(entity.entityKey, entity);
    }
  }
  const resources: Map<string, InfrastructureResource> = new Map();
  const types: Map<string, string | undefined> = new Map();
  const keys: Array<string> = Array.from(
    getInfrastructureGraphNodeKeys({
      entities,
      infrastructureRelationships: infraEdges,
    }),
  ).sort();
  for (const key of keys) {
    const entity: InventoryItem | undefined = entityByKey.get(key);
    resources.set(key, {
      key,
      name:
        entity?.displayName ||
        (entity ? "Unnamed resource" : `Undiscovered resource · ${key}`),
      type: entity?.entityType || "unknown",
      entity,
    });
    types.set(key, entity?.entityType);
  }
  const { parentOf } = computeInfraParenting(
    infraEdges.map((edge: InventoryItemRelationship) => {
      return {
        fromEntityKey: edge.fromEntityKey!,
        toEntityKey: edge.toEntityKey!,
        relationshipType: edge.relationshipType || "unknown",
      };
    }),
    types,
  );
  // Match the map's deterministic hierarchy sanitization before building breadcrumbs.
  for (const key of keys) {
    const parent: string | undefined = parentOf.get(key);
    if (parent === key || (parent && !resources.has(parent))) {
      parentOf.delete(key);
    }
  }
  for (const key of keys) {
    const seen: Set<string> = new Set([key]);
    let cursor: string | undefined = parentOf.get(key);
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.delete(key);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  const childrenOf: Map<string, Array<string>> = new Map();
  const neighborsOf: Map<string, Set<string>> = new Map();
  for (const [child, parent] of parentOf) {
    const children: Array<string> = childrenOf.get(parent) || [];
    children.push(child);
    childrenOf.set(parent, children);
  }
  for (const edge of infraEdges) {
    for (const [from, to] of [
      [edge.fromEntityKey!, edge.toEntityKey!],
      [edge.toEntityKey!, edge.fromEntityKey!],
    ]) {
      const neighbors: Set<string> = neighborsOf.get(from!) || new Set();
      neighbors.add(to!);
      neighborsOf.set(from!, neighbors);
    }
  }
  return {
    resources,
    relationships: infraEdges,
    parentOf,
    childrenOf,
    neighborsOf,
    roots: keys.filter((key: string): boolean => {
      return !parentOf.has(key);
    }),
    unlinkedCount: keys.filter((key: string): boolean => {
      return !neighborsOf.has(key);
    }).length,
  };
}

/** Iterative traversal handles deep hierarchies without growing the call stack. */
export function getInfrastructureDescendants(
  model: InfrastructureExplorerModel,
  key: string,
): Array<string> {
  const result: Array<string> = [];
  const seen: Set<string> = new Set([key]);
  const queue: Array<string> = [...(model.childrenOf.get(key) || [])];
  for (let index: number = 0; index < queue.length; index++) {
    const child: string = queue[index]!;
    if (seen.has(child)) {
      continue;
    }
    seen.add(child);
    result.push(child);
    queue.push(...(model.childrenOf.get(child) || []));
  }
  return result;
}

export function getInfrastructureBreadcrumbs(
  model: InfrastructureExplorerModel,
  key: string | null,
): Array<InfrastructureResource> {
  const result: Array<InfrastructureResource> = [];
  const seen: Set<string> = new Set();
  let cursor: string | undefined = key || undefined;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const resource: InfrastructureResource | undefined =
      model.resources.get(cursor);
    if (resource) {
      result.unshift(resource);
    }
    cursor = model.parentOf.get(cursor);
  }
  return result;
}

export function findInfrastructureResources(
  model: InfrastructureExplorerModel,
  options: { scopeKey: string | null; search: string; type: string | null },
): Array<InfrastructureResource> {
  const scope: string | null =
    options.scopeKey && model.resources.has(options.scopeKey)
      ? options.scopeKey
      : null;
  const descendants: Array<string> = scope
    ? getInfrastructureDescendants(model, scope)
    : [];
  const scopedKeys: Array<string> = scope
    ? descendants.length > 0
      ? descendants
      : [scope, ...(model.neighborsOf.get(scope) || [])]
    : Array.from(model.resources.keys());
  const terms: Array<string> = options.search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return scopedKeys
    .map((key: string): InfrastructureResource => {
      return model.resources.get(key)!;
    })
    .filter((resource: InfrastructureResource): boolean => {
      const searchable: string =
        `${resource.name} ${metaForEntityType(resource.type).label} ${resource.key}`.toLowerCase();
      return (
        (!options.type || options.type === resource.type) &&
        terms.every((term: string): boolean => {
          return searchable.includes(term);
        })
      );
    })
    .sort((a: InfrastructureResource, b: InfrastructureResource): number => {
      return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
    });
}
