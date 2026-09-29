import { describe, expect, test } from "@jest/globals";
import DEFAULT_NETWORK_DEVICE_ROLES, {
  DefaultNetworkDeviceRole,
} from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
  NetworkTopologyNodeShape,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TopologyDeviceRoleInput,
  TopologyNodeRoleStamp,
  applyRoleStamp,
  buildDeviceRoleIndex,
  normalizeRoleKey,
  roleKeyForNode,
  stampForRoleKey,
} from "../../../Utils/Monitor/NetworkDeviceRoleCatalog";

/*
 * This module is the ONLY place that turns a project's configured
 * NetworkDeviceRole rows into the four presentation answers stamped onto a
 * topology node. Everything downstream — the shape module, the three layouts,
 * the legend, the accessible label, the adopt-a-neighbour flow — reads those
 * stamped fields and never sees the table.
 *
 * So the contract these tests pin is mostly about ABSENCE. A field the stamp
 * does not carry must be missing from the node, not present-and-undefined,
 * because "absent means fall back to the built-in behaviour" is what keeps a
 * project with no roles configured (or a payload built before the feature
 * existed) drawing exactly the map it drew before. Several assertions
 * therefore check Object.keys / not.toHaveProperty rather than settling for
 * toBeUndefined, which cannot tell the two apart.
 */

// Every field a stamp can carry, so "the rest stayed absent" can be asserted.
const STAMP_FIELDS: ReadonlyArray<keyof TopologyNodeRoleStamp> = [
  "roleId",
  "roleKey",
  "roleLabel",
  "roleShape",
  "isCoreLayerRole",
  "isSnmpWalkableRole",
];

// The eight silhouettes the renderer has geometry for.
const ALL_SHAPES: ReadonlyArray<NetworkTopologyNodeShape> = [
  "circle",
  "rounded-square",
  "diamond",
  "triangle",
  "hexagon",
  "tower",
  "cylinder",
  "rect",
];

const makeRole: (
  key: string,
  overrides?: Partial<TopologyDeviceRoleInput>,
) => TopologyDeviceRoleInput = (
  key: string,
  overrides?: Partial<TopologyDeviceRoleInput>,
): TopologyDeviceRoleInput => {
  return {
    key,
    name: key,
    ...overrides,
  };
};

const makeNode: (
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode = (
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: "device-1",
    name: "core-sw-1",
    isManaged: true,
    status: "up",
    ...overrides,
  };
};

// The eleven seeded defaults, in the shape the topology builder passes them.
const seededRoles: Array<TopologyDeviceRoleInput> =
  DEFAULT_NETWORK_DEVICE_ROLES.map(
    (role: DefaultNetworkDeviceRole): TopologyDeviceRoleInput => {
      return {
        key: role.key,
        name: role.name,
        topologyShape: role.topologyShape,
        isCoreLayer: role.isCoreLayer,
        isSnmpWalkable: role.isSnmpWalkable,
      };
    },
  );

const snapshot: (value: unknown) => string = (value: unknown): string => {
  return JSON.stringify(value);
};

