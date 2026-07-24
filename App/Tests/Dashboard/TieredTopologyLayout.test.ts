import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TIERED_ENDPOINT_NODE_SPACING,
  TIERED_GROUP_BOX_BOTTOM_PAD,
  TIERED_GROUP_BOX_TOP_PAD,
  TIERED_GROUP_GAP,
  TIERED_LAYOUT_TOP_MARGIN,
  TIERED_NODE_SPACING,
  TIERED_ROW_GAP,
  TIERED_SIDE_MARGIN,
  TIERED_TIER_GAP,
  TopologyGroupBox,
  computeTieredTopologyLayout,
  computeTieredTopologyModel,
  tierForNode,
  wrapNodeLabel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";

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

/*
 * Canonical unit-site sample: one router uplinked to two switches over
 * LLDP, endpoints hanging off the switches over FDB, plus an unmanaged
 * CDP peer and an orphaned endpoint (its switch fell out of the view).
 */
const router: NetworkTopologyNode = makeDevice("router-1");
const switchA: NetworkTopologyNode = makeDevice("switch-a");
const switchB: NetworkTopologyNode = makeDevice("switch-b");
const unmanagedAp: NetworkTopologyNode = makeUnmanaged("unmanaged:ap-1");
const pos1: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
  name: "pos-1",
});
const pos2: NetworkTopologyNode = makeEndpoint("endpoint:pos-2", {
  name: "pos-2",
});
const orphanEndpoint: NetworkTopologyNode = makeEndpoint("endpoint:orphan", {
  name: "orphan",
});

const sampleNodes: Array<NetworkTopologyNode> = [
  router,
  switchA,
  switchB,
  unmanagedAp,
  pos1,
  pos2,
  orphanEndpoint,
];

const sampleEdges: Array<NetworkTopologyEdge> = [
  makeEdge("router-1", "switch-a", ["lldp"]),
  makeEdge("router-1", "switch-b", ["lldp", "cdp"]),
  makeEdge("switch-a", "unmanaged:ap-1", ["cdp"]),
  makeEdge("switch-a", "endpoint:pos-1", ["fdb"]),
  makeEdge("switch-b", "endpoint:pos-2", ["fdb"]),
];

type LayoutMap = Map<string, { x: number; y: number }>;

// Group layout points into rows by exact y coordinate.
type RowsOfFunction = (layout: LayoutMap) => Map<number, Array<string>>;
const rowsOf: RowsOfFunction = (
  layout: LayoutMap,
): Map<number, Array<string>> => {
  const rows: Map<number, Array<string>> = new Map();
  for (const [id, point] of layout.entries()) {
    const row: Array<string> = rows.get(point.y) || [];
    row.push(id);
    rows.set(point.y, row);
  }
  return rows;
};

/*
 * A switch with `count` endpoints attached over FDB. Endpoint names are
 * zero padded so (name, id) ordering matches creation order.
 */
interface SwitchWithEndpoints {
  device: NetworkTopologyNode;
  endpoints: Array<NetworkTopologyNode>;
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  endpointIds: Array<string>;
}

type MakeSwitchFunction = (id: string, count: number) => SwitchWithEndpoints;

const makeSwitchWithEndpoints: MakeSwitchFunction = (
  id: string,
  count: number,
): SwitchWithEndpoints => {
  const device: NetworkTopologyNode = makeDevice(id);
  const endpoints: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  for (let i: number = 0; i < count; i++) {
    const endpointId: string = `endpoint:${id}-${String(i).padStart(2, "0")}`;
    endpoints.push(
      makeEndpoint(endpointId, {
        name: `${id}-${String(i).padStart(2, "0")}`,
      }),
    );
    edges.push(makeEdge(id, endpointId, ["fdb"]));
  }
  return {
    device: device,
    endpoints: endpoints,
    nodes: [device, ...endpoints],
    edges: edges,
    endpointIds: endpoints.map((endpoint: NetworkTopologyNode): string => {
      return endpoint.id;
    }),
  };
};

// [min x, max x] covered by a set of ids.
type XRangeFunction = (
  layout: LayoutMap,
  ids: Array<string>,
) => [number, number];
const xRange: XRangeFunction = (
  layout: LayoutMap,
  ids: Array<string>,
): [number, number] => {
  const xs: Array<number> = ids.map((id: string): number => {
    return layout.get(id)!.x;
  });
  return [Math.min(...xs), Math.max(...xs)];
};

