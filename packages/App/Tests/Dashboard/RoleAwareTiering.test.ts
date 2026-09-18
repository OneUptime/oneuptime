import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TIERED_LAYOUT_TOP_MARGIN,
  TIERED_TIER_GAP,
  TopologyGroupBox,
  computeTieredTopologyLayout,
  computeTieredTopologyModel,
  tierForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";

/*
 * Role-aware tiering (issue #3192).
 *
 * The tiered layout used to decide "core or access" purely from the bridge
 * forwarding database: a managed device with no FDB edges was assumed to be
 * upstream of everything. That reads backwards for the ping-only devices
 * this feature exists for — nothing walks them, so they report no endpoints,
 * so an access point or a camera was drawn at the same level as the router.
 * These tests pin the new precedence: endpoint > unmanaged > role > FDB.
 *
 * Sibling coverage of the tier matrix WITHOUT roles lives in
 * TieredTopologyLayout.test.ts; this file only exercises the role paths and
 * the layout consequences of them.
 */

const WIDTH: number = 1000;

type MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeDevice: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
};

const makeUnmanaged: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "unmanaged",
    ...overrides,
  };
};

const makeEndpoint: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
    ...overrides,
  };
};

type MakeEdgeFunction = (
  from: string,
  to: string,
  protocols?: NetworkTopologyEdge["protocols"],
) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
  protocols?: NetworkTopologyEdge["protocols"],
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: protocols };
};

// Roles that mean "everything else reaches the world through this box".
const CORE_ROLES: Array<NetworkTopologyDeviceRole> = [
  "router",
  "firewall",
  "loadBalancer",
];

/*
 * Every other role in the legend. "switch" is deliberately in here: it is
 * infrastructure, but infrastructure that hangs off a router, and the top
 * tier is reserved for the boxes that hang off nothing.
 */
const NON_CORE_ROLES: Array<NetworkTopologyDeviceRole> = [
  "switch",
  "wirelessAccessPoint",
  "server",
  "storage",
  "printer",
  "camera",
  "phone",
  "host",
];

/*
 * Every value the payload can carry, including the "we did not commit"
 * answer. Used where the assertion is "the role is not consulted at all".
 */
const EVERY_ROLE: Array<NetworkTopologyDeviceRole> = [
  ...CORE_ROLES,
  ...NON_CORE_ROLES,
  "unknown",
];

const NO_FDB_EDGES: Set<string> = new Set<string>();

describe("tierForNode — endpoints ignore the role entirely", () => {
  test("an endpoint tagged with a core role is still tier 2", () => {
    /*
     * Tier 2 is what the tiered layout packs into per-switch group boxes.
     * If a role could lift an endpoint out of tier 2 the box would lose a
     * member it is drawn around, so the endpoint check has to come first
     * whatever the role says.
     */
    const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
      name: "pos-1",
      role: "router",
    });
    expect(tierForNode(endpoint, NO_FDB_EDGES)).toBe(2);
  });

  test("an endpoint keeps tier 2 for every role in the legend", () => {
    for (const role of EVERY_ROLE) {
      const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:kiosk", {
        role: role,
      });
      expect(tierForNode(endpoint, NO_FDB_EDGES)).toBe(2);
    }
  });

  test("an endpoint with an FDB edge and a core role is still tier 2", () => {
    // Both other signals point away from tier 2; the kind still wins.
    const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:pos-2", {
      role: "firewall",
    });
    expect(tierForNode(endpoint, new Set<string>(["endpoint:pos-2"]))).toBe(2);
  });
});

describe("tierForNode — unmanaged peers ignore the role entirely", () => {
  test("an unmanaged peer tagged with a core role is still tier 1", () => {
    /*
     * An unmanaged node exists only because a neighbour advertised it. We
     * have no evidence of our own about what it does, so a role that rode
     * in on that advertisement must not promote somebody else's box into
     * our core tier.
     */
    const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:peer-core", {
      role: "router",
    });
    expect(tierForNode(peer, NO_FDB_EDGES)).toBe(1);
  });

  test("an unmanaged peer stays tier 1 for every role in the legend", () => {
    for (const role of EVERY_ROLE) {
      const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:peer", {
        role: role,
      });
      expect(tierForNode(peer, NO_FDB_EDGES)).toBe(1);
    }
  });

  test("an unmanaged peer with a core role and an FDB edge is still tier 1", () => {
    const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:peer-fdb", {
      role: "loadBalancer",
    });
    expect(tierForNode(peer, new Set<string>(["unmanaged:peer-fdb"]))).toBe(1);
  });
});

