import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  TOPOLOGY_CONNECTIONS_CENTER_ID,
  TOPOLOGY_CONNECTIONS_CHORD_REACH,
  TOPOLOGY_CONNECTIONS_LIMITS,
  TopologyConnectionsEdge,
  TopologyConnectionsView,
  computeTopologyConnectionsView,
  countTopologyConnectedParts,
  getTopologyConnectedParts,
  orderTopologyRing,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyConnections";

/*
 * The Connections view: one thing in the middle, what it is connected to
 * on a ring around it, and what those are connected to further out - the
 * way Security Events draws what co-occurs with a filter. These hold what
 * stands in the middle (a picked part, a search, "Needs attention", else
 * the resource and its most connected parts), the order and the limits of
 * each ring, and the lines drawn between them.
 *
 * An account, as its cloud lists it:
 *
 *   vnet  <- nic-1, nic-2, vm-1, vm-2, pe-sql   (runs in)
 *   nic-1 -> vm-1, nic-2 -> vm-2                 (attached to)
 *   lb    -> nic-1, nic-2                        (sends traffic to)
 *   pip   -> lb                                  (attached to)
 *   pe-sql -> db                                 (sends traffic to)
 *   storage                                      (connected to nothing)
 */

const RUNS_IN: Pick<ResourceTopologyRelation, "label" | "inverseLabel"> = {
  label: "Runs in",
  inverseLabel: "Runs here",
};
const ATTACHED_TO: Pick<ResourceTopologyRelation, "label" | "inverseLabel"> = {
  label: "Attached to",
  inverseLabel: "Has attached",
};
const SENDS_TO: Pick<ResourceTopologyRelation, "label" | "inverseLabel"> = {
  label: "Sends traffic to",
  inverseLabel: "Gets traffic from",
};

function part(
  id: string,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id,
    parentId: id === "account" ? null : "account",
    kind: "cloud.networking",
    name: id,
    health: "healthy",
    ...overrides,
  };
}

function connection(
  from: string,
  to: string,
  words: Pick<ResourceTopologyRelation, "label" | "inverseLabel">,
): ResourceTopologyRelation {
  return { from, to, ...words };
}

const CONNECTIONS: Array<ResourceTopologyRelation> = [
  connection("nic-1", "vnet", RUNS_IN),
  connection("nic-2", "vnet", RUNS_IN),
  connection("vm-1", "vnet", RUNS_IN),
  connection("vm-2", "vnet", RUNS_IN),
  connection("pe-sql", "vnet", RUNS_IN),
  connection("nic-1", "vm-1", ATTACHED_TO),
  connection("nic-2", "vm-2", ATTACHED_TO),
  connection("lb", "nic-1", SENDS_TO),
  connection("lb", "nic-2", SENDS_TO),
  connection("pip", "lb", ATTACHED_TO),
  connection("pe-sql", "db", SENDS_TO),
];

function account(
  health: Record<string, ResourceTopologyHealth> = {},
  connections: Array<ResourceTopologyRelation> = CONNECTIONS,
): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "account",
    nodes: [
      part("account", { kind: "cloud.account", name: "Production" }),
      ...[
        "vnet",
        "nic-1",
        "nic-2",
        "vm-1",
        "vm-2",
        "lb",
        "pip",
        "pe-sql",
        "db",
        "storage",
      ].map((id: string): ResourceTopologyNodeInput => {
        return part(id, { health: health[id] || "healthy" });
      }),
    ],
    connections,
  });
}

function view(
  graph: ResourceTopologyGraph,
  options: Partial<Parameters<typeof computeTopologyConnectionsView>[1]> = {},
): TopologyConnectionsView {
  return computeTopologyConnectionsView(graph, {
    selectedId: null,
    search: "",
    attentionOnly: false,
    ...options,
  });
}

