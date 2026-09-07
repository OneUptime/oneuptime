import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  buildInfrastructureExplorerModel,
  findInfrastructureResources,
  getInfrastructureBreadcrumbs,
  getInfrastructureDescendants,
  InfrastructureExplorerModel,
  InfrastructureResource,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorerModel";

function entity(
  key: string,
  type: EntityType = EntityType.Host,
  name: string = key,
): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.entityType = type;
  item.displayName = name;
  return item;
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType = EntityRelationshipType.HostedOn,
): InventoryItemRelationship {
  const relationship: InventoryItemRelationship =
    new InventoryItemRelationship();
  relationship.fromEntityKey = from;
  relationship.toEntityKey = to;
  relationship.relationshipType = type;
  return relationship;
}

function keys(resources: Array<InfrastructureResource>): Array<string> {
  return resources.map((resource: InfrastructureResource): string => {
    return resource.key;
  });
}

function find(
  model: InfrastructureExplorerModel,
  scopeKey: string | null = null,
  search: string = "",
  type: string | null = null,
): Array<string> {
  return keys(findInfrastructureResources(model, { scopeKey, search, type }));
}

function sharedHostModel(): InfrastructureExplorerModel {
  return buildInfrastructureExplorerModel(
    [
      entity("api", EntityType.Service),
      entity("web", EntityType.Service),
      entity("api-host"),
      entity("shared"),
      entity("web-host"),
      entity("unlinked"),
    ],
    [
      edge("api", "api-host"),
      edge("api", "shared"),
      edge("web", "shared"),
      edge("web", "web-host"),
    ],
  );
}

describe("Infrastructure explorer resource registry", () => {
  test("an empty inventory creates an empty, navigable model", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [],
      [],
    );
    expect(model.resources.size).toBe(0);
    expect(model.roots).toEqual([]);
    expect(model.unlinkedCount).toBe(0);
    expect(find(model)).toEqual([]);
    expect(getInfrastructureBreadcrumbs(model, null)).toEqual([]);
  });
  test("keeps isolated catalog items and ignores records without an identity", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [
        entity("quiet-host"),
        entity("manual-resource", EntityType.ExternalDatabase),
        new InventoryItem(),
      ],
      [],
    );
    expect(Array.from(model.resources.keys())).toEqual([
      "manual-resource",
      "quiet-host",
    ]);
    expect(model.roots).toEqual(["manual-resource", "quiet-host"]);
    expect(model.unlinkedCount).toBe(2);
  });
  test("distinguishes unavailable endpoints by identity without inventing inventory details", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [entity("api", EntityType.Service)],
      [edge("api", "missing-a"), edge("api", "missing-b")],
    );
    expect(model.resources.size).toBe(3);
    expect(model.resources.get("missing-a")?.entity).toBeUndefined();
    expect(model.resources.get("missing-a")?.name).toContain("missing-a");
    expect(model.resources.get("missing-b")?.name).toContain("missing-b");
    expect(model.resources.get("missing-a")?.type).toBe("unknown");
    expect(find(model, null, "missing-b")).toEqual(["missing-b"]);
  });
  test("counts unique infrastructure relationships and ignores calls, malformed edges, and self-links", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [entity("api", EntityType.Service), entity("host")],
      [
        edge("api", "host"),
        edge("api", "host"),
        edge("api", "host", EntityRelationshipType.RunsOn),
        edge("api", "service-only", EntityRelationshipType.DependsOn),
        edge("api", ""),
        edge("", "orphan"),
        edge("host", "host"),
      ],
    );
    expect(model.relationships).toHaveLength(2);
    expect(model.neighborsOf.get("api")).toEqual(new Set(["host"]));
    expect(model.resources.has("service-only")).toBe(false);
    expect(model.resources.has("orphan")).toBe(false);
  });
  test("deduplicates identities while keeping resources with duplicate display names", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [
        entity("host-a", EntityType.Host, "Worker"),
        entity("host-b", EntityType.Host, "Worker"),
        entity("host-a", EntityType.Host, "Worker"),
      ],
      [],
    );
    expect(model.resources.size).toBe(2);
    expect(find(model, null, "Worker")).toEqual(["host-a", "host-b"]);
    expect(find(model, null, "host-b")).toEqual(["host-b"]);
  });
});

