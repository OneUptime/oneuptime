import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  InfrastructureNode,
  InfrastructureSearchIndex,
  InfrastructureTopologyModel,
  breakContainmentCycles,
  buildInfrastructureSearchIndex,
  buildInfrastructureTopologyModel,
  categoryForType,
  collectMapCards,
  collectionName,
  collectionNameTerms,
  collectionNodeId,
  describeInfrastructureNode,
  getInfrastructurePath,
  getInfrastructureResourcesBelow,
  infrastructureSearchTerms,
  isContainerNode,
  isInfrastructureType,
  searchInfrastructure,
  summarizeCounts,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  InfrastructureCollection,
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * The Infrastructure view model turns a flat catalog into a tree a person can
 * walk: categories, structural containers, replica groups, collections and
 * resources, with the services running on each. These tests use the two
 * estates that motivated it: application pods that reported themselves as
 * hosts, and a properly identified Kubernetes deployment.
 *
 * The model is fed the Topology API's lean rows (TopologyEntity /
 * TopologyRelationship), so most fixtures are plain objects; one test keeps
 * full InventoryItem rows to pin that they still fit.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");
const LONG_AGO: Date = new Date("2026-08-10T10:00:00Z");

function entity(
  key: string,
  type: EntityType | string,
  name: string = key,
  lastSeenAt: Date = NOW,
  source: EntitySource = EntitySource.Discovered,
): TopologyEntity {
  return {
    entityKey: key,
    displayName: name,
    entityType: type,
    lastSeenAt,
    source,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
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

function ids(nodes: Array<InfrastructureNode>): Array<string> {
  return nodes.map((item: InfrastructureNode): string => {
    return item.id;
  });
}

function collection(
  entityType: string,
  total: number,
  active: number,
  lastSeenAt: Date | null = NOW,
  activeLastSeenAt: Date | null = NOW,
): InfrastructureCollection {
  return { entityType, total, active, lastSeenAt, activeLastSeenAt };
}

describe("pods reported as hosts", () => {
  const entities: Array<TopologyEntity> = [
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
  const relationships: Array<TopologyRelationship> = [
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

  test("full inventory rows still fit the lean shapes", () => {
    const row: InventoryItem = new InventoryItem();
    row.entityKey = "row";
    row.entityType = EntityType.Host;
    row.displayName = "db-primary";
    row.source = EntitySource.Discovered;
    row.lastSeenAt = NOW;
    const fromRows: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel([row], [], {
        rangeStart: RANGE_START,
      });
    expect(node(fromRows, "row").entity).toBe(row);
    expect(node(fromRows, "row").isActive).toBe(true);
  });
});

describe("an identified Kubernetes deployment", () => {
  const entities: Array<TopologyEntity> = [
    entity("svc", EntityType.Service, "api"),
    entity("cluster", EntityType.KubernetesCluster, "prod"),
    entity("ns", EntityType.KubernetesNamespace, "oneuptime"),
    entity("node-a", EntityType.KubernetesNode, "node-a"),
    entity("deploy", EntityType.KubernetesDeployment, "oneuptime-app"),
    entity("pod-1", EntityType.KubernetesPod, "oneuptime-app-6d4f8b9c7d-x2k9p"),
    entity("pod-2", EntityType.KubernetesPod, "oneuptime-app-6d4f8b9c7d-q8zwm"),
    entity("db", EntityType.Database, "orders"),
  ];
  const relationships: Array<TopologyRelationship> = [
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
    expect(ids(getInfrastructurePath(model, "pod-1"))).toEqual([
      "category:kubernetes",
      "cluster",
      "ns",
      "deploy",
      "pod-1",
    ]);
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
    expect(isInfrastructureType(EntityType.Service)).toBe(false);
    expect(isInfrastructureType(EntityType.KubernetesPod)).toBe(true);
    expect(isInfrastructureType(undefined)).toBe(false);
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
      ids(getInfrastructureResourcesBelow(model, "cluster")).sort(),
    ).toEqual(["deploy", "node-a", "ns", "pod-1", "pod-2"]);
  });

  test("the map looks through clusters and namespaces to workloads and machines", () => {
    expect(collectMapCards(model, null)).toEqual(["deploy", "node-a"]);
    expect(collectMapCards(model, "cluster")).toEqual(["deploy", "node-a"]);
    expect(collectMapCards(model, "deploy")).toEqual(["pod-1", "pod-2"]);
  });
});

describe("the server's synthesized containment", () => {
  /*
   * The Topology API sends each resource's best container over ALL
   * resources and, when that one is silent, its best ACTIVE container. The
   * model must land on the first with inactive resources shown and fall
   * back to the second with them hidden.
   */
  const entities: Array<TopologyEntity> = [
    entity("cluster", EntityType.KubernetesCluster, "prod"),
    entity("old-deploy", EntityType.KubernetesDeployment, "old", LONG_AGO),
    entity("node-a", EntityType.KubernetesNode, "node-a"),
    entity("pod", EntityType.KubernetesPod, "old-6d4f8b9c7d-x2k9p"),
  ];
  const relationships: Array<TopologyRelationship> = [
    edge("old-deploy", "cluster", EntityRelationshipType.MemberOf),
    edge("node-a", "cluster", EntityRelationshipType.MemberOf),
    // parent (inactive), then activeParent.
    edge("pod", "old-deploy", EntityRelationshipType.PartOf),
    edge("pod", "node-a", EntityRelationshipType.RunsOn),
  ];

  test("inactive shown: the best container wins even though it is silent", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      relationships,
      {
        rangeStart: RANGE_START,
        includeInactive: true,
      },
    );
    expect(node(model, "pod").parentId).toBe("old-deploy");
  });

  test("inactive hidden: the best active container takes over", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      relationships,
      {
        rangeStart: RANGE_START,
      },
    );
    expect(model.nodes.has("old-deploy")).toBe(false);
    expect(node(model, "pod").parentId).toBe("node-a");
    expect(model.inactiveCount).toBe(1);
  });
});