describe("tierForNode — a role on a managed device settles the tier", () => {
  test("router is tier 0", () => {
    expect(
      tierForNode(makeDevice("dev", { role: "router" }), NO_FDB_EDGES),
    ).toBe(0);
  });

  test("firewall is tier 0", () => {
    expect(
      tierForNode(makeDevice("dev", { role: "firewall" }), NO_FDB_EDGES),
    ).toBe(0);
  });

  test("loadBalancer is tier 0", () => {
    expect(
      tierForNode(makeDevice("dev", { role: "loadBalancer" }), NO_FDB_EDGES),
    ).toBe(0);
  });

  test("switch is tier 1 — a switch hangs off a router, it is not the core", () => {
    expect(
      tierForNode(makeDevice("dev", { role: "switch" }), NO_FDB_EDGES),
    ).toBe(1);
  });

  test("every access-layer and leaf role is tier 1", () => {
    for (const role of NON_CORE_ROLES) {
      const device: NetworkTopologyNode = makeDevice(`dev-${role}`, {
        role: role,
      });
      expect(tierForNode(device, NO_FDB_EDGES)).toBe(1);
    }
  });

  test("every core role is tier 0", () => {
    for (const role of CORE_ROLES) {
      const device: NetworkTopologyNode = makeDevice(`dev-${role}`, {
        role: role,
      });
      expect(tierForNode(device, NO_FDB_EDGES)).toBe(0);
    }
  });

  test("the role beats the FDB heuristic in both directions", () => {
    /*
     * The heuristic and the role disagree in both possible ways here. A
     * router that happens to have learned a MAC is still the core, and a
     * printer nothing has learned a MAC through is still a leaf — a stated
     * role is a fact about the box, the FDB is an inference about it.
     */
    const routerWithFdb: NetworkTopologyNode = makeDevice("core-1", {
      role: "router",
    });
    expect(tierForNode(routerWithFdb, new Set<string>(["core-1"]))).toBe(0);

    const printerWithoutFdb: NetworkTopologyNode = makeDevice("printer-1", {
      role: "printer",
    });
    expect(tierForNode(printerWithoutFdb, NO_FDB_EDGES)).toBe(1);
  });
});

describe("tierForNode — no usable role falls back to the FDB heuristic", () => {
  test('role "unknown" with an FDB edge is tier 1', () => {
    /*
     * "unknown" is the classifier's honest answer, not a role. It has to
     * behave exactly like an absent role or the classifier would silently
     * change the layout every time it declined to commit.
     */
    const device: NetworkTopologyNode = makeDevice("sw-1", {
      role: "unknown",
    });
    expect(tierForNode(device, new Set<string>(["sw-1"]))).toBe(1);
  });

  test('role "unknown" with no FDB edge is tier 0', () => {
    const device: NetworkTopologyNode = makeDevice("sw-1", {
      role: "unknown",
    });
    expect(tierForNode(device, NO_FDB_EDGES)).toBe(0);
  });

  test("an absent role with an FDB edge is tier 1", () => {
    const device: NetworkTopologyNode = makeDevice("sw-2");
    expect(device.role).toBeUndefined();
    expect(tierForNode(device, new Set<string>(["sw-2"]))).toBe(1);
  });

  test("an absent role with no FDB edge is tier 0", () => {
    const device: NetworkTopologyNode = makeDevice("sw-2");
    expect(tierForNode(device, NO_FDB_EDGES)).toBe(0);
  });

  test('an absent role and "unknown" agree on every FDB state', () => {
    const withoutRole: NetworkTopologyNode = makeDevice("dev-1");
    const withUnknownRole: NetworkTopologyNode = makeDevice("dev-1", {
      role: "unknown",
    });
    for (const fdbIds of [NO_FDB_EDGES, new Set<string>(["dev-1"])]) {
      expect(tierForNode(withUnknownRole, fdbIds)).toBe(
        tierForNode(withoutRole, fdbIds),
      );
    }
  });

  test("the FDB set is consulted by id, not by identity of the node object", () => {
    // A device whose id is absent from a non-empty set is still tier 0.
    const device: NetworkTopologyNode = makeDevice("dev-alone");
    expect(tierForNode(device, new Set<string>(["some-other-device"]))).toBe(0);
  });
});

