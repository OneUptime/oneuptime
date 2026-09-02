import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEVICE_ROLE_LABELS,
  DEVICE_ROLES_IN_LEGEND_ORDER,
} from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import { tierForNode } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import {
  DEVICE_NODE_BASE_RADIUS,
  TopologyNodeShape,
  TopologyShapeGeometry,
  geometryForShape,
  isUnclassifiedNode,
  roleDisplayLabelForNode,
  roleKeyOfNode,
  roleLabelForNode,
  roleOfNode,
  shapeForNode,
  shapeGeometryForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyNodeShape";
import {
  TOPOLOGY_LEGEND,
  TopologyLegendEntry,
  accessibleLabelForNode,
  buildTopologyLegend,
  nodeMatchesSearch,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";

/*
 * Device roles are per-project ROWS now (Network > Settings > Device Roles),
 * not a compiled-in union. The client is never handed the table: the topology
 * builder stamps the project's answers onto each node — roleKey, roleLabel,
 * roleShape, isCoreLayerRole — and every reader downstream keeps its old pure
 * signature and simply prefers the stamp when it is there.
 *
 * That design only holds if two things are true, and this file pins both:
 *
 *   1. a stamped node is drawn, tiered, listed and announced by what the
 *      OPERATOR configured, including for a role that did not exist when the
 *      client was compiled ("PoS Terminal", "SD-WAN Edge"), and
 *   2. an UNSTAMPED node — an older payload, or a project whose roles were
 *      never seeded — behaves exactly as it did before this feature landed.
 *
 * Sibling coverage of the unstamped behaviour on its own lives in
 * TopologyNodeShape.test.ts, RoleAwareTiering.test.ts and
 * NetworkTopologyMeta.test.ts; this file is about what the stamp changes and,
 * just as importantly, what it must not.
 */

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

/*
 * The silhouette every built-in role has been drawn with since roles existed.
 * This table is the "nothing changed" contract: a payload with no roleShape
 * must still produce exactly these.
 */
const BUILT_IN_SHAPES: Array<[NetworkTopologyDeviceRole, TopologyNodeShape]> = [
  ["router", "circle"],
  ["switch", "rounded-square"],
  ["firewall", "diamond"],
  ["wirelessAccessPoint", "triangle"],
  ["loadBalancer", "hexagon"],
  ["server", "tower"],
  ["storage", "cylinder"],
  ["printer", "rect"],
  ["camera", "rect"],
  ["phone", "rect"],
  ["host", "rect"],
];

/*
 * A role the shipped client has never heard of, stamped exactly the way
 * NetworkDeviceRoleCatalog.stampForRoleKey stamps one: a derived key, the
 * operator's name, and a silhouette chosen from the eight the renderer can
 * draw. Nothing in the built-in vocabulary can describe this node — which is
 * the whole reason the stamp exists.
 */
const POS_TERMINAL: Partial<NetworkTopologyNode> = {
  roleKey: "posTerminal",
  roleLabel: "PoS Terminal",
  roleShape: "hexagon",
};

/* A BUILT-IN role the project renamed. The key is unchanged — that is what a
 * key is for — so it must keep its slot in the legend under its new name. */
const RENAMED_ROUTER: Partial<NetworkTopologyNode> = {
  role: "router",
  roleKey: "router",
  roleLabel: "Edge Router",
  roleShape: "diamond",
};

const NO_FDB_EDGES: Set<string> = new Set<string>();

describe("shapeForNode — the project's configured silhouette wins", () => {
  test("a configured shape beats the built-in shape for the node's role", () => {
    /*
     * The headline case. A project that draws its switches as diamonds has
     * said so in a row; the compiled-in "switch is a rounded square" is a
     * default, not a rule.
     */
    const node: NetworkTopologyNode = makeDevice("sw-1", {
      role: "switch",
      roleShape: "diamond",
    });
    expect(shapeForNode(node)).toBe("diamond");
  });

  test("a configured shape beats the built-in shape for EVERY built-in role", () => {
    for (const [role, builtInShape] of BUILT_IN_SHAPES) {
      // Always a silhouette the role is not already drawn with, so a passing
      // assertion cannot be an accident of the two agreeing.
      const configured: TopologyNodeShape =
        builtInShape === "diamond" ? "hexagon" : "diamond";
      const node: NetworkTopologyNode = makeDevice(`dev-${role}`, {
        role: role,
        roleShape: configured,
      });
      expect(shapeForNode(node)).toBe(configured);
      expect(shapeForNode(node)).not.toBe(builtInShape);
    }
  });

  test('a configured shape gives a node whose role is "unknown" a silhouette', () => {
    /*
     * THE case a custom role produces: the classifier has no word for
     * "PoS Terminal", so `role` stays unknown and the stamp is the only thing
     * that knows this node is not a neutral circle.
     */
    const node: NetworkTopologyNode = makeDevice("kiosk-1", {
      role: "unknown",
      ...POS_TERMINAL,
    });
    expect(shapeForNode(node)).toBe("hexagon");
  });

  test("a configured shape works with no role field at all", () => {
    // The same node from a payload that never carried a classified role.
    const node: NetworkTopologyNode = makeDevice("kiosk-2", POS_TERMINAL);
    expect(node.role).toBeUndefined();
    expect(shapeForNode(node)).toBe("hexagon");
  });

  test("a configured shape overrides the endpoint rect too", () => {
    /*
     * Endpoints have always been rects. A project that configured a shape for
     * the role an endpoint carries meant that shape, whatever kind of node it
     * landed on.
     */
    const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
      role: "unknown",
      roleShape: "triangle",
    });
    expect(shapeForNode(endpoint)).toBe("triangle");
    const unstamped: NetworkTopologyNode = makeEndpoint("endpoint:pos-2");
    expect(shapeForNode(unstamped)).toBe("rect");
  });

  test("the layout reserves room for the CONFIGURED shape, not the built-in one", () => {
    /*
     * Shape and geometry come from this one module precisely so a node can
     * never be drawn at a size the layout did not reserve. A configured shape
     * that reached the renderer but not the footprint would overlap its
     * neighbours.
     */
    const node: NetworkTopologyNode = makeDevice("sw-1", {
      role: "switch",
      roleShape: "cylinder",
    });
    const geometry: TopologyShapeGeometry = shapeGeometryForNode(node);
    expect(geometry).toEqual(
      geometryForShape("cylinder", DEVICE_NODE_BASE_RADIUS),
    );
  });
});