describe("tierForNode — tier assignment matrix", () => {
  const fdbIds: Set<string> = new Set<string>(["switch-a", "endpoint:pos-1"]);

  test("managed device with no FDB edges is tier 0 (router/core)", () => {
    expect(tierForNode(router, fdbIds)).toBe(0);
  });

  test("degree-0 managed device is tier 0", () => {
    expect(tierForNode(makeDevice("lonely-core"), new Set<string>())).toBe(0);
  });

  test("managed device touched by an FDB edge is tier 1 (switch)", () => {
    expect(tierForNode(switchA, fdbIds)).toBe(1);
  });

  test("unmanaged node is tier 1 even with no edges", () => {
    expect(tierForNode(unmanagedAp, new Set<string>())).toBe(1);
  });

  test("endpoint node is tier 2 regardless of edges", () => {
    expect(tierForNode(pos1, fdbIds)).toBe(2);
    // Orphaned endpoint (no edges at all) still lands in tier 2.
    expect(tierForNode(orphanEndpoint, new Set<string>())).toBe(2);
  });

  test("node without a kind falls back to isManaged semantics", () => {
    const legacyManaged: NetworkTopologyNode = {
      id: "legacy-managed",
      name: "legacy-managed",
      isManaged: true,
      status: "up",
    };
    const legacyUnmanaged: NetworkTopologyNode = {
      id: "unmanaged:legacy",
      name: "legacy peer",
      isManaged: false,
      status: "unknown",
    };
    expect(tierForNode(legacyManaged, new Set<string>())).toBe(0);
    expect(tierForNode(legacyUnmanaged, new Set<string>())).toBe(1);
  });
});

describe("computeTieredTopologyLayout — tier placement", () => {
  const layout: LayoutMap = computeTieredTopologyLayout(
    sampleNodes,
    sampleEdges,
    WIDTH,
  );

  test("places every node exactly once with finite coordinates", () => {
    expect(layout.size).toBe(sampleNodes.length);
    for (const node of sampleNodes) {
      const point: { x: number; y: number } | undefined = layout.get(node.id);
      expect(point).toBeDefined();
      expect(Number.isFinite(point!.x)).toBe(true);
      expect(Number.isFinite(point!.y)).toBe(true);
    }
  });

  test("tiers stack top to bottom: router above switches above endpoints", () => {
    const routerY: number = layout.get("router-1")!.y;
    const switchY: number = layout.get("switch-a")!.y;
    const endpointY: number = layout.get("endpoint:pos-1")!.y;

    expect(routerY).toBe(TIERED_LAYOUT_TOP_MARGIN);
    expect(switchY).toBeGreaterThan(routerY);
    expect(endpointY).toBeGreaterThan(switchY);
    // Single-row tiers sit exactly one tier gap apart.
    expect(switchY - routerY).toBe(TIERED_TIER_GAP);
    expect(endpointY - switchY).toBe(TIERED_TIER_GAP);
  });

  test("switches and unmanaged peers share tier 1's row", () => {
    expect(layout.get("unmanaged:ap-1")!.y).toBe(layout.get("switch-a")!.y);
    expect(layout.get("switch-b")!.y).toBe(layout.get("switch-a")!.y);
  });

  test("orphaned endpoints share the endpoint tier", () => {
    expect(layout.get("endpoint:orphan")!.y).toBe(
      layout.get("endpoint:pos-1")!.y,
    );
  });

  test("a lone tier-0 node sits exactly at the horizontal centre", () => {
    expect(layout.get("router-1")!.x).toBe(WIDTH / 2);
  });

  test("every node stays clear of the side margins", () => {
    for (const point of layout.values()) {
      expect(point.x).toBeGreaterThanOrEqual(TIERED_SIDE_MARGIN);
      expect(point.x).toBeLessThanOrEqual(WIDTH - TIERED_SIDE_MARGIN);
    }
  });

  test("the band of columns is centered on the width", () => {
    // Tier-1 nodes plus the trailing unattached column, left to right.
    const bandXs: Array<number> = [
      layout.get("switch-a")!.x,
      layout.get("unmanaged:ap-1")!.x,
      layout.get("endpoint:orphan")!.x,
    ];
    expect((Math.min(...bandXs) + Math.max(...bandXs)) / 2).toBeCloseTo(
      WIDTH / 2,
      6,
    );
  });

  test("tier 1 is ordered by name then id, left to right", () => {
    // "switch-a" < "switch-b", and the childless peer trails both.
    expect(layout.get("switch-a")!.x).toBeLessThan(layout.get("switch-b")!.x);
    expect(layout.get("switch-b")!.x).toBeLessThan(
      layout.get("unmanaged:ap-1")!.x,
    );
  });

  test("no two nodes in a row are closer than the endpoint spacing", () => {
    for (const [, ids] of rowsOf(layout).entries()) {
      const xs: Array<number> = ids
        .map((id: string) => {
          return layout.get(id)!.x;
        })
        .sort((a: number, b: number) => {
          return a - b;
        });
      for (let i: number = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(
          TIERED_ENDPOINT_NODE_SPACING,
        );
      }
    }
  });

  test("adjacent columns that own endpoints are a group gap apart", () => {
    /*
     * Both switches carry a single endpoint, so each column is one device
     * slot wide and the group gap separates the two blocks.
     */
    expect(layout.get("switch-b")!.x - layout.get("switch-a")!.x).toBe(
      TIERED_NODE_SPACING + TIERED_GROUP_GAP,
    );
  });
});