describe("tierForNode — regression guards for issue #3192", () => {
  test("REGRESSION: a ping-only wireless access point with no FDB edges is tier 1, not tier 0", () => {
    /*
     * THE bug from issue #3192. A wireless AP added by ping alone answers
     * no SNMP, so it can never appear in anybody's forwarding database,
     * so the old FDB-only heuristic ranked it at CORE level — drawn beside
     * the router it actually hangs off, and competing with that router to
     * root the parent-child tree. With the operator's role on the device
     * it drops to tier 1 where it belongs.
     */
    const pingOnlyAccessPoint: NetworkTopologyNode = makeDevice("ap-lobby", {
      name: "AP Lobby",
      role: "wirelessAccessPoint",
    });
    expect(tierForNode(pingOnlyAccessPoint, NO_FDB_EDGES)).toBe(1);
    expect(tierForNode(pingOnlyAccessPoint, NO_FDB_EDGES)).not.toBe(0);
  });

  test("REGRESSION: every ping-only leaf role stays out of the core tier", () => {
    /*
     * The AP is just the case that was reported. A camera, a printer and a
     * VoIP phone monitored by ping fail in exactly the same way, so the
     * whole leaf set is pinned here.
     */
    const pingOnlyRoles: Array<NetworkTopologyDeviceRole> = [
      "camera",
      "printer",
      "phone",
      "server",
      "host",
    ];
    for (const role of pingOnlyRoles) {
      const device: NetworkTopologyNode = makeDevice(`ping-only-${role}`, {
        role: role,
      });
      expect(tierForNode(device, NO_FDB_EDGES)).toBe(1);
    }
  });

  test("the same device WITHOUT a role still lands in the core tier", () => {
    /*
     * Not an endorsement of the old behaviour — a statement of what the
     * role is buying. Nothing changed for estates that never set one.
     */
    const untagged: NetworkTopologyNode = makeDevice("ap-lobby", {
      name: "AP Lobby",
    });
    expect(tierForNode(untagged, NO_FDB_EDGES)).toBe(0);
  });
});