describe("shapeForNode — a payload with no configured shape is unchanged", () => {
  test("every built-in role still maps to its historical silhouette", () => {
    for (const [role, shape] of BUILT_IN_SHAPES) {
      expect(shapeForNode(makeDevice(`dev-${role}`, { role: role }))).toBe(
        shape,
      );
    }
  });

  test("an unclassified device is still a circle and an unclassified endpoint still a rect", () => {
    expect(shapeForNode(makeDevice("d1"))).toBe("circle");
    expect(shapeForNode(makeDevice("d1", { role: "unknown" }))).toBe("circle");
    expect(shapeForNode(makeEndpoint("endpoint:e1"))).toBe("rect");
    expect(shapeForNode(makeEndpoint("endpoint:e1", { role: "unknown" }))).toBe(
      "rect",
    );
  });

  test("an unmanaged peer with no stamp is still a circle", () => {
    expect(shapeForNode(makeUnmanaged("unmanaged:peer"))).toBe("circle");
  });

  test("a stamp that carries a label but no shape leaves the silhouette alone", () => {
    /*
     * Every field of the stamp is independently optional — a row whose
     * topologyShape is blank, or holds a value this client cannot draw, is
     * dropped by the catalogue rather than passed through. Renaming a role
     * must not silently redraw it.
     */
    const node: NetworkTopologyNode = makeDevice("fw-1", {
      role: "firewall",
      roleKey: "firewall",
      roleLabel: "Perimeter Firewall",
    });
    expect(shapeForNode(node)).toBe("diamond");
  });
});

