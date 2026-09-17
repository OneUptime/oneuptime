import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyManualLinkInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Issue #3192. Two things the map could not previously express, and both
 * of them are statements a PERSON made rather than something SNMP said:
 *
 *   - what a device IS, on a box nothing walks. The classifier is
 *     evidence-driven and a ping-only device offers it a hostname and
 *     nothing else, so `NetworkDevice.deviceRole` is the only answer
 *     available at all — and it outranks the classifier when both speak.
 *   - which end of a link is the PARENT. LLDP and CDP report a cable, not
 *     a hierarchy, so `NetworkDeviceLink.parentDeviceId` is carried onto
 *     the edge as `parentNodeId` for the layouts to honour.
 *
 * Both travel through buildTopology, which is what this file exercises:
 * the units are tested next door, this is the wiring.
 */
describe("NetworkTopologyUtil.buildTopology — operator-declared role and hierarchy", () => {
  const now: Date = new Date("2026-07-22T12:00:00Z");
  const fresh: Date = new Date("2026-07-22T11:55:00Z");

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
   * fromNodeId depends on who reported the link first — so they are looked
   * up by the unordered pair, exactly the way the builder keys them.
   */
  const edgeBetween: (
    result: TopologyBuildResult,
    a: string,
    b: string,
  ) => NetworkTopologyEdge | undefined = (
    result: TopologyBuildResult,
    a: string,
    b: string,
  ): NetworkTopologyEdge | undefined => {
    const wanted: string = [a, b].sort().join("::");
    return result.edges.find((edge: NetworkTopologyEdge) => {
      return [edge.fromNodeId, edge.toNodeId].sort().join("::") === wanted;
    });
  };

  describe("the operator's device role override", () => {
    it("gives a role to a ping-only device the classifier could never place", () => {
      /*
       * The case the column exists for. Nothing walks this box, so there is
       * no sysDescr, no sysObjectId, no model — and "ping-only-42" is not a
       * naming convention the classifier recognises. Without the override
       * this node is drawn "unknown" forever.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "ping-only-42", { deviceRole: "switch" }),
          makeDevice("d2", "ping-only-43"),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("switch");
      // The control: same absence of evidence, no override, still unknown.
      expect(nodeById(result, "d2")!.role).toBe("unknown");
    });

    it("outranks an SNMP identity that says something else entirely", () => {
      /*
       * The override is the only statement about the role that is not an
       * inference, so it wins even against tier-1 evidence. Real cause: a
       * chassis re-purposed as something its sysDescr never caught up with.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
            deviceRole: "firewall",
          }),
          makeDevice("d2", "dmz-1", {
            sysObjectId: "1.3.6.1.4.1.3375.2.1.3.4.10",
            deviceRole: "router",
          }),
        ],
        now,
      );

      // Classifier alone would answer "switch" and "loadBalancer" here.
      expect(nodeById(result, "d1")!.role).toBe("firewall");
      expect(nodeById(result, "d2")!.role).toBe("router");
    });

    it("leaves the classifier's answer alone when no override is stored", () => {
      /*
       * The override must be additive: every device that had a correctly
       * derived role before the column existed has to keep it.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", { sysDescr: "FortiGate-60F v7.2.5" }),
          makeDevice("d2", "edge-2", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: undefined,
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("firewall");
      expect(nodeById(result, "d2")!.role).toBe("firewall");
    });

    it("falls back to the classifier rather than blanking a role it cannot parse", () => {
      /*
       * An override nobody can read is not an instruction to draw a neutral
       * node — it is no instruction at all, so the evidence gets its say.
       * "cor switch" is the shape a typo takes; the empty and whitespace
       * cases are what an operator clearing the field actually stores.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: "cor switch",
          }),
          makeDevice("d2", "edge-2", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: "",
          }),
          makeDevice("d3", "edge-3", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: "   ",
          }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("firewall");
      expect(nodeById(result, "d2")!.role).toBe("firewall");
      expect(nodeById(result, "d3")!.role).toBe("firewall");
    });

    it("refuses 'unknown' as an override so the classifier still gets to run", () => {
      /*
       * Storing "unknown" would silently disable the classifier on a device
       * the operator was only declining to classify. d1 proves the evidence
       * still wins; d2 proves the refusal is not itself an error — a device
       * with nothing to go on lands on "unknown" via the classifier.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: "unknown",
          }),
          makeDevice("d2", "device-42", { deviceRole: "unknown" }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("firewall");
      expect(nodeById(result, "d2")!.role).toBe("unknown");
    });

    it("reads the stored value case-insensitively and ignores surrounding space", () => {
      /*
       * The column is ShortText, so what lands in it depends on which form
       * or import wrote it. A role that only applies when it was typed in
       * exactly the internal camelCase spelling would be a trap.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "a", { deviceRole: "SWITCH" }),
          makeDevice("d2", "b", { deviceRole: "  Router  " }),
          makeDevice("d3", "c", { deviceRole: "wirelessaccesspoint" }),
          makeDevice("d4", "d", { deviceRole: "loadBalancer" }),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("switch");
      expect(nodeById(result, "d2")!.role).toBe("router");
      expect(nodeById(result, "d3")!.role).toBe("wirelessAccessPoint");
      expect(nodeById(result, "d4")!.role).toBe("loadBalancer");
    });

    it("applies the override to the device that owns it and to nothing else", () => {
      /*
       * A role is a per-node property. The unmanaged peer d1 reports is a
       * different box that nobody has overridden, and it must keep being
       * classified from what it advertises about itself.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysName: "edge-1",
            deviceRole: "firewall",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "ap-lobby",
                remotePlatform: "cisco AIR-CAP3702I-A-K9",
              },
            ],
          }),
          makeDevice("d2", "device-99"),
        ],
        now,
      );

      expect(nodeById(result, "d1")!.role).toBe("firewall");
      expect(nodeById(result, "unmanaged:ap-lobby")!.role).toBe(
        "wirelessAccessPoint",
      );
      expect(nodeById(result, "d2")!.role).toBe("unknown");
    });

    it("resolves every device's role independently of the order they arrive in", () => {
      /*
       * Devices come off a query whose order is not guaranteed. A role that
       * depended on it would make the map flicker between rebuilds.
       */
      const devices: Array<TopologyDeviceInput> = [
        makeDevice("d1", "core-1", {
          sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
          deviceRole: "firewall",
        }),
        makeDevice("d2", "edge-1", { sysDescr: "FortiGate-60F v7.2.5" }),
        makeDevice("d3", "ping-only", { deviceRole: "router" }),
      ];

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...devices].reverse(),
        now,
      );

      for (const deviceId of ["d1", "d2", "d3"]) {
        expect(nodeById(reversed, deviceId)!.role).toBe(
          nodeById(forward, deviceId)!.role,
        );
      }
      expect(nodeById(forward, "d1")!.role).toBe("firewall");
      expect(nodeById(forward, "d2")!.role).toBe("firewall");
      expect(nodeById(forward, "d3")!.role).toBe("router");
    });
  });

  describe("the parent an operator declared on a link", () => {
    it("carries a parent declared as the link's 'from' end onto the edge", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "access-1")],
        now,
        [],
        [],
        [{ fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" }],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.parentNodeId).toBe("d1");
    });

    it("carries a parent declared as the link's 'to' end just the same", () => {
      /*
       * Which column the operator's parent landed in is an artefact of how
       * they drew the link. The declaration names an END, not a side.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "access-1"), makeDevice("d2", "core-1")],
        now,
        [],
        [],
        [{ fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d2" }],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.parentNodeId).toBe("d2");
    });

    it("still draws the link when the declared parent is a third device", () => {
      /*
       * A parent that is not on the link cannot be rendered as one, so the
       * declaration is dropped — but the CABLE is a separate fact and it is
       * still real. Losing the line as well would delete information the
       * operator did get right.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1"),
          makeDevice("d2", "access-1"),
          makeDevice("d3", "bystander"),
        ],
        now,
        [],
        [],
        [
          {
            fromDeviceId: "d1",
            toDeviceId: "d2",
            name: "IDF-2 uplink",
            parentDeviceId: "d3",
          },
        ],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "d1",
        "d2",
      );
      expect(edge).toBeDefined();
      expect(edge!.name).toBe("IDF-2 uplink");
      expect(edge!.parentNodeId).toBeUndefined();
      // The bystander gains nothing from having been named.
      expect(edgeBetween(result, "d1", "d3")).toBeUndefined();
      expect(edgeBetween(result, "d2", "d3")).toBeUndefined();
    });

    it("skips a link with an end outside the graph, declaration or not", () => {
      /*
       * A site-scoped map, or a link to a device since archived. A declared
       * parent does not make an unattachable link attachable — the pre-existing
       * skip has to happen before the declaration is even looked at.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1")],
        now,
        [],
        [],
        [
          {
            fromDeviceId: "d1",
            toDeviceId: "d-elsewhere",
            parentDeviceId: "d1",
          },
          {
            fromDeviceId: "d-elsewhere",
            toDeviceId: "d1",
            parentDeviceId: "d-elsewhere",
          },
        ],
      );

      expect(result.edges).toHaveLength(0);
    });

    it("leaves a purely discovered edge with no parent at all", () => {
      /*
       * LLDP reports a cable, not a hierarchy: the direction a neighbour
       * entry happens to be read from says nothing about which box is
       * upstream. Absent must mean "not stated" so the layout keeps
       * inferring instead of trusting an accident of polling order.
       */
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
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["lldp"]);
      expect(result.edges[0]!.parentNodeId).toBeUndefined();
    });

    it("declares the same parent whichever order the devices were queried in", () => {
      const devices: Array<TopologyDeviceInput> = [
        makeDevice("d1", "core-1"),
        makeDevice("d2", "access-1"),
      ];
      const links: Array<TopologyManualLinkInput> = [
        { fromDeviceId: "d2", toDeviceId: "d1", parentDeviceId: "d1" },
      ];

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
        links,
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...devices].reverse(),
        now,
        [],
        [],
        links,
      );

      expect(forward.edges[0]!.parentNodeId).toBe("d1");
      expect(reversed.edges[0]!.parentNodeId).toBe("d1");
    });
  });

  describe("merging a declared parent into an edge that already exists", () => {
    it("keeps one edge carrying both protocols and the declaration", () => {
      /*
       * The whole point of merging rather than doubling: an operator who
       * declares the hierarchy on a cable LLDP already found must not end
       * up with two lines between one pair of boxes.
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
        [{ fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d2" }],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["lldp", "manual"]);
      // The measured port survives; the declaration has no discovered rival.
      expect(result.edges[0]!.toPort).toBe("Gi0/1");
      expect(result.edges[0]!.parentNodeId).toBe("d2");
    });

    it("names the parent by END, not by which side the discovered edge stored", () => {
      /*
       * d2 is the one that reported the neighbour, so the edge is stored
       * d2 -> d1 while the operator drew their link d1 -> d2. If the merge
       * copied a SIDE rather than an id, the hierarchy would come out
       * upside down for exactly half the estate.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", { sysName: "core-1" }),
          makeDevice("d2", "access-1", {
            sysName: "access-1",
            lldpNeighbors: [
              { localInterfaceIndex: 1, remoteSysName: "core-1" },
            ],
          }),
        ],
        now,
        [],
        [],
        [{ fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" }],
      );

      expect(result.edges).toHaveLength(1);
      // The discovered direction is untouched...
      expect(result.edges[0]!.fromNodeId).toBe("d2");
      expect(result.edges[0]!.toNodeId).toBe("d1");
      // ...and the parent is still the core switch the operator named.
      expect(result.edges[0]!.parentNodeId).toBe("d1");
      expect(result.edges[0]!.protocols).toEqual(["lldp", "manual"]);
    });

    it("keeps the FIRST declaration when two links over one pair disagree", () => {
      /*
       * Mirrors the ordering the caller already relies on: explicit links
       * are merged before rule-derived ones, so a hierarchy set on the link
       * itself beats a rule that happens to cover the same pair. The
       * specific statement beats the general one — the same precedence the
       * ports and the name use.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "access-1")],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d2" },
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.parentNodeId).toBe("d1");
    });

    it("takes the second link's declaration when the first stated none", () => {
      /*
       * "First wins" is about first STATEMENT, not first row: a silent link
       * has nothing to defend, so a later one that does name a parent fills
       * the gap rather than being ignored.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "access-1")],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d2", name: "cable A" },
          { fromDeviceId: "d2", toDeviceId: "d1", parentDeviceId: "d1" },
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.name).toBe("cable A");
      expect(result.edges[0]!.parentNodeId).toBe("d1");
    });

    it("never lets an unparseable declaration displace a valid one, in either order", () => {
      /*
       * A parent naming a third device contributes nothing at all, so the
       * one real declaration has to survive whichever row it sits in. This
       * is the order-independence that matters: only DISAGREEING valid
       * declarations are allowed to depend on ordering.
       */
      const validFirst: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1"),
          makeDevice("d2", "access-1"),
          makeDevice("d3", "bystander"),
        ],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d3" },
        ],
      );

      const invalidFirst: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [
            makeDevice("d1", "core-1"),
            makeDevice("d2", "access-1"),
            makeDevice("d3", "bystander"),
          ],
          now,
          [],
          [],
          [
            { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d3" },
            { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
          ],
        );

      expect(edgeBetween(validFirst, "d1", "d2")!.parentNodeId).toBe("d1");
      expect(edgeBetween(invalidFirst, "d1", "d2")!.parentNodeId).toBe("d1");
    });

    it("is order-independent when two links agree about the parent", () => {
      /*
       * Two rows saying the same thing — an explicit link and a rule that
       * derived the same hierarchy — must not depend on merge order at all.
       */
      const links: Array<TopologyManualLinkInput> = [
        { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
        // Stored the other way round, same declaration.
        { fromDeviceId: "d2", toDeviceId: "d1", parentDeviceId: "d1" },
      ];
      const devices: Array<TopologyDeviceInput> = [
        makeDevice("d1", "core-1"),
        makeDevice("d2", "access-1"),
      ];

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
        links,
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
        [...links].reverse(),
      );

      expect(forward.edges).toHaveLength(1);
      expect(reversed.edges).toHaveLength(1);
      expect(forward.edges[0]!.parentNodeId).toBe("d1");
      expect(reversed.edges[0]!.parentNodeId).toBe("d1");
    });

    it("declares a parent on one pair without touching the pairs around it", () => {
      /*
       * A three-device chain where only the middle cable is declared. The
       * layout has to be able to tell a stated hierarchy from an inferred
       * one per edge, so a declaration must not bleed sideways.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1"),
          makeDevice("d2", "dist-1"),
          makeDevice("d3", "access-1"),
        ],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
          { fromDeviceId: "d2", toDeviceId: "d3" },
        ],
      );

      expect(result.edges).toHaveLength(2);
      expect(edgeBetween(result, "d1", "d2")!.parentNodeId).toBe("d1");
      expect(edgeBetween(result, "d2", "d3")!.parentNodeId).toBeUndefined();
    });

    it("keeps declarations off the fdb edges that hang endpoints on a switch", () => {
      /*
       * Endpoint attachment is measured, not declared, and its edges are
       * appended after the manual merge entirely. A declared parent on the
       * uplink must not leak onto them.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [makeDevice("d1", "core-1"), makeDevice("d2", "access-1")],
        now,
        [],
        [
          {
            id: "ep-1",
            macAddress: "aa:bb:cc:dd:ee:01",
            attachedNetworkDeviceId: "d2",
            lastSeenAt: fresh,
          },
        ],
        [{ fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" }],
      );

      expect(edgeBetween(result, "d1", "d2")!.parentNodeId).toBe("d1");
      const fdbEdge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "d2",
        "endpoint:ep-1",
      );
      expect(fdbEdge).toBeDefined();
      expect(fdbEdge!.protocols).toEqual(["fdb"]);
      expect(fdbEdge!.parentNodeId).toBeUndefined();
    });
  });

  describe("both declarations on one graph", () => {
    it("draws a ping-only access switch under its declared parent", () => {
      /*
       * The end-to-end shape of issue #3192: a device that only answers
       * ping, given a role by hand and hung under a core switch by hand,
       * with neither statement needing SNMP to have said anything.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1", {
            sysName: "core-1",
            sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
          }),
          makeDevice("d2", "idf2-ping-only", {
            deviceRole: "switch",
            lastSeenAt: undefined,
            monitorStatus: "up",
            isNeighborDiscoveryEnabled: false,
          }),
        ],
        now,
        [],
        [],
        [
          {
            fromDeviceId: "d2",
            toDeviceId: "d1",
            name: "IDF-2 uplink",
            parentDeviceId: "d1",
          },
        ],
      );

      expect(nodeById(result, "d1")!.role).toBe("switch");
      expect(nodeById(result, "d2")!.role).toBe("switch");
      expect(nodeById(result, "d2")!.status).toBe("up");

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.protocols).toEqual(["manual"]);
      expect(result.edges[0]!.name).toBe("IDF-2 uplink");
      expect(result.edges[0]!.parentNodeId).toBe("d1");
    });

    it("drops a declared parent along with the node the project hid", () => {
      /*
       * Suppression runs last, on the finished graph, and takes an edge's
       * declaration with the edge. What must NOT happen is the hierarchy
       * surviving as a dangling reference to a node nobody draws.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "core-1"),
          makeDevice("d2", "dist-1"),
          makeDevice("d3", "access-1"),
        ],
        now,
        [],
        [],
        [
          { fromDeviceId: "d1", toDeviceId: "d2", parentDeviceId: "d1" },
          { fromDeviceId: "d2", toDeviceId: "d3", parentDeviceId: "d2" },
        ],
        new Set<string>(["d1"]),
      );

      expect(nodeById(result, "d1")).toBeUndefined();
      expect(result.suppressedNodeCount).toBe(1);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.parentNodeId).toBe("d2");
      // No edge left pointing at the hidden parent.
      for (const edge of result.edges) {
        expect(edge.parentNodeId).not.toBe("d1");
      }
    });
  });
});
