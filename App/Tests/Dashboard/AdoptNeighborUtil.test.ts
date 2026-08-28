import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { MAX_DEVICE_NAME_LENGTH } from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import {
  AdoptableNeighborLink,
  NeighborAdoptionDraft,
  buildNeighborAdoptionDraft,
  hostnameForNode,
  isAdoptableNode,
  managedLinksForNode,
  provenanceForLinks,
  unanimousId,
} from "../../FeatureSet/Dashboard/src/Components/Topology/AdoptNeighborUtil";

/*
 * Issue #3435. The topology map has always known about unmanaged neighbours —
 * an IP phone reported over CDP, an access point reported over LLDP — and the
 * only thing an operator could do with one was hide it. This module is what
 * "Add to Monitoring" pre-fills its form from, and every rule in it is a
 * judgement about somebody's network rather than a formatting detail:
 *
 *   - the NAME is what the map re-matches on, so decorating it silently
 *     splits one device into a floating new node plus a surviving stranger;
 *   - the HOSTNAME decides whether the flow is one click or a form;
 *   - the MONITORING METHOD decides whether the new device queues a walk it
 *     can only ever fail.
 *
 * The component around it cannot be rendered here (the App suite runs in a
 * plain Node environment), which is exactly why the decisions live in a pure
 * module and are asserted directly.
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

describe("isAdoptableNode", () => {
  test("an unmanaged discovery-protocol peer can be adopted", () => {
    expect(isAdoptableNode(PHONE)).toBe(true);
  });

  test("a device already under management cannot be adopted again", () => {
    expect(isAdoptableNode(SWITCH)).toBe(false);
  });

  /*
   * An endpoint is an ARP/FDB-learned host that already has a NetworkEndpoint
   * row of its own, keyed on its MAC. Creating a device beside one would draw
   * the same box on the map twice, because nothing about the adoption removes
   * the endpoint node.
   */
  test("a discovered endpoint is not adoptable through this flow", () => {
    expect(
      isAdoptableNode({
        id: "endpoint:abc",
        name: "POS terminal",
        isManaged: false,
        kind: "endpoint",
        status: "up",
        macAddress: "aa:bb:cc:dd:ee:ff",
        ipAddress: "10.0.4.9",
      }),
    ).toBe(false);
  });

  /*
   * Older payloads carry no `kind` at all; the wire type's own rule is to
   * read them as unmanaged when isManaged is false.
   */
  test("a payload with no kind is read as unmanaged, not skipped", () => {
    expect(
      isAdoptableNode({
        id: "unmanaged:ap-lobby",
        name: "ap-lobby",
        isManaged: false,
        status: "unknown",
      }),
    ).toBe(true);
  });
});

describe("managedLinksForNode", () => {
  test("collects the managed end of every cable, with both ports", () => {
    const links: Array<AdoptableNeighborLink> = managedLinksForNode(
      PHONE,
      [PHONE_EDGE],
      nodeMap(SWITCH, PHONE),
    );

    expect(links).toEqual([
      {
        deviceId: "switch-1",
        deviceName: "UN1289LANSWI01",
        devicePortName: "GigabitEthernet1/0/12",
        protocols: ["cdp"],
      },
    ]);
  });

  /*
   * A discovered edge always names the reporting switch first, but an
   * operator-declared one can be drawn either way round. Reading the wrong
   * end would attribute the switch's port to the phone and inherit a site
   * from the wrong device.
   */
  test("reads the port off the right end when the edge is reversed", () => {
    const links: Array<AdoptableNeighborLink> = managedLinksForNode(
      PHONE,
      [
        {
          fromNodeId: "unmanaged:sep6026aaf2b46b",
          toNodeId: "switch-1",
          fromPort: "SW PORT",
          toPort: "GigabitEthernet1/0/12",
          protocols: ["manual"],
        },
      ],
      nodeMap(SWITCH, PHONE),
    );

    expect(links[0]?.devicePortName).toBe("GigabitEthernet1/0/12");
  });

  test("ignores edges that do not touch this node", () => {
    expect(
      managedLinksForNode(
        PHONE,
        [{ fromNodeId: "switch-1", toNodeId: "switch-2" }],
        nodeMap(SWITCH, SECOND_SWITCH, PHONE),
      ),
    ).toEqual([]);
  });

  /*
   * A cable between two strangers is drawn on the map but has no row to
   * point at, so it can be neither inherited from nor recorded.
   */
  test("ignores a link to another unmanaged peer", () => {
    const otherPeer: NetworkTopologyNode = {
      id: "unmanaged:ap-lobby",
      name: "ap-lobby",
      isManaged: false,
      kind: "unmanaged",
      status: "unknown",
    };

    expect(
      managedLinksForNode(
        PHONE,
        [
          {
            fromNodeId: "unmanaged:ap-lobby",
            toNodeId: "unmanaged:sep6026aaf2b46b",
          },
        ],
        nodeMap(otherPeer, PHONE),
      ),
    ).toEqual([]);
  });

  test("ignores an end the payload does not carry", () => {
    expect(
      managedLinksForNode(
        PHONE,
        [{ fromNodeId: "ghost", toNodeId: "unmanaged:sep6026aaf2b46b" }],
        nodeMap(PHONE),
      ),
    ).toEqual([]);
  });
});