describe("normalizeRoleKey", () => {
  test('trims and lowercases, so a hand-edited or imported "Router " still finds the Router row', () => {
    expect(normalizeRoleKey(" Router ")).toBe("router");
    expect(normalizeRoleKey("ROUTER")).toBe("router");
    expect(normalizeRoleKey("\t\n router \n")).toBe("router");
    expect(normalizeRoleKey("router")).toBe("router");
  });

  /*
   * undefined rather than "" is the load-bearing part: every caller branches
   * on falsiness to mean "this node has no configured role", and an empty
   * string would be indexed and looked up as a real key.
   */
  test("a blank or missing key is no key at all, not an empty-string key", () => {
    expect(normalizeRoleKey("")).toBeUndefined();
    expect(normalizeRoleKey("   ")).toBeUndefined();
    expect(normalizeRoleKey("\t\n")).toBeUndefined();
    expect(normalizeRoleKey(null)).toBeUndefined();
    expect(normalizeRoleKey(undefined)).toBeUndefined();
  });

  test("is idempotent, so normalizing an already-normalized key is safe", () => {
    const once: string | undefined = normalizeRoleKey("  WirelessAccessPoint ");
    expect(once).toBe("wirelessaccesspoint");
    expect(normalizeRoleKey(once)).toBe(once);
  });

  /*
   * Matching a key is a lookup, not a derivation — deriveDeviceRoleKey is what
   * builds keys out of names. Collapsing "edge router" to "edgerouter" here
   * would silently match a row the operator never named.
   */
  test("only trims the ends — it never rewrites the middle of the key", () => {
    expect(normalizeRoleKey(" Edge Router ")).toBe("edge router");
    expect(normalizeRoleKey("pos-terminal")).toBe("pos-terminal");
  });
});

describe("buildDeviceRoleIndex", () => {
  test("indexes every row under its normalized key so lookup ignores case and padding", () => {
    const roles: Array<TopologyDeviceRoleInput> = [
      makeRole("wirelessAccessPoint"),
      makeRole(" Router "),
    ];

    const index: Map<string, TopologyDeviceRoleInput> =
      buildDeviceRoleIndex(roles);

    expect(index.size).toBe(2);
    expect(index.has("wirelessaccesspoint")).toBe(true);
    expect(index.has("router")).toBe(true);
  });

  /*
   * The index holds the row itself, not a projection of it, because
   * stampForRoleKey reads the configured label, shape and flags straight off
   * whatever is stored here.
   */
  test("stores the row object it was given rather than a copy of it", () => {
    const role: TopologyDeviceRoleInput = makeRole("router", {
      name: "Edge Router",
    });

    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      role,
    ]);

    expect(index.get("router")).toBe(role);
  });

  /*
   * A keyless row cannot be matched by anything — the classifier's answer and
   * a device's assignment are both keys — so indexing it under "" would only
   * create an entry that a blank lookup could accidentally hit.
   */
  test('skips a row whose key is empty or whitespace instead of indexing it under ""', () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole(""),
      makeRole("   "),
      makeRole("router"),
    ]);

    expect(index.size).toBe(1);
    expect(index.has("")).toBe(false);
    expect(index.has("router")).toBe(true);
  });

  /*
   * Deliberately first-wins. The key is unique per project in the database, so
   * a clash means the caller handed us rows from more than one project, and
   * quietly taking the LAST one would draw the other project's shapes on this
   * project's map.
   */
  test("the first row wins on a key clash and the later one is ignored", () => {
    const first: TopologyDeviceRoleInput = makeRole("router", {
      name: "This Project's Router",
      topologyShape: "circle",
    });
    const second: TopologyDeviceRoleInput = makeRole("router", {
      name: "Another Project's Router",
      topologyShape: "diamond",
    });

    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      first,
      second,
    ]);

    expect(index.size).toBe(1);
    expect(index.get("router")).toBe(first);
  });

  test("a clash that differs only in case or padding is still a clash", () => {
    const first: TopologyDeviceRoleInput = makeRole("Router", {
      name: "Kept",
    });
    const second: TopologyDeviceRoleInput = makeRole(" router ", {
      name: "Dropped",
    });

    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      first,
      second,
    ]);

    expect(index.size).toBe(1);
    expect(index.get("router")!.name).toBe("Kept");
  });

  /*
   * The normal case for a project that has not been backfilled yet: no rows,
   * no entries, and every later lookup falls back to built-in behaviour.
   */
  test("an empty role list gives an empty index", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex(
      [],
    );

    expect(index.size).toBe(0);
    expect(stampForRoleKey("router", index)).toEqual({});
  });

  test("does not mutate the array it was given or the rows in it", () => {
    const roles: Array<TopologyDeviceRoleInput> = [
      makeRole("router", { name: "Router", topologyShape: "circle" }),
      makeRole(""),
      makeRole("router", { name: "Duplicate" }),
    ];
    const before: string = snapshot(roles);

    buildDeviceRoleIndex(roles);

    expect(snapshot(roles)).toBe(before);
    expect(roles).toHaveLength(3);
  });

  test("indexes all eleven seeded defaults under their built-in keys", () => {
    const index: Map<string, TopologyDeviceRoleInput> =
      buildDeviceRoleIndex(seededRoles);

    expect(index.size).toBe(DEFAULT_NETWORK_DEVICE_ROLES.length);
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(index.has(role.key.toLowerCase())).toBe(true);
    }
  });
});