describe("collections", () => {
  const entities: Array<TopologyEntity> = [
    entity("svc", EntityType.Service, "api"),
    entity("h1", EntityType.Host, "build-server"),
    entity("switch", EntityType.NetworkDevice, "core-switch"),
    // A stray row of a collected type must not be counted twice.
    entity("stray", EntityType.IoTDevice, "stray-sensor"),
  ];
  const collections: Array<InfrastructureCollection> = [
    collection(
      EntityType.IoTDevice,
      5000,
      4200,
      new Date("2026-09-07T11:00:00Z"),
      new Date("2026-09-07T10:30:00Z"),
    ),
    collection(EntityType.CloudResource, 1500, 0, LONG_AGO, null),
  ];

  const hidden: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
    entities,
    [],
    { rangeStart: RANGE_START, collections },
  );
  const shown: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
    entities,
    [],
    { rangeStart: RANGE_START, includeInactive: true, collections },
  );

  test("a collection is one node under its type's category, named by its plural", () => {
    const iot: InfrastructureNode = node(
      hidden,
      collectionNodeId(EntityType.IoTDevice),
    );
    expect(iot.id).toBe("collection:iot.device");
    expect(iot.kind).toBe("collection");
    expect(iot.name).toBe("IoT Devices");
    expect(iot.entityType).toBe(EntityType.IoTDevice);
    expect(iot.entity).toBeNull();
    expect(iot.childIds).toEqual([]);
    expect(iot.parentId).toBe("category:network");
    expect(iot.serviceKeys).toEqual([]);
    expect(isContainerNode(iot)).toBe(true);
  });

  test("with inactive hidden it counts the active items and reports the rest as hidden", () => {
    const iot: InfrastructureNode = node(hidden, "collection:iot.device");
    expect(iot.resourceCount).toBe(4200);
    expect(iot.countsByType).toEqual(
      new Map<string, number>([[EntityType.IoTDevice, 4200]]),
    );
    expect(iot.isActive).toBe(true);
    expect(iot.lastSeenAt).toEqual(new Date("2026-09-07T10:30:00Z"));
    expect(describeInfrastructureNode(iot)).toBe("4,200 IoT devices");
    // Nothing of the cloud collection reported, so it is left out...
    expect(hidden.nodes.has("collection:cloud.resource")).toBe(false);
    // ...and 800 silent IoT devices + 1,500 cloud resources are hidden.
    expect(hidden.inactiveCount).toBe(800 + 1500);
    // Two plain resources plus the collection's active items.
    expect(hidden.resourceCount).toBe(2 + 4200);
  });

  test("with inactive shown it counts every item", () => {
    const iot: InfrastructureNode = node(shown, "collection:iot.device");
    expect(iot.resourceCount).toBe(5000);
    expect(iot.lastSeenAt).toEqual(new Date("2026-09-07T11:00:00Z"));
    const cloud: InfrastructureNode = node(shown, "collection:cloud.resource");
    expect(cloud.resourceCount).toBe(1500);
    expect(cloud.isActive).toBe(false);
    expect(cloud.lastSeenAt).toEqual(LONG_AGO);
    expect(cloud.parentId).toBe("category:cloud");
    expect(shown.inactiveCount).toBe(0);
    expect(shown.resourceCount).toBe(2 + 5000 + 1500);
  });

  test("stray rows of a collected type are left to the collection", () => {
    expect(hidden.nodes.has("stray")).toBe(false);
  });

  test("categories roll the collection's counts up and list it before plain resources", () => {
    const network: InfrastructureNode = node(hidden, "category:network");
    expect(network.childIds).toEqual(["collection:iot.device", "switch"]);
    expect(network.resourceCount).toBe(4201);
    expect(network.countsByType.get(EntityType.IoTDevice)).toBe(4200);
    expect(summarizeCounts(network.countsByType)).toBe(
      "4,200 IoT devices · 1 device",
    );
    expect(network.isActive).toBe(true);
  });

  test("the map draws a collection as one card", () => {
    expect(collectMapCards(hidden, "category:network")).toEqual([
      "collection:iot.device",
      "switch",
    ]);
    expect(collectMapCards(hidden, "collection:iot.device")).toEqual([]);
  });

  test("search leaves collections to the server", () => {
    expect(
      ids(searchInfrastructure(hidden, "iot")).includes(
        "collection:iot.device",
      ),
    ).toBe(false);
    expect(ids(searchInfrastructure(hidden, "core"))).toEqual(["switch"]);
  });

  test("an empty collection list changes nothing", () => {
    const plain: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      [],
      {
        rangeStart: RANGE_START,
        collections: [],
      },
    );
    expect(plain.nodes.has("stray")).toBe(true);
    expect(plain.resourceCount).toBe(3);
  });

  test("collection names come from Inventory, raw for unknown types", () => {
    expect(collectionName(EntityType.NetworkDevice)).toBe("Network Devices");
    expect(collectionName("quantum.computer")).toBe("quantum.computer");
    const unknown: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel([], [], {
        collections: [collection("quantum.computer", 2000, 2000)],
      });
    expect(unknown.rootIds).toEqual(["category:other"]);
    expect(node(unknown, "collection:quantum.computer").name).toBe(
      "quantum.computer",
    );
  });
});

