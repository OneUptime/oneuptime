import { GetServiceDependenciesTool } from "../../../../Server/Utils/AI/Toolbox/TopologyTools";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TelemetryEntityRelationshipService from "../../../../Server/Services/TelemetryEntityRelationshipService";
import TelemetryEntityService from "../../../../Server/Services/TelemetryEntityService";
import TelemetryEntityRelationship from "../../../../Models/DatabaseModels/TelemetryEntityRelationship";
import TelemetryEntity from "../../../../Models/DatabaseModels/TelemetryEntity";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * get_service_dependencies surfaces the auto-computed topology graph
 * (TelemetryEntityRelationship edges keyed by entityKey hashes) with the
 * keys resolved back to human entity names, so investigations can reason
 * about blast radius and causation order. These tests mock the two
 * services and lock in: name resolution, the entityName filter with a
 * helpful no-match message, the empty-graph explanation, and rejection of
 * unknown relationship types.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

function fakeEdge(
  fromKey: string,
  toKey: string,
  type: EntityRelationshipType = EntityRelationshipType.DependsOn,
): TelemetryEntityRelationship {
  return {
    fromEntityKey: fromKey,
    toEntityKey: toKey,
    relationshipType: type,
    lastSeenAt: new Date(),
  } as unknown as TelemetryEntityRelationship;
}

function fakeEntity(key: string, displayName: string): TelemetryEntity {
  return {
    entityKey: key,
    displayName,
    entityType: "service",
  } as unknown as TelemetryEntity;
}

describe("GetServiceDependenciesTool", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("resolves entity keys to names in both directions", async () => {
    jest
      .spyOn(TelemetryEntityRelationshipService, "findBy")
      .mockResolvedValue([fakeEdge("key-a", "key-b")]);
    jest
      .spyOn(TelemetryEntityService, "findBy")
      .mockResolvedValue([
        fakeEntity("key-a", "checkout"),
        fakeEntity("key-b", "payments"),
      ]);

    const result: { dataForLlm: string; rowCount: number } =
      await GetServiceDependenciesTool.execute({}, ctx);

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("checkout (service)");
    expect(result.dataForLlm).toContain("payments (service)");
    expect(result.dataForLlm).toContain("depends-on");
  });

  test("falls back to the raw key when an entity row is missing", async () => {
    jest
      .spyOn(TelemetryEntityRelationshipService, "findBy")
      .mockResolvedValue([fakeEdge("key-a", "key-unknown")]);
    jest
      .spyOn(TelemetryEntityService, "findBy")
      .mockResolvedValue([fakeEntity("key-a", "checkout")]);

    const result: { dataForLlm: string } =
      await GetServiceDependenciesTool.execute({}, ctx);

    expect(result.dataForLlm).toContain("key-unknown");
  });

  test("entityName filters to touching edges only", async () => {
    jest
      .spyOn(TelemetryEntityRelationshipService, "findBy")
      .mockResolvedValue([
        fakeEdge("key-a", "key-b"),
        fakeEdge("key-c", "key-d"),
      ]);
    jest
      .spyOn(TelemetryEntityService, "findBy")
      .mockResolvedValue([
        fakeEntity("key-a", "checkout"),
        fakeEntity("key-b", "payments"),
        fakeEntity("key-c", "search"),
        fakeEntity("key-d", "catalog"),
      ]);

    const result: { dataForLlm: string; rowCount: number } =
      await GetServiceDependenciesTool.execute({ entityName: "payments" }, ctx);

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("payments");
    expect(result.dataForLlm).not.toContain("catalog");
  });

  test("a non-matching entityName explains itself instead of returning nothing", async () => {
    jest
      .spyOn(TelemetryEntityRelationshipService, "findBy")
      .mockResolvedValue([fakeEdge("key-a", "key-b")]);
    jest
      .spyOn(TelemetryEntityService, "findBy")
      .mockResolvedValue([
        fakeEntity("key-a", "checkout"),
        fakeEntity("key-b", "payments"),
      ]);

    const result: { dataForLlm: string; rowCount: number } =
      await GetServiceDependenciesTool.execute(
        { entityName: "no-such-service" },
        ctx,
      );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("No topology edges touch");
  });

  test("an empty graph explains how the graph is built", async () => {
    jest
      .spyOn(TelemetryEntityRelationshipService, "findBy")
      .mockResolvedValue([]);

    const result: { dataForLlm: string; rowCount: number } =
      await GetServiceDependenciesTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("No topology edges exist");
  });

  test("rejects an unknown relationshipType", async () => {
    await expect(
      GetServiceDependenciesTool.execute(
        { relationshipType: "causes-bugs" },
        ctx,
      ),
    ).rejects.toThrow("Invalid relationshipType");
  });
});
