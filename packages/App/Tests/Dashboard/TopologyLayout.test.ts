import { describe, expect, test } from "@jest/globals";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkTopologyUtil, {
  TopologyDeviceInput,
  TopologyInterfaceInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";
import { computeTopologyLayout } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import {
  edgeStrokeWidthForEdge,
  linkStateForEdge,
  maxUtilizationForEdge,
  nodeMatchesSearch,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";

const WIDTH: number = 1000;
const HEIGHT: number = 700;
const MARGIN: number = 48;

const sampleNodes: Array<NetworkTopologyNode> = [
  { id: "a", name: "Core Switch", isManaged: true, status: "up" },
  { id: "b", name: "Edge Router", isManaged: true, status: "down" },
  {
    id: "unmanaged:c",
    name: "Unknown Peer",
    isManaged: false,
    status: "unknown",
  },
];

const sampleEdges: Array<NetworkTopologyEdge> = [
  { fromNodeId: "a", toNodeId: "b" },
  { fromNodeId: "b", toNodeId: "unmanaged:c" },
];

describe("computeTopologyLayout", () => {
  test("returns finite, in-bounds coordinates for a 3-node/2-edge sample", () => {
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );

    expect(layout.size).toBe(3);

    for (const node of sampleNodes) {
      const point: { x: number; y: number } | undefined = layout.get(node.id);
      expect(point).toBeDefined();
      expect(Number.isFinite(point!.x)).toBe(true);
      expect(Number.isFinite(point!.y)).toBe(true);
      expect(point!.x).toBeGreaterThanOrEqual(MARGIN);
      expect(point!.x).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(point!.y).toBeGreaterThanOrEqual(MARGIN);
      expect(point!.y).toBeLessThanOrEqual(HEIGHT - MARGIN);
    }
  });

  test("is deterministic — identical inputs yield identical coordinates", () => {
    const first: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );
    const second: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );

    for (const node of sampleNodes) {
      expect(first.get(node.id)).toEqual(second.get(node.id));
    }
  });

  test("returns an empty map for empty topology", () => {
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      [],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(layout.size).toBe(0);
  });

  test("ignores operational enrichment on edges — layout only reads endpoints", () => {
    const enrichedEdges: Array<NetworkTopologyEdge> = sampleEdges.map(
      (edge: NetworkTopologyEdge): NetworkTopologyEdge => {
        return {
          ...edge,
          protocols: ["lldp", "cdp"],
          fromInterface: {
            interfaceIndex: 1,
            interfaceName: "Gi0/1",
            isOperationallyUp: true,
            utilizationPercent: 42,
            inRateMbps: 100,
            outRateMbps: 50,
          },
        };
      },
    );

    const plain: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );
    const enriched: Map<string, { x: number; y: number }> =
      computeTopologyLayout(sampleNodes, enrichedEdges, WIDTH, HEIGHT);

    for (const node of sampleNodes) {
      expect(enriched.get(node.id)).toEqual(plain.get(node.id));
    }
  });
});

