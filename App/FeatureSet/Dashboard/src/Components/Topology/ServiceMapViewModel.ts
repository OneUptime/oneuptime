import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import { LayoutPoint } from "../../Utils/LayeredGraphLayout";
import { ServiceOperationalStatus } from "./OperationalOverlay";
import { TrafficHealth, healthForErrorRate } from "./TopologyMeta";

export interface ServiceMapEntry {
  entity: InventoryItem;
  key: string;
  label: string;
  health: TrafficHealth;
  calls: number;
  errors: number;
  callers: number;
  dependencies: number;
  incidentCount: number;
  incidentColor: string | null;
  alertCount: number;
  alertColor: string | null;
  needsAttention: boolean;
}

export interface ServiceMapModel {
  entries: Array<ServiceMapEntry>;
  entryByKey: Map<string, ServiceMapEntry>;
  relationships: Array<InventoryItemRelationship>;
}

export interface ServiceMapVisibility {
  matchedKeys: Set<string>;
  visibleKeys: Set<string>;
  contextKeys: Set<string>;
  effectiveFocusKey: string | null;
}

export const SERVICE_TRAFFIC_LABELS: Record<TrafficHealth, string> = {
  healthy: "No call errors",
  degraded: "Some call errors",
  critical: "High error rate",
  unknown: "No incoming calls",
};

/** Build traffic totals before filtering so searching never changes health. */
export function buildServiceMapModel(
  entities: Array<InventoryItem>,
  relationships: Array<InventoryItemRelationship>,
  statuses: Map<string, ServiceOperationalStatus> = new Map<
    string,
    ServiceOperationalStatus
  >(),
): ServiceMapModel {
  const entryByKey: Map<string, ServiceMapEntry> = new Map<
    string,
    ServiceMapEntry
  >();
  for (const entity of entities) {
    if (entity.entityType !== EntityType.Service || !entity.entityKey) {
      continue;
    }
    const label: string = entity.displayName || "Unnamed service";
    const status: ServiceOperationalStatus | undefined = statuses.get(
      label.toLowerCase(),
    );
    entryByKey.set(entity.entityKey, {
      entity,
      key: entity.entityKey,
      label,
      calls: 0,
      errors: 0,
      callers: 0,
      dependencies: 0,
      health: "unknown",
      incidentCount: status?.activeIncidentCount || 0,
      incidentColor: status?.worstIncidentSeverityColor || null,
      alertCount: status?.activeAlertCount || 0,
      alertColor: status?.worstAlertSeverityColor || null,
      needsAttention: false,
    });
  }

  const validRelationships: Array<InventoryItemRelationship> = [];
  for (const relationship of relationships) {
    if (relationship.relationshipType !== EntityRelationshipType.DependsOn) {
      continue;
    }
    const from: ServiceMapEntry | undefined = entryByKey.get(
      relationship.fromEntityKey || "",
    );
    const to: ServiceMapEntry | undefined = entryByKey.get(
      relationship.toEntityKey || "",
    );
    if (!from || !to) {
      continue;
    }
    validRelationships.push(relationship);
    from.dependencies++;
    to.callers++;
    if (relationship.callCount && relationship.callCount > 0) {
      to.calls += relationship.callCount;
      to.errors += relationship.errorCount || 0;
    }
  }

  for (const entry of entryByKey.values()) {
    entry.health = healthForErrorRate(entry.calls, entry.errors);
    entry.needsAttention =
      entry.incidentCount > 0 ||
      entry.alertCount > 0 ||
      entry.health === "degraded" ||
      entry.health === "critical";
  }

  const entries: Array<ServiceMapEntry> = Array.from(entryByKey.values()).sort(
    (a: ServiceMapEntry, b: ServiceMapEntry): number => {
      return (
        Number(b.needsAttention) - Number(a.needsAttention) ||
        Number(b.incidentCount > 0) - Number(a.incidentCount > 0) ||
        Number(b.health === "critical") - Number(a.health === "critical") ||
        Number(b.alertCount > 0) - Number(a.alertCount > 0) ||
        Number(b.health === "degraded") - Number(a.health === "degraded") ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key)
      );
    },
  );
  return { entries, entryByKey, relationships: validRelationships };
}

/** Search keeps only matching services and their immediate dependency context. */
export function resolveServiceMapVisibility(options: {
  model: ServiceMapModel;
  search: string;
  focusKey: string | null;
  attentionOnly: boolean;
}): ServiceMapVisibility {
  const { model } = options;
  const effectiveFocusKey: string | null =
    options.focusKey && model.entryByKey.has(options.focusKey)
      ? options.focusKey
      : null;
  const neighbors: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const relationship of model.relationships) {
    const from: string = relationship.fromEntityKey!;
    const to: string = relationship.toEntityKey!;
    if (!neighbors.has(from)) {
      neighbors.set(from, new Set<string>());
    }
    if (!neighbors.has(to)) {
      neighbors.set(to, new Set<string>());
    }
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  }
  const scope: Set<string> = effectiveFocusKey
    ? new Set<string>([
        effectiveFocusKey,
        ...(neighbors.get(effectiveFocusKey) || []),
      ])
    : new Set<string>(model.entryByKey.keys());
  const query: string = options.search.trim().toLowerCase();
  const matchedKeys: Set<string> = new Set<string>();
  for (const entry of model.entries) {
    if (
      scope.has(entry.key) &&
      (!options.attentionOnly || entry.needsAttention) &&
      (!query ||
        entry.label.toLowerCase().includes(query) ||
        entry.key.toLowerCase().includes(query))
    ) {
      matchedKeys.add(entry.key);
    }
  }
  const contextKeys: Set<string> = new Set<string>();
  for (const key of matchedKeys) {
    for (const neighbor of neighbors.get(key) || []) {
      if (scope.has(neighbor) && !matchedKeys.has(neighbor)) {
        contextKeys.add(neighbor);
      }
    }
  }
  return {
    matchedKeys,
    contextKeys,
    visibleKeys: new Set<string>([...matchedKeys, ...contextKeys]),
    effectiveFocusKey,
  };
}

/** Unconnected services form a compact grid instead of an unbounded row. */
export function serviceIsolatedPosition(options: {
  index: number;
  count: number;
  xGap: number;
  yGap: number;
  startY: number;
}): LayoutPoint {
  const columns: number = Math.min(
    4,
    Math.max(1, Math.ceil(Math.sqrt(options.count))),
  );
  return {
    x: (options.index % columns) * options.xGap,
    y: options.startY + Math.floor(options.index / columns) * options.yGap,
  };
}
