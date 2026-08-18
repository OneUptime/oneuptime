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
  /*
   * Past the shared staleness window (an hour at the default interval), so
   * "we have stopped polling this entirely" rather than "the probe is a bit
   * behind" — the distinction issue #3220 turned on.
   */
  const outOfContact: Date = new Date("2026-07-22T09:00:00Z");

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

    it("prefers a stamped monitor status over lastSeenAt freshness", () => {
      /*
       * The precedence SiteStatusRollupUtil already applies when it rolls
       * devices into a site — otherwise a device could read "up" on the map
       * and "down" on the site card directly above it.
       *
       * d3 is the case this exists for: a monitor-backed device is never
       * polled, so its lastSeenAt is permanently absent and freshness alone
       * would leave it "unknown" forever.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "monitor-says-down", {
            lastSeenAt: fresh,
            monitorStatus: "down",
          }),
          makeDevice("d2", "monitor-says-up", {
            lastSeenAt: stale,
            monitorStatus: "up",
          }),
          makeDevice("d3", "never-polled", {
            lastSeenAt: undefined,
            monitorStatus: "up",
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("down");
      expect(nodeById(result, "d2")!.status).toBe("up");
      expect(nodeById(result, "d3")!.status).toBe("up");
    });

    it("derives device status from the outcome of the last poll", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "answered", {
            isReachable: true,
            lastPolledAt: fresh,
            lastSeenAt: fresh,
          }),
          makeDevice("d2", "did-not-answer", {
            isReachable: false,
            lastPolledAt: fresh,
            lastSeenAt: outOfContact,
          }),
          makeDevice("d3", "never-polled", {
            isReachable: undefined,
            lastPolledAt: undefined,
            lastSeenAt: undefined,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("up");
      expect(nodeById(result, "d2")!.status).toBe("down");
      expect(nodeById(result, "d3")!.status).toBe("unknown");
    });

    /*
     * Issue #3220: the map drew a whole fleet red because its probe could
     * not get round every device inside the old fixed 15-minute freshness
     * window. A device that answered its last poll is up on the map however
     * far behind the schedule has fallen.
     */
    it("issue #3220: a device that answered 30 minutes ago is still up on the map", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "behind-schedule", {
            isReachable: true,
            lastPolledAt: stale,
            lastSeenAt: stale,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("up");
    });

    it("but a device nothing has polled for hours goes down on the map", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "out-of-contact", {
            isReachable: true,
            lastPolledAt: outOfContact,
            lastSeenAt: outOfContact,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("down");
    });

    /*
     * Rows written before the reachability columns existed carry only
     * lastSeenAt; the map must keep drawing them from that until their next
     * walk fills the rest in.
     */
    it("falls back to lastSeenAt for rows with no recorded poll outcome", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "legacy-fresh", { lastSeenAt: fresh }),
          makeDevice("d2", "legacy-out-of-contact", {
            lastSeenAt: outOfContact,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("up");
      expect(nodeById(result, "d2")!.status).toBe("down");
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

  /*
   * The matching half of issue #3023: switches drawn linked to phantom
   * "unmanaged" neighbours that are in fact devices already in the project.
   * A chassis id is a serial or a MAC, and both were previously unmatchable
   * because devices were only ever indexed by their names.
   */
  describe("neighbor matching beyond sysName", () => {
    it("matches a chassis id against the device's serial number", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "UN0661LANSWI02", {
            sysName: "UN0661LANSWI02",
            lldpNeighbors: [
              {
                localInterfaceIndex: 24,
                // No sysName advertised — only the chassis id.
                remoteChassisId: "W600805EC073AAE7",
                remotePortId: "1",
              },
            ],
          }),
          makeDevice("d2", "idf-ap-1", {
            sysName: "idf-ap-1",
            serialNumber: "W600805EC073AAE7",
          }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    it("matches a chassis id against one of the device's interface MACs", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              // Cisco dot spelling on the wire, colon spelling on the device.
              { localInterfaceIndex: 3, remoteChassisId: "0011.2233.4455" },
            ],
          }),
          makeDevice("d2", "core-1", {
            sysName: "core-1",
            macAddresses: ["aa:bb:cc:dd:ee:ff", "00:11:22:33:44:55"],
          }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    it("matches an FQDN against a bare sysName, and the reverse", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "core-1.corp.local" },
            ],
          }),
          makeDevice("d2", "core-1", { sysName: "core-1" }),
          makeDevice("d3", "dist-1", {
            sysName: "dist-1.corp.local",
            lldpNeighbors: [
              { localInterfaceIndex: 2, remoteSysName: "edge-1" },
            ],
          }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(3);
      const edgeTargets: Array<string> = result.edges.map(
        (edge: NetworkTopologyEdge) => {
          return [edge.fromNodeId, edge.toNodeId].sort().join("::");
        },
      );
      expect(edgeTargets.sort()).toEqual(["d1::d2", "d1::d3"]);
    });

    it("refuses to guess when two devices share a short hostname", () => {
      /*
       * `sw01` names two different boxes here, so the short form identifies
       * nothing. Drawing the cable to whichever was indexed last would put
       * a link on the map that does not exist in the building.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [{ localInterfaceIndex: 1, remoteSysName: "sw01" }],
          }),
          makeDevice("d2", "sw01-a", { sysName: "sw01.site-a.local" }),
          makeDevice("d3", "sw01-b", { sysName: "sw01.site-b.local" }),
        ],
        now,
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("unmanaged:sw01");
      expect(nodeById(result, "unmanaged:sw01")!.isManaged).toBe(false);
    });

    it("still prefers an exact name over a short-host match", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "core-1.corp.local" },
            ],
          }),
          makeDevice("d2", "exact", { sysName: "core-1.corp.local" }),
          makeDevice("d3", "shortOnly", { sysName: "core-1.other.local" }),
        ],
        now,
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    it("draws one unmanaged node when two switches identify a peer differently", () => {
      /*
       * One switch knows the access point by name, the other only by the
       * chassis MAC it advertises. That is one box, and the map used to
       * show it as two unrelated strangers.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteSysName: "ap-lobby",
                remoteChassisId: "00:11:22:33:44:55",
              },
            ],
          }),
          makeDevice("d2", "edge-2", {
            sysName: "edge-2",
            lldpNeighbors: [
              { localInterfaceIndex: 4, remoteChassisId: "0011.2233.4455" },
            ],
          }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(3);
      const peer: NetworkTopologyNode | undefined = nodeById(
        result,
        "unmanaged:ap-lobby",
      );
      expect(peer).toBeDefined();
      expect(peer!.kind).toBe("unmanaged");
      // Both switches link to the same peer node.
      expect(result.edges).toHaveLength(2);
      for (const edge of result.edges) {
        expect(edge.toNodeId).toBe("unmanaged:ap-lobby");
      }
    });

    it("does not merge two peers that only share a short hostname", () => {
      /*
       * The mirror of the ambiguity guard: `sw01.site-a` and `sw01.site-b`
       * are two boxes, so the short form must never be enough to fuse them.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "sw01.site-a.local" },
              { localInterfaceIndex: 2, remoteSysName: "sw01.site-b.local" },
            ],
          }),
        ],
        now,
      );

      expect(nodeById(result, "unmanaged:sw01.site-a.local")).toBeDefined();
      expect(nodeById(result, "unmanaged:sw01.site-b.local")).toBeDefined();
      expect(result.edges).toHaveLength(2);
    });

    it("never shortens an IP-address hostname to its first octet", () => {
      /*
       * Devices are routinely named by management IP. Taking the first
       * label of "10.0.0.1" would give every one of them the key "10".
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "10.0.0.9" },
            ],
          }),
          makeDevice("d2", "rtr", { sysName: "10.0.0.1" }),
        ],
        now,
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("unmanaged:10.0.0.9");
    });
  });

  /*
   * The other half of issue #3023: "where auto-discovery can't determine the
   * correct link, provide a manual option to define the link between two
   * devices".
   */
  describe("operator-declared links", () => {
    it("draws a link between two devices neither protocol reported", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "ping-only-ap")],
        now,
        [],
        [],
        [
          {
            fromDeviceId: "d1",
            toDeviceId: "d2",
            name: "IDF-2 uplink",
            fromPortName: "Gi1/0/24",
            toPortName: "eth0",
          },
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["manual"]);
      expect(result.edges[0]!.fromPort).toBe("Gi1/0/24");
      expect(result.edges[0]!.toPort).toBe("eth0");
      expect(result.edges[0]!.name).toBe("IDF-2 uplink");
    });

    it("merges with a discovered link between the same pair instead of doubling it", () => {
      /*
       * Two lines between one pair of boxes reads as two physical links.
       * Declaring a cable that discovery later finds has to cost nothing.
       */
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
        [],
        [],
        [{ fromDeviceId: "d1", toDeviceId: "d2", name: "hand drawn" }],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["lldp", "manual"]);
      // The discovered port survives; the operator's name has no rival.
      expect(result.edges[0]!.toPort).toBe("Gi0/1");
      expect(result.edges[0]!.name).toBe("hand drawn");
    });

    it("keeps the discovered port when the hand-typed one disagrees", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 24, remoteSysName: "core-1" },
            ],
          }),
          makeDevice("d2", "core-1", { sysName: "core-1" }),
        ],
        now,
        [
          {
            networkDeviceId: "d1",
            interfaceIndex: 24,
            name: "GigabitEthernet0/24",
          },
        ],
        [],
        [
          {
            fromDeviceId: "d1",
            toDeviceId: "d2",
            fromPortName: "misremembered",
          },
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.fromPort).toBe("GigabitEthernet0/24");
    });

    it("carries a bound monitor's verdict for a link nothing measures", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "remote-1")],
        now,
        [],
        [],
        [{ fromDeviceId: "d1", toDeviceId: "d2", monitorStatus: "down" }],
      );

      expect(result.edges[0]!.monitorState).toBe("down");
    });

    it("skips a link whose ends are not both on this map", () => {
      /*
       * A site-scoped map, or a link to a device since archived. Drawing an
       * edge to a node that is not there would leave a line into empty space.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1")],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d-elsewhere" },
          { fromDeviceId: "d1", toDeviceId: "d1" },
        ],
      );

      expect(result.edges).toHaveLength(0);
    });
  });

  describe("suppressed nodes", () => {
    it("removes a hidden node and every link that touched it", () => {
      /*
       * A line to a node that is not drawn is a line into empty space, so
       * the edges go with the node.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "core-1" },
              { localInterfaceIndex: 2, remoteSysName: "landlord-sw" },
            ],
          }),
          makeDevice("d2", "core-1", { sysName: "core-1" }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(["unmanaged:landlord-sw"]),
      );

      expect(nodeById(result, "unmanaged:landlord-sw")).toBeUndefined();
      expect(result.suppressedNodeCount).toBe(1);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    it("hides a managed device without re-routing anything around it", () => {
      /*
       * Suppression is a display decision applied to the finished graph.
       * Hiding the middle of a chain must not invent a link between the two
       * ends — that would be the map asserting a cable nobody has.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "core-1" },
            ],
          }),
          makeDevice("d2", "core-1", {
            sysName: "core-1",
            lldpNeighbors: [
              { localInterfaceIndex: 2, remoteSysName: "dist-1" },
            ],
          }),
          makeDevice("d3", "dist-1", { sysName: "dist-1" }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(["d2"]),
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(0);
      expect(result.suppressedNodeCount).toBe(1);
    });

    it("reports zero rather than nothing when the project hides nothing", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
      );
      expect(result.suppressedNodeCount).toBe(0);
      expect(result.nodes).toHaveLength(1);
    });

    it("ignores a key that matches nothing on this map", () => {
      // A device since deleted, or a site-scoped view. Not an error.
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [],
        [],
        new Set<string>(["d-gone"]),
      );
      expect(result.nodes).toHaveLength(1);
      expect(result.suppressedNodeCount).toBe(0);
    });

    it("hides a discovered endpoint by its endpoint key", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("e1", "aa:aa:aa:aa:aa:01", {
            attachedNetworkDeviceId: "d1",
          }),
          makeEndpoint("e2", "aa:aa:aa:aa:aa:02", {
            attachedNetworkDeviceId: "d1",
          }),
        ],
        [],
        new Set<string>(["endpoint:e1"]),
      );

      expect(nodeById(result, "endpoint:e1")).toBeUndefined();
      expect(nodeById(result, "endpoint:e2")).toBeDefined();
      expect(result.edges).toHaveLength(1);
      expect(result.suppressedNodeCount).toBe(1);
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

    /*
     * Endpoints are ARP/FDB-learned hosts with no poll of their own, so
     * freshness really is all there is. The window is the shared staleness
     * one (an hour) rather than the old 15 minutes, so a host behind a
     * switch its probe polls slowly does not blink out between walks.
     */
    it("derives endpoint status from lastSeenAt freshness", () => {
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
            lastSeenAt: outOfContact,
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

    it("an endpoint seen half an hour ago is still up, not blinked out", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "edge-1")],
        now,
        [],
        [
          makeEndpoint("ep-1", "aa:00:00:00:00:01", {
            attachedNetworkDeviceId: "d1",
            lastSeenAt: stale,
          }),
        ],
      );

      expect(nodeById(result, "endpoint:ep-1")!.status).toBe("up");
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

/*
 * Roles are what give every node on the map its shape, so the builder has
 * to attach one to all three kinds of node — the devices it was given,
 * the unmanaged peers it invented from neighbor claims, and the endpoints
 * it hung off switch ports.
 */
describe("NetworkTopologyUtil.buildTopology — device roles", () => {
  const now: Date = new Date("2026-07-22T12:00:00Z");
  const fresh: Date = new Date("2026-07-22T11:55:00Z");

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

  test("managed devices are classified from their SNMP identity", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "core-1",
          lastSeenAt: fresh,
          deviceModel: "Catalyst 9300-48P",
        },
        {
          id: "d2",
          name: "edge-1",
          lastSeenAt: fresh,
          sysDescr: "FortiGate-60F v7.2.5",
        },
        {
          id: "d3",
          name: "dmz-1",
          lastSeenAt: fresh,
          sysObjectId: "1.3.6.1.4.1.3375.2.1.3.4.10",
        },
      ],
      now,
    );

    expect(nodeById(result, "d1")?.role).toBe("switch");
    expect(nodeById(result, "d2")?.role).toBe("firewall");
    expect(nodeById(result, "d3")?.role).toBe("loadBalancer");
  });

  test("a device with no identity at all still carries an explicit role", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [{ id: "d1", name: "device-42", lastSeenAt: fresh }],
      now,
    );
    /*
     * Explicitly "unknown" rather than absent — readers must not have to
     * distinguish "we could not tell" from "this payload is old".
     */
    expect(nodeById(result, "d1")?.role).toBe("unknown");
  });

  test("the hostname is read as a last resort, sysName ahead of name", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        { id: "d1", name: "idf2-sw-3", lastSeenAt: fresh },
        {
          id: "d2",
          name: "unhelpful",
          sysName: "core-rtr-1",
          lastSeenAt: fresh,
        },
      ],
      now,
    );
    expect(nodeById(result, "d1")?.role).toBe("switch");
    expect(nodeById(result, "d2")?.role).toBe("router");
  });

  test("an unmanaged CDP peer is classified from the platform it advertises", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "edge-1",
          lastSeenAt: fresh,
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "ap-lobby",
              remotePlatform: "cisco AIR-CAP3702I-A-K9",
            },
          ],
        },
      ],
      now,
    );
    expect(nodeById(result, "unmanaged:ap-lobby")?.role).toBe(
      "wirelessAccessPoint",
    );
  });

  test("a peer known only by name falls back to the naming convention", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "edge-1",
          lastSeenAt: fresh,
          lldpNeighbors: [
            { localInterfaceIndex: 1, remoteSysName: "dist-sw-9" },
          ],
        },
      ],
      now,
    );
    expect(nodeById(result, "unmanaged:dist-sw-9")?.role).toBe("switch");
  });

  test("a peer with nothing to go on is unknown, not guessed at", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "edge-1",
          lastSeenAt: fresh,
          lldpNeighbors: [{ localInterfaceIndex: 1, remoteSysName: "peer-a" }],
        },
      ],
      now,
    );
    expect(nodeById(result, "unmanaged:peer-a")?.role).toBe("unknown");
  });

  test("a later claim that brings a platform re-derives the peer's role", () => {
    /*
     * LLDP reports the peer first, by name only, so it starts out
     * unknown; the CDP claim that follows carries the platform string —
     * the only real evidence about that box — and must be allowed to
     * change the shape it is drawn as.
     */
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "edge-1",
          lastSeenAt: fresh,
          lldpNeighbors: [{ localInterfaceIndex: 1, remoteSysName: "peer-a" }],
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "peer-a",
              remotePlatform: "cisco WS-C2960X-48TS-L",
            },
          ],
        },
      ],
      now,
    );
    const peer: NetworkTopologyNode | undefined = nodeById(
      result,
      "unmanaged:peer-a",
    );
    expect(peer?.deviceModel).toBe("cisco WS-C2960X-48TS-L");
    expect(peer?.role).toBe("switch");
  });

  test("endpoints are hosts unless their classification says otherwise", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [{ id: "d1", name: "edge-1", lastSeenAt: fresh }],
      now,
      [],
      [
        {
          id: "e1",
          macAddress: "aa:aa:aa:aa:aa:01",
          attachedNetworkDeviceId: "d1",
          lastSeenAt: fresh,
        },
        {
          id: "e2",
          macAddress: "aa:aa:aa:aa:aa:02",
          classification: "Camera",
          attachedNetworkDeviceId: "d1",
          lastSeenAt: fresh,
        },
        {
          id: "e3",
          macAddress: "aa:aa:aa:aa:aa:03",
          vendor: "Zebra Technologies",
          attachedNetworkDeviceId: "d1",
          lastSeenAt: fresh,
        },
        {
          id: "e4",
          macAddress: "aa:aa:aa:aa:aa:04",
          classification: "POS terminal",
          attachedNetworkDeviceId: "d1",
          lastSeenAt: fresh,
        },
      ],
    );

    expect(nodeById(result, "endpoint:e1")?.role).toBe("host");
    expect(nodeById(result, "endpoint:e2")?.role).toBe("camera");
    expect(nodeById(result, "endpoint:e3")?.role).toBe("printer");
    expect(nodeById(result, "endpoint:e4")?.role).toBe("host");
  });

  test("every node the builder emits carries a role", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "edge-1",
          lastSeenAt: fresh,
          lldpNeighbors: [{ localInterfaceIndex: 1, remoteSysName: "peer-a" }],
        },
      ],
      now,
      [],
      [
        {
          id: "e1",
          macAddress: "aa:aa:aa:aa:aa:01",
          attachedNetworkDeviceId: "d1",
          lastSeenAt: fresh,
        },
      ],
    );

    expect(result.nodes).toHaveLength(3);
    for (const node of result.nodes) {
      expect(node.role).toBeDefined();
    }
  });
});