describe("stampForRoleKey — an empty stamp is the fallback", () => {
  const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
    makeRole("router", { name: "Router", topologyShape: "circle" }),
  ]);

  /*
   * The permanent case for a project that deleted a seeded role the
   * classifier can still produce: nothing is stamped, so the client draws the
   * built-in router exactly as it did before roles were configurable.
   */
  test("a key with no row stamps nothing at all", () => {
    const stamp: TopologyNodeRoleStamp = stampForRoleKey("posTerminal", index);

    expect(stamp).toEqual({});
    expect(Object.keys(stamp)).toHaveLength(0);
  });

  test("an absent or blank key stamps nothing", () => {
    expect(stampForRoleKey(undefined, index)).toEqual({});
    expect(stampForRoleKey("", index)).toEqual({});
    expect(stampForRoleKey("   ", index)).toEqual({});
    expect(Object.keys(stampForRoleKey(undefined, index))).toHaveLength(0);
  });

  /*
   * A project that has not been backfilled has rows for nothing, and every
   * node on its map must still be drawn.
   */
  test("an empty index stamps nothing even for a key that would otherwise match", () => {
    const empty: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex(
      [],
    );

    expect(stampForRoleKey("router", empty)).toEqual({});
  });

  test("an empty stamp carries none of the six fields, not undefined ones", () => {
    const stamp: TopologyNodeRoleStamp = stampForRoleKey("firewall", index);

    for (const field of STAMP_FIELDS) {
      expect(stamp).not.toHaveProperty(field);
    }
  });
});

describe("stampForRoleKey — a field is stamped only when the row carries it", () => {
  test("a fully configured row stamps all six fields", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", {
        id: "role-id-1",
        name: "Edge Router",
        topologyShape: "hexagon",
        isCoreLayer: true,
        isSnmpWalkable: true,
      }),
    ]);

    expect(stampForRoleKey("router", index)).toEqual({
      roleId: "role-id-1",
      roleKey: "router",
      roleLabel: "Edge Router",
      roleShape: "hexagon",
      isCoreLayerRole: true,
      isSnmpWalkableRole: true,
    });
  });

  /*
   * The four fields the row says nothing about must stay ABSENT rather than
   * present-and-undefined, so the client falls back per field: the built-in
   * shape, the built-in core set, the built-in SNMP-walkable set.
   */
  test("a row with only a key and a name leaves the other four fields absent", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { name: "Router" }),
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("router", index);

    expect(Object.keys(stamp).sort()).toEqual(["roleKey", "roleLabel"]);
    expect(stamp).not.toHaveProperty("roleId");
    expect(stamp).not.toHaveProperty("roleShape");
    expect(stamp).not.toHaveProperty("isCoreLayerRole");
    expect(stamp).not.toHaveProperty("isSnmpWalkableRole");
  });

  /*
   * The legend groups nodes by role key, and a group with no key cannot be
   * grouped — so the key is the one field a found row always contributes,
   * however empty the rest of it is.
   */
  test("roleKey is always stamped when the row is found, even if nothing else is", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      { key: "router", name: "" },
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("router", index);

    expect(Object.keys(stamp)).toEqual(["roleKey"]);
    expect(stamp.roleKey).toBe("router");
  });

  /*
   * An empty name is not a label. Stamping "" would draw a blank chip in the
   * legend and a blank accessible label; leaving it absent falls back to the
   * built-in name for the classified role.
   */
  test("a row with a blank name stamps no label, so the built-in one is used", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { name: "", topologyShape: "circle" }),
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("router", index);

    expect(stamp).not.toHaveProperty("roleLabel");
    expect(stamp.roleShape).toBe("circle");
  });

  test("a row with a blank id stamps no roleId", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { id: "", name: "Router" }),
    ]);

    expect(stampForRoleKey("router", index)).not.toHaveProperty("roleId");
  });

  test("the row is found however the caller cases or pads the key", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("wirelessAccessPoint", { name: "Access Point" }),
    ]);

    expect(stampForRoleKey("wirelessAccessPoint", index).roleLabel).toBe(
      "Access Point",
    );
    expect(stampForRoleKey("  WIRELESSACCESSPOINT  ", index).roleLabel).toBe(
      "Access Point",
    );
  });

  /*
   * The stamped key is the ROW's key verbatim, not the lowercased key the
   * lookup was done with. Built-in keys are lowerCamelCase
   * ("wirelessAccessPoint"), and a node carrying "wirelessaccesspoint" would
   * no longer equal the key anything else in the product compares against.
   */
  test("stamps the row's own key, not the lowercased key it was looked up by", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("wirelessAccessPoint", { name: "Access Point" }),
    ]);

    expect(stampForRoleKey("WIRELESSACCESSPOINT", index).roleKey).toBe(
      "wirelessAccessPoint",
    );
  });
});

