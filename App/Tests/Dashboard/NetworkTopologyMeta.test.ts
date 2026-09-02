import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyLinkProtocol,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  LINK_SATURATION_THRESHOLD_PERCENT,
  LINK_STATE_COLORS,
  TOPOLOGY_LEGEND,
  TopologyLegendEntry,
  accessibleLabelForEdge,
  accessibleLabelForNode,
  buildTopologyLegend,
  describeEndpoint,
  edgeKeyForEdge,
  edgeStrokeWidthForEdge,
  formatMbps,
  formatUtilization,
  isolationReasonForNode,
  linkStateForEdge,
  maxUtilizationForEdge,
  nodeMatchesSearch,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";

/*
 * Complements TopologyLayout.test.ts, which already pins the headline
 * link-state precedence (down beats saturated beats healthy, unknown
 * without data), the 80%-either-end saturation trigger, the 1.5px default /
 * 5px max stroke, and case-insensitive search across name/sysName/vendor.
 * This file covers the rest of the surface: max-utilization selection,
 * classification edge cases, clamping, edge keys, search trimming, and the
 * tooltip formatting helpers.
 */

const baseEdge: NetworkTopologyEdge = {
  fromNodeId: "a",
  toNodeId: "b",
};

function edgeWith(
  fromInterface?: NetworkTopologyEdgeEndpoint,
  toInterface?: NetworkTopologyEdgeEndpoint,
): NetworkTopologyEdge {
  return { ...baseEdge, fromInterface, toInterface };
}

describe("maxUtilizationForEdge", () => {
  test("returns the busier of the two ends", () => {
    expect(
      maxUtilizationForEdge(
        edgeWith({ utilizationPercent: 30 }, { utilizationPercent: 70 }),
      ),
    ).toBe(70);
  });

  test("works when only the to-end reports utilization", () => {
    expect(
      maxUtilizationForEdge(edgeWith(undefined, { utilizationPercent: 55 })),
    ).toBe(55);
  });

  test("treats 0% as real data, not as missing", () => {
    expect(maxUtilizationForEdge(edgeWith({ utilizationPercent: 0 }))).toBe(0);
  });

  test("ignores an end without utilization instead of clobbering the max", () => {
    expect(
      maxUtilizationForEdge(
        edgeWith({ utilizationPercent: 45 }, { isOperationallyUp: true }),
      ),
    ).toBe(45);
  });

  test("is undefined when endpoints exist but neither reports utilization", () => {
    expect(
      maxUtilizationForEdge(
        edgeWith({ isOperationallyUp: true }, { isOperationallyUp: true }),
      ),
    ).toBeUndefined();
  });
});

describe("isolationReasonForNode", () => {
  const isolatedDevice: (
    diagnostics: NetworkTopologyNode["diagnostics"],
  ) => NetworkTopologyNode = (
    diagnostics: NetworkTopologyNode["diagnostics"],
  ): NetworkTopologyNode => {
    return {
      id: "d1",
      name: "core-rtr-1",
      isManaged: true,
      kind: "device",
      status: "up",
      diagnostics: diagnostics,
    };
  };

  test("a device with links needs no explanation", () => {
    expect(
      isolationReasonForNode(
        isolatedDevice({
          reportedNeighborCount: 0,
          unmatchedNeighborIdentifiers: [],
        }),
        true,
      ),
    ).toBeUndefined();
  });

  test("discovery being off explains everything downstream of it", () => {
    /*
     * Checked first on purpose: a device whose interface walk is off also
     * reports zero neighbours, and "it reported nothing" would send the
     * operator looking at the wrong setting.
     */
    const reason: string | undefined = isolationReasonForNode(
      isolatedDevice({
        isNeighborDiscoveryEnabled: false,
        reportedNeighborCount: 0,
        unmatchedNeighborIdentifiers: [],
      }),
      false,
    );
    expect(reason).toContain("Neighbour discovery never ran");
    expect(reason).toContain("interface monitoring");
  });

  test("a device that reported nothing says so, and offers the manual route", () => {
    const reason: string | undefined = isolationReasonForNode(
      isolatedDevice({
        isNeighborDiscoveryEnabled: true,
        reportedNeighborCount: 0,
        unmatchedNeighborIdentifiers: [],
      }),
      false,
    );
    expect(reason).toContain("reported no LLDP or CDP neighbours");
    expect(reason).toContain("Device Links");
  });

  test("names the neighbours that matched nothing — the actionable case", () => {
    const reason: string | undefined = isolationReasonForNode(
      isolatedDevice({
        isNeighborDiscoveryEnabled: true,
        reportedNeighborCount: 2,
        unmatchedNeighborIdentifiers: ["OLD-CORE-SW1", "ap-lobby"],
      }),
      false,
    );
    expect(reason).toContain("OLD-CORE-SW1");
    expect(reason).toContain("ap-lobby");
    expect(reason).toContain("renamed");
  });

  test("caps the list rather than pasting fifty identifiers into a panel", () => {
    const reason: string | undefined = isolationReasonForNode(
      isolatedDevice({
        isNeighborDiscoveryEnabled: true,
        reportedNeighborCount: 8,
        unmatchedNeighborIdentifiers: [
          "n1",
          "n2",
          "n3",
          "n4",
          "n5",
          "n6",
          "n7",
          "n8",
        ],
      }),
      false,
    );
    expect(reason).toContain("n5");
    expect(reason).not.toContain("n6");
    expect(reason).toContain("and 3 more");
  });

  test("says nothing about an unmanaged peer or an old payload", () => {
    expect(
      isolationReasonForNode(
        {
          id: "unmanaged:x",
          name: "x",
          isManaged: false,
          kind: "unmanaged",
          status: "unknown",
        },
        false,
      ),
    ).toBeUndefined();
    // No diagnostics at all — a payload from before this shipped.
    expect(
      isolationReasonForNode(isolatedDevice(undefined), false),
    ).toBeUndefined();
  });
});