describe("roleKeyOfNode", () => {
  test("the configured key wins", () => {
    expect(roleKeyOfNode(makeDevice("d1", POS_TERMINAL))).toBe("posTerminal");
  });

  test("the configured key wins even when the classifier guessed something else", () => {
    /*
     * The operator assigned a role; the classifier's guess underneath it is
     * an inference about the same box and must not group it elsewhere.
     */
    const node: NetworkTopologyNode = makeDevice("d1", {
      role: "server",
      roleKey: "posTerminal",
      roleLabel: "PoS Terminal",
    });
    expect(roleKeyOfNode(node)).toBe("posTerminal");
  });

  test("with no configured key it is exactly the built-in role", () => {
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      expect(roleKeyOfNode(makeDevice(`dev-${role}`, { role: role }))).toBe(
        role,
      );
    }
  });

  test("with neither, it is whatever roleOfNode says — unknown for a device, host for an endpoint", () => {
    const device: NetworkTopologyNode = makeDevice("d1");
    const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:e1");
    expect(roleKeyOfNode(device)).toBe(roleOfNode(device));
    expect(roleKeyOfNode(device)).toBe("unknown");
    expect(roleKeyOfNode(endpoint)).toBe(roleOfNode(endpoint));
    expect(roleKeyOfNode(endpoint)).toBe("host");
  });

  test("an empty key is not a key — it falls back rather than grouping under nothing", () => {
    // The legend groups by this string; "" would be a group with no identity.
    const node: NetworkTopologyNode = makeDevice("d1", {
      role: "switch",
      roleKey: "",
    });
    expect(roleKeyOfNode(node)).toBe("switch");
  });
});

describe("roleDisplayLabelForNode", () => {
  test("the configured name wins", () => {
    expect(roleDisplayLabelForNode(makeDevice("d1", RENAMED_ROUTER))).toBe(
      "Edge Router",
    );
    expect(roleDisplayLabelForNode(makeDevice("d2", POS_TERMINAL))).toBe(
      "PoS Terminal",
    );
  });

  test("with no configured name, every built-in role keeps its shipped label", () => {
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      expect(
        roleDisplayLabelForNode(makeDevice(`dev-${role}`, { role: role })),
      ).toBe(DEVICE_ROLE_LABELS[role]);
    }
  });

  test("an unclassified device says so, and an unclassified endpoint is a host", () => {
    expect(roleDisplayLabelForNode(makeDevice("d1"))).toBe("Unknown type");
    expect(roleDisplayLabelForNode(makeEndpoint("endpoint:e1"))).toBe("Host");
  });
});

describe("isUnclassifiedNode", () => {
  test("a configured key means classified, even when the classifier declined", () => {
    /*
     * The load-bearing case for custom roles. `role` is "unknown" because no
     * compiled-in word fits, but the operator DID classify this box — treating
     * it as unclassified would drop it from the legend and from search.
     */
    expect(
      isUnclassifiedNode(
        makeDevice("d1", { role: "unknown", ...POS_TERMINAL }),
      ),
    ).toBe(false);
    expect(isUnclassifiedNode(makeDevice("d2", POS_TERMINAL))).toBe(false);
  });

  test("a configured key means classified for every built-in role too", () => {
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      expect(
        isUnclassifiedNode(
          makeDevice(`dev-${role}`, { role: role, roleKey: role }),
        ),
      ).toBe(false);
    }
  });

  test("only a node with no key and no classification is unclassified", () => {
    expect(isUnclassifiedNode(makeDevice("d1"))).toBe(true);
    expect(isUnclassifiedNode(makeDevice("d1", { role: "unknown" }))).toBe(
      true,
    );
    expect(isUnclassifiedNode(makeUnmanaged("unmanaged:peer"))).toBe(true);
  });

  test("a built-in role with no stamp is classified", () => {
    expect(isUnclassifiedNode(makeDevice("d1", { role: "switch" }))).toBe(
      false,
    );
    // An endpoint's role falls back to "host", which is an answer.
    expect(isUnclassifiedNode(makeEndpoint("endpoint:e1"))).toBe(false);
  });
});

