import { CMDB_SYNC, INVENTORY_OVERVIEW } from "./InventoryAndApiDocsPages";
import {
  bold,
  boldIn,
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
} from "./InventoryAndApiDocsSupport";
import { CONTROLLER_READ_TEMPLATE } from "../../../FeatureSet/Dashboard/src/Components/Inventory/AssetFactSourceText";
import {
  PROBE_COULD_NOT_REACH,
  READ_AGAIN,
  REFRESH_TITLE,
  WAITING_FOR_BOTH,
  WAITING_FOR_CONTROLLER,
  WAITING_FOR_PROBE,
  getRefreshStatusWords,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/NetworkDeviceRefreshWords";
import { DESCRIBED_DEVICES_NOTE } from "../../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  ControllerInventoryCandidate,
  ControllerInventoryMatch,
  ControllerMatchRule,
  matchControllerDevices,
} from "Common/Server/Utils/NetworkController/NetworkControllerInventory";
import { NetworkControllerDevice } from "Common/Server/Utils/NetworkController/NetworkControllerTypes";
import NetworkControllerProvider from "Common/Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
} from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { AssetFactSourceKind } from "Common/Utils/Inventory/AssetFactSource";
import {
  NetworkDeviceAssetFactKey,
  NetworkDeviceAssetSource,
  NetworkDeviceFactDetails,
  getNetworkDeviceFactDetails,
} from "Common/Utils/NetworkDevice/NetworkDeviceAssetFacts";
import {
  NETWORK_DEVICE_REFRESH_POLL_AT,
  NetworkDeviceRefreshAnswer,
  NetworkDeviceRefreshProgress,
  NetworkDeviceRefreshSource,
  canRefreshNetworkDevice,
  isFirstPollSinceRefresh,
} from "Common/Utils/NetworkDevice/NetworkDeviceRefresh";
import { describe, expect, it } from "@jest/globals";

/*
 * What the docs say about the Meraki dashboard as a source of a network
 * device's details, and about Refresh, held to the code that makes it true.
 *
 *   - Exporting to a CMDB (Network Device Asset Attributes, Keep it fresh)
 *   - Inventory Overview (Asset details)
 *   - Network Device Monitor (Device Identity)
 *   - Network Traffic (Cisco Meraki without NetFlow)
 *
 * Each test reads the source of truth - the asset facts, the matching the
 * read runs, the refresh rules, the route and its permission, the words the
 * Dashboard draws - and checks the page still says what it does. The sixteen
 * other languages are held to these lines by the pages' translation suites.
 */

const NETWORK_DEVICE_MONITOR: string = "monitor/network-device-monitor";
const NETWORK_TRAFFIC: string = "monitor/network-traffic";

const DASHBOARD_APP: string = "App/FeatureSet/Dashboard/src";
const REFRESH_HOOK: string = `${DASHBOARD_APP}/Components/NetworkDevice/useNetworkDeviceRefresh.ts`;
const DEVICE_INVENTORY_CARD: string = `${DASHBOARD_APP}/Components/NetworkDevice/DeviceInventoryCard.tsx`;
const ASSET_DETAILS_CARD: string = `${DASHBOARD_APP}/Components/Inventory/InventoryAssetDetailsCard.tsx`;
const MERAKI_CONNECTIONS_CARD: string = `${DASHBOARD_APP}/Components/NetworkTraffic/Meraki/MerakiConnectionsCard.tsx`;
const REFRESH_API: string = "Common/Server/API/NetworkDeviceRefreshAPI.ts";
const BASE_API: string = "App/FeatureSet/BaseAPI/Index.ts";

const READ_AT: string = "2026-10-28T10:00:00.000Z";

const CONNECTION: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.NetworkController,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
};

/*
 * What the Meraki dashboard says about a cellular gateway: an MG21, a model
 * the topology classifier does not know, so its type comes from Meraki's
 * product type too.
 */
function merakiReading(): NetworkDeviceControllerReading {
  const reading: NetworkDeviceControllerReading | undefined =
    buildControllerReading({
      provider: NetworkControllerProvider.Meraki,
      readBy: CONNECTION,
      readAt: READ_AT,
      values: {
        name: "Branch 12 gateway",
        model: "MG21",
        serialNumber: "Q2MG-ABCD-1234",
        macAddress: "e0:55:3d:12:34:56",
        ipAddress: "10.20.30.41",
        firmwareVersion: "cellular-gateway-2-1",
        productType: "cellularGateway",
        networkName: "Branch 12",
        address: "1600 Amphitheatre Pkwy, Mountain View",
      },
    });

  if (!reading) {
    throw new Error("The Meraki reading was not built");
  }

  return reading;
}

