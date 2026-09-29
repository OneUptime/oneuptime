import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ALL_HEALTH_FILTER_MODES,
  HEALTH_STATE_COLORS,
  TopologyHealthFilterMode,
  TopologyHealthFilterOption,
  TopologyHealthState,
  TopologyHealthSummary,
  TopologyHealthVisibility,
  buildHealthFilterOptions,
  healthCountForMode,
  healthStateByNodeId,
  healthStateForNode,
  healthStateMatchesMode,
  isHealthFilterActive,
  nodeIdsWithDownLinks,
  resolveHealthVisibility,
  summarizeTopologyHealth,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyHealthFilter";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";

/*
 * Issue #3261 — the health filter's rules, one assertion at a time.
 *
 * The whole feature is a claim about which devices a busy operator is
 * pointed at, so every branch of that claim is pinned here: what counts as
 * degraded, what a filter is allowed to hide, and — the one that matters
 * most — what it is never allowed to hide, resurrect or invent.
 */

type MakeDeviceFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeDevice: MakeDeviceFunction = (
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

const makeUnmanaged: MakeDeviceFunction = (
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

const makeEndpoint: MakeDeviceFunction = (
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
  overrides?: Partial<NetworkTopologyEdge>,
) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
  overrides?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge => {
  return {
    fromNodeId: from,
    toNodeId: to,
    ...overrides,
  };
};

describe("healthStateForNode", () => {
  test("a device that did not answer is down", () => {
    expect(healthStateForNode(makeDevice("d", { status: "down" }))).toBe(
      "down",
    );
  });

  test("reachability beats interface counts — a down device is never degraded", () => {
    /*
     * The counts on a device that stopped answering are by definition
     * stale, so a device reporting "everything up" from before it died
     * must not be softened into degraded.
     */
    expect(
      healthStateForNode(
        makeDevice("d", {
          status: "down",
          interfacesUp: 48,
          interfacesDown: 0,
        }),
      ),
    ).toBe("down");
  });

  test("a reachable device with a dark port is degraded", () => {
    expect(
      healthStateForNode(
        makeDevice("d", { status: "up", interfacesUp: 47, interfacesDown: 1 }),
      ),
    ).toBe("degraded");
  });

  test("a reachable device with every port up is healthy", () => {
    expect(
      healthStateForNode(
        makeDevice("d", { status: "up", interfacesUp: 48, interfacesDown: 0 }),
      ),
    ).toBe("healthy");
  });

  test("a reachable device with no interface counts at all is healthy", () => {
    expect(healthStateForNode(makeDevice("d", { status: "up" }))).toBe(
      "healthy",
    );
  });

  test("a reachable device at the end of a dead link is degraded", () => {
    expect(
      healthStateForNode(makeDevice("d", { status: "up" }), {
        hasDownLink: true,
      }),
    ).toBe("degraded");
  });

  test("an unknown device stays unknown even at the end of a dead link", () => {
    /*
     * Unknown means "no verdict". Promoting it to degraded would fill an
     * attention list with devices nobody has finished onboarding — and
     * the polled device at the OTHER end of that link reports the same
     * dead link honestly.
     */
    expect(
      healthStateForNode(makeUnmanaged("unmanaged:p"), { hasDownLink: true }),
    ).toBe("unknown");
  });

  test("an unmanaged peer that has been seen up is healthy", () => {
    expect(healthStateForNode(makeUnmanaged("u", { status: "up" }))).toBe(
      "healthy",
    );
  });

  test("an endpoint we know is up is healthy — it has no ports of its own", () => {
    expect(
      healthStateForNode(
        makeEndpoint("endpoint:pos-1", {
          status: "up",
          interfacesDown: 3,
        }),
        { hasDownLink: true },
      ),
    ).toBe("healthy");
  });

  test("an endpoint reported down is still down", () => {
    expect(
      healthStateForNode(makeEndpoint("endpoint:pos-1", { status: "down" })),
    ).toBe("down");
  });

  test("a missing node is unknown rather than a crash", () => {
    expect(
      healthStateForNode(undefined as unknown as NetworkTopologyNode),
    ).toBe("unknown");
  });

  test("no context argument reads the same as an empty one", () => {
    const node: NetworkTopologyNode = makeDevice("d", { status: "up" });
    expect(healthStateForNode(node)).toBe(healthStateForNode(node, {}));
  });
});

describe("nodeIdsWithDownLinks", () => {
  test("an operationally-down end marks BOTH ends of the link", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([
      makeEdge("a", "b", { fromInterface: { isOperationallyUp: false } }),
    ]);
    expect(Array.from(ids).sort()).toEqual(["a", "b"]);
  });

  test("a monitor reporting down on a manual link counts", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([
      makeEdge("a", "b", { monitorState: "down", protocols: ["manual"] }),
    ]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
  });

  test("a saturated link is not a down link", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([
      makeEdge("a", "b", {
        fromInterface: { isOperationallyUp: true, utilizationPercent: 97 },
      }),
    ]);
    expect(ids.size).toBe(0);
  });

  test("a healthy link contributes nobody", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([
      makeEdge("a", "b", { fromInterface: { isOperationallyUp: true } }),
    ]);
    expect(ids.size).toBe(0);
  });

  test("malformed rows are skipped rather than thrown on", () => {
    const ids: Set<string> = nodeIdsWithDownLinks([
      null as unknown as NetworkTopologyEdge,
      { fromNodeId: "a" } as unknown as NetworkTopologyEdge,
      makeEdge("a", "b", { toInterface: { isOperationallyUp: false } }),
    ]);
    expect(Array.from(ids).sort()).toEqual(["a", "b"]);
  });

  test("no edges at all is an empty set", () => {
    expect(nodeIdsWithDownLinks(undefined).size).toBe(0);
  });
});