function pairs(result: TopologyConnectionsView): Array<string> {
  return result.edges
    .map((edge: TopologyConnectionsEdge): string => {
      const words: string = edge.relations
        .map((relation: ResourceTopologyRelation): string => {
          return `${relation.from}>${relation.to}:${relation.label}`;
        })
        .join(",");

      return words ? words : `${edge.from}-${edge.to}`;
    })
    .sort();
}

describe("what a part is connected to", () => {
  test("counts each part it is connected to once, whichever way the connection reads", () => {
    const graph: ResourceTopologyGraph = account();

    expect(countTopologyConnectedParts(graph, "vnet")).toBe(5);
    expect(countTopologyConnectedParts(graph, "nic-1")).toBe(3);
    expect(countTopologyConnectedParts(graph, "storage")).toBe(0);
    expect(
      Array.from(getTopologyConnectedParts(graph, "lb").keys()).sort(),
    ).toEqual(["nic-1", "nic-2", "pip"]);
  });
});

describe("a picked part in the middle", () => {
  const graph: ResourceTopologyGraph = account();
  const result: TopologyConnectionsView = view(graph, { selectedId: "vnet" });

  test("stands in the middle, with every part it is connected to around it", () => {
    expect(result.centerKind).toBe("part");
    expect(result.centerId).toBe("vnet");
    expect([...result.ring].sort()).toEqual(
      ["nic-1", "nic-2", "pe-sql", "vm-1", "vm-2"].sort(),
    );
    expect(result.ringHidden).toBe(0);
  });

  test("an interface sits beside the machine it is attached to", () => {
    const at: (id: string) => number = (id: string): number => {
      return result.ring.indexOf(id);
    };

    expect(Math.abs(at("nic-1") - at("vm-1"))).toBe(1);
    expect(Math.abs(at("nic-2") - at("vm-2"))).toBe(1);
  });

  test("what those are connected to stands further out: the load balancer both interfaces get traffic from first", () => {
    expect(result.outerRing).toEqual(["lb", "db"]);
    // Two steps out is never drawn: the load balancer's public IP.
    expect(result.outerRing).not.toContain("pip");
    expect(result.outerRingHidden).toBe(0);
  });

  test("lines join the middle to the ring, the ring's own pairs, and the ring to what is further out - each with its words", () => {
    expect(pairs(result)).toEqual(
      [
        "nic-1>vnet:Runs in",
        "nic-2>vnet:Runs in",
        "vm-1>vnet:Runs in",
        "vm-2>vnet:Runs in",
        "pe-sql>vnet:Runs in",
        "nic-1>vm-1:Attached to",
        "nic-2>vm-2:Attached to",
        "lb>nic-1:Sends traffic to",
        "lb>nic-2:Sends traffic to",
        "pe-sql>db:Sends traffic to",
      ].sort(),
    );
    expect(
      result.edges
        .filter((edge: TopologyConnectionsEdge): boolean => {
          return edge.touchesCenter;
        })
        .map((edge: TopologyConnectionsEdge): string => {
          return edge.from === "vnet" ? edge.to : edge.from;
        })
        .sort(),
    ).toEqual([...result.ring].sort());
  });

  test("a part with nothing connected to it stands alone", () => {
    const alone: TopologyConnectionsView = view(graph, {
      selectedId: "storage",
    });

    expect(alone.centerId).toBe("storage");
    expect(alone.ring).toEqual([]);
    expect(alone.outerRing).toEqual([]);
    expect(alone.edges).toEqual([]);
  });

  test("what needs attention comes first on the ring", () => {
    const troubled: TopologyConnectionsView = view(
      account({ "vm-2": "critical", "pe-sql": "warning" }),
      { selectedId: "vnet" },
    );

    expect(troubled.ring[0]).toBe("vm-2");
    // Kept in that order, then each beside what it is attached to.
    expect(troubled.ring.indexOf("nic-2")).toBe(1);
  });
});

