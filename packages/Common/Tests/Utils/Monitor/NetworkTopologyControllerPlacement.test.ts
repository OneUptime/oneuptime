import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import { NetworkDeviceControllerLink } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { CONTROLLER_SIGHTING_CURRENT_FOR_MS } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
  TopologyInterfaceInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MAP FROM WHAT A NETWORK CONTROLLER REPORTS (OneUptime issue #5379).
 *
 * The first describe is the store in the issue's screenshots: a Meraki MX,
 * three MS switches, access points, and kitchen displays that answer ping,
 * sit in another VLAN from the switches and had floated under "Not linked to
 * anything". The rest pin the rules that story rests on.
 */

const NOW: Date = new Date("2026-11-01T12:00:00Z");
const HOUR: number = 60 * 60 * 1000;
const SITE: string = "site-wb-0660";

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function pingOnly(
  id: string,
  hostname: string,
  extra: Partial<TopologyDeviceInput> = {},
): TopologyDeviceInput {
  return {
    id,
    name: id,
    hostname,
    siteId: SITE,
    isReachable: true,
    lastPolledAt: NOW,
    ...extra,
  };
}

function merakiClient(
  mac: string,
  extra: Partial<TopologyEndpointInput> = {},
): TopologyEndpointInput {
  return {
    id: `endpoint-${mac}`,
    macAddress: mac,
    attachedNetworkDeviceId: "sw-01",
    attachedPortName: "Port 7",
    siteId: SITE,
    lastSeenAt: ago(HOUR),
    attachmentSource: "meraki",
    ...extra,
  };
}

function edgeBetween(
  result: TopologyBuildResult,
  a: string,
  b: string,
): NetworkTopologyEdge | undefined {
  return result.edges.find((edge: NetworkTopologyEdge) => {
    return (
      (edge.fromNodeId === a && edge.toNodeId === b) ||
      (edge.fromNodeId === b && edge.toNodeId === a)
    );
  });
}

function nodeNamed(
  result: TopologyBuildResult,
  id: string,
): NetworkTopologyNode | undefined {
  return result.nodes.find((node: NetworkTopologyNode) => {
    return node.id === id;
  });
}

describe("the store in the issue", () => {
  const devices: Array<TopologyDeviceInput> = [
    pingOnly("rtr", "10.1.1.1", {
      name: "UN0660WANRTR01",
      vendor: "Cisco Meraki",
      deviceModel: "MX85",
    }),
    pingOnly("sw-01", "10.242.166.220", {
      name: "UN0660LANSWI01",
      interfacesUp: 21,
      interfacesDown: 31,
    }),
    pingOnly("kds01", "10.18.166.51", { name: "wb-0660-kds01" }),
    pingOnly("kds04", "10.18.166.54", { name: "wb-0660-kds04" }),
  ];
  const interfaces: Array<TopologyInterfaceInput> = [
    {
      networkDeviceId: "sw-01",
      interfaceIndex: 7,
      name: "port7",
      isOperationallyUp: true,
    },
    {
      networkDeviceId: "sw-01",
      interfaceIndex: 9,
      name: "port9",
      isOperationallyUp: false,
    },
  ];

  test("kitchen displays Meraki lists hang from their ports, not from nothing", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      devices,
      NOW,
      interfaces,
      [
        merakiClient("aa:bb:cc:00:00:51", { ipAddress: "10.18.166.51" }),
        merakiClient("aa:bb:cc:00:00:54", {
          ipAddress: "10.18.166.54",
          attachedPortName: "Port 9",
        }),
      ],
    );

    const first: NetworkTopologyEdge | undefined = edgeBetween(
      result,
      "sw-01",
      "kds01",
    );

    expect(first).toMatchObject({
      fromNodeId: "sw-01",
      toNodeId: "kds01",
      fromPort: "Port 7",
      protocols: ["fdb"],
      parentNodeId: "sw-01",
      learnedByNodeId: "sw-01",
      reportedBy: "meraki",
    });
    // The port state a walk knows, found by the port's number.
    expect(first?.fromInterface?.interfaceIndex).toBe(7);
    expect(first?.fromInterface?.isOperationallyUp).toBe(true);
    expect(
      edgeBetween(result, "sw-01", "kds04")?.fromInterface?.isOperationallyUp,
    ).toBe(false);

    // Adopted, not drawn again as a stranger beside the device's own node.
    expect(result.adoptedEndpointCount).toBe(2);
    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "endpoint";
      }),
    ).toHaveLength(0);
  });

  test("a row with no ifIndex, as the database hands it back, still finds its port", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      devices,
      NOW,
      interfaces,
      [
        merakiClient("aa:bb:cc:00:00:51", {
          ipAddress: "10.18.166.51",
          attachedInterfaceIndex: null as unknown as undefined,
        }),
      ],
    );

    expect(
      edgeBetween(result, "sw-01", "kds01")?.fromInterface?.interfaceIndex,
    ).toBe(7);
  });

  test("a client on no port is labelled with none, not with an index it does not have", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      devices,
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:51", {
          ipAddress: "10.18.166.51",
          attachedPortName: undefined,
          attachedInterfaceIndex: null as unknown as undefined,
        }),
        merakiClient("aa:bb:cc:00:00:99", {
          attachedPortName: undefined,
          attachedInterfaceIndex: null as unknown as undefined,
        }),
      ],
    );

    expect(edgeBetween(result, "sw-01", "kds01")?.fromPort).toBeUndefined();
    expect(
      edgeBetween(result, "sw-01", "endpoint:endpoint-aa:bb:cc:00:00:99")
        ?.fromPort,
    ).toBeUndefined();
  });

  test("a display stays placed between two reads of the list, hours after a walk's window", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      devices,
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:51", {
          ipAddress: "10.18.166.51",
          lastSeenAt: ago(CONTROLLER_SIGHTING_CURRENT_FOR_MS - 1000),
        }),
      ],
    );

    expect(edgeBetween(result, "sw-01", "kds01")).toBeDefined();
  });

  test("the router the switch reports by its advertised name is the router, not a stranger", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        ...devices.filter((device: TopologyDeviceInput) => {
          return device.id !== "sw-01";
        }),
        {
          ...devices.find((device: TopologyDeviceInput) => {
            return device.id === "sw-01";
          })!,
          lldpNeighbors: [
            {
              localInterfaceIndex: 49,
              remoteSysName: "Meraki MX85 - UN0660WANRTR01",
              remoteChassisId: "88:15:44:c8:5d:58",
              remotePortId: "port3",
            },
          ],
        },
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw-01", "rtr")).toBeDefined();
    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      }),
    ).toHaveLength(0);
  });

  test("the cable Meraki reports for a switch and a router a walk says nothing about", () => {
    const links: Array<NetworkDeviceControllerLink> = [
      {
        port: "Port 49",
        peerDeviceId: "rtr",
        peerName: "UN0660WANRTR01",
        peerPort: "3",
        protocols: ["lldp"],
      },
    ];
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      devices.map((device: TopologyDeviceInput) => {
        return device.id === "sw-01"
          ? { ...device, controllerLinks: links, controllerProvider: "meraki" }
          : device;
      }),
      NOW,
    );

    expect(edgeBetween(result, "sw-01", "rtr")).toMatchObject({
      fromPort: "Port 49",
      toPort: "3",
      protocols: ["lldp"],
      reportedBy: "meraki",
    });
  });
});