describe("healthStateByNodeId", () => {
  test("a dead link degrades the reachable device at its end", () => {
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      [
        makeDevice("core", { status: "up" }),
        makeDevice("edge", { status: "down" }),
      ],
      [
        makeEdge("core", "edge", {
          fromInterface: { isOperationallyUp: false },
        }),
      ],
    );
    expect(byId.get("core")).toBe("degraded");
    expect(byId.get("edge")).toBe("down");
  });

  test("nodes with no id are dropped rather than keyed under undefined", () => {
    const byId: Map<string, TopologyHealthState> = healthStateByNodeId(
      [
        makeDevice("core"),
        { name: "nameless" } as unknown as NetworkTopologyNode,
      ],
      [],
    );
    expect(Array.from(byId.keys())).toEqual(["core"]);
  });
});

describe("summarizeTopologyHealth", () => {
  const nodes: Array<NetworkTopologyNode> = [
    makeDevice("down-1", { status: "down" }),
    makeDevice("down-2", { status: "down" }),
    makeDevice("degraded-1", { status: "up", interfacesDown: 2 }),
    makeDevice("healthy-1", { status: "up" }),
    makeDevice("healthy-2", { status: "up", interfacesDown: 0 }),
    makeUnmanaged("unmanaged:peer"),
  ];

  test("counts every state and totals them", () => {
    const summary: TopologyHealthSummary = summarizeTopologyHealth(nodes, []);
    expect(summary).toEqual({
      total: 6,
      down: 2,
      degraded: 1,
      healthy: 2,
      unknown: 1,
      attention: 3,
    });
  });

  test("attention is exactly down plus degraded", () => {
    const summary: TopologyHealthSummary = summarizeTopologyHealth(nodes, []);
    expect(summary.attention).toBe(summary.down + summary.degraded);
  });

  test("the states partition the total", () => {
    const summary: TopologyHealthSummary = summarizeTopologyHealth(nodes, []);
    expect(
      summary.down + summary.degraded + summary.healthy + summary.unknown,
    ).toBe(summary.total);
  });

  test("a dead link moves a device from healthy to degraded", () => {
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("healthy-1", "down-1", {
        fromInterface: { isOperationallyUp: false },
      }),
    ];
    const before: TopologyHealthSummary = summarizeTopologyHealth(nodes, []);
    const after: TopologyHealthSummary = summarizeTopologyHealth(nodes, edges);
    expect(after.degraded).toBe(before.degraded + 1);
    expect(after.healthy).toBe(before.healthy - 1);
    expect(after.total).toBe(before.total);
  });

  test("a repeated node id is counted once", () => {
    const summary: TopologyHealthSummary = summarizeTopologyHealth(
      [
        makeDevice("d", { status: "down" }),
        makeDevice("d", { status: "down" }),
      ],
      [],
    );
    expect(summary.total).toBe(1);
  });

  test("an empty topology summarises to zeroes rather than throwing", () => {
    expect(summarizeTopologyHealth(undefined, undefined)).toEqual({
      total: 0,
      down: 0,
      degraded: 0,
      healthy: 0,
      unknown: 0,
      attention: 0,
    });
  });
});