describe("collection search terms", () => {
  test("terms the type label satisfies are dropped; the rest match names", () => {
    expect(
      collectionNameTerms(EntityType.IoTDevice, ["iot", "sensor-7"]),
    ).toEqual(["sensor-7"]);
    expect(
      collectionNameTerms(EntityType.IoTDevice, ["iot", "device"]),
    ).toEqual([]);
    expect(collectionNameTerms(EntityType.NetworkDevice, ["core"])).toEqual([
      "core",
    ]);
    // "Other" is what an unknown type is called in search, as in the tree.
    expect(collectionNameTerms("quantum.computer", ["other", "q1"])).toEqual([
      "q1",
    ]);
  });

  test("queries split the same way everywhere", () => {
    expect(infrastructureSearchTerms("  Core  SWITCH ")).toEqual([
      "core",
      "switch",
    ]);
    expect(infrastructureSearchTerms("   ")).toEqual([]);
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
    expect(ids(searchInfrastructure(model, "host primary"))).toEqual(["h3"]);
  });

  test("a blank query matches nothing rather than everything", () => {
    expect(searchInfrastructure(model, "   ")).toEqual([]);
  });

  test("a prebuilt index answers exactly like a fresh search", () => {
    const index: InfrastructureSearchIndex =
      buildInfrastructureSearchIndex(model);
    for (const query of ["web", "checkout", "host primary", "HOST", "zzz"]) {
      expect(ids(searchInfrastructure(model, query, index))).toEqual(
        ids(searchInfrastructure(model, query)),
      );
    }
    // Groups first, then by name; categories are never results.
    expect(
      index.map((entry: { id: string }): string => {
        return entry.id;
      })[0],
    ).toMatch(/^group:/);
    expect(
      index.some((entry: { id: string }): boolean => {
        return entry.id.startsWith("category:");
      }),
    ).toBe(false);
  });
});

