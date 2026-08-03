import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ALL_NODE_KINDS,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  TopologyViewModelInput,
  buildTopologyViewModel,
  kindOfNode,
  topologyStructuralSignature,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  ENDPOINT_NODE_FILL,
  ENDPOINT_NODE_STROKE,
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  TopologyNodeFootprint,
  footprintForNode,
  labelLinesForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

const UNMANAGED_FILL: string = "var(--ou-surface-primary, #ffffff)";
const UNMANAGED_DASH: string = "4 3";
const FDB_EDGE_DASH: string = "3 3";
const DOWN_EDGE_DASH: string = "6 4";

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
 * Canonical unit-site sample: a core router uplinked to two switches, a
 * switch-to-switch link running hot, an unmanaged CDP access point and one
 * discovered endpoint learned from the bridge forwarding database.
 */
const core: NetworkTopologyNode = makeDevice("core-1", {
  vendor: "Cisco",
  deviceModel: "C9300",
  sysName: "core-1.lan",
  interfacesUp: 12,
  interfacesDown: 1,
});
const switchA: NetworkTopologyNode = makeDevice("switch-a", {
  interfacesUp: 24,
  interfacesDown: 0,
});
const switchB: NetworkTopologyNode = makeDevice("switch-b", {
  status: "down",
});
const accessPoint: NetworkTopologyNode = makeUnmanaged("unmanaged:ap-1", {
  name: "ap-1",
  deviceModel: "AIR-AP1815",
});
const pos1: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
  name: "pos-1",
  macAddress: "aa:bb:cc:dd:ee:01",
  ipAddress: "10.0.0.11",
  vendor: "Zebra",
  classification: "printer",
  vlanId: 12,
});

const sampleNodes: Array<NetworkTopologyNode> = [
  core,
  switchA,
  switchB,
  accessPoint,
  pos1,
];

const healthyUplink: NetworkTopologyEdge = {
  fromNodeId: "core-1",
  toNodeId: "switch-a",
  protocols: ["lldp"],
  fromInterface: {
    interfaceName: "Gi0/1",
    isOperationallyUp: true,
    utilizationPercent: 40,
    inRateMbps: 12,
    outRateMbps: 3,
  },
};
const downUplink: NetworkTopologyEdge = {
  fromNodeId: "core-1",
  toNodeId: "switch-b",
  protocols: ["lldp"],
  toInterface: { isOperationallyUp: false },
};
// Authored b -> a on purpose: the key is sorted, the drawn direction is not.
const saturatedTrunk: NetworkTopologyEdge = {
  fromNodeId: "switch-b",
  toNodeId: "switch-a",
  protocols: ["lldp"],
  fromInterface: { utilizationPercent: 90 },
};
const apLink: NetworkTopologyEdge = makeEdge("switch-a", "unmanaged:ap-1", [
  "cdp",
]);
const fdbLink: NetworkTopologyEdge = makeEdge("switch-a", "endpoint:pos-1", [
  "fdb",
]);

const sampleEdges: Array<NetworkTopologyEdge> = [
  healthyUplink,
  downUplink,
  saturatedTrunk,
  apLink,
  fdbLink,
];

const samplePositions: Map<string, TopologyPoint> = new Map<
  string,
  TopologyPoint
>([
  ["core-1", { x: 500, y: 100 }],
  ["switch-a", { x: 300, y: 300 }],
  ["switch-b", { x: 700, y: 300 }],
  ["unmanaged:ap-1", { x: 100, y: 300 }],
  ["endpoint:pos-1", { x: 300, y: 500 }],
]);

type MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
) => TopologyViewModelInput;

/* Defaults describe the unfiltered, unsearched, nothing-selected frame. */
const makeInput: MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
): TopologyViewModelInput => {
  return {
    nodes: sampleNodes,
    edges: sampleEdges,
    positions: samplePositions,
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
    ...overrides,
  };
};

type FindNodeFunction = (
  model: TopologyViewModel,
  id: string,
) => TopologyNodeView | undefined;

const nodeById: FindNodeFunction = (
  model: TopologyViewModel,
  id: string,
): TopologyNodeView | undefined => {
  return model.nodes.find((view: TopologyNodeView): boolean => {
    return view.id === id;
  });
};

type FindEdgeFunction = (
  model: TopologyViewModel,
  key: string,
) => TopologyEdgeView | undefined;

const edgeByKey: FindEdgeFunction = (
  model: TopologyViewModel,
  key: string,
): TopologyEdgeView | undefined => {
  return model.edges.find((view: TopologyEdgeView): boolean => {
    return view.key === key;
  });
};

type IdsOfFunction = (model: TopologyViewModel) => Array<string>;

const nodeIdsOf: IdsOfFunction = (model: TopologyViewModel): Array<string> => {
  return model.nodes.map((view: TopologyNodeView): string => {
    return view.id;
  });
};

const brightNodeIdsOf: IdsOfFunction = (
  model: TopologyViewModel,
): Array<string> => {
  return model.nodes
    .filter((view: TopologyNodeView): boolean => {
      return !view.isDimmed;
    })
    .map((view: TopologyNodeView): string => {
      return view.id;
    });
};

const brightEdgeKeysOf: IdsOfFunction = (
  model: TopologyViewModel,
): Array<string> => {
  return model.edges
    .filter((view: TopologyEdgeView): boolean => {
      return !view.isDimmed;
    })
    .map((view: TopologyEdgeView): string => {
      return view.key;
    });
};

