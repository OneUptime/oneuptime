import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
  TopologyInterfaceInput,
  TopologyManualLinkInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import { TopologyDeviceRoleInput } from "../../../Utils/Monitor/NetworkDeviceRoleCatalog";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Issue #3489. A ping-only register, handset or kiosk has no LLDP and no
 * CDP, so until now its cable had to be drawn by hand. But the switch it
 * hangs off has already learned its MAC on an access port, and the router
 * has already bound that MAC to an address — both of which the endpoint
 * inventory keeps, one NetworkEndpoint row per learned MAC. The map used
 * to draw that row as a second, anonymous "endpoint" node hanging off the
 * switch while the device's own node floated with no link at all.
 *
 * The adoption pass in buildTopology is what recognises the two as one
 * box: by the MAC the operator declared (or the ARP pass learned), or by
 * the device's address within the site that learned it. This file pins
 * every rule of that pass — what matches, what refuses to, what the cable
 * looks like, which end is the parent, how it merges with a link that is
 * already there, and how the bookkeeping adds up. The builder is pure, so
 * every case is a plain call.
 */
describe("NetworkTopologyUtil.buildTopology — endpoints that are managed devices (#3489)", () => {
  const now: Date = new Date("2026-07-22T12:00:00Z");
  const fresh: Date = new Date("2026-07-22T11:55:00Z");
  const stale: Date = new Date("2026-07-22T11:30:00Z");

  const SITE_A: string = "site-a";
  const SITE_B: string = "site-b";

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

  const endpointNodes: (
    result: TopologyBuildResult,
  ) => Array<NetworkTopologyNode> = (
    result: TopologyBuildResult,
  ): Array<NetworkTopologyNode> => {
    return result.nodes.filter((node: NetworkTopologyNode) => {
      return node.kind === "endpoint";
    });
  };

  /*
   * The shape the issue describes, reused wherever the test is about
   * something other than the match itself: one access switch, one register
   * nothing walks (hostname is its address, nothing else known), and the
   * row the switch's forwarding table wrote about it once the router's ARP
   * table had bound the MAC to that address.
   */
  const accessSwitch: (
    overrides?: Partial<TopologyDeviceInput>,
  ) => TopologyDeviceInput = (
    overrides?: Partial<TopologyDeviceInput>,
  ): TopologyDeviceInput => {
    return makeDevice("sw", "access-sw-1", {
      deviceRole: "switch",
      siteId: SITE_A,
      ...overrides,
    });
  };

  const register: (
    overrides?: Partial<TopologyDeviceInput>,
  ) => TopologyDeviceInput = (
    overrides?: Partial<TopologyDeviceInput>,
  ): TopologyDeviceInput => {
    return makeDevice("till", "till-4", {
      hostname: "10.0.0.5",
      siteId: SITE_A,
      ...overrides,
    });
  };

  const registerRow: (
    overrides?: Partial<TopologyEndpointInput>,
  ) => TopologyEndpointInput = (
    overrides?: Partial<TopologyEndpointInput>,
  ): TopologyEndpointInput => {
    return makeEndpoint("e-till", "aa:bb:cc:00:00:01", {
      ipAddress: "10.0.0.5",
      attachedNetworkDeviceId: "sw",
      attachedInterfaceIndex: 7,
      attachedPortName: "Gi1/0/7",
      siteId: SITE_A,
      ...overrides,
    });
  };

  describe("recognising a device by its address", () => {
    it("draws the register's cable from the switch that learned its address, and mints no stranger", () => {
      /*
       * The whole of issue #3489 in one picture: the row that used to be an
       * anonymous "endpoint" node is the register, so the fdb evidence
       * draws the register's own cable — the port from the forwarding
       * table, the interface state from the switch's interface row — and
       * nothing else is added to the map.
       */
      const interfaces: Array<TopologyInterfaceInput> = [
        {
          networkDeviceId: "sw",
          interfaceIndex: 7,
          name: "GigabitEthernet1/0/7",
          isOperationallyUp: true,
          utilizationPercent: 3,
        },
      ];

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        interfaces,
        [registerRow()],
      );

      expect(nodeById(result, "endpoint:e-till")).toBeUndefined();
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);

      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.fromNodeId).toBe("sw");
      expect(edge.toNodeId).toBe("till");
      expect(edge.protocols).toEqual(["fdb"]);
      // The port the table named, not the interface row's longer spelling.
      expect(edge.fromPort).toBe("Gi1/0/7");
      expect(edge.fromInterface).toEqual({
        interfaceIndex: 7,
        interfaceName: "GigabitEthernet1/0/7",
        isOperationallyUp: true,
        utilizationPercent: 3,
      });
      expect(edge.toPort).toBeUndefined();
      expect(edge.toInterface).toBeUndefined();
      // A register with no role hangs off the switch that learned it.
      expect(edge.parentNodeId).toBe("sw");

      expect(result.adoptedEndpointCount).toBe(1);
      expect(result.droppedEndpointCount).toBe(0);
      expect(result.endpointsTruncated).toBe(false);
    });

    it("refuses an address match across sites", () => {
      /*
       * Every branch has a 10.0.0.5. A switch in site B learning a MAC
       * that answers at that address says nothing about the register in
       * site A, so the row stays a stranger and the register keeps
       * floating — which is the honest drawing, not a regression.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch({ siteId: SITE_B }), register({ siteId: SITE_A })],
        now,
        [],
        [registerRow({ siteId: SITE_B })],
      );

      expect(nodeById(result, "endpoint:e-till")).toBeDefined();
      expect(edgeBetween(result, "sw", "till")).toBeUndefined();
      expect(edgeBetween(result, "sw", "endpoint:e-till")).toBeDefined();
      expect(result.edges).toHaveLength(1);
      expect(result.adoptedEndpointCount).toBe(0);
      expect(result.droppedEndpointCount).toBe(0);
    });

    it("matches project-wide when neither side has a site", () => {
      /*
       * A project that never set sites up still has to get its registers
       * cabled: "no site" is a site of its own, and it is the same one on
       * both sides.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch({ siteId: undefined }), register({ siteId: undefined })],
        now,
        [],
        [registerRow({ siteId: undefined })],
      );

      expect(edgeBetween(result, "sw", "till")).toBeDefined();
      expect(nodeById(result, "endpoint:e-till")).toBeUndefined();
      expect(result.adoptedEndpointCount).toBe(1);
    });

    it("reads a blank site as no site at all", () => {
      /*
       * The convention NetworkDeviceLinkRuleUtil already uses: null,
       * undefined, "" and whitespace all mean "not in a site". A device
       * whose siteId came through as a padded string must not be stranded
       * in a site of one.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch({ siteId: "" }), register({ siteId: "   " })],
        now,
        [],
        [registerRow({ siteId: undefined })],
      );

      expect(edgeBetween(result, "sw", "till")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(1);
    });

    it("does not match a device in a site against a row with none, nor the reverse", () => {
      /*
       * Half-configured sites are the dangerous middle: a row with no site
       * would otherwise match the one register in the project that has
       * that address AND no site — and then, once that register was moved
       * into a site, silently stop. Either side missing a site the other
       * has is a different site.
       */
      const deviceSited: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [accessSwitch({ siteId: undefined }), register({ siteId: SITE_A })],
          now,
          [],
          [registerRow({ siteId: undefined })],
        );
      expect(edgeBetween(deviceSited, "sw", "till")).toBeUndefined();
      expect(nodeById(deviceSited, "endpoint:e-till")).toBeDefined();
      expect(deviceSited.adoptedEndpointCount).toBe(0);

      const rowSited: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch({ siteId: SITE_A }), register({ siteId: undefined })],
        now,
        [],
        [registerRow({ siteId: SITE_A })],
      );
      expect(edgeBetween(rowSited, "sw", "till")).toBeUndefined();
      expect(nodeById(rowSited, "endpoint:e-till")).toBeDefined();
      expect(rowSited.adoptedEndpointCount).toBe(0);
    });

    it("never reads a device NAME that looks like an address as its address", () => {
      /*
       * The same line matchKeysForDevice draws for neighbour claims. A
       * name is an operator's label; one that happens to be an IP literal
       * is not a claim that the device answers there, and a cable drawn to
       * the wrong box is worse than none.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch(),
          makeDevice("kps", "10.0.0.5", { hostname: "kps-01", siteId: SITE_A }),
        ],
        now,
        [],
        [registerRow()],
      );

      expect(edgeBetween(result, "sw", "kps")).toBeUndefined();
      expect(nodeById(result, "endpoint:e-till")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(0);
    });

    it("never resolves a DNS hostname, and never treats a non-IPv4 address as one", () => {
      /*
       * Only a literal counts on either side. A lookup in the builder
       * would be a per-node network call whose answer changes between
       * rebuilds; a v6 literal or an out-of-range quad is not something
       * the ARP pass could have bound a MAC to.
       */
      const dnsName: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ hostname: "till-4.store.local" })],
        now,
        [],
        [registerRow()],
      );
      expect(edgeBetween(dnsName, "sw", "till")).toBeUndefined();
      expect(dnsName.adoptedEndpointCount).toBe(0);

      const ipv6Row: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [registerRow({ ipAddress: "fe80::1" })],
      );
      expect(edgeBetween(ipv6Row, "sw", "till")).toBeUndefined();
      expect(nodeById(ipv6Row, "endpoint:e-till")).toBeDefined();
      expect(ipv6Row.adoptedEndpointCount).toBe(0);

      // Both sides say "999.1.1.1"; neither side is an address.
      const badQuad: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ hostname: "999.1.1.1" })],
        now,
        [],
        [registerRow({ ipAddress: "999.1.1.1" })],
      );
      expect(edgeBetween(badQuad, "sw", "till")).toBeUndefined();
      expect(badQuad.adoptedEndpointCount).toBe(0);
    });

    it("drops a matching row whose attachment is not on this map, rather than adopting it", () => {
      /*
       * Adoption needs a switch end to draw from. A row attached to a
       * device outside the graph (archived, or in another site's query)
       * or to nothing at all is dropped and counted exactly as it was
       * before — its address matching the register changes nothing,
       * because there is no port to put the register on.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [
          registerRow({ attachedNetworkDeviceId: "ghost-switch" }),
          makeEndpoint("e-loose", "aa:bb:cc:00:00:02", {
            ipAddress: "10.0.0.5",
            siteId: SITE_A,
          }),
        ],
      );

      expect(result.edges).toHaveLength(0);
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.droppedEndpointCount).toBe(2);
      expect(result.adoptedEndpointCount).toBe(0);
    });
  });

  describe("recognising a device by its declared MAC", () => {
    it("matches the declared MAC in any spelling, and in any site", () => {
      /*
       * A MAC is unique per project among endpoints (the table enforces
       * it), so it needs no site scoping — a register declared in site A
       * that a switch in site B learned is still that register, and the
       * map should say so rather than hide a mis-filed device. Spellings
       * vary by who typed it: Cisco dotted, Windows dashed, upper-case.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch({ siteId: SITE_B }),
          makeDevice("till-1", "till-1", {
            hostname: "till-1.store.local",
            siteId: SITE_A,
            macAddress: "AA-BB-CC-00-00-11",
          }),
          makeDevice("till-2", "till-2", {
            hostname: "till-2.store.local",
            siteId: SITE_A,
            macAddress: "aabb.cc00.0012",
          }),
          makeDevice("till-3", "till-3", {
            hostname: "till-3.store.local",
            siteId: SITE_A,
            macAddress: "AABBCC000013",
          }),
        ],
        now,
        [],
        [
          makeEndpoint("e1", "aa:bb:cc:00:00:11", {
            attachedNetworkDeviceId: "sw",
            attachedPortName: "Gi1/0/1",
            siteId: SITE_B,
          }),
          makeEndpoint("e2", "AA:BB:CC:00:00:12", {
            attachedNetworkDeviceId: "sw",
            attachedPortName: "Gi1/0/2",
            siteId: SITE_B,
          }),
          makeEndpoint("e3", "aa-bb-cc-00-00-13", {
            attachedNetworkDeviceId: "sw",
            attachedPortName: "Gi1/0/3",
            siteId: SITE_B,
          }),
        ],
      );

      expect(endpointNodes(result)).toHaveLength(0);
      expect(edgeBetween(result, "sw", "till-1")!.fromPort).toBe("Gi1/0/1");
      expect(edgeBetween(result, "sw", "till-2")!.fromPort).toBe("Gi1/0/2");
      expect(edgeBetween(result, "sw", "till-3")!.fromPort).toBe("Gi1/0/3");
      expect(result.edges).toHaveLength(3);
      expect(result.adoptedEndpointCount).toBe(3);
    });

    it("prefers the MAC over an address that names a different device", () => {
      /*
       * The MAC is the stronger claim and the only one that survives an
       * address change. When a row's MAC is one device and its address is
       * another — the address was re-issued to a new box, say — the MAC
       * decides, and the other device is left alone rather than cabled
       * on hearsay.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch(),
          makeDevice("by-mac", "kiosk-7", {
            hostname: "kiosk-7.store.local",
            siteId: SITE_A,
            macAddress: "aa:bb:cc:00:00:01",
          }),
          register({ id: "by-ip" }),
        ],
        now,
        [],
        [registerRow()],
      );

      expect(edgeBetween(result, "sw", "by-mac")).toBeDefined();
      expect(edgeBetween(result, "sw", "by-ip")).toBeUndefined();
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.adoptedEndpointCount).toBe(1);
    });

    it("does not adopt on a walked device's interface MACs", () => {
      /*
       * Deliberate, and the reason the declared MAC is a column of its own:
       * a switch's interface MACs turn up in its uplink neighbours'
       * forwarding tables as transit traffic, and adopting those would
       * redraw every switch-to-switch cable LLDP already reports from a
       * weaker source. Only a MAC somebody put there to say "this is the
       * box" is evidence of where the box is.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch(),
          makeDevice("core", "core-sw-1", {
            deviceRole: "switch",
            siteId: SITE_A,
            macAddresses: ["aa:bb:cc:00:00:30"],
          }),
        ],
        now,
        [],
        [
          makeEndpoint("e-core", "aa:bb:cc:00:00:30", {
            attachedNetworkDeviceId: "sw",
            attachedPortName: "Gi1/0/48",
            siteId: SITE_A,
          }),
        ],
      );

      expect(edgeBetween(result, "sw", "core")).toBeUndefined();
      expect(nodeById(result, "endpoint:e-core")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(0);
    });
  });

  describe("refusing to guess", () => {
    it("adopts nothing when two devices in one site share the address", () => {
      /*
       * The same ambiguity guard the neighbour matcher applies: a key two
       * devices both claim is deleted rather than resolved, because
       * last-writer-wins would cable whichever device happened to be
       * indexed second. The row stays a stranger, which is at least true.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch(),
          register({ id: "till-a", name: "till-a" }),
          register({ id: "till-b", name: "till-b" }),
        ],
        now,
        [],
        [registerRow()],
      );

      expect(edgeBetween(result, "sw", "till-a")).toBeUndefined();
      expect(edgeBetween(result, "sw", "till-b")).toBeUndefined();
      expect(nodeById(result, "endpoint:e-till")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(0);
    });

    it("adopts nothing when two devices declare the same MAC", () => {
      /*
       * Two rows claiming one MAC is a data-entry error, and the map must
       * not pick a winner for the operator. Neither is cabled; the row is
       * drawn as the stranger it was before.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch(),
          makeDevice("till-a", "till-a", {
            siteId: SITE_A,
            macAddress: "aa:bb:cc:00:00:01",
          }),
          makeDevice("till-b", "till-b", {
            siteId: SITE_A,
            macAddress: "AA-BB-CC-00-00-01",
          }),
        ],
        now,
        [],
        [registerRow({ ipAddress: undefined })],
      );

      expect(edgeBetween(result, "sw", "till-a")).toBeUndefined();
      expect(edgeBetween(result, "sw", "till-b")).toBeUndefined();
      expect(nodeById(result, "endpoint:e-till")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(0);
    });

    it("is not confused by the same address in two different sites", () => {
      /*
       * The point of scoping by site: one 10.0.0.5 per branch is the
       * normal case, not an ambiguity. Each site's switch cables its own
       * register.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch({ id: "sw-a", siteId: SITE_A }),
          accessSwitch({ id: "sw-b", siteId: SITE_B }),
          register({ id: "till-a", siteId: SITE_A }),
          register({ id: "till-b", siteId: SITE_B }),
        ],
        now,
        [],
        [
          registerRow({
            id: "e-a",
            macAddress: "aa:bb:cc:00:00:0a",
            attachedNetworkDeviceId: "sw-a",
            siteId: SITE_A,
          }),
          registerRow({
            id: "e-b",
            macAddress: "aa:bb:cc:00:00:0b",
            attachedNetworkDeviceId: "sw-b",
            siteId: SITE_B,
          }),
        ],
      );

      expect(edgeBetween(result, "sw-a", "till-a")).toBeDefined();
      expect(edgeBetween(result, "sw-b", "till-b")).toBeDefined();
      expect(edgeBetween(result, "sw-a", "till-b")).toBeUndefined();
      expect(edgeBetween(result, "sw-b", "till-a")).toBeUndefined();
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.adoptedEndpointCount).toBe(2);
    });
  });

  describe("what the cable looks like", () => {
    it("labels the switch end if<index> when the port is unnamed and no interface row exists", () => {
      /*
       * The same fallback the stranger path has always used, so a device
       * adopted off a switch whose interface walk is off still gets a
       * port label the operator can look up.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [
          registerRow({
            attachedInterfaceIndex: 12,
            attachedPortName: undefined,
          }),
        ],
      );

      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.fromPort).toBe("if12");
      expect(edge.fromInterface).toBeUndefined();
    });

    it("leaves the port blank when the row knows neither name nor index", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [
          registerRow({
            attachedInterfaceIndex: undefined,
            attachedPortName: undefined,
          }),
        ],
      );

      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.fromPort).toBeUndefined();
      expect(edge.fromInterface).toBeUndefined();
      expect(edge.protocols).toEqual(["fdb"]);
    });

    it("draws an ARP-only attachment from the router, with the router as parent of a host", () => {
      /*
       * A router with no bridge table still attaches what its ARP cache
       * binds, by interface index alone. That is the same kind of
       * statement a switch's forwarding table makes — the device hangs
       * off this port — so the router is the host's parent.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("rtr", "rtr-1", { deviceRole: "router", siteId: SITE_A }),
          register({ deviceRole: "host" }),
        ],
        now,
        [],
        [
          registerRow({
            attachedNetworkDeviceId: "rtr",
            attachedInterfaceIndex: 3,
            attachedPortName: undefined,
          }),
        ],
      );

      const edge: NetworkTopologyEdge = edgeBetween(result, "rtr", "till")!;
      expect(edge.fromNodeId).toBe("rtr");
      expect(edge.toNodeId).toBe("till");
      expect(edge.protocols).toEqual(["fdb"]);
      expect(edge.fromPort).toBe("if3");
      expect(edge.parentNodeId).toBe("rtr");
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.adoptedEndpointCount).toBe(1);
    });

    it("adopts a device found in its own tables without drawing a cable to itself", () => {
      /*
       * A router's ARP cache lists its own address. The row is not an
       * endpoint and must not be minted as one, but an edge from a node
       * to itself is not a cable either — so it is counted as adopted and
       * draws nothing.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("rtr", "rtr-1", {
            deviceRole: "router",
            hostname: "10.0.0.1",
            siteId: SITE_A,
          }),
        ],
        now,
        [],
        [
          makeEndpoint("e-self", "aa:bb:cc:00:00:ff", {
            ipAddress: "10.0.0.1",
            attachedNetworkDeviceId: "rtr",
            attachedInterfaceIndex: 1,
            siteId: SITE_A,
          }),
        ],
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
      expect(nodeById(result, "endpoint:e-self")).toBeUndefined();
      expect(result.adoptedEndpointCount).toBe(1);
      expect(result.droppedEndpointCount).toBe(0);
    });
  });

  describe("what lands on the device node", () => {
    it("stamps the MAC, address and VLAN the tables knew onto the device", () => {
      /*
       * The detail drawer for a ping-only device had nothing to show but
       * a name and an address. The forwarding table knows its MAC and the
       * VLAN it was learned on; the ARP join knows its address. All three
       * land on the node, the MAC normalised so it reads the same as the
       * endpoint rows beside it.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [registerRow({ macAddress: "AA-BB-CC-00-00-10", vlanId: 40 })],
      );

      const node: NetworkTopologyNode = nodeById(result, "till")!;
      expect(node.macAddress).toBe("aa:bb:cc:00:00:10");
      expect(node.ipAddress).toBe("10.0.0.5");
      expect(node.vlanId).toBe(40);
      // Still the device's own node, not an endpoint dressed as one.
      expect(node.kind).toBe("device");
      expect(node.isManaged).toBe(true);
    });

    it("carries the declared MAC on the node even when nothing adopts it", () => {
      /*
       * An operator checking why a device floats wants to see what the
       * map was looking for. The declared MAC is shown whether or not a
       * forwarding table has found it yet — normalised, so it can be
       * compared by eye against the switch's table.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [register({ macAddress: "AA-BB-CC-00-00-11" })],
        now,
      );

      const node: NetworkTopologyNode = nodeById(result, "till")!;
      expect(node.macAddress).toBe("aa:bb:cc:00:00:11");
      expect(node.ipAddress).toBeUndefined();
      expect(node.vlanId).toBeUndefined();
    });

    it("fills gaps only: a declared MAC is not overwritten by the MAC an address match found", () => {
      /*
       * The hardware-swap case: the operator declared the old unit's MAC,
       * the new unit answers at the same address. The row matches by
       * address, and what the operator declared stays on the node — the
       * map reports what it was told, it does not silently correct it.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ macAddress: "aa:bb:cc:00:00:12" })],
        now,
        [],
        [registerRow({ macAddress: "aa:bb:cc:00:00:99", vlanId: 40 })],
      );

      const node: NetworkTopologyNode = nodeById(result, "till")!;
      expect(node.macAddress).toBe("aa:bb:cc:00:00:12");
      expect(node.ipAddress).toBe("10.0.0.5");
      expect(node.vlanId).toBe(40);
      expect(edgeBetween(result, "sw", "till")).toBeDefined();
    });
  });

  describe("which end is the parent", () => {
    /*
     * A forwarding table is not symmetric the way a neighbour protocol is:
     * the switch LEARNED this MAC on an access port, which says the device
     * hangs off it — for a register, a phone, a camera, a server. It says
     * no such thing about a router or a firewall, whose MAC a switch learns
     * on the port that leads UPSTREAM, nor about another switch, where the
     * table cannot tell which of the two is nearer the core. Those are left
     * for the layout to infer, exactly as an LLDP edge is.
     */
    const hangsOffTheSwitch: ReadonlyArray<string | undefined> = [
      undefined,
      "host",
      "phone",
      "printer",
      "camera",
      "server",
      "wirelessAccessPoint",
    ];
    const leftForTheLayout: ReadonlyArray<string> = [
      "router",
      "firewall",
      "loadBalancer",
      "switch",
    ];

    const parentFor: (
      deviceRole: string | undefined,
      deviceRoles?: ReadonlyArray<TopologyDeviceRoleInput>,
    ) => string | undefined = (
      deviceRole: string | undefined,
      deviceRoles?: ReadonlyArray<TopologyDeviceRoleInput>,
    ): string | undefined => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ deviceRole: deviceRole })],
        now,
        [],
        [registerRow()],
        [],
        new Set<string>(),
        deviceRoles || [],
      );
      return edgeBetween(result, "sw", "till")!.parentNodeId;
    };

    for (const role of hangsOffTheSwitch) {
      it(`makes the switch the parent of a ${role || "role-less"} device`, () => {
        expect(parentFor(role)).toBe("sw");
      });
    }

    for (const role of leftForTheLayout) {
      it(`declares no parent for a ${role}`, () => {
        expect(parentFor(role)).toBeUndefined();
      });
    }

    it("reads a custom role's configured tier: access-layer hangs off the switch, core does not", () => {
      /*
       * A project's own roles carry their own answer to "is this a core
       * device", and it is the only answer available — a "PoS Terminal"
       * or an "SD-WAN Edge" is not in the built-in set. The stamp on the
       * node is read ahead of the built-in fallback.
       */
      const roles: Array<TopologyDeviceRoleInput> = [
        {
          id: "role-pos",
          key: "posTerminal",
          name: "PoS Terminal",
          topologyShape: "hexagon",
          isCoreLayer: false,
          isSnmpWalkable: false,
        },
        {
          id: "role-sdwan",
          key: "sdwanEdge",
          name: "SD-WAN Edge",
          topologyShape: "diamond",
          isCoreLayer: true,
          isSnmpWalkable: true,
        },
      ];

      expect(parentFor("posTerminal", roles)).toBe("sw");
      expect(parentFor("sdwanEdge", roles)).toBeUndefined();
    });

    it("lets a project's re-tiering of a built-in role override the built-in answer", () => {
      /*
       * The configured flag wins where the project set one, as everywhere
       * else the stamp is read: a project that filed "router" as access
       * layer (a branch CPE that really does hang off the switch) gets
       * the switch as parent, and a "host" it promoted to core does not.
       */
      const routerDemoted: Array<TopologyDeviceRoleInput> = [
        {
          id: "role-router",
          key: "router",
          name: "Router",
          isCoreLayer: false,
        },
      ];
      const hostPromoted: Array<TopologyDeviceRoleInput> = [
        { id: "role-host", key: "host", name: "Host", isCoreLayer: true },
      ];

      expect(parentFor("router", routerDemoted)).toBe("sw");
      expect(parentFor("host", hostPromoted)).toBeUndefined();
    });
  });

  describe("merging into a link that already joins the pair", () => {
    const switchInterfaces: Array<TopologyInterfaceInput> = [
      { networkDeviceId: "sw", interfaceIndex: 7, name: "Gi1/0/7" },
      { networkDeviceId: "sw", interfaceIndex: 9, name: "Gi1/0/9" },
    ];

    it("merges with a hand-drawn link, replacing the typed switch port with the measured one", () => {
      /*
       * The cable the operator drew because nothing could discover it is
       * the same cable the forwarding table now reports, so it is one
       * line carrying both — not the duplicate an operator would read as
       * a second physical link. Measured beats typed on the switch end:
       * the operator's port is a best recollection, the switch's is what
       * it actually learned the MAC on. The operator's name has no
       * measured counterpart and survives; a link nobody gave a hierarchy
       * gains the one the table implies.
       */
      const manualLinks: Array<TopologyManualLinkInput> = [
        {
          fromDeviceId: "sw",
          toDeviceId: "till",
          fromPortName: "Gi1/0/3",
          toPortName: "eth0",
          name: "Till 4 drop",
        },
      ];

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        switchInterfaces,
        [registerRow()],
        manualLinks,
      );

      expect(result.edges).toHaveLength(1);
      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.protocols).toEqual(["manual", "fdb"]);
      expect(edge.fromNodeId).toBe("sw");
      expect(edge.fromPort).toBe("Gi1/0/7");
      expect(edge.fromInterface?.interfaceIndex).toBe(7);
      expect(edge.toPort).toBe("eth0");
      expect(edge.toInterface).toBeUndefined();
      expect(edge.name).toBe("Till 4 drop");
      expect(edge.parentNodeId).toBe("sw");
    });

    it("keeps a parent declared on the hand-drawn link over the one the table implies", () => {
      /*
       * A hierarchy somebody DECLARED beats the one inferred from where a
       * MAC was learned — the specific statement beats the general one,
       * the same precedence the manual-link merge already applies against
       * rules. Declared backwards on purpose here, so the two answers
       * differ and the test can tell which one won.
       */
      const manualLinks: Array<TopologyManualLinkInput> = [
        {
          fromDeviceId: "sw",
          toDeviceId: "till",
          parentDeviceId: "till",
        },
      ];

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        switchInterfaces,
        [registerRow()],
        manualLinks,
      );

      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.protocols).toEqual(["manual", "fdb"]);
      expect(edge.parentNodeId).toBe("till");
    });

    it("lands the measured port on the switch end when the link was stored device-first", () => {
      /*
       * Which end is fromNodeId depends on how the operator happened to
       * draw the link. The forwarding table's port belongs to the switch
       * whichever end that is — putting "Gi1/0/7" on the register's eth0
       * would be a wrong cable, not a cosmetic slip.
       */
      const manualLinks: Array<TopologyManualLinkInput> = [
        {
          fromDeviceId: "till",
          toDeviceId: "sw",
          fromPortName: "eth0",
          toPortName: "Gi1/0/3",
          name: "Till 4 drop",
        },
      ];

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        switchInterfaces,
        [registerRow()],
        manualLinks,
      );

      expect(result.edges).toHaveLength(1);
      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.fromNodeId).toBe("till");
      expect(edge.toNodeId).toBe("sw");
      expect(edge.protocols).toEqual(["manual", "fdb"]);
      expect(edge.fromPort).toBe("eth0");
      expect(edge.fromInterface).toBeUndefined();
      expect(edge.toPort).toBe("Gi1/0/7");
      expect(edge.toInterface?.interfaceIndex).toBe(7);
      expect(edge.name).toBe("Till 4 drop");
      expect(edge.parentNodeId).toBe("sw");
    });

    it("merges with an LLDP link, keeping the protocol's port and interface", () => {
      /*
       * Against a neighbour protocol both ports are measured, and the
       * protocol's is kept: it names the port from both ends, where the
       * table only knows one — and a forwarding table can lag a re-patch
       * by a walk, which is exactly when the two disagree.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch({
            lldpNeighbors: [
              {
                localInterfaceIndex: 7,
                remoteSysName: "till-4",
                remotePortId: "eth0",
              },
            ],
          }),
          register({ sysName: "till-4" }),
        ],
        now,
        [
          {
            networkDeviceId: "sw",
            interfaceIndex: 7,
            name: "Gi1/0/7",
            utilizationPercent: 12,
          },
          { networkDeviceId: "sw", interfaceIndex: 9, name: "Gi1/0/9" },
        ],
        [
          registerRow({
            attachedInterfaceIndex: 9,
            attachedPortName: "Gi1/0/9",
          }),
        ],
      );

      expect(result.edges).toHaveLength(1);
      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.protocols).toEqual(["lldp", "fdb"]);
      expect(edge.fromNodeId).toBe("sw");
      expect(edge.fromPort).toBe("Gi1/0/7");
      expect(edge.fromInterface?.interfaceIndex).toBe(7);
      expect(edge.fromInterface?.utilizationPercent).toBe(12);
      expect(edge.toPort).toBe("eth0");
      // LLDP states no hierarchy, so the table's is free to apply.
      expect(edge.parentNodeId).toBe("sw");
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.adoptedEndpointCount).toBe(1);
    });
  });

  describe("one cable per device: the freshest sighting draws it", () => {
    /*
     * The hardware-swap case. The old unit's MAC is still a row in the
     * endpoint table (nothing prunes it) and is what the ARP pass stored
     * on the device; the new unit is a fresher row that matches the device
     * by address. Drawing both would put the register on two ports at
     * once, one of them a port nothing has been plugged into for a month.
     */
    const swappedRegister: () => TopologyDeviceInput =
      (): TopologyDeviceInput => {
        return register({ macAddress: "aa:bb:cc:00:00:01" });
      };
    const twoSwitches: () => Array<TopologyDeviceInput> =
      (): Array<TopologyDeviceInput> => {
        return [accessSwitch({ id: "sw-a" }), accessSwitch({ id: "sw-b" })];
      };

    it("draws the fresher row and adopts both", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...twoSwitches(), swappedRegister()],
        now,
        [],
        [
          makeEndpoint("e-old", "aa:bb:cc:00:00:01", {
            attachedNetworkDeviceId: "sw-a",
            attachedPortName: "Gi1/0/3",
            lastSeenAt: stale,
            siteId: SITE_A,
          }),
          makeEndpoint("e-new", "aa:bb:cc:00:00:02", {
            ipAddress: "10.0.0.5",
            attachedNetworkDeviceId: "sw-b",
            attachedPortName: "Gi1/0/7",
            lastSeenAt: fresh,
            siteId: SITE_A,
          }),
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(edgeBetween(result, "sw-a", "till")).toBeUndefined();
      const edge: NetworkTopologyEdge = edgeBetween(result, "sw-b", "till")!;
      expect(edge.fromPort).toBe("Gi1/0/7");
      expect(endpointNodes(result)).toHaveLength(0);
      expect(result.adoptedEndpointCount).toBe(2);
      expect(result.droppedEndpointCount).toBe(0);
    });

    it("prefers the MAC match at equal freshness", () => {
      /*
       * Seen in the same walk, the row that IS the declared MAC is the
       * stronger claim about where the box is.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...twoSwitches(), swappedRegister()],
        now,
        [],
        [
          makeEndpoint("e-old", "aa:bb:cc:00:00:01", {
            attachedNetworkDeviceId: "sw-a",
            attachedPortName: "Gi1/0/3",
            lastSeenAt: fresh,
            siteId: SITE_A,
          }),
          makeEndpoint("e-new", "aa:bb:cc:00:00:02", {
            ipAddress: "10.0.0.5",
            attachedNetworkDeviceId: "sw-b",
            attachedPortName: "Gi1/0/7",
            lastSeenAt: fresh,
            siteId: SITE_A,
          }),
        ],
      );

      expect(result.edges).toHaveLength(1);
      expect(edgeBetween(result, "sw-b", "till")).toBeUndefined();
      expect(edgeBetween(result, "sw-a", "till")!.fromPort).toBe("Gi1/0/3");
      expect(result.adoptedEndpointCount).toBe(2);
    });

    it("settles a tie on equal timestamps by MAC order, never by input order", () => {
      /*
       * Two rows of the same evidence seen at the same moment: the choice
       * has to come from something the caller cannot vary between
       * rebuilds, and the MAC order the builder already sorts by is that.
       * (A row with NO timestamp is not evidence of an address at all -
       * see the freshness rule - so the tie is on equal times, not none.)
       */
      const rows: () => Array<TopologyEndpointInput> =
        (): Array<TopologyEndpointInput> => {
          return [
            makeEndpoint("e-hi", "aa:bb:cc:00:00:09", {
              ipAddress: "10.0.0.5",
              attachedNetworkDeviceId: "sw-a",
              attachedPortName: "Gi1/0/3",
              lastSeenAt: fresh,
              siteId: SITE_A,
            }),
            makeEndpoint("e-lo", "aa:bb:cc:00:00:01", {
              ipAddress: "10.0.0.5",
              attachedNetworkDeviceId: "sw-b",
              attachedPortName: "Gi1/0/7",
              lastSeenAt: fresh,
              siteId: SITE_A,
            }),
          ];
        };

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...twoSwitches(), register()],
        now,
        [],
        rows(),
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...twoSwitches(), register()],
        now,
        [],
        rows().reverse(),
      );

      for (const result of [forward, reversed]) {
        expect(result.edges).toHaveLength(1);
        expect(edgeBetween(result, "sw-a", "till")).toBeUndefined();
        expect(edgeBetween(result, "sw-b", "till")!.fromPort).toBe("Gi1/0/7");
        expect(result.adoptedEndpointCount).toBe(2);
      }
    });
  });

  describe("bookkeeping", () => {
    it("adds up: rendered + dropped + adopted is every row passed in", () => {
      /*
       * The reason adoptedEndpointCount exists. A count of what the
       * switches learned that no longer matches what the map shows would
       * read as rows going missing.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [
          registerRow(),
          makeEndpoint("e-stranger", "aa:bb:cc:00:00:02", {
            attachedNetworkDeviceId: "sw",
            siteId: SITE_A,
          }),
          makeEndpoint("e-loose", "aa:bb:cc:00:00:03"),
        ],
      );

      expect(endpointNodes(result)).toHaveLength(1);
      expect(result.adoptedEndpointCount).toBe(1);
      expect(result.droppedEndpointCount).toBe(1);
      expect(result.edges).toHaveLength(2);
      expect(edgeBetween(result, "sw", "till")).toBeDefined();
      expect(edgeBetween(result, "sw", "endpoint:e-stranger")).toBeDefined();
    });

    it("never spends the endpoint render cap on an adopted row", () => {
      /*
       * An adopted row mints no node, so it cannot crowd one out — and it
       * must not be crowded out either. The register's MAC sorts after
       * every stranger here, so if adoption were subject to the cap this
       * is exactly the row that would go missing.
       */
      const strangers: (count: number) => Array<TopologyEndpointInput> = (
        count: number,
      ): Array<TopologyEndpointInput> => {
        const rows: Array<TopologyEndpointInput> = [];
        for (let i: number = 0; i < count; i++) {
          const hex: string = i.toString(16).padStart(4, "0");
          rows.push(
            makeEndpoint(
              `ep-${i}`,
              `aa:bb:cc:dd:${hex.substring(0, 2)}:${hex.substring(2, 4)}`,
              { attachedNetworkDeviceId: "sw", siteId: SITE_A },
            ),
          );
        }
        return rows;
      };
      const adoptedRow: TopologyEndpointInput = registerRow({
        macAddress: "fe:ff:ff:ff:ff:fe",
        ipAddress: undefined,
      });
      const devices: () => Array<TopologyDeviceInput> =
        (): Array<TopologyDeviceInput> => {
          return [
            accessSwitch(),
            register({ hostname: undefined, macAddress: "fe:ff:ff:ff:ff:fe" }),
          ];
        };

      const atTheCap: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices(),
        now,
        [],
        [...strangers(2000), adoptedRow],
      );
      expect(endpointNodes(atTheCap)).toHaveLength(2000);
      expect(atTheCap.endpointsTruncated).toBe(false);
      expect(edgeBetween(atTheCap, "sw", "till")).toBeDefined();
      expect(atTheCap.adoptedEndpointCount).toBe(1);

      const overTheCap: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices(),
        now,
        [],
        [...strangers(2001), adoptedRow],
      );
      expect(endpointNodes(overTheCap)).toHaveLength(2000);
      expect(overTheCap.endpointsTruncated).toBe(true);
      expect(edgeBetween(overTheCap, "sw", "till")).toBeDefined();
      expect(overTheCap.adoptedEndpointCount).toBe(1);
    });

    it("drops the adopted cable with whichever end the project hid, and counts it regardless", () => {
      /*
       * Suppression is applied last, on the finished graph, so hiding a
       * node cannot change how anything resolved: the row is still
       * adopted (and counted), the line just has nowhere to go.
       */
      const switchHidden: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [accessSwitch(), register()],
          now,
          [],
          [registerRow()],
          [],
          new Set<string>(["sw"]),
        );
      expect(switchHidden.edges).toHaveLength(0);
      expect(nodeById(switchHidden, "till")).toBeDefined();
      expect(nodeById(switchHidden, "endpoint:e-till")).toBeUndefined();
      expect(switchHidden.adoptedEndpointCount).toBe(1);
      expect(switchHidden.suppressedNodeCount).toBe(1);

      const deviceHidden: TopologyBuildResult =
        NetworkTopologyUtil.buildTopology(
          [accessSwitch(), register()],
          now,
          [],
          [registerRow()],
          [],
          new Set<string>(["till"]),
        );
      expect(deviceHidden.edges).toHaveLength(0);
      expect(nodeById(deviceHidden, "sw")).toBeDefined();
      expect(nodeById(deviceHidden, "endpoint:e-till")).toBeUndefined();
      expect(deviceHidden.adoptedEndpointCount).toBe(1);
      expect(deviceHidden.suppressedNodeCount).toBe(1);
    });

    it("builds the same graph whatever order the devices and rows arrive in", () => {
      /*
       * Query order is not something a map may depend on: two rebuilds of
       * one estate must draw one picture, or the operator sees cables
       * move between refreshes.
       */
      const devices: () => Array<TopologyDeviceInput> =
        (): Array<TopologyDeviceInput> => {
          return [
            accessSwitch({ id: "sw-a" }),
            accessSwitch({ id: "sw-b" }),
            register({ id: "till-1", name: "till-1" }),
            makeDevice("phone-1", "handset-1", {
              deviceRole: "phone",
              siteId: SITE_A,
              macAddress: "aa:bb:cc:00:00:22",
            }),
          ];
        };
      const rows: () => Array<TopologyEndpointInput> =
        (): Array<TopologyEndpointInput> => {
          return [
            registerRow({ id: "e-till", attachedNetworkDeviceId: "sw-a" }),
            makeEndpoint("e-phone", "AA-BB-CC-00-00-22", {
              attachedNetworkDeviceId: "sw-b",
              attachedPortName: "Gi1/0/2",
              vlanId: 100,
              siteId: SITE_A,
            }),
            makeEndpoint("e-s1", "aa:bb:cc:00:00:31", {
              attachedNetworkDeviceId: "sw-a",
              siteId: SITE_A,
            }),
            makeEndpoint("e-s2", "aa:bb:cc:00:00:32", {
              attachedNetworkDeviceId: "sw-b",
              siteId: SITE_A,
            }),
          ];
        };

      /*
       * Key order inside an object is insertion order, which a merge
       * could plausibly vary, so the comparison sorts keys as well as
       * elements — it is the graph that must be identical, not the
       * bytes.
       */
      const canonical: (value: unknown) => unknown = (
        value: unknown,
      ): unknown => {
        if (Array.isArray(value)) {
          return value.map(canonical);
        }
        if (value && typeof value === "object") {
          const record: Record<string, unknown> = value as Record<
            string,
            unknown
          >;
          const sorted: Record<string, unknown> = {};
          for (const key of Object.keys(record).sort()) {
            sorted[key] = canonical(record[key]);
          }
          return sorted;
        }
        return value;
      };
      const picture: (result: TopologyBuildResult) => string = (
        result: TopologyBuildResult,
      ): string => {
        const nodes: Array<NetworkTopologyNode> = [...result.nodes].sort(
          (a: NetworkTopologyNode, b: NetworkTopologyNode) => {
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          },
        );
        const edges: Array<NetworkTopologyEdge> = [...result.edges].sort(
          (a: NetworkTopologyEdge, b: NetworkTopologyEdge) => {
            const aKey: string = [a.fromNodeId, a.toNodeId].sort().join("::");
            const bKey: string = [b.fromNodeId, b.toNodeId].sort().join("::");
            return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
          },
        );
        return JSON.stringify(canonical({ nodes, edges }));
      };

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices(),
        now,
        [],
        rows(),
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices().reverse(),
        now,
        [],
        rows().reverse(),
      );

      expect(picture(reversed)).toBe(picture(forward));
      // And the picture is the one expected, not two identical mistakes.
      expect(forward.edges).toHaveLength(4);
      expect(edgeBetween(forward, "sw-a", "till-1")).toBeDefined();
      expect(edgeBetween(forward, "sw-b", "phone-1")!.fromPort).toBe("Gi1/0/2");
      expect(nodeById(forward, "phone-1")!.vlanId).toBe(100);
      expect(endpointNodes(forward)).toHaveLength(2);
      expect(forward.adoptedEndpointCount).toBe(2);
    });

    it("reports zero adopted rows on a legacy call with no endpoints argument", () => {
      /*
       * The field is additive: a caller from before endpoints existed
       * gets a number, not undefined, so a reader that adds the three
       * counts does not have to guard this one.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ macAddress: "aa:bb:cc:00:00:01" })],
        now,
      );

      expect(result.adoptedEndpointCount).toBe(0);
      expect(result.droppedEndpointCount).toBe(0);
      expect(result.endpointsTruncated).toBe(false);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe("refusals the review asked for", () => {
    it("keeps a neighbour protocol's port whole when the table names a different one", () => {
      /*
       * Re-patch lag: LLDP still says port 7, the forwarding table already
       * says port 9. Splicing the two field by field labelled port 7 with
       * port 9's name and painted it with port 9's state. The protocol's
       * end stays exactly as reported until the two agree.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("sw", "access-sw-1", {
            deviceRole: "switch",
            lldpNeighbors: [
              {
                localInterfaceIndex: 7,
                remoteSysName: "till-4",
                remotePortId: "eth0",
              },
            ],
          }),
          makeDevice("till", "till-4", {
            sysName: "till-4",
            hostname: "10.0.0.5",
          }),
        ],
        now,
        [
          {
            networkDeviceId: "sw",
            interfaceIndex: 9,
            name: "Gi1/0/9",
            isOperationallyUp: false,
            utilizationPercent: 80,
          },
        ],
        [
          makeEndpoint("row", "aa:bb:cc:00:00:01", {
            ipAddress: "10.0.0.5",
            attachedNetworkDeviceId: "sw",
            attachedInterfaceIndex: 9,
          }),
        ],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "sw",
        "till",
      );
      expect(edge).toBeDefined();
      expect(edge!.protocols).toEqual(["lldp", "fdb"]);
      expect(edge!.fromPort).toBe("if7");
      expect(edge!.fromInterface).toEqual({
        interfaceIndex: 7,
        interfaceName: undefined,
        isOperationallyUp: undefined,
        isAdministrativelyUp: undefined,
        utilizationPercent: undefined,
        inRateMbps: undefined,
        outRateMbps: undefined,
        errorsPerSecond: undefined,
      });
      expect(edge!.learnedByNodeId).toBe("sw");
    });

    it("lets the table fill the gaps when both name the same port", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("sw", "access-sw-1", {
            deviceRole: "switch",
            lldpNeighbors: [
              { localInterfaceIndex: 9, remoteSysName: "till-4" },
            ],
          }),
          makeDevice("till", "till-4", {
            sysName: "till-4",
            hostname: "10.0.0.5",
          }),
        ],
        now,
        [
          {
            networkDeviceId: "sw",
            interfaceIndex: 9,
            name: "Gi1/0/9",
            isOperationallyUp: true,
            utilizationPercent: 12,
          },
        ],
        [
          makeEndpoint("row", "aa:bb:cc:00:00:01", {
            ipAddress: "10.0.0.5",
            attachedNetworkDeviceId: "sw",
            attachedInterfaceIndex: 9,
          }),
        ],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "sw",
        "till",
      );
      expect(edge!.fromPort).toBe("Gi1/0/9");
      expect(edge!.fromInterface?.interfaceIndex).toBe(9);
      expect(edge!.fromInterface?.utilizationPercent).toBe(12);
    });

    it("refuses a declared MAC that a walked device reports as its own interface", () => {
      /*
       * The neighbour matcher already deletes a key two devices claim; the
       * adoption index must not disagree with it and cable a register onto
       * the port where a switch's own MAC was learned.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("s2", "dist-sw", {
            deviceRole: "switch",
            macAddresses: ["aa:bb:cc:dd:ee:ff"],
          }),
          makeDevice("s3", "access-sw", { deviceRole: "switch" }),
          makeDevice("d", "till-9", {
            hostname: "10.0.20.1",
            macAddress: "aa:bb:cc:dd:ee:ff",
          }),
        ],
        now,
        [],
        [
          makeEndpoint("row", "aa:bb:cc:dd:ee:ff", {
            attachedNetworkDeviceId: "s3",
            attachedInterfaceIndex: 5,
          }),
        ],
      );

      expect(edgeBetween(result, "s3", "d")).toBeUndefined();
      expect(nodeById(result, "endpoint:row")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(0);
    });

    it("does not adopt by address from a row nothing has seen for longer than the fresh window", () => {
      /*
       * An address is re-leased. A months-old row binding the register's
       * address to some other box's MAC must not cable the register to
       * that box's port with a live node's confidence; it stays the stale,
       * down-coloured endpoint it is.
       */
      const monthsAgo: Date = new Date("2026-04-01T00:00:00Z");
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [
          makeEndpoint("laptop", "de:ad:be:ef:00:01", {
            ipAddress: "10.0.0.5",
            siteId: SITE_A,
            attachedNetworkDeviceId: "sw",
            attachedInterfaceIndex: 12,
            lastSeenAt: monthsAgo,
          }),
        ],
      );

      expect(edgeBetween(result, "sw", "till")).toBeUndefined();
      expect(nodeById(result, "endpoint:laptop")?.status).toBe("down");
      expect(result.adoptedEndpointCount).toBe(0);
      expect(nodeById(result, "till")?.macAddress).toBeUndefined();
    });

    it("still adopts by MAC from a row nothing has seen for a while", () => {
      // A MAC is not re-leased: it names the box for good, stale or not.
      const monthsAgo: Date = new Date("2026-04-01T00:00:00Z");
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register({ macAddress: "aa:bb:cc:dd:ee:01" })],
        now,
        [],
        [
          makeEndpoint("row", "aa:bb:cc:dd:ee:01", {
            attachedNetworkDeviceId: "sw",
            attachedInterfaceIndex: 12,
            lastSeenAt: monthsAgo,
          }),
        ],
      );

      expect(edgeBetween(result, "sw", "till")).toBeDefined();
      expect(result.adoptedEndpointCount).toBe(1);
    });
  });

  describe("which end learned", () => {
    /*
     * The pair may already be joined the other way round - a hand-drawn
     * link stored device->switch keeps its ends when the attachment merges
     * in - so "the switch is the from end" is not something a reader can
     * rely on. The builder says outright which end's table this came from.
     */
    it("stamps the switch as the learner on a fresh learned edge", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [registerRow()],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "sw",
        "till",
      );
      expect(edge).toBeDefined();
      expect(edge!.learnedByNodeId).toBe("sw");
      expect(edge!.fromNodeId).toBe("sw");
    });

    it("stamps the switch as the learner when it is the TO end of the link it merged into", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch(), register()],
        now,
        [],
        [registerRow()],
        [{ fromDeviceId: "till", toDeviceId: "sw", name: "typed in" }],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "sw",
        "till",
      );
      expect(edge).toBeDefined();
      expect(edge!.fromNodeId).toBe("till");
      expect(edge!.toNodeId).toBe("sw");
      expect(edge!.protocols).toEqual(["manual", "fdb"]);
      expect(edge!.learnedByNodeId).toBe("sw");
      // The measured port lands on the switch's end, which is the TO end here.
      expect(edge!.toPort).toBe(registerRow().attachedPortName);
    });

    it("stamps the switch as the learner on an endpoint node's edge too", () => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [accessSwitch()],
        now,
        [],
        [
          makeEndpoint("stranger", "aa:00:00:00:00:99", {
            attachedNetworkDeviceId: "sw",
            attachedInterfaceIndex: 3,
          }),
        ],
      );

      const edge: NetworkTopologyEdge | undefined = edgeBetween(
        result,
        "sw",
        "endpoint:stranger",
      );
      expect(edge).toBeDefined();
      expect(edge!.learnedByNodeId).toBe("sw");
    });
  });

  describe("the declared MAC as an LLDP chassis id", () => {
    it("resolves a chassis id that is the device's declared MAC", () => {
      /*
       * A ping-only device has no interface walk to report its MACs from,
       * so the declared MAC is the only MAC it can answer to when a switch
       * advertises it as an LLDP chassis id (subtype 4). Without it the
       * peer is drawn as a stranger beside the device it is.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch({
            lldpNeighbors: [
              {
                localInterfaceIndex: 7,
                remoteChassisId: "AA:BB:CC:00:00:20",
                remotePortId: "eth0",
              },
            ],
          }),
          register({ hostname: undefined, macAddress: "aa-bb-cc-00-00-20" }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(2);
      const edge: NetworkTopologyEdge = edgeBetween(result, "sw", "till")!;
      expect(edge.protocols).toEqual(["lldp"]);
      expect(edge.toPort).toBe("eth0");
      expect(edge.parentNodeId).toBeUndefined();
    });

    it("still draws a stranger when the device declares no MAC", () => {
      // The control: the "before" picture, with nothing to match on.
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          accessSwitch({
            lldpNeighbors: [
              {
                localInterfaceIndex: 7,
                remoteChassisId: "AA:BB:CC:00:00:20",
                remotePortId: "eth0",
              },
            ],
          }),
          register({ hostname: undefined }),
        ],
        now,
      );

      expect(result.nodes).toHaveLength(3);
      expect(edgeBetween(result, "sw", "till")).toBeUndefined();
      expect(
        result.nodes.some((node: NetworkTopologyNode) => {
          return node.kind === "unmanaged";
        }),
      ).toBe(true);
    });
  });
});