describe("mode helpers", () => {
  test("only All is inactive", () => {
    expect(isHealthFilterActive("all")).toBe(false);
    for (const mode of ALL_HEALTH_FILTER_MODES) {
      if (mode !== "all") {
        expect(isHealthFilterActive(mode)).toBe(true);
      }
    }
  });

  test("All matches every state", () => {
    const states: Array<TopologyHealthState> = [
      "down",
      "degraded",
      "healthy",
      "unknown",
    ];
    for (const state of states) {
      expect(healthStateMatchesMode(state, "all")).toBe(true);
    }
  });

  test("Needs attention is down or degraded, and nothing else", () => {
    expect(healthStateMatchesMode("down", "attention")).toBe(true);
    expect(healthStateMatchesMode("degraded", "attention")).toBe(true);
    expect(healthStateMatchesMode("healthy", "attention")).toBe(false);
    expect(healthStateMatchesMode("unknown", "attention")).toBe(false);
  });

  test("Down and Degraded are each only themselves", () => {
    expect(healthStateMatchesMode("down", "down")).toBe(true);
    expect(healthStateMatchesMode("degraded", "down")).toBe(false);
    expect(healthStateMatchesMode("degraded", "degraded")).toBe(true);
    expect(healthStateMatchesMode("down", "degraded")).toBe(false);
  });

  test("counts follow the mode", () => {
    const summary: TopologyHealthSummary = {
      total: 10,
      down: 3,
      degraded: 2,
      healthy: 4,
      unknown: 1,
      attention: 5,
    };
    expect(healthCountForMode(summary, "all")).toBe(10);
    expect(healthCountForMode(summary, "attention")).toBe(5);
    expect(healthCountForMode(summary, "down")).toBe(3);
    expect(healthCountForMode(summary, "degraded")).toBe(2);
  });
});

/*
 * The heart of it: what a filter keeps. A map that quietly drops a down
 * device is the same failure as one that quietly invents one, and the
 * context rule exists so the survivors are readable as a network rather
 * than as loose dots.
 */
describe("resolveHealthVisibility", () => {
  /*
   *      core (up, degraded by the dead link to edge-1)
   *      /  \
   * edge-1   edge-2        pos-1 hangs off edge-1 as an endpoint
   * (down)   (up, healthy)
   */
  const nodes: Array<NetworkTopologyNode> = [
    makeDevice("core", { status: "up" }),
    makeDevice("edge-1", { status: "down" }),
    makeDevice("edge-2", { status: "up" }),
    makeEndpoint("endpoint:pos-1", { status: "up" }),
    makeDevice("island", { status: "up", interfacesDown: 4 }),
  ];
  const edges: Array<NetworkTopologyEdge> = [
    makeEdge("core", "edge-1", { fromInterface: { isOperationallyUp: false } }),
    makeEdge("core", "edge-2", { fromInterface: { isOperationallyUp: true } }),
    makeEdge("edge-1", "endpoint:pos-1", { protocols: ["fdb"] }),
  ];

  test("All matches everything and pulls in no context", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "all",
    });
    expect(visibility.matchedNodeIds.size).toBe(nodes.length);
    expect(visibility.contextNodeIds.size).toBe(0);
    expect(visibility.visibleNodeIds.size).toBe(nodes.length);
  });

  test("Needs attention matches the down device and the degraded ones", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    expect(Array.from(visibility.matchedNodeIds).sort()).toEqual([
      "core",
      "edge-1",
      "island",
    ]);
  });

  test("a match keeps its directly-linked devices as context", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    // edge-2 is healthy, but it is what places `core` on the map.
    expect(Array.from(visibility.contextNodeIds)).toEqual(["edge-2"]);
    expect(visibility.visibleNodeIds.has("edge-2")).toBe(true);
  });

  test("endpoints are never pulled in as context", () => {
    /*
     * One down access switch can carry hundreds of learned hosts. Letting
     * that fan back onto a map whose entire purpose was to be short would
     * undo the filter at the first switch it matched.
     */
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    expect(visibility.contextNodeIds.has("endpoint:pos-1")).toBe(false);
    expect(visibility.visibleNodeIds.has("endpoint:pos-1")).toBe(false);
  });

  test("context is found from either end of a link", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: [
        makeDevice("healthy-peer", { status: "up" }),
        makeDevice("dead", { status: "down" }),
      ],
      // The matched node is the TO end here, not the FROM end.
      edges: [makeEdge("healthy-peer", "dead")],
      mode: "attention",
    });
    expect(Array.from(visibility.contextNodeIds)).toEqual(["healthy-peer"]);
  });

  test("a matched node is never also listed as context", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    for (const id of visibility.contextNodeIds) {
      expect(visibility.matchedNodeIds.has(id)).toBe(false);
    }
  });

  test("visible is exactly matched plus context", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    expect(visibility.visibleNodeIds.size).toBe(
      visibility.matchedNodeIds.size + visibility.contextNodeIds.size,
    );
  });

  test("an unlinked match survives on its own", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    expect(visibility.visibleNodeIds.has("island")).toBe(true);
  });

  test("Down alone leaves the degraded devices out", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "down",
    });
    expect(Array.from(visibility.matchedNodeIds)).toEqual(["edge-1"]);
    // core is healthy-adjacent to the match, so it comes back as context.
    expect(visibility.contextNodeIds.has("core")).toBe(true);
  });

  test("Degraded alone leaves the down devices out of the matches", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "degraded",
    });
    expect(Array.from(visibility.matchedNodeIds).sort()).toEqual([
      "core",
      "island",
    ]);
    expect(visibility.matchedNodeIds.has("edge-1")).toBe(false);
  });

  test("a kind filter constrains what can match", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
      eligibleNodeIds: new Set<string>(["edge-1"]),
    });
    expect(Array.from(visibility.matchedNodeIds)).toEqual(["edge-1"]);
  });

  test("a kind filter constrains what can come back as context", () => {
    /*
     * A health filter must never resurrect a node type the user switched
     * off. `core` is eligible and matches; `edge-2` is not eligible and
     * so must stay off the map however well it would explain the match.
     */
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
      eligibleNodeIds: new Set<string>(["core", "edge-1"]),
    });
    expect(visibility.contextNodeIds.has("edge-2")).toBe(false);
    expect(visibility.visibleNodeIds.has("edge-2")).toBe(false);
  });

  test("every node gets a state, matched or not", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: nodes,
      edges: edges,
      mode: "attention",
    });
    for (const node of nodes) {
      expect(visibility.stateByNodeId.has(node.id)).toBe(true);
    }
  });

  test("an edge naming a node that is not in the payload cannot invent one", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: [makeDevice("dead", { status: "down" })],
      edges: [makeEdge("dead", "ghost")],
      mode: "attention",
    });
    expect(visibility.visibleNodeIds.has("ghost")).toBe(false);
    expect(visibility.contextNodeIds.size).toBe(0);
  });

  test("an empty topology resolves to empty sets", () => {
    const visibility: TopologyHealthVisibility = resolveHealthVisibility({
      nodes: [],
      edges: [],
      mode: "attention",
    });
    expect(visibility.visibleNodeIds.size).toBe(0);
    expect(visibility.matchedNodeIds.size).toBe(0);
  });
});