/* A deterministic chain of devices: dev-00 — dev-01 — ... — dev-NN. */
interface ChainGraph {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  positions: Map<string, TopologyPoint>;
}

type MakeChainFunction = (count: number) => ChainGraph;

const makeChain: MakeChainFunction = (count: number): ChainGraph => {
  const nodes: Array<NetworkTopologyNode> = [];
  const edges: Array<NetworkTopologyEdge> = [];
  const positions: Map<string, TopologyPoint> = new Map<
    string,
    TopologyPoint
  >();
  for (let i: number = 0; i < count; i++) {
    const id: string = `dev-${String(i).padStart(2, "0")}`;
    nodes.push(makeDevice(id));
    positions.set(id, { x: 40 * i, y: 100 });
    if (i > 0) {
      edges.push(
        makeEdge(`dev-${String(i - 1).padStart(2, "0")}`, id, ["lldp"]),
      );
    }
  }
  return { nodes: nodes, edges: edges, positions: positions };
};

describe("kindOfNode", () => {
  test("a node declaring kind endpoint is an endpoint whatever isManaged says", () => {
    expect(kindOfNode(pos1)).toBe("endpoint");
    expect(
      kindOfNode(makeEndpoint("endpoint:managed-looking", { isManaged: true })),
    ).toBe("endpoint");
  });

  test("a managed node is a device", () => {
    expect(kindOfNode(switchA)).toBe("device");
  });

  test("an unmanaged node is an unmanaged peer", () => {
    expect(kindOfNode(accessPoint)).toBe("unmanaged");
  });

  test("a legacy payload with no kind field falls back to isManaged", () => {
    /*
     * Older topology payloads predate the kind field entirely; they can
     * only carry devices and discovery-protocol peers, never endpoints.
     */
    const legacyManaged: NetworkTopologyNode = {
      id: "legacy-managed",
      name: "legacy-managed",
      isManaged: true,
      status: "up",
    };
    const legacyPeer: NetworkTopologyNode = {
      id: "unmanaged:legacy",
      name: "legacy peer",
      isManaged: false,
      status: "unknown",
    };
    expect(kindOfNode(legacyManaged)).toBe("device");
    expect(kindOfNode(legacyPeer)).toBe("unmanaged");
  });

  test("isManaged wins over a kind field that disagrees with it", () => {
    // Only "endpoint" is taken from kind; device vs peer is a managed check.
    expect(kindOfNode(makeDevice("odd-1", { isManaged: false }))).toBe(
      "unmanaged",
    );
    expect(kindOfNode(makeUnmanaged("odd-2", { isManaged: true }))).toBe(
      "device",
    );
  });

  test("ALL_NODE_KINDS names exactly the three kinds", () => {
    expect(Array.from(ALL_NODE_KINDS).sort()).toEqual([
      "device",
      "endpoint",
      "unmanaged",
    ]);
  });
});

describe("buildTopologyViewModel — what gets drawn", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("one descriptor per positioned node, in payload order", () => {
    expect(nodeIdsOf(model)).toEqual([
      "core-1",
      "switch-a",
      "switch-b",
      "unmanaged:ap-1",
      "endpoint:pos-1",
    ]);
  });

  test("a node carries the coordinate the layout gave it", () => {
    expect(nodeById(model, "core-1")!.x).toBeCloseTo(500, 6);
    expect(nodeById(model, "core-1")!.y).toBeCloseTo(100, 6);
  });

  test("a node with no position is skipped rather than drawn at the origin", () => {
    const partial: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
      samplePositions,
    );
    partial.delete("switch-b");
    const missing: TopologyViewModel = buildTopologyViewModel(
      makeInput({ positions: partial }),
    );
    expect(nodeById(missing, "switch-b")).toBeUndefined();
    expect(missing.visibleNodeCount).toBe(4);
    // The node still exists in the payload, so the total is untouched.
    expect(missing.totalNodeCount).toBe(5);
  });

  test("an edge to a node with no position is dropped, not drawn to (0,0)", () => {
    const partial: Map<string, TopologyPoint> = new Map<string, TopologyPoint>(
      samplePositions,
    );
    partial.delete("switch-b");
    const missing: TopologyViewModel = buildTopologyViewModel(
      makeInput({ positions: partial }),
    );
    expect(edgeByKey(missing, "core-1::switch-b")).toBeUndefined();
    expect(edgeByKey(missing, "switch-a::switch-b")).toBeUndefined();
    expect(missing.edges.length).toBe(3);
  });

  test("edges take their endpoints' coordinates and keep the authored direction", () => {
    // Key is the sorted pair; from/to stay as the payload wrote them.
    const trunk: TopologyEdgeView = edgeByKey(model, "switch-a::switch-b")!;
    expect(trunk.fromNodeId).toBe("switch-b");
    expect(trunk.toNodeId).toBe("switch-a");
    expect(trunk.x1).toBeCloseTo(700, 6);
    expect(trunk.y1).toBeCloseTo(300, 6);
    expect(trunk.x2).toBeCloseTo(300, 6);
    expect(trunk.y2).toBeCloseTo(300, 6);
  });

  test("an edge naming an id that is not in the payload is dropped", () => {
    const withGhost: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        edges: [...sampleEdges, makeEdge("switch-a", "not-in-view", ["lldp"])],
      }),
    );
    expect(withGhost.edges.length).toBe(sampleEdges.length);
    expect(edgeByKey(withGhost, "not-in-view::switch-a")).toBeUndefined();
  });

  test("null rows and rows without a string id are ignored, not crashed on", () => {
    const hostileNodes: Array<NetworkTopologyNode> = [
      core,
      null as unknown as NetworkTopologyNode,
      { name: "no id", isManaged: true, status: "up" } as NetworkTopologyNode,
      {
        id: 7,
        name: "numeric id",
        isManaged: true,
        status: "up",
      } as unknown as NetworkTopologyNode,
      switchA,
    ];
    const hostileEdges: Array<NetworkTopologyEdge> = [
      null as unknown as NetworkTopologyEdge,
      healthyUplink,
    ];
    const hostile: TopologyViewModel = buildTopologyViewModel(
      makeInput({ nodes: hostileNodes, edges: hostileEdges }),
    );
    expect(nodeIdsOf(hostile)).toEqual(["core-1", "switch-a"]);
    expect(hostile.totalNodeCount).toBe(2);
    expect(hostile.edges.length).toBe(1);
  });
});