describe("determinism", () => {
  test("a containment cycle is cut at its smallest key, whatever the edge order", () => {
    const entities: Array<TopologyEntity> = [
      entity("b", EntityType.KubernetesNode),
      entity("a", EntityType.KubernetesNode),
    ];
    const forward: Array<TopologyRelationship> = [
      edge("a", "b", EntityRelationshipType.MemberOf),
      edge("b", "a", EntityRelationshipType.MemberOf),
    ];
    const backward: Array<TopologyRelationship> = [...forward].reverse();
    for (const relationships of [forward, backward]) {
      const model: InfrastructureTopologyModel =
        buildInfrastructureTopologyModel(entities, relationships);
      expect(model.resourceCount).toBe(2);
      expect(node(model, "a").parentId).toBe("category:kubernetes");
      expect(node(model, "b").parentId).toBe("a");
    }
  });

  test("breakContainmentCycles cuts each cycle once and keeps the resources leading into it", () => {
    const orders: Array<Array<[string, string]>> = [
      [
        ["0", "c"],
        ["c", "d"],
        ["d", "e"],
        ["e", "c"],
        ["x", "y"],
        ["y", "x"],
        ["solo", "root"],
      ],
      [
        ["y", "x"],
        ["e", "c"],
        ["solo", "root"],
        ["x", "y"],
        ["d", "e"],
        ["0", "c"],
        ["c", "d"],
      ],
    ];
    for (const pairs of orders) {
      const parentOf: Map<string, string> = new Map<string, string>(pairs);
      breakContainmentCycles(parentOf);
      expect(
        Array.from(parentOf.entries()).sort(
          (left: [string, string], right: [string, string]): number => {
            return left[0] < right[0] ? -1 : 1;
          },
        ),
      ).toEqual([
        // "0" merely leads into the c → d → e cycle: it keeps its parent.
        ["0", "c"],
        ["d", "e"],
        ["e", "c"],
        ["solo", "root"],
        ["y", "x"],
      ]);
    }
  });

  test("services are listed by name, then by key when names tie", () => {
    const hosts: Array<TopologyEntity> = [entity("h1", EntityType.Host)];
    const services: Array<TopologyEntity> = [
      entity("svc-b", EntityType.Service, "api"),
      entity("svc-a", EntityType.Service, "api"),
      entity("svc-c", EntityType.Service, "aardvark"),
    ];
    const placements: Array<TopologyRelationship> = [
      edge("svc-b", "h1", EntityRelationshipType.HostedOn),
      edge("svc-a", "h1", EntityRelationshipType.HostedOn),
      edge("svc-c", "h1", EntityRelationshipType.RunsOn),
    ];
    for (const order of [placements, [...placements].reverse()]) {
      for (const entities of [
        [...hosts, ...services],
        [...[...services].reverse(), ...hosts],
      ]) {
        const model: InfrastructureTopologyModel =
          buildInfrastructureTopologyModel(entities, order);
        expect(node(model, "h1").serviceKeys).toEqual([
          "svc-c",
          "svc-a",
          "svc-b",
        ]);
      }
    }
  });

  test("equally named resources are ordered by key", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("k-2", EntityType.NetworkDevice, "switch"),
        entity("k-10", EntityType.NetworkDevice, "switch"),
        entity("K-3", EntityType.NetworkDevice, "switch"),
      ],
      [],
    );
    // Code-unit order, like the server's COLLATE "C".
    expect(node(model, "category:network").childIds).toEqual([
      "K-3",
      "k-10",
      "k-2",
    ]);
  });
});