describe("computeTieredTopologyLayout — endpoints group under their switch", () => {
  /*
   * Three switches with distinct endpoint counts. Names are chosen so the
   * alphabetical tier-1 order (sw-a, sw-b, sw-c) is unambiguous.
   */
  const swA: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-a", 3);
  const swB: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-b", 4);
  const swC: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-c", 2);
  const core: NetworkTopologyNode = makeDevice("core-router");

  const nodes: Array<NetworkTopologyNode> = [
    core,
    ...swA.nodes,
    ...swB.nodes,
    ...swC.nodes,
  ];
  const edges: Array<NetworkTopologyEdge> = [
    makeEdge("core-router", "sw-a", ["lldp"]),
    makeEdge("core-router", "sw-b", ["lldp"]),
    makeEdge("core-router", "sw-c", ["lldp"]),
    ...swA.edges,
    ...swB.edges,
    ...swC.edges,
  ];

  const layout: LayoutMap = computeTieredTopologyLayout(nodes, edges, WIDTH);

  test("each switch's endpoints occupy a contiguous x range", () => {
    const ranges: Array<[number, number]> = [
      xRange(layout, swA.endpointIds),
      xRange(layout, swB.endpointIds),
      xRange(layout, swC.endpointIds),
    ];
    const allEndpointIds: Array<string> = [
      ...swA.endpointIds,
      ...swB.endpointIds,
      ...swC.endpointIds,
    ];

    ranges.forEach((range: [number, number], index: number): void => {
      const own: Array<string> = [
        swA.endpointIds,
        swB.endpointIds,
        swC.endpointIds,
      ][index]!;
      for (const id of allEndpointIds) {
        if (own.includes(id)) {
          continue;
        }
        const x: number = layout.get(id)!.x;
        // No foreign endpoint may land inside this group's span.
        expect(x < range[0] || x > range[1]).toBe(true);
      }
    });
  });

  test("group blocks do not overlap and follow their switches' order", () => {
    const rangeA: [number, number] = xRange(layout, swA.endpointIds);
    const rangeB: [number, number] = xRange(layout, swB.endpointIds);
    const rangeC: [number, number] = xRange(layout, swC.endpointIds);
    expect(rangeA[1]).toBeLessThan(rangeB[0]);
    expect(rangeB[1]).toBeLessThan(rangeC[0]);
    expect(layout.get("sw-a")!.x).toBeLessThan(layout.get("sw-b")!.x);
    expect(layout.get("sw-b")!.x).toBeLessThan(layout.get("sw-c")!.x);
  });

  test("every endpoint row is centered on its own switch", () => {
    const groups: Array<SwitchWithEndpoints> = [swA, swB, swC];
    for (const group of groups) {
      const switchX: number = layout.get(group.device.id)!.x;
      const byRow: Map<number, Array<string>> = new Map();
      for (const id of group.endpointIds) {
        const y: number = layout.get(id)!.y;
        byRow.set(y, [...(byRow.get(y) || []), id]);
      }
      for (const [, ids] of byRow.entries()) {
        const [min, max]: [number, number] = xRange(layout, ids);
        expect((min + max) / 2).toBeCloseTo(switchX, 6);
      }
    }
  });

  test("every endpoint sits directly below its own switch's tier row", () => {
    const switchY: number = layout.get("sw-a")!.y;
    for (const id of [
      ...swA.endpointIds,
      ...swB.endpointIds,
      ...swC.endpointIds,
    ]) {
      expect(layout.get(id)!.y).toBeGreaterThan(switchY);
    }
  });

  test("an endpoint seen on two switches picks the lower one by name", () => {
    const shared: NetworkTopologyNode = makeEndpoint("endpoint:shared", {
      name: "shared",
    });
    const twoWay: LayoutMap = computeTieredTopologyLayout(
      [core, swA.device, swB.device, shared],
      [
        makeEdge("core-router", "sw-a", ["lldp"]),
        makeEdge("core-router", "sw-b", ["lldp"]),
        // Reversed direction on purpose — attachment is undirected.
        makeEdge("endpoint:shared", "sw-b", ["fdb"]),
        makeEdge("sw-a", "endpoint:shared", ["fdb"]),
      ],
      WIDTH,
    );
    expect(twoWay.get("endpoint:shared")!.x).toBe(twoWay.get("sw-a")!.x);
  });

  test("a non-FDB link to a switch anchors an endpoint as a fallback", () => {
    // Legacy payloads carry no protocols; the endpoint still finds a home.
    const legacy: LayoutMap = computeTieredTopologyLayout(
      [swA.device, ...swA.endpoints, pos1],
      [...swA.edges, makeEdge("sw-a", "endpoint:pos-1")],
      WIDTH,
    );
    const range: [number, number] = xRange(legacy, [
      ...swA.endpointIds,
      "endpoint:pos-1",
    ]);
    expect((range[0] + range[1]) / 2).toBeCloseTo(legacy.get("sw-a")!.x, 6);
  });
});