describe("roleLabelForNode is the display label, for every kind of node", () => {
  test("the two agree on stamped, built-in and unclassified nodes alike", () => {
    /*
     * roleLabelForNode is the name the rest of the app already imports; it has
     * to be the same string the legend and the screen reader use, or the map
     * would call one node two things.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("d1"),
      makeDevice("d2", { role: "unknown" }),
      makeDevice("d3", { role: "switch" }),
      makeDevice("d4", RENAMED_ROUTER),
      makeDevice("d5", POS_TERMINAL),
      makeUnmanaged("unmanaged:peer"),
      makeUnmanaged("unmanaged:peer-2", { role: "router" }),
      makeEndpoint("endpoint:e1"),
      makeEndpoint("endpoint:e2", {
        role: "printer",
        roleLabel: "Label Print",
      }),
    ];
    for (const node of nodes) {
      expect(roleLabelForNode(node)).toBe(roleDisplayLabelForNode(node));
    }
  });
});

describe("tierForNode — the configured core flag settles the tier", () => {
  test("a core-flagged switch is tier 0 — a project may decide its switches ARE core", () => {
    /*
     * "switch" is deliberately absent from CORE_DEVICE_ROLES because a switch
     * usually hangs off a router. In a collapsed-core estate it does not, and
     * the row saying so is a statement about this project's network that beats
     * the shipped default.
     */
    const node: NetworkTopologyNode = makeDevice("sw-core", {
      role: "switch",
      roleKey: "switch",
      isCoreLayerRole: true,
    });
    expect(tierForNode(node, NO_FDB_EDGES)).toBe(0);
  });

  test("a router flagged NOT core is tier 1", () => {
    // The same rule in reverse: a branch router under a hub is not the core.
    const node: NetworkTopologyNode = makeDevice("rtr-branch", {
      role: "router",
      roleKey: "router",
      isCoreLayerRole: false,
    });
    expect(tierForNode(node, NO_FDB_EDGES)).toBe(1);
  });

  test("the flag settles the tier for a role the client has never heard of", () => {
    /*
     * The reason the flag exists at all. "SD-WAN Edge" is not in
     * CORE_DEVICE_ROLES and never could be, so without the flag a custom core
     * device would be tiered by a coin-flip heuristic.
     */
    const edge: NetworkTopologyNode = makeDevice("sdwan-1", {
      roleKey: "sdWanEdge",
      roleLabel: "SD-WAN Edge",
      isCoreLayerRole: true,
    });
    expect(tierForNode(edge, NO_FDB_EDGES)).toBe(0);

    const terminal: NetworkTopologyNode = makeDevice("kiosk-1", {
      ...POS_TERMINAL,
      isCoreLayerRole: false,
    });
    expect(tierForNode(terminal, NO_FDB_EDGES)).toBe(1);
  });

  test('the flag beats the FDB heuristic in BOTH directions for a role of "unknown"', () => {
    /*
     * The heuristic only runs when nothing has committed to an answer. A
     * configured role IS a commitment, so both of the heuristic's outcomes are
     * overridden — including the one it would have produced anyway, which is
     * what makes the tier stop depending on whether anybody walked the box.
     */
    const coreWithFdb: NetworkTopologyNode = makeDevice("core-1", {
      role: "unknown",
      roleKey: "sdWanEdge",
      isCoreLayerRole: true,
    });
    // The heuristic says tier 1 (something learned a MAC through it).
    expect(tierForNode(coreWithFdb, new Set<string>(["core-1"]))).toBe(0);

    const leafWithoutFdb: NetworkTopologyNode = makeDevice("kiosk-1", {
      role: "unknown",
      roleKey: "posTerminal",
      isCoreLayerRole: false,
    });
    // The heuristic says tier 0 (nothing learned a MAC through it).
    expect(tierForNode(leafWithoutFdb, NO_FDB_EDGES)).toBe(1);
  });

  test("the flag beats a disagreeing built-in role in both directions", () => {
    // isCoreLayerRole is checked before node.role, for the same reason
    // node.role is checked before the FDB: it is the operator's own answer.
    expect(
      tierForNode(
        makeDevice("d1", { role: "printer", isCoreLayerRole: true }),
        NO_FDB_EDGES,
      ),
    ).toBe(0);
    expect(
      tierForNode(
        makeDevice("d2", { role: "firewall", isCoreLayerRole: false }),
        NO_FDB_EDGES,
      ),
    ).toBe(1);
  });

  test("an endpoint stays tier 2 whatever the flag says", () => {
    /*
     * Tier 2 is what the layout packs into per-switch group boxes. A flag that
     * could lift an endpoint out of it would tear a hole in the box drawn
     * around it, so the kind check stays first.
     */
    for (const flag of [true, false]) {
      const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:pos-1", {
        role: "unknown",
        roleKey: "posTerminal",
        isCoreLayerRole: flag,
      });
      expect(tierForNode(endpoint, NO_FDB_EDGES)).toBe(2);
      expect(tierForNode(endpoint, new Set<string>(["endpoint:pos-1"]))).toBe(
        2,
      );
    }
  });

  test("an unmanaged peer stays tier 1 whatever the flag says", () => {
    /*
     * An unmanaged node exists only because a neighbour advertised it. The
     * stamp on it describes the role we matched, not evidence of our own, so
     * it must not promote somebody else's box into our core tier.
     */
    for (const flag of [true, false]) {
      const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:peer", {
        roleKey: "sdWanEdge",
        isCoreLayerRole: flag,
      });
      expect(tierForNode(peer, NO_FDB_EDGES)).toBe(1);
      expect(tierForNode(peer, new Set<string>(["unmanaged:peer"]))).toBe(1);
    }
  });

  test("tiering neither mutates the node nor consults anything but the flag", () => {
    const node: NetworkTopologyNode = makeDevice("sw-core", {
      role: "switch",
      roleKey: "switch",
      isCoreLayerRole: true,
    });
    const fdbIds: Set<string> = new Set<string>(["sw-core"]);
    expect(tierForNode(node, fdbIds)).toBe(tierForNode(node, fdbIds));
    expect(node.isCoreLayerRole).toBe(true);
    expect(node.role).toBe("switch");
    expect(Array.from(fdbIds)).toEqual(["sw-core"]);
  });
});