describe("NetworkTopologyUtil.buildTopology — CDP merge and enrichment", () => {
  const now: Date = new Date("2026-01-01T00:00:00.000Z");

  const coreSwitch: TopologyDeviceInput = {
    id: "device-core",
    name: "Core Switch",
    hostname: "core-1",
    sysName: "core-1.example.com",
    lastSeenAt: now,
    vendor: "Cisco",
    deviceModel: "WS-C3850",
  };

  const edgeRouter: TopologyDeviceInput = {
    id: "device-edge",
    name: "Edge Router",
    hostname: "edge-1",
    sysName: "edge-1.example.com",
    lastSeenAt: now,
    vendor: "Juniper",
    deviceModel: "MX204",
  };

  const interfaces: Array<TopologyInterfaceInput> = [
    {
      networkDeviceId: "device-core",
      interfaceIndex: 1,
      name: "Gi0/1",
      isOperationallyUp: true,
      isAdministrativelyUp: true,
      utilizationPercent: 91,
      inRateMbps: 910,
      outRateMbps: 120,
      errorsPerSecond: 0,
    },
    {
      networkDeviceId: "device-edge",
      interfaceIndex: 7,
      name: "xe-0/0/7",
      isOperationallyUp: false,
      isAdministrativelyUp: true,
      utilizationPercent: 0,
      inRateMbps: 0,
      outRateMbps: 0,
      errorsPerSecond: 2,
    },
  ];

  test("builds an edge from a CDP-only neighbor matched by device name", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "Edge Router",
              remotePortId: "xe-0/0/7",
            },
          ],
        },
        edgeRouter,
      ],
      now,
    );

    expect(topology.edges).toHaveLength(1);
    expect(topology.edges[0]!.fromNodeId).toBe("device-core");
    expect(topology.edges[0]!.toNodeId).toBe("device-edge");
    expect(topology.edges[0]!.protocols).toEqual(["cdp"]);
    // No unmanaged node — the CDP neighbor resolved to a managed device.
    expect(
      topology.nodes.filter((node: NetworkTopologyNode) => {
        return !node.isManaged;
      }),
    ).toHaveLength(0);
  });

  test("dedupes a link reported by both LLDP and CDP into one edge with both protocols", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          lldpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteSysName: "edge-1.example.com",
              remotePortId: "xe-0/0/7",
            },
          ],
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "edge-1",
              remotePortId: "xe-0/0/7",
            },
          ],
        },
        edgeRouter,
      ],
      now,
    );

    expect(topology.edges).toHaveLength(1);
    expect(topology.edges[0]!.protocols).toEqual(["lldp", "cdp"]);
  });

  test("dedupes a link reported from both ends and keeps both ends' interface data", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          lldpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteSysName: "edge-1.example.com",
            },
          ],
        },
        {
          ...edgeRouter,
          lldpNeighbors: [
            {
              localInterfaceIndex: 7,
              remoteSysName: "core-1.example.com",
            },
          ],
        },
      ],
      now,
      interfaces,
    );

    expect(topology.edges).toHaveLength(1);
    const edge: NetworkTopologyEdge = topology.edges[0]!;
    expect(edge.fromNodeId).toBe("device-core");
    expect(edge.toNodeId).toBe("device-edge");
    // Core's end enriched from core's own interface row...
    expect(edge.fromInterface?.interfaceName).toBe("Gi0/1");
    expect(edge.fromInterface?.utilizationPercent).toBe(91);
    // ...and edge router's end filled in when IT reported the same link.
    expect(edge.toInterface?.interfaceName).toBe("xe-0/0/7");
    expect(edge.toInterface?.isOperationallyUp).toBe(false);
    expect(edge.toPort).toBe("xe-0/0/7");
  });

  test("enriches both ends from one report when the remote port id matches an interface name", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          lldpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteSysName: "edge-1.example.com",
              remotePortId: "xe-0/0/7",
            },
          ],
        },
        edgeRouter,
      ],
      now,
      interfaces,
    );

    expect(topology.edges).toHaveLength(1);
    const edge: NetworkTopologyEdge = topology.edges[0]!;
    // fromPort prefers the real interface name over the "if<n>" fallback.
    expect(edge.fromPort).toBe("Gi0/1");
    expect(edge.fromInterface?.inRateMbps).toBe(910);
    expect(edge.toInterface?.interfaceIndex).toBe(7);
    expect(edge.toInterface?.errorsPerSecond).toBe(2);
  });

  test("keeps the if<n> port fallback when no interface row matches", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          lldpNeighbors: [
            {
              localInterfaceIndex: 3,
              remoteSysName: "edge-1.example.com",
            },
          ],
        },
        edgeRouter,
      ],
      now,
      interfaces,
    );

    expect(topology.edges[0]!.fromPort).toBe("if3");
    expect(topology.edges[0]!.fromInterface?.interfaceIndex).toBe(3);
    expect(topology.edges[0]!.fromInterface?.isOperationallyUp).toBeUndefined();
  });

  test("creates an unmanaged node for a CDP neighbor that matches no device", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [
        {
          ...coreSwitch,
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "ap-lobby-01",
              remotePortId: "Port 1",
              remotePlatform: "cisco AIR-AP2802I",
            },
          ],
        },
      ],
      now,
    );

    const unmanaged: Array<NetworkTopologyNode> = topology.nodes.filter(
      (node: NetworkTopologyNode) => {
        return !node.isManaged;
      },
    );
    expect(unmanaged).toHaveLength(1);
    expect(unmanaged[0]!.id).toBe("unmanaged:ap-lobby-01");
    expect(unmanaged[0]!.name).toBe("ap-lobby-01");
    expect(unmanaged[0]!.deviceModel).toBe("cisco AIR-AP2802I");
    expect(topology.edges).toHaveLength(1);
  });

  test("includes vendor, model and sysName on managed node payloads", () => {
    const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
      [coreSwitch, edgeRouter],
      now,
    );

    const core: NetworkTopologyNode | undefined = topology.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.id === "device-core";
      },
    );
    expect(core?.vendor).toBe("Cisco");
    expect(core?.deviceModel).toBe("WS-C3850");
    expect(core?.sysName).toBe("core-1.example.com");
  });
});