describe("tierForNode — purity and determinism", () => {
  test("repeated calls on the same inputs agree", () => {
    const device: NetworkTopologyNode = makeDevice("ap-1", {
      role: "wirelessAccessPoint",
    });
    const fdbIds: Set<string> = new Set<string>(["ap-1"]);
    expect(tierForNode(device, fdbIds)).toBe(tierForNode(device, fdbIds));
  });

  test("the insertion order of the FDB set never changes the answer", () => {
    const device: NetworkTopologyNode = makeDevice("sw-1");
    const forward: Set<string> = new Set<string>(["a", "sw-1", "z"]);
    const backward: Set<string> = new Set<string>(["z", "sw-1", "a"]);
    expect(tierForNode(device, forward)).toBe(tierForNode(device, backward));
  });

  test("tiering does not mutate the node or the FDB set", () => {
    const device: NetworkTopologyNode = makeDevice("ap-1", {
      role: "wirelessAccessPoint",
    });
    const fdbIds: Set<string> = new Set<string>(["sw-1"]);
    tierForNode(device, fdbIds);
    expect(device.role).toBe("wirelessAccessPoint");
    expect(Array.from(fdbIds)).toEqual(["sw-1"]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Integration: the same site drawn through the tiered layout.
 *
 * One core router, one access switch with two endpoints on it, and the
 * ping-only access point from the issue. The AP is a managed device with a
 * role and no FDB edges — exactly the shape that used to be ranked at core
 * level.
 */

const coreRouter: NetworkTopologyNode = makeDevice("core-router", {
  name: "core-router",
  role: "router",
});
const accessSwitch: NetworkTopologyNode = makeDevice("sw-a", {
  name: "sw-a",
  role: "switch",
});
const accessPoint: NetworkTopologyNode = makeDevice("ap-lobby", {
  /*
   * Name sorts BEFORE the switch, so any ordering assertion below is about
   * the childless-trails-anchored rule and not about alphabetics.
   */
  name: "ap-lobby",
  role: "wirelessAccessPoint",
});
const pos1: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
  name: "pos-1",
});
const pos2: NetworkTopologyNode = makeEndpoint("endpoint:pos-2", {
  name: "pos-2",
});

const siteNodes: Array<NetworkTopologyNode> = [
  coreRouter,
  accessSwitch,
  accessPoint,
  pos1,
  pos2,
];

const siteEdges: Array<NetworkTopologyEdge> = [
  makeEdge("core-router", "sw-a", ["lldp"]),
  // The AP's cable was drawn by hand — that is the whole point of the issue.
  makeEdge("sw-a", "ap-lobby", ["manual"]),
  makeEdge("sw-a", "endpoint:pos-1", ["fdb"]),
  makeEdge("sw-a", "endpoint:pos-2", ["fdb"]),
];

interface TieredModel {
  positions: Map<string, { x: number; y: number }>;
  groups: Array<TopologyGroupBox>;
}

describe("computeTieredTopologyLayout — a role-tagged access point is its own tier-1 node", () => {
  const model: TieredModel = computeTieredTopologyModel(
    siteNodes,
    siteEdges,
    WIDTH,
  );
  const layout: Map<string, { x: number; y: number }> =
    computeTieredTopologyLayout(siteNodes, siteEdges, WIDTH);

  test("every node is placed exactly once", () => {
    expect(layout.size).toBe(siteNodes.length);
  });

  test("the router alone occupies the core tier", () => {
    expect(layout.get("core-router")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    // A lone tier-0 node is centred on the width.
    expect(layout.get("core-router")!.x).toBe(WIDTH / 2);
  });

  test("the access point shares the switch's row, one tier under the router", () => {
    const routerY: number = layout.get("core-router")!.y;
    const switchY: number = layout.get("sw-a")!.y;
    expect(layout.get("ap-lobby")!.y).toBe(switchY);
    expect(switchY - routerY).toBe(TIERED_TIER_GAP);
  });

  test("the access point is NOT inside any endpoint group box", () => {
    /*
     * Group boxes are the per-switch blocks of tier-2 endpoints. A managed
     * device drawn inside one would read as "a thing hanging off the
     * switch like a POS terminal", which is precisely the confusion the
     * role is there to remove.
     */
    for (const box of model.groups) {
      expect(box.nodeIds).not.toContain("ap-lobby");
    }
  });

  test("the only group box belongs to the switch and holds only endpoints", () => {
    expect(model.groups.length).toBe(1);
    const box: TopologyGroupBox = model.groups[0]!;
    expect(box.anchorNodeId).toBe("sw-a");
    expect(box.nodeIds).toEqual(["endpoint:pos-1", "endpoint:pos-2"]);
    expect(box.endpointCount).toBe(2);
  });

  test("the access point sits geometrically clear of the switch's group box", () => {
    const box: TopologyGroupBox = model.groups[0]!;
    const apX: number = model.positions.get("ap-lobby")!.x;
    expect(apX > box.x + box.width || apX < box.x).toBe(true);
  });

  test("a childless tier-1 node trails the switch that owns endpoints", () => {
    // Alphabetically "ap-lobby" < "sw-a", so this is the column rule, not the sort.
    expect(layout.get("ap-lobby")!.x).toBeGreaterThan(layout.get("sw-a")!.x);
  });

  test("the endpoints stay in tier 2 below the switch", () => {
    const switchY: number = layout.get("sw-a")!.y;
    expect(layout.get("endpoint:pos-1")!.y).toBe(switchY + TIERED_TIER_GAP);
    expect(layout.get("endpoint:pos-2")!.y).toBe(switchY + TIERED_TIER_GAP);
  });

  test("the same site with the AP's role stripped puts it back at core level", () => {
    /*
     * The before picture, drawn from the identical graph: without the
     * operator's role the AP has no FDB edges, so the heuristic promotes
     * it and it lands on the router's row.
     */
    const untaggedNodes: Array<NetworkTopologyNode> = siteNodes.map(
      (node: NetworkTopologyNode): NetworkTopologyNode => {
        return node.id === "ap-lobby" ? makeDevice("ap-lobby") : node;
      },
    );
    const untaggedLayout: Map<string, { x: number; y: number }> =
      computeTieredTopologyLayout(untaggedNodes, siteEdges, WIDTH);
    expect(untaggedLayout.get("ap-lobby")!.y).toBe(
      untaggedLayout.get("core-router")!.y,
    );
    // ...and with the role it is a full tier lower.
    expect(layout.get("ap-lobby")!.y).toBeGreaterThan(
      untaggedLayout.get("ap-lobby")!.y,
    );
  });

  test('an AP tagged "unknown" behaves exactly like an untagged one', () => {
    const unknownRoleNodes: Array<NetworkTopologyNode> = siteNodes.map(
      (node: NetworkTopologyNode): NetworkTopologyNode => {
        return node.id === "ap-lobby"
          ? makeDevice("ap-lobby", { role: "unknown" })
          : node;
      },
    );
    const untaggedNodes: Array<NetworkTopologyNode> = siteNodes.map(
      (node: NetworkTopologyNode): NetworkTopologyNode => {
        return node.id === "ap-lobby" ? makeDevice("ap-lobby") : node;
      },
    );
    const unknownLayout: Map<string, { x: number; y: number }> =
      computeTieredTopologyLayout(unknownRoleNodes, siteEdges, WIDTH);
    const untaggedLayout: Map<string, { x: number; y: number }> =
      computeTieredTopologyLayout(untaggedNodes, siteEdges, WIDTH);
    for (const node of siteNodes) {
      expect(unknownLayout.get(node.id)).toEqual(untaggedLayout.get(node.id));
    }
  });
});

describe("computeTieredTopologyLayout — roles on endpoints never move them out of their group", () => {
  test("an endpoint tagged with a core role stays inside its switch's box", () => {
    /*
     * Endpoint classification and device role come from different places,
     * so a "router"-ish endpoint is a real possibility. It must not tear a
     * hole in the group box it is drawn inside.
     */
    const roleTaggedEndpoint: NetworkTopologyNode = makeEndpoint(
      "endpoint:pos-3",
      { name: "pos-3", role: "router" },
    );
    const model: TieredModel = computeTieredTopologyModel(
      [...siteNodes, roleTaggedEndpoint],
      [...siteEdges, makeEdge("sw-a", "endpoint:pos-3", ["fdb"])],
      WIDTH,
    );

    expect(model.groups.length).toBe(1);
    const box: TopologyGroupBox = model.groups[0]!;
    expect(box.nodeIds).toContain("endpoint:pos-3");
    expect(box.endpointCount).toBe(3);

    const point: { x: number; y: number } =
      model.positions.get("endpoint:pos-3")!;
    expect(point.x).toBeGreaterThan(box.x);
    expect(point.x).toBeLessThan(box.x + box.width);
    expect(point.y).toBeGreaterThan(box.y);
    expect(point.y).toBeLessThan(box.y + box.height);
    // Still a full tier below the switch it hangs off.
    expect(point.y).toBe(model.positions.get("sw-a")!.y + TIERED_TIER_GAP);
  });
});

describe("computeTieredTopologyLayout — role-aware tiering stays deterministic", () => {
  test("identical inputs yield identical coordinates and boxes", () => {
    const first: TieredModel = computeTieredTopologyModel(
      siteNodes,
      siteEdges,
      WIDTH,
    );
    const second: TieredModel = computeTieredTopologyModel(
      siteNodes,
      siteEdges,
      WIDTH,
    );
    for (const node of siteNodes) {
      expect(second.positions.get(node.id)).toEqual(
        first.positions.get(node.id),
      );
    }
    expect(second.groups).toEqual(first.groups);
  });

  test("reversing the node and edge arrays changes nothing", () => {
    const original: TieredModel = computeTieredTopologyModel(
      siteNodes,
      siteEdges,
      WIDTH,
    );
    const reordered: TieredModel = computeTieredTopologyModel(
      [...siteNodes].reverse(),
      [...siteEdges].reverse(),
      WIDTH,
    );
    for (const node of siteNodes) {
      expect(reordered.positions.get(node.id)).toEqual(
        original.positions.get(node.id),
      );
    }
    expect(reordered.groups).toEqual(original.groups);
  });

  test("flipping every edge's direction changes nothing", () => {
    // Attachment and tiering are both undirected; only the role is a fact.
    const original: TieredModel = computeTieredTopologyModel(
      siteNodes,
      siteEdges,
      WIDTH,
    );
    const flipped: TieredModel = computeTieredTopologyModel(
      siteNodes,
      siteEdges.map((edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
      }),
      WIDTH,
    );
    for (const node of siteNodes) {
      expect(flipped.positions.get(node.id)).toEqual(
        original.positions.get(node.id),
      );
    }
    expect(flipped.groups).toEqual(original.groups);
  });

  test("a graph of nothing but role-tagged leaves has an empty core tier", () => {
    /*
     * The pathological ping-only site: no SNMP anywhere, so no FDB edges at
     * all. Every device is a leaf, so tier 0 is empty and tier 1 starts at
     * the very top of the frame rather than a tier gap down.
     */
    const leaves: Array<NetworkTopologyNode> = [
      makeDevice("ap-1", { name: "ap-1", role: "wirelessAccessPoint" }),
      makeDevice("cam-1", { name: "cam-1", role: "camera" }),
      makeDevice("printer-1", { name: "printer-1", role: "printer" }),
    ];
    const layout: Map<string, { x: number; y: number }> =
      computeTieredTopologyLayout(leaves, [], WIDTH);
    for (const leaf of leaves) {
      expect(layout.get(leaf.id)!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    }
  });
});
