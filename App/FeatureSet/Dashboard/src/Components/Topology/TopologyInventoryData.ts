import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

/**
 * Inventory is the durable catalog behind Topology. The time picker limits
 * observed relationships, but it must not hide an otherwise current catalog
 * item merely because that item has not emitted telemetry recently.
 */
export function buildTopologyInventoryItemQuery(
  projectId: ObjectID,
): Query<InventoryItem> {
  return {
    projectId,
    isArchived: false,
  };
}

/**
 * The Infrastructure tab is Inventory's complete visual catalog: every loaded
 * item is a node, including items which have no known relationship yet. Edges
 * are added independently from the selected telemetry window. Keeping node
 * membership independent from edges prevents a quiet or manually registered
 * resource from disappearing from the map.
 */
export function getInfrastructureGraphNodeKeys(data: {
  entities: Array<InventoryItem>;
  infrastructureRelationships: Array<InventoryItemRelationship>;
}): Set<string> {
  const keys: Set<string> = new Set<string>();

  for (const entity of data.entities) {
    if (entity.entityKey) {
      keys.add(entity.entityKey);
    }
  }

  for (const relationship of data.infrastructureRelationships) {
    if (relationship.fromEntityKey) {
      keys.add(relationship.fromEntityKey);
    }
    if (relationship.toEntityKey) {
      keys.add(relationship.toEntityKey);
    }
  }

  return keys;
}
