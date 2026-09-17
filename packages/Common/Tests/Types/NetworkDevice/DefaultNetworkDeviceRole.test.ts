import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
  NetworkTopologyNodeShape,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import DEFAULT_NETWORK_DEVICE_ROLES, {
  DefaultNetworkDeviceRole,
} from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";
import {
  DEVICE_ROLES_IN_LEGEND_ORDER,
  DEVICE_ROLE_LABELS,
} from "../../../Utils/Monitor/NetworkDeviceRoleUtil";
import { shapeForNode } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyNodeShape";

/*
 * DEFAULT_NETWORK_DEVICE_ROLES is what every project starts life with, and
 * the promise it makes is a conservative one: a project seeded from it must
 * behave EXACTLY as the product behaved when roles were a hardcoded union.
 * Same eleven roles, same labels, same silhouettes, same tiering, same
 * SNMP-versus-monitor default.
 *
 * That promise is only checkable by comparing the seed list against the three
 * modules it replaced — the labels in NetworkDeviceRoleUtil, the SHAPE_BY_ROLE
 * map in the renderer, the CORE_DEVICE_ROLES set in the layout and the
 * MONITOR_BACKED_ROLES set in the adopt flow. So that is what these tests do:
 * every one of them is a cross-check against the old source of truth, not a
 * restatement of the new one.
 *
 * The shape check imports the renderer directly (SHAPE_BY_ROLE itself is not
 * exported, but shapeForNode is, and it is the function the map actually
 * calls). Common's jest maps "Common/*" back to this package and several
 * Common tests already import App/FeatureSet/Dashboard sources this way, so a
 * genuine comparison is available and is worth far more than a second copy of
 * the table. The literal table below is kept anyway, so a reader can see the
 * eleven answers without following the import.
 */

type MakeDeviceNodeFunction = (
  role: NetworkTopologyDeviceRole,
) => NetworkTopologyNode;

/*
 * A node as an OLD payload carried it: the classified role and nothing else.
 * Deliberately no roleShape — that is the per-project stamp, and stamping it
 * would make shapeForNode echo the value back instead of consulting the
 * built-in map this test is comparing against.
 */
const makeDeviceNode: MakeDeviceNodeFunction = (
  role: NetworkTopologyDeviceRole,
): NetworkTopologyNode => {
  return {
    id: `device-${role}`,
    name: role,
    isManaged: true,
    status: "up",
    kind: "device",
    role: role,
  };
};