describe("buildTopologyViewModel — kind filters remove, search only dims", () => {
  test("turning a kind off removes those nodes outright", () => {
    const devicesOnly: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        visibleKinds: new Set<TopologyNodeKind>(["device"]),
      }),
    );
    expect(nodeIdsOf(devicesOnly)).toEqual(["core-1", "switch-a", "switch-b"]);
    expect(devicesOnly.visibleNodeCount).toBe(3);
    expect(devicesOnly.totalNodeCount).toBe(5);
  });

  test("turning a kind off also removes every edge that touched it", () => {
    /*
     * Removing a node without removing its links is what leaves a filtered
     * map covered in lines that lead nowhere.
     */
    const devicesOnly: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        visibleKinds: new Set<TopologyNodeKind>(["device"]),
      }),
    );
    const survivingKeys: Array<string> = devicesOnly.edges.map(
      (view: TopologyEdgeView): string => {
        return view.key;
      },
    );
    expect(survivingKeys.sort()).toEqual([
      "core-1::switch-a",
      "core-1::switch-b",
      "switch-a::switch-b",
    ]);
    for (const view of devicesOnly.edges) {
      expect(view.fromNodeId).not.toBe("endpoint:pos-1");
      expect(view.toNodeId).not.toBe("endpoint:pos-1");
      expect(view.fromNodeId).not.toBe("unmanaged:ap-1");
      expect(view.toNodeId).not.toBe("unmanaged:ap-1");
    }
  });

  test("hiding the devices strands the leaves — their links go too", () => {
    const leavesOnly: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        visibleKinds: new Set<TopologyNodeKind>(["unmanaged", "endpoint"]),
      }),
    );
    expect(nodeIdsOf(leavesOnly)).toEqual(["unmanaged:ap-1", "endpoint:pos-1"]);
    // Both remaining nodes only ever linked to switch-a, which is gone.
    expect(leavesOnly.edges).toEqual([]);
  });

  test("turning every kind off leaves nothing but still reports the real total", () => {
    const nothing: TopologyViewModel = buildTopologyViewModel(
      makeInput({ visibleKinds: new Set<TopologyNodeKind>() }),
    );
    expect(nothing.nodes).toEqual([]);
    expect(nothing.edges).toEqual([]);
    expect(nothing.visibleNodeCount).toBe(0);
    expect(nothing.totalNodeCount).toBe(5);
  });

  test("a search that matches nothing still draws every node and every edge", () => {
    const noMatch: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "no-such-device" }),
    );
    expect(noMatch.nodes.length).toBe(5);
    expect(noMatch.edges.length).toBe(5);
    expect(brightNodeIdsOf(noMatch)).toEqual([]);
    expect(noMatch.visibleNodeCount).toBe(5);
    // Nothing was filtered — everything is merely dim.
    expect(noMatch.isFilteredEmpty).toBe(false);
  });

  test("search matches name, sysName or vendor, case-insensitively", () => {
    const bySysName: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "CORE-1.LAN" }),
    );
    expect(brightNodeIdsOf(bySysName)).toEqual(["core-1"]);
    const byVendor: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "zebra" }),
    );
    expect(brightNodeIdsOf(byVendor)).toEqual(["endpoint:pos-1"]);
  });

  test("blank search text dims nothing", () => {
    const blank: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "   " }),
    );
    expect(brightNodeIdsOf(blank).length).toBe(5);
    expect(brightEdgeKeysOf(blank).length).toBe(5);
  });
});