// A device OneUptime only pings, at its address, which Meraki describes.
function pingedGateway(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "10.20.30.41",
    hostname: "10.20.30.41",
    discoveredDetails: { controller: merakiReading() },
    ...overrides,
  };
}

// The facts of a device whose value the Meraki dashboard gave.
function factsFromMeraki(
  device: NetworkDeviceAssetSource,
): Array<NetworkDeviceAssetFactKey> {
  const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(device);

  return (Object.keys(details.facts) as Array<NetworkDeviceAssetFactKey>)
    .filter((key: NetworkDeviceAssetFactKey): boolean => {
      return details.facts[key].source?.kind === AssetFactSourceKind.Controller;
    })
    .sort();
}

function networkAttributes(): string {
  return englishSection(CMDB_SYNC, "## Network Device Asset Attributes");
}

function keepItFresh(): string {
  return englishSection(CMDB_SYNC, "## Keep it fresh");
}

function deviceIdentity(): string {
  return englishSection(NETWORK_DEVICE_MONITOR, "### Device Identity");
}

function merakiWithoutNetFlow(): string {
  return englishSection(NETWORK_TRAFFIC, "## Cisco Meraki without NetFlow");
}

describe("Exporting to a CMDB: what the Meraki dashboard fills in", () => {
  /*
   * The page's words for each detail, and the asset fact each one is. "its
   * name" is the hostname column, "its management address" the IP address
   * and the street address the location.
   */
  const LISTED: Record<string, NetworkDeviceAssetFactKey> = {
    "serial number": "serialNumber",
    model: "model",
    firmware: "firmwareVersion",
    make: "manufacturer",
    "MAC address": "macAddress",
    name: "hostname",
    "management address": "ipAddress",
    "street address": "location",
    type: "deviceType",
  };

  it("lists every detail the dashboard fills in where the device's own poll left it empty, and no other", () => {
    // Only pinged, at its address: everything but the address it is polled at.
    const pinged: Array<NetworkDeviceAssetFactKey> =
      factsFromMeraki(pingedGateway());

    expect(pinged).toEqual(
      [
        "deviceType",
        "firmwareVersion",
        "hostname",
        "location",
        "macAddress",
        "manufacturer",
        "model",
        "serialNumber",
      ].sort(),
    );

    // Polled at a DNS name its probe has not resolved yet: the address too.
    expect(
      factsFromMeraki(
        pingedGateway({
          name: "branch12-gw",
          hostname: "branch12-gw.acme.example",
        }),
      ),
    ).toContain("ipAddress");

    const filled: Array<NetworkDeviceAssetFactKey> = Array.from(
      new Set<NetworkDeviceAssetFactKey>([
        ...pinged,
        ...factsFromMeraki(
          pingedGateway({
            name: "branch12-gw",
            hostname: "branch12-gw.acme.example",
          }),
        ),
      ]),
    ).sort();

    expect(filled).toEqual(Object.values(LISTED).sort());
    expect(networkAttributes()).toContain(
      "A Meraki device takes what its own poll leaves empty from the Meraki dashboard, when a [Meraki connection](/docs/monitor/network-traffic#cisco-meraki-without-netflow) reads its organization: its serial number, model, firmware and make, its MAC address, its name, its management address, the street address it is filed under and its type.",
    );

    for (const words of Object.keys(LISTED)) {
      expect(networkAttributes()).toContain(words);
    }
  });

  it("puts a value saved on the device, and what its own poll read, before the dashboard, however much newer Meraki's is", () => {
    // Saved: never walked, so the column is someone's. Meraki's shows beside it.
    const saved: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedGateway({ serialNumber: "TYPED-0001" }),
    );

    expect(saved.facts.serialNumber.value).toBe("TYPED-0001");
    expect(saved.facts.serialNumber.source?.kind).not.toBe(
      AssetFactSourceKind.Controller,
    );
    expect(saved.facts.serialNumber.discoveredDifferent?.value).toBe(
      "Q2MG-ABCD-1234",
    );

    // Polled an hour before Meraki was read: the poll's model still stands.
    const walked: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedGateway({
        deviceModel: "MG21-HW",
        lastSnmpSeenAt: "2026-10-28T09:00:00.000Z",
      }),
    );

    expect(walked.facts.model.value).toBe("MG21-HW");
    expect(walked.facts.model.source?.kind).not.toBe(
      AssetFactSourceKind.Controller,
    );

    expect(networkAttributes()).toContain(
      "A value saved on the device, and what its own poll reads, come first.",
    );
  });

  it("matches a Meraki device by serial number or MAC address, or by management address and name together, and by an address alone never", () => {
    const merakiDevice: (
      overrides: Partial<NetworkControllerDevice>,
    ) => NetworkControllerDevice = (
      overrides: Partial<NetworkControllerDevice>,
    ): NetworkControllerDevice => {
      return {
        serial: "",
        name: "",
        model: "MS120-8",
        mac: "",
        lanIp: "",
        firmware: "switch-16-7",
        productType: "switch",
        controllerNetworkId: "N_1",
        networkName: "Branch 12",
        address: "",
        ...overrides,
      };
    };

    const devices: Array<NetworkControllerDevice> = [
      merakiDevice({
        serial: "Q2SW-0001-AAAA",
        name: "Core switch",
        lanIp: "10.0.0.2",
        mac: "e0:55:3d:00:00:01",
      }),
      merakiDevice({
        serial: "Q2SW-0002-BBBB",
        name: "Edge switch",
        lanIp: "10.0.0.3",
        mac: "e0:55:3d:00:00:02",
      }),
      merakiDevice({
        serial: "Q2AP-0003-CCCC",
        name: "Lobby AP",
        lanIp: "10.0.0.4",
        mac: "e0:55:3d:00:00:03",
        productType: "wireless",
      }),
      merakiDevice({
        serial: "Q2AP-0004-DDDD",
        name: "Store AP",
        lanIp: "10.0.0.5",
        mac: "e0:55:3d:00:00:04",
        productType: "wireless",
      }),
      merakiDevice({
        serial: "Q2AP-0005-EEEE",
        name: "Kiosk AP",
        lanIp: "10.0.0.6",
        mac: "e0:55:3d:00:00:05",
        productType: "wireless",
      }),
    ];

    const candidates: Array<ControllerInventoryCandidate> = [
      // Its serial number, however it was typed.
      {
        id: "by-serial",
        name: "core",
        hostname: "10.9.9.1",
        serialNumber: " q2sw-0001-aaaa ",
      },
      // Its MAC address, in another notation.
      {
        id: "by-mac",
        name: "edge",
        hostname: "10.9.9.2",
        macAddress: "E0-55-3D-00-00-02",
      },
      // Polled at the AP's management address, by the AP's name.
      { id: "by-address-and-name", name: "Lobby AP", hostname: "10.0.0.4" },
      // The Store AP's address, but another name: an address alone matches nothing.
      {
        id: "address-alone",
        name: "Back office printer",
        hostname: "10.0.0.5",
      },
      // Two devices here at the Kiosk AP's address: neither is it.
      { id: "twin-1", name: "Kiosk AP", hostname: "10.0.0.6" },
      { id: "twin-2", name: "Kiosk AP", hostname: "10.0.0.6" },
    ];

    const matches: Map<string, ControllerInventoryMatch> =
      matchControllerDevices({ devices: devices, candidates: candidates });

    expect(
      Array.from(matches.entries()).map(
        ([id, match]: [string, ControllerInventoryMatch]): Array<string> => {
          return [id, match.rule, match.device.serial];
        },
      ),
    ).toEqual([
      ["by-serial", ControllerMatchRule.SerialNumber, "Q2SW-0001-AAAA"],
      ["by-mac", ControllerMatchRule.MacAddress, "Q2SW-0002-BBBB"],
      [
        "by-address-and-name",
        ControllerMatchRule.AddressAndName,
        "Q2AP-0003-CCCC",
      ],
    ]);

    // The three rules the page names, and no other.
    expect(Object.values(ControllerMatchRule).sort()).toEqual(
      [
        ControllerMatchRule.AddressAndName,
        ControllerMatchRule.MacAddress,
        ControllerMatchRule.SerialNumber,
      ].sort(),
    );
    expect(networkAttributes()).toContain(
      "A device is one of the organization's devices when its serial number or MAC address is the Meraki device's, or when OneUptime polls it at the Meraki device's management address and it has the same name.",
    );
  });
});

