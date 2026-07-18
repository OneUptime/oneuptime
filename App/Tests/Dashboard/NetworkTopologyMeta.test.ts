import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  LINK_SATURATION_THRESHOLD_PERCENT,
  LINK_STATE_COLORS,
  describeEndpoint,
  edgeKeyForEdge,
  edgeStrokeWidthForEdge,
  formatMbps,
  formatUtilization,
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
