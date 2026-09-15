import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { buildTopologyInventoryItemQuery } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyInventoryData";

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
});
