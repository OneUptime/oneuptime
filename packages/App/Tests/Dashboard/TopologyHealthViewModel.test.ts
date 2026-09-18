import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ALL_NODE_KINDS,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  TopologyViewModelInput,
  buildTopologyViewModel,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import { TopologyHealthFilterMode } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyHealthFilter";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * Issue #3261, the rendering half: what the health filter does to the
 * descriptors the graph actually draws.
 *
 * TopologyHealthFilter.test covers the rules in isolation. This file
 * covers the join — that the kind filter still wins, that a filtered map
 * keeps its coordinates, that the matches are the undimmed ones, and that
 * an emptied canvas is reported as the specific kind of empty it is.
 */

/*
 *          core (up)
 *          /      \
 *   edge-1(down)  edge-2 (up, one dark port -> degraded)
 *        |
 *   endpoint:pos-1 (up)
 *
 * Plus `spare`, an up device with nothing attached.
 */
const nodes: Array<NetworkTopologyNode> = [
  { id: "core", name: "core-1", isManaged: true, status: "up", kind: "device" },
  {
    id: "edge-1",
    name: "edge-1",
    isManaged: true,
    status: "down",
    kind: "device",
  },
  {
    id: "edge-2",
    name: "edge-2",
    isManaged: true,
    status: "up",
    kind: "device",
    interfacesUp: 23,
    interfacesDown: 1,
  },
  {
    id: "endpoint:pos-1",
    name: "pos-1",
    isManaged: false,
    status: "up",
    kind: "endpoint",
  },
  {
    id: "spare",
    name: "spare",
    isManaged: true,
    status: "up",
    kind: "device",
  },
];

const edges: Array<NetworkTopologyEdge> = [
  { fromNodeId: "core", toNodeId: "edge-1" },
  { fromNodeId: "core", toNodeId: "edge-2" },
  {
    fromNodeId: "edge-1",
    toNodeId: "endpoint:pos-1",
    protocols: ["fdb"],
  },
];

const positions: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
  ["core", { x: 500, y: 100 }],
  ["edge-1", { x: 300, y: 300 }],
  ["edge-2", { x: 700, y: 300 }],
  ["endpoint:pos-1", { x: 300, y: 500 }],
  ["spare", { x: 100, y: 500 }],
]);

type MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
) => TopologyViewModelInput;

const makeInput: MakeInputFunction = (
  overrides?: Partial<TopologyViewModelInput>,
): TopologyViewModelInput => {
  return {
    nodes: nodes,
    edges: edges,
    positions: positions,
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
    ...overrides,
  };
};

type ModelForFunction = (
  mode: TopologyHealthFilterMode,
  overrides?: Partial<TopologyViewModelInput>,
) => TopologyViewModel;

const modelFor: ModelForFunction = (
  mode: TopologyHealthFilterMode,
  overrides?: Partial<TopologyViewModelInput>,
): TopologyViewModel => {
  return buildTopologyViewModel(
    makeInput({ healthFilterMode: mode, ...overrides }),
  );
};

const drawnIds: (model: TopologyViewModel) => Array<string> = (
  model: TopologyViewModel,
): Array<string> => {
  return model.nodes
    .map((node: TopologyNodeView): string => {
      return node.id;
    })
    .sort();
};

const viewFor: (model: TopologyViewModel, id: string) => TopologyNodeView = (
  model: TopologyViewModel,
  id: string,
): TopologyNodeView => {
  const view: TopologyNodeView | undefined = model.nodes.find(
    (node: TopologyNodeView): boolean => {
      return node.id === id;
    },
  );
  expect(view).toBeDefined();
  return view!;
};

describe("buildTopologyViewModel — health filter off", () => {
  test("draws the whole map", () => {
    expect(drawnIds(modelFor("all"))).toEqual([
      "core",
      "edge-1",
      "edge-2",
      "endpoint:pos-1",
      "spare",
    ]);
  });

  test("dims nothing", () => {
    for (const node of modelFor("all").nodes) {
      expect(node.isDimmed).toBe(false);
    }
  });

  test("reports itself as inactive", () => {
    expect(modelFor("all").isHealthFilterActive).toBe(false);
  });

  test("still classifies every node so the chips have something to count", () => {
    const model: TopologyViewModel = modelFor("all");
    expect(viewFor(model, "edge-1").health).toBe("down");
    expect(viewFor(model, "edge-2").health).toBe("degraded");
    expect(viewFor(model, "core").health).toBe("healthy");
    expect(viewFor(model, "spare").health).toBe("healthy");
  });

  test("draws no attention state that the graph could turn into a halo", () => {
    /*
     * The halo is gated on isHealthFilterActive, so a permanently-ringed
     * map is impossible even though every node "matches" under All.
     */
    expect(modelFor("all").isHealthFilterActive).toBe(false);
  });
});

