import { describe, expect, test } from "@jest/globals";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  CONTROLLER_LINKS_CURRENT_FOR_MS,
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY,
  MAX_CONTROLLER_LINKS_PER_DEVICE,
  MAX_CONTROLLER_LINK_TEXT_LENGTH,
  NetworkDeviceControllerLink,
  NetworkDeviceControllerLinks,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  buildControllerLinks,
  buildDiscoveredValue,
  getCurrentControllerLinks,
  isDiscoveredDetailsKey,
  readNetworkDeviceDiscoveredDetails,
  sanitizeDiscoveredDetailsOnWrite,
  toDiscoveredDetailsJson,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What a device's network controller says it is cabled to: one reading of
 * Meraki's link layer topology, under the `controllerLinks` key of the
 * device's discovered details (OneUptime issue #5379) - and the MAC its
 * client list gives a device, which must never read as an ARP table's.
 *
 * Everything in a link is what a device advertised, and the column is jsonb
 * an API create can carry: these pin what may be stored, that the reader
 * keeps exactly what the writer writes, and that no input makes either throw.
 */

const CONNECTION: NetworkDeviceDiscoveryReader = {
  type: NetworkDeviceDiscoveryReaderType.NetworkController,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
};

const READ_AT: string = "2026-10-28T10:00:00.000Z";

const LINK: NetworkDeviceControllerLink = {
  port: "Port 49",
  peerDeviceId: "40000000-0000-4000-8000-000000000002",
  peerName: "UN0660WANRTR01",
  peerPort: "Port 3",
  peerMac: "88:15:44:c8:5d:58",
  peerIp: "10.242.166.1",
  peerPlatform: "MX85",
  protocols: ["lldp"],
};

function reading(
  links: unknown = [LINK],
): NetworkDeviceControllerLinks | undefined {
  return buildControllerLinks({
    provider: NetworkControllerProvider.Meraki,
    readBy: CONNECTION,
    readAt: READ_AT,
    links,
  });
}

describe("a reading of a device's links", () => {
  test("is kept as it was written", () => {
    expect(reading()).toEqual({
      provider: "meraki",
      readBy: CONNECTION,
      readAt: READ_AT,
      links: [LINK],
    });
  });

  test("a link needs nobody but a peer: every other field is optional", () => {
    expect(reading([{ peerName: "core", protocols: [] }])?.links).toEqual([
      { peerName: "core", protocols: [] },
    ]);
    expect(reading([{ peerDeviceId: "d", protocols: ["cdp"] }])?.links).toEqual(
      [{ peerDeviceId: "d", protocols: ["cdp"] }],
    );
    expect(
      reading([{ peerMac: "AA-BB-CC-DD-EE-FF", protocols: [] }])?.links,
    ).toEqual([{ peerMac: "aa:bb:cc:dd:ee:ff", protocols: [] }]);
    expect(reading([{ peerIp: "10.0.0.1", protocols: [] }])?.links).toEqual([
      { peerIp: "10.0.0.1", protocols: [] },
    ]);
  });

  test("a link that names nobody at the far end says nothing", () => {
    expect(reading([{ port: "Port 1", protocols: ["lldp"] }])).toBeUndefined();
    expect(
      reading([{ peerIp: "not an address", protocols: [] }]),
    ).toBeUndefined();
    expect(reading([{ peerMac: "not a mac", protocols: [] }])).toBeUndefined();
  });

  test("a value that is not what it says is dropped, and the link stays", () => {
    expect(
      reading([{ ...LINK, peerIp: "nope", peerMac: "nope" }])?.links[0],
    ).toEqual({
      port: "Port 49",
      peerDeviceId: LINK.peerDeviceId,
      peerName: "UN0660WANRTR01",
      peerPort: "Port 3",
      peerPlatform: "MX85",
      protocols: ["lldp"],
    });
  });

  test("outside text is cleaned and cut", () => {
    const link: NetworkDeviceControllerLink | undefined = reading([
      {
        peerName: `core\u0000\n${"x".repeat(1000)}`,
        protocols: [],
      },
    ])?.links[0];

    expect(link?.peerName?.startsWith("core x")).toBe(true);
    expect(link?.peerName?.length).toBeLessThanOrEqual(
      MAX_CONTROLLER_LINK_TEXT_LENGTH,
    );
  });

  test("a protocol it does not know, or a repeat, is dropped", () => {
    expect(
      reading([{ ...LINK, protocols: ["lldp", "lldp", "fdb", 7, null, "cdp"] }])
        ?.links[0]?.protocols,
    ).toEqual(["lldp", "cdp"]);
    expect(
      reading([{ ...LINK, protocols: "lldp" }])?.links[0]?.protocols,
    ).toEqual([]);
  });

  test("a port with a hub of LLDP speakers behind it cannot grow one past the bound", () => {
    expect(
      reading(
        Array.from({ length: MAX_CONTROLLER_LINKS_PER_DEVICE + 50 }, () => {
          return LINK;
        }),
      )?.links,
    ).toHaveLength(MAX_CONTROLLER_LINKS_PER_DEVICE);
  });

  test.each([
    ["a controller OneUptime does not read", { provider: "aruba" }],
    [
      "a reader that is no connection",
      { readBy: { ...CONNECTION, type: "probe" } },
    ],
    ["a time that does not parse", { readAt: "yesterday" }],
    ["links that are no list", { links: "many" }],
    ["no links", { links: [] }],
  ])("%s is not one", (_label: string, change: Record<string, unknown>) => {
    expect(
      buildControllerLinks({
        provider: NetworkControllerProvider.Meraki,
        readBy: CONNECTION,
        readAt: READ_AT,
        links: [LINK],
        ...change,
      }),
    ).toBeUndefined();
  });
});

