import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The device Overview's "Connected to" card, RENDERED.
 *
 * The lookup util has its own unit tests (App/Tests/Dashboard) for which
 * rows are the device and which of them is the cable. What only a render
 * can pin is what the card DOES with the answer: the switch is a link to
 * its own device page, the port and VLAN are the ones from the chosen row,
 * the evidence line says which key matched, and the empty state - two
 * different sentences, for "nothing found" and for "nothing to look up
 * by" - carries the Settings link the operator needs next.
 */

let deviceRow: NetworkDevice | null = null;
let endpointRows: Array<NetworkEndpoint> = [];
let listQueries: Array<Record<string, unknown>> = [];
// This device's interfaces, and the devices its neighbours' names find.
let interfaceRows: Array<unknown> = [];
let neighbourDeviceRows: Array<unknown> = [];
let isNameLookupFailing: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve(deviceRow);
      },
      getList: (request: {
        modelType: { name: string };
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        /*
         * The card also reads the DEVICE table, for the other devices that
         * could claim the same rows. None exist here; only the endpoint
         * queries are the ones these tests reason about.
         */
        if (request.modelType.name === "NetworkInterface") {
          return isNameLookupFailing
            ? Promise.reject(new Error("lookup failed"))
            : Promise.resolve({ data: interfaceRows, count: 0 });
        }
        if (
          request.modelType.name === "NetworkDevice" &&
          request.query["name"] !== undefined
        ) {
          return Promise.resolve({ data: neighbourDeviceRows, count: 0 });
        }
        if (request.modelType.name !== "NetworkEndpoint") {
          return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
        }
        listQueries.push(request.query);
        return Promise.resolve({
          data: endpointRows,
          count: endpointRows.length,
          skip: 0,
          limit: 50,
        });
      },
    },
  };
});

import DeviceAttachmentCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceAttachmentCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

/*
 * Below the imports on purpose: the jest.mock factory above is hoisted, which
 * leaves the imports evaluated after any module-level constant that precedes
 * them, and constructing an ObjectID up there runs before the class exists.
 */
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SWITCH_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SITE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const REGISTER_MAC: string = "aa:bb:cc:dd:ee:ff";

function device(data: {
  hostname: string;
  macAddress?: string | undefined;
}): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = DEVICE_ID;
  row.name = "Register 3";
  row.hostname = data.hostname;
  row.siteId = SITE_ID;

  if (data.macAddress !== undefined) {
    row.macAddress = data.macAddress;
  }

  return row;
}

/** The register as the store switch's forwarding table reported it. */
function learnedEndpoint(data: {
  macAddress: string;
  ipAddress?: string | undefined;
  portName?: string | undefined;
  vlanId?: number | undefined;
}): NetworkEndpoint {
  const endpoint: NetworkEndpoint = new NetworkEndpoint();
  endpoint._id = "55555555-5555-4555-8555-555555555555";
  endpoint.macAddress = data.macAddress;
  endpoint.siteId = SITE_ID;
  endpoint.attachedNetworkDeviceId = SWITCH_ID;
  endpoint.attachedInterfaceIndex = 7;
  endpoint.lastSeenAt = new Date();

  const attached: NetworkDevice = new NetworkDevice();
  attached._id = SWITCH_ID.toString();
  attached.name = "Store switch";
  endpoint.attachedNetworkDevice = attached;

  if (data.ipAddress !== undefined) {
    endpoint.ipAddress = data.ipAddress;
  }

  if (data.portName !== undefined) {
    endpoint.attachedPortName = data.portName;
  }

  if (data.vlanId !== undefined) {
    endpoint.vlanId = data.vlanId;
  }

  return endpoint;
}

async function renderCard(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <DeviceAttachmentCard modelId={DEVICE_ID} />
    </MemoryRouter>,
  );

  const content: HTMLElement = screen.getByTestId("device-attachment-card");

  await waitFor(() => {
    expect(
      content.querySelector('[data-testid="component-loader"]'),
    ).toBeNull();
    expect(
      content.querySelector('[data-testid="device-attachment-empty"]') ||
        content.querySelector('[data-testid="device-attachment-port"]') ||
        content.querySelector('[data-testid="device-neighbours"]'),
    ).not.toBeNull();
  });

  return content;
}

const SWITCH_HREF: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
  { modelId: SWITCH_ID },
).toString();

const SETTINGS_HREF: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
  { modelId: DEVICE_ID },
).toString();