describe("DEFAULT_NETWORK_DEVICE_ROLES — what a fresh project is given", () => {
  test("seeds exactly eleven roles", () => {
    expect(DEFAULT_NETWORK_DEVICE_ROLES).toHaveLength(11);
  });

  /*
   * "unknown" is the classifier saying it has no answer, not a job a box
   * does. Offering it as a row an operator could assign would turn "I don't
   * know yet" into "never classify this device again", which is a different
   * and much worse statement.
   */
  test("does not seed 'unknown', which is an absence of an answer rather than a role", () => {
    const keys: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.key;
      },
    );

    expect(keys).not.toContain("unknown");
  });

  test("every key is one of the built-in roles the SNMP classifier can return", () => {
    /*
     * The classifier is evidence-driven and speaks the fixed union; it cannot
     * invent a project's custom role. A seeded key outside that union would be
     * a row nothing could ever match.
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(DEVICE_ROLES_IN_LEGEND_ORDER).toContain(role.key);
    }
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — order", () => {
  /*
   * The seeded `order` column is this array's index, and the legend reads in
   * DEVICE_ROLES_IN_LEGEND_ORDER. If the two ever diverge, a fresh project's
   * settings page and its map legend list the same eleven roles in two
   * different sequences — the sort of inconsistency nobody files a bug for and
   * everybody trips over.
   */
  test("the keys are DEVICE_ROLES_IN_LEGEND_ORDER, in that exact order", () => {
    const keys: Array<NetworkTopologyDeviceRole> =
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): NetworkTopologyDeviceRole => {
          return role.key;
        },
      );

    expect(keys).toEqual(Array.from(DEVICE_ROLES_IN_LEGEND_ORDER));
  });

  test("the two lists are the same SET as well as the same sequence", () => {
    // Guards the case where both lists are edited but only one is reordered.
    const seeded: Set<string> = new Set<string>(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): string => {
          return role.key;
        },
      ),
    );

    expect(seeded.size).toBe(DEVICE_ROLES_IN_LEGEND_ORDER.length);
    for (const key of DEVICE_ROLES_IN_LEGEND_ORDER) {
      expect(seeded.has(key)).toBe(true);
    }
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — names reproduce the built-in labels", () => {
  /*
   * The name is what the legend, the detail panel and the accessible label
   * show once a project is seeded, because the topology builder stamps the
   * configured label onto every node. If a seeded name drifted from
   * DEVICE_ROLE_LABELS, a freshly created project's map would be relabelled
   * relative to an old one for no reason the operator asked for.
   */
  test("every default's name is the built-in label for its key", () => {
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(role.name).toBe(DEVICE_ROLE_LABELS[role.key]);
    }
  });

  test("the eleven names are exactly the eleven non-unknown labels", () => {
    const names: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.name;
      },
    );

    expect(names).toEqual([
      "Router",
      "Switch",
      "Firewall",
      "Wireless AP",
      "Load balancer",
      "Server",
      "Storage",
      "Printer",
      "Camera",
      "IP phone",
      "Host",
    ]);
    expect(names).not.toContain(DEVICE_ROLE_LABELS.unknown);
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — shapes reproduce the renderer's map", () => {
  /*
   * Mirrors the renderer's private SHAPE_BY_ROLE. Written out so the eleven
   * silhouettes are readable here; the test below is the one that proves they
   * still agree with the renderer.
   */
  const EXPECTED_SHAPE_BY_KEY: Readonly<
    Record<string, NetworkTopologyNodeShape>
  > = {
    router: "circle",
    switch: "rounded-square",
    firewall: "diamond",
    wirelessAccessPoint: "triangle",
    loadBalancer: "hexagon",
    server: "tower",
    storage: "cylinder",
    // The four leaf roles deliberately share the endpoint rect.
    printer: "rect",
    camera: "rect",
    phone: "rect",
    host: "rect",
  };

  test("every default's topologyShape is what the renderer would draw for that role", () => {
    /*
     * The real cross-check, and the regression this whole file exists to
     * prevent: a project seeded from these defaults must draw the map it drew
     * before roles were configurable. shapeForNode on a node carrying only a
     * classified role is exactly the pre-feature code path.
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(role.topologyShape).toBe(shapeForNode(makeDeviceNode(role.key)));
    }
  });

  test("and it is the silhouette the table above names", () => {
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(role.topologyShape).toBe(EXPECTED_SHAPE_BY_KEY[role.key]);
    }
  });

  test("the seven infrastructure roles are seven distinct silhouettes", () => {
    // A map on which a router, a switch and a firewall look alike is unreadable.
    const infrastructureShapes: Array<NetworkTopologyNodeShape> =
      DEFAULT_NETWORK_DEVICE_ROLES.filter(
        (role: DefaultNetworkDeviceRole): boolean => {
          return role.topologyShape !== "rect";
        },
      ).map((role: DefaultNetworkDeviceRole): NetworkTopologyNodeShape => {
        return role.topologyShape;
      });

    expect(infrastructureShapes).toHaveLength(7);
    expect(new Set<string>(infrastructureShapes).size).toBe(7);
  });

  test("every seeded shape is one the renderer has geometry for", () => {
    /*
     * topologyShape is a free-text column and the catalogue drops any value
     * the renderer cannot draw. A seeded value it dropped would leave the
     * node falling back to a circle, silently.
     */
    const drawableShapes: ReadonlyArray<NetworkTopologyNodeShape> = [
      "circle",
      "rounded-square",
      "diamond",
      "triangle",
      "hexagon",
      "tower",
      "cylinder",
      "rect",
    ];

    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(drawableShapes).toContain(role.topologyShape);
    }
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — isCoreLayer reproduces CORE_DEVICE_ROLES", () => {
  /*
   * Mirrors the private CORE_DEVICE_ROLES set in TopologyLayout. Note what is
   * NOT in it: "switch". A switch is infrastructure, but it hangs off a
   * router, and the top tier is for the devices that hang off nothing.
   *
   * tierForNode now reads node.isCoreLayerRole BEFORE node.role, so these
   * eleven booleans are what decides the tier on every seeded project. Get one
   * wrong and the parent-child tree roots itself on the wrong device.
   */
  const CORE_KEYS: ReadonlyArray<string> = [
    "router",
    "firewall",
    "loadBalancer",
  ];

  test("exactly router, firewall and load balancer sit at the core", () => {
    const coreKeys: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.filter(
      (role: DefaultNetworkDeviceRole): boolean => {
        return role.isCoreLayer;
      },
    ).map((role: DefaultNetworkDeviceRole): string => {
      return role.key;
    });

    expect(coreKeys).toEqual(CORE_KEYS);
  });

  test("every other default is explicitly not core, never left undefined", () => {
    /*
     * The flag has to be a real boolean on every row: tierForNode branches on
     * `isCoreLayerRole !== undefined`, so an absent value would silently hand
     * the decision back to the FDB heuristic the role was meant to overrule.
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(typeof role.isCoreLayer).toBe("boolean");
      expect(role.isCoreLayer).toBe(CORE_KEYS.includes(role.key));
    }
  });

  test("a switch is not core, and neither is an access point", () => {
    // Called out because both are tempting to promote and both would be wrong.
    const byKey: Map<string, DefaultNetworkDeviceRole> = new Map<
      string,
      DefaultNetworkDeviceRole
    >(
      DEFAULT_NETWORK_DEVICE_ROLES.map(
        (
          role: DefaultNetworkDeviceRole,
        ): [string, DefaultNetworkDeviceRole] => {
          return [role.key, role];
        },
      ),
    );

    expect(byKey.get("switch")?.isCoreLayer).toBe(false);
    expect(byKey.get("wirelessAccessPoint")?.isCoreLayer).toBe(false);
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — isSnmpWalkable reproduces MONITOR_BACKED_ROLES", () => {
  /*
   * Mirrors the private MONITOR_BACKED_ROLES set in AdoptNeighborUtil, which
   * lists the roles that are never SNMP-walkable in practice. Adopting a
   * neighbour with one of them defaults the new device to a monitor rather
   * than to SNMP — defaulting a desk phone to SNMP would queue a walk it can
   * only fail and leave the operator reading "pending" forever.
   *
   * Everything else, including an unclassified peer, defaults to SNMP: an
   * unidentified box on a switch uplink is far more often a switch nobody has
   * added yet than it is a kiosk.
   */
  const MONITOR_BACKED_KEYS: ReadonlyArray<string> = [
    "printer",
    "camera",
    "phone",
    "host",
  ];

  test("exactly printer, camera, phone and host are not walkable", () => {
    const notWalkable: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.filter(
      (role: DefaultNetworkDeviceRole): boolean => {
        return !role.isSnmpWalkable;
      },
    ).map((role: DefaultNetworkDeviceRole): string => {
      return role.key;
    });

    expect(notWalkable).toEqual(MONITOR_BACKED_KEYS);
  });

  test("every other default is walkable, and the flag is always a real boolean", () => {
    /*
     * buildNeighborAdoptionDraft branches on
     * `isSnmpWalkableRole !== undefined`, so an absent value falls back to the
     * built-in set rather than being read as "not walkable".
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(typeof role.isSnmpWalkable).toBe("boolean");
      expect(role.isSnmpWalkable).toBe(!MONITOR_BACKED_KEYS.includes(role.key));
    }
  });

  test("the four non-walkable roles are exactly the four drawn as a leaf rect", () => {
    /*
     * Not a coincidence worth breaking: "something plugged into an access
     * port" is the same set of boxes as "nothing worth walking". If the two
     * ever diverge, one of the two lists was edited without the other.
     */
    const rectKeys: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.filter(
      (role: DefaultNetworkDeviceRole): boolean => {
        return role.topologyShape === "rect";
      },
    ).map((role: DefaultNetworkDeviceRole): string => {
      return role.key;
    });

    expect(rectKeys).toEqual(MONITOR_BACKED_KEYS);
  });
});

describe("DEFAULT_NETWORK_DEVICE_ROLES — the rows are storable as they stand", () => {
  test("keys are unique", () => {
    // The column is unique per project; a duplicate would fail the seed.
    const keys: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.key;
      },
    );

    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  test("names are unique", () => {
    /*
     * Also a unique column, and the seeder skips a default whose NAME already
     * exists — two defaults sharing a name would silently seed only one.
     */
    const names: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.name;
      },
    );

    expect(new Set<string>(names).size).toBe(names.length);
  });

  test("every default has a name and a description a human can read", () => {
    /*
     * The description is the only explanation the settings page offers for
     * what a role means, and a blank one there reads as a broken page.
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(role.name.trim()).not.toBe("");
      expect(role.name).toBe(role.name.trim());
      expect(role.description.trim()).not.toBe("");
      expect(role.description.length).toBeGreaterThan(10);
    }
  });

  test("descriptions are distinct, so no two roles explain themselves the same way", () => {
    const descriptions: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        return role.description;
      },
    );

    expect(new Set<string>(descriptions).size).toBe(descriptions.length);
  });
});