describe("stampForRoleKey — topologyShape is validated, not trusted", () => {
  test("accepts each of the eight silhouettes the renderer can draw", () => {
    for (const shape of ALL_SHAPES) {
      const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
        makeRole("custom", { topologyShape: shape }),
      ]);

      expect(stampForRoleKey("custom", index).roleShape).toBe(shape);
    }
  });

  /*
   * topologyShape is a free-text column — the geometry lives in the client and
   * adding a shape must not need a migration — so an unrecognised value is
   * dropped rather than handed to a renderer with no path for it, which would
   * draw nothing at all.
   */
  test("drops a shape the renderer has no path for", () => {
    const unknownShapes: ReadonlyArray<string> = [
      "octagon",
      "",
      "   ",
      "star",
      "rounded_square",
    ];

    for (const shape of unknownShapes) {
      const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
        makeRole("custom", { name: "Custom", topologyShape: shape }),
      ]);

      expect(stampForRoleKey("custom", index)).not.toHaveProperty("roleShape");
    }
  });

  /*
   * Shapes are matched exactly, unlike keys: they are written by the settings
   * dropdown, not typed by hand, and a near-miss is a bug worth falling back
   * on rather than guessing at.
   */
  test("a shape with the wrong case or stray padding is not a shape", () => {
    for (const shape of ["CIRCLE", "Rounded-Square", " circle "]) {
      const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
        makeRole("custom", { topologyShape: shape }),
      ]);

      expect(stampForRoleKey("custom", index)).not.toHaveProperty("roleShape");
    }
  });

  /*
   * One bad column value must cost only the shape. Blanking the whole stamp
   * would also lose the label and the layout flags the operator did configure.
   */
  test("a bad shape does not cost the row its label or its flags", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("posTerminal", {
        name: "PoS Terminal",
        topologyShape: "octagon",
        isCoreLayer: false,
        isSnmpWalkable: false,
      }),
    ]);

    expect(stampForRoleKey("posTerminal", index)).toEqual({
      roleKey: "posTerminal",
      roleLabel: "PoS Terminal",
      isCoreLayerRole: false,
      isSnmpWalkableRole: false,
    });
  });
});