describe("buildTopologyViewModel — edges are dimmed WITH their nodes", () => {
  /*
   * REGRESSION. The old graph dimmed nodes only, so searching produced a
   * readable handful of bright devices sitting behind a completely
   * unchanged hairball of lines — the filter looked broken because the
   * only thing making the map illegible was still at full strength.
   */
  test("searching for one device leaves no undimmed edge anywhere", () => {
    const chain: ChainGraph = makeChain(12);
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: chain.nodes,
        edges: chain.edges,
        positions: chain.positions,
        searchText: "dev-05",
      }),
    );
    expect(model.nodes.length).toBe(12);
    expect(model.edges.length).toBe(11);
    expect(brightNodeIdsOf(model)).toEqual(["dev-05"]);
    // Both of dev-05's links land on a node that did not match.
    expect(brightEdgeKeysOf(model)).toEqual([]);
    for (const view of model.edges) {
      expect(view.isDimmed).toBe(true);
    }
  });

  test("an edge between two matching nodes stays bright while its neighbours dim", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "switch" }),
    );
    expect(brightNodeIdsOf(model)).toEqual(["switch-a", "switch-b"]);
    // The only link with both ends matching survives at full strength.
    expect(brightEdgeKeysOf(model)).toEqual(["switch-a::switch-b"]);
    expect(edgeByKey(model, "core-1::switch-a")!.isDimmed).toBe(true);
    expect(edgeByKey(model, "endpoint:pos-1::switch-a")!.isDimmed).toBe(true);
  });

  test("every edge touching a dimmed node is dimmed, on any search", () => {
    const searches: Array<string> = ["core", "switch-a", "pos", "ap-1", "1"];
    for (const searchText of searches) {
      const model: TopologyViewModel = buildTopologyViewModel(
        makeInput({ searchText: searchText }),
      );
      const dimmedIds: Set<string> = new Set<string>(
        model.nodes
          .filter((view: TopologyNodeView): boolean => {
            return view.isDimmed;
          })
          .map((view: TopologyNodeView): string => {
            return view.id;
          }),
      );
      for (const view of model.edges) {
        const touchesDimmed: boolean =
          dimmedIds.has(view.fromNodeId) || dimmedIds.has(view.toNodeId);
        expect(view.isDimmed).toBe(touchesDimmed);
      }
    }
  });
});

describe("buildTopologyViewModel — focus", () => {
  test("focusNodeIds dims everything outside the focus set, edges included", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        focusNodeIds: new Set<string>(["core-1", "switch-a"]),
      }),
    );
    expect(brightNodeIdsOf(model)).toEqual(["core-1", "switch-a"]);
    expect(brightEdgeKeysOf(model)).toEqual(["core-1::switch-a"]);
    expect(nodeById(model, "endpoint:pos-1")!.isDimmed).toBe(true);
    // Focus dims; it never removes.
    expect(model.nodes.length).toBe(5);
    expect(model.edges.length).toBe(5);
  });

  test("an empty focus set dims nothing — it is not a focus on nobody", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ focusNodeIds: new Set<string>() }),
    );
    expect(brightNodeIdsOf(model).length).toBe(5);
    expect(brightEdgeKeysOf(model).length).toBe(5);
  });

  test("a focus on ids that are not in the graph dims everything", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ focusNodeIds: new Set<string>(["ghost-1"]) }),
    );
    expect(brightNodeIdsOf(model)).toEqual([]);
    expect(brightEdgeKeysOf(model)).toEqual([]);
  });

  test("a node must both match the search and be in focus to stay bright", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        searchText: "switch",
        focusNodeIds: new Set<string>(["switch-a", "core-1"]),
      }),
    );
    // switch-b matches the search but is out of focus; core-1 the reverse.
    expect(brightNodeIdsOf(model)).toEqual(["switch-a"]);
  });
});

describe("buildTopologyViewModel — selection and pinning", () => {
  test("selection flags land on exactly one node and one edge", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        selectedNodeId: "switch-b",
        selectedEdgeKey: "core-1::switch-b",
      }),
    );
    expect(
      model.nodes.filter((view: TopologyNodeView): boolean => {
        return view.isSelected;
      }),
    ).toHaveLength(1);
    expect(nodeById(model, "switch-b")!.isSelected).toBe(true);
    expect(
      model.edges.filter((view: TopologyEdgeView): boolean => {
        return view.isSelected;
      }),
    ).toHaveLength(1);
    expect(edgeByKey(model, "core-1::switch-b")!.isSelected).toBe(true);
  });

  test("a selection pointing at something that left the graph selects nothing", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        selectedNodeId: "decommissioned",
        selectedEdgeKey: "a::b",
      }),
    );
    for (const view of model.nodes) {
      expect(view.isSelected).toBe(false);
    }
    for (const view of model.edges) {
      expect(view.isSelected).toBe(false);
    }
  });

  test("pinned flags land on the pinned nodes and nowhere else", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        pinnedNodeIds: new Set<string>(["switch-a", "endpoint:pos-1"]),
      }),
    );
    expect(nodeById(model, "switch-a")!.isPinned).toBe(true);
    expect(nodeById(model, "endpoint:pos-1")!.isPinned).toBe(true);
    expect(nodeById(model, "core-1")!.isPinned).toBe(false);
    expect(nodeById(model, "switch-b")!.isPinned).toBe(false);
  });

  test("selection and pinning are independent of dimming", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        searchText: "core",
        selectedNodeId: "switch-b",
        pinnedNodeIds: new Set<string>(["switch-b"]),
      }),
    );
    const view: TopologyNodeView = nodeById(model, "switch-b")!;
    expect(view.isDimmed).toBe(true);
    expect(view.isSelected).toBe(true);
    expect(view.isPinned).toBe(true);
  });
});