describe("the device Overview Connected to card", () => {
  beforeEach(() => {
    deviceRow = null;
    endpointRows = [];
    listQueries = [];
    interfaceRows = [];
    neighbourDeviceRows = [];
    isNameLookupFailing = false;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("names the switch as a link, with the port and VLAN the switch learned", async () => {
    deviceRow = device({ hostname: "10.0.12.41", macAddress: REGISTER_MAC });
    endpointRows = [
      learnedEndpoint({
        macAddress: REGISTER_MAC,
        ipAddress: "10.0.12.41",
        portName: "Gi1/0/7",
        vlanId: 20,
      }),
    ];

    const content: HTMLElement = await renderCard();

    const link: HTMLElement = screen.getByTestId(
      "device-attachment-switch-link",
    );
    expect(link).toHaveTextContent("Store switch");
    expect(link.querySelector("a")?.getAttribute("href")).toBe(SWITCH_HREF);

    expect(screen.getByTestId("device-attachment-port")).toHaveTextContent(
      "Gi1/0/7",
    );
    expect(screen.getByTestId("device-attachment-vlan")).toHaveTextContent(
      "20",
    );
    expect(content).toHaveTextContent(REGISTER_MAC);
    expect(content).toHaveTextContent("Matched by MAC address");
    expect(content).toHaveTextContent("Last seen");

    expect(
      content.querySelector('[data-testid="device-attachment-empty"]'),
    ).toBeNull();
  });

  test("a device known only by its IP address is matched by address, and shows the MAC the switch learned", async () => {
    deviceRow = device({ hostname: "10.0.12.41" });
    endpointRows = [
      learnedEndpoint({
        macAddress: REGISTER_MAC,
        ipAddress: "10.0.12.41",
        vlanId: 20,
      }),
    ];

    const content: HTMLElement = await renderCard();

    // Scoped to the device's site on the server: an address is a key inside a site.
    expect(listQueries).toHaveLength(1);
    expect(listQueries[0]?.["ipAddress"]).toBe("10.0.12.41");
    expect(listQueries[0]?.["siteId"]?.toString()).toBe(SITE_ID.toString());
    expect(content).toHaveTextContent("Matched by IP address");
    expect(content).toHaveTextContent(REGISTER_MAC);
    // No port name on the row: the interface index stands in.
    expect(screen.getByTestId("device-attachment-port")).toHaveTextContent(
      "ifIndex 7",
    );
  });

  test("no matching row is the empty state, pointing at Settings", async () => {
    deviceRow = device({ hostname: "10.0.12.41", macAddress: REGISTER_MAC });
    endpointRows = [];

    const content: HTMLElement = await renderCard();

    const empty: HTMLElement = screen.getByTestId("device-attachment-empty");
    expect(empty).toHaveTextContent("Collect Connected Endpoints");
    expect(empty).toHaveTextContent("No switch at this site has reported");
    expect(empty.querySelector("a")?.getAttribute("href")).toBe(SETTINGS_HREF);

    expect(
      content.querySelector('[data-testid="device-attachment-switch-link"]'),
    ).toBeNull();
  });

  test("a device with neither a MAC nor an IP hostname is told what to add", async () => {
    deviceRow = device({ hostname: "register-03.store.example" });

    const content: HTMLElement = await renderCard();

    // Nothing to look up by, so nothing was looked up.
    expect(listQueries).toEqual([]);

    const empty: HTMLElement = screen.getByTestId("device-attachment-empty");
    expect(empty).toHaveTextContent("nothing to look this device up by");
    expect(empty).toHaveTextContent("Give it a MAC address");
    expect(empty.querySelector("a")?.getAttribute("href")).toBe(SETTINGS_HREF);

    expect(
      content.querySelector('[data-testid="device-attachment-switch-link"]'),
    ).toBeNull();
  });
});

/*
 * A switch, router or firewall reports what it is cabled to over LLDP and
 * CDP. The card used to look for it on another switch's port only, and told
 * a core switch with five neighbours on the map that no switch had reported
 * it yet.
 */
describe("the Connected to card of a device that reports its neighbours", () => {
  const CORE_ID: string = "66666666-6666-4666-8666-666666666666";

  function interfaceRow(index: number, name: string): NetworkInterface {
    const row: NetworkInterface = new NetworkInterface();
    row.interfaceIndex = index;
    row.name = name;
    return row;
  }

  function switchWithNeighbours(
    lldp: Array<Record<string, unknown>>,
    cdp: Array<Record<string, unknown>> = [],
  ): NetworkDevice {
    const row: NetworkDevice = device({ hostname: "10.0.0.2" });
    row.name = "Access switch";
    row.lldpNeighbors = lldp as never;
    row.cdpNeighbors = cdp as never;
    return row;
  }

  function rows(): Array<HTMLElement> {
    return screen.getAllByTestId("device-neighbour");
  }

  beforeEach(() => {
    deviceRow = null;
    endpointRows = [];
    listQueries = [];
    interfaceRows = [];
    neighbourDeviceRows = [];
    isNameLookupFailing = false;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("lists each cable: this device's port, the neighbour, and the port at its end", async () => {
    deviceRow = switchWithNeighbours(
      [
        {
          localInterfaceIndex: 49,
          remoteSysName: "core-sw1",
          remoteChassisId: "00:11:22:33:44:55",
          remotePortId: "Gi1/0/1",
        },
      ],
      [
        {
          localInterfaceIndex: 50,
          remoteDeviceId: "edge-rtr1",
          remotePortId: "port3",
        },
      ],
    );
    interfaceRows = [interfaceRow(49, "Te1/1/1"), interfaceRow(50, "Te1/1/2")];
    const core: NetworkDevice = new NetworkDevice();
    core._id = CORE_ID;
    core.name = "core-sw1";
    neighbourDeviceRows = [core];

    await renderCard();

    await waitFor(() => {
      expect(rows()[0]).toHaveTextContent("Te1/1/1");
    });

    const [first, second] = rows();

    expect(first).toHaveTextContent("core-sw1");
    expect(first).toHaveTextContent("port Gi1/0/1");
    expect(first!.querySelector("a")?.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
        { modelId: new ObjectID(CORE_ID) },
      ).toString(),
    );

    // Not a device here: its name, unlinked; a port id that says "port" once.
    expect(second).toHaveTextContent("Te1/1/2");
    expect(second).toHaveTextContent("edge-rtr1");
    expect(second).toHaveTextContent("port3");
    expect(second).not.toHaveTextContent("port port3");
    expect(second!.querySelector("a")).toBeNull();

    const footer: HTMLElement = screen.getByTestId("device-neighbours");
    expect(footer).toHaveTextContent("Reported over LLDP or CDP.");
    expect(screen.queryByTestId("device-attachment-empty")).toBeNull();
  });

  test("lists eight, counts the rest, and puts the map one click away", async () => {
    deviceRow = switchWithNeighbours(
      Array.from({ length: 10 }, (_unused: unknown, index: number) => {
        return {
          localInterfaceIndex: index + 1,
          remoteSysName: `ap-${String(index + 1).padStart(2, "0")}`,
          remotePortId: "eth0",
        };
      }),
    );

    await renderCard();

    expect(rows()).toHaveLength(8);

    const list: HTMLElement = screen.getByTestId("device-neighbours");
    expect(list).toHaveTextContent(
      "Reported over LLDP or CDP, and 2 more on the map.",
    );

    const mapLink: HTMLElement = screen.getByRole("link", {
      name: "Open the map",
    });
    expect(mapLink.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_TOPOLOGY] as Route,
      ).toString(),
    );
  });

  test("a failed name lookup still lists the cables, by port number", async () => {
    isNameLookupFailing = true;
    deviceRow = switchWithNeighbours([
      {
        localInterfaceIndex: 49,
        remoteSysName: "core-sw1",
        remotePortId: "Gi1/0/1",
      },
    ]);

    await renderCard();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("ifIndex 49");
    expect(rows()[0]).toHaveTextContent("core-sw1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a device also seen on another switch's port shows that port", async () => {
    deviceRow = switchWithNeighbours([
      {
        localInterfaceIndex: 49,
        remoteSysName: "core-sw1",
        remotePortId: "Gi1/0/1",
      },
    ]);
    deviceRow.macAddress = REGISTER_MAC;
    endpointRows = [
      learnedEndpoint({ macAddress: REGISTER_MAC, portName: "Gi1/0/7" }),
    ];

    await renderCard();

    expect(screen.getByTestId("device-attachment-port")).toHaveTextContent(
      "Gi1/0/7",
    );
    expect(screen.queryByTestId("device-neighbours")).toBeNull();
  });

  test("the card says what it shows: the neighbours, or the switch port", async () => {
    deviceRow = device({ hostname: "10.0.12.41", macAddress: REGISTER_MAC });

    await renderCard();

    expect(
      screen.getByText(
        "What this device is cabled to: the neighbours it reports, or the switch port a switch at its site sees it on.",
      ),
    ).toBeInTheDocument();
  });
});