describe("stampForRoleKey — an explicit false is an answer", () => {
  /*
   * "This role is not core" and "this role says nothing about being core" are
   * different: the first must beat the built-in CORE set (a project that
   * decided its firewalls are not core devices), the second must fall back to
   * it. Dropping false as falsy would collapse the two.
   */
  test("isCoreLayer false is stamped as false rather than dropped as falsy", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("firewall", { name: "Firewall", isCoreLayer: false }),
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("firewall", index);

    expect(stamp).toHaveProperty("isCoreLayerRole");
    expect(stamp.isCoreLayerRole).toBe(false);
  });

  test("isSnmpWalkable false is stamped as false rather than dropped as falsy", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("camera", { name: "Camera", isSnmpWalkable: false }),
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("camera", index);

    expect(stamp).toHaveProperty("isSnmpWalkableRole");
    expect(stamp.isSnmpWalkableRole).toBe(false);
  });

  test("a row that omits both flags stamps neither of them", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { name: "Router" }),
    ]);

    const stamp: TopologyNodeRoleStamp = stampForRoleKey("router", index);

    expect(stamp).not.toHaveProperty("isCoreLayerRole");
    expect(stamp).not.toHaveProperty("isSnmpWalkableRole");
  });
});

describe("stampForRoleKey — purity", () => {
  test("does not mutate the index or the rows inside it", () => {
    const roles: Array<TopologyDeviceRoleInput> = [
      makeRole("router", {
        id: "role-1",
        name: "Router",
        topologyShape: "circle",
        isCoreLayer: true,
        isSnmpWalkable: true,
      }),
    ];
    const index: Map<string, TopologyDeviceRoleInput> =
      buildDeviceRoleIndex(roles);
    const before: string = snapshot(roles);

    stampForRoleKey("router", index);
    stampForRoleKey("nothing-here", index);
    stampForRoleKey(undefined, index);

    expect(snapshot(roles)).toBe(before);
    expect(index.size).toBe(1);
  });

  /*
   * Each node gets its own stamp object. Sharing one would let a consumer that
   * edits a node's role fields corrupt every other node of the same role.
   */
  test("returns a fresh object per call, so one node's stamp cannot leak into another's", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { name: "Router" }),
    ]);

    const first: TopologyNodeRoleStamp = stampForRoleKey("router", index);
    const second: TopologyNodeRoleStamp = stampForRoleKey("router", index);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    first.roleLabel = "Mutated";

    expect(second.roleLabel).toBe("Router");
    expect(stampForRoleKey("router", index).roleLabel).toBe("Router");
  });

  test("the empty stamp is a fresh object too, not a shared constant", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex(
      [],
    );

    const first: TopologyNodeRoleStamp = stampForRoleKey("router", index);
    first.roleKey = "mutated";

    expect(stampForRoleKey("router", index)).toEqual({});
  });
});

/*
 * The seeded defaults reproduce the renderer's historical SHAPE_BY_ROLE map
 * and CORE_DEVICE_ROLES set, so a freshly seeded project must draw exactly
 * the map it drew before roles were rows. This is the regression that would
 * be noticed last and hurt most.
 */
describe("the eleven seeded defaults round-trip through the catalog", () => {
  const index: Map<string, TopologyDeviceRoleInput> =
    buildDeviceRoleIndex(seededRoles);

  test("every default stamps its configured label, shape and layout flags", () => {
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(stampForRoleKey(role.key, index)).toEqual({
        roleKey: role.key,
        roleLabel: role.name,
        roleShape: role.topologyShape,
        isCoreLayerRole: role.isCoreLayer,
        isSnmpWalkableRole: role.isSnmpWalkable,
      });
    }
  });

  test("every default's shape is one the renderer can actually draw", () => {
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(ALL_SHAPES).toContain(role.topologyShape);
    }
  });

  /*
   * "unknown" is not seeded on purpose — it is the classifier declining to
   * answer, not a role anyone assigns — so it must find no row even in a
   * fully seeded project.
   */
  test('"unknown" matches no seeded row', () => {
    expect(stampForRoleKey("unknown", index)).toEqual({});
  });
});