describe("tierForNode — with no configured flag, nothing changed", () => {
  test("the old precedence still holds: endpoint > unmanaged > role > FDB", () => {
    // Spot-check of the matrix RoleAwareTiering.test.ts pins in full.
    expect(
      tierForNode(
        makeEndpoint("endpoint:e1", { role: "router" }),
        NO_FDB_EDGES,
      ),
    ).toBe(2);
    expect(
      tierForNode(
        makeUnmanaged("unmanaged:p", { role: "router" }),
        NO_FDB_EDGES,
      ),
    ).toBe(1);
    expect(
      tierForNode(makeDevice("d1", { role: "router" }), NO_FDB_EDGES),
    ).toBe(0);
    expect(
      tierForNode(makeDevice("d2", { role: "switch" }), NO_FDB_EDGES),
    ).toBe(1);
    expect(
      tierForNode(
        makeDevice("d3", { role: "unknown" }),
        new Set<string>(["d3"]),
      ),
    ).toBe(1);
    expect(tierForNode(makeDevice("d4"), NO_FDB_EDGES)).toBe(0);
  });

  test("a stamp without the flag leaves the role and the heuristic in charge", () => {
    /*
     * Renaming a role must not move anything. The flag is a separate column
     * and only an explicit value for it may change a tier.
     */
    const renamed: NetworkTopologyNode = makeDevice("rtr-1", RENAMED_ROUTER);
    expect(renamed.isCoreLayerRole).toBeUndefined();
    expect(tierForNode(renamed, NO_FDB_EDGES)).toBe(0);

    const custom: NetworkTopologyNode = makeDevice("kiosk-1", POS_TERMINAL);
    // No flag and no built-in role: back to the FDB heuristic, unchanged.
    expect(tierForNode(custom, new Set<string>(["kiosk-1"]))).toBe(1);
    expect(tierForNode(custom, NO_FDB_EDGES)).toBe(0);
  });
});