describe("links a controller reports", () => {
  const link: NetworkDeviceControllerLink = {
    port: "Port 49",
    peerName: "core",
    peerPort: "Port 1",
    protocols: ["lldp"],
  };

  const reporter: (
    links: Array<NetworkDeviceControllerLink>,
    extra?: Partial<TopologyDeviceInput>,
  ) => TopologyDeviceInput = (
    links: Array<NetworkDeviceControllerLink>,
    extra: Partial<TopologyDeviceInput> = {},
  ): TopologyDeviceInput => {
    return pingOnly("sw", "10.0.0.2", {
      controllerLinks: links,
      controllerProvider: "meraki",
      ...extra,
    });
  };

  test("a far end known by id outranks every name: two devices may share one", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "core-b" }]),
        pingOnly("core-a", "10.0.0.3", { name: "core" }),
        pingOnly("core-b", "10.0.0.4", { name: "core" }),
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw", "core-b")).toBeDefined();
    expect(edgeBetween(result, "sw", "core-a")).toBeUndefined();
  });

  test("a far end by id that left this map falls back to what recognises it", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "gone" }]),
        pingOnly("core-a", "10.0.0.3", { name: "core" }),
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw", "core-a")).toBeDefined();
  });

  test("a far end with no name at all is enough when its id is known", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ port: "Port 1", peerDeviceId: "core-a", protocols: [] }]),
        pingOnly("core-a", "10.0.0.3"),
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw", "core-a")).toBeDefined();
  });

  test("a far end nothing here is drawn as a peer, with what the controller knows", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([
          {
            ...link,
            peerName: "Meraki MR70 - Patio",
            peerMac: "88:15:44:00:00:01",
            peerIp: "10.0.0.9",
            peerPlatform: "Meraki MR70",
          },
        ]),
      ],
      NOW,
    );

    const peer: NetworkTopologyNode | undefined = result.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      },
    );

    expect(peer).toMatchObject({
      name: "Patio",
      ipAddress: "10.0.0.9",
      deviceModel: "Meraki MR70",
      role: "wirelessAccessPoint",
    });
  });

  test("one cable reported by both ends and by a walk is one line, with every source", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw", "10.0.0.2", {
          lldpNeighbors: [
            {
              localInterfaceIndex: 49,
              remoteSysName: "core",
              remotePortId: "Gi0/1",
            },
          ],
          controllerLinks: [{ ...link, peerDeviceId: "core" }],
          controllerProvider: "meraki",
        }),
        pingOnly("core", "10.0.0.3", {
          name: "core",
          controllerLinks: [
            {
              port: "Port 1",
              peerDeviceId: "sw",
              peerPort: "Port 49",
              protocols: ["cdp"],
            },
          ],
          controllerProvider: "meraki",
        }),
      ],
      NOW,
      [{ networkDeviceId: "sw", interfaceIndex: 49, name: "Gi1/0/49" }],
    );

    expect(result.edges).toHaveLength(1);

    const edge: NetworkTopologyEdge = result.edges[0]!;

    expect(edge.protocols).toEqual(["lldp", "cdp"]);
    expect(edge.reportedBy).toBe("meraki");
    // What a walk measured keeps its slot over what a reading says.
    expect(edge.fromPort).toBe("Gi1/0/49");
    expect(edge.toPort).toBe("Gi0/1");
  });

  test("a link somebody drew by hand merges too, and keeps their parent", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "core" }]),
        pingOnly("core", "10.0.0.3"),
      ],
      NOW,
      [],
      [],
      [
        {
          fromDeviceId: "core",
          toDeviceId: "sw",
          name: "Uplink",
          parentDeviceId: "core",
        },
      ],
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      protocols: ["lldp", "manual"],
      reportedBy: "meraki",
      parentNodeId: "core",
      name: "Uplink",
    });
  });

  test("a link that says nothing about how it knows is still a link", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "core", protocols: [] }]),
        pingOnly("core", "10.0.0.3"),
      ],
      NOW,
    );

    expect(result.edges[0]).toMatchObject({
      protocols: [],
      reportedBy: "meraki",
    });
  });

  test("a device does not link to itself, whichever way it is named", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [reporter([{ port: "Port 1", peerDeviceId: "sw", protocols: ["lldp"] }])],
      NOW,
    );

    expect(result.edges).toHaveLength(0);
  });

  test("a port named on both ends finds both ends' state", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "core" }]),
        pingOnly("core", "10.0.0.3"),
      ],
      NOW,
      [
        {
          networkDeviceId: "sw",
          interfaceIndex: 49,
          name: "port49",
          isOperationallyUp: true,
        },
        {
          networkDeviceId: "core",
          interfaceIndex: 1,
          name: "1",
          isOperationallyUp: false,
        },
      ],
    );

    expect(result.edges[0]?.fromInterface?.interfaceIndex).toBe(49);
    expect(result.edges[0]?.toInterface?.isOperationallyUp).toBe(false);
  });

  test("a number two interfaces both answer to names neither", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        reporter([{ ...link, peerDeviceId: "core", port: "3" }]),
        pingOnly("core", "10.0.0.3"),
      ],
      NOW,
      [
        { networkDeviceId: "sw", interfaceIndex: 3, name: "port3" },
        { networkDeviceId: "sw", interfaceIndex: 103, name: "Port 3" },
      ],
    );

    expect(result.edges[0]?.fromInterface).toBeUndefined();
    expect(result.edges[0]?.fromPort).toBe("3");
  });

  test.each([
    ["Gi0/3", "3"],
    ["1_MA-MOD-4X10G_1", "1"],
    ["port3a", "3"],
  ])(
    "%s is not the port numbered %s: a port with more structure stays what it is",
    (label: string, _number: string) => {
      const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
        [
          reporter([{ ...link, peerDeviceId: "core", port: label }]),
          pingOnly("core", "10.0.0.3"),
        ],
        NOW,
        [{ networkDeviceId: "sw", interfaceIndex: 3, name: "port3" }],
      );

      expect(result.edges[0]?.fromInterface).toBeUndefined();
      expect(result.edges[0]?.fromPort).toBe(label);
    },
  );
});