describe("Refresh, as the pages describe it", () => {
  const REQUESTED_AT: string = "2026-10-28T12:00:00.000Z";

  const answer: NetworkDeviceRefreshAnswer = {
    requestedAt: REQUESTED_AT,
    isProbeReading: true,
    probeName: "Branch probe",
    isControllerReading: true,
    controllerName: "Acme Retail",
    wasAlreadyRequested: false,
  };

  it("names the route the API serves, under /api, and the permission it asks for", () => {
    const route: string = readRepoFile(REFRESH_API);
    const baseApi: string = readRepoFile(BASE_API);

    // The route hangs off the device's own API path, mounted under /api.
    expect(new NetworkDevice().getCrudApiPath()?.toString()).toBe(
      "/network-device",
    );
    expect(route).toContain("new NetworkDevice().getCrudApiPath()");
    expect(route).toContain("}/:networkDeviceId/refresh`;");
    expect(route).toContain("router.post(\n  REFRESH_PATH,");
    expect(baseApi).toContain('const APP_NAME: string = "api";');
    expect(baseApi).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, NetworkDeviceRefreshAPI);",
    );
    expect(codeIn(keepItFresh())).toContain(
      "POST /api/network-device/{id}/refresh",
    );

    // The permission to edit network devices, by the name the pickers list.
    expect(route).toContain(
      "allowedPermissions: new NetworkDevice().getUpdatePermissions(),",
    );
    expect(new NetworkDevice().getUpdatePermissions()).toContain(
      Permission.EditNetworkDevice,
    );
    expect(PermissionHelper.getTitle(Permission.EditNetworkDevice)).toBe(
      "Edit Network Device",
    );
    expect(boldIn(keepItFresh())).toContain("Edit Network Device");
  });

  it("calls the button by the name both cards draw it with", () => {
    expect(REFRESH_TITLE).toBe("Refresh");
    expect(readRepoFile(DEVICE_INVENTORY_CARD)).toContain("REFRESH_TITLE");
    expect(readRepoFile(ASSET_DETAILS_CARD)).toContain("REFRESH_TITLE");
    expect(keepItFresh()).toContain(
      `press ${bold("Refresh")} on its item's ${bold("Asset Details")} card`,
    );
    expect(deviceIdentity()).toContain(
      `press ${bold("Refresh")} on its ${bold("Inventory")} card`,
    );
  });

  it("offers Refresh to whoever may edit network devices, on a device a probe polls or a Meraki connection describes, and nowhere else", () => {
    const polled: NetworkDeviceRefreshSource = {
      probeId: "30000000-0000-4000-8000-000000000001",
      hostname: "10.0.0.2",
      isPollingEnabled: true,
      monitoringMethod: "Probe",
    };
    const described: NetworkDeviceRefreshSource = {
      discoveredDetails: { controller: merakiReading() },
    };

    expect(canRefreshNetworkDevice(polled)).toBe(true);
    expect(
      canRefreshNetworkDevice({ ...polled, isPollingEnabled: false }),
    ).toBe(false);
    expect(canRefreshNetworkDevice({ ...polled, probeId: null })).toBe(false);
    expect(
      canRefreshNetworkDevice({ ...polled, monitoringMethod: "Monitor" }),
    ).toBe(false);

    // Described by a Meraki connection: offered whatever polls it.
    expect(
      canRefreshNetworkDevice({
        ...polled,
        monitoringMethod: "Monitor",
        ...described,
      }),
    ).toBe(true);
    expect(
      canRefreshNetworkDevice({ hostname: "10.0.0.2", ...described }),
    ).toBe(true);

    // The cards ask both: the device, and the permission to edit it.
    const hook: string = readRepoFile(REFRESH_HOOK);

    expect(hook).toContain("ModelAction.Update");
    expect(hook).toContain("canRefreshNetworkDevice(data.device)");

    expect(deviceIdentity()).toContain(
      `${bold("Refresh")} is there for whoever may edit network devices, on a device a probe polls or a Meraki connection describes.`,
    );
    expect(englishSection(INVENTORY_OVERVIEW, "### Asset details")).toContain(
      `A network device's card has a ${bold("Refresh")} button for whoever may edit network devices.`,
    );
  });

  it("puts the device first in its probe's queue, so the probe reads it within a minute, and the Meraki dashboard too", () => {
    expect(NETWORK_DEVICE_REFRESH_POLL_AT.getTime()).toBe(0);

    for (const words of [WAITING_FOR_PROBE, WAITING_FOR_BOTH]) {
      expect(words).toContain("within a minute");
    }

    expect(WAITING_FOR_CONTROLLER).toBe(
      "The Meraki dashboard is read again within a minute.",
    );

    for (const text of [
      keepItFresh(),
      englishSection(INVENTORY_OVERVIEW, "### Asset details"),
      deviceIdentity(),
    ]) {
      expect(text.toLowerCase()).toContain(
        "its probe polls it within a minute",
      );
      expect(text).toContain("Meraki connection reads the organization again");
    }
  });

  it("copies the item when the first poll after the ask lands, and not at every poll after it", () => {
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: REQUESTED_AT,
        previousLastPolledAt: "2026-10-28T11:58:00.000Z",
      }),
    ).toBe(true);
    // Never polled before: the first poll answers it.
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: REQUESTED_AT,
        previousLastPolledAt: null,
      }),
    ).toBe(true);
    // The poll before this one already answered it.
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: REQUESTED_AT,
        previousLastPolledAt: "2026-10-28T12:00:40.000Z",
      }),
    ).toBe(false);
    // Nobody asked.
    expect(
      isFirstPollSinceRefresh({
        refreshRequestedAt: null,
        previousLastPolledAt: "2026-10-28T11:58:00.000Z",
      }),
    ).toBe(false);

    expect(keepItFresh()).toContain(
      "its item is copied as soon as the new reading lands.",
    );
    expect(englishSection(INVENTORY_OVERVIEW, "### Asset details")).toContain(
      "the item is copied from the device as soon as the reading lands.",
    );
  });

  it("says on the card when the new reading has landed, or that the probe could not reach the device", () => {
    expect(
      getRefreshStatusWords({
        answer: answer,
        standing: {
          progress: NetworkDeviceRefreshProgress.Read,
          isProbePending: false,
          isControllerPending: false,
        },
      })?.template,
    ).toBe(READ_AGAIN);
    expect(
      getRefreshStatusWords({
        answer: answer,
        standing: {
          progress: NetworkDeviceRefreshProgress.Unreachable,
          isProbePending: false,
          isControllerPending: false,
        },
      })?.template,
    ).toBe(PROBE_COULD_NOT_REACH);
    expect(PROBE_COULD_NOT_REACH).toContain("could not reach it");

    for (const text of [
      englishSection(INVENTORY_OVERVIEW, "### Asset details"),
      deviceIdentity(),
    ]) {
      expect(text).toContain(
        "The card says when the new reading has landed, or that the probe could not reach the device",
      );
    }
  });
});