describe("in the jsonb column", () => {
  test("it is a key of its own, which a writer may set or drop", () => {
    expect(
      isDiscoveredDetailsKey(DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY),
    ).toBe(true);
    expect(DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY).not.toBe(
      DISCOVERED_DETAILS_CONTROLLER_KEY,
    );
  });

  test("the reader keeps exactly what the writer writes", () => {
    const details: NetworkDeviceDiscoveredDetails = {
      values: {},
      controllerLinks: reading(),
    };

    expect(
      readNetworkDeviceDiscoveredDetails(toDiscoveredDetailsJson(details)),
    ).toEqual(details);
  });

  test("it rides beside the other writers' keys without touching them", () => {
    const arp: NetworkDeviceDiscoveredValue = buildDiscoveredValue({
      field: NetworkDeviceDiscoveredField.MacAddress,
      value: "aa:bb:cc:dd:ee:ff",
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
        id: "router",
      },
      readAt: READ_AT,
    })!;

    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails({
        macAddress: arp,
        controllerLinks: reading(),
      });

    expect(details.values[NetworkDeviceDiscoveredField.MacAddress]).toEqual(
      arp,
    );
    expect(details.controllerLinks?.links).toEqual([LINK]);
  });

  test("an API create can carry only what OneUptime would have written", () => {
    expect(
      sanitizeDiscoveredDetailsOnWrite({
        controllerLinks: {
          provider: "meraki",
          readBy: CONNECTION,
          readAt: READ_AT,
          links: [{ port: "Port 1", protocols: [] }],
        },
      }),
    ).toBeNull();
  });

  test("no input makes the reader throw, and what it returns reads back the same", () => {
    const random: SeededRandom = seededRandom(5379);
    const pieces: Array<unknown> = [
      undefined,
      null,
      0,
      -1,
      "",
      " ",
      "meraki",
      "lldp",
      "cdp",
      READ_AT,
      "e0:55:3d:12:34:56",
      "10.0.0.1",
      [],
      {},
      [LINK],
      LINK,
      { peerName: "x", protocols: ["lldp"] },
      CONNECTION,
    ];

    const pick: () => unknown = (): unknown => {
      return pieces[random(pieces.length)];
    };

    for (let index: number = 0; index < 2000; index++) {
      const details: NetworkDeviceDiscoveredDetails =
        readNetworkDeviceDiscoveredDetails({
          controllerLinks: {
            provider: pick(),
            readBy: pick(),
            readAt: pick(),
            links: pick(),
          },
        });

      expect(
        readNetworkDeviceDiscoveredDetails(toDiscoveredDetailsJson(details)),
      ).toEqual(details);
    }
  });
});

describe("whether a reading can still be vouched for", () => {
  const READ: Date = new Date(READ_AT);

  test("nothing read means nothing to draw", () => {
    expect(getCurrentControllerLinks(undefined, READ)).toEqual([]);
  });

  test("drawn through a few failed reads", () => {
    expect(
      getCurrentControllerLinks(
        reading(),
        new Date(READ.getTime() + CONTROLLER_LINKS_CURRENT_FOR_MS),
      ),
    ).toEqual([LINK]);
  });

  test("not after that: a cable the map cannot vouch for is a guess", () => {
    expect(
      getCurrentControllerLinks(
        reading(),
        new Date(READ.getTime() + CONTROLLER_LINKS_CURRENT_FOR_MS + 1),
      ),
    ).toEqual([]);
  });
});

describe("a MAC from a controller's client list", () => {
  const entry: () => NetworkDeviceDiscoveredValue | undefined = () => {
    return buildDiscoveredValue({
      field: NetworkDeviceDiscoveredField.MacAddress,
      value: "AA:BB:CC:00:00:51",
      readBy: CONNECTION,
      readAt: READ_AT,
    });
  };

  test("says it came from one, and which connection read it", () => {
    expect(entry()).toEqual({
      value: "aa:bb:cc:00:00:51",
      method: NetworkDeviceDiscoveryMethod.ControllerClientList,
      readBy: CONNECTION,
      readAt: READ_AT,
    });
  });

  test("is read back as it was written", () => {
    expect(
      readNetworkDeviceDiscoveredDetails({ macAddress: entry() }).values[
        NetworkDeviceDiscoveredField.MacAddress
      ],
    ).toEqual(entry());
  });

  test("a router's reading is still an ARP table's", () => {
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.MacAddress,
        value: "aa:bb:cc:00:00:51",
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
          id: "router",
        },
        readAt: READ_AT,
      })?.method,
    ).toBe(NetworkDeviceDiscoveryMethod.ArpTable);
  });

  test("a method that does not go with its reader was not written by OneUptime", () => {
    expect(
      readNetworkDeviceDiscoveredDetails({
        macAddress: { ...entry(), method: "arpTable" },
      }).values[NetworkDeviceDiscoveredField.MacAddress],
    ).toBeUndefined();
    expect(
      readNetworkDeviceDiscoveredDetails({
        macAddress: {
          ...entry(),
          readBy: {
            type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
            id: "router",
          },
        },
      }).values[NetworkDeviceDiscoveredField.MacAddress],
    ).toBeUndefined();
  });

  test("a controller reads no other field that way", () => {
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: "switch-1",
        readBy: CONNECTION,
        readAt: READ_AT,
      }),
    ).toBeUndefined();
  });
});