describe("names", () => {
  test("a peer known by its Meraki name keeps the id it was pinned and hidden under", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw", "10.0.0.2", {
          lldpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteSysName: "Meraki MR70 - Patio",
            },
          ],
        }),
      ],
      NOW,
    );

    const peer: NetworkTopologyNode | undefined = result.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      },
    );

    expect(peer?.id).toBe("unmanaged:meraki mr70 - patio");
    expect(peer?.name).toBe("Patio");
    expect(peer?.deviceModel).toBe("Meraki MR70");
    expect(peer?.role).toBe("wirelessAccessPoint");
  });

  test("a device literally called that is still matched first", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw", "10.0.0.2", {
          lldpNeighbors: [
            { localInterfaceIndex: 1, remoteSysName: "Meraki MR70 - Patio" },
          ],
        }),
        pingOnly("exact", "10.0.0.3", { name: "Meraki MR70 - Patio" }),
        pingOnly("short", "10.0.0.4", { name: "Patio" }),
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw", "exact")).toBeDefined();
    expect(edgeBetween(result, "sw", "short")).toBeUndefined();
  });

  test("CDP carries the same form, and its own platform wins", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw", "10.0.0.2", {
          cdpNeighbors: [
            {
              localInterfaceIndex: 1,
              remoteDeviceId: "Meraki MS120 - Back",
              remotePlatform: "cisco MS120",
            },
          ],
        }),
      ],
      NOW,
    );

    const peer: NetworkTopologyNode | undefined = result.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      },
    );

    expect(peer?.name).toBe("Back");
    expect(peer?.deviceModel).toBe("cisco MS120");
  });

  test("two names for one device, from two switches, are one peer", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw-1", "10.0.0.2", {
          lldpNeighbors: [
            { localInterfaceIndex: 1, remoteSysName: "Meraki MR70 - Patio" },
          ],
        }),
        pingOnly("sw-2", "10.0.0.3", {
          controllerLinks: [
            { port: "Port 2", peerName: "Patio", protocols: ["lldp"] },
          ],
          controllerProvider: "meraki",
        }),
      ],
      NOW,
    );

    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      }),
    ).toHaveLength(1);
  });

  test("an endpoint a controller named is drawn by that name, ahead of its maker's", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [pingOnly("sw-01", "10.0.0.2")],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          vendor: "Ingenico",
          ipAddress: "10.18.0.9",
          hostname: "register-3",
        }),
      ],
    );

    const node: NetworkTopologyNode | undefined = nodeNamed(
      result,
      "endpoint:endpoint-aa:bb:cc:00:00:01",
    );

    expect(node?.name).toBe("register-3");
    expect(node?.hostname).toBe("register-3");
  });

  test("what a person classified it as still comes first, and the name stays beside it", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [pingOnly("sw-01", "10.0.0.2")],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          classification: "POS",
          hostname: "register-3",
        }),
      ],
    );

    const node: NetworkTopologyNode | undefined = nodeNamed(
      result,
      "endpoint:endpoint-aa:bb:cc:00:00:01",
    );

    expect(node?.name).toBe("POS");
    expect(node?.hostname).toBe("register-3");
  });

  test("a managed device is not renamed: what the controller calls it is shown beside its name", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw-01", "10.0.0.2"),
        pingOnly("kds", "10.18.166.51", { name: "wb-0660-kds01" }),
      ],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          hostname: "KITCHEN-1",
        }),
      ],
    );

    expect(nodeNamed(result, "kds")?.name).toBe("wb-0660-kds01");
    expect(nodeNamed(result, "kds")?.hostname).toBe("KITCHEN-1");
  });
});