describe("buildTopologyLegend — configured labels, custom roles and stable order", () => {
  const typeLabelsOf: (entries: Array<TopologyLegendEntry>) => Array<string> = (
    entries: Array<TopologyLegendEntry>,
  ): Array<string> => {
    return entries
      .filter((entry: TopologyLegendEntry) => {
        return entry.group === "Type";
      })
      .map((entry: TopologyLegendEntry) => {
        return entry.label;
      });
  };

  const typeEntriesOf: (
    entries: Array<TopologyLegendEntry>,
  ) => Array<TopologyLegendEntry> = (
    entries: Array<TopologyLegendEntry>,
  ): Array<TopologyLegendEntry> => {
    return entries.filter((entry: TopologyLegendEntry) => {
      return entry.group === "Type";
    });
  };

  test("built-in roles still come out in the fixed legend order", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("d1", { role: "storage", roleKey: "storage" }),
      makeDevice("d2", { role: "router", roleKey: "router" }),
      makeDevice("d3", { role: "firewall", roleKey: "firewall" }),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["Router", "Firewall", "Storage"]);
    // ...and the non-Type half of the key is untouched.
    expect(legend.slice(0, TOPOLOGY_LEGEND.length)).toEqual(TOPOLOGY_LEGEND);
  });

  test("a custom role gets its own entry, with its configured label and shape", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("kiosk-1", { role: "unknown", ...POS_TERMINAL }),
      makeDevice("sw-1", { role: "switch", roleKey: "switch" }),
    ]);
    /*
     * Custom roles trail the built-in ones: the familiar half of the key stays
     * where a returning reader last saw it.
     */
    expect(typeLabelsOf(legend)).toEqual(["Switch", "PoS Terminal"]);
    const custom: TopologyLegendEntry = typeEntriesOf(legend)[1]!;
    expect(custom.shape).toBe("hexagon");
    expect(custom.swatch).toBe("shape");
  });

  test("a custom role is not folded into whatever the classifier guessed", () => {
    /*
     * The regression this grouping-by-key exists to prevent. Both nodes
     * classify as "server"; only one of them IS one, and merging them would
     * put the operator's own role behind a label they never chose.
     */
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("srv-1", { role: "server", roleKey: "server" }),
      makeDevice("kiosk-1", { role: "server", ...POS_TERMINAL }),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["Server", "PoS Terminal"]);
  });

  test("a renamed built-in role shows its new name but keeps its slot", () => {
    /*
     * Renaming is a display change, not a re-grouping: the key is still
     * "router", so the entry stays first, ahead of the switch.
     */
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("sw-1", { role: "switch", roleKey: "switch" }),
      makeDevice("rtr-1", RENAMED_ROUTER),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["Edge Router", "Switch"]);
    expect(typeEntriesOf(legend)[0]!.shape).toBe("diamond");
  });

  test("unclassified nodes still explain nothing", () => {
    /*
     * The circle an unclassified device falls back to is the same one a router
     * uses. A key entry for it would be a lie about what the reader is
     * looking at.
     */
    expect(buildTopologyLegend([makeDevice("d1")])).toEqual(TOPOLOGY_LEGEND);
    expect(
      buildTopologyLegend([makeDevice("d1", { role: "unknown" })]),
    ).toEqual(TOPOLOGY_LEGEND);
    const mixed: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("d1"),
      makeDevice("kiosk-1", { role: "unknown", ...POS_TERMINAL }),
    ]);
    expect(typeLabelsOf(mixed)).toEqual(["PoS Terminal"]);
  });

  test("reordering the nodes does not reorder the built-in entries", () => {
    /*
     * The legend is rebuilt on every poll, and a key that reshuffles itself
     * under the reader is worse than no key at all.
     */
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("d1", { role: "storage", roleKey: "storage" }),
      makeDevice("kiosk-1", { role: "unknown", ...POS_TERMINAL }),
      makeDevice("d2", RENAMED_ROUTER),
      makeDevice("d3", { role: "camera", roleKey: "camera" }),
    ];
    const forward: Array<TopologyLegendEntry> = buildTopologyLegend(nodes);
    const reversed: Array<TopologyLegendEntry> = buildTopologyLegend(
      [...nodes].reverse(),
    );
    expect(typeLabelsOf(forward)).toEqual([
      "Edge Router",
      "Storage",
      "Camera",
      "PoS Terminal",
    ]);
    expect(typeEntriesOf(reversed).slice(0, 3)).toEqual(
      typeEntriesOf(forward).slice(0, 3),
    );
  });

  test("two custom roles list in the order they appear on the map", () => {
    /*
     * Nothing orders custom roles but the payload, which is itself stable for
     * a given poll — so the rule is "encounter order", stated rather than left
     * to chance.
     */
    const kiosk: NetworkTopologyNode = makeDevice("kiosk-1", POS_TERMINAL);
    const sdwan: NetworkTopologyNode = makeDevice("sdwan-1", {
      roleKey: "sdWanEdge",
      roleLabel: "SD-WAN Edge",
      roleShape: "tower",
    });
    expect(typeLabelsOf(buildTopologyLegend([kiosk, sdwan]))).toEqual([
      "PoS Terminal",
      "SD-WAN Edge",
    ]);
    expect(typeLabelsOf(buildTopologyLegend([sdwan, kiosk]))).toEqual([
      "SD-WAN Edge",
      "PoS Terminal",
    ]);
  });

  test("many nodes of one custom role produce exactly one entry", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("kiosk-1", POS_TERMINAL),
      makeDevice("kiosk-2", POS_TERMINAL),
      makeDevice("kiosk-3", POS_TERMINAL),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["PoS Terminal"]);
  });

  test("the key groups by key, so a stale label on one node cannot split the group", () => {
    /*
     * Every node of one key is stamped from one row, so a disagreement means a
     * node built before the rename. It must still be one group — the first
     * node seen supplies the label.
     */
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("kiosk-1", POS_TERMINAL),
      makeDevice("kiosk-2", { roleKey: "posTerminal", roleLabel: "Till" }),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["PoS Terminal"]);
  });

  test("an unstamped graph produces byte-for-byte the legend it always did", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      makeDevice("d1", { role: "switch" }),
      makeDevice("d2", { role: "router" }),
      makeEndpoint("endpoint:e1"),
    ]);
    expect(typeLabelsOf(legend)).toEqual(["Router", "Switch", "Host"]);
    expect(typeEntriesOf(legend)[0]!.shape).toBe("circle");
    expect(typeEntriesOf(legend)[1]!.shape).toBe("rounded-square");
  });
});