describe("linkStateForEdge — a manual link's bound monitor", () => {
  /*
   * A hand-drawn link has no interface counters of its own, so a Monitor is
   * the only thing that knows anything about it. It is read LAST, though:
   * measured state beats a monitor's summary of it, and a monitor watching
   * the pair end-to-end can report "up" while one specific port between them
   * is down.
   */
  test("colors a link that nothing else measures", () => {
    expect(
      linkStateForEdge({
        fromNodeId: "d1",
        toNodeId: "d2",
        protocols: ["manual"],
        monitorState: "down",
      }),
    ).toBe("down");
    expect(
      linkStateForEdge({
        fromNodeId: "d1",
        toNodeId: "d2",
        protocols: ["manual"],
        monitorState: "up",
      }),
    ).toBe("healthy");
  });

  test("never overrides a measured interface state", () => {
    const edge: NetworkTopologyEdge = edgeWith({ isOperationallyUp: false });
    edge.monitorState = "up";
    expect(linkStateForEdge(edge)).toBe("down");

    const busy: NetworkTopologyEdge = edgeWith({ utilizationPercent: 95 });
    busy.monitorState = "up";
    expect(linkStateForEdge(busy)).toBe("saturated");
  });

  test("a link with neither counters nor a monitor stays unknown", () => {
    expect(
      linkStateForEdge({
        fromNodeId: "d1",
        toNodeId: "d2",
        protocols: ["manual"],
      }),
    ).toBe("unknown");
  });
});

describe("linkStateForEdge — classification edge cases", () => {
  test("saturation threshold is 80%", () => {
    expect(LINK_SATURATION_THRESHOLD_PERCENT).toBe(80);
  });

  test("down when only the to-end is operationally down", () => {
    expect(
      linkStateForEdge(
        edgeWith({ isOperationallyUp: true }, { isOperationallyUp: false }),
      ),
    ).toBe("down");
  });

  test("an undefined isOperationallyUp does not count as down", () => {
    expect(
      linkStateForEdge(
        edgeWith({ isOperationallyUp: undefined, utilizationPercent: 10 }),
      ),
    ).toBe("healthy");
  });

  test("just below the threshold is healthy, not saturated", () => {
    expect(linkStateForEdge(edgeWith({ utilizationPercent: 79.9 }))).toBe(
      "healthy",
    );
  });

  test("an idle link at 0% utilization is healthy", () => {
    expect(linkStateForEdge(edgeWith({ utilizationPercent: 0 }))).toBe(
      "healthy",
    );
  });

  test("rate-only data (no utilization, no oper status) still reads healthy", () => {
    expect(linkStateForEdge(edgeWith({ inRateMbps: 0, outRateMbps: 0 }))).toBe(
      "healthy",
    );
  });

  test("endpoint objects with every field undefined stay unknown", () => {
    expect(linkStateForEdge(edgeWith({}, {}))).toBe("unknown");
  });
});