describe("buildTopologyViewModel — Needs attention", () => {
  test("keeps the unhealthy devices and the neighbours that place them", () => {
    /*
     * edge-1 is down, edge-2 is degraded, core is the healthy neighbour of
     * both. `spare` is healthy and attached to nothing, so it goes.
     */
    expect(drawnIds(modelFor("attention"))).toEqual([
      "core",
      "edge-1",
      "edge-2",
    ]);
  });

  test("drops a healthy device with no unhealthy neighbour", () => {
    expect(drawnIds(modelFor("attention"))).not.toContain("spare");
  });

  test("never brings the endpoint fan back", () => {
    expect(drawnIds(modelFor("attention"))).not.toContain("endpoint:pos-1");
  });

  test("the matches are drawn at full strength", () => {
    const model: TopologyViewModel = modelFor("attention");
    expect(viewFor(model, "edge-1").isDimmed).toBe(false);
    expect(viewFor(model, "edge-2").isDimmed).toBe(false);
  });

  test("the context neighbour is drawn dimmed", () => {
    const model: TopologyViewModel = modelFor("attention");
    expect(viewFor(model, "core").isDimmed).toBe(true);
    expect(viewFor(model, "core").isHealthMatch).toBe(false);
  });

  test("counts only the matches, not the context", () => {
    const model: TopologyViewModel = modelFor("attention");
    expect(model.healthMatchCount).toBe(2);
    expect(model.visibleNodeCount).toBe(3);
  });

  test("reports itself as active", () => {
    expect(modelFor("attention").isHealthFilterActive).toBe(true);
  });

  test("totalNodeCount still describes the whole payload", () => {
    /*
     * The denominator is what the map has, not what it is showing —
     * "3 of 5" is the sentence, and a total that shrank with the filter
     * would make it "3 of 3".
     */
    expect(modelFor("attention").totalNodeCount).toBe(nodes.length);
  });

  test("coordinates are untouched, so toggling the filter never reshuffles the map", () => {
    const all: TopologyViewModel = modelFor("all");
    const filtered: TopologyViewModel = modelFor("attention");
    for (const node of filtered.nodes) {
      const before: TopologyNodeView = viewFor(all, node.id);
      expect(node.x).toBe(before.x);
      expect(node.y).toBe(before.y);
    }
  });

  test("a link whose far end was filtered away is not drawn", () => {
    const keys: Array<string> = modelFor("attention").edges.map(
      (edge: TopologyEdgeView): string => {
        return edge.key;
      },
    );
    expect(
      keys.some((key: string): boolean => {
        return key.includes("endpoint:pos-1");
      }),
    ).toBe(false);
  });

  test("a link between a match and its context IS drawn", () => {
    const model: TopologyViewModel = modelFor("attention");
    expect(
      model.edges.some((edge: TopologyEdgeView): boolean => {
        return edge.fromNodeId === "core" && edge.toNodeId === "edge-1";
      }),
    ).toBe(true);
  });

  test("a link into a dimmed context node is dimmed with it", () => {
    const model: TopologyViewModel = modelFor("attention");
    const edge: TopologyEdgeView | undefined = model.edges.find(
      (candidate: TopologyEdgeView): boolean => {
        return candidate.fromNodeId === "core";
      },
    );
    expect(edge?.isDimmed).toBe(true);
  });
});

describe("buildTopologyViewModel — Down and Degraded on their own", () => {
  test("Down matches only the unreachable device", () => {
    const model: TopologyViewModel = modelFor("down");
    expect(viewFor(model, "edge-1").isHealthMatch).toBe(true);
    expect(model.healthMatchCount).toBe(1);
  });

  test("Down keeps only the match and its own neighbour", () => {
    /*
     * edge-2 is degraded, but "Down" was not asked about degraded, and
     * context is one hop from a MATCH — edge-2 is one hop from core,
     * which is itself only context. Two hops is a different map.
     */
    expect(drawnIds(modelFor("down"))).toEqual(["core", "edge-1"]);
  });

  test("Degraded matches the device with the dark port", () => {
    const model: TopologyViewModel = modelFor("degraded");
    expect(viewFor(model, "edge-2").isHealthMatch).toBe(true);
    expect(model.healthMatchCount).toBe(1);
  });

  test("Degraded does not match the down device", () => {
    expect(drawnIds(modelFor("degraded"))).not.toContain("edge-1");
  });
});

