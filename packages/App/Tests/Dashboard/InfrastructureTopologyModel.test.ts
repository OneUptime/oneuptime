import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  categoryForType,
  collectMapCards,
  describeInfrastructureNode,
  getInfrastructurePath,
  getInfrastructureResourcesBelow,
  isInfrastructureType,
  searchInfrastructure,
  summarizeCounts,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";

/*
 * The Infrastructure view model turns a flat catalog into a tree a person can
 * walk: categories, structural containers, replica groups and resources, with
 * the services running on each. These tests use the two estates that
 * motivated it: application pods that reported themselves as hosts, and a
 * properly identified Kubernetes deployment.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");
const LONG_AGO: Date = new Date("2026-08-10T10:00:00Z");

function entity(
  key: string,
  type: EntityType,
  name: string = key,
  lastSeenAt: Date = NOW,
  source: EntitySource = EntitySource.Discovered,
): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.displayName = name;
  item.entityType = type;
  item.lastSeenAt = lastSeenAt;
  item.source = source;
  return item;
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): InventoryItemRelationship {
  const relationship: InventoryItemRelationship =
    new InventoryItemRelationship();
  relationship.fromEntityKey = from;
  relationship.toEntityKey = to;
  relationship.relationshipType = type;
  return relationship;
}

function node(
  model: InfrastructureTopologyModel,
  id: string,
): InfrastructureNode {
  const found: InfrastructureNode | undefined = model.nodes.get(id);
  if (!found) {
    throw new Error(`missing node ${id}`);
  }
  return found;
}

describe("pods reported as hosts", () => {
  const entities: Array<InventoryItem> = [
    entity("api", EntityType.Service),
    entity("probe", EntityType.Service),
    entity("h1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt"),
    entity("h2", EntityType.Host, "oneuptime-app-685856b7d7-4vnkt"),
    entity("h3", EntityType.Host, "oneuptime-app-7bf488c9d5-5jgp4"),
    entity(
      "h-old",
      EntityType.Host,
      "oneuptime-app-6f8cc8d9b4-6652k",
      LONG_AGO,
    ),
    entity("p1", EntityType.Host, "oneuptime-probe-one-7c8d9f5b6-bq2zt"),
    entity("p2", EntityType.Host, "oneuptime-probe-one-7c8d9f5b6-zt9wm"),
    entity("build", EntityType.Host, "build-server"),
    entity(
      "switch",
      EntityType.NetworkDevice,
      "core-switch",
      LONG_AGO,
      EntitySource.Inventory,
    ),
  ];
  const relationships: Array<InventoryItemRelationship> = [
    edge("api", "h1", EntityRelationshipType.HostedOn),
    edge("api", "h2", EntityRelationshipType.HostedOn),
    edge("api", "h3", EntityRelationshipType.HostedOn),
    edge("api", "h-old", EntityRelationshipType.HostedOn),
    edge("probe", "p1", EntityRelationshipType.HostedOn),
    edge("probe", "p2", EntityRelationshipType.HostedOn),
  ];
  const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
    entities,
    relationships,
    { rangeStart: RANGE_START },
  );

  test("replicas of one workload collapse into a group named after it", () => {
    const compute: InfrastructureNode = node(model, "category:compute");
    const children: Array<string> = compute.childIds.map((id: string) => {
      return node(model, id).name;
    });
    expect(children).toEqual([
      "oneuptime-app",
      "oneuptime-probe-one",
      "build-server",
    ]);
    const app: InfrastructureNode = node(model, compute.childIds[0]!);
    expect(app.kind).toBe("group");
    expect(app.entityType).toBe(EntityType.Host);
    expect(app.childIds.sort()).toEqual(["h1", "h2", "h3"]);
    expect(describeInfrastructureNode(app)).toBe("3 hosts");
    expect(node(model, "h1").parentId).toBe(app.id);
  });

  test("resources that did not report in the range are left out and counted", () => {
    expect(model.nodes.has("h-old")).toBe(false);
    expect(model.inactiveCount).toBe(1);
    expect(model.resourceCount).toBe(7);
  });

  test("inventory rows are never inactive, however old their timestamp", () => {
    expect(model.nodes.has("switch")).toBe(true);
    expect(node(model, "category:network").childIds).toEqual(["switch"]);
  });

  test("services attach to where they run and roll up to every level", () => {
    const app: InfrastructureNode = node(
      model,
      node(model, "category:compute").childIds[0]!,
    );
    expect(node(model, "h1").serviceKeys).toEqual(["api"]);
    expect(app.serviceKeys).toEqual(["api"]);
    expect(node(model, "category:compute").serviceKeys).toEqual([
      "api",
      "probe",
    ]);
    expect(node(model, "build").serviceKeys).toEqual([]);
  });

  test("counts roll up by type", () => {
    const compute: InfrastructureNode = node(model, "category:compute");
    expect(compute.resourceCount).toBe(6);
    expect(compute.countsByType.get(EntityType.Host)).toBe(6);
    expect(summarizeCounts(compute.countsByType)).toBe("6 hosts");
    expect(model.groupCount).toBe(2);
  });

  test("show inactive includes silent resources, marked inactive", () => {
    const withInactive: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel(entities, relationships, {
        rangeStart: RANGE_START,
        includeInactive: true,
      });
    expect(withInactive.inactiveCount).toBe(0);
    expect(node(withInactive, "h-old").isActive).toBe(false);
    const group: InfrastructureNode = node(
      withInactive,
      node(withInactive, "h-old").parentId!,
    );
    expect(group.childIds).toHaveLength(4);
    // What is running still reads first, however the names sort.
    expect(group.childIds[group.childIds.length - 1]).toBe("h-old");
    // A group with any active member is active.
    expect(group.isActive).toBe(true);
  });

  test("a single replica is not a group", () => {
    const single: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel(
        [entity("h1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt")],
        [],
      );
    expect(node(single, "h1").parentId).toBe("category:compute");
    expect(single.groupCount).toBe(0);
  });
});

describe("an identified Kubernetes deployment", () => {
  const entities: Array<InventoryItem> = [
    entity("svc", EntityType.Service, "api"),
    entity("cluster", EntityType.KubernetesCluster, "prod"),
    entity("ns", EntityType.KubernetesNamespace, "oneuptime"),
    entity("node-a", EntityType.KubernetesNode, "node-a"),
    entity("deploy", EntityType.KubernetesDeployment, "oneuptime-app"),
    entity("pod-1", EntityType.KubernetesPod, "oneuptime-app-6d4f8b9c7d-x2k9p"),
    entity("pod-2", EntityType.KubernetesPod, "oneuptime-app-6d4f8b9c7d-q8zwm"),
    entity("db", EntityType.Database, "orders"),
  ];
  const relationships: Array<InventoryItemRelationship> = [
    edge("ns", "cluster", EntityRelationshipType.MemberOf),
    edge("node-a", "cluster", EntityRelationshipType.MemberOf),
    edge("deploy", "ns", EntityRelationshipType.MemberOf),
    edge("deploy", "cluster", EntityRelationshipType.MemberOf),
    edge("pod-1", "deploy", EntityRelationshipType.PartOf),
    edge("pod-1", "ns", EntityRelationshipType.MemberOf),
    edge("pod-1", "node-a", EntityRelationshipType.RunsOn),
    edge("pod-2", "deploy", EntityRelationshipType.PartOf),
    edge("pod-2", "node-a", EntityRelationshipType.RunsOn),
    edge("svc", "pod-1", EntityRelationshipType.RunsOn),
    edge("svc", "pod-2", EntityRelationshipType.RunsOn),
    edge("svc", "db", EntityRelationshipType.DependsOn),
  ];
  const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
    entities,
    relationships,
    { rangeStart: RANGE_START },
  );

  test("nests pods in their deployment, in its namespace, in its cluster", () => {
    expect(
      getInfrastructurePath(model, "pod-1").map((item: InfrastructureNode) => {
        return item.id;
      }),
    ).toEqual(["category:kubernetes", "cluster", "ns", "deploy", "pod-1"]);
    expect(node(model, "node-a").parentId).toBe("cluster");
  });

  test("never groups a deployment's pods a second time", () => {
    expect(node(model, "deploy").childIds.sort()).toEqual(["pod-1", "pod-2"]);
    expect(model.groupCount).toBe(0);
  });

  test("services and dependencies are not infrastructure rows", () => {
    expect(model.nodes.has("svc")).toBe(false);
    expect(model.nodes.has("db")).toBe(false);
    expect(model.serviceByKey.has("svc")).toBe(true);
    expect(isInfrastructureType(EntityType.Database)).toBe(false);
    expect(isInfrastructureType(EntityType.KubernetesPod)).toBe(true);
  });

  test("the service shows up on every container above its pods", () => {
    for (const id of ["deploy", "ns", "cluster", "category:kubernetes"]) {
      expect(node(model, id).serviceKeys).toEqual(["svc"]);
    }
    expect(node(model, "node-a").serviceKeys).toEqual([]);
  });

  test("containers list before plain resources", () => {
    expect(node(model, "cluster").childIds).toEqual(["ns", "node-a"]);
  });

  test("getInfrastructureResourcesBelow returns resources only", () => {
    expect(
      getInfrastructureResourcesBelow(model, "cluster")
        .map((item: InfrastructureNode) => {
          return item.id;
        })
        .sort(),
    ).toEqual(["deploy", "node-a", "ns", "pod-1", "pod-2"]);
  });

  test("the map looks through clusters and namespaces to workloads and machines", () => {
    expect(collectMapCards(model, null)).toEqual(["deploy", "node-a"]);
    expect(collectMapCards(model, "cluster")).toEqual(["deploy", "node-a"]);
    expect(collectMapCards(model, "deploy")).toEqual(["pod-1", "pod-2"]);
  });
});

describe("search", () => {
  const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
    [
      entity("svc", EntityType.Service, "checkout"),
      entity("h1", EntityType.Host, "web-01"),
      entity("h2", EntityType.Host, "web-02"),
      entity("h3", EntityType.Host, "db-primary"),
    ],
    [edge("svc", "h3", EntityRelationshipType.HostedOn)],
  );

  test("matches names, type labels and the services running there", () => {
    expect(
      searchInfrastructure(model, "web").map((item: InfrastructureNode) => {
        return item.name;
      }),
    ).toEqual(["web", "web-01", "web-02"]);
    expect(
      searchInfrastructure(model, "checkout").map(
        (item: InfrastructureNode) => {
          return item.name;
        },
      ),
    ).toEqual(["db-primary"]);
    expect(
      searchInfrastructure(model, "host primary").map(
        (item: InfrastructureNode) => {
          return item.id;
        },
      ),
    ).toEqual(["h3"]);
  });

  test("a blank query matches nothing rather than everything", () => {
    expect(searchInfrastructure(model, "   ")).toEqual([]);
  });
});

describe("robustness", () => {
  test("a containment cycle cannot hang the tree or lose its resources", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("a", EntityType.KubernetesNode),
        entity("b", EntityType.KubernetesNode),
      ],
      [
        edge("a", "b", EntityRelationshipType.MemberOf),
        edge("b", "a", EntityRelationshipType.MemberOf),
      ],
    );
    expect(model.resourceCount).toBe(2);
    for (const id of ["a", "b"]) {
      expect(getInfrastructurePath(model, id)[0]!.kind).toBe("category");
    }
  });

  test("edges to resources that are not in the catalog are ignored", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("pod", EntityType.KubernetesPod)],
      [edge("pod", "gone-node", EntityRelationshipType.RunsOn)],
    );
    expect(model.nodes.has("gone-node")).toBe(false);
    expect(model.relationships).toEqual([]);
  });

  test("unknown types land in Other instead of disappearing", () => {
    expect(categoryForType("quantum.computer").name).toBe("Other");
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("q", "quantum.computer" as EntityType)],
      [],
    );
    expect(model.rootIds).toEqual(["category:other"]);
  });

  test("an empty catalog is an empty model", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [],
      [],
    );
    expect(model.rootIds).toEqual([]);
    expect(model.resourceCount).toBe(0);
  });
});