describe("Infrastructure explorer hierarchy", () => {
  test("keeps structural containment above workload grouping", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [
        entity("cluster", EntityType.KubernetesCluster),
        entity("node", EntityType.KubernetesNode),
        entity("pod", EntityType.KubernetesPod),
        entity("api", EntityType.Service),
      ],
      [
        edge("node", "cluster", EntityRelationshipType.MemberOf),
        edge("pod", "node", EntityRelationshipType.RunsOn),
        edge("api", "pod", EntityRelationshipType.RunsOn),
      ],
    );
    expect(model.parentOf.get("pod")).toBe("node");
    expect(model.parentOf.get("node")).toBe("cluster");
    expect(keys(getInfrastructureBreadcrumbs(model, "pod"))).toEqual([
      "cluster",
      "node",
      "pod",
    ]);
    expect(getInfrastructureDescendants(model, "cluster")).toEqual([
      "node",
      "pod",
    ]);
  });
  test("picks the same forest when catalog and relationship order changes", () => {
    const entities: Array<InventoryItem> = [
      entity("web", EntityType.Service),
      entity("api", EntityType.Service),
      entity("host-a"),
      entity("host-b"),
    ];
    const relationships: Array<InventoryItemRelationship> = [
      edge("web", "host-a"),
      edge("api", "host-a"),
      edge("web", "host-b"),
    ];
    const first: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      entities,
      relationships,
    );
    const reversed: InfrastructureExplorerModel =
      buildInfrastructureExplorerModel(
        [...entities].reverse(),
        [...relationships].reverse(),
      );
    expect(Array.from(first.parentOf).sort()).toEqual(
      Array.from(reversed.parentOf).sort(),
    );
    expect(first.roots).toEqual(reversed.roots);
    expect(first.parentOf.get("host-a")).toBe("api");
    expect(find(first)).toEqual(find(reversed));
  });
  test("recovers cyclic relationships into a forest without losing resources", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [
        entity("a", EntityType.Container),
        entity("b", EntityType.Container),
        entity("c", EntityType.Container),
      ],
      [
        edge("a", "b", EntityRelationshipType.PartOf),
        edge("b", "c", EntityRelationshipType.PartOf),
        edge("c", "a", EntityRelationshipType.PartOf),
      ],
    );
    expect(model.roots).toEqual(["a"]);
    expect(model.relationships).toHaveLength(3);
    expect(new Set(["a", ...getInfrastructureDescendants(model, "a")])).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(keys(getInfrastructureBreadcrumbs(model, "b"))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
  test("supports deep groups and breadcrumbs without recursive traversal", () => {
    const size: number = 1500;
    const entities: Array<InventoryItem> = [];
    const relationships: Array<InventoryItemRelationship> = [];
    for (let index: number = 0; index < size; index++) {
      entities.push(entity(`container-${index}`, EntityType.Container));
      if (index > 0) {
        relationships.push(
          edge(
            `container-${index}`,
            `container-${index - 1}`,
            EntityRelationshipType.PartOf,
          ),
        );
      }
    }
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      entities,
      relationships,
    );
    expect(model.roots).toEqual(["container-0"]);
    expect(getInfrastructureDescendants(model, "container-0")).toHaveLength(
      size - 1,
    );
    const breadcrumbs: Array<InfrastructureResource> =
      getInfrastructureBreadcrumbs(model, `container-${size - 1}`);
    expect(breadcrumbs).toHaveLength(size);
    expect(breadcrumbs[0]?.key).toBe("container-0");
    expect(breadcrumbs[size - 1]?.key).toBe(`container-${size - 1}`);
  });
});

describe("Infrastructure explorer scope and search", () => {
  test("exploring a group stays within its children when a shared host connects another group", () => {
    const model: InfrastructureExplorerModel = sharedHostModel();
    expect(find(model, "api")).toEqual(["api-host", "shared"]);
    expect(find(model, "web")).toEqual(["web-host"]);
  });
  test("exploring a leaf shows itself and direct neighbors without traversing the entire component", () => {
    const model: InfrastructureExplorerModel = sharedHostModel();
    expect(find(model, "shared")).toEqual(["api", "shared", "web"]);
    expect(find(model, "shared")).not.toContain("api-host");
    expect(find(model, "shared")).not.toContain("web-host");
  });
  test("an isolated resource remains visible in its own scope", () => {
    expect(find(sharedHostModel(), "unlinked")).toEqual(["unlinked"]);
  });
  test("a stale shared scope falls back to the complete current catalog", () => {
    const model: InfrastructureExplorerModel = sharedHostModel();
    expect(find(model, "deleted-resource")).toEqual(find(model));
    expect(getInfrastructureBreadcrumbs(model, "deleted-resource")).toEqual([]);
  });
  test("matches all case-insensitive words across name, type label, and identity", () => {
    const model: InfrastructureExplorerModel = buildInfrastructureExplorerModel(
      [
        entity("prod-worker-17", EntityType.KubernetesPod, "Checkout Worker"),
        entity("prod-host-17", EntityType.Host, "Checkout Worker"),
        entity("staging-worker", EntityType.KubernetesPod, "Checkout Worker"),
      ],
      [],
    );
    expect(find(model, null, "  CHECKOUT   pod   17 ")).toEqual([
      "prod-worker-17",
    ]);
    expect(find(model, null, "host checkout")).toEqual(["prod-host-17"]);
    expect(find(model, null, "no matching resource")).toEqual([]);
  });
  test("intersects scope, type, and search instead of allowing a filter to escape the scope", () => {
    const model: InfrastructureExplorerModel = sharedHostModel();
    expect(find(model, "api", "api-host", EntityType.Host)).toEqual([
      "api-host",
    ]);
    expect(find(model, "api", "web", EntityType.Host)).toEqual([]);
    expect(find(model, "shared", "api", EntityType.Host)).toEqual([]);
    expect(find(model, "shared", "api", EntityType.Service)).toEqual(["api"]);
  });
  test("an unknown type yields no matches and clearing filters restores all resources", () => {
    const model: InfrastructureExplorerModel = sharedHostModel();
    expect(find(model, null, "", "no-such-type")).toEqual([]);
    expect(find(model, null, "   ")).toHaveLength(model.resources.size);
  });
});