describe("buildTopologyViewModel — node paint per kind and status", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("a managed up device is filled solid with the up colour", () => {
    const view: TopologyNodeView = nodeById(model, "switch-a")!;
    expect(view.kind).toBe("device");
    expect(view.status).toBe("up");
    expect(view.fill).toBe(NODE_STATUS_COLORS.up);
    expect(view.stroke).toBe(NODE_STATUS_COLORS.up);
    expect(view.strokeDashArray).toBeUndefined();
  });

  test("a managed down device is filled with the down colour", () => {
    const view: TopologyNodeView = nodeById(model, "switch-b")!;
    expect(view.fill).toBe(NODE_STATUS_COLORS.down);
    expect(view.stroke).toBe(NODE_STATUS_COLORS.down);
  });

  test("an unmanaged peer is hollow with a dashed outline", () => {
    // The dashed outline is what says "we did not discover this one".
    const view: TopologyNodeView = nodeById(model, "unmanaged:ap-1")!;
    expect(view.kind).toBe("unmanaged");
    expect(view.fill).toBe(UNMANAGED_FILL);
    expect(view.stroke).toBe(NODE_STATUS_COLORS.unknown);
    expect(view.strokeDashArray).toBe(UNMANAGED_DASH);
  });

  test("an endpoint is violet, outside the up/down/unknown range", () => {
    const view: TopologyNodeView = nodeById(model, "endpoint:pos-1")!;
    expect(view.kind).toBe("endpoint");
    expect(view.fill).toBe(ENDPOINT_NODE_FILL);
    expect(view.stroke).toBe(ENDPOINT_NODE_STROKE);
    expect(view.fill).toBe("#a78bfa");
    // An endpoint that is "unknown" must never read as a device that is down.
    expect(view.fill).not.toBe(NODE_STATUS_COLORS.down);
    expect(view.strokeDashArray).toBeUndefined();
  });

  test("an unmanaged peer keeps its status colour on the stroke", () => {
    const downPeer: NetworkTopologyNode = makeUnmanaged("unmanaged:dead", {
      status: "down",
    });
    const withPeer: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [downPeer],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["unmanaged:dead", { x: 0, y: 0 }],
        ]),
      }),
    );
    const view: TopologyNodeView = nodeById(withPeer, "unmanaged:dead")!;
    expect(view.stroke).toBe(NODE_STATUS_COLORS.down);
    expect(view.fill).toBe(UNMANAGED_FILL);
  });

  test("an unrecognised status falls back to the unknown colour", () => {
    const odd: NetworkTopologyNode = makeDevice("odd-status", {
      status: "degraded" as NetworkTopologyNodeStatus,
    });
    const withOdd: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [odd],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["odd-status", { x: 1, y: 2 }],
        ]),
      }),
    );
    expect(nodeById(withOdd, "odd-status")!.fill).toBe(
      NODE_STATUS_COLORS.unknown,
    );
  });
});

describe("buildTopologyViewModel — interface badge", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("a device carrying interface counts gets an up/down badge", () => {
    expect(nodeById(model, "core-1")!.badge).toBe("12/1");
  });

  test("a device with no interface counts gets no badge", () => {
    expect(nodeById(model, "switch-b")!.badge).toBeUndefined();
    expect(nodeById(model, "unmanaged:ap-1")!.badge).toBeUndefined();
  });

  test('"0/0" still renders, because zero is data', () => {
    /*
     * A switch reporting zero up and zero down is a real and alarming
     * state; treating the counts as falsy would hide it entirely.
     */
    const quiet: NetworkTopologyNode = makeDevice("switch-quiet", {
      interfacesUp: 0,
      interfacesDown: 0,
    });
    const withQuiet: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [quiet],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["switch-quiet", { x: 0, y: 0 }],
        ]),
      }),
    );
    expect(nodeById(withQuiet, "switch-quiet")!.badge).toBe("0/0");
    // ...and switch-a's zero down count survives the same way.
    expect(nodeById(model, "switch-a")!.badge).toBe("24/0");
  });

  test("a half-reported count fills the missing side with zero", () => {
    const partial: NetworkTopologyNode = makeDevice("switch-partial", {
      interfacesDown: 3,
    });
    const withPartial: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [partial],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["switch-partial", { x: 0, y: 0 }],
        ]),
      }),
    );
    expect(nodeById(withPartial, "switch-partial")!.badge).toBe("0/3");
  });

  test("an endpoint never carries a badge, even if counts leak in", () => {
    const oddEndpoint: NetworkTopologyNode = makeEndpoint("endpoint:odd", {
      interfacesUp: 2,
      interfacesDown: 1,
    });
    const withOdd: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [oddEndpoint],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["endpoint:odd", { x: 0, y: 0 }],
        ]),
      }),
    );
    expect(nodeById(withOdd, "endpoint:odd")!.badge).toBeUndefined();
  });
});