describe("computeTieredTopologyLayout — unattached endpoints", () => {
  const swA: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-a", 3);
  const orphanA: NetworkTopologyNode = makeEndpoint("endpoint:zz-orphan-a", {
    name: "orphan-a",
  });
  const orphanB: NetworkTopologyNode = makeEndpoint("endpoint:zz-orphan-b", {
    name: "orphan-b",
  });

  const layout: LayoutMap = computeTieredTopologyLayout(
    [...swA.nodes, orphanA, orphanB],
    [
      ...swA.edges,
      // Attached to a switch that is NOT in the view.
      makeEdge("switch-out-of-view", "endpoint:zz-orphan-a", ["fdb"]),
    ],
    WIDTH,
  );

  test("orphans stay together in one trailing column", () => {
    const orphanRange: [number, number] = xRange(layout, [
      orphanA.id,
      orphanB.id,
    ]);
    const groupRange: [number, number] = xRange(layout, swA.endpointIds);
    // The orphan column trails every anchored group.
    expect(orphanRange[0]).toBeGreaterThan(groupRange[1]);
  });

  test("orphans share the endpoint row of the anchored groups", () => {
    expect(layout.get(orphanA.id)!.y).toBe(layout.get(swA.endpointIds[0]!)!.y);
  });

  test("an endpoint linked only to a tier-0 router is unattached", () => {
    /*
     * The router has no FDB edges, so it stays tier 0 and cannot anchor a
     * group; the endpoint deterministically joins the trailing column.
     */
    const withRouterLink: LayoutMap = computeTieredTopologyLayout(
      [router, ...swA.nodes, orphanA],
      [
        makeEdge("router-1", "sw-a", ["lldp"]),
        ...swA.edges,
        makeEdge("router-1", "endpoint:zz-orphan-a", ["lldp"]),
      ],
      WIDTH,
    );
    expect(withRouterLink.get("router-1")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    expect(withRouterLink.get(orphanA.id)!.x).toBeGreaterThan(
      xRange(withRouterLink, swA.endpointIds)[1],
    );
  });
});

describe("computeTieredTopologyLayout — tier 1 ordering", () => {
  test("childless tier-1 nodes never split two switches' blocks", () => {
    /*
     * The peer's name sorts between the two switches, so a plain
     * alphabetical tier-1 row would wedge it between them.
     */
    const swA: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-a", 2);
    const swC: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-c", 2);
    const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:sw-b-peer", {
      name: "sw-b-peer",
    });

    const layout: LayoutMap = computeTieredTopologyLayout(
      [...swA.nodes, ...swC.nodes, peer],
      [...swA.edges, ...swC.edges, makeEdge("sw-a", peer.id, ["cdp"])],
      WIDTH,
    );

    const peerX: number = layout.get(peer.id)!.x;
    expect(peerX).toBeGreaterThan(layout.get("sw-a")!.x);
    expect(peerX).toBeGreaterThan(layout.get("sw-c")!.x);
    // ...and the two switch blocks stay adjacent.
    expect(xRange(layout, swA.endpointIds)[1]).toBeLessThan(
      xRange(layout, swC.endpointIds)[0],
    );
    expect(xRange(layout, swC.endpointIds)[1]).toBeLessThan(peerX);
  });

  test("a tier of only childless nodes keeps the plain device spacing", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [makeUnmanaged("unmanaged:a"), makeUnmanaged("unmanaged:b")],
      [],
      WIDTH,
    );
    expect(layout.get("unmanaged:b")!.x - layout.get("unmanaged:a")!.x).toBe(
      TIERED_NODE_SPACING,
    );
  });
});