describe("Network Traffic and the device page: the organization's devices", () => {
  it("counts on the connection's row the organization's devices that are network devices here", () => {
    expect(DESCRIBED_DEVICES_NOTE.other).toBe(
      "Fills in the model, serial number and firmware of {{count}} network devices.",
    );
    expect(readRepoFile(MERAKI_CONNECTIONS_CARD)).toContain(
      "DESCRIBED_DEVICES_NOTE",
    );
    expect(merakiWithoutNetFlow()).toContain(
      "Each read also lists the organization's devices. A Meraki device that is a network device in OneUptime takes what its own poll leaves empty from the dashboard",
    );
    expect(merakiWithoutNetFlow()).toContain(
      "The connection's row counts them",
    );
  });

  it("names the connection, and when Meraki was read, in a Meraki row of the device's Inventory card", () => {
    const card: string = readRepoFile(DEVICE_INVENTORY_CARD);

    expect(card).toContain('title: "Inventory",');
    expect(card).toContain('title: "Meraki",');
    expect(CONTROLLER_READ_TEMPLATE[NetworkControllerProvider.Meraki]).toBe(
      "Read from the Meraki dashboard ({{name}}), {{time}}.",
    );

    expect(deviceIdentity()).toContain(
      `its ${bold("Inventory")} card names the connection in a ${bold("Meraki")} row.`,
    );
    expect(merakiWithoutNetFlow()).toContain(
      `the device's ${bold("Inventory")} card says when Meraki was read, in a row of its own.`,
    );
  });

  it("links each page that names a Meraki connection to the section that sets one up", () => {
    const link: string =
      "[Meraki connection](/docs/monitor/network-traffic#cisco-meraki-without-netflow)";

    expect(englishPage(CMDB_SYNC)).toContain(link);
    expect(englishPage(INVENTORY_OVERVIEW)).toContain(link);
    expect(deviceIdentity()).toContain(link);
    expect(englishPage(NETWORK_TRAFFIC)).toContain(
      "## Cisco Meraki without NetFlow",
    );
  });
});