describe("nodeMatchesSearch — the configured label is what is searched", () => {
  test("a custom role is findable by the name the operator gave it", () => {
    const kiosk: NetworkTopologyNode = makeDevice("kiosk-1", {
      role: "unknown",
      ...POS_TERMINAL,
    });
    expect(nodeMatchesSearch(kiosk, "PoS")).toBe(true);
    expect(nodeMatchesSearch(kiosk, "pos terminal")).toBe(true);
    expect(nodeMatchesSearch(kiosk, "TERMINAL")).toBe(true);
    // ...and does not light up devices that are not one.
    expect(
      nodeMatchesSearch(makeDevice("rtr-1", { role: "router" }), "PoS"),
    ).toBe(false);
  });

  test("a renamed role answers to its NEW name", () => {
    const renamed: NetworkTopologyNode = makeDevice("rtr-1", RENAMED_ROUTER);
    expect(nodeMatchesSearch(renamed, "edge")).toBe(true);
  });

  test("a renamed role stops answering to the name it no longer has", () => {
    /*
     * The point of searching the configured label rather than the built-in
     * one: an operator who renamed "Wireless AP" to "Ceiling Radio" is typing
     * the new word, and the old one is no longer on the map anywhere.
     */
    const radio: NetworkTopologyNode = makeDevice("ap-lobby", {
      role: "wirelessAccessPoint",
      roleKey: "wirelessAccessPoint",
      roleLabel: "Ceiling Radio",
    });
    expect(nodeMatchesSearch(radio, "radio")).toBe(true);
    expect(nodeMatchesSearch(radio, "wireless")).toBe(false);
  });

  test("an unclassified node still answers to nothing role-shaped", () => {
    /*
     * Matching "unknown type" would make a search for a role highlight
     * everything we FAILED to classify — the opposite of what was asked.
     */
    const node: NetworkTopologyNode = makeDevice("d1", { name: "core-1" });
    expect(nodeMatchesSearch(node, "unknown")).toBe(false);
    expect(nodeMatchesSearch(node, "unknown type")).toBe(false);
    // Its own identity still matches, as it always has.
    expect(nodeMatchesSearch(node, "core")).toBe(true);
  });

  test("built-in role search is untouched for an unstamped payload", () => {
    expect(
      nodeMatchesSearch(makeDevice("d1", { role: "firewall" }), "firewall"),
    ).toBe(true);
    expect(
      nodeMatchesSearch(makeDevice("d2", { role: "loadBalancer" }), "LOAD"),
    ).toBe(true);
  });

  test("empty search still matches everything, stamped or not", () => {
    expect(nodeMatchesSearch(makeDevice("kiosk-1", POS_TERMINAL), "  ")).toBe(
      true,
    );
  });
});