describe("one box, reported two ways", () => {
  const phone: Partial<TopologyDeviceInput> = {
    lldpNeighbors: [
      {
        localInterfaceIndex: 7,
        remoteSysName: "SEP002F5C7BF3E4",
        remotePortId: "Port 1",
      },
    ],
  };

  test("a desk phone LLDP drew and Meraki lists is one node, not two on one port", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [pingOnly("sw-01", "10.0.0.2", phone)],
      NOW,
      [],
      [
        merakiClient("00:2f:5c:7b:f3:e4", {
          ipAddress: "10.7.0.15",
          vlanId: 40,
          vendor: "Cisco",
          hostname: "Front counter phone",
        }),
      ],
    );

    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "endpoint";
      }),
    ).toHaveLength(0);

    const peer: NetworkTopologyNode | undefined = result.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      },
    );

    expect(peer).toMatchObject({
      name: "Front counter phone",
      sysName: "SEP002F5C7BF3E4",
      macAddress: "00:2f:5c:7b:f3:e4",
      ipAddress: "10.7.0.15",
      vlanId: 40,
      vendor: "Cisco",
    });
    expect(peer?.id).toBe("unmanaged:sep002f5c7bf3e4");
    expect(result.edges).toHaveLength(1);
    expect(result.adoptedEndpointCount).toBe(1);
  });

  test("a client list with no name for it leaves the phone's own", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [pingOnly("sw-01", "10.0.0.2", phone)],
      NOW,
      [],
      [merakiClient("00:2f:5c:7b:f3:e4")],
    );

    const peer: NetworkTopologyNode | undefined = result.nodes.find(
      (node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      },
    );

    expect(peer?.name).toBe("SEP002F5C7BF3E4");
    expect(peer?.sysName).toBeUndefined();
  });

  test("a chassis MAC recognises a peer the same way", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw-01", "10.0.0.2", {
          lldpNeighbors: [
            {
              localInterfaceIndex: 7,
              remoteChassisId: "aa:bb:cc:dd:ee:ff",
            },
          ],
        }),
      ],
      NOW,
      [],
      [merakiClient("aa:bb:cc:dd:ee:ff", { hostname: "Kiosk" })],
    );

    expect(result.nodes).toHaveLength(2);
    expect(
      result.nodes.find((node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      })?.name,
    ).toBe("Kiosk");
  });

  test("a phone registered as a device is found by the MAC in its name", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        pingOnly("sw-01", "10.0.0.2", phone),
        pingOnly("handset", "10.7.0.15", {
          macAddress: "00:2F:5C:7B:F3:E4",
        }),
      ],
      NOW,
    );

    expect(edgeBetween(result, "sw-01", "handset")).toBeDefined();
    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "unmanaged";
      }),
    ).toHaveLength(0);
  });

  test("an endpoint that is no peer is unaffected by the peers around it", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [pingOnly("sw-01", "10.0.0.2", phone)],
      NOW,
      [],
      [merakiClient("aa:bb:cc:00:00:01")],
    );

    expect(
      result.nodes.filter((node: NetworkTopologyNode) => {
        return node.kind === "endpoint";
      }),
    ).toHaveLength(1);
  });
});

