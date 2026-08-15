import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  buildTopologyInventoryItemQuery,
  getInfrastructureGraphNodeKeys,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyInventoryData";

function inventoryItem(entityKey: string): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = entityKey;
  item.entityType = EntityType.Host;
  item.displayName = entityKey;
  return item;
}

function relationship(
  fromEntityKey: string,
  toEntityKey: string,
): InventoryItemRelationship {
  const itemRelationship: InventoryItemRelationship =
    new InventoryItemRelationship();
  itemRelationship.fromEntityKey = fromEntityKey;
  itemRelationship.toEntityKey = toEntityKey;
  return itemRelationship;
}

describe("Topology inventory data", () => {
  test("loads the complete non-archived catalog without a last-seen cutoff", () => {
    const projectId: ObjectID = ObjectID.generate();
    const query: Query<InventoryItem> =
      buildTopologyInventoryItemQuery(projectId);

    expect(query).toEqual({
      projectId,
      isArchived: false,
    });
    expect("lastSeenAt" in query).toBe(false);
  });

  test("renders a catalog item even when it has no relationships", () => {
    const nodeKeys: Set<string> = getInfrastructureGraphNodeKeys({
      entities: [inventoryItem("isolated-host")],
      infrastructureRelationships: [],
    });

    expect(nodeKeys).toEqual(new Set<string>(["isolated-host"]));
    expect(nodeKeys.size).toBeGreaterThan(0);
  });

  test("keeps connected and isolated catalog items together", () => {
    const nodeKeys: Set<string> = getInfrastructureGraphNodeKeys({
      entities: [
        inventoryItem("host-a"),
        inventoryItem("pod-a"),
        inventoryItem("isolated-host"),
      ],
      infrastructureRelationships: [relationship("host-a", "pod-a")],
    });

    expect(nodeKeys).toEqual(
      new Set<string>(["host-a", "pod-a", "isolated-host"]),
    );
  });

  test("keeps relationship endpoints whose catalog rows are unavailable", () => {
    const nodeKeys: Set<string> = getInfrastructureGraphNodeKeys({
      entities: [inventoryItem("known-host")],
      infrastructureRelationships: [
        relationship("known-host", "missing-endpoint"),
      ],
    });

    expect(nodeKeys).toEqual(
      new Set<string>(["known-host", "missing-endpoint"]),
    );
  });

  test("renders every isolated item without requiring an explicit focus", () => {
    const nodeKeys: Set<string> = getInfrastructureGraphNodeKeys({
      entities: [inventoryItem("isolated-host"), inventoryItem("manual-api")],
      infrastructureRelationships: [],
    });

    expect(nodeKeys).toEqual(new Set<string>(["isolated-host", "manual-api"]));
  });
});