describe("buildHealthFilterOptions", () => {
  const summary: TopologyHealthSummary = {
    total: 12,
    down: 3,
    degraded: 2,
    healthy: 6,
    unknown: 1,
    attention: 5,
  };

  test("offers every mode, in a fixed order, whatever the counts", () => {
    const options: Array<TopologyHealthFilterOption> =
      buildHealthFilterOptions(summary);
    expect(
      options.map((option: TopologyHealthFilterOption): string => {
        return option.value;
      }),
    ).toEqual(["all", "attention", "down", "degraded"]);
  });

  test("a zero count still gets its chip", () => {
    const options: Array<TopologyHealthFilterOption> = buildHealthFilterOptions(
      {
        total: 4,
        down: 0,
        degraded: 0,
        healthy: 4,
        unknown: 0,
        attention: 0,
      },
    );
    expect(options).toHaveLength(4);
    expect(
      options.every((option: TopologyHealthFilterOption): boolean => {
        return option.count >= 0;
      }),
    ).toBe(true);
  });

  test("each chip carries the count its mode would leave on the map", () => {
    const options: Array<TopologyHealthFilterOption> =
      buildHealthFilterOptions(summary);
    for (const option of options) {
      expect(option.count).toBe(
        healthCountForMode(summary, option.value as TopologyHealthFilterMode),
      );
    }
  });

  test("All carries no status dot; every state chip does", () => {
    const options: Array<TopologyHealthFilterOption> =
      buildHealthFilterOptions(summary);
    for (const option of options) {
      if (option.value === "all") {
        expect(option.color).toBeUndefined();
      } else {
        expect(option.color).toBeTruthy();
      }
    }
  });

  test("every chip has a label, help text and a stable test id", () => {
    const options: Array<TopologyHealthFilterOption> =
      buildHealthFilterOptions(summary);
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.testId).toBe(
        `network-topology-health-filter-${option.value}`,
      );
    }
  });
});

describe("HEALTH_STATE_COLORS", () => {
  test("reuses the map's own palette rather than a second one", () => {
    /*
     * The chip that says "3 down" points at three dots. If it were not
     * literally the same red, the reader would have two colour schemes to
     * reconcile instead of one shortcut.
     */
    expect(HEALTH_STATE_COLORS.down).toBe(NODE_STATUS_COLORS.down);
    expect(HEALTH_STATE_COLORS.healthy).toBe(NODE_STATUS_COLORS.up);
    expect(HEALTH_STATE_COLORS.unknown).toBe(NODE_STATUS_COLORS.unknown);
    expect(HEALTH_STATE_COLORS.degraded).toBe(LINK_STATE_COLORS.saturated);
  });

  test("down and healthy are never the same colour", () => {
    expect(HEALTH_STATE_COLORS.down).not.toBe(HEALTH_STATE_COLORS.healthy);
  });
});