describe("computeTieredTopologyLayout — degenerate shapes", () => {
  test("empty graph returns an empty map", () => {
    expect(computeTieredTopologyLayout([], [], WIDTH).size).toBe(0);
  });

  test("empty graph returns an empty model", () => {
    const model: { positions: LayoutMap; groups: Array<TopologyGroupBox> } =
      computeTieredTopologyModel([], [], WIDTH);
    expect(model.positions.size).toBe(0);
    expect(model.groups).toEqual([]);
  });

  test("router-only graph occupies just tier 0", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [makeDevice("core-1"), makeDevice("core-2")],
      [makeEdge("core-1", "core-2", ["lldp"])],
      WIDTH,
    );
    expect(layout.get("core-1")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    expect(layout.get("core-2")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
  });

  test("switch-only graph starts at the top — empty tiers take no space", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [switchA, pos1],
      [makeEdge("switch-a", "endpoint:pos-1", ["fdb"])],
      WIDTH,
    );
    // No tier-0 nodes, so tier 1 begins at the top margin.
    expect(layout.get("switch-a")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    expect(layout.get("endpoint:pos-1")!.y).toBe(
      TIERED_LAYOUT_TOP_MARGIN + TIERED_TIER_GAP,
    );
    // One switch, one endpoint: both centered on the width.
    expect(layout.get("switch-a")!.x).toBe(WIDTH / 2);
    expect(layout.get("endpoint:pos-1")!.x).toBe(WIDTH / 2);
  });

  test("endpoints-only graph (all switches dropped) still lays out", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [pos1, pos2, orphanEndpoint],
      [],
      WIDTH,
    );
    expect(layout.size).toBe(3);
    // No tier 0 and no tier 1, so the orphan column starts at the top.
    expect(layout.get("endpoint:pos-1")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
    expect(layout.get("endpoint:pos-2")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
  });

  test("edges to nodes outside the graph add no phantom layout entries", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [switchA],
      [makeEdge("switch-a", "endpoint:not-in-view", ["fdb"])],
      WIDTH,
    );
    expect(layout.size).toBe(1);
    expect(layout.has("endpoint:not-in-view")).toBe(false);
    // The FDB edge still marks the device as a switch (tier 1 at the top).
    expect(layout.get("switch-a")!.y).toBe(TIERED_LAYOUT_TOP_MARGIN);
  });

  test("legacy edges without protocols never make a device a switch", () => {
    const layout: LayoutMap = computeTieredTopologyLayout(
      [router, switchA],
      [makeEdge("router-1", "switch-a")],
      WIDTH,
    );
    // Both managed, no FDB edges anywhere: both tier 0.
    expect(layout.get("router-1")!.y).toBe(layout.get("switch-a")!.y);
  });
});