describe("buildTopologyViewModel — labels, geometry and identifiers", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("the footprint is the same object the layout would compute", () => {
    // Layout and paint must read one source of truth, or glyphs collide.
    const view: TopologyNodeView = nodeById(model, "core-1")!;
    expect(view.footprint).toEqual(footprintForNode(core));
    const endpointFootprint: TopologyNodeFootprint = nodeById(
      model,
      "endpoint:pos-1",
    )!.footprint;
    expect(endpointFootprint).toEqual(footprintForNode(pos1));
    // An endpoint's glyph is genuinely smaller than a device's.
    expect(endpointFootprint.halfWidth).toBeLessThan(view.footprint.halfWidth);
  });

  test("label lines are the wrapped lines, not the raw name", () => {
    expect(nodeById(model, "core-1")!.labelLines).toEqual(
      labelLinesForNode(core),
    );
    expect(nodeById(model, "endpoint:pos-1")!.labelLines).toEqual(["pos-1"]);
  });

  test("a node with an empty name produces no label lines and still draws", () => {
    const nameless: NetworkTopologyNode = makeDevice("nameless-1", {
      name: "",
    });
    const withNameless: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [nameless],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["nameless-1", { x: 5, y: 5 }],
        ]),
      }),
    );
    const view: TopologyNodeView = nodeById(withNameless, "nameless-1")!;
    expect(view.labelLines).toEqual([]);
    expect(view.ariaLabel).toBe("nameless-1, managed device, status up");
  });

  test("a device announces kind, status, vendor and interface counts", () => {
    expect(nodeById(model, "core-1")!.ariaLabel).toBe(
      "core-1, managed device, status up, Cisco, 12 interfaces up, 1 down",
    );
    expect(nodeById(model, "unmanaged:ap-1")!.ariaLabel).toBe(
      "ap-1, unmanaged peer, status unknown",
    );
  });

  test("an endpoint announces its identity rather than a status", () => {
    expect(nodeById(model, "endpoint:pos-1")!.ariaLabel).toBe(
      "pos-1, endpoint, 10.0.0.11, VLAN 12",
    );
  });

  test("a device tooltip carries vendor, model and interface counts", () => {
    expect(nodeById(model, "core-1")!.tooltip).toBe(
      "core-1 (up) — Cisco C9300 — 12 up / 1 down",
    );
    expect(nodeById(model, "switch-b")!.tooltip).toBe("switch-b (down)");
    expect(nodeById(model, "unmanaged:ap-1")!.tooltip).toBe(
      "ap-1 (unknown, unmanaged) — AIR-AP1815",
    );
  });

  test("an endpoint tooltip carries the ARP/FDB identity join", () => {
    expect(nodeById(model, "endpoint:pos-1")!.tooltip).toBe(
      "pos-1 (endpoint) — aa:bb:cc:dd:ee:01 · 10.0.0.11 · Zebra · printer · VLAN 12",
    );
  });

  test("test ids are namespaced by id and by edge key", () => {
    expect(nodeById(model, "endpoint:pos-1")!.testId).toBe(
      "network-topology-node-endpoint:pos-1",
    );
    expect(edgeByKey(model, "core-1::switch-a")!.testId).toBe(
      "network-topology-edge-core-1::switch-a",
    );
  });
});

describe("buildTopologyViewModel — edge paint", () => {
  const model: TopologyViewModel = buildTopologyViewModel(makeInput());

  test("a healthy link is neutral, solid, and scaled by utilization", () => {
    const view: TopologyEdgeView = edgeByKey(model, "core-1::switch-a")!;
    expect(view.state).toBe("healthy");
    expect(view.color).toBe(LINK_STATE_COLORS.healthy);
    expect(view.strokeWidth).toBeCloseTo(2.9, 6);
    expect(view.strokeDashArray).toBeUndefined();
  });

  test("a saturated link goes amber and thick", () => {
    const view: TopologyEdgeView = edgeByKey(model, "switch-a::switch-b")!;
    expect(view.state).toBe("saturated");
    expect(view.color).toBe(LINK_STATE_COLORS.saturated);
    expect(view.strokeWidth).toBeCloseTo(4.65, 6);
  });

  test("a link with an end down goes red with the long warning dash", () => {
    const view: TopologyEdgeView = edgeByKey(model, "core-1::switch-b")!;
    expect(view.state).toBe("down");
    expect(view.color).toBe(LINK_STATE_COLORS.down);
    expect(view.strokeDashArray).toBe(DOWN_EDGE_DASH);
    expect(view.strokeWidth).toBeCloseTo(1.5, 6);
  });

  test("an FDB attachment gets the short dash, so it reads as learned", () => {
    const view: TopologyEdgeView = edgeByKey(
      model,
      "endpoint:pos-1::switch-a",
    )!;
    expect(view.state).toBe("unknown");
    expect(view.color).toBe(LINK_STATE_COLORS.unknown);
    expect(view.strokeDashArray).toBe(FDB_EDGE_DASH);
  });

  test("a down FDB attachment keeps the warning dash over the learned dash", () => {
    const downFdb: NetworkTopologyEdge = {
      fromNodeId: "switch-a",
      toNodeId: "endpoint:pos-1",
      protocols: ["fdb"],
      fromInterface: { isOperationallyUp: false },
    };
    const withDownFdb: TopologyViewModel = buildTopologyViewModel(
      makeInput({ edges: [downFdb] }),
    );
    const view: TopologyEdgeView = edgeByKey(
      withDownFdb,
      "endpoint:pos-1::switch-a",
    )!;
    expect(view.strokeDashArray).toBe(DOWN_EDGE_DASH);
  });

  test("a legacy edge with no operational data at all stays solid and neutral", () => {
    const view: TopologyEdgeView = edgeByKey(
      model,
      "switch-a::unmanaged:ap-1",
    )!;
    expect(view.state).toBe("unknown");
    expect(view.strokeDashArray).toBeUndefined();
    expect(view.strokeWidth).toBeCloseTo(1.5, 6);
  });

  test("an edge announces node NAMES, not synthetic ids", () => {
    expect(edgeByKey(model, "endpoint:pos-1::switch-a")!.ariaLabel).toBe(
      "Link from switch-a to pos-1, no operational data, reported by FDB",
    );
    expect(edgeByKey(model, "core-1::switch-a")!.ariaLabel).toBe(
      "Link from core-1 to switch-a, healthy, 40% utilization, reported by LLDP",
    );
  });
});