describe("edgeStrokeWidthForEdge — scaling and clamping", () => {
  test("0% utilization draws at the 1.5px base width", () => {
    expect(edgeStrokeWidthForEdge(edgeWith({ utilizationPercent: 0 }))).toBe(
      1.5,
    );
  });

  test("50% utilization lands exactly halfway up the ramp", () => {
    expect(edgeStrokeWidthForEdge(edgeWith({ utilizationPercent: 50 }))).toBe(
      3.25,
    );
  });

  test("utilization above 100% clamps to the 5px maximum", () => {
    expect(edgeStrokeWidthForEdge(edgeWith({ utilizationPercent: 250 }))).toBe(
      5,
    );
  });

  test("negative utilization clamps to the base width", () => {
    expect(edgeStrokeWidthForEdge(edgeWith({ utilizationPercent: -20 }))).toBe(
      1.5,
    );
  });

  test("scales by the busier end", () => {
    expect(
      edgeStrokeWidthForEdge(
        edgeWith({ utilizationPercent: 20 }, { utilizationPercent: 100 }),
      ),
    ).toBe(5);
  });
});

describe("LINK_STATE_COLORS", () => {
  test("down and saturated are fixed semantic colors", () => {
    expect(LINK_STATE_COLORS.down).toBe("#dc2626");
    expect(LINK_STATE_COLORS.saturated).toBe("#f59e0b");
  });

  test("healthy and unknown defer to theme variables so dark mode works", () => {
    expect(LINK_STATE_COLORS.healthy).toContain("var(--");
    expect(LINK_STATE_COLORS.unknown).toContain("var(--");
  });
});

describe("edgeKeyForEdge", () => {
  test("is stable regardless of edge direction", () => {
    const forward: NetworkTopologyEdge = { fromNodeId: "a", toNodeId: "b" };
    const reverse: NetworkTopologyEdge = { fromNodeId: "b", toNodeId: "a" };

    expect(edgeKeyForEdge(forward)).toBe("a::b");
    expect(edgeKeyForEdge(reverse)).toBe(edgeKeyForEdge(forward));
  });

  test("distinct pairs get distinct keys", () => {
    expect(edgeKeyForEdge({ fromNodeId: "a", toNodeId: "b" })).not.toBe(
      edgeKeyForEdge({ fromNodeId: "a", toNodeId: "c" }),
    );
  });
});

describe("nodeMatchesSearch — trimming and missing fields", () => {
  const sparseNode: NetworkTopologyNode = {
    id: "unmanaged:ap-lobby-01",
    name: "ap-lobby-01",
    isManaged: false,
    status: "unknown",
  };

  test("whitespace-only search matches everything", () => {
    expect(nodeMatchesSearch(sparseNode, "   ")).toBe(true);
  });

  test("surrounding whitespace in the query is trimmed before matching", () => {
    expect(nodeMatchesSearch(sparseNode, "  LOBBY  ")).toBe(true);
  });

  test("a node without sysName or vendor neither crashes nor false-matches", () => {
    expect(nodeMatchesSearch(sparseNode, "cisco")).toBe(false);
  });

  test("the node id is not part of the searchable text", () => {
    expect(nodeMatchesSearch(sparseNode, "unmanaged:")).toBe(false);
  });
});

describe("formatMbps", () => {
  test("renders a dash for missing data", () => {
    expect(formatMbps(undefined)).toBe("—");
  });

  test("keeps one decimal below 10 Mbps, including zero", () => {
    expect(formatMbps(0)).toBe("0.0 Mbps");
    expect(formatMbps(2.5)).toBe("2.5 Mbps");
  });

  test("rounds to whole Mbps from 10 up", () => {
    expect(formatMbps(10)).toBe("10 Mbps");
    expect(formatMbps(999.4)).toBe("999 Mbps");
  });

  test("stays in Mbps just under the Gbps cutover, even when rounding hits 1000", () => {
    // The >= 1000 tier check runs on the raw value, before rounding.
    expect(formatMbps(999.6)).toBe("1000 Mbps");
  });

  test("switches to Gbps with two decimals from 1000 Mbps", () => {
    expect(formatMbps(1000)).toBe("1.00 Gbps");
    expect(formatMbps(1500)).toBe("1.50 Gbps");
    expect(formatMbps(100000)).toBe("100.00 Gbps");
  });
});

