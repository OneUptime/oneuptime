import { DiscoveredDetailsMerge } from "../../../../Server/Services/NetworkDeviceService";
import { EndpointControllerClient } from "../../../../Server/Services/NetworkEndpointService";
import {
  ControllerInventoryCandidate,
  ControllerInventoryConnection,
  ControllerInventoryMatch,
  ControllerMatchRule,
  MergeControllerReadingsFunction,
} from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import NetworkControllerTopology, {
  ControllerClientCandidate,
  ControllerClientPlacement,
  ControllerLinkPlan,
  ControllerPlacedDevice,
  ControllerPlacementPlan,
  ControllerTopologyOutcome,
  FindClientCandidatesFunction,
  LearnClientMacsFunction,
  UpsertControllerClientsFunction,
  getClientBindingsBySite,
  getPlacedDevicesBySerial,
  planClientPlacements,
  planControllerLinks,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTopology";
import {
  NetworkControllerClient,
  NetworkControllerDevice,
  NetworkControllerLink,
  NetworkControllerLinkEnd,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import {
  DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY,
  NetworkDeviceDiscoveryReaderType,
  buildControllerLinks,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What a read says is plugged into what, turned into what the map reads
 * (OneUptime issue #5379). Every rule in NetworkControllerTopology's header
 * has a test here, without a database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SWITCH_ID: string = "40000000-0000-4000-8000-000000000001";
const ROUTER_ID: string = "40000000-0000-4000-8000-000000000002";
const OTHER_ID: string = "40000000-0000-4000-8000-000000000003";
const SITE_ID: string = "50000000-0000-4000-8000-000000000001";
const OTHER_SITE_ID: string = "50000000-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-11-01T12:00:00Z");

type UpsertData = Parameters<UpsertControllerClientsFunction>[0];
type MergeData = Parameters<MergeControllerReadingsFunction>[0];
type LearnData = Parameters<LearnClientMacsFunction>[0];
type LookupData = Parameters<FindClientCandidatesFunction>[0];

const CONNECTION: ControllerInventoryConnection = {
  id: CONNECTION_ID,
  name: "Stores",
  provider: NetworkControllerProvider.Meraki,
};

function deviceOf(
  serial: string,
  extra: Partial<NetworkControllerDevice> = {},
): NetworkControllerDevice {
  return {
    serial,
    name: serial,
    model: "MS130-48P",
    mac: "",
    lanIp: "",
    firmware: "",
    productType: "switch",
    controllerNetworkId: "L_660",
    networkName: "Unit 0660",
    address: "",
    ...extra,
  };
}

const SWITCH: NetworkControllerDevice = deviceOf("Q2SW", {
  name: "UN0660LANSWI01",
  mac: "e0:55:3d:00:00:01",
  lanIp: "10.242.166.220",
});
const ROUTER: NetworkControllerDevice = deviceOf("Q2MX", {
  name: "UN0660WANRTR01",
  model: "MX85",
  mac: "88:15:44:c8:5d:58",
  productType: "appliance",
});

function clientOf(
  mac: string,
  extra: Partial<NetworkControllerClient> = {},
): NetworkControllerClient {
  return {
    mac,
    ip: "",
    name: "",
    manufacturer: "",
    deviceSerial: SWITCH.serial,
    port: "Port 7",
    isWireless: false,
    lastSeenAt: NOW,
    ...extra,
  };
}

function matchOf(
  device: NetworkControllerDevice,
  rule: ControllerMatchRule = ControllerMatchRule.SerialNumber,
): ControllerInventoryMatch {
  return { device, rule };
}

const PLACED: Map<string, ControllerPlacedDevice> = new Map([
  [SWITCH.serial, { id: SWITCH_ID, siteId: SITE_ID }],
]);

describe("which device here each Meraki device is", () => {
  test("by the match Inventory made, with the device's site", () => {
    expect(
      getPlacedDevicesBySerial({
        matches: new Map([[SWITCH_ID, matchOf(SWITCH)]]),
        candidates: [{ id: SWITCH_ID, siteId: SITE_ID }],
      }).get(SWITCH.serial),
    ).toEqual({ id: SWITCH_ID, siteId: SITE_ID });
  });

  test("two devices here for one Meraki device: the stronger match", () => {
    const placed: Map<string, ControllerPlacedDevice> =
      getPlacedDevicesBySerial({
        matches: new Map([
          [ROUTER_ID, matchOf(SWITCH, ControllerMatchRule.AddressAndName)],
          [OTHER_ID, matchOf(SWITCH, ControllerMatchRule.SerialNumber)],
        ]),
        candidates: [],
      });

    expect(placed.get(SWITCH.serial)?.id).toBe(OTHER_ID);
  });

  test.each([
    ControllerMatchRule.SerialNumber,
    ControllerMatchRule.MacAddress,
    ControllerMatchRule.AddressAndName,
  ])(
    "a name and a MAC block is the weakest match: %s beats it, whichever came first",
    (rule: ControllerMatchRule) => {
      const entries: Array<[string, ControllerInventoryMatch]> = [
        [SWITCH_ID, matchOf(SWITCH, ControllerMatchRule.NameAndMacBlock)],
        [OTHER_ID, matchOf(SWITCH, rule)],
      ];

      for (const order of [entries, [...entries].reverse()]) {
        expect(
          getPlacedDevicesBySerial({
            matches: new Map(order),
            candidates: [],
          }).get(SWITCH.serial)?.id,
        ).toBe(OTHER_ID);
      }
    },
  );

  test("a device only a name and a MAC block match, as an MX is, still gets its clients", () => {
    expect(
      getPlacedDevicesBySerial({
        matches: new Map([
          [ROUTER_ID, matchOf(SWITCH, ControllerMatchRule.NameAndMacBlock)],
        ]),
        candidates: [{ id: ROUTER_ID, siteId: SITE_ID }],
      }).get(SWITCH.serial),
    ).toEqual({ id: ROUTER_ID, siteId: SITE_ID });
  });

  test("at equal strength the lower id, in whatever order they came", () => {
    const entries: Array<[string, ControllerInventoryMatch]> = [
      [OTHER_ID, matchOf(SWITCH)],
      [SWITCH_ID, matchOf(SWITCH)],
    ];

    for (const order of [entries, [...entries].reverse()]) {
      expect(
        getPlacedDevicesBySerial({
          matches: new Map(order),
          candidates: [],
        }).get(SWITCH.serial)?.id,
      ).toBe(SWITCH_ID);
    }
  });

  test("a device with no site has none", () => {
    expect(
      getPlacedDevicesBySerial({
        matches: new Map([[SWITCH_ID, matchOf(SWITCH)]]),
        candidates: [{ id: SWITCH_ID, siteId: null }],
      }).get(SWITCH.serial)?.siteId,
    ).toBeUndefined();
  });
});

describe("which clients go where", () => {
  const plan: (
    clients: Array<NetworkControllerClient>,
    managedDevices?: Array<ControllerClientCandidate>,
  ) => ControllerPlacementPlan = (
    clients: Array<NetworkControllerClient>,
    managedDevices: Array<ControllerClientCandidate> = [],
  ): ControllerPlacementPlan => {
    return planClientPlacements({
      clients,
      devices: [SWITCH, ROUTER],
      placedDevices: PLACED,
      managedDevices,
    });
  };

  test("a wired client on a switch here is placed, whatever it is", () => {
    const result: ControllerPlacementPlan = plan([
      clientOf("aa:bb:cc:00:00:01"),
    ]);

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]?.device.id).toBe(SWITCH_ID);
    expect(result.unplacedDeviceCount).toBe(0);
  });

  test("a guest's phone on Wi-Fi is not: its MAC is random and tomorrow's will differ", () => {
    expect(
      plan([
        clientOf("da:bb:cc:00:00:01", {
          isWireless: true,
          ip: "10.50.0.9",
          port: "Guest",
        }),
      ]).placements,
    ).toEqual([]);
  });

  test("a Wi-Fi client that is a device here by its MAC is", () => {
    expect(
      plan(
        [clientOf("aa:bb:cc:00:00:02", { isWireless: true })],
        [{ macAddress: "AA-BB-CC-00-00-02" }],
      ).placements,
    ).toHaveLength(1);
  });

  test("a Wi-Fi client registered at its address in the same site is", () => {
    expect(
      plan(
        [clientOf("aa:bb:cc:00:00:03", { isWireless: true, ip: "10.18.0.3" })],
        [{ hostname: "10.18.0.3", siteId: SITE_ID }],
      ).placements,
    ).toHaveLength(1);
  });

  test("every branch has a 10.18.0.3: another site's device at that address is not this client", () => {
    expect(
      plan(
        [clientOf("aa:bb:cc:00:00:03", { isWireless: true, ip: "10.18.0.3" })],
        [{ hostname: "10.18.0.3", siteId: OTHER_SITE_ID }],
      ).placements,
    ).toEqual([]);
  });

  test("a client with no address cannot be found by one", () => {
    expect(
      plan(
        [clientOf("aa:bb:cc:00:00:03", { isWireless: true })],
        [{ hostname: "", siteId: SITE_ID }],
      ).placements,
    ).toEqual([]);
  });

  test("a Meraki device is never a client of anything", () => {
    expect(plan([clientOf(ROUTER.mac)]).placements).toEqual([]);
  });

  test("a wired client on a Meraki device that is no device here names that device, once", () => {
    const result: ControllerPlacementPlan = plan([
      clientOf("aa:bb:cc:00:00:04", { deviceSerial: "Q2SW-UNKNOWN" }),
      clientOf("aa:bb:cc:00:00:05", { deviceSerial: "Q2SW-UNKNOWN" }),
      clientOf("aa:bb:cc:00:00:06", { deviceSerial: "Q2SW-OTHER" }),
    ]);

    expect(result.placements).toEqual([]);
    expect(result.unplacedDeviceCount).toBe(2);
  });

  test("a Wi-Fi client on an access point that is no device here asks for nothing", () => {
    expect(
      plan([
        clientOf("aa:bb:cc:00:00:07", {
          deviceSerial: "Q2AP-UNKNOWN",
          isWireless: true,
        }),
      ]).unplacedDeviceCount,
    ).toBe(0);
  });
});

describe("the bindings a site's clients offer the MAC learner", () => {
  const placement: (
    mac: string,
    ip: string,
    siteId: string | undefined,
  ) => ControllerClientPlacement = (
    mac: string,
    ip: string,
    siteId: string | undefined,
  ): ControllerClientPlacement => {
    return { client: clientOf(mac, { ip }), device: { id: SWITCH_ID, siteId } };
  };

  test("grouped by site, because that is where an address means anything", () => {
    const bySite: ReturnType<typeof getClientBindingsBySite> =
      getClientBindingsBySite([
        placement("aa:bb:cc:00:00:01", "10.0.0.5", SITE_ID),
        placement("aa:bb:cc:00:00:02", "10.0.0.5", OTHER_SITE_ID),
        placement("aa:bb:cc:00:00:03", "10.0.0.6", SITE_ID),
      ]);

    expect(bySite.size).toBe(2);
    expect(bySite.get(SITE_ID)?.bindings).toEqual([
      { macAddress: "aa:bb:cc:00:00:01", ipAddress: "10.0.0.5" },
      { macAddress: "aa:bb:cc:00:00:03", ipAddress: "10.0.0.6" },
    ]);
  });

  test("no site is a site of its own", () => {
    const bySite: ReturnType<typeof getClientBindingsBySite> =
      getClientBindingsBySite([
        placement("aa:bb:cc:00:00:01", "10.0.0.5", undefined),
      ]);

    expect(bySite.get("")?.siteId).toBeUndefined();
    expect(bySite.get("")?.bindings).toHaveLength(1);
  });

  test("a client with no address binds nothing", () => {
    expect(
      getClientBindingsBySite([placement("aa:bb:cc:00:00:01", "", SITE_ID)])
        .size,
    ).toBe(0);
  });
});

function endOf(
  serial: string,
  port: string,
  extra: Partial<NetworkControllerLinkEnd> = {},
): NetworkControllerLinkEnd {
  return { serial, name: "", port, mac: "", ip: "", platform: "", ...extra };
}

const CABLE: NetworkControllerLink = {
  controllerNetworkId: "L_660",
  protocols: ["lldp"],
  ends: [endOf(SWITCH.serial, "Port 49"), endOf(ROUTER.serial, "Port 3")],
};

describe("what one read's links change", () => {
  const readingBy: (connectionId: string) => Record<string, unknown> = (
    connectionId: string,
  ): Record<string, unknown> => {
    return {
      [DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY]: buildControllerLinks({
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkController,
          id: connectionId,
        },
        readAt: "2026-11-01T06:00:00.000Z",
        links: [{ port: "Port 1", peerName: "old", protocols: [] }],
      }),
    };
  };

  const plan: (data: {
    links?: Array<NetworkControllerLink>;
    linkNetworkIds?: Array<string>;
    candidates?: Array<ControllerInventoryCandidate>;
    matches?: Map<string, ControllerInventoryMatch>;
    placedDevices?: Map<string, ControllerPlacedDevice>;
    devices?: Array<NetworkControllerDevice>;
    isDeviceListComplete?: boolean;
  }) => ControllerLinkPlan = (data: {
    links?: Array<NetworkControllerLink>;
    linkNetworkIds?: Array<string>;
    candidates?: Array<ControllerInventoryCandidate>;
    matches?: Map<string, ControllerInventoryMatch>;
    placedDevices?: Map<string, ControllerPlacedDevice>;
    devices?: Array<NetworkControllerDevice>;
    isDeviceListComplete?: boolean;
  }): ControllerLinkPlan => {
    return planControllerLinks({
      connection: CONNECTION,
      readAt: NOW,
      links: data.links || [],
      linkNetworkIds: data.linkNetworkIds || ["L_660"],
      devices: data.devices || [SWITCH, ROUTER],
      isDeviceListComplete: data.isDeviceListComplete ?? true,
      matches: data.matches || new Map([[SWITCH_ID, matchOf(SWITCH)]]),
      placedDevices: data.placedDevices || PLACED,
      candidates: data.candidates || [{ id: SWITCH_ID }],
    });
  };

  const storedLinkOf: (patch: DiscoveredDetailsMerge | undefined) => unknown = (
    patch: DiscoveredDetailsMerge | undefined,
  ): unknown => {
    const reading: { links: Array<unknown> } = patch?.set?.[
      DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY
    ] as { links: Array<unknown> };
    return reading.links[0];
  };

  test("a device here gets the link, and what the device list knows fills the peer in", () => {
    const result: ControllerLinkPlan = plan({ links: [CABLE] });

    expect(result.linkedDeviceCount).toBe(1);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]?.deviceId).toBe(SWITCH_ID);
    expect(storedLinkOf(result.patches[0])).toEqual({
      port: "Port 49",
      peerName: "UN0660WANRTR01",
      peerPort: "Port 3",
      peerMac: "88:15:44:c8:5d:58",
      peerPlatform: "MX85",
      protocols: ["lldp"],
    });
  });

  test("the reading says who read it and when, under its own key", () => {
    const reading: Record<string, unknown> = plan({ links: [CABLE] }).patches[0]
      ?.set?.[DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY] as Record<
      string,
      unknown
    >;

    expect(reading).toMatchObject({
      provider: "meraki",
      readAt: NOW.toISOString(),
      readBy: { type: "networkController", id: CONNECTION_ID, name: "Stores" },
    });
  });

  test("both ends are devices here: each gets the link, and knows the other by id", () => {
    const result: ControllerLinkPlan = plan({
      links: [CABLE],
      matches: new Map([
        [SWITCH_ID, matchOf(SWITCH)],
        [ROUTER_ID, matchOf(ROUTER)],
      ]),
      placedDevices: new Map([
        [SWITCH.serial, { id: SWITCH_ID }],
        [ROUTER.serial, { id: ROUTER_ID }],
      ]),
      candidates: [{ id: SWITCH_ID }, { id: ROUTER_ID }],
    });

    expect(result.linkedDeviceCount).toBe(2);
    expect(storedLinkOf(result.patches[0])).toMatchObject({
      peerDeviceId: ROUTER_ID,
      port: "Port 49",
    });
    expect(storedLinkOf(result.patches[1])).toMatchObject({
      peerDeviceId: SWITCH_ID,
      port: "Port 3",
      peerPort: "Port 49",
    });
  });

  test("a neighbour that is no Meraki device keeps what it advertised", () => {
    const result: ControllerLinkPlan = plan({
      links: [
        {
          ...CABLE,
          ends: [
            endOf(SWITCH.serial, "Port 49"),
            endOf("", "Gi0/1", {
              name: "core",
              mac: "aa:bb:cc:dd:ee:ff",
              ip: "10.0.0.1",
              platform: "C9300",
            }),
          ],
        },
      ],
    });

    expect(storedLinkOf(result.patches[0])).toEqual({
      port: "Port 49",
      peerName: "core",
      peerPort: "Gi0/1",
      peerMac: "aa:bb:cc:dd:ee:ff",
      peerIp: "10.0.0.1",
      peerPlatform: "C9300",
      protocols: ["lldp"],
    });
  });

  test("a link with neither end a device here writes nothing", () => {
    expect(
      plan({ links: [CABLE], placedDevices: new Map(), matches: new Map() })
        .patches,
    ).toEqual([]);
  });

  test("a device its network says has no links any more loses the ones it had", () => {
    const result: ControllerLinkPlan = plan({
      links: [],
      candidates: [
        { id: SWITCH_ID, discoveredDetails: readingBy(CONNECTION_ID) },
      ],
    });

    expect(result.patches).toEqual([
      { deviceId: SWITCH_ID, unset: [DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY] },
    ]);
    expect(result.linkedDeviceCount).toBe(0);
  });

  test("a device in a network whose links were not read keeps its own", () => {
    expect(
      plan({
        links: [],
        linkNetworkIds: ["L_OTHER"],
        candidates: [
          { id: SWITCH_ID, discoveredDetails: readingBy(CONNECTION_ID) },
        ],
      }).patches,
    ).toEqual([]);
  });

  test("another connection's reading is that connection's to change", () => {
    expect(
      plan({
        links: [],
        candidates: [
          { id: SWITCH_ID, discoveredDetails: readingBy(OTHER_CONNECTION_ID) },
        ],
      }).patches,
    ).toEqual([]);
  });

  test("a device this connection no longer describes loses them, after a whole list", () => {
    const candidates: Array<ControllerInventoryCandidate> = [
      { id: OTHER_ID, discoveredDetails: readingBy(CONNECTION_ID) },
    ];

    expect(plan({ candidates, matches: new Map() }).patches).toEqual([
      { deviceId: OTHER_ID, unset: [DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY] },
    ]);
  });

  test("a list cut short says nothing about the devices past the cut", () => {
    expect(
      plan({
        candidates: [
          { id: OTHER_ID, discoveredDetails: readingBy(CONNECTION_ID) },
        ],
        matches: new Map(),
        isDeviceListComplete: false,
      }).patches,
    ).toEqual([]);
  });

  test("a device with nothing stored and nothing read is left alone", () => {
    expect(plan({}).patches).toEqual([]);
  });

  test("a row that is not a device's is skipped: its id could not be written", () => {
    expect(
      plan({
        links: [CABLE],
        candidates: [
          { id: "not-a-uuid" },
          { id: SWITCH_ID },
          { id: SWITCH_ID },
        ],
      }).patches,
    ).toHaveLength(1);
  });
});