describe("roleKeyForNode", () => {
  /*
   * The operator's assignment wins for presentation exactly as it does for
   * `role` itself: a device explicitly filed under a role is drawn as that
   * role however the classifier reads its sysDescr.
   */
  test("an assigned key beats the classifier's answer", () => {
    expect(roleKeyForNode("posTerminal", "switch")).toBe("posterminal");
    expect(roleKeyForNode("router", "host")).toBe("router");
  });

  /*
   * The assignment is normalized the same way the index is keyed, so the two
   * meet in the middle whatever case the stored column is in.
   */
  test("the assigned key is normalized, and still finds its row", () => {
    expect(roleKeyForNode("  ROUTER  ", "switch")).toBe("router");

    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", { name: "Edge Router" }),
    ]);

    expect(
      stampForRoleKey(roleKeyForNode(" Router ", "switch"), index).roleLabel,
    ).toBe("Edge Router");
  });

  /*
   * With no assignment the classifier's answer is used, so a project that
   * renamed "Router" to "Edge Router" sees the new name on every device it
   * never had to touch.
   */
  test("with no assignment the classifier's answer is used, verbatim", () => {
    expect(roleKeyForNode(undefined, "wirelessAccessPoint")).toBe(
      "wirelessAccessPoint",
    );
    expect(roleKeyForNode(undefined, "loadBalancer")).toBe("loadBalancer");
  });

  test("a classified key keeps its camelCase and still resolves through the index", () => {
    const index: Map<string, TopologyDeviceRoleInput> =
      buildDeviceRoleIndex(seededRoles);

    const key: string | undefined = roleKeyForNode(
      undefined,
      "wirelessAccessPoint",
    );

    expect(stampForRoleKey(key, index).roleLabel).toBe("Wireless AP");
  });

  /*
   * A stored column that is blank is not an assignment — it is the absence of
   * one — so it must not shadow the classifier and leave the node unclassified.
   */
  test("a blank assignment falls through to the classifier", () => {
    expect(roleKeyForNode("", "router")).toBe("router");
    expect(roleKeyForNode("   ", "router")).toBe("router");
    expect(roleKeyForNode(undefined, "router")).toBe("router");
  });

  /*
   * "unknown" is the classifier saying it has no answer, not a role. It is no
   * row's key, and looking it up would be a wasted miss that reads as if the
   * project were missing a role it should have.
   */
  test('a classified "unknown" is never looked up', () => {
    expect(roleKeyForNode(undefined, "unknown")).toBeUndefined();
    expect(roleKeyForNode("", "unknown")).toBeUndefined();
    expect(roleKeyForNode("   ", "unknown")).toBeUndefined();
  });

  /*
   * The short-circuit guards the CLASSIFIER's answer only. An assigned
   * "unknown" is passed through, and in a project with no such row it simply
   * finds nothing — which is the same neutral node, reached honestly.
   */
  test('an assigned "unknown" is returned and simply matches no row', () => {
    const index: Map<string, TopologyDeviceRoleInput> =
      buildDeviceRoleIndex(seededRoles);

    expect(roleKeyForNode("unknown", "router")).toBe("unknown");
    expect(stampForRoleKey("unknown", index)).toEqual({});
  });

  test('every built-in role except "unknown" passes through unchanged', () => {
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      const classified: NetworkTopologyDeviceRole = role.key;
      expect(roleKeyForNode(undefined, classified)).toBe(role.key);
    }
  });
});