describe("accessibleLabelForNode — the configured label is what is announced", () => {
  test("a custom role is announced by name, because the shape cannot be heard", () => {
    /*
     * The silhouette is exactly the information a screen reader cannot see, so
     * a custom role that announced nothing would be the one node on the map
     * with no type at all.
     */
    const kiosk: NetworkTopologyNode = makeDevice("kiosk-1", {
      name: "kiosk-1",
      role: "unknown",
      ...POS_TERMINAL,
    });
    expect(accessibleLabelForNode(kiosk)).toBe(
      "kiosk-1, pos terminal, managed device, status up",
    );
  });

  test("a renamed role is announced by its new name", () => {
    const renamed: NetworkTopologyNode = makeDevice("rtr-1", {
      name: "core-1",
      ...RENAMED_ROUTER,
    });
    expect(accessibleLabelForNode(renamed)).toBe(
      "core-1, edge router, managed device, status up",
    );
  });

  test("a renamed endpoint role is announced too", () => {
    const printer: NetworkTopologyNode = makeEndpoint("endpoint:p1", {
      name: "prn-1",
      role: "printer",
      roleKey: "printer",
      roleLabel: "Label Printer",
    });
    expect(accessibleLabelForNode(printer)).toBe(
      "prn-1, label printer, endpoint",
    );
  });

  test("an unclassified node announces no type at all", () => {
    // "unknown type" tells a listener nothing they did not already know.
    expect(accessibleLabelForNode(makeDevice("d1", { name: "core-1" }))).toBe(
      "core-1, managed device, status up",
    );
  });

  test("an unstamped payload is announced exactly as before", () => {
    expect(
      accessibleLabelForNode(
        makeDevice("d1", {
          name: "fw-1",
          role: "firewall",
          vendor: "Fortinet",
        }),
      ),
    ).toBe("fw-1, firewall, managed device, status up, Fortinet");
  });
});
