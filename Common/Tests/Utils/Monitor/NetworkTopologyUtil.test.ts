import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
  TopologyInterfaceInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";

describe("NetworkTopologyUtil.buildTopology", () => {
  const now: Date = new Date("2026-07-22T12:00:00Z");
  const fresh: Date = new Date("2026-07-22T11:55:00Z");
  const stale: Date = new Date("2026-07-22T11:30:00Z");

  const makeDevice: (
    id: string,
    name: string,
    overrides?: Partial<TopologyDeviceInput>,
  ) => TopologyDeviceInput = (
    id: string,
    name: string,
    overrides?: Partial<TopologyDeviceInput>,
  ): TopologyDeviceInput => {
    return {
      id,
      name,
      lastSeenAt: fresh,
      ...overrides,
    };
  };

  const makeEndpoint: (
    id: string,
    macAddress: string,
    overrides?: Partial<TopologyEndpointInput>,
  ) => TopologyEndpointInput = (
    id: string,
    macAddress: string,
    overrides?: Partial<TopologyEndpointInput>,
  ): TopologyEndpointInput => {
    return {
      id,
      macAddress,
      lastSeenAt: fresh,
      ...overrides,
    };
  };

  const nodeById: (
    result: TopologyBuildResult,
    id: string,
  ) => NetworkTopologyNode | undefined = (
    result: TopologyBuildResult,
    id: string,
  ): NetworkTopologyNode | undefined => {
    return result.nodes.find((node: NetworkTopologyNode) => {
      return node.id === id;
    });
  };

  describe("device and unmanaged nodes (existing behavior)", () => {
    it("links two managed devices via an LLDP neighbor entry", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              {
                localInterfaceIndex: 24,
                remoteSysName: "core-1",
                remotePortId: "Gi0/1",
              },
            ],
          }),
          makeDevice("d2", "core-1", { sysName: "core-1" }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.fromNodeId).toBe("d1");
      expect(result.edges[0]!.toNodeId).toBe("d2");
      expect(result.edges[0]!.protocols).toEqual(["lldp"]);
    });

    it("stamps kind 'device' on managed nodes", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
      );

      expect(nodeById(result, "d1")!.kind).toBe("device");
      expect(nodeById(result, "d1")!.isManaged).toBe(true);
    });

    it("stamps kind 'unmanaged' on unmatched neighbor nodes", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "mystery-box",
                remotePlatform: "cisco WS-C2960",
              },
            ],
          }),
        ],
        now,
      );

      const unmanaged: NetworkTopologyNode | undefined = nodeById(
        result,
        "unmanaged:mystery-box",
      );
      expect(unmanaged).toBeDefined();
      expect(unmanaged!.kind).toBe("unmanaged");
      expect(unmanaged!.isManaged).toBe(false);
      expect(unmanaged!.deviceModel).toBe("cisco WS-C2960");
    });

    it("derives device status from lastSeenAt freshness", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "fresh-device", { lastSeenAt: fresh }),
          makeDevice("d2", "stale-device", { lastSeenAt: stale }),
          makeDevice("d3", "never-seen", { lastSeenAt: undefined }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("up");
      expect(nodeById(result, "d2")!.status).toBe("down");
      expect(nodeById(result, "d3")!.status).toBe("unknown");
    });

    it("merges the same link reported from both ends by both protocols", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 24, remoteSysName: "core-1" },
            ],
          }),
          makeDevice("d2", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              { localInterfaceIndex: 1, remoteDeviceId: "edge-1" },
            ],
          }),
        ],
        now,
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["lldp", "cdp"]);
    });
  });

  describe("legacy payload compatibility (no endpoints argument)", () => {
    it("emits no endpoint nodes and zeroed endpoint bookkeeping", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
      expect(result.droppedEndpointCount).toBe(0);
      expect(result.endpointsTruncated).toBe(false);
    });

    it("keeps interface enrichment behavior unchanged", () => {
      const interfaces: Array<TopologyInterfaceInput> = [
        {
          networkDeviceId: "d1",
          interfaceIndex: 24,
          name: "Gi0/24",
          isOperationallyUp: true,
          utilizationPercent: 12,
        },
      ];
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            lldpNeighbors: [
              { localInterfaceIndex: 24, remoteSysName: "elsewhere" },
            ],
          }),
        ],
        now,
        interfaces,
      );

      expect(result.edges[0]!.fromPort).toBe("Gi0/24");
      expect(result.edges[0]!.fromInterface?.utilizationPercent).toBe(12);
    });
  });

  describe("endpoint nodes and fdb edges", () => {
    it("emits an endpoint node with an fdb edge to its switch", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("ep-1", "aa:bb:cc:dd:ee:01", {
            attachedNetworkDeviceId: "d1",
            attachedInterfaceIndex: 7,
            attachedPortName: "Gi0/7",
            ipAddress: "10.0.0.31",
            vendor: "Verifone",
            classification: "POS",
          }),
        ],
      );

      const endpointNode: NetworkTopologyNode | undefined = nodeById(
        result,
        "endpoint:ep-1",
      );
      expect(endpointNode).toBeDefined();
      expect(endpointNode!.kind).toBe("endpoint");
      expect(endpointNode!.isManaged).toBe(false);
      expect(endpointNode!.macAddress).toBe("aa:bb:cc:dd:ee:01");
      expect(endpointNode!.ipAddress).toBe("10.0.0.31");
      expect(endpointNode!.vendor).toBe("Verifone");
      expect(endpointNode!.classification).toBe("POS");

      const edge: NetworkTopologyEdge | undefined = result.edges.find(
        (candidate: NetworkTopologyEdge) => {
          return candidate.toNodeId === "endpoint:ep-1";
        },
      );
      expect(edge).toBeDefined();
      expect(edge!.fromNodeId).toBe("d1");
      expect(edge!.protocols).toEqual(["fdb"]);
      expect(edge!.fromPort).toBe("Gi0/7");
    });

    it("names endpoints by classification, then vendor, then IP, then MAC", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("ep-1", "aa:00:00:00:00:01", {
            attachedNetworkDeviceId: "d1",
            classification: "Camera",
            vendor: "Axis",
            ipAddress: "10.0.0.1",
          }),
          makeEndpoint("ep-2", "aa:00:00:00:00:02", {
            attachedNetworkDeviceId: "d1",
            vendor: "Axis",
            ipAddress: "10.0.0.2",
          }),
          makeEndpoint("ep-3", "aa:00:00:00:00:03", {
            attachedNetworkDeviceId: "d1",
            ipAddress: "10.0.0.3",
          }),
          makeEndpoint("ep-4", "aa:00:00:00:00:04", {
            attachedNetworkDeviceId: "d1",
          }),
        ],
      );

      expect(nodeById(result, "endpoint:ep-1")!.name).toBe("Camera");
      expect(nodeById(result, "endpoint:ep-2")!.name).toBe("Axis");
      expect(nodeById(result, "endpoint:ep-3")!.name).toBe("10.0.0.3");
      expect(nodeById(result, "endpoint:ep-4")!.name).toBe("aa:00:00:00:00:04");
    });

    it("derives endpoint status from lastSeenAt with the same freshness rule", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("ep-1", "aa:00:00:00:00:01", {
            attachedNetworkDeviceId: "d1",
            lastSeenAt: fresh,
          }),
          makeEndpoint("ep-2", "aa:00:00:00:00:02", {
            attachedNetworkDeviceId: "d1",
            lastSeenAt: stale,
          }),
          makeEndpoint("ep-3", "aa:00:00:00:00:03", {
            attachedNetworkDeviceId: "d1",
            lastSeenAt: undefined,
          }),
        ],
      );

      expect(nodeById(result, "endpoint:ep-1")!.status).toBe("up");
      expect(nodeById(result, "endpoint:ep-2")!.status).toBe("down");
      expect(nodeById(result, "endpoint:ep-3")!.status).toBe("unknown");
    });

    it("labels the port from the interface row, then falls back to if<index>", () => {
      const interfaces: Array<TopologyInterfaceInput> = [
        { networkDeviceId: "d1", interfaceIndex: 9, name: "Fa0/9" },
      ];
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        interfaces,
        [
          // No port name stored, but the interface row knows it.
          makeEndpoint("ep-1", "aa:00:00:00:00:01", {
            attachedNetworkDeviceId: "d1",
            attachedInterfaceIndex: 9,
          }),
          // Nothing but the ifIndex.
          makeEndpoint("ep-2", "aa:00:00:00:00:02", {
            attachedNetworkDeviceId: "d1",
            attachedInterfaceIndex: 3,
          }),
          // No port information at all.
          makeEndpoint("ep-3", "aa:00:00:00:00:03", {
            attachedNetworkDeviceId: "d1",
          }),
        ],
      );

      const edgeFor: (nodeId: string) => NetworkTopologyEdge | undefined = (
        nodeId: string,
      ): NetworkTopologyEdge | undefined => {
        return result.edges.find((candidate: NetworkTopologyEdge) => {
          return candidate.toNodeId === nodeId;
        });
      };

      expect(edgeFor("endpoint:ep-1")!.fromPort).toBe("Fa0/9");
      expect(edgeFor("endpoint:ep-1")!.fromInterface?.interfaceIndex).toBe(9);
      expect(edgeFor("endpoint:ep-2")!.fromPort).toBe("if3");
      expect(edgeFor("endpoint:ep-3")!.fromPort).toBeUndefined();
    });

    it("drops endpoints with no attachment or an attachment outside the graph", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "mystery" },
            ],
          }),
        ],
        now,
        [],
        [
          makeEndpoint("ep-1", "aa:00:00:00:00:01", {
            attachedNetworkDeviceId: "d1",
          }),
          // No attachment at all.
          makeEndpoint("ep-2", "aa:00:00:00:00:02"),
          // Attached to a device that is not part of this graph.
          makeEndpoint("ep-3", "aa:00:00:00:00:03", {
            attachedNetworkDeviceId: "ghost-device",
          }),
          // Unmanaged node ids never count as attachment targets.
          makeEndpoint("ep-4", "aa:00:00:00:00:04", {
            attachedNetworkDeviceId: "unmanaged:mystery",
          }),
        ],
      );

      expect(nodeById(result, "endpoint:ep-1")).toBeDefined();
      expect(nodeById(result, "endpoint:ep-2")).toBeUndefined();
      expect(nodeById(result, "endpoint:ep-3")).toBeUndefined();
      expect(nodeById(result, "endpoint:ep-4")).toBeUndefined();
      expect(result.droppedEndpointCount).toBe(3);
      expect(result.endpointsTruncated).toBe(false);
    });

    it("caps rendered endpoints at 2000, keeping the lowest MACs", () => {
      const endpoints: Array<TopologyEndpointInput> = [];
      for (let i: number = 0; i < 2005; i++) {
        const hex: string = i.toString(16).padStart(4, "0");
        endpoints.push(
          makeEndpoint(
            `ep-${i}`,
            `aa:bb:cc:dd:${hex.substring(0, 2)}:${hex.substring(2, 4)}`,
            { attachedNetworkDeviceId: "d1" },
          ),
        );
      }
      // A couple of unattached rows must still be counted as dropped.
      endpoints.push(makeEndpoint("ep-x", "ff:ff:00:00:00:01"));
      endpoints.push(makeEndpoint("ep-y", "ff:ff:00:00:00:02"));

      // Shuffle deterministically to prove input order does not matter.
      endpoints.reverse();

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        endpoints,
      );

      const endpointNodes: Array<NetworkTopologyNode> = result.nodes.filter(
        (node: NetworkTopologyNode) => {
          return node.kind === "endpoint";
        },
      );
      expect(endpointNodes).toHaveLength(2000);
      expect(result.endpointsTruncated).toBe(true);
      expect(result.droppedEndpointCount).toBe(2);

      // The rendered slice is the 2000 lowest MACs — ep-0 in, ep-2004 out.
      expect(nodeById(result, "endpoint:ep-0")).toBeDefined();
      expect(nodeById(result, "endpoint:ep-1999")).toBeDefined();
      expect(nodeById(result, "endpoint:ep-2000")).toBeUndefined();
      expect(nodeById(result, "endpoint:ep-2004")).toBeUndefined();
    });

    it("sorts endpoints by normalized MAC across differing spellings", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("ep-b", "BB-00-00-00-00-01", {
            attachedNetworkDeviceId: "d1",
          }),
          makeEndpoint("ep-a", "aa00.0000.0001", {
            attachedNetworkDeviceId: "d1",
          }),
        ],
      );

      const endpointIds: Array<string> = result.nodes
        .filter((node: NetworkTopologyNode) => {
          return node.kind === "endpoint";
        })
        .map((node: NetworkTopologyNode) => {
          return node.id;
        });
      expect(endpointIds).toEqual(["endpoint:ep-a", "endpoint:ep-b"]);
    });
  });
});