describe("two connections between the same two parts", () => {
  test("are one line that carries both, however each reads", () => {
    const graph: ResourceTopologyGraph = account({}, [
      connection("nic-1", "vm-1", ATTACHED_TO),
      connection("vm-1", "nic-1", SENDS_TO),
    ]);
    const result: TopologyConnectionsView = view(graph, {
      selectedId: "vm-1",
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.id).toBe("nic-1|vm-1");
    expect(
      result.edges[0]!.relations.map(
        (relation: ResourceTopologyRelation): string => {
          return relation.label;
        },
      ),
    ).toEqual(["Attached to", "Sends traffic to"]);
  });
});

describe("the resource's own view", () => {
  const graph: ResourceTopologyGraph = account();
  const result: TopologyConnectionsView = view(graph);

  test("stands the resource in the middle, its most connected parts around it", () => {
    expect(result.centerKind).toBe("overview");
    expect(result.centerId).toBe("account");
    // The network has five connections, the interfaces and the balancer three.
    expect(result.ring[0]).toBe("vnet");
    expect(result.ring).not.toContain("storage");
    expect(result.ring.length).toBeLessThanOrEqual(
      TOPOLOGY_CONNECTIONS_LIMITS.hubs,
    );
  });

  test("joins the resource to each with a plain line: it only gathers them", () => {
    const fromCenter: Array<TopologyConnectionsEdge> = result.edges.filter(
      (edge: TopologyConnectionsEdge): boolean => {
        return edge.touchesCenter;
      },
    );

    expect(fromCenter).toHaveLength(result.ring.length);

    for (const edge of fromCenter) {
      expect(edge.from).toBe("account");
      expect(edge.relations).toEqual([]);
    }
  });

  test("draws no line across its ring: what one hub is connected to is a click away", () => {
    const ringSet: Set<string> = new Set<string>(result.ring);

    for (const edge of result.edges) {
      expect(ringSet.has(edge.from) && ringSet.has(edge.to)).toBe(false);
    }
  });

  test("a resource whose parts are connected to nothing has nothing around it", () => {
    const quiet: TopologyConnectionsView = view(account({}, []));

    expect(quiet.centerKind).toBe("overview");
    expect(quiet.ring).toEqual([]);
    expect(quiet.edges).toEqual([]);
  });

  test("the most connected come first, and the limit says how many it left out", () => {
    const limited: TopologyConnectionsView = view(graph, {
      limits: { ring: 3, outerRing: 2, hubs: 2 },
    });

    expect(limited.ring).toHaveLength(2);
    expect(limited.ring).toContain("vnet");
    expect(limited.outerRing).toHaveLength(2);
    /*
     * Nine parts are connected to something: each is drawn, or counted as
     * not drawn exactly once - a hub the ring left out may be drawn further
     * out, and is then not counted.
     */
    expect(
      limited.ring.length +
        limited.outerRing.length +
        limited.ringHidden +
        limited.outerRingHidden,
    ).toBe(9);
    expect(limited.ringHidden + limited.outerRingHidden).toBeGreaterThan(0);
  });
});

describe("a search in the middle", () => {
  const graph: ResourceTopologyGraph = account();

  test("gathers the parts it found, and what they are connected to further out", () => {
    const result: TopologyConnectionsView = view(graph, { search: "nic" });

    expect(result.centerKind).toBe("search");
    expect(result.centerId).toBe(TOPOLOGY_CONNECTIONS_CENTER_ID);
    expect([...result.ring].sort()).toEqual(["nic-1", "nic-2"]);
    expect([...result.outerRing].sort()).toEqual([
      "lb",
      "vm-1",
      "vm-2",
      "vnet",
    ]);
    expect(
      result.edges.filter((edge: TopologyConnectionsEdge): boolean => {
        return edge.from === TOPOLOGY_CONNECTIONS_CENTER_ID;
      }),
    ).toHaveLength(2);
  });

  test("finds a part connected to nothing, too", () => {
    expect(view(graph, { search: "storage" }).ring).toEqual(["storage"]);
  });

  test("finds nothing for words no part has, and never the resource itself", () => {
    expect(view(graph, { search: "nothing-like-this" }).ring).toEqual([]);
    expect(view(graph, { search: "Production" }).ring).toEqual([]);
  });
});

describe("Needs attention in the middle", () => {
  test("gathers what needs attention, critical first, and what a problem may reach", () => {
    const result: TopologyConnectionsView = view(
      account({ db: "critical", "nic-2": "warning" }),
      { attentionOnly: true },
    );

    expect(result.centerKind).toBe("attention");
    expect(result.ring).toEqual(["db", "nic-2"]);
    expect([...result.outerRing].sort()).toEqual(
      ["lb", "pe-sql", "vm-2", "vnet"].sort(),
    );
  });

  test("is empty when nothing needs attention", () => {
    const result: TopologyConnectionsView = view(account(), {
      attentionOnly: true,
    });

    expect(result.centerKind).toBe("attention");
    expect(result.ring).toEqual([]);
  });
});

describe("what stands in the middle when several are asked for", () => {
  const graph: ResourceTopologyGraph = account({ db: "critical" });

  test("a picked part, before a search, before Needs attention", () => {
    expect(
      view(graph, { selectedId: "lb", search: "nic", attentionOnly: true })
        .centerKind,
    ).toBe("part");
    expect(view(graph, { search: "nic", attentionOnly: true }).centerKind).toBe(
      "search",
    );
  });

  test("the resource picked, a part no longer there, or a section is the resource's own view", () => {
    expect(view(graph, { selectedId: "account" }).centerKind).toBe("overview");
    expect(view(graph, { selectedId: "gone" }).centerKind).toBe("overview");

    const withSection: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "account",
      nodes: [
        part("account"),
        part("group", { isSection: true, name: "Hardware" }),
        part("a", { parentId: "group" }),
      ],
      connections: [],
    });

    expect(view(withSection, { selectedId: "group" }).centerKind).toBe(
      "overview",
    );
  });
});

