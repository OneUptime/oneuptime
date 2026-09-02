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
 * That flag lands in exactly one decision in this module — whether "Add to
 * Monitoring" opens on SNMP polling or on a monitor — and that decision is
 * the difference between a device that reports health and a device that
 * queues a walk it can only ever fail and reads "pending" forever.
 *
 * Two claims are made about it and both are worth pinning:
 *
 *   - the PROJECT'S answer wins, in BOTH directions. A project that says its
 *     routers are not walkable (a fleet of consumer edge boxes with SNMP off
 *     by policy) gets a monitor; a project that says its cameras ARE walkable
 *     gets SNMP. Neither is expressible in the built-in leaf-role list.
 *   - a payload that does not carry the flag at all — one built before this
 *     existed, or for a project with no row for that role — behaves EXACTLY
 *     as it did before, for every one of the twelve built-in roles.
 *
 * The second is the regression that matters most: `isSnmpWalkableRole` is an
 * optional boolean, so reading it with a truthiness test rather than an
 * explicit "is it absent" test silently turns "not walkable" into "no answer
 * given", and every camera in every project quietly goes back to SNMP.
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
 * The four roles that have ALWAYS opened on a monitor, restated here rather
 * than imported: MONITOR_BACKED_ROLES is private to the module, and a test
 * that imported it would pass just as happily if somebody edited the set.
 * This is the historical contract, written down.
 */
const HISTORICALLY_MONITOR_BACKED: ReadonlyArray<NetworkTopologyDeviceRole> = [
  "printer",
  "camera",
  "phone",
  "host",
];

function historicalMethodFor(
  role: NetworkTopologyDeviceRole,
): NetworkDeviceMonitoringMethod {
  return HISTORICALLY_MONITOR_BACKED.includes(role)
    ? NetworkDeviceMonitoringMethod.Monitor
    : NetworkDeviceMonitoringMethod.Snmp;
}

describe("a project's own answer about a role decides how a neighbour is adopted", () => {
  /*
   * The direction the built-in list cannot express at all. "Router" is
   * infrastructure and has always defaulted to SNMP, but a project running a
   * fleet of consumer edge boxes with SNMP disabled by policy knows better —
   * and before roles were configurable there was nowhere for it to say so.
   */
  test("a role the project marked not walkable opens on a monitor, even for a router", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "router",
      isSnmpWalkableRole: false,
    });

    expect(draft.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Monitor);
  });

  test("the same holds for every infrastructure role the built-in list sends to SNMP", () => {
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
          .monitoringMethod,
      ).toBe(NetworkDeviceMonitoringMethod.Monitor);
    }
  });

  /*
   * And the other direction. Plenty of estates run cameras, handsets and
   * printers that answer SNMP perfectly well; the built-in list refuses them
   * because on average they do not. A project that has said otherwise is
   * obeyed, or the flag is decoration.
   */
  test("a role the project marked walkable opens on SNMP, even for a camera", () => {
    for (const role of HISTORICALLY_MONITOR_BACKED) {
      expect(
        draftForPhone({ ...PHONE, role: role, isSnmpWalkableRole: true })
          .monitoringMethod,
      ).toBe(NetworkDeviceMonitoringMethod.Snmp);
    }
  });

  /*
   * A custom role ("PoS Terminal", "Kiosk") has no built-in key to fall back
   * on, so `role` is absent and the configured flag is the ONLY evidence
   * there is. Without it being read, every custom role would inherit the
   * unclassified default and be walked.
   */
  test("a custom role with no built-in equivalent is still obeyed", () => {
    const kiosk: NetworkTopologyNode = {
      ...PHONE,
      role: undefined,
      roleKey: "pos-terminal",
      roleLabel: "PoS Terminal",
      isSnmpWalkableRole: false,
    };

    expect(draftForPhone(kiosk).monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Monitor,
    );
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

    expect(notWalkable.monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Monitor,
    );
    expect(noAnswer.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });
});

describe("a payload that carries no configured answer behaves exactly as before", () => {
  /*
   * The whole compatibility claim in one assertion. Every role, both the ones
   * the built-in list names and the ones it does not, resolved with the flag
   * absent — which is what a payload built before this feature, and a payload
   * for a project whose roles table has no row for the role, both look like.
   */
  test("every one of the twelve built-in roles resolves the way it always has", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      expect(draftForPhone({ ...PHONE, role: role }).monitoringMethod).toBe(
        historicalMethodFor(role),
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
          .monitoringMethod,
      ).toBe(historicalMethodFor(role));
    }
  });

  /*
   * An unidentified box on a switch port is far more often a switch nobody
   * has added yet than it is a kiosk, so the unclassified default is SNMP —
   * and configurable roles must not have quietly inverted it.
   */
  test("an unclassified peer still defaults to the product's primary path", () => {
    expect(draftForPhone({ ...PHONE, role: undefined }).monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
    expect(draftForPhone({ ...PHONE, role: "unknown" }).monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
  });

  /*
   * The other role fields the payload now carries are for the map — the
   * silhouette, the legend grouping, the layout band. None of them says
   * anything about polling, so none of them may move this decision.
   */
  test("the other configured role fields do not influence the monitoring method", () => {
    const decorated: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "phone",
      roleKey: "phone",
      roleLabel: "Handset",
      roleShape: "rect",
      isCoreLayerRole: true,
      roleId: ROLE_ROW_ID,
    });

    expect(decorated.monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Monitor,
    );
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

    expect(draft.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Monitor);
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
        historicalMethodFor(role) === NetworkDeviceMonitoringMethod.Monitor
          ? ROLE_ROW_ID
          : undefined,
      );
    }
  });

  /*
   * The configured flag moves BOTH fields together, because it moved the
   * branch they both hang off. A router the project marked not walkable is
   * now a device nothing will walk, so the guess about its role is the only
   * evidence there will ever be — exactly the case the key is carried for.
   */
  test("a role the project marked not walkable carries the id, like any monitor-backed device", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "router",
      roleId: ROLE_ROW_ID,
      isSnmpWalkableRole: false,
    });

    expect(draft.networkDeviceRoleId).toBe(ROLE_ROW_ID);
    expect(draft.deviceRole).toBe("router");
  });

  test("a role the project marked walkable withholds the id, like any SNMP device", () => {
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

    expect(draft.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Monitor);
    expect(draft.networkDeviceRoleId).toBe(ROLE_ROW_ID);
    expect(draft.deviceRole).toBeUndefined();
  });
});

describe("the deprecated deviceRole string is unchanged by any of this", () => {
  test("the classified key is carried only for a monitor-backed device", () => {
    for (const role of ALL_BUILT_IN_ROLES) {
      const draft: NeighborAdoptionDraft = draftForPhone({
        ...PHONE,
        role: role,
      });

      expect(draft.deviceRole).toBe(
        historicalMethodFor(role) === NetworkDeviceMonitoringMethod.Monitor
          ? role
          : undefined,
      );
    }
  });

  /*
   * "unknown" is the absence of a role, not a role. Storing it as an override
   * would permanently disable the classifier on a device the operator was only
   * declining to classify — and a project marking that role not walkable must
   * not sneak it through the newly reachable monitor-backed branch.
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
