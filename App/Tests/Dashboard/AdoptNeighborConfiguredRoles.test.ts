import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  NeighborAdoptionDraft,
  buildNeighborAdoptionDraft,
} from "../../FeatureSet/Dashboard/src/Components/Topology/AdoptNeighborUtil";

/*
 * Device roles are a per-project table now (Network > Settings > Device
 * Roles), not a fixed union with the behaviour hardcoded beside it. Each row
 * carries an `isSnmpWalkable` flag, and the topology payload stamps it onto
 * every node as `isSnmpWalkableRole`.
 *
 * That flag lands in exactly one decision in this module — whether the role
 * the map classified the peer as is SEEDED onto the new device. `deviceRole`
 * is an override: once written, the topology builder never classifies that
 * device again. A device the probe will walk has a sysDescr coming that will
 * answer better than a guess made from an advertised name, so the guess is
 * withheld; a device nothing will ever walk has no such future, so the guess
 * is the only evidence there will be and it is carried.
 *
 * It does NOT decide how the device is monitored. That used to be the other
 * half of this decision — a not-walkable role opened the dialog on a
 * monitor-backed device with no probe — and it is gone: every adopted
 * neighbour is a Probe device, pinged by its probe and walked only once it
 * has credentials, so a phone with the wrong flag is at worst mis-seeded,
 * never left unpolled.
 *
 * Two claims are made about the flag and both are worth pinning:
 *
 *   - the PROJECT'S answer wins, in BOTH directions. A project that says its
 *     routers are not walkable (a fleet of consumer edge boxes with SNMP off
 *     by policy) gets the role seeded; a project that says its cameras ARE
 *     walkable gets it withheld. Neither is expressible in the built-in
 *     leaf-role list.
 *   - a payload that does not carry the flag at all — one built before this
 *     existed, or for a project with no row for that role — behaves EXACTLY
 *     as it did before, for every one of the twelve built-in roles.
 *
 * The second is the regression that matters most: `isSnmpWalkableRole` is an
 * optional boolean, so reading it with a truthiness test rather than an
 * explicit "is it absent" test silently turns "not walkable" into "no answer
 * given", and every camera in every project quietly loses its seeded role.
 *
 * The name, hostname, description, links and warnings rules are asserted in
 * AdoptNeighborUtil.test.ts; the fixtures below are shared with it on purpose
 * so a change to either file is read against the same network.
 */