describe("applyRoleStamp", () => {
  test("copies only the fields the stamp carries and leaves the rest absent", () => {
    const node: NetworkTopologyNode = makeNode({ role: "switch" });

    applyRoleStamp(node, { roleKey: "switch", roleLabel: "Access Switch" });

    expect(node.roleKey).toBe("switch");
    expect(node.roleLabel).toBe("Access Switch");
    expect(node).not.toHaveProperty("roleId");
    expect(node).not.toHaveProperty("roleShape");
    expect(node).not.toHaveProperty("isCoreLayerRole");
    expect(node).not.toHaveProperty("isSnmpWalkableRole");
    expect(Object.keys(node).sort()).toEqual([
      "id",
      "isManaged",
      "name",
      "role",
      "roleKey",
      "roleLabel",
      "status",
    ]);
  });

  test("a full stamp copies all six fields onto the node", () => {
    const node: NetworkTopologyNode = makeNode();

    applyRoleStamp(node, {
      roleId: "role-1",
      roleKey: "router",
      roleLabel: "Edge Router",
      roleShape: "hexagon",
      isCoreLayerRole: true,
      isSnmpWalkableRole: true,
    });

    expect(node.roleId).toBe("role-1");
    expect(node.roleKey).toBe("router");
    expect(node.roleLabel).toBe("Edge Router");
    expect(node.roleShape).toBe("hexagon");
    expect(node.isCoreLayerRole).toBe(true);
    expect(node.isSnmpWalkableRole).toBe(true);
  });

  /*
   * The unconfigured project's whole path: an empty stamp reaches every node
   * and the payload comes out identical to the one built before roles existed.
   */
  test("an empty stamp leaves the node exactly as it was", () => {
    const node: NetworkTopologyNode = makeNode({
      role: "router",
      kind: "device",
    });
    const before: string = snapshot(node);
    const keysBefore: Array<string> = Object.keys(node).sort();

    applyRoleStamp(node, {});

    expect(snapshot(node)).toBe(before);
    expect(Object.keys(node).sort()).toEqual(keysBefore);
    for (const field of STAMP_FIELDS) {
      expect(node).not.toHaveProperty(field);
    }
  });

  test("applying the same stamp twice is idempotent", () => {
    const stamp: TopologyNodeRoleStamp = {
      roleKey: "router",
      roleLabel: "Edge Router",
      roleShape: "circle",
      isCoreLayerRole: true,
    };

    const once: NetworkTopologyNode = makeNode({ role: "router" });
    applyRoleStamp(once, stamp);
    const afterFirst: string = snapshot(once);

    applyRoleStamp(once, stamp);

    expect(snapshot(once)).toBe(afterFirst);
  });

  /*
   * tierForNode reads isCoreLayerRole BEFORE the built-in core set, so a false
   * that got dropped on the way onto the node would put a role the operator
   * explicitly demoted straight back at core level.
   */
  test("writes an explicit false onto the node rather than skipping it", () => {
    const node: NetworkTopologyNode = makeNode({ role: "firewall" });

    applyRoleStamp(node, {
      roleKey: "firewall",
      isCoreLayerRole: false,
      isSnmpWalkableRole: false,
    });

    expect(node).toHaveProperty("isCoreLayerRole");
    expect(node.isCoreLayerRole).toBe(false);
    expect(node).toHaveProperty("isSnmpWalkableRole");
    expect(node.isSnmpWalkableRole).toBe(false);
  });

  /*
   * A field the stamp does not carry must neither be created as undefined nor
   * clear a value already on the node — "absent" has to stay absent for any
   * consumer that checks with `in` or serialises the node.
   */
  test("a field the stamp omits is neither created nor cleared", () => {
    const node: NetworkTopologyNode = makeNode({
      roleLabel: "Already Set",
      roleShape: "diamond",
    });

    applyRoleStamp(node, { roleKey: "router", roleLabel: undefined });

    expect(node.roleKey).toBe("router");
    expect(node.roleLabel).toBe("Already Set");
    expect(node.roleShape).toBe("diamond");
    expect(node).not.toHaveProperty("roleId");
    expect(node).not.toHaveProperty("isCoreLayerRole");
  });

  test("leaves the node's own identity and status fields alone", () => {
    const node: NetworkTopologyNode = makeNode({
      role: "switch",
      kind: "device",
      status: "down",
      vendor: "Cisco",
    });

    applyRoleStamp(node, { roleKey: "switch", roleLabel: "Access Switch" });

    expect(node.id).toBe("device-1");
    expect(node.name).toBe("core-sw-1");
    expect(node.isManaged).toBe(true);
    expect(node.status).toBe("down");
    expect(node.kind).toBe("device");
    expect(node.role).toBe("switch");
    expect(node.vendor).toBe("Cisco");
  });

  test("does not mutate the stamp it was handed", () => {
    const stamp: TopologyNodeRoleStamp = {
      roleKey: "router",
      roleLabel: "Edge Router",
      isCoreLayerRole: false,
    };
    const before: string = snapshot(stamp);

    applyRoleStamp(makeNode(), stamp);

    expect(snapshot(stamp)).toBe(before);
  });

  /*
   * One stamp is applied to every node of a role, so it must be reusable
   * across nodes without any of them picking up another's fields.
   */
  test("the same stamp can be applied to many nodes independently", () => {
    const stamp: TopologyNodeRoleStamp = stampForRoleKey(
      "router",
      buildDeviceRoleIndex([
        makeRole("router", { name: "Edge Router", topologyShape: "circle" }),
      ]),
    );

    const first: NetworkTopologyNode = makeNode({ id: "a" });
    const second: NetworkTopologyNode = makeNode({ id: "b" });

    applyRoleStamp(first, stamp);
    first.roleLabel = "Renamed on this node only";
    applyRoleStamp(second, stamp);

    expect(second.roleLabel).toBe("Edge Router");
  });
});