describe("buildTopologyViewModel — health and the other filters together", () => {
  test("a kind the user switched off cannot come back as health context", () => {
    const devicesOnly: ReadonlySet<TopologyNodeKind> =
      new Set<TopologyNodeKind>(["device"]);
    expect(
      drawnIds(modelFor("attention", { visibleKinds: devicesOnly })),
    ).toEqual(["core", "edge-1", "edge-2"]);
  });

  test("a kind filter that removes the match removes it from the health view too", () => {
    const endpointsOnly: ReadonlySet<TopologyNodeKind> =
      new Set<TopologyNodeKind>(["endpoint"]);
    const model: TopologyViewModel = modelFor("attention", {
      visibleKinds: endpointsOnly,
    });
    expect(model.nodes).toHaveLength(0);
    expect(model.healthMatchCount).toBe(0);
  });

  test("search dims WITHIN the health filter rather than fighting it", () => {
    const model: TopologyViewModel = modelFor("attention", {
      searchText: "edge-1",
    });
    expect(viewFor(model, "edge-1").isDimmed).toBe(false);
    expect(viewFor(model, "edge-2").isDimmed).toBe(true);
    expect(model.searchMatchCount).toBe(1);
  });

  test("a search matching only a filtered-away device reports zero matches", () => {
    const model: TopologyViewModel = modelFor("attention", {
      searchText: "spare",
    });
    expect(model.searchMatchCount).toBe(0);
    expect(model.nodes.length).toBeGreaterThan(0);
  });

  test("selection survives the filter when the selected node is still drawn", () => {
    const model: TopologyViewModel = modelFor("attention", {
      selectedNodeId: "edge-1",
    });
    expect(viewFor(model, "edge-1").isSelected).toBe(true);
  });

  test("hover focus still dims — the two dimming rules compose", () => {
    const model: TopologyViewModel = modelFor("attention", {
      focusNodeIds: new Set<string>(["edge-1"]),
    });
    expect(viewFor(model, "edge-1").isDimmed).toBe(false);
    expect(viewFor(model, "edge-2").isDimmed).toBe(true);
  });
});

describe("buildTopologyViewModel — an emptied canvas", () => {
  const healthyNodes: Array<NetworkTopologyNode> = [
    {
      id: "a",
      name: "a",
      isManaged: true,
      status: "up",
      kind: "device",
    },
    {
      id: "b",
      name: "b",
      isManaged: true,
      status: "up",
      kind: "device",
    },
  ];

  const healthyModel: TopologyViewModel = buildTopologyViewModel({
    nodes: healthyNodes,
    edges: [{ fromNodeId: "a", toNodeId: "b" }],
    positions: new Map<string, TopologyPoint>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 50, y: 0 }],
    ]),
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "attention",
    focusNodeIds: new Set<string>(),
    selectedNodeId: null,
    selectedEdgeKey: null,
    pinnedNodeIds: new Set<string>(),
  });

  test("a healthy network under Needs attention draws nothing", () => {
    expect(healthyModel.nodes).toHaveLength(0);
    expect(healthyModel.edges).toHaveLength(0);
  });

  test("and says so through isFilteredEmpty", () => {
    expect(healthyModel.isFilteredEmpty).toBe(true);
  });

  test("reports that the kind filter left plenty behind — health emptied it", () => {
    /*
     * The graph words its empty state off these two together: nodes
     * survived the kind filter, and health removed all of them. Pointing
     * somebody at the health control when their NODE TYPE filter is the
     * cause would send them to the wrong switch.
     */
    expect(healthyModel.kindFilteredNodeCount).toBe(healthyNodes.length);
  });

  test("a kind filter that empties the canvas reports zero survivors", () => {
    const model: TopologyViewModel = buildTopologyViewModel({
      nodes: healthyNodes,
      edges: [],
      positions: new Map<string, TopologyPoint>([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 50, y: 0 }],
      ]),
      searchText: "",
      visibleKinds: new Set<TopologyNodeKind>(["endpoint"]),
      healthFilterMode: "attention",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
    });
    expect(model.isFilteredEmpty).toBe(true);
    expect(model.kindFilteredNodeCount).toBe(0);
  });

  test("and flags the health filter as the cause, so the message can be good news", () => {
    /*
     * The graph words its empty state off this flag: "nothing needs
     * attention" rather than "no devices match your filters", which over
     * a healthy network reads as a fault.
     */
    expect(healthyModel.isHealthFilterActive).toBe(true);
    expect(healthyModel.healthMatchCount).toBe(0);
  });

  test("an empty payload is not reported as a filtered-empty map", () => {
    const model: TopologyViewModel = buildTopologyViewModel({
      nodes: [],
      edges: [],
      positions: new Map<string, TopologyPoint>(),
      searchText: "",
      visibleKinds: ALL_NODE_KINDS,
      healthFilterMode: "attention",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
    });
    expect(model.isFilteredEmpty).toBe(false);
  });
});
