import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

/**
 * Inventory is the durable catalog behind Topology, so the whole non-archived
 * catalog is loaded without a last-seen cutoff. Which of those resources a map
 * draws is decided afterwards, against the selected range (see
 * TopologyActivity): filtering in the query would make "show inactive" a
 * second round trip and would hide manual and inventory-mirrored items, whose
 * lastSeenAt never moves.
 */
export function buildTopologyInventoryItemQuery(
  projectId: ObjectID,
): Query<InventoryItem> {
  return {
    projectId,
    isArchived: false,
  };
}