describe("hostnameForNode", () => {
  test("uses the management address the neighbours advertised", () => {
    expect(hostnameForNode(PHONE)).toBe("10.0.12.41");
  });

  /*
   * An advertised FQDN is an address as well as an identity, and it is what
   * an operator would type. It also keeps the map's re-match working, because
   * a hostname is one of the columns the topology builder matches on.
   */
  test("falls back to an advertised name that a resolver could answer for", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:dist-sw-02.example.com",
        name: "dist-sw-02.example.com",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("dist-sw-02.example.com");
  });

  test("accepts an advertised name that is itself an address", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:10.0.0.9",
        name: "10.0.0.9",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("10.0.0.9");
  });

  /*
   * The issue's own example. A phone's CDP device id is an identity and
   * nothing else — pre-filling it as an address would hand the probe
   * something guaranteed to fail, and hide the fact that the operator still
   * has to supply one.
   */
  test("leaves the address empty when the name is an identity, not an address", () => {
    expect(hostnameForNode({ ...PHONE, ipAddress: undefined })).toBe("");
  });

  test("refuses a platform string that happens to contain dots", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:x",
        name: "cisco WS-C3750X-48 v12.2",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("");
  });

  test("refuses a Cisco device id carrying its serial in brackets", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:x",
        name: "switch(FDO1234X5YZ)",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("");
  });

  /*
   * The trap the dotted-label rule alone walks straight into: Cisco gear
   * with no configured hostname reports its chassis MAC as the CDP device
   * id, in dotted-hex form. Every character of it is hostname-legal and it
   * resolves nowhere.
   */
  test("refuses a dotted-hex MAC, which is hostname-legal and resolves nowhere", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:x",
        name: "0060.5c15.3d02",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("");
  });

  test("refuses a partial address, whose last label is all digits", () => {
    expect(
      hostnameForNode({
        id: "unmanaged:x",
        name: "10.0.0",
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("");
  });

  /*
   * A name too long for the hostname column cannot be shortened the way the
   * device NAME is: a shortened name is still a label somebody can read,
   * and a shortened address is a different address.
   */
  test("refuses an advertised name too long for the hostname column", () => {
    const longFqdn: string = `${"a".repeat(95)}.example.com`;

    expect(
      hostnameForNode({
        id: "unmanaged:x",
        name: longFqdn,
        isManaged: false,
        kind: "unmanaged",
        status: "unknown",
      }),
    ).toBe("");
  });
});

describe("unanimousId", () => {
  test("agrees when every neighbour that has one says the same", () => {
    expect(unanimousId(["site-a", "site-a", undefined])).toBe("site-a");
  });

  /*
   * A device silently filed in the wrong site, or given a probe that cannot
   * reach it, is worse than a field the operator fills in themselves — the
   * second is visible and the first is not.
   */
  test("refuses to pick a side when the neighbours disagree", () => {
    expect(unanimousId(["site-a", "site-b"])).toBeUndefined();
  });

  test("has no answer when nothing is set", () => {
    expect(unanimousId([])).toBeUndefined();
    expect(unanimousId([undefined, undefined])).toBeUndefined();
  });
});

describe("provenanceForLinks", () => {
  test("names the protocol, the neighbour and the port", () => {
    expect(
      provenanceForLinks(
        managedLinksForNode(PHONE, [PHONE_EDGE], nodeMap(SWITCH, PHONE)),
      ),
    ).toBe(
      "Discovered by CDP as a neighbour of UN1289LANSWI01 (GigabitEthernet1/0/12).",
    );
  });

  test("names every neighbour when more than one reported the device", () => {
    const links: Array<AdoptableNeighborLink> = managedLinksForNode(
      PHONE,
      [
        PHONE_EDGE,
        {
          fromNodeId: "switch-2",
          toNodeId: "unmanaged:sep6026aaf2b46b",
          protocols: ["lldp"],
        },
      ],
      nodeMap(SWITCH, SECOND_SWITCH, PHONE),
    );

    expect(provenanceForLinks(links)).toBe(
      "Discovered by CDP and LLDP as a neighbour of UN1289LANSWI01 (GigabitEthernet1/0/12), UN1289LANSWI02.",
    );
  });

  test("says something true even for a peer with no managed neighbour left", () => {
    expect(provenanceForLinks([])).toBe("Discovered on the network map.");
  });
});

describe("buildNeighborAdoptionDraft", () => {
  /*
   * THE load-bearing assertion of this file. The topology builder re-matches
   * a neighbour report to a managed device by comparing the advertised string
   * against the device's name and hostname after nothing more forgiving than
   * trim-and-lowercase. Any decoration here — a suffix, a parenthesised
   * address, a "cleanup" — permanently splits the map into a floating new
   * device plus a surviving stranger.
   */
  test("copies the advertised name verbatim", () => {
    expect(draftForPhone().name).toBe("SEP6026AAF2B46B");
  });

  test("pre-fills the hostname from the advertised address", () => {
    expect(draftForPhone().hostname).toBe("10.0.12.41");
  });

  test("carries the classified role across to a device nothing will walk", () => {
    expect(draftForPhone().deviceRole).toBe("phone");
  });

  /*
   * "unknown" is not a role, it is the absence of one, and storing it as a
   * deviceRole override would permanently disable the classifier on a device
   * the operator was only declining to classify.
   */
  test("does not offer an unknown role as an override", () => {
    expect(draftForPhone({ ...PHONE, role: "unknown" }).deviceRole).toBe(
      undefined,
    );
    expect(draftForPhone({ ...PHONE, role: undefined }).deviceRole).toBe(
      undefined,
    );
  });

  /*
   * `deviceRole` is an OVERRIDE, not a hint: once set, the topology builder
   * returns it and never classifies that device again. The role here was
   * inferred from a peer's advertised NAME — for an LLDP-only peer that is a
   * hostname convention and nothing more, so a Catalyst access switch called
   * "gw-floor3-sw2" arrives classified as a router. Writing that onto a
   * device the probe is about to walk would permanently outrank the sysDescr
   * that would have answered correctly.
   */
  test("does not pre-empt the classifier on a device the probe will walk", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      role: "router",
    });

    expect(draft.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Snmp);
    expect(draft.deviceRole).toBeUndefined();
  });

  /*
   * The platform string cannot be written to deviceModel at create time
   * (the column has no create ACL), so the description is its only home
   * until the probe walks the device itself. Losing it would throw away the
   * most specific thing anybody knows about the box.
   */
  test("keeps the platform string and the provenance in the description", () => {
    expect(draftForPhone().description).toBe(
      "Cisco IP Phone 8811. Discovered by CDP as a neighbour of UN1289LANSWI01 (GigabitEthernet1/0/12).",
    );
  });

  test("describes a peer that advertised no platform without a stray full stop", () => {
    expect(
      draftForPhone({ ...PHONE, deviceModel: undefined }).description,
    ).toBe(
      "Discovered by CDP as a neighbour of UN1289LANSWI01 (GigabitEthernet1/0/12).",
    );
  });

  /*
   * A desk phone is never SNMP-walkable. Defaulting it to SNMP would create
   * a device that queues a walk it can only fail and then reads "pending"
   * forever, with the operator hunting a credential that was never the
   * problem.
   */
  test("a leaf device defaults to monitor-backed rather than SNMP", () => {
    expect(draftForPhone().monitoringMethod).toBe(
      NetworkDeviceMonitoringMethod.Monitor,
    );

    for (const role of ["printer", "camera", "host"] as const) {
      expect(draftForPhone({ ...PHONE, role: role }).monitoringMethod).toBe(
        NetworkDeviceMonitoringMethod.Monitor,
      );
    }
  });

  /*
   * And the other way: an unidentified box hanging off a switch port is far
   * more often a switch nobody has added yet than it is a kiosk, so an
   * unclassified peer defaults to the product's primary path.
   */
  test("infrastructure and unclassified peers default to SNMP", () => {
    for (const role of [
      "switch",
      "router",
      "firewall",
      "wirelessAccessPoint",
      undefined,
    ] as const) {
      expect(draftForPhone({ ...PHONE, role: role }).monitoringMethod).toBe(
        NetworkDeviceMonitoringMethod.Snmp,
      );
    }
  });

  test("carries the links so the form can inherit a site and a probe", () => {
    expect(draftForPhone().links).toHaveLength(1);
    expect(draftForPhone().links[0]?.deviceId).toBe("switch-1");
  });

  /*
   * The whole flow degrades to "a form with three fields filled in" whenever
   * no address was advertised, which is common — lldpRemManAddrTable is
   * optional and cdpCacheAddress is frequently empty. Saying so up front is
   * the difference between a form the operator understands and one that
   * looks broken.
   */
  test("warns when the operator will have to supply an address", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      ipAddress: undefined,
    });

    expect(draft.hostname).toBe("");
    expect(draft.warnings.join(" ")).toContain("No management address");
  });

  test("says nothing alarming when everything was discovered", () => {
    expect(draftForPhone().warnings).toEqual([]);
  });

  /*
   * A name too long to store cannot be copied verbatim, so the one guarantee
   * this module makes is broken — and the operator has to be told, because
   * the consequence (a stranger that never collapses) shows up on the map
   * rather than in the form.
   */
  test("shortens an over-long advertised name and admits it", () => {
    const longName: string = "a".repeat(MAX_DEVICE_NAME_LENGTH + 20);

    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      name: longName,
    });

    expect(draft.name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
    expect(draft.warnings.join(" ")).toContain("too long to store");
  });

  test("truncates a description that would overflow the column", () => {
    const draft: NeighborAdoptionDraft = draftForPhone({
      ...PHONE,
      deviceModel: "x".repeat(900),
    });

    expect(draft.description.length).toBeLessThanOrEqual(500);
  });
});