describe("how long a sighting stands", () => {
  const device: TopologyDeviceInput = pingOnly("kds", "10.18.166.51");
  const switchDevice: TopologyDeviceInput = pingOnly("sw-01", "10.0.0.2");

  test("an address match from a controller lasts as long as the controller's window", () => {
    const within: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice, device],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          lastSeenAt: ago(5 * HOUR),
        }),
      ],
    );
    const past: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice, device],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          lastSeenAt: ago(7 * HOUR),
        }),
      ],
    );

    expect(edgeBetween(within, "sw-01", "kds")).toBeDefined();
    expect(edgeBetween(past, "sw-01", "kds")).toBeUndefined();
  });

  test("the same age from a walk is long gone", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice, device],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          lastSeenAt: ago(5 * HOUR),
          attachmentSource: undefined,
        }),
      ],
    );

    expect(edgeBetween(result, "sw-01", "kds")).toBeUndefined();
  });

  test("a device the list taught its MAC keeps its cable overnight", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice, { ...device, macAddress: "aa:bb:cc:00:00:01" }],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          lastSeenAt: ago(14 * HOUR),
        }),
      ],
    );

    expect(edgeBetween(result, "sw-01", "kds")).toBeDefined();
  });

  test("an endpoint a controller reports reads as up between two reads of its list", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", { lastSeenAt: ago(2 * HOUR) }),
        merakiClient("aa:bb:cc:00:00:02", { lastSeenAt: ago(7 * HOUR) }),
        merakiClient("aa:bb:cc:00:00:03", {
          lastSeenAt: ago(2 * HOUR),
          attachmentSource: undefined,
        }),
      ],
    );

    expect(
      nodeNamed(result, "endpoint:endpoint-aa:bb:cc:00:00:01")?.status,
    ).toBe("up");
    expect(
      nodeNamed(result, "endpoint:endpoint-aa:bb:cc:00:00:02")?.status,
    ).toBe("down");
    expect(
      nodeNamed(result, "endpoint:endpoint-aa:bb:cc:00:00:03")?.status,
    ).toBe("down");
  });

  test("a row in another site at that address is still nobody's", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [switchDevice, device],
      NOW,
      [],
      [
        merakiClient("aa:bb:cc:00:00:01", {
          ipAddress: "10.18.166.51",
          siteId: "another-store",
        }),
      ],
    );

    expect(edgeBetween(result, "sw-01", "kds")).toBeUndefined();
  });
});

