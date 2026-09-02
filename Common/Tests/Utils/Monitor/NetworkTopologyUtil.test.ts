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
import NetworkEndpointAttachmentSource from "../../../Types/NetworkDevice/NetworkEndpointAttachmentSource";
import { UplinkRefusal } from "../../../Utils/Monitor/EndpointUplinkInferenceUtil";

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

  /*
   * Edges are undirected as far as identity goes — which end landed in
   * fromNodeId depends on which pass drew the line first — so they are
   * looked up by the unordered pair, exactly the way the builder keys them.
   * Returns every match rather than the first, because "there is only one
   * line between these two boxes" is itself a thing worth asserting.
   */
  const edgesBetween: (
    result: TopologyBuildResult,
    a: string,
    b: string,
  ) => Array<NetworkTopologyEdge> = (
    result: TopologyBuildResult,
    a: string,
    b: string,
  ): Array<NetworkTopologyEdge> => {
    const wanted: string = [a, b].sort().join("::");
    return result.edges.filter((edge: NetworkTopologyEdge) => {
      return [edge.fromNodeId, edge.toNodeId].sort().join("::") === wanted;
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

    /*
     * A device nothing has polled for hours keeps its last known colour
     * rather than being drawn as an outage. Repainting a whole map red
     * because its probe stopped is the false-positive storm this change
     * exists to remove; the staleness signal belongs on the device page,
     * not in the graph's only three colours.
     */
    it("a device nothing has polled for hours keeps its last known colour", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "out-of-contact", {
            isReachable: true,
            lastPolledAt: outOfContact,
            lastSeenAt: outOfContact,
          }),
          makeDevice("d2", "out-of-contact-and-failing", {
            isReachable: false,
            lastPolledAt: outOfContact,
            lastSeenAt: outOfContact,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.status).toBe("up");
      expect(nodeById(result, "d2")!.status).toBe("down");
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
   * Issue #3435. An unmanaged neighbour on the map was a dead end: the panel
   * showed what the device was and which port it hung off, and the only
   * action was to hide it. Monitoring anything needs an ADDRESS, so the
   * probe now reads the one each protocol advertises (CDP cdpCacheAddress,
   * LLDP lldpRemManAddrTable) and it arrives here.
   *
   * It buys two things: a device we already manage BY ADDRESS stops being
   * drawn as a stranger, and a peer we do not manage carries the field that
   * makes "Add to Monitoring" a real action rather than a form.
   */
  describe("advertised management addresses (#3435)", () => {
    it("matches a neighbour's advertised address against a device's IP hostname", () => {
      /*
       * The subnet-sweep import shape: the responding IP lands in hostname
       * and the device's real identity in name, so nothing the switch
       * advertises about it looks like its name — and before the address
       * was read, the switch drew it as a stranger.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "SEP6026AAF2B46B",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          makeDevice("d2", "Reception phone", { hostname: "10.0.12.41" }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    it("prefers the advertised NAME over the advertised address when both name a device", () => {
      /*
       * A name is a statement about identity; an address is a statement
       * about where something currently answers. When the two disagree the
       * name wins, which is the ordering MATCH_KEY_KINDS_STRONGEST_FIRST
       * encodes.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "dist-sw-02",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          makeDevice("d2", "dist-sw-02", { sysName: "dist-sw-02" }),
          makeDevice("d3", "some-other-box", { hostname: "10.0.12.41" }),
        ],
        now,
      );

      const edge: NetworkTopologyEdge | undefined = result.edges.find(
        (candidate: NetworkTopologyEdge) => {
          return candidate.fromNodeId === "d1" || candidate.toNodeId === "d1";
        },
      );

      expect(edge?.toNodeId).toBe("d2");
    });

    it("puts the advertised address on the unmanaged peer node", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "UN1289LANSWI01", {
            sysName: "UN1289LANSWI01",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "SEP6026AAF2B46B",
                remotePlatform: "Cisco IP Phone 8811",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
        ],
        now,
      );

      const peer: NetworkTopologyNode | undefined = nodeById(
        result,
        "unmanaged:sep6026aaf2b46b",
      );

      expect(peer?.ipAddress).toBe("10.0.12.41");
      expect(peer?.deviceModel).toBe("Cisco IP Phone 8811");
      expect(peer?.role).toBe("phone");
    });

    it("reads the address off an LLDP neighbour too", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            lldpNeighbors: [
              {
                localInterfaceIndex: 3,
                remoteSysName: "ap-lobby",
                remoteIpAddress: "10.0.0.42",
              },
            ],
          }),
        ],
        now,
      );

      expect(nodeById(result, "unmanaged:ap-lobby")?.ipAddress).toBe(
        "10.0.0.42",
      );
    });

    /*
     * THE load-bearing exclusion. Every branch site in an estate has a
     * 10.0.0.1, so if an address were an identity-grade alias, one gateway
     * per site would fuse into a single node on a project-wide map — and
     * the cables of 949 sites would converge on one circle.
     */
    it("does NOT merge two strangers that happen to share an address", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("site-a-sw", "site-a-sw", {
            sysName: "site-a-sw",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "site-a-gw",
                remoteIpAddress: "10.0.0.1",
              },
            ],
          }),
          makeDevice("site-b-sw", "site-b-sw", {
            sysName: "site-b-sw",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "site-b-gw",
                remoteIpAddress: "10.0.0.1",
              },
            ],
          }),
        ],
        now,
      );

      expect(nodeById(result, "unmanaged:site-a-gw")).toBeDefined();
      expect(nodeById(result, "unmanaged:site-b-gw")).toBeDefined();
      expect(result.edges).toHaveLength(2);
    });

    /*
     * The other half of the same exclusion: an address is offered as an
     * address and nothing else. Offered as a "serial" it would match any
     * device whose serial column happened to hold an IP literal; offered as
     * a "name" it would be an identity-grade alias again, with the merging
     * consequences above.
     */
    it("does not match an address against a device's serial number", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "stranger",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          makeDevice("d2", "odd-box", {
            sysName: "odd-box",
            serialNumber: "10.0.12.41",
          }),
        ],
        now,
      );

      expect(nodeById(result, "unmanaged:stranger")).toBeDefined();
      expect(result.edges[0]!.toNodeId).toBe("unmanaged:stranger");
    });

    /*
     * A name is an operator's label. One that happens to read as an IP
     * literal is not a claim that the device answers there, so matching on
     * it would draw a cable to a box that is not on the other end — which
     * this builder holds to be worse than drawing none.
     */
    it("does not read a device NAME that looks like an address as its address", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "stranger",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          // Named after an address it does not answer at.
          makeDevice("d2", "10.0.12.41", { hostname: "192.168.9.9" }),
        ],
        now,
      );

      expect(result.edges[0]!.toNodeId).toBe("unmanaged:stranger");
    });

    /*
     * sysName IS read as an address, unlike name: plenty of gear reports its
     * management IP there, and that is the device saying where it answers
     * rather than a human labelling it.
     */
    it("reads a sysName that is an address as an address", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "stranger",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          makeDevice("d2", "Reception phone", {
            sysName: "10.0.12.41",
            hostname: "phone-lobby.corp.local",
          }),
        ],
        now,
      );

      expect(result.edges[0]!.toNodeId).toBe("d2");
    });

    /*
     * Two devices claiming one address is exactly the overlapping-subnet
     * case. The ambiguity guard deletes the key rather than resolving it,
     * because a wrong cable on a network map is worse than a missing one.
     */
    it("refuses an address two managed devices both claim", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "stranger",
                remoteIpAddress: "10.0.0.1",
              },
            ],
          }),
          makeDevice("d2", "site-a-gw", { hostname: "10.0.0.1" }),
          makeDevice("d3", "site-b-gw", { hostname: "10.0.0.1" }),
        ],
        now,
      );

      expect(result.edges[0]!.toNodeId).toBe("unmanaged:stranger");
    });

    /*
     * Adding an address to a peer must not move it. Node ids are the key
     * saved layouts and node suppressions are stored under, so a peer that
     * renamed itself on the day the probe learned to read addresses would
     * scatter every pinned position and un-hide every hidden node.
     */
    it("keeps the peer's node id when an address arrives alongside its name", () => {
      const withoutAddress: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [
            makeDevice("d1", "core-1", {
              sysName: "core-1",
              cdpNeighbors: [
                { localInterfaceIndex: 1, remoteDeviceId: "ap-lobby" },
              ],
            }),
          ],
          now,
        );

      const withAddress: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [
            makeDevice("d1", "core-1", {
              sysName: "core-1",
              cdpNeighbors: [
                {
                  localInterfaceIndex: 1,
                  remoteDeviceId: "ap-lobby",
                  remoteIpAddress: "10.0.0.42",
                },
              ],
            }),
          ],
          now,
        );

      expect(withoutAddress.edges[0]!.toNodeId).toBe("unmanaged:ap-lobby");
      expect(withAddress.edges[0]!.toNodeId).toBe("unmanaged:ap-lobby");
    });

    /*
     * A claim with an address and no identity is resolvable against a
     * managed device but cannot become a peer of its own — an address is not
     * an identity, so there is nothing to merge two such reports on. Pinned
     * because the behaviour is a deliberate silent drop rather than an
     * oversight.
     */
    it("draws nothing for a neighbour that advertised only an address", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              { localInterfaceIndex: 1, remoteIpAddress: "10.0.0.42" },
            ],
          }),
        ],
        now,
      );

      expect(result.edges).toHaveLength(0);
      expect(result.nodes).toHaveLength(1);
    });

    /*
     * ...but it still SAYS so. A device whose only neighbour report carried
     * an address and nothing else is drawn isolated, and the drawer's
     * explanation is built from exactly these two fields: a count with no
     * identifiers beside it leaves an isolated device with no account of
     * itself, which is the complaint the diagnostics exist to answer.
     */
    it("names an address-only neighbour in the reporting device's diagnostics", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              { localInterfaceIndex: 1, remoteIpAddress: "10.0.0.42" },
            ],
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")?.diagnostics).toEqual({
        isNeighborDiscoveryEnabled: undefined,
        reportedNeighborCount: 1,
        unmatchedNeighborIdentifiers: ["10.0.0.42"],
      });
    });

    /*
     * And a neighbour whose address DID match is not listed as unmatched —
     * the panel would otherwise tell an operator to add a device they are
     * already looking at a link to.
     */
    it("does not list a neighbour its address matched", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            cdpNeighbors: [
              { localInterfaceIndex: 1, remoteIpAddress: "10.0.0.42" },
            ],
          }),
          makeDevice("d2", "some-phone", { hostname: "10.0.0.42" }),
        ],
        now,
      );

      expect(
        nodeById(result, "d1")?.diagnostics?.unmatchedNeighborIdentifiers,
      ).toEqual([]);
      expect(result.edges).toHaveLength(1);
    });
  });

  /*
   * The point of the whole feature (#3435): the operator clicks "Add to
   * Monitoring" on a stranger, a NetworkDevice is created from what the map
   * already knew, and on the very next graph build that stranger IS the new
   * device — same cable, same port, no second node floating beside it.
   */
  describe("adopting an unmanaged peer into a device", () => {
    const switchWithPhone: (
      overrides?: Partial<TopologyDeviceInput>,
    ) => TopologyDeviceInput = (
      overrides?: Partial<TopologyDeviceInput>,
    ): TopologyDeviceInput => {
      return makeDevice("switch-1", "UN1289LANSWI01", {
        sysName: "UN1289LANSWI01",
        cdpNeighbors: [
          {
            localInterfaceIndex: 12,
            remoteDeviceId: "SEP6026AAF2B46B",
            remotePortId: "SW PORT",
            remotePlatform: "Cisco IP Phone 8811",
            remoteIpAddress: "10.0.12.41",
          },
        ],
        ...overrides,
      });
    };

    it("collapses the stranger into a device created under its advertised name", () => {
      const before: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [switchWithPhone()],
        now,
      );

      expect(nodeById(before, "unmanaged:sep6026aaf2b46b")).toBeDefined();

      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          switchWithPhone(),
          // Exactly what the adoption form pre-fills.
          makeDevice("phone-1", "SEP6026AAF2B46B", {
            hostname: "10.0.12.41",
          }),
        ],
        now,
      );

      expect(nodeById(after, "unmanaged:sep6026aaf2b46b")).toBeUndefined();
      expect(after.edges).toHaveLength(1);
      expect(
        [after.edges[0]!.fromNodeId, after.edges[0]!.toNodeId].sort(),
      ).toEqual(["phone-1", "switch-1"]);
    });

    /*
     * Renaming an adopted device to something a human can read is the first
     * thing anybody does, and it breaks the name match outright — the
     * comparison is trim-and-lowercase and nothing more. The address is what
     * survives it, which is why the form pre-fills the hostname from the
     * advertised address rather than leaving it to the operator.
     */
    it("still collapses when the device is renamed but keeps the advertised address", () => {
      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          switchWithPhone(),
          makeDevice("phone-1", "Reception desk phone", {
            hostname: "10.0.12.41",
          }),
        ],
        now,
      );

      expect(nodeById(after, "unmanaged:sep6026aaf2b46b")).toBeUndefined();
      expect(after.edges).toHaveLength(1);
      expect(after.edges[0]!.toNodeId).toBe("phone-1");
    });

    /*
     * The failure the form warns about: rename it AND give it an address
     * nobody advertises, and the map keeps the stranger and floats the new
     * device beside it. Pinned so the warning cannot quietly stop being true.
     */
    it("keeps the stranger when the device answers to nothing the switch advertised", () => {
      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          switchWithPhone(),
          makeDevice("phone-1", "Reception desk phone", {
            hostname: "192.168.99.99",
          }),
        ],
        now,
      );

      expect(nodeById(after, "unmanaged:sep6026aaf2b46b")).toBeDefined();
      expect(after.edges).toHaveLength(1);
      expect(after.edges[0]!.toNodeId).toBe("unmanaged:sep6026aaf2b46b");
    });

    /*
     * A declared link drawn alongside the adoption merges into the SAME
     * edge rather than doubling the line, so belt-and-braces costs nothing
     * on the map.
     */
    it("merges a declared link with the rediscovered one instead of drawing two", () => {
      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          switchWithPhone(),
          makeDevice("phone-1", "SEP6026AAF2B46B", {
            hostname: "10.0.12.41",
          }),
        ],
        now,
        [],
        [],
        [
          {
            fromDeviceId: "switch-1",
            toDeviceId: "phone-1",
            fromPortName: "Gi1/0/12",
          },
        ],
      );

      expect(after.edges).toHaveLength(1);
      expect(after.edges[0]!.protocols).toEqual(
        expect.arrayContaining(["cdp", "manual"]),
      );
    });

    /*
     * The split this feature makes possible, and the reason a match now
     * travels along a peer group.
     *
     * One port, one phone, described twice: the CDP entry carries the
     * management address and finds the adopted device; the LLDP entry
     * beside it knows only the name the operator renamed away from and
     * finds nothing. Without the propagation the map draws that one phone
     * as a managed node AND as a leftover stranger, on two lines out of the
     * same port.
     */
    it("does not leave a second stranger when only one protocol carried the address", () => {
      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("switch-1", "UN1289LANSWI01", {
            sysName: "UN1289LANSWI01",
            lldpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteSysName: "SEP6026AAF2B46B",
                remotePortId: "SW PORT",
              },
            ],
            cdpNeighbors: [
              {
                localInterfaceIndex: 12,
                remoteDeviceId: "SEP6026AAF2B46B",
                remoteIpAddress: "10.0.12.41",
              },
            ],
          }),
          makeDevice("phone-1", "Reception desk phone", {
            hostname: "10.0.12.41",
          }),
        ],
        now,
      );

      expect(nodeById(after, "unmanaged:sep6026aaf2b46b")).toBeUndefined();
      expect(after.nodes).toHaveLength(2);
      expect(after.edges).toHaveLength(1);
      expect(after.edges[0]!.toNodeId).toBe("phone-1");
      expect(after.edges[0]!.protocols).toEqual(
        expect.arrayContaining(["lldp", "cdp"]),
      );
    });

    /*
     * The same carrying, in the direction that has always been broken: one
     * switch knows the peer by name and matches it, the other knows it only
     * by a chassis MAC and did not. They share an identity-grade alias, so
     * the builder already holds them to be one box — it should draw them as
     * one, not as a device plus a stranger.
     */
    it("absorbs a report that knew the peer only by a chassis id", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("sw-a", "sw-a", {
            sysName: "sw-a",
            lldpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteSysName: "ap-lobby",
                remoteChassisId: "0011.2233.4455",
              },
            ],
          }),
          makeDevice("sw-b", "sw-b", {
            sysName: "sw-b",
            lldpNeighbors: [
              { localInterfaceIndex: 2, remoteChassisId: "0011.2233.4455" },
            ],
          }),
          makeDevice("ap-1", "ap-lobby", { sysName: "ap-lobby" }),
        ],
        now,
      );

      expect(nodeById(result, "unmanaged:0011.2233.4455")).toBeUndefined();
      expect(result.nodes).toHaveLength(3);
      expect(
        result.edges.map((edge: NetworkTopologyEdge) => {
          return [edge.fromNodeId, edge.toNodeId].sort().join("::");
        }),
      ).toEqual(["ap-1::sw-a", "ap-1::sw-b"]);
    });

    /*
     * Contradictory evidence is left alone. Two reports that share an alias
     * but matched two DIFFERENT devices cannot both be right, and the
     * builder's standing rule is that a wrong cable is worse than a missing
     * one.
     */
    it("carries nothing when the group's reports matched two different devices", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("sw-a", "sw-a", {
            sysName: "sw-a",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "shared-alias",
                remoteIpAddress: "10.0.0.7",
              },
            ],
          }),
          makeDevice("sw-b", "sw-b", {
            sysName: "sw-b",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "shared-alias",
                remoteIpAddress: "10.0.0.8",
              },
            ],
          }),
          makeDevice("d-seven", "seven", { hostname: "10.0.0.7" }),
          makeDevice("d-eight", "eight", { hostname: "10.0.0.8" }),
        ],
        now,
      );

      expect(
        result.edges.map((edge: NetworkTopologyEdge) => {
          return [edge.fromNodeId, edge.toNodeId].sort().join("::");
        }),
      ).toEqual(["d-seven::sw-a", "d-eight::sw-b"]);
    });

    /*
     * And a device must never end up cabled to itself. Carrying a match
     * along a group can point a device's own report back at the device that
     * made it; an edge from a node to itself is not a cable, and the
     * per-claim match has always dropped exactly this.
     */
    it("drops a report the propagation turns into a device reporting itself", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("sw-a", "sw-a", {
            sysName: "sw-a",
            serialNumber: "SN-A-0001",
            // sw-a describes ITSELF by its serial, which is not its name.
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteChassisId: "SN-A-0001" },
            ],
          }),
          makeDevice("sw-b", "sw-b", {
            sysName: "sw-b",
            lldpNeighbors: [
              {
                localInterfaceIndex: 2,
                remoteSysName: "sw-a",
                remoteChassisId: "SN-A-0001",
              },
            ],
          }),
        ],
        now,
      );

      for (const edge of result.edges) {
        expect(edge.fromNodeId).not.toBe(edge.toNodeId);
      }
      expect(
        result.edges.map((edge: NetworkTopologyEdge) => {
          return [edge.fromNodeId, edge.toNodeId].sort().join("::");
        }),
      ).toEqual(["sw-a::sw-b"]);
    });

    /*
     * The switch's own account of itself has to keep up. A device that has
     * absorbed its stranger must stop reporting it as an unresolved
     * neighbour, or the panel would go on explaining an isolation that no
     * longer exists.
     */
    it("stops listing the peer as an unmatched neighbour once it is adopted", () => {
      const after: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          switchWithPhone(),
          makeDevice("phone-1", "SEP6026AAF2B46B", {
            hostname: "10.0.12.41",
          }),
        ],
        now,
      );

      expect(
        nodeById(after, "switch-1")?.diagnostics?.unmatchedNeighborIdentifiers,
      ).toEqual([]);
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

  /*
   * Issue #3489: a till watched by a Ping monitor alone reports no
   * neighbours and none of its neighbours report it, so it floated on the
   * map until somebody hand-drew a cable to its switch. But the switch's
   * forwarding database already names the port it is plugged into, and that
   * row is already collected as a NetworkEndpoint — so the cable is a
   * lookup. These exercise the wiring through buildTopology: that the
   * derived edge lands in the SAME edge map everything else writes to, that
   * it never overwrites something measured or declared, and that the leaf
   * the row used to draw goes away rather than doubling the box.
   *
   * The rest of the suite is untouched by all of this: makeDevice never
   * sets monitoringMethod, so no device above is ever a candidate.
   */
  describe("inferred uplinks for monitor-backed devices (#3489)", () => {
    const SWITCH_ID: string = "sw-1";
    const TILL_ID: string = "till-1";
    const TILL_MAC: string = "aa:bb:cc:dd:ee:01";
    const TILL_IP: string = "10.18.166.51";
    const ENDPOINT_ID: string = "ep-till";

    // The switch doing the placing: walked, and reading MAC tables.
    const makeSwitch: (
      overrides?: Partial<TopologyDeviceInput>,
    ) => TopologyDeviceInput = (
      overrides?: Partial<TopologyDeviceInput>,
    ): TopologyDeviceInput => {
      return makeDevice(SWITCH_ID, "switch-03", {
        siteId: "site-a",
        collectEndpoints: true,
        ...overrides,
      });
    };

    /*
     * The device being placed. Nothing walks it, so it has no lastSeenAt at
     * all — its colour comes from the bound Monitor — and its hostname is
     * its address, which is exactly what a subnet-sweep import writes and
     * the only key the ARP join has to work with.
     */
    const makeTill: (
      overrides?: Partial<TopologyDeviceInput>,
    ) => TopologyDeviceInput = (
      overrides?: Partial<TopologyDeviceInput>,
    ): TopologyDeviceInput => {
      return makeDevice(TILL_ID, "till-01", {
        siteId: "site-a",
        monitoringMethod: "Monitor",
        hostname: TILL_IP,
        monitorStatus: "up",
        lastSeenAt: undefined,
        ...overrides,
      });
    };

    // The FDB row that recognises it: fresh, provenanced, on a real port.
    const makeFdbEndpoint: (
      overrides?: Partial<TopologyEndpointInput>,
    ) => TopologyEndpointInput = (
      overrides?: Partial<TopologyEndpointInput>,
    ): TopologyEndpointInput => {
      return makeEndpoint(ENDPOINT_ID, TILL_MAC, {
        ipAddress: TILL_IP,
        vlanId: 40,
        attachedNetworkDeviceId: SWITCH_ID,
        attachedInterfaceIndex: 12,
        attachedPortName: "Gi1/0/12",
        attachmentSource: NetworkEndpointAttachmentSource.Fdb,
        attachmentLastSeenAt: fresh,
        ipAddressLastSeenAt: fresh,
        ...overrides,
      });
    };

    it("draws one edge from the switch to the device its FDB recognised", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
      );

      expect(result.edges).toHaveLength(1);
      const edges: Array<NetworkTopologyEdge> = edgesBetween(
        result,
        SWITCH_ID,
        TILL_ID,
      );
      expect(edges).toHaveLength(1);

      const edge: NetworkTopologyEdge = edges[0]!;
      expect(edge.fromNodeId).toBe(SWITCH_ID);
      expect(edge.toNodeId).toBe(TILL_ID);
      expect(edge.protocols).toEqual(["fdb", "inferred"]);
      expect(edge.fromPort).toBe("Gi1/0/12");
      /*
       * The switch is the parent: a forwarding-database entry is
       * one-directional evidence, unlike a neighbour report.
       */
      expect(edge.parentNodeId).toBe(SWITCH_ID);
      // The receipt, so a line that looks wrong can be checked.
      expect(edge.inferredFrom).toEqual({
        macAddress: TILL_MAC,
        ipAddress: TILL_IP,
        vlanId: 40,
        lastSeenAt: fresh,
        matchedOn: "ip",
      });
    });

    it("stops drawing the promoted row as a leaf, without counting it dropped", () => {
      /*
       * The box is on the map as the device it actually is, so drawing the
       * endpoint node as well would put one physical thing on the graph
       * twice — and nothing was lost, so it is not a drop either.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
      );

      expect(nodeById(result, `endpoint:${ENDPOINT_ID}`)).toBeUndefined();
      expect(result.nodes).toHaveLength(2);
      expect(result.droppedEndpointCount).toBe(0);
      expect(result.endpointsTruncated).toBe(false);
    });

    it("still draws an endpoint that matches no device exactly as before", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [
          makeFdbEndpoint(),
          makeEndpoint("ep-camera", "aa:bb:cc:dd:ee:99", {
            ipAddress: "10.18.166.99",
            attachedNetworkDeviceId: SWITCH_ID,
            attachedInterfaceIndex: 13,
            attachedPortName: "Gi1/0/13",
            attachmentSource: NetworkEndpointAttachmentSource.Fdb,
            attachmentLastSeenAt: fresh,
          }),
        ],
      );

      const leaf: NetworkTopologyNode | undefined = nodeById(
        result,
        "endpoint:ep-camera",
      );
      expect(leaf).toBeDefined();
      expect(leaf!.kind).toBe("endpoint");

      const leafEdges: Array<NetworkTopologyEdge> = edgesBetween(
        result,
        SWITCH_ID,
        "endpoint:ep-camera",
      );
      expect(leafEdges).toHaveLength(1);
      expect(leafEdges[0]!.protocols).toEqual(["fdb"]);
      expect(leafEdges[0]!.fromPort).toBe("Gi1/0/13");

      // ...while the recognised one is still promoted rather than drawn.
      expect(nodeById(result, `endpoint:${ENDPOINT_ID}`)).toBeUndefined();
      expect(result.edges).toHaveLength(2);
      expect(result.droppedEndpointCount).toBe(0);
    });

    it("merges into an operator's declared link instead of doubling the line", () => {
      /*
       * Two lines between one pair of boxes reads as two physical cables.
       * A hand-drawn link the inference later confirms has to cost nothing.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
        [{ fromDeviceId: TILL_ID, toDeviceId: SWITCH_ID, name: "hand drawn" }],
      );

      expect(result.edges).toHaveLength(1);
      expect(edgesBetween(result, SWITCH_ID, TILL_ID)).toHaveLength(1);

      const edge: NetworkTopologyEdge = result.edges[0]!;
      expect(edge.protocols).toEqual(["manual", "fdb", "inferred"]);
      expect(edge.name).toBe("hand drawn");
      // The declared link put the till first, so the switch end is `to`.
      expect(edge.toNodeId).toBe(SWITCH_ID);
      expect(edge.toPort).toBe("Gi1/0/12");
      expect(edge.inferredFrom?.macAddress).toBe(TILL_MAC);
    });

    it("keeps a declared parent even when it is the opposite end", () => {
      /*
       * The guard that stops an operator's hierarchy being destroyed by a
       * guess: a layout handed two different parents for one child discards
       * both, so the declaration wins outright rather than being merged.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
        [
          {
            fromDeviceId: TILL_ID,
            toDeviceId: SWITCH_ID,
            parentDeviceId: TILL_ID,
          },
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.parentNodeId).toBe(TILL_ID);
      expect(result.edges[0]!.protocols).toContain("inferred");
    });

    it("never overwrites a measured LLDP port with the forwarding-database one", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeSwitch({
            sysName: "switch-03",
            lldpNeighbors: [
              {
                localInterfaceIndex: 24,
                remoteSysName: "till-01-lldp",
                remotePortId: "eth0",
              },
            ],
          }),
          makeTill({ sysName: "till-01-lldp" }),
        ],
        now,
        [
          {
            networkDeviceId: SWITCH_ID,
            interfaceIndex: 24,
            name: "GigabitEthernet1/0/24",
            isOperationallyUp: true,
            utilizationPercent: 3,
          },
        ],
        [makeFdbEndpoint()],
      );

      expect(result.edges).toHaveLength(1);
      const edge: NetworkTopologyEdge = result.edges[0]!;
      expect(edge.protocols).toEqual(["lldp", "fdb", "inferred"]);
      // Measured on both counts — the FDB row named port 12, and lost.
      expect(edge.fromPort).toBe("GigabitEthernet1/0/24");
      expect(edge.fromInterface?.interfaceIndex).toBe(24);
      expect(edge.fromInterface?.utilizationPercent).toBe(3);
      expect(edge.toPort).toBe("eth0");
      // The receipt still rides along, and LLDP stated no parent.
      expect(edge.inferredFrom?.macAddress).toBe(TILL_MAC);
      expect(edge.parentNodeId).toBe(SWITCH_ID);
    });

    it("labels the port from the switch's interface row, not the stored name", () => {
      /*
       * `attachedPortName` is COALESCEd on write, so it can survive from the
       * PREVIOUS switch when an endpoint moves. Harmless on a leaf label; on
       * a cable it would send somebody to the wrong socket of the right
       * switch. The NetworkInterface row is keyed on (this switch, this
       * ifIndex) and cannot go stale that way, so it wins.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [
          {
            networkDeviceId: SWITCH_ID,
            interfaceIndex: 12,
            name: "GigabitEthernet1/0/12",
            isOperationallyUp: true,
            utilizationPercent: 4,
          },
        ],
        [makeFdbEndpoint({ attachedPortName: "Fa0/3-on-the-old-switch" })],
      );

      const edge: NetworkTopologyEdge = edgesBetween(
        result,
        SWITCH_ID,
        TILL_ID,
      )[0]!;
      expect(edge.fromPort).toBe("GigabitEthernet1/0/12");
      expect(edge.fromInterface?.interfaceIndex).toBe(12);
      expect(edge.fromInterface?.isOperationallyUp).toBe(true);
      expect(edge.fromInterface?.utilizationPercent).toBe(4);
    });

    it("does not promote an endpoint the project has hidden", () => {
      /*
       * Promoting a hidden row would silently undo the operator's choice —
       * the box comes back, now as a cable — and leave the suppression row
       * pointing at a node that no longer exists, so they could never
       * un-hide it either.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
        [],
        new Set<string>([`endpoint:${ENDPOINT_ID}`]),
      );

      expect(edgesBetween(result, SWITCH_ID, TILL_ID)).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(nodeById(result, `endpoint:${ENDPOINT_ID}`)).toBeUndefined();
      expect(result.suppressedNodeCount).toBe(1);
      expect(result.uplinkInferenceRefusals).toEqual([]);
    });

    it("infers nothing at all from a capped endpoint page, and says so", () => {
      /*
       * Both count-based guards — transit-port occupancy, and two rows
       * claiming one address — undercount on a sample, and undercounting
       * makes each of them ACCEPT what it exists to refuse.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
        [],
        new Set<string>(),
        true,
      );

      expect(edgesBetween(result, SWITCH_ID, TILL_ID)).toHaveLength(0);
      expect(
        result.edges.some((edge: NetworkTopologyEdge) => {
          return (edge.protocols || []).includes("inferred");
        }),
      ).toBe(false);
      // Nothing was promoted, so the row is an ordinary leaf again.
      expect(nodeById(result, `endpoint:${ENDPOINT_ID}`)).toBeDefined();
      expect(result.uplinkInferenceRefusals).toEqual([
        { deviceId: TILL_ID, reason: "endpointListTruncated" },
      ]);
    });

    it("moves the endpoint's identity onto the device node it turned out to be", () => {
      /*
       * The leaf that used to hold the MAC, the address and the VLAN is no
       * longer drawn, so without this the VLAN filter quietly loses every
       * promoted device and the search stops finding it by address.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeSwitch(), makeTill()],
        now,
        [],
        [makeFdbEndpoint()],
      );

      const node: NetworkTopologyNode = nodeById(result, TILL_ID)!;
      expect(node.kind).toBe("device");
      expect(node.macAddress).toBe(TILL_MAC);
      expect(node.ipAddress).toBe(TILL_IP);
      expect(node.vlanId).toBe(40);
    });

    it("reports uplink refusals on both return paths", () => {
      /*
       * "No cable was drawn" has to become a sentence somebody can act on,
       * and the suppression path returns from a different statement — so it
       * is the one that would silently lose the warnings.
       */
      const devices: Array<TopologyDeviceInput> = [
        makeSwitch({ collectEndpoints: false }),
        makeTill(),
      ];
      const expected: Array<UplinkRefusal> = [
        { deviceId: TILL_ID, reason: "endpointCollectionOff" },
      ];

      const plain: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
      );
      const suppressed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
        [],
        new Set<string>([SWITCH_ID]),
      );

      expect(plain.uplinkInferenceRefusals).toEqual(expected);
      expect(suppressed.uplinkInferenceRefusals).toEqual(expected);
      expect(suppressed.suppressedNodeCount).toBe(1);
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