describe("computeTieredTopologyLayout — wrapping inside a group", () => {
  const manyEndpoints: Array<NetworkTopologyNode> = [];
  for (let i: number = 0; i < 25; i++) {
    manyEndpoints.push(
      makeEndpoint(`endpoint:e-${String(i).padStart(2, "0")}`, {
        name: `e-${String(i).padStart(2, "0")}`,
      }),
    );
  }

  test("an unanchored tier wider than the view wraps into even rows", () => {
    const narrowWidth: number = 400;
    const layout: LayoutMap = computeTieredTopologyLayout(
      manyEndpoints,
      [],
      narrowWidth,
    );

    const usable: number = narrowWidth - 2 * TIERED_SIDE_MARGIN;
    const maxPerRow: number =
      Math.floor(usable / TIERED_ENDPOINT_NODE_SPACING) + 1;
    const rows: Map<number, Array<string>> = rowsOf(layout);

    expect(rows.size).toBe(Math.ceil(manyEndpoints.length / maxPerRow));

    const ys: Array<number> = Array.from(rows.keys()).sort(
      (a: number, b: number) => {
        return a - b;
      },
    );
    for (let i: number = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBe(TIERED_ROW_GAP);
    }
    for (const [, ids] of rows.entries()) {
      expect(ids.length).toBeLessThanOrEqual(maxPerRow);
    }
  });

  test("wrapped rows keep every node clear of the side margins", () => {
    const narrowWidth: number = 400;
    const layout: LayoutMap = computeTieredTopologyLayout(
      manyEndpoints,
      [],
      narrowWidth,
    );
    for (const point of layout.values()) {
      expect(point.x).toBeGreaterThanOrEqual(TIERED_SIDE_MARGIN);
      expect(point.x).toBeLessThanOrEqual(narrowWidth - TIERED_SIDE_MARGIN);
    }
  });

  test("a later tier starts below every wrapped row of the previous tier", () => {
    const narrowWidth: number = 400;
    const layout: LayoutMap = computeTieredTopologyLayout(
      [switchA, ...manyEndpoints],
      manyEndpoints.map((endpoint: NetworkTopologyNode) => {
        return makeEdge("switch-a", endpoint.id, ["fdb"]);
      }),
      narrowWidth,
    );
    const switchY: number = layout.get("switch-a")!.y;
    for (const endpoint of manyEndpoints) {
      expect(layout.get(endpoint.id)!.y).toBeGreaterThan(switchY);
    }
  });

  test("a crowded switch wraps within its own block, not across the tier", () => {
    /*
     * One busy switch (14 endpoints) beside a quiet one. The busy group
     * must wrap onto extra rows while staying a contiguous block centered
     * on its switch — the quiet group must not be split by it.
     */
    const busy: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-busy", 14);
    const quiet: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-quiet", 2);
    const layout: LayoutMap = computeTieredTopologyLayout(
      [...busy.nodes, ...quiet.nodes],
      [...busy.edges, ...quiet.edges],
      WIDTH,
    );

    const busyRows: Set<number> = new Set<number>(
      busy.endpointIds.map((id: string): number => {
        return layout.get(id)!.y;
      }),
    );
    expect(busyRows.size).toBeGreaterThan(1);

    // Contiguous: no quiet endpoint lands inside the busy block's span.
    const busyRange: [number, number] = xRange(layout, busy.endpointIds);
    for (const id of quiet.endpointIds) {
      const x: number = layout.get(id)!.x;
      expect(x < busyRange[0] || x > busyRange[1]).toBe(true);
    }

    // Centered: every wrapped row of the busy group sits under its switch.
    const busySwitchX: number = layout.get("sw-busy")!.x;
    for (const y of busyRows) {
      const idsInRow: Array<string> = busy.endpointIds.filter(
        (id: string): boolean => {
          return layout.get(id)!.y === y;
        },
      );
      const [min, max]: [number, number] = xRange(layout, idsInRow);
      expect((min + max) / 2).toBeCloseTo(busySwitchX, 6);
    }

    // Rows inside a group are exactly one row gap apart.
    const sortedRows: Array<number> = Array.from(busyRows).sort(
      (a: number, b: number) => {
        return a - b;
      },
    );
    for (let i: number = 1; i < sortedRows.length; i++) {
      expect(sortedRows[i]! - sortedRows[i - 1]!).toBe(TIERED_ROW_GAP);
    }
  });

  test("endpoints inside a group row keep the endpoint spacing", () => {
    const busy: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-busy", 9);
    const layout: LayoutMap = computeTieredTopologyLayout(
      busy.nodes,
      busy.edges,
      WIDTH,
    );
    const byRow: Map<number, Array<number>> = new Map();
    for (const id of busy.endpointIds) {
      const point: { x: number; y: number } = layout.get(id)!;
      byRow.set(point.y, [...(byRow.get(point.y) || []), point.x]);
    }
    for (const [, xs] of byRow.entries()) {
      const sorted: Array<number> = xs.sort((a: number, b: number) => {
        return a - b;
      });
      for (let i: number = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBe(TIERED_ENDPOINT_NODE_SPACING);
      }
    }
  });

  test("more switches than fit across wrap into bands, blocks intact", () => {
    const switches: Array<SwitchWithEndpoints> = [];
    for (let i: number = 0; i < 9; i++) {
      switches.push(makeSwitchWithEndpoints(`sw-${String(i)}`, 3));
    }
    const layout: LayoutMap = computeTieredTopologyLayout(
      switches.reduce(
        (
          all: Array<NetworkTopologyNode>,
          group: SwitchWithEndpoints,
        ): Array<NetworkTopologyNode> => {
          return [...all, ...group.nodes];
        },
        [],
      ),
      switches.reduce(
        (
          all: Array<NetworkTopologyEdge>,
          group: SwitchWithEndpoints,
        ): Array<NetworkTopologyEdge> => {
          return [...all, ...group.edges];
        },
        [],
      ),
      WIDTH,
    );

    // The tier-1 row wrapped: not every switch shares one y.
    const switchYs: Set<number> = new Set<number>(
      switches.map((group: SwitchWithEndpoints): number => {
        return layout.get(group.device.id)!.y;
      }),
    );
    expect(switchYs.size).toBeGreaterThan(1);

    // Every switch still owns a contiguous block right below itself.
    for (const group of switches) {
      const switchPoint: { x: number; y: number } = layout.get(
        group.device.id,
      )!;
      const [min, max]: [number, number] = xRange(layout, group.endpointIds);
      expect((min + max) / 2).toBeCloseTo(switchPoint.x, 6);
      for (const id of group.endpointIds) {
        expect(layout.get(id)!.y).toBeGreaterThan(switchPoint.y);
      }
      // No other group's endpoint intrudes on the same row band.
      for (const other of switches) {
        if (other.device.id === group.device.id) {
          continue;
        }
        for (const id of other.endpointIds) {
          const point: { x: number; y: number } = layout.get(id)!;
          const sameBand: boolean =
            point.y === layout.get(group.endpointIds[0]!)!.y;
          if (sameBand) {
            expect(point.x < min || point.x > max).toBe(true);
          }
        }
      }
    }
  });
});