describe("why a device has no links", () => {
  const placementOf: (
    devices: Array<TopologyDeviceInput>,
    id: string,
  ) => unknown = (devices: Array<TopologyDeviceInput>, id: string): unknown => {
    return nodeNamed(NetworkTopologyUtil.buildTopology(devices, NOW), id)
      ?.diagnostics?.placement;
  };

  test("what the device itself can be recognised by", () => {
    expect(placementOf([pingOnly("a", "10.0.0.1")], "a")).toMatchObject({
      hasMacAddress: false,
      hasAddressKey: true,
    });
    expect(
      placementOf(
        [pingOnly("a", "kds.corp.local", { macAddress: "AA-BB-CC-00-00-01" })],
        "a",
      ),
    ).toMatchObject({ hasMacAddress: true, hasAddressKey: false });
  });

  test("what could have placed it is counted at its own site, not across the project", () => {
    const devices: Array<TopologyDeviceInput> = [
      pingOnly("a", "10.0.0.1"),
      pingOnly("collector", "10.0.0.2", { isEndpointCollectionEnabled: true }),
      pingOnly("meraki", "10.0.0.3", { isDescribedByController: true }),
      pingOnly("elsewhere", "10.0.1.1", {
        siteId: "other",
        isEndpointCollectionEnabled: true,
        isDescribedByController: true,
      }),
      pingOnly("floating", "10.0.2.1", { siteId: "empty" }),
    ];

    expect(placementOf(devices, "a")).toMatchObject({
      siteEndpointCollectorCount: 1,
      siteControllerDeviceCount: 1,
    });
    expect(placementOf(devices, "floating")).toMatchObject({
      siteEndpointCollectorCount: 0,
      siteControllerDeviceCount: 0,
    });
  });

  test("a device with no site is counted with the others that have none", () => {
    const devices: Array<TopologyDeviceInput> = [
      pingOnly("a", "10.0.0.1", { siteId: undefined }),
      pingOnly("b", "10.0.0.2", {
        siteId: undefined,
        isEndpointCollectionEnabled: true,
      }),
    ];

    expect(placementOf(devices, "a")).toMatchObject({
      siteEndpointCollectorCount: 1,
    });
  });
});
