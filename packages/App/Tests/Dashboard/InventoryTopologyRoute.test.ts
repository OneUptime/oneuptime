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

  /*
   * Databases and remote services are the far ends of service calls: they
   * are drawn on the service map, never nested in the infrastructure tree,
   * so an infrastructure link would open a view that cannot show them.
   */
  test.each([EntityType.Database, EntityType.RemoteService])(
    "%s opens the service map focused on that dependency",
    (entityType: EntityType) => {
      const route: Route = buildInventoryTopologyRoute({
        topologyRoute: TOPOLOGY,
        entityType,
        entityKey: "dependency-key",
      });

      expect(route.toString()).toBe(
        "/dashboard/project-id/topology/overview?focus=dependency-key",
      );
    },
  );

  test("a service-map key is encoded as query data too", () => {
    const route: Route = buildInventoryTopologyRoute({
      topologyRoute: TOPOLOGY,
      entityType: EntityType.Database,
      entityKey: "postgresql|db.example.com&x=1",
    });

    expect(route.toString()).toBe(
      "/dashboard/project-id/topology/overview?focus=postgresql%7Cdb.example.com%26x%3D1",
    );
  });

  test.each([
    EntityType.Host,
    EntityType.KubernetesPod,
    EntityType.KubernetesNode,
    EntityType.NetworkDevice,
    EntityType.IoTDevice,
    EntityType.ExternalDatabase,
    "some.future.type",
    "",
    undefined,
  ])(
    "%s opens the infrastructure map focused on that item",
    (entityType: EntityType | string | undefined) => {
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
