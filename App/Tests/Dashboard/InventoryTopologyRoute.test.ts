import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import EntityType from "Common/Types/Telemetry/EntityType";
import { buildInventoryTopologyRoute } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTopologyRoute";

const TOPOLOGY: Route = new Route("/dashboard/project-id/topology/overview");

describe("Inventory links into the full Topology product", () => {
  test("services open the service map focused on that service", () => {
    const route: Route = buildInventoryTopologyRoute({
      topologyRoute: TOPOLOGY,
      entityType: EntityType.Service,
      entityKey: "service-key",
    });

    expect(route.toString()).toBe(
      "/dashboard/project-id/topology/overview?focus=service-key",
    );
  });

  test.each([
    EntityType.Host,
    EntityType.KubernetesPod,
    EntityType.KubernetesNode,
    undefined,
  ])(
    "%s opens the infrastructure map focused on that item",
    (entityType: EntityType | undefined) => {
      const route: Route = buildInventoryTopologyRoute({
        topologyRoute: TOPOLOGY,
        entityType,
        entityKey: "infrastructure-key",
      });

      expect(route.toString()).toBe(
        "/dashboard/project-id/topology/overview?tab=Infrastructure&infraFocus=infrastructure-key",
      );
    },
  );

  test("the entity key is encoded as query data, not concatenated as markup", () => {
    const route: Route = buildInventoryTopologyRoute({
      topologyRoute: TOPOLOGY,
      entityType: EntityType.KubernetesPod,
      entityKey: "pod/key & namespace",
    });

    expect(route.toString()).toContain("infraFocus=pod%2Fkey+%26+namespace");
    expect(route.toString()).not.toContain("pod/key & namespace");
  });
});