describe("formatUtilization", () => {
  test("renders a dash for missing data", () => {
    expect(formatUtilization(undefined)).toBe("—");
  });

  test("renders zero as 0%", () => {
    expect(formatUtilization(0)).toBe("0%");
  });

  test("rounds to whole percent", () => {
    expect(formatUtilization(84.4)).toBe("84%");
    expect(formatUtilization(99.5)).toBe("100%");
  });
});

describe("describeEndpoint", () => {
  test("falls back to the port label when there is no endpoint data", () => {
    expect(describeEndpoint(undefined, "Gi0/2")).toBe("Gi0/2");
  });

  test("falls back to ? when nothing identifies the end", () => {
    expect(describeEndpoint(undefined, undefined)).toBe("?");
  });

  test("names an endpoint by if<n> when only the index is known", () => {
    expect(describeEndpoint({ interfaceIndex: 7 }, undefined)).toBe("if7");
  });

  test("prefers the port label over the if<n> fallback", () => {
    expect(describeEndpoint({ interfaceIndex: 3 }, "Gi0/3")).toBe("Gi0/3");
  });

  test("prefers the real interface name over the port label", () => {
    expect(describeEndpoint({ interfaceName: "xe-0/0/7" }, "stale-label")).toBe(
      "xe-0/0/7",
    );
  });

  test("renders the full tooltip line for a down, busy interface", () => {
    expect(
      describeEndpoint(
        {
          interfaceName: "Gi0/1",
          isOperationallyUp: false,
          utilizationPercent: 84,
          inRateMbps: 12,
          outRateMbps: 3,
        },
        undefined,
      ),
    ).toBe("Gi0/1 · down · 84% · ↓12 Mbps ↑3.0 Mbps");
  });

  test("omits the down marker for an operationally up interface", () => {
    expect(
      describeEndpoint(
        { interfaceName: "Gi0/1", isOperationallyUp: true },
        undefined,
      ),
    ).toBe("Gi0/1");
  });

  test("includes 0% utilization instead of dropping it as falsy", () => {
    expect(
      describeEndpoint(
        { interfaceName: "Gi0/1", utilizationPercent: 0 },
        undefined,
      ),
    ).toBe("Gi0/1 · 0%");
  });

  test("shows a dash for the missing direction when only one rate is known", () => {
    expect(
      describeEndpoint({ interfaceName: "Gi0/1", inRateMbps: 5 }, undefined),
    ).toBe("Gi0/1 · ↓5.0 Mbps ↑—");
  });
});