describe("NetworkTopologyMeta — link state and stroke width", () => {
  const baseEdge: NetworkTopologyEdge = {
    fromNodeId: "a",
    toNodeId: "b",
  };

  test("is unknown without any operational data", () => {
    expect(linkStateForEdge(baseEdge)).toBe("unknown");
    expect(maxUtilizationForEdge(baseEdge)).toBeUndefined();
  });

  test("is healthy with data under the saturation threshold", () => {
    expect(
      linkStateForEdge({
        ...baseEdge,
        fromInterface: { isOperationallyUp: true, utilizationPercent: 40 },
      }),
    ).toBe("healthy");
  });

  test("is saturated at or above 80% utilization on either end", () => {
    expect(
      linkStateForEdge({
        ...baseEdge,
        fromInterface: { isOperationallyUp: true, utilizationPercent: 10 },
        toInterface: { isOperationallyUp: true, utilizationPercent: 80 },
      }),
    ).toBe("saturated");
  });

  test("is down when either end is operationally down — down beats saturated", () => {
    expect(
      linkStateForEdge({
        ...baseEdge,
        fromInterface: { isOperationallyUp: false },
        toInterface: { isOperationallyUp: true, utilizationPercent: 95 },
      }),
    ).toBe("down");
  });

  test("stroke width scales with utilization and defaults without data", () => {
    expect(edgeStrokeWidthForEdge(baseEdge)).toBe(1.5);
    const half: number = edgeStrokeWidthForEdge({
      ...baseEdge,
      fromInterface: { utilizationPercent: 50 },
    });
    const full: number = edgeStrokeWidthForEdge({
      ...baseEdge,
      fromInterface: { utilizationPercent: 100 },
    });
    expect(half).toBeGreaterThan(1.5);
    expect(full).toBeGreaterThan(half);
    expect(full).toBe(5);
  });

  test("nodeMatchesSearch matches name, sysName and vendor case-insensitively", () => {
    const node: NetworkTopologyNode = {
      id: "device-core",
      name: "Core Switch",
      isManaged: true,
      status: "up",
      sysName: "core-1.example.com",
      vendor: "Cisco",
    };
    expect(nodeMatchesSearch(node, "")).toBe(true);
    expect(nodeMatchesSearch(node, "core sw")).toBe(true);
    expect(nodeMatchesSearch(node, "EXAMPLE.COM")).toBe(true);
    expect(nodeMatchesSearch(node, "cisco")).toBe(true);
    expect(nodeMatchesSearch(node, "juniper")).toBe(false);
  });
});