const SWITCH: NetworkTopologyNode = {
  id: "switch-1",
  name: "UN1289LANSWI01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const SECOND_SWITCH: NetworkTopologyNode = {
  id: "switch-2",
  name: "UN1289LANSWI02",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const PHONE: NetworkTopologyNode = {
  id: "unmanaged:sep6026aaf2b46b",
  name: "SEP6026AAF2B46B",
  isManaged: false,
  kind: "unmanaged",
  role: "phone",
  status: "unknown",
  deviceModel: "Cisco IP Phone 8811",
  ipAddress: "10.0.12.41",
};

const PHONE_EDGE: NetworkTopologyEdge = {
  fromNodeId: "switch-1",
  toNodeId: "unmanaged:sep6026aaf2b46b",
  fromPort: "GigabitEthernet1/0/12",
  toPort: "SW PORT",
  protocols: ["cdp"],
};

/* The id of a NetworkDeviceRole row, as the payload stamps it on a node. */
const ROLE_ROW_ID: string = "6640b1f0a5f2c3d4e5f60718";

function nodeMap(
  ...nodes: Array<NetworkTopologyNode>
): Map<string, NetworkTopologyNode> {
  const map: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();

  for (const node of nodes) {
    map.set(node.id, node);
  }

  return map;
}

function draftForPhone(
  node: NetworkTopologyNode = PHONE,
  edges: Array<NetworkTopologyEdge> = [PHONE_EDGE],
): NeighborAdoptionDraft {
  return buildNeighborAdoptionDraft({
    node: node,
    edges: edges,
    nodeById: nodeMap(SWITCH, SECOND_SWITCH, node),
  });
}

/* Every value the built-in classifier can emit, "unknown" included. */
const ALL_BUILT_IN_ROLES: ReadonlyArray<NetworkTopologyDeviceRole> = [
  "router",
  "switch",
  "firewall",
  "wirelessAccessPoint",
  "loadBalancer",
  "server",
  "storage",
  "printer",
  "camera",
  "phone",
  "host",
  "unknown",
];

/*
 * The four roles that have ALWAYS been treated as not walkable, restated here
 * rather than imported: the set is private to the module, and a test that
 * imported it would pass just as happily if somebody edited it. This is the
 * historical contract, written down.
 */
const HISTORICALLY_NOT_WALKABLE: ReadonlyArray<NetworkTopologyDeviceRole> = [
  "printer",
  "camera",
  "phone",
  "host",
];

/*
 * The seeding rule with the flag ABSENT: a not-walkable role is seeded, a
 * walkable one is withheld. "unknown" is not a role and is never seeded.
 */
function historicallySeededRoleFor(
  role: NetworkTopologyDeviceRole,
): NetworkTopologyDeviceRole | undefined {
  return HISTORICALLY_NOT_WALKABLE.includes(role) ? role : undefined;
}

describe("a project's own answer about a role decides whether it is seeded", () => {
  /*
   * The direction the built-in list cannot express at all. "Router" is
   * infrastructure and has always been treated as walkable, but a project
   * running a fleet of consumer edge boxes with SNMP disabled by policy knows
   * better — nothing will ever walk them, so the guess is all there is.
   */
  test("a role the project marked not walkable is seeded, even for a router", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "router",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    });

    expect(draft.deviceRole).toBe("router");
    expect(draft.networkDeviceRoleId).toBe(ROLE_ROW_ID);
  });

  test("the same holds for every infrastructure role the built-in list treats as walkable", () => {
    for (const role of [
      "switch",
      "firewall",
      "wirelessAccessPoint",
      "loadBalancer",
      "server",
      "storage",
    ] as ReadonlyArray<NetworkTopologyDeviceRole>) {
      expect(
        draftForPhone({ ...PHONE, role: role, isSnmpWalkableRole: false })
          .deviceRole,
      ).toBe(role);
    }
  });

  /*
   * And the other direction. Plenty of estates run cameras, handsets and
   * printers that answer SNMP perfectly well; the built-in list treats them
   * as not walkable because on average they are not. A project that has said
   * otherwise is obeyed — its sysDescr is coming, so the guess is withheld —
   * or the flag is decoration.
   */
  test("a role the project marked walkable is withheld, even for a camera", () => {
    for (const role of HISTORICALLY_NOT_WALKABLE) {
      expect(
        draftForPhone({ ...PHONE, role: role, isSnmpWalkableRole: true })
          .deviceRole,
      ).toBeUndefined();
    }
  });

  /*
   * A custom role ("PoS Terminal", "Kiosk") has no built-in key to fall back
   * on, so `role` is absent and the configured flag is the ONLY evidence
   * there is. Without it being read, every custom role would inherit the
   * unclassified default and be withheld.
   */
  test("a custom role with no built-in equivalent is still obeyed", () => {
    const kiosk: NetworkTopologyNode = {
      ...PHONE,
      role: undefined,
      roleKey: "pos-terminal",
      roleLabel: "PoS Terminal",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    };

    expect(draftForPhone(kiosk).networkDeviceRoleId).toBe(ROLE_ROW_ID);
  });

  /*
   * The falsy-value trap, stated on its own. `false` is a real answer and
   * `undefined` is the absence of one; a truthiness test collapses them and
   * the bug is invisible, because the wrong branch is also the old branch.
   */
  test("false is an answer, not the absence of one", () => {
    const notWalkable: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "switch",
      isSnmpWalkableRole: false,
    });
    const noAnswer: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "switch",
    });

    expect(notWalkable.deviceRole).toBe("switch");
    expect(noAnswer.deviceRole).toBeUndefined();
  });
});

