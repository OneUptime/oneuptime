import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  AmbiguousAddressReason,
  SeenDeviceReason,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import DiscoveredHostTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveredHostTable";
import {
  SHARED_ADDRESS_COPY,
  getSharedAddressDeviceIds,
  getSharedAddressLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveredHostSharedAddress";
import { DEFAULT_DISCOVERY_REVIEW_QUERY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportReview";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHY A HOST AT A SHARED ADDRESS READS ALREADY ADDED, IN REVIEW RESULTS
 * (OneUptime issue #9905).
 *
 * Two branches each have a 10.0.0.5. A scan's host there reads Already added
 * when the scan's probe sees one of the two devices - and also when it
 * cannot tell which it found, with no device to open and no box to tick. The
 * row now says which device it is and why, or why the probe cannot tell,
 * with the way forward and the devices to open. Rendered as the dialog
 * draws it, with the hosts as the server's read hands them
 * (DiscoveredNetworkDevice.sharedAddress) and the devices' names read as the
 * reader may read them.
 */

const SCAN_ID: ObjectID = new ObjectID("5a2b3c4d-6e7f-4a8b-9c0d-1e2f3a4b5c6d");
const BRANCH_A_ROUTER: string = "d0000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "d0000000-0000-4000-8000-00000000000b";
const PRINTER: string = "d0000000-0000-4000-8000-0000000000a9";

// Site A's probe polls site A's router: it is that one.
const POLLED_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.5",
  sysName: "rtr-01",
  snmpReachable: false,
  isAlreadyRegistered: true,
  registeredDeviceId: BRANCH_A_ROUTER,
  sharedAddress: {
    deviceCount: 2,
    seenReason: SeenDeviceReason.PolledByTheProbes,
  },
};

// A new probe, site A's default: the only router at 10.0.0.5 in its site.
const IN_SITES_HOST: DiscoveredNetworkDevice = {
  ...POLLED_HOST,
  sharedAddress: {
    deviceCount: 2,
    seenReason: SeenDeviceReason.OnlyOneInTheirSites,
  },
};

// A probe that polls both routers: it cannot tell which it found.
const AMBIGUOUS_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.5",
  sysName: "rtr-01",
  snmpReachable: false,
  isAlreadyRegistered: true,
  sharedAddress: {
    deviceCount: 2,
    ambiguousReason: AmbiguousAddressReason.PollSeveral,
    ambiguousDeviceIds: [BRANCH_A_ROUTER, BRANCH_B_ROUTER],
  },
};

// A printer alone at its address, and a host that is no device.
const ONE_DEVICE_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.9",
  sysName: "prn-01",
  snmpReachable: false,
  isAlreadyRegistered: true,
  registeredDeviceId: PRINTER,
};
const NEW_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.77",
  sysName: "till-01",
  snmpReachable: false,
  isAlreadyRegistered: false,
};

function device(id: string, name: string, hostname: string): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item._id = id;
  item.id = new ObjectID(id);
  item.name = name;
  item.hostname = hostname;
  return item;
}

// The devices the reader may read.
let readable: Array<NetworkDevice>;
let getListSpy: jest.SpyInstance;

function scan(): NetworkDeviceDiscoveryScan {
  const item: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  item.id = SCAN_ID;
  item.name = "Branch A";
  return item;
}

async function renderHosts(
  hosts: Array<DiscoveredNetworkDevice>,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveredHostTable
          hosts={hosts}
          scan={scan()}
          isGlobalProbe={false}
          isIcmpOnly={true}
          query={DEFAULT_DISCOVERY_REVIEW_QUERY}
          onQueryChange={() => {}}
          selectedIpAddresses={{}}
          onSelectionChange={() => {}}
        />
      </MemoryRouter>,
    );
  });

  // The reads of the page's devices: their monitors and their names.
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function lineOf(address: string): HTMLElement {
  return within(
    screen.getByTestId(`discovered-host-row-${address}`),
  ).getByTestId(`discovered-host-shared-address-${address}`);
}

// The device reads the page made for names: by id, the name alone.
function nameReads(): Array<Array<string>> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        modelType: unknown;
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      };
    })
    .filter(
      (request: {
        modelType: unknown;
        select: Record<string, unknown>;
      }): boolean => {
        return (
          request.modelType === NetworkDevice &&
          Object.keys(request.select).sort().join(",") === "_id,name"
        );
      },
    )
    .map((request: { query: Record<string, unknown> }): Array<string> => {
      return ((request.query["_id"] as Includes).values as Array<string>)
        .map((value: string): string => {
          return value.toString();
        })
        .sort();
    });
}