describe("scale", () => {
  test("grouping thousands of replicas under one parent stays linear", () => {
    /*
     * Every one of these hosts is a replica of one of 2,000 workloads, all
     * under the one "Hosts & containers" category. Rebuilding the parent's
     * child list per group (and copying each bucket per member) made this
     * quadratic: minutes, not milliseconds.
     */
    const hosts: Array<TopologyEntity> = [];
    for (let workload: number = 0; workload < 2000; workload++) {
      for (let replica: number = 1; replica <= 10; replica++) {
        hosts.push(
          entity(
            `h-${workload}-${replica}`,
            EntityType.Host,
            `worker${workload}x-${replica}`,
          ),
        );
      }
    }
    for (let index: number = 0; index < 20000; index++) {
      // Replica numbers have at most four digits, like real ones.
      hosts.push(
        entity(`web-${index}`, EntityType.Host, `web-${index % 10000}`),
      );
    }
    const start: bigint = process.hrtime.bigint();
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      hosts,
      [],
    );
    const elapsedMs: number = Number(process.hrtime.bigint() - start) / 1000000;
    expect(model.groupCount).toBe(2001);
    expect(model.resourceCount).toBe(40000);
    const compute: InfrastructureNode = node(model, "category:compute");
    expect(compute.childIds).toHaveLength(2001);
    const web: InfrastructureNode = node(
      model,
      "group:category:compute:host|web",
    );
    expect(web.childIds).toHaveLength(20000);
    expect(describeInfrastructureNode(web)).toBe("20,000 hosts");
    expect(elapsedMs).toBeLessThan(5000);
  }, 60000);

  test("a very deep containment chain neither overflows nor loses anything", () => {
    const entities: Array<TopologyEntity> = [];
    const relationships: Array<TopologyRelationship> = [];
    for (let index: number = 0; index < 20000; index++) {
      entities.push(entity(`c${index}`, EntityType.Container));
      if (index > 0) {
        relationships.push(
          edge(`c${index}`, `c${index - 1}`, EntityRelationshipType.PartOf),
        );
      }
    }
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      relationships,
    );
    expect(model.resourceCount).toBe(20000);
    expect(node(model, "c0").resourceCount).toBe(20000);
    expect(getInfrastructurePath(model, "c19999")).toHaveLength(20001);
  }, 60000);
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
      [entity("q", "quantum.computer")],
      [],
    );
    expect(model.rootIds).toEqual(["category:other"]);
  });

  test("rows without a key are skipped", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [{ entityType: EntityType.Host, displayName: "nameless" }],
      [],
    );
    expect(model.resourceCount).toBe(0);
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