describe("the monitoring method is Probe whatever the project says about the role", () => {
  /*
   * The half of the old decision that is gone. Walkability used to open the
   * dialog on a monitor-backed device — no probe, nothing polling it, a Ping
   * monitor to hand-make — for every not-walkable role. Every adopted
   * neighbour is probe-polled now: the probe pings it, and walks it only
   * once it has credentials, so a not-walkable role costs nothing but the
   * walk it would have failed anyway.
   */
  test("every built-in role, with every configured answer, is a Probe device", () => {
    const everyConfiguredAnswer: ReadonlyArray<boolean | undefined> = [
      undefined,
      true,
      false,
    ];

    for (const role of ALL_BUILT_IN_ROLES) {
      for (const walkable of everyConfiguredAnswer) {
        expect(
          draftForPhone({ ...PHONE, role: role, isSnmpWalkableRole: walkable })
            .monitoringMethod,
        ).toBe(NetworkDeviceMonitoringMethod.Probe);
      }
    }
  });

  test("a custom role the project marked not walkable is still a Probe device", () => {
    expect(
      draftForPhone({
        ...PHONE,
        role: undefined,
        roleKey: "pos-terminal",
        roleLabel: "PoS Terminal",
        isSnmpWalkableRole: false,
      }).monitoringMethod,
    ).toBe(NetworkDeviceMonitoringMethod.Probe);
  });

  test("no role and no answer at all is a Probe device", () => {
    expect(draftForPhone({ ...PHONE, role: undefined }).monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Probe,
    );
  });
});

describe("a payload that carries no configured answer behaves exactly as before", () => {
  /*
   * The whole compatibility claim in one assertion. Every role, both the ones
   * the built-in list names and the ones it does not, resolved with the flag
   * absent — which is what a payload built before this feature, and a payload
   * for a project whose roles table has no row for the role, both look like.
   */
  test("every one of the twelve built-in roles is seeded the way it always has been", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      expect(draftForPhone({ ...PHONE, role: role }).deviceRole).toBe(
        historicallySeededRoleFor(role),
      );
    }
  });

  /*
   * An explicit `undefined` reaches the module differently from an absent key
   * (spread, JSON round-trip, an optional field the builder chose not to
   * stamp) and must read the same way.
   */
  test("an explicitly undefined flag reads as absent rather than as false", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      expect(
        draftForPhone({ ...PHONE, role: role, isSnmpWalkableRole: undefined })
          .deviceRole,
      ).toBe(historicallySeededRoleFor(role));
    }
  });

  /*
   * An unidentified box on a switch port is far more often a switch nobody
   * has added yet than it is a kiosk, so the unclassified default is
   * "walkable" — nothing is seeded — and configurable roles must not have
   * quietly inverted it.
   */
  test("an unclassified peer is still treated as walkable and gets no seed", () => {
    expect(
      draftForPhone({ ...PHONE, role: undefined, roleId: ROLE_ROW_ID })
        .networkDeviceRoleId,
    ).toBeUndefined();
    expect(
      draftForPhone({ ...PHONE, role: "unknown", roleId: ROLE_ROW_ID })
        .networkDeviceRoleId,
    ).toBeUndefined();
  });

  /*
   * The other role fields the payload now carries are for the map — the
   * silhouette, the legend grouping, the layout band. None of them says
   * anything about walkability, so none of them may move this decision.
   */
  test("the other configured role fields do not influence the seed", () => {
    const decorated: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "phone",
      roleKey: "phone",
      roleLabel: "Handset",
      roleShape: "rect",
      isCoreLayerRole: true,
      roleId: ROLE_ROW_ID,
    });

    expect(decorated.deviceRole).toBe("phone");
    expect(decorated.networkDeviceRoleId).toBe(ROLE_ROW_ID);
  });
});