beforeEach(() => {
  readable = [
    device(BRANCH_A_ROUTER, "Branch A router", "10.0.0.5"),
    device(BRANCH_B_ROUTER, "Branch B router", "10.0.0.5"),
    device(PRINTER, "Branch A printer", "10.0.0.9"),
  ];

  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (request: {
      modelType: unknown;
      query: Record<string, unknown>;
    }) => {
      if (request.modelType === Monitor) {
        return { data: [], count: 0, skip: 0, limit: 0 };
      }

      const wanted: Array<string> = (
        ((request.query["_id"] as Includes)?.values as Array<string>) || []
      ).map((value: string): string => {
        return value.toString().toLowerCase();
      });
      const data: Array<NetworkDevice> = readable.filter(
        (item: NetworkDevice): boolean => {
          return wanted.includes(item.id!.toString().toLowerCase());
        },
      );

      return { data: data, count: data.length, skip: 0, limit: data.length };
    }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a host at an address two devices share, in Review Results", () => {
  test("says which device it is, linked, when the scan's probe polls it", async () => {
    await renderHosts([POLLED_HOST]);

    const line: HTMLElement = lineOf(POLLED_HOST.ipAddress);
    expect(line).toHaveTextContent(
      "More than one device has this address. This host is Branch A router, the one the scan's probe polls.",
    );

    const link: HTMLElement = within(line).getByTestId(
      `discovered-host-shared-address-device-${POLLED_HOST.ipAddress}`,
    );
    expect(link).toHaveTextContent("Branch A router");
    expect(link.getAttribute("href")).toContain(BRANCH_A_ROUTER);
    // Still Already added: the line says why, it changes nothing.
    expect(
      within(screen.getByTestId(`discovered-host-row-10.0.0.5`)).getByText(
        "Already added",
      ),
    ).toBeInTheDocument();
  });

  test("says it is the only one in the probe's sites, when that is how it was told", async () => {
    await renderHosts([IN_SITES_HOST]);

    expect(lineOf(IN_SITES_HOST.ipAddress)).toHaveTextContent(
      "More than one device has this address. This host is Branch A router, the only one in the probe's sites.",
    );
  });

  test("still says why, unnamed, when the reader cannot read the device", async () => {
    readable = [];

    await renderHosts([
      POLLED_HOST,
      { ...IN_SITES_HOST, ipAddress: "10.0.0.6" },
    ]);

    expect(lineOf(POLLED_HOST.ipAddress)).toHaveTextContent(
      "More than one device has this address. This host is the one the scan's probe polls.",
    );
    expect(lineOf("10.0.0.6")).toHaveTextContent(
      "More than one device has this address. This host is the only one of them in the probe's sites.",
    );
    expect(
      screen.queryByTestId(
        `discovered-host-shared-address-device-${POLLED_HOST.ipAddress}`,
      ),
    ).not.toBeInTheDocument();
  });
});

describe("a host whose devices the scan's probe cannot tell apart, in Review Results", () => {
  test("says why, says what to do, and links to each device", async () => {
    await renderHosts([AMBIGUOUS_HOST]);

    const line: HTMLElement = lineOf(AMBIGUOUS_HOST.ipAddress);
    expect(line).toHaveTextContent(
      "More than one device has this address, and the scan's probe polls more than one of them, so it cannot tell which it found. Give the right device its monitor from its own page.",
    );

    const devices: HTMLElement = within(line).getByTestId(
      `discovered-host-shared-address-devices-${AMBIGUOUS_HOST.ipAddress}`,
    );
    const links: Array<HTMLElement> = within(devices).getAllByRole("link");
    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent || "";
      }),
    ).toEqual(["Branch A router", "Branch B router"]);
    expect(links[0]!.getAttribute("href")).toContain(BRANCH_A_ROUTER);
    expect(links[1]!.getAttribute("href")).toContain(BRANCH_B_ROUTER);

    // It is a device all the same: never offered as new.
    expect(
      screen.getByTestId(
        `discovered-device-checkbox-${AMBIGUOUS_HOST.ipAddress}`,
      ),
    ).toBeDisabled();
  });

  test.each([
    [
      AmbiguousAddressReason.SeveralInTheirSites,
      "More than one device has this address in the sites the scan's probe looks into, so it cannot tell which it found.",
    ],
    [
      AmbiguousAddressReason.ReachUnknown,
      "More than one device has this address, and the scan's probe polls none and is no site's default probe, so it cannot tell which it found.",
    ],
  ])(
    "says why when the reason is %s",
    async (reason: AmbiguousAddressReason, sentence: string) => {
      await renderHosts([
        {
          ...AMBIGUOUS_HOST,
          sharedAddress: {
            ...AMBIGUOUS_HOST.sharedAddress!,
            ambiguousReason: reason,
          },
        },
      ]);

      expect(lineOf(AMBIGUOUS_HOST.ipAddress)).toHaveTextContent(sentence);
    },
  );

  test("links only to the devices the reader may read", async () => {
    readable = readable.filter((item: NetworkDevice): boolean => {
      return item.id!.toString() !== BRANCH_B_ROUTER;
    });

    await renderHosts([AMBIGUOUS_HOST]);

    const devices: HTMLElement = within(
      lineOf(AMBIGUOUS_HOST.ipAddress),
    ).getByTestId(
      `discovered-host-shared-address-devices-${AMBIGUOUS_HOST.ipAddress}`,
    );
    expect(
      within(devices)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return link.textContent || "";
        }),
    ).toEqual(["Branch A router"]);
  });

  test("says why without links when no device could be read", async () => {
    readable = [];

    await renderHosts([AMBIGUOUS_HOST]);

    expect(lineOf(AMBIGUOUS_HOST.ipAddress)).toHaveTextContent(
      "Give the right device its monitor from its own page.",
    );
    expect(
      screen.queryByTestId(
        `discovered-host-shared-address-devices-${AMBIGUOUS_HOST.ipAddress}`,
      ),
    ).not.toBeInTheDocument();
  });
});

