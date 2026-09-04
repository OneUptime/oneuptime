import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import { TopologyDeviceRoleInput } from "../../../Utils/Monitor/NetworkDeviceRoleCatalog";
import { NetworkTopologyNode } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import DEFAULT_NETWORK_DEVICE_ROLES, {
  DefaultNetworkDeviceRole,
} from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";

/*
 * Device roles are rows now (NetworkDeviceRole), one set per project, and the
 * client is deliberately NOT handed the table to look things up in. Instead
 * buildTopology stamps the project's answers — label, silhouette, "is this a
 * core device", "is this worth walking with SNMP" — onto each node as it
 * builds it, so the shape module, the three layouts, the legend and the adopt
 * flow all keep their existing pure signatures.
 *
 * NetworkDeviceRoleCatalog's units are tested on their own; this file is the
 * wiring: what actually lands on a node once a real graph has been built.
 *
 * The load-bearing invariant, and the reason most of the first block exists:
 * every stamped field is ADDITIVE and OPTIONAL. A project with no roles
 * configured, a caller that predates the parameter, and a payload serialised
 * before the table existed must all produce exactly the nodes they produced
 * before — which means the fields have to be ABSENT, not present-and-undefined,
 * because "absent means fall back to the built-in" is the contract every
 * consumer downstream reads.
 */