describe("buildTopologyViewModel — counts and empty states", () => {
  test("visibleNodeCount tracks what is drawn, totalNodeCount what exists", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        visibleKinds: new Set<TopologyNodeKind>(["device", "unmanaged"]),
      }),
    );
    expect(model.visibleNodeCount).toBe(4);
    expect(model.totalNodeCount).toBe(5);
    expect(model.visibleNodeCount).toBe(model.nodes.length);
  });

  test("isFilteredEmpty is true only when there were nodes and none survived", () => {
    const filteredOut: TopologyViewModel = buildTopologyViewModel(
      makeInput({ visibleKinds: new Set<TopologyNodeKind>(["endpoint"]) }),
    );
    expect(filteredOut.visibleNodeCount).toBe(1);
    expect(filteredOut.isFilteredEmpty).toBe(false);

    const nothingLeft: TopologyViewModel = buildTopologyViewModel(
      makeInput({ visibleKinds: new Set<TopologyNodeKind>() }),
    );
    expect(nothingLeft.isFilteredEmpty).toBe(true);
  });

  test("a genuinely empty topology is empty, not filtered-empty", () => {
    // The two states get different copy, so they must not be conflated.
    const empty: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [],
        edges: [],
        positions: new Map<string, TopologyPoint>(),
      }),
    );
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.totalNodeCount).toBe(0);
    expect(empty.visibleNodeCount).toBe(0);
    expect(empty.isFilteredEmpty).toBe(false);
  });

  test("a search that matches nothing is never a filtered-empty state", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "zzzz" }),
    );
    expect(model.isFilteredEmpty).toBe(false);
    expect(model.visibleNodeCount).toBe(5);
  });

  test("two payload rows sharing an id are counted once in the total", () => {
    const twin: NetworkTopologyNode = makeDevice("switch-a", {
      status: "down",
    });
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({
        nodes: [switchA, twin],
        edges: [],
        positions: new Map<string, TopologyPoint>([
          ["switch-a", { x: 0, y: 0 }],
        ]),
      }),
    );
    expect(model.totalNodeCount).toBe(1);
    /*
     * Current behaviour: both rows are still drawn, so a duplicated id
     * would produce two glyphs (and two identical react keys) on top of
     * one another. Asserted as-is rather than silently accepted — the
     * server dedupes nodes per device, so this is unreachable today.
     */
    expect(model.visibleNodeCount).toBe(2);
  });

  test("the model is pure — the same input twice gives the same output", () => {
    expect(buildTopologyViewModel(makeInput())).toEqual(
      buildTopologyViewModel(makeInput()),
    );
  });
});