describe("the role row's id rides along only where a role is assigned at all", () => {
  /*
   * `networkDeviceRoleId` exists so the create form can PRESELECT the role
   * the map already shows — the role is a relation now and a form cannot
   * resolve a key to a row. It therefore has to follow `deviceRole` exactly:
   * an id set where the key is withheld would assign a role on a device the
   * probe is about to classify for itself, which is the very thing withholding
   * the key is for.
   */
  test("it is carried for a device nothing will walk", () => {
    expect(
      draftForPhone({ ...PHONE, roleId: ROLE_ROW_ID }).networkDeviceRoleId,
    ).toBe(ROLE_ROW_ID);
  });

  test("it is withheld from a device the probe will walk", () => {
    expect(
      draftForPhone({ ...PHONE, role: "router", roleId: ROLE_ROW_ID })
        .networkDeviceRoleId,
    ).toBeUndefined();
  });

  test("it is undefined when the payload names no role row", () => {
    const draft: NeighborAdoptionDraft = draftForPhone(PHONE);

    expect(draft.deviceRole).toBe("phone");
    expect(draft.networkDeviceRoleId).toBeUndefined();
  });

  test("it mirrors deviceRole across every built-in role", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      const draft: NeighborAdoptionDraft = draftForPhone({
        ...PHONE,
        role: role,
        roleId: ROLE_ROW_ID,
      });

      expect(draft.networkDeviceRoleId).toBe(
        historicallySeededRoleFor(role) !== undefined ? ROLE_ROW_ID : undefined,
      );
    }
  });

  /*
   * The configured flag moves BOTH fields together, because it moved the
   * branch they both hang off. A router the project marked not walkable is
   * now a device nothing will walk, so the guess about its role is the only
   * evidence there will ever be — exactly the case the key is carried for.
   */
  test("a role the project marked not walkable carries the id, like any leaf device", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "router",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    });

    expect(draft.networkDeviceRoleId).toBe(ROLE_ROW_ID);
    expect(draft.deviceRole).toBe("router");
  });

  test("a role the project marked walkable withholds the id, like any infrastructure device", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "camera",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: true,
    });

    expect(draft.networkDeviceRoleId).toBeUndefined();
    expect(draft.deviceRole).toBeUndefined();
  });

  /*
   * A custom role is the one case where the two fields legitimately differ:
   * there is a row to preselect but no built-in key to write to the
   * deprecated string column. The form still opens with the right role
   * selected, which is the point of carrying the id separately at all.
   */
  test("a custom role preselects the row even though the deprecated key stays empty", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: undefined,
      roleKey: "pos-terminal",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    });

    expect(draft.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(draft.networkDeviceRoleId).toBe(ROLE_ROW_ID);
    expect(draft.deviceRole).toBeUndefined();
  });
});

describe("the deprecated deviceRole string is unchanged by any of this", () => {
  test("the classified key is carried only for a device nothing will walk", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      const draft: NeighborAdoptionDraft = draftForPhone({
        ...PHONE,
        role: role,
      });

      expect(draft.deviceRole).toBe(historicallySeededRoleFor(role));
    }
  });

  /*
   * "unknown" is the absence of a role, not a role. Storing it as an override
   * would permanently disable the classifier on a device the operator was only
   * declining to classify — and a project marking that role not walkable must
   * not sneak it through the seeded branch.
   */
  test("an unknown role is never written as an override, however the project configured it", () => {
    const everyConfiguredAnswer: ReadonlyArray<boolean | undefined> = [
      undefined,
      true,
      false,
    ];

    for (const walkable of everyConfiguredAnswer) {
      expect(
        draftForPhone({
          ...PHONE,
          role: "unknown",
          isSnmpWalkableRole: walkable,
        }).deviceRole,
      ).toBeUndefined();
    }
  });

  test("a peer with no role at all offers no override either", () => {
    expect(
      draftForPhone({
        ...PHONE,
        role: undefined,
        isSnmpWalkableRole: false,
      }).deviceRole,
    ).toBeUndefined();
  });
});

describe("the draft is a pure function of the payload", () => {
  /*
   * The modal builds the draft on every open and the map re-renders under it.
   * A second call that answered differently — or a first call that edited the
   * node it was handed — would show up as a form that changes while the
   * operator is reading it.
   */
  test("the same payload always produces the same draft", () => {
    const node: NetworkTopologyNode = {
      ...PHONE,
      role: "router",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    };

    expect(draftForPhone(node)).toEqual(draftForPhone(node));
  });

  test("building a draft does not edit the node it was built from", () => {
    const node: NetworkTopologyNode = {
      ...PHONE,
      role: "camera",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: true,
    };
    const before: string = JSON.stringify(node);

    buildNeighborAdoptionDraft({
      node: node,
      edges: [PHONE_EDGE],
      nodeById: nodeMap(SWITCH, SECOND_SWITCH, node),
    });

    expect(JSON.stringify(node)).toBe(before);
  });
});