describe("computeTieredTopologyModel — group boxes", () => {
  const swA: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-a", 3);
  const swB: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-b", 1);
  const orphan: NetworkTopologyNode = makeEndpoint("endpoint:zz-orphan", {
    name: "zz-orphan",
  });

  const model: { positions: LayoutMap; groups: Array<TopologyGroupBox> } =
    computeTieredTopologyModel(
      [...swA.nodes, ...swB.nodes, orphan],
      [...swA.edges, ...swB.edges],
      WIDTH,
    );

  test("one box per group with endpoints, plus one for the orphans", () => {
    expect(model.groups.length).toBe(3);
    const anchors: Array<string | null> = model.groups.map(
      (box: TopologyGroupBox): string | null => {
        return box.anchorNodeId;
      },
    );
    expect(anchors).toContain("sw-a");
    expect(anchors).toContain("sw-b");
    expect(anchors).toContain(null);
  });

  test("a box is centered on its switch and encloses its endpoints", () => {
    const box: TopologyGroupBox = model.groups.find(
      (candidate: TopologyGroupBox): boolean => {
        return candidate.anchorNodeId === "sw-a";
      },
    )!;
    const switchX: number = model.positions.get("sw-a")!.x;
    expect(box.x + box.width / 2).toBeCloseTo(switchX, 6);
    expect(box.endpointCount).toBe(3);
    for (const id of swA.endpointIds) {
      const point: { x: number; y: number } = model.positions.get(id)!;
      expect(point.x).toBeGreaterThan(box.x);
      expect(point.x).toBeLessThan(box.x + box.width);
      expect(point.y).toBeGreaterThan(box.y);
      expect(point.y).toBeLessThan(box.y + box.height);
    }
  });

  test("box height follows the group's row count", () => {
    const singleRow: TopologyGroupBox = model.groups.find(
      (candidate: TopologyGroupBox): boolean => {
        return candidate.anchorNodeId === "sw-b";
      },
    )!;
    expect(singleRow.height).toBe(
      TIERED_GROUP_BOX_TOP_PAD + TIERED_GROUP_BOX_BOTTOM_PAD,
    );
  });

  test("boxes never overlap each other", () => {
    for (let i: number = 0; i < model.groups.length; i++) {
      for (let j: number = i + 1; j < model.groups.length; j++) {
        const a: TopologyGroupBox = model.groups[i]!;
        const b: TopologyGroupBox = model.groups[j]!;
        const disjointX: boolean = a.x + a.width <= b.x || b.x + b.width <= a.x;
        const disjointY: boolean =
          a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(disjointX || disjointY).toBe(true);
      }
    }
  });

  test("boxes stay inside the view", () => {
    for (const box of model.groups) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(WIDTH);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  test("a graph with no endpoints produces no boxes", () => {
    const noEndpoints: { groups: Array<TopologyGroupBox> } =
      computeTieredTopologyModel(
        [router, makeUnmanaged("unmanaged:peer")],
        [makeEdge("router-1", "unmanaged:peer", ["lldp"])],
        WIDTH,
      );
    expect(noEndpoints.groups).toEqual([]);
  });
});

describe("computeTieredTopologyLayout — determinism", () => {
  test("identical inputs yield identical coordinates", () => {
    const first: LayoutMap = computeTieredTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
    );
    const second: LayoutMap = computeTieredTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
    );
    for (const node of sampleNodes) {
      expect(second.get(node.id)).toEqual(first.get(node.id));
    }
  });

  test("input order does not matter — sorting makes layout order-independent", () => {
    const shuffledNodes: Array<NetworkTopologyNode> = [
      pos2,
      unmanagedAp,
      orphanEndpoint,
      switchB,
      router,
      pos1,
      switchA,
    ];
    const shuffledEdges: Array<NetworkTopologyEdge> = [
      ...sampleEdges,
    ].reverse();

    const original: LayoutMap = computeTieredTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
    );
    const shuffled: LayoutMap = computeTieredTopologyLayout(
      shuffledNodes,
      shuffledEdges,
      WIDTH,
    );
    for (const node of sampleNodes) {
      expect(shuffled.get(node.id)).toEqual(original.get(node.id));
    }
  });

  test("grouped layouts survive reordering of nodes, edges and directions", () => {
    const swA: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-a", 5);
    const swB: SwitchWithEndpoints = makeSwitchWithEndpoints("sw-b", 4);
    const core: NetworkTopologyNode = makeDevice("core-router");
    const nodes: Array<NetworkTopologyNode> = [
      core,
      ...swA.nodes,
      ...swB.nodes,
    ];
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("core-router", "sw-a", ["lldp"]),
      makeEdge("core-router", "sw-b", ["lldp"]),
      ...swA.edges,
      ...swB.edges,
    ];

    const original: { positions: LayoutMap; groups: Array<TopologyGroupBox> } =
      computeTieredTopologyModel(nodes, edges, WIDTH);
    const reordered: { positions: LayoutMap; groups: Array<TopologyGroupBox> } =
      computeTieredTopologyModel(
        [...nodes].reverse(),
        [...edges].reverse().map((edge: NetworkTopologyEdge) => {
          // Flip every edge — attachment must be direction agnostic.
          return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
        }),
        WIDTH,
      );

    for (const node of nodes) {
      expect(reordered.positions.get(node.id)).toEqual(
        original.positions.get(node.id),
      );
    }
    expect(reordered.groups).toEqual(original.groups);
  });

  test("nodes with identical names order by id", () => {
    const twinA: NetworkTopologyNode = makeEndpoint("endpoint:aa", {
      name: "twin",
    });
    const twinB: NetworkTopologyNode = makeEndpoint("endpoint:bb", {
      name: "twin",
    });
    const layout: LayoutMap = computeTieredTopologyLayout(
      [twinB, twinA],
      [],
      WIDTH,
    );
    expect(layout.get("endpoint:aa")!.x).toBeLessThan(
      layout.get("endpoint:bb")!.x,
    );
  });
});