describe("the ring's limit", () => {
  // A network with thirty interfaces, each attached to a machine of its own.
  const connections: Array<ResourceTopologyRelation> = [];
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("account"),
    part("vnet"),
  ];

  for (let index: number = 0; index < 30; index++) {
    nodes.push(part(`nic-${String(index).padStart(2, "0")}`));
    nodes.push(part(`vm-${String(index).padStart(2, "0")}`));
    connections.push(
      connection(`nic-${String(index).padStart(2, "0")}`, "vnet", RUNS_IN),
    );
    connections.push(
      connection(
        `nic-${String(index).padStart(2, "0")}`,
        `vm-${String(index).padStart(2, "0")}`,
        ATTACHED_TO,
      ),
    );
  }

  // Two interfaces of one machine: the second is left off the ring.
  connections.push(connection("nic-29", "vm-00", ATTACHED_TO));

  const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
    rootId: "account",
    nodes,
    connections,
  });

  test("draws as many as it allows around the middle and says how many it left out", () => {
    const result: TopologyConnectionsView = view(graph, {
      selectedId: "vnet",
    });

    expect(result.ring).toHaveLength(TOPOLOGY_CONNECTIONS_LIMITS.ring);
    expect(result.ringHidden).toBe(30 - TOPOLOGY_CONNECTIONS_LIMITS.ring);
  });

  test("a part connected to the middle that the limit left out is never drawn further out", () => {
    const result: TopologyConnectionsView = view(graph, {
      selectedId: "vnet",
    });

    for (const id of result.outerRing) {
      expect(id.startsWith("nic-")).toBe(false);
    }

    expect(result.outerRing).toContain("vm-00");
  });

  test("the same view whatever order the connections arrived in", () => {
    const shuffled: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "account",
      nodes: [...nodes].reverse(),
      connections: [...connections].reverse(),
    });
    const a: TopologyConnectionsView = view(graph, { selectedId: "vnet" });
    const b: TopologyConnectionsView = view(shuffled, { selectedId: "vnet" });

    expect(b.ring).toEqual(a.ring);
    expect(b.outerRing).toEqual(a.outerRing);
  });
});