describe("NetworkTopologyUtil.buildTopology — the project's configured device roles", () => {
  const now: Date = new Date("2026-07-22T12:00:00Z");
  const fresh: Date = new Date("2026-07-22T11:55:00Z");

  // Every field the role catalogue is allowed to put on a node.
  const ROLE_STAMP_FIELDS: ReadonlyArray<string> = [
    "roleId",
    "roleKey",
    "roleLabel",
    "roleShape",
    "isCoreLayerRole",
    "isSnmpWalkableRole",
  ];

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
   * Absence, not `undefined`. A consumer that checks with `in`, or a payload
   * that goes through JSON, cannot tell the two apart afterwards — and a node
   * carrying `roleShape: undefined` would still be a node whose author claimed
   * to know something about its shape.
   */
  const expectNoRoleStamp: (node: NetworkTopologyNode) => void = (
    node: NetworkTopologyNode,
  ): void => {
    for (const field of ROLE_STAMP_FIELDS) {
      expect(node).not.toHaveProperty(field);
    }
  };

  /*
   * The eleven roles seeded into every project, in the shape the API hands
   * buildTopology. Built from the shared defaults rather than retyped, so a
   * change to what a fresh project starts with cannot pass here and fail in
   * production.
   */
  const seededRoles: () => Array<TopologyDeviceRoleInput> =
    (): Array<TopologyDeviceRoleInput> => {
      return DEFAULT_NETWORK_DEVICE_ROLES.map(
        (role: DefaultNetworkDeviceRole): TopologyDeviceRoleInput => {
          return {
            id: `role-${role.key}`,
            key: role.key,
            name: role.name,
            topologyShape: role.topologyShape,
            isCoreLayer: role.isCoreLayer,
            isSnmpWalkable: role.isSnmpWalkable,
          };
        },
      );
    };

  // The seeded set with one row edited, which is what "renaming a role" is.
  const seededRolesWith: (
    key: string,
    patch: Partial<TopologyDeviceRoleInput>,
  ) => Array<TopologyDeviceRoleInput> = (
    key: string,
    patch: Partial<TopologyDeviceRoleInput>,
  ): Array<TopologyDeviceRoleInput> => {
    return seededRoles().map(
      (role: TopologyDeviceRoleInput): TopologyDeviceRoleInput => {
        return role.key === key ? { ...role, ...patch } : role;
      },
    );
  };

  /*
   * One small estate that exercises all three node kinds at once: a managed
   * device the classifier can place, one it cannot, a CDP peer nobody manages,
   * and two ARP/FDB endpoints. Reused so the "before" and "after" pictures are
   * the same graph.
   */
  const estateDevices: () => Array<TopologyDeviceInput> =
    (): Array<TopologyDeviceInput> => {
      return [
        makeDevice("d-router", "core-rtr-1", {
          sysName: "core-rtr-1",
          deviceModel: "ISR4331/K9",
        }),
        makeDevice("d-switch", "access-1", {
          sysName: "access-1",
          sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "ap-lobby",
              remotePlatform: "cisco AIR-CAP3702I-A-K9",
            },
          ],
        }),
        // Nothing walks this one and its name says nothing: honestly "unknown".
        makeDevice("d-blank", "device-42"),
      ];
    };

  const estateEndpoints: () => Array<TopologyEndpointInput> =
    (): Array<TopologyEndpointInput> => {
      return [
        {
          id: "ep-phone",
          macAddress: "aa:bb:cc:dd:ee:01",
          classification: "VoIP handset",
          attachedNetworkDeviceId: "d-switch",
          lastSeenAt: fresh,
        },
        {
          id: "ep-plain",
          macAddress: "aa:bb:cc:dd:ee:02",
          attachedNetworkDeviceId: "d-switch",
          lastSeenAt: fresh,
        },
      ];
    };

  describe("a project that has configured nothing", () => {
    it("stamps no role fields at all when the catalogue argument is omitted", () => {
      /*
       * The compatibility case that matters most: this is every caller written
       * before the parameter existed, and every project whose backfill has not
       * run yet. The node must come out byte-identical to the one built before
       * roles were configurable, which means `role` intact and not one of the
       * six new fields present.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
      );

      expect(nodeById(result, "d-router")!.role).toBe("router");
      expect(nodeById(result, "d-switch")!.role).toBe("switch");
      expect(nodeById(result, "d-blank")!.role).toBe("unknown");
      expect(nodeById(result, "unmanaged:ap-lobby")!.role).toBe(
        "wirelessAccessPoint",
      );
      expect(nodeById(result, "endpoint:ep-phone")!.role).toBe("phone");
      expect(nodeById(result, "endpoint:ep-plain")!.role).toBe("host");

      for (const node of result.nodes) {
        expectNoRoleStamp(node);
      }
    });

    it("treats an empty catalogue exactly as it treats no catalogue", () => {
      /*
       * A project that deleted every role is not a project asking for blank
       * nodes — it is a project with nothing to say, which is the same thing
       * the omitted argument says. Compared whole rather than field by field
       * so a future field cannot be added to one path and not the other.
       */
      const omitted: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
      );
      const empty: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        [],
      );

      expect(empty.nodes).toStrictEqual(omitted.nodes);
    });

    it("stamps nothing from rows that carry no usable key", () => {
      /*
       * A key is what a row is FOUND by, so a row without one cannot be found
       * — and must not be silently applied to everything either. Blank keys
       * are what a half-written import leaves behind.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        [
          { id: "role-a", key: "", name: "Nameless" },
          { id: "role-b", key: "   ", name: "Whitespace" },
        ],
      );

      expect(nodeById(result, "d-router")!.role).toBe("router");
      for (const node of result.nodes) {
        expectNoRoleStamp(node);
      }
    });
  });

  describe("a role the classifier chose, drawn the way the project configured it", () => {
    it("relabels a device the operator never touched when its role is renamed", () => {
      /*
       * The whole point of keying on the classifier's answer. Nobody has ever
       * opened this router's settings — the role came from its model string —
       * and renaming the "router" row still has to reach it, because otherwise
       * a rename only ever applies to devices somebody edited by hand.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRolesWith("router", {
          name: "Edge Router",
          topologyShape: "hexagon",
        }),
      );

      const router: NetworkTopologyNode = nodeById(result, "d-router")!;
      // The classifier's vocabulary is untouched — only the presentation moved.
      expect(router.role).toBe("router");
      expect(router.roleKey).toBe("router");
      expect(router.roleLabel).toBe("Edge Router");
      expect(router.roleShape).toBe("hexagon");
      expect(router.isCoreLayerRole).toBe(true);
      expect(router.isSnmpWalkableRole).toBe(true);
      // So a form can preselect the row the map is already showing.
      expect(router.roleId).toBe("role-router");
    });

    it("carries a role that was turned OFF the core layer through as false", () => {
      /*
       * The tiered and radial layouts read isCoreLayerRole BEFORE `role`, so
       * `false` is a real instruction — "draw routers with the access kit" —
       * and not the absence of one. If a false were dropped as falsy the node
       * would silently fall back to the built-in core set and the layout would
       * ignore what the project configured.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRolesWith("router", { isCoreLayer: false }),
      );

      const router: NetworkTopologyNode = nodeById(result, "d-router")!;
      expect(router.isCoreLayerRole).toBe(false);
      expect(router).toHaveProperty("isCoreLayerRole");
    });

    it("omits the flags a row does not state rather than inventing them", () => {
      /*
       * A row that says nothing about the core layer is not a row saying "not
       * core". Absent has to stay absent so the client falls back to the
       * built-in answer for `role`, which is the pre-feature behaviour.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        [{ key: "router", name: "Edge Router" }],
      );

      const router: NetworkTopologyNode = nodeById(result, "d-router")!;
      expect(router.roleKey).toBe("router");
      expect(router.roleLabel).toBe("Edge Router");
      expect(router).not.toHaveProperty("isCoreLayerRole");
      expect(router).not.toHaveProperty("isSnmpWalkableRole");
      expect(router).not.toHaveProperty("roleShape");
      // No row id to preselect, because this catalogue carried none.
      expect(router).not.toHaveProperty("roleId");
    });

    it("drops a silhouette the renderer has no geometry for", () => {
      /*
       * topologyShape is free text — adding a shape must not need a migration
       * — so a value the renderer cannot draw is dropped and the node falls
       * back to the built-in shape for its role. Passing it through would hand
       * the renderer a shape with no path and draw nothing at all.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRolesWith("router", { topologyShape: "sparkle" }),
      );

      const router: NetworkTopologyNode = nodeById(result, "d-router")!;
      // The rest of the row still applies; only the unusable field is dropped.
      expect(router.roleLabel).toBe("Router");
      expect(router).not.toHaveProperty("roleShape");
    });

    it("stamps the catalogue's own spelling of a key so the legend groups once", () => {
      /*
       * The legend groups by roleKey. A device that got its key from the
       * classifier ("switch") and one an operator assigned ("switch") must
       * therefore land on the SAME string, or one estate's switches split into
       * two legend entries that read identically.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "access-1", {
            sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
          }),
          makeDevice("d2", "ping-only-9", { deviceRole: "switch" }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        [
          {
            id: "role-switch",
            key: "Switch",
            name: "Access Switch",
            topologyShape: "rounded-square",
          },
        ],
      );

      expect(nodeById(result, "d1")!.roleKey).toBe("Switch");
      expect(nodeById(result, "d2")!.roleKey).toBe("Switch");
      expect(nodeById(result, "d1")!.roleLabel).toBe("Access Switch");
      expect(nodeById(result, "d2")!.roleLabel).toBe("Access Switch");
    });

    it("gives a node the classifier declined to place no stamp at all", () => {
      /*
       * "unknown" is the classifier saying it has no answer, not a role, and
       * no project has a row for it — offering one would mean "stop
       * classifying this device forever". A neutral node is the honest
       * drawing, so nothing is stamped even with a full catalogue loaded.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRoles(),
      );

      const blank: NetworkTopologyNode = nodeById(result, "d-blank")!;
      expect(blank.role).toBe("unknown");
      expectNoRoleStamp(blank);
      // The devices around it were stamped, so this is a decision, not a miss.
      expect(nodeById(result, "d-router")!.roleKey).toBe("router");
    });
  });

  describe("a role the operator assigned to a device", () => {
    it("stamps the assigned built-in role, over anything the evidence said", () => {
      /*
       * The assignment is the only statement about the role that is not an
       * inference, so it decides both halves: the built-in `role` AND which
       * configured row the node is drawn from. The classifier would answer
       * "switch" here off the Catalyst model string.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "dmz-1", {
            sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
            deviceRole: "firewall",
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRolesWith("firewall", { name: "Perimeter Firewall" }),
      );

      const node: NetworkTopologyNode = nodeById(result, "d1")!;
      expect(node.role).toBe("firewall");
      expect(node.roleKey).toBe("firewall");
      // From the row, not from the built-in DEVICE_ROLE_LABELS map.
      expect(node.roleLabel).toBe("Perimeter Firewall");
      expect(node.roleShape).toBe("diamond");
      expect(node.isCoreLayerRole).toBe(true);
    });

    it("draws a device as its CUSTOM role while `role` keeps the built-in answer", () => {
      /*
       * A custom role has no place in NetworkTopologyDeviceRole and never can
       * — that union is the vocabulary the SNMP classifier speaks, and it
       * cannot invent a project's own roles. So the two fields deliberately
       * disagree here: `role` stays whatever the evidence supports (this box
       * reports a Linux kernel, so "server"), and every field a human reads —
       * label, silhouette, tier — comes from the PoS Terminal row.
       *
       * Leaving `role` alone is not an oversight. It is what any consumer that
       * still speaks only the built-in union falls back to, and blanking it to
       * "unknown" would downgrade those consumers rather than extend them.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d-pos", "lane-4-till", {
            sysDescr: "Linux 5.10.0 x86_64",
            deviceRole: "posTerminal",
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        [
          ...seededRoles(),
          {
            id: "role-pos",
            key: "posTerminal",
            name: "PoS Terminal",
            topologyShape: "hexagon",
            isCoreLayer: false,
            isSnmpWalkable: false,
          },
        ],
      );

      const node: NetworkTopologyNode = nodeById(result, "d-pos")!;
      expect(node.role).toBe("server");
      expect(node.roleKey).toBe("posTerminal");
      expect(node.roleLabel).toBe("PoS Terminal");
      expect(node.roleShape).toBe("hexagon");
      expect(node.isCoreLayerRole).toBe(false);
      expect(node.isSnmpWalkableRole).toBe(false);
      expect(node.roleId).toBe("role-pos");
    });

    it("matches an assigned key case- and whitespace-insensitively", () => {
      /*
       * The stored value is a ShortText column: what lands in it depends on
       * which form, import or API call wrote it. A role that only applied when
       * the key was typed in exactly the row's camelCase spelling would be a
       * trap, and the same leniency parseDeviceRoleOverride already applies to
       * the built-in half has to apply to the configured half.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "a", { deviceRole: "  SWITCH  " }),
          makeDevice("d2", "b", { deviceRole: "POSTERMINAL" }),
          makeDevice("d3", "c", { deviceRole: " posTerminal " }),
          makeDevice("d4", "d", { deviceRole: "wirelessaccesspoint" }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        [
          ...seededRoles(),
          {
            id: "role-pos",
            key: "posTerminal",
            name: "PoS Terminal",
            topologyShape: "hexagon",
          },
        ],
      );

      expect(nodeById(result, "d1")!.roleKey).toBe("switch");
      expect(nodeById(result, "d1")!.roleLabel).toBe("Switch");
      // Both spellings of the custom key reach the one row.
      expect(nodeById(result, "d2")!.roleKey).toBe("posTerminal");
      expect(nodeById(result, "d3")!.roleKey).toBe("posTerminal");
      expect(nodeById(result, "d4")!.roleKey).toBe("wirelessAccessPoint");
      expect(nodeById(result, "d4")!.roleLabel).toBe("Wireless AP");
    });

    it("stamps nothing when the assigned key matches no row in the catalogue", () => {
      /*
       * The role the device was assigned has since been deleted, or the row
       * belongs to a project this device was moved out of. There is nothing to
       * draw it as, so it falls all the way back to the built-in behaviour —
       * and NOT to the classifier's row, because the assignment is still the
       * operator's statement about what this box is and using "firewall"'s
       * label for a device somebody called an SD-WAN edge would be a lie.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "edge-1", {
            sysDescr: "FortiGate-60F v7.2.5",
            deviceRole: "sdWanEdge",
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRoles(),
      );

      const node: NetworkTopologyNode = nodeById(result, "d1")!;
      // The classifier still gets to answer, exactly as it did before.
      expect(node.role).toBe("firewall");
      expectNoRoleStamp(node);
    });

    it("stamps nothing when the project deleted the row the classifier chose", () => {
      /*
       * The permanent case, not a transient one: a project may delete a seeded
       * role the classifier can still produce. An empty stamp on those nodes
       * is what makes them draw the pre-feature map instead of erroring or
       * borrowing another role's shape.
       */
      const withoutCameras: Array<TopologyDeviceRoleInput> =
        seededRoles().filter((role: TopologyDeviceRoleInput) => {
          return role.key !== "camera";
        });

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "lobby-cam", {
            deviceModel: "Hikvision DS-2CD2143G0",
          }),
          makeDevice("d2", "access-1", {
            sysDescr: "Cisco IOS Software, Catalyst 9300-48P",
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        withoutCameras,
      );

      expect(nodeById(result, "d1")!.role).toBe("camera");
      expectNoRoleStamp(nodeById(result, "d1")!);
      // Its neighbour, whose row survives, is unaffected.
      expect(nodeById(result, "d2")!.roleKey).toBe("switch");
    });
  });

  describe("nodes nobody manages", () => {
    it("stamps an unmanaged CDP peer from the classifier's answer", () => {
      /*
       * A peer is exactly the node an operator adopts, and the adopt flow
       * reads isSnmpWalkableRole to decide whether the modal opens on SNMP
       * polling or on a plain monitor. Without the stamp that decision falls
       * back to a hardcoded set, which is what made a project's own roles
       * unable to influence it.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "access-1", {
            sysName: "access-1",
            cdpNeighbors: [
              {
                localInterfaceIndex: 1,
                remoteDeviceId: "ap-lobby",
                remotePlatform: "cisco AIR-CAP3702I-A-K9",
              },
              {
                localInterfaceIndex: 2,
                remoteDeviceId: "handset-3f",
                remotePlatform: "Cisco IP Phone 7961",
              },
            ],
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRolesWith("wirelessAccessPoint", { name: "Access Point" }),
      );

      const ap: NetworkTopologyNode = nodeById(result, "unmanaged:ap-lobby")!;
      expect(ap.role).toBe("wirelessAccessPoint");
      expect(ap.roleKey).toBe("wirelessAccessPoint");
      expect(ap.roleLabel).toBe("Access Point");
      expect(ap.roleShape).toBe("triangle");
      // Walkable: adopting this one should open on SNMP.
      expect(ap.isSnmpWalkableRole).toBe(true);

      const phone: NetworkTopologyNode = nodeById(
        result,
        "unmanaged:handset-3f",
      )!;
      expect(phone.roleKey).toBe("phone");
      // Not walkable: adopting a handset should open on a monitor instead.
      expect(phone.isSnmpWalkableRole).toBe(false);
    });

    it("leaves an unmanaged peer nothing said anything about unstamped", () => {
      /*
       * Most peers come back "unknown" and should: a name and nothing else is
       * not evidence. Those nodes keep drawing neutral, catalogue or no
       * catalogue.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          makeDevice("d1", "access-1", {
            sysName: "access-1",
            lldpNeighbors: [
              { localInterfaceIndex: 3, remoteSysName: "prod-node-7" },
            ],
          }),
        ],
        now,
        [],
        [],
        [],
        new Set<string>(),
        seededRoles(),
      );

      const peer: NetworkTopologyNode = nodeById(
        result,
        "unmanaged:prod-node-7",
      )!;
      expect(peer.role).toBe("unknown");
      expectNoRoleStamp(peer);
    });

    it("stamps discovered endpoints, so a renamed handset role reaches them", () => {
      /*
       * Endpoints are learned from ARP/FDB and never assigned a role by hand,
       * so the classifier's answer is all there is — and a project that
       * renamed "IP phone" expects to see the new word on its handsets, which
       * are the most numerous thing on the map.
       */
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        seededRolesWith("phone", { name: "Desk Handset" }),
      );

      const handset: NetworkTopologyNode = nodeById(
        result,
        "endpoint:ep-phone",
      )!;
      expect(handset.role).toBe("phone");
      expect(handset.roleKey).toBe("phone");
      expect(handset.roleLabel).toBe("Desk Handset");
      expect(handset.roleShape).toBe("rect");

      // An endpoint nothing was said about is still a host, and still stamped.
      const plain: NetworkTopologyNode = nodeById(result, "endpoint:ep-plain")!;
      expect(plain.role).toBe("host");
      expect(plain.roleKey).toBe("host");
      expect(plain.roleLabel).toBe("Host");
    });

    it("keeps a stamp off the endpoints of a project with no host row", () => {
      /*
       * Same fallback as everywhere else, checked on the node kind that never
       * has an assignment to fall back FROM. Endpoints are capped and numerous,
       * so a missing row must be cheap and silent, not an error per node.
       */
      const withoutHosts: Array<TopologyDeviceRoleInput> = seededRoles().filter(
        (role: TopologyDeviceRoleInput) => {
          return role.key !== "host";
        },
      );

      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        withoutHosts,
      );

      expectNoRoleStamp(nodeById(result, "endpoint:ep-plain")!);
      // The handset beside it, whose row survives, is still stamped.
      expect(nodeById(result, "endpoint:ep-phone")!.roleKey).toBe("phone");
    });
  });

  describe("the stamp is deterministic", () => {
    it("produces identical role fields on two builds of the same input", () => {
      /*
       * The map is rebuilt on every poll and on every page load. A role field
       * that varied between builds would make nodes change shape, tier or
       * legend group under an operator watching the same screen.
       */
      const roles: Array<TopologyDeviceRoleInput> = seededRolesWith("router", {
        name: "Edge Router",
      });

      const first: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        roles,
      );
      const second: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        roles,
      );

      expect(second.nodes).toStrictEqual(first.nodes);
    });

    it("ignores the order the catalogue rows arrive in", () => {
      /*
       * Rows come off a query ordered by the settings page's `order` column,
       * and an operator may reorder that list at any time. Reordering the
       * legend must not change a single thing about how a node is drawn.
       */
      const roles: Array<TopologyDeviceRoleInput> = seededRoles();

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        roles,
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        [...roles].reverse(),
      );

      expect(reversed.nodes).toStrictEqual(forward.nodes);
    });

    it("resolves each device's stamp independently of the device query order", () => {
      const roles: Array<TopologyDeviceRoleInput> = seededRoles();
      const devices: Array<TopologyDeviceInput> = estateDevices();

      const forward: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        devices,
        now,
        [],
        [],
        [],
        new Set<string>(),
        roles,
      );
      const reversed: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [...devices].reverse(),
        now,
        [],
        [],
        [],
        new Set<string>(),
        roles,
      );

      for (const deviceId of ["d-router", "d-switch", "d-blank"]) {
        expect(nodeById(reversed, deviceId)).toStrictEqual(
          nodeById(forward, deviceId),
        );
      }
    });

    it("does not modify the catalogue it was handed", () => {
      /*
       * The API loads the project's roles once and may reuse the array. A
       * builder that wrote back into it would corrupt the next build in the
       * same request.
       */
      const roles: Array<TopologyDeviceRoleInput> = seededRoles();
      const before: string = JSON.stringify(roles);

      NetworkTopologyUtil.buildTopology(
        estateDevices(),
        now,
        [],
        estateEndpoints(),
        [],
        new Set<string>(),
        roles,
      );

      expect(JSON.stringify(roles)).toBe(before);
    });
  });
});