describe("wrapNodeLabel", () => {
  test("a short name stays on one line", () => {
    expect(wrapNodeLabel("POS 1")).toEqual(["POS 1"]);
  });

  test("a long name wraps at a word boundary", () => {
    expect(wrapNodeLabel("Menu Board 2")).toEqual(["Menu Board", "2"]);
    expect(wrapNodeLabel("Receipt Printer")).toEqual(["Receipt", "Printer"]);
  });

  test("more words than fit are folded into an ellipsis", () => {
    const lines: Array<string> = wrapNodeLabel("Front Counter Printer 2");
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  test("a single long word is hard split across the two lines", () => {
    // 21 chars — fits exactly in two 11-char lines, so nothing is lost.
    const lines: Array<string> = wrapNodeLabel("WORKSTATION0123456789");
    expect(lines).toEqual(["WORKSTATION", "0123456789"]);
  });

  test("a word too long even for two lines is truncated", () => {
    const lines: Array<string> = wrapNodeLabel("WORKSTATION0123456789ABCDEFG");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(11);
    }
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  test("no line ever exceeds the character budget", () => {
    const names: Array<string> = [
      "Kitchen Display",
      "Drive-Thru POS",
      "Beer Tap Controller",
      "BOS Server",
      "WAP Lobby",
    ];
    for (const name of names) {
      for (const line of wrapNodeLabel(name)) {
        expect(line.length).toBeLessThanOrEqual(11);
      }
    }
  });

  test("empty and blank names produce no lines", () => {
    expect(wrapNodeLabel("")).toEqual([]);
    expect(wrapNodeLabel("   ")).toEqual([]);
  });

  test("wrapping is pure — repeated calls agree", () => {
    expect(wrapNodeLabel("Menu Board 3")).toEqual(
      wrapNodeLabel("Menu Board 3"),
    );
  });
});