describe("the catalog end to end", () => {
  /*
   * Purity all the way through: the same rows and the same node must produce
   * the same payload every time, because the topology is rebuilt on every
   * poll and a map that shifted between identical builds would be unreadable.
   */
  test("the same rows and node produce an identical result on every run", () => {
    const run: () => NetworkTopologyNode = (): NetworkTopologyNode => {
      const index: Map<string, TopologyDeviceRoleInput> =
        buildDeviceRoleIndex(seededRoles);
      const node: NetworkTopologyNode = makeNode({
        role: "wirelessAccessPoint",
      });
      applyRoleStamp(
        node,
        stampForRoleKey(
          roleKeyForNode(undefined, node.role || "unknown"),
          index,
        ),
      );
      return node;
    };

    expect(snapshot(run())).toBe(snapshot(run()));
  });

  /*
   * The whole point of the feature, in one pass: a renamed and reshaped role
   * reaches a device the operator never edited, because the classifier's key
   * still matches the row.
   */
  test("a renamed role reaches a device nobody assigned a role to", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex([
      makeRole("router", {
        id: "role-router",
        name: "Edge Router",
        topologyShape: "hexagon",
        isCoreLayer: true,
        isSnmpWalkable: true,
      }),
    ]);
    const node: NetworkTopologyNode = makeNode({ role: "router" });

    applyRoleStamp(
      node,
      stampForRoleKey(roleKeyForNode(undefined, "router"), index),
    );

    expect(node.roleLabel).toBe("Edge Router");
    expect(node.roleShape).toBe("hexagon");
    expect(node.isCoreLayerRole).toBe(true);
    expect(node.roleId).toBe("role-router");
    // The classified role is untouched — the configured fields sit alongside it.
    expect(node.role).toBe("router");
  });

  /*
   * And the same pass for a project with nothing configured: not one of the
   * six fields appears, so every consumer downstream behaves exactly as it did
   * before device roles were configurable.
   */
  test("a project with no roles configured gets a node with no role fields at all", () => {
    const index: Map<string, TopologyDeviceRoleInput> = buildDeviceRoleIndex(
      [],
    );
    const node: NetworkTopologyNode = makeNode({ role: "router" });

    applyRoleStamp(
      node,
      stampForRoleKey(roleKeyForNode(undefined, "router"), index),
    );

    for (const field of STAMP_FIELDS) {
      expect(node).not.toHaveProperty(field);
    }
    expect(node.role).toBe("router");
  });
});