describe("hosts that need no word on a shared address", () => {
  test("a host at an address one device has, and a new host, say nothing more", async () => {
    await renderHosts([ONE_DEVICE_HOST, NEW_HOST]);

    for (const host of [ONE_DEVICE_HOST, NEW_HOST]) {
      expect(
        screen.queryByTestId(
          `discovered-host-shared-address-${host.ipAddress}`,
        ),
      ).not.toBeInTheDocument();
    }

    // Nor are any names read for them.
    expect(nameReads()).toEqual([]);
  });

  test("names are read once, for the page's hosts at shared addresses alone", async () => {
    await renderHosts([
      POLLED_HOST,
      { ...AMBIGUOUS_HOST, ipAddress: "10.0.0.6" },
      ONE_DEVICE_HOST,
      NEW_HOST,
    ]);

    expect(nameReads()).toEqual([[BRANCH_A_ROUTER, BRANCH_B_ROUTER].sort()]);
  });
});

describe("getSharedAddressLine", () => {
  const NAMES: ReadonlyMap<string, string> = new Map<string, string>([
    [BRANCH_A_ROUTER, "Branch A router"],
  ]);

  test("picks the sentence by how the device was told, named when it can be", () => {
    expect(
      getSharedAddressLine({ host: POLLED_HOST, deviceNames: NAMES }),
    ).toEqual({
      kind: "seen",
      template: SHARED_ADDRESS_COPY.polledBy,
      deviceId: BRANCH_A_ROUTER,
    });
    expect(
      getSharedAddressLine({ host: POLLED_HOST, deviceNames: new Map() }),
    ).toEqual({ kind: "seen", template: SHARED_ADDRESS_COPY.polledByUnnamed });
    expect(
      getSharedAddressLine({ host: IN_SITES_HOST, deviceNames: NAMES }),
    ).toEqual({
      kind: "seen",
      template: SHARED_ADDRESS_COPY.onlyInSites,
      deviceId: BRANCH_A_ROUTER,
    });
  });

  test("names the devices that cannot be told apart, each once, in the read's order", () => {
    expect(
      getSharedAddressLine({
        host: {
          ...AMBIGUOUS_HOST,
          sharedAddress: {
            ...AMBIGUOUS_HOST.sharedAddress!,
            ambiguousDeviceIds: [
              BRANCH_B_ROUTER.toUpperCase(),
              BRANCH_A_ROUTER,
              BRANCH_B_ROUTER,
            ],
          },
        },
        deviceNames: NAMES,
      }),
    ).toEqual({
      kind: "ambiguous",
      template: SHARED_ADDRESS_COPY.pollsSeveral,
      deviceIds: [BRANCH_B_ROUTER, BRANCH_A_ROUTER],
    });
  });

  test("says nothing of a host that is no device, or whose address is one device's", () => {
    for (const host of [
      ONE_DEVICE_HOST,
      NEW_HOST,
      { ...POLLED_HOST, isAlreadyRegistered: false },
      { ...POLLED_HOST, registeredDeviceId: undefined },
      {
        ...POLLED_HOST,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.OnlyOneAtTheAddress,
        },
      },
      null,
      undefined,
    ]) {
      expect(
        getSharedAddressLine({ host: host, deviceNames: NAMES }),
      ).toBeNull();
    }
  });
});

describe("getSharedAddressDeviceIds", () => {
  test("lists the devices the lines name, each once, and nothing else", () => {
    expect(
      getSharedAddressDeviceIds([
        POLLED_HOST,
        AMBIGUOUS_HOST,
        ONE_DEVICE_HOST,
        NEW_HOST,
        {
          ...AMBIGUOUS_HOST,
          sharedAddress: {
            ...AMBIGUOUS_HOST.sharedAddress!,
            ambiguousDeviceIds: ["not-an-id", ""],
          },
        },
      ]),
    ).toEqual([BRANCH_A_ROUTER, BRANCH_B_ROUTER].sort());
  });
});