describe("topologyStructuralSignature", () => {
  test("the signature is the sorted ids and sorted link keys, nothing else", () => {
    expect(topologyStructuralSignature(sampleNodes, sampleEdges)).toBe(
      "core-1,endpoint:pos-1,switch-a,switch-b,unmanaged:ap-1|" +
        "core-1::switch-a,core-1::switch-b,endpoint:pos-1::switch-a," +
        "switch-a::switch-b,switch-a::unmanaged:ap-1",
    );
  });

  test("a fresh payload of the same shape, in a different order, matches", () => {
    /*
     * The topology endpoint returns rows in whatever order the query
     * produced, and that order is not stable across the 60-second poll.
     */
    const rebuiltNodes: Array<NetworkTopologyNode> = [
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
      makeUnmanaged("unmanaged:ap-1", { name: "ap-1" }),
      makeDevice("switch-b"),
      makeDevice("switch-a"),
      makeDevice("core-1"),
    ];
    const rebuiltEdges: Array<NetworkTopologyEdge> = [
      makeEdge("endpoint:pos-1", "switch-a", ["fdb"]),
      makeEdge("unmanaged:ap-1", "switch-a", ["cdp"]),
      makeEdge("switch-a", "switch-b", ["lldp"]),
      makeEdge("switch-b", "core-1", ["lldp"]),
      makeEdge("switch-a", "core-1", ["lldp"]),
    ];
    expect(topologyStructuralSignature(rebuiltNodes, rebuiltEdges)).toBe(
      topologyStructuralSignature(sampleNodes, sampleEdges),
    );
  });

  test("flipping an edge's direction is not a structural change", () => {
    const flipped: Array<NetworkTopologyEdge> = sampleEdges.map(
      (edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        return makeEdge(edge.toNodeId, edge.fromNodeId, edge.protocols);
      },
    );
    expect(topologyStructuralSignature(sampleNodes, flipped)).toBe(
      topologyStructuralSignature(sampleNodes, sampleEdges),
    );
  });

  test("a status, vendor or interface counter change does NOT move it", () => {
    /*
     * This is the whole point: the poll updates statuses and counters
     * every minute, and re-laying the graph out on each poll is both a
     * wasted frame budget and a visibly jumping map.
     */
    const churned: Array<NetworkTopologyNode> = sampleNodes.map(
      (node: NetworkTopologyNode): NetworkTopologyNode => {
        return {
          ...node,
          status: "down",
          vendor: "Juniper",
          interfacesUp: 99,
          interfacesDown: 7,
          sysName: "renamed.lan",
          name: `${node.name}-renamed`,
        };
      },
    );
    expect(topologyStructuralSignature(churned, sampleEdges)).toBe(
      topologyStructuralSignature(sampleNodes, sampleEdges),
    );
  });

  test("edge utilization and protocol churn does NOT move it either", () => {
    const churnedEdges: Array<NetworkTopologyEdge> = sampleEdges.map(
      (edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        return {
          ...edge,
          protocols: ["lldp", "cdp"],
          fromInterface: { utilizationPercent: 99, isOperationallyUp: false },
        };
      },
    );
    expect(topologyStructuralSignature(sampleNodes, churnedEdges)).toBe(
      topologyStructuralSignature(sampleNodes, sampleEdges),
    );
  });

  test("adding or removing a node moves it", () => {
    const baseline: string = topologyStructuralSignature(
      sampleNodes,
      sampleEdges,
    );
    expect(
      topologyStructuralSignature(
        [...sampleNodes, makeDevice("switch-c")],
        sampleEdges,
      ),
    ).not.toBe(baseline);
    expect(
      topologyStructuralSignature(sampleNodes.slice(1), sampleEdges),
    ).not.toBe(baseline);
  });

  test("adding or removing an edge moves it", () => {
    const baseline: string = topologyStructuralSignature(
      sampleNodes,
      sampleEdges,
    );
    expect(
      topologyStructuralSignature(sampleNodes, [
        ...sampleEdges,
        makeEdge("core-1", "unmanaged:ap-1", ["cdp"]),
      ]),
    ).not.toBe(baseline);
    expect(
      topologyStructuralSignature(sampleNodes, sampleEdges.slice(1)),
    ).not.toBe(baseline);
  });

  test("renaming a node's id moves it — that is a different node", () => {
    const renamed: Array<NetworkTopologyNode> = [
      makeDevice("core-2"),
      ...sampleNodes.slice(1),
    ];
    expect(topologyStructuralSignature(renamed, sampleEdges)).not.toBe(
      topologyStructuralSignature(sampleNodes, sampleEdges),
    );
  });

  test("an empty topology has a stable, non-throwing signature", () => {
    expect(topologyStructuralSignature([], [])).toBe("|");
  });

  test("unusable rows are skipped rather than fingerprinted", () => {
    const hostileNodes: Array<NetworkTopologyNode> = [
      makeDevice("core-1"),
      null as unknown as NetworkTopologyNode,
      {
        id: 7,
        name: "n",
        isManaged: true,
        status: "up",
      } as unknown as NetworkTopologyNode,
    ];
    const hostileEdges: Array<NetworkTopologyEdge> = [
      null as unknown as NetworkTopologyEdge,
      makeEdge("", "switch-a"),
      makeEdge("core-1", ""),
    ];
    expect(topologyStructuralSignature(hostileNodes, hostileEdges)).toBe(
      "core-1|",
    );
  });

  test("a poll that changes nothing structural keeps the layout memo warm", () => {
    // End to end: two consecutive poll responses of one live site.
    const first: Array<NetworkTopologyNode> = sampleNodes;
    const second: Array<NetworkTopologyNode> = [...sampleNodes]
      .reverse()
      .map((node: NetworkTopologyNode): NetworkTopologyNode => {
        return { ...node, status: node.status === "up" ? "down" : "up" };
      });
    expect(
      topologyStructuralSignature(second, [...sampleEdges].reverse()),
    ).toBe(topologyStructuralSignature(first, sampleEdges));
  });
});

/*
 * searchMatchCount exists because search and the kind/VLAN filters empty
 * the canvas in two different ways and need two different messages.
 * Filters REMOVE nodes, so the canvas goes blank and isFilteredEmpty says
 * so. Search only DIMS, so a search that matches nothing leaves every
 * node drawn but greyed — which looks exactly like a broken map unless
 * the graph says what happened. The original copy compounded it by
 * telling the user to "adjust the search text" in the one state search
 * can never cause.
 */
describe("buildTopologyViewModel — search match count", () => {
  test("an empty search matches every drawn node", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "" }),
    );
    expect(model.searchMatchCount).toBe(model.visibleNodeCount);
    expect(model.searchMatchCount).toBeGreaterThan(0);
  });

  test("a search matching nothing reports zero while still drawing the map", () => {
    const model: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "there-is-no-such-device" }),
    );
    expect(model.searchMatchCount).toBe(0);
    // Every node is still drawn — search dims, it does not remove.
    expect(model.visibleNodeCount).toBeGreaterThan(0);
    expect(model.isFilteredEmpty).toBe(false);
    for (const nodeView of model.nodes) {
      expect(nodeView.isDimmed).toBe(true);
    }
  });

  test("the count equals the number of undimmed nodes for any search", () => {
    for (const term of ["core", "switch", "pos", "ap-", "z"]) {
      const model: TopologyViewModel = buildTopologyViewModel(
        makeInput({ searchText: term }),
      );
      const undimmed: number = model.nodes.filter(
        (nodeView: TopologyNodeView): boolean => {
          return !nodeView.isDimmed;
        },
      ).length;
      expect(model.searchMatchCount).toBe(undimmed);
    }
  });

  test("a node hidden by a kind filter cannot count as a search match", () => {
    const devicesOnly: ReadonlySet<TopologyNodeKind> =
      new Set<TopologyNodeKind>(["device"]);
    const all: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "pos" }),
    );
    const filtered: TopologyViewModel = buildTopologyViewModel(
      makeInput({ searchText: "pos", visibleKinds: devicesOnly }),
    );
    expect(all.searchMatchCount).toBeGreaterThan(0);
    expect(filtered.searchMatchCount).toBe(0);
  });
});