const deviceNode: (
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode = (
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: "d1",
    name: "core-1",
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
};

describe("nodeMatchesSearch — by role", () => {
  test("a role name matches every node of that role", () => {
    expect(nodeMatchesSearch(deviceNode({ role: "switch" }), "switch")).toBe(
      true,
    );
    expect(nodeMatchesSearch(deviceNode({ role: "router" }), "switch")).toBe(
      false,
    );
  });

  test("role search is case-insensitive and matches partially", () => {
    const balancer: NetworkTopologyNode = deviceNode({ role: "loadBalancer" });
    expect(nodeMatchesSearch(balancer, "LOAD")).toBe(true);
    expect(nodeMatchesSearch(balancer, "balancer")).toBe(true);
  });

  test("the display name is matched, not the internal role key", () => {
    const wireless: NetworkTopologyNode = deviceNode({
      role: "wirelessAccessPoint",
    });
    expect(nodeMatchesSearch(wireless, "Wireless AP")).toBe(true);
    expect(nodeMatchesSearch(wireless, "accesspoint")).toBe(false);
  });

  test("searching a role never lights up everything we failed to classify", () => {
    // "Unknown type" must not be a searchable label.
    expect(nodeMatchesSearch(deviceNode({ role: "unknown" }), "unknown")).toBe(
      false,
    );
    expect(nodeMatchesSearch(deviceNode(), "unknown type")).toBe(false);
  });

  test("identity search still works alongside it", () => {
    const node: NetworkTopologyNode = deviceNode({
      name: "core-1",
      sysName: "core-1.example.com",
      vendor: "Cisco",
      role: "switch",
    });
    expect(nodeMatchesSearch(node, "core")).toBe(true);
    expect(nodeMatchesSearch(node, "cisco")).toBe(true);
    expect(nodeMatchesSearch(node, "example.com")).toBe(true);
    expect(nodeMatchesSearch(node, "")).toBe(true);
  });
});

describe("nodeMatchesSearch — by MAC and address", () => {
  /*
   * Issue #3489. These used to be reachable by accident: an unclassified
   * endpoint leaf was NAMED after its address, so searching the address
   * found the name. Endpoint inference replaces that leaf with the device's
   * own name, and the address an operator is holding on a ticket would
   * otherwise stop finding anything at all.
   */
  const till: NetworkTopologyNode = deviceNode({
    id: "device-till-01",
    name: "till-01",
    macAddress: "aa:bb:cc:dd:ee:ff",
    ipAddress: "10.14.3.22",
  });

  test("the MAC from the forwarding database is searchable", () => {
    expect(nodeMatchesSearch(till, "aa:bb:cc:dd:ee:ff")).toBe(true);
    // Partially, because nobody types a whole MAC to find one device.
    expect(nodeMatchesSearch(till, "dd:ee:ff")).toBe(true);
  });

  test("the MAC search is case-insensitive, because vendors disagree", () => {
    expect(nodeMatchesSearch(till, "AA:BB:CC:DD:EE:FF")).toBe(true);
    expect(
      nodeMatchesSearch(
        deviceNode({ macAddress: "AA:BB:CC:DD:EE:FF" }),
        "aa:bb",
      ),
    ).toBe(true);
  });

  test("the ARP-joined address is searchable", () => {
    expect(nodeMatchesSearch(till, "10.14.3.22")).toBe(true);
    expect(nodeMatchesSearch(till, "10.14.3.")).toBe(true);
  });

  test("a device carrying neither does not answer to somebody else's address", () => {
    expect(nodeMatchesSearch(deviceNode(), "10.14.3.22")).toBe(false);
    expect(nodeMatchesSearch(till, "10.14.3.23")).toBe(false);
    expect(nodeMatchesSearch(till, "aa:bb:cc:dd:ee:00")).toBe(false);
  });

  test("an endpoint leaf is still found the same way", () => {
    // The old leaf and the new device node answer to the same query.
    expect(
      nodeMatchesSearch(
        {
          id: "endpoint:aabbccddeeff",
          name: "10.14.3.22",
          isManaged: false,
          status: "unknown",
          kind: "endpoint",
          macAddress: "aa:bb:cc:dd:ee:ff",
          ipAddress: "10.14.3.22",
        },
        "10.14.3.22",
      ),
    ).toBe(true);
  });
});

describe("accessibleLabelForEdge — inferred uplinks", () => {
  function uplink(protocols: Array<NetworkTopologyLinkProtocol>): string {
    return accessibleLabelForEdge(
      { fromNodeId: "d1", toNodeId: "d2", protocols: protocols },
      "core-1",
      "till-01",
    );
  }

  test("an inferred link never says 'reported by' — nothing reported it", () => {
    /*
     * Issue #3489, and the one verb that must not be used here: a keyboard
     * user gets this string and nothing else, so "reported by FDB" would
     * present a join across two SNMP tables as a device's own testimony.
     */
    const label: string = uplink(["fdb", "inferred"]);
    expect(label).not.toContain("reported by");
    expect(label).toBe(
      "Link from core-1 to till-01, no operational data, inferred from the forwarding database",
    );
  });

  test("the evidence protocol is folded into the clause, not listed beside it", () => {
    // "reported by FDB and INFERRED" is the sentence this avoids.
    expect(uplink(["fdb", "inferred"])).not.toContain("INFERRED");
    expect(uplink(["fdb", "inferred"])).not.toContain("FDB");
  });

  test("a hand-drawn link an inference later agreed with still reports the manual part", () => {
    /*
     * An operator who drew this cable must still hear that they drew it —
     * the inference riding along does not un-declare it.
     */
    expect(uplink(["manual", "fdb", "inferred"])).toBe(
      "Link from core-1 to till-01, no operational data, reported by MANUAL, inferred from the forwarding database",
    );
  });

  test("a plain FDB attachment is still reported, because it was", () => {
    // "fdb" is only swallowed when it is the inference's own evidence.
    expect(uplink(["fdb"])).toBe(
      "Link from core-1 to till-01, no operational data, reported by FDB",
    );
  });

  test("discovery-protocol links are untouched", () => {
    /*
     * The conjunction is uppercased along with the protocol names, which
     * predates issue #3489 — the clause is built by uppercasing the joined
     * string. A screen reader says "and" either way, so it is pinned as it
     * is rather than quietly changed under a feature that does not own it.
     */
    expect(uplink(["lldp", "cdp"])).toBe(
      "Link from core-1 to till-01, no operational data, reported by LLDP AND CDP",
    );
    expect(uplink(["lldp", "cdp"])).not.toContain("inferred");
  });

  test("an inferred link that is measurably down says so before saying it was inferred", () => {
    /*
     * State leads, because "an end is down" is the thing being listened
     * for. Provenance is the qualifier on it.
     */
    expect(
      accessibleLabelForEdge(
        {
          fromNodeId: "d1",
          toNodeId: "d2",
          protocols: ["fdb", "inferred"],
          fromInterface: { isOperationallyUp: false, utilizationPercent: 12 },
        },
        "core-1",
        "till-01",
      ),
    ).toBe(
      "Link from core-1 to till-01, an end is down, 12% utilization, inferred from the forwarding database",
    );
  });

  test("falls back to node ids when the map has no names for the ends", () => {
    expect(
      accessibleLabelForEdge(
        { fromNodeId: "d1", toNodeId: "d2", protocols: ["fdb", "inferred"] },
        undefined,
        undefined,
      ),
    ).toBe(
      "Link from d1 to d2, no operational data, inferred from the forwarding database",
    );
  });

  test("a legacy edge with no protocols at all announces no provenance", () => {
    expect(
      accessibleLabelForEdge(
        { fromNodeId: "d1", toNodeId: "d2" },
        "core-1",
        "till-01",
      ),
    ).toBe("Link from core-1 to till-01, no operational data");
  });

  test("'inferred' on its own reads the same, not as an empty 'reported by'", () => {
    /*
     * The evidence protocol is the inference's own doing, so an edge that
     * arrives carrying only "inferred" must not produce a dangling
     * "reported by " with nothing after it.
     */
    expect(uplink(["inferred"])).toBe(
      "Link from core-1 to till-01, no operational data, inferred from the forwarding database",
    );
  });

  test("an LLDP link an inference agreed with still credits LLDP", () => {
    /*
     * Only "fdb" is swallowed, and only because it is the evidence. A
     * protocol that genuinely reported the cable keeps its credit.
     */
    expect(uplink(["lldp", "inferred"])).toBe(
      "Link from core-1 to till-01, no operational data, reported by LLDP, inferred from the forwarding database",
    );
  });
});

describe("accessibleLabelForNode — roles", () => {
  test("the role is announced, because the shape cannot be", () => {
    expect(
      accessibleLabelForNode(
        deviceNode({ role: "firewall", vendor: "Palo Alto" }),
      ),
    ).toBe("core-1, firewall, managed device, status up, Palo Alto");
  });

  test("an unclassified device announces exactly what it always did", () => {
    expect(accessibleLabelForNode(deviceNode())).toBe(
      "core-1, managed device, status up",
    );
  });

  test("a plain endpoint host does not say 'host, endpoint'", () => {
    expect(
      accessibleLabelForNode({
        id: "endpoint:e1",
        name: "pos-1",
        isManaged: false,
        status: "unknown",
        kind: "endpoint",
        role: "host",
        ipAddress: "10.0.0.5",
      }),
    ).toBe("pos-1, endpoint, 10.0.0.5");
  });

  test("an endpoint with a real role announces it", () => {
    expect(
      accessibleLabelForNode({
        id: "endpoint:e2",
        name: "cam-1",
        isManaged: false,
        status: "unknown",
        kind: "endpoint",
        role: "camera",
        vlanId: 12,
      }),
    ).toBe("cam-1, camera, endpoint, VLAN 12");
  });
});

describe("buildTopologyLegend", () => {
  const labelsOf: (
    entries: Array<TopologyLegendEntry>,
    group: string,
  ) => Array<string> = (
    entries: Array<TopologyLegendEntry>,
    group: string,
  ): Array<string> => {
    return entries
      .filter((entry: TopologyLegendEntry) => {
        return entry.group === group;
      })
      .map((entry: TopologyLegendEntry) => {
        return entry.label;
      });
  };

  test("an unclassified graph gets no type entries at all", () => {
    expect(buildTopologyLegend([deviceNode()])).toEqual(TOPOLOGY_LEGEND);
    expect(buildTopologyLegend([])).toEqual(TOPOLOGY_LEGEND);
    expect(buildTopologyLegend(undefined)).toEqual(TOPOLOGY_LEGEND);
  });

  test("only the types actually on the map are explained", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ id: "d1", role: "switch" }),
      deviceNode({ id: "d2", role: "router" }),
      deviceNode({ id: "d3", role: "unknown" }),
    ]);
    expect(labelsOf(legend, "Type")).toEqual(["Router", "Switch"]);
  });

  test("a type present many times is listed once", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ id: "d1", role: "switch" }),
      deviceNode({ id: "d2", role: "switch" }),
      deviceNode({ id: "d3", role: "switch" }),
    ]);
    expect(labelsOf(legend, "Type")).toEqual(["Switch"]);
  });

  test("the order is fixed, not encounter order — a poll must not reshuffle the key", () => {
    const forward: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ id: "d1", role: "storage" }),
      deviceNode({ id: "d2", role: "router" }),
      deviceNode({ id: "d3", role: "firewall" }),
    ]);
    const reversed: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ id: "d3", role: "firewall" }),
      deviceNode({ id: "d2", role: "router" }),
      deviceNode({ id: "d1", role: "storage" }),
    ]);
    expect(labelsOf(forward, "Type")).toEqual([
      "Router",
      "Firewall",
      "Storage",
    ]);
    expect(labelsOf(reversed, "Type")).toEqual(labelsOf(forward, "Type"));
  });

  test("every type entry carries the silhouette its nodes are drawn with", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ id: "d1", role: "switch" }),
      deviceNode({ id: "d2", role: "firewall" }),
      deviceNode({ id: "d3", role: "storage" }),
    ]);
    const shapes: Record<string, string | undefined> = {};
    for (const entry of legend) {
      if (entry.group === "Type") {
        shapes[entry.label] = entry.shape;
      }
    }
    expect(shapes["Switch"]).toBe("rounded-square");
    expect(shapes["Firewall"]).toBe("diamond");
    expect(shapes["Storage"]).toBe("cylinder");
  });

  test("the status, kind and link entries are never disturbed", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode({ role: "switch" }),
    ]);
    expect(legend.slice(0, TOPOLOGY_LEGEND.length)).toEqual(TOPOLOGY_LEGEND);
    expect(labelsOf(legend, "Status")).toEqual(["Up", "Down", "Unknown"]);
  });

  test("the inferred uplink is its own key entry, drawn unlike the FDB one", () => {
    /*
     * Issue #3489. Both lines come out of the forwarding database, but one
     * runs to an anonymous MAC on a port and the other is a cable between
     * two devices the project manages — and the canvas already draws them
     * with different strokes. Two key rows sharing a swatch and a colour
     * under two labels would be a key that cannot be read.
     */
    const link: Array<TopologyLegendEntry> = buildTopologyLegend([
      deviceNode(),
    ]).filter((entry: TopologyLegendEntry) => {
      return entry.group === "Link";
    });

    expect(
      link.map((entry: TopologyLegendEntry) => {
        return entry.label;
      }),
    ).toContain("Inferred uplink");

    const inferred: TopologyLegendEntry = link.find(
      (entry: TopologyLegendEntry) => {
        return entry.label === "Inferred uplink";
      },
    )!;
    const learned: TopologyLegendEntry = link.find(
      (entry: TopologyLegendEntry) => {
        return entry.label === "Learned from FDB";
      },
    )!;

    expect(inferred.swatch).toBe("dotted-line");
    expect(inferred.swatch).not.toBe(learned.swatch);
  });

  test("endpoints without a role are listed as hosts", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      {
        id: "endpoint:e1",
        name: "pos-1",
        isManaged: false,
        status: "unknown",
        kind: "endpoint",
      },
    ]);
    expect(labelsOf(legend, "Type")).toEqual(["Host"]);
  });

  test("malformed entries in the node list do not break the key", () => {
    const legend: Array<TopologyLegendEntry> = buildTopologyLegend([
      undefined as unknown as NetworkTopologyNode,
      deviceNode({ role: "router" }),
    ]);
    expect(labelsOf(legend, "Type")).toEqual(["Router"]);
  });
});