describe("lines across the ring around a picked part", () => {
  /*
   * A hub with six spokes, each connected to the next one round, and the
   * first also to the fourth: across the ring, through the middle.
   */
  const spokes: Array<string> = ["s-1", "s-2", "s-3", "s-4", "s-5", "s-6"];
  const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
    rootId: "account",
    nodes: [
      part("account"),
      part("hub"),
      ...spokes.map((id: string): ResourceTopologyNodeInput => {
        return part(id);
      }),
    ],
    connections: [
      ...spokes.map((id: string): ResourceTopologyRelation => {
        return connection(id, "hub", RUNS_IN);
      }),
      connection("s-1", "s-2", ATTACHED_TO),
      connection("s-2", "s-3", ATTACHED_TO),
      connection("s-3", "s-4", ATTACHED_TO),
      connection("s-4", "s-5", ATTACHED_TO),
      connection("s-5", "s-6", ATTACHED_TO),
      connection("s-1", "s-4", SENDS_TO),
    ],
  });
  const result: TopologyConnectionsView = view(graph, { selectedId: "hub" });
  const ringSet: Set<string> = new Set<string>(result.ring);
  const chords: Array<TopologyConnectionsEdge> = result.edges.filter(
    (edge: TopologyConnectionsEdge): boolean => {
      return ringSet.has(edge.from) && ringSet.has(edge.to);
    },
  );

  test("join neighbours on the ring", () => {
    expect(chords.length).toBeGreaterThan(0);

    for (const chord of chords) {
      const apart: number = Math.abs(
        result.ring.indexOf(chord.from) - result.ring.indexOf(chord.to),
      );

      expect(Math.min(apart, result.ring.length - apart)).toBeLessThanOrEqual(
        TOPOLOGY_CONNECTIONS_CHORD_REACH,
      );
    }
  });

  test("never cross the middle: a connection is drawn exactly when its parts sit near each other", () => {
    const drawn: Set<string> = new Set<string>(
      chords.map((chord: TopologyConnectionsEdge): string => {
        return chord.id;
      }),
    );
    let far: number = 0;

    for (const connection of graph.connections || []) {
      if (!ringSet.has(connection.from) || !ringSet.has(connection.to)) {
        continue;
      }

      const apart: number = Math.abs(
        result.ring.indexOf(connection.from) -
          result.ring.indexOf(connection.to),
      );
      const near: boolean =
        Math.min(apart, result.ring.length - apart) <=
        TOPOLOGY_CONNECTIONS_CHORD_REACH;
      const id: string =
        connection.from < connection.to
          ? `${connection.from}|${connection.to}`
          : `${connection.to}|${connection.from}`;

      expect(drawn.has(id)).toBe(near);

      if (!near) {
        far++;
      }
    }

    // Six spokes, each joined to the next round: one is always far from another.
    expect(far).toBeGreaterThan(0);
  });
});

describe("the ring's order", () => {
  test("keeps the order it is given, except that a connected part comes next", () => {
    const linked: Set<string> = new Set<string>(["a|d", "d|a", "b|e", "e|b"]);
    const isConnected: (x: string, y: string) => boolean = (
      x: string,
      y: string,
    ): boolean => {
      return linked.has(`${x}|${y}`);
    };

    expect(orderTopologyRing(["a", "b", "c", "d", "e"], isConnected)).toEqual([
      "a",
      "d",
      "b",
      "e",
      "c",
    ]);
    expect(orderTopologyRing([], isConnected)).toEqual([]);
  });
});