describe("recording one read", () => {
  const inputs: () => {
    projectId: ObjectID;
    connection: ControllerInventoryConnection;
    readAt: Date;
    clients: Array<NetworkControllerClient>;
    links: Array<NetworkControllerLink>;
    linkNetworkIds: Array<string>;
    devices: Array<NetworkControllerDevice>;
    isDeviceListComplete: boolean;
    matches: Map<string, ControllerInventoryMatch>;
    candidates: Array<ControllerInventoryCandidate>;
  } = () => {
    return {
      projectId: PROJECT_ID,
      connection: CONNECTION,
      readAt: NOW,
      clients: [],
      links: [],
      linkNetworkIds: [],
      devices: [SWITCH, ROUTER],
      isDeviceListComplete: true,
      matches: new Map([[SWITCH_ID, matchOf(SWITCH)]]),
      candidates: [{ id: SWITCH_ID, siteId: SITE_ID }],
    };
  };

  test("writes the clients, teaches the MACs, merges the links and says what it did", async () => {
    const upserts: Array<UpsertData> = [];
    const merges: Array<MergeData> = [];
    const learned: Array<LearnData> = [];

    const outcome: ControllerTopologyOutcome =
      await NetworkControllerTopology.record({
        ...inputs(),
        clients: [
          clientOf("aa:bb:cc:00:00:51", {
            ip: "10.18.166.51",
            name: "wb-0660-kds01",
            manufacturer: "Elo Touch",
            vlanId: 18,
          }),
        ],
        links: [CABLE],
        linkNetworkIds: ["L_660"],
        upsertClients: async (data: UpsertData): Promise<number> => {
          upserts.push(data);
          return 1;
        },
        merge: async (data: MergeData): Promise<number> => {
          merges.push(data);
          return 1;
        },
        learnClientMacs: async (data: LearnData): Promise<void> => {
          learned.push(data);
        },
      });

    expect(outcome).toEqual({
      placedClientCount: 1,
      unplacedDeviceCount: 0,
      linkedDeviceCount: 1,
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.source).toBe("meraki");

    const written: EndpointControllerClient = upserts[0]!.clients[0]!;

    expect(written).toMatchObject({
      macAddress: "aa:bb:cc:00:00:51",
      ipAddress: "10.18.166.51",
      hostname: "wb-0660-kds01",
      vendor: "Elo Touch",
      portName: "Port 7",
      vlanId: 18,
      seenAt: NOW,
    });
    expect(written.deviceId.toString()).toBe(SWITCH_ID);
    expect(written.deviceSiteId?.toString()).toBe(SITE_ID);

    expect(merges).toHaveLength(1);
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({
      siteId: SITE_ID,
      bindings: [{ macAddress: "aa:bb:cc:00:00:51", ipAddress: "10.18.166.51" }],
      reader: {
        type: "networkController",
        id: CONNECTION_ID,
        name: "Stores",
      },
    });
  });

  test("a read with nothing to say writes nothing and asks nothing", async () => {
    let calls: number = 0;

    expect(
      await NetworkControllerTopology.record({
        ...inputs(),
        upsertClients: async (): Promise<number> => {
          calls++;
          return 0;
        },
        merge: async (): Promise<number> => {
          calls++;
          return 0;
        },
        findClientCandidates: async (): Promise<
          Array<ControllerClientCandidate>
        > => {
          calls++;
          return [];
        },
      }),
    ).toEqual({
      placedClientCount: 0,
      unplacedDeviceCount: 0,
      linkedDeviceCount: 0,
    });
    expect(calls).toBe(0);
  });

  test("only a Wi-Fi client on a device here costs a lookup, and it asks about those alone", async () => {
    const lookups: Array<LookupData> = [];
    const upserts: Array<UpsertData> = [];

    const outcome: ControllerTopologyOutcome =
      await NetworkControllerTopology.record({
        ...inputs(),
        clients: [
          clientOf("aa:bb:cc:00:00:01"),
          clientOf("aa:bb:cc:00:00:02", { isWireless: true, ip: "10.0.0.2" }),
          clientOf("aa:bb:cc:00:00:03", { isWireless: true, ip: "10.0.0.3" }),
          clientOf("aa:bb:cc:00:00:04", {
            isWireless: true,
            ip: "10.0.0.4",
            deviceSerial: "Q2AP-UNKNOWN",
          }),
        ],
        findClientCandidates: async (
          data: LookupData,
        ): Promise<Array<ControllerClientCandidate>> => {
          lookups.push(data);
          return [{ macAddress: "aa:bb:cc:00:00:02" }];
        },
        upsertClients: async (data: UpsertData): Promise<number> => {
          upserts.push(data);
          return 0;
        },
        learnClientMacs: async (): Promise<void> => {},
      });

    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({
      macs: ["aa:bb:cc:00:00:02", "aa:bb:cc:00:00:03"],
      addresses: ["10.0.0.2", "10.0.0.3"],
    });
    expect(outcome.placedClientCount).toBe(2);
    expect(
      upserts[0]?.clients.map((client: EndpointControllerClient): string => {
        return client.macAddress;
      }),
    ).toEqual(["aa:bb:cc:00:00:01", "aa:bb:cc:00:00:02"]);
  });

  test("one site's MACs failing does not stop another's, and costs the read nothing", async () => {
    const seen: Array<string | undefined> = [];
    const learnClientMacs: LearnClientMacsFunction = async (data: {
      siteId: string | undefined;
    }): Promise<void> => {
      seen.push(data.siteId);
      if (data.siteId === SITE_ID) {
        throw new Error("the database went away");
      }
    };

    const outcome: ControllerTopologyOutcome =
      await NetworkControllerTopology.record({
        ...inputs(),
        devices: [SWITCH, ROUTER],
        matches: new Map([
          [SWITCH_ID, matchOf(SWITCH)],
          [ROUTER_ID, matchOf(ROUTER)],
        ]),
        candidates: [
          { id: SWITCH_ID, siteId: SITE_ID },
          { id: ROUTER_ID, siteId: OTHER_SITE_ID },
        ],
        clients: [
          clientOf("aa:bb:cc:00:00:01", { ip: "10.0.0.1" }),
          clientOf("aa:bb:cc:00:00:02", {
            ip: "10.0.0.2",
            deviceSerial: ROUTER.serial,
          }),
        ],
        upsertClients: async (): Promise<number> => {
          return 2;
        },
        learnClientMacs,
      });

    expect(seen).toEqual([SITE_ID, OTHER_SITE_ID]);
    expect(outcome.placedClientCount).toBe(2);
  });

  test("a failure writing the clients is the runner's to catch", async () => {
    await expect(
      NetworkControllerTopology.record({
        ...inputs(),
        clients: [clientOf("aa:bb:cc:00:00:01")],
        upsertClients: async (): Promise<number> => {
          throw new Error("the database went away");
        },
      }),
    ).rejects.toThrow("the database went away");
  });
});
