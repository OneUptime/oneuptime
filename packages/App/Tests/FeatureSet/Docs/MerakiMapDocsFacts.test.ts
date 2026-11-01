import { englishPage, englishSection } from "./InventoryAndApiDocsSupport";
import {
  ANALYTICS_WINDOW_MS,
  MAX_TOPOLOGY_NETWORKS_PER_READ,
  TOPOLOGY_WINDOW_MS,
} from "Common/Server/Utils/NetworkController/Meraki/MerakiTrafficReader";
import { readMerakiClients } from "Common/Server/Utils/NetworkController/Meraki/MerakiClientList";
import { planClientPlacements } from "Common/Server/Utils/NetworkController/NetworkControllerTopology";
import { NetworkControllerClient } from "Common/Server/Utils/NetworkController/NetworkControllerTypes";
import EndpointAttachmentUtil from "Common/Utils/Monitor/EndpointAttachmentUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * What the docs say about the map a Meraki connection fills in (OneUptime
 * issue #5379), held to the code that makes it true.
 *
 *   - Network Traffic (Cisco Meraki without NetFlow)
 *   - Network Device Monitor (Network Topology, Ping-only devices and their
 *     switch port, and the troubleshooting note on them)
 *
 * The sixteen other languages keep these lines by the pages' translation
 * suites.
 */

const NETWORK_TRAFFIC: string = "monitor/network-traffic";
const NETWORK_DEVICE_MONITOR: string = "monitor/network-device-monitor";
const HOUR_MS: number = 60 * 60 * 1000;

const merakiOnTraffic: string = englishSection(
  NETWORK_TRAFFIC,
  "## Cisco Meraki without NetFlow",
);
const pingOnly: string = englishSection(
  NETWORK_DEVICE_MONITOR,
  "### Ping-only devices and their switch port",
);
const deviceMonitor: string = englishPage(NETWORK_DEVICE_MONITOR);

describe("how often Meraki is read for the map", () => {
  it("links every six hours, one request a network", () => {
    expect(TOPOLOGY_WINDOW_MS).toBe(6 * HOUR_MS);
    expect(merakiOnTraffic).toContain("Every six hours");
    expect(merakiOnTraffic).toContain("at one request a network");
  });

  it("clients every two hours, on the page that says how long a device takes", () => {
    expect(ANALYTICS_WINDOW_MS).toBe(2 * HOUR_MS);
    expect(pingOnly).toContain("It is read every two hours");
    expect(deviceMonitor).toContain(
      "allow two hours for a new device to appear",
    );
  });

  it("a read's links are bounded, so the page's budget still holds", () => {
    expect(MAX_TOPOLOGY_NETWORKS_PER_READ).toBeLessThan(900);
  });
});

describe("what a Meraki connection does", () => {
  it("names no setting to turn on: only the client list is read", () => {
    expect(merakiOnTraffic).toContain("with nothing to turn on");
    expect(pingOnly).toContain("with nothing to turn on");
  });

  const wired: NetworkControllerClient = readMerakiClients(
    [
      {
        mac: "aa:bb:cc:00:00:51",
        recentDeviceSerial: "Q2SW",
        recentDeviceConnection: "Wired",
        switchport: "7",
      },
    ],
    new Date("2026-11-01T12:00:00Z"),
  )[0]!;

  it("places a client only once its switch is a network device here", () => {
    expect(pingOnly).toContain(
      "once that switch is a network device here, in the same site",
    );
    expect(
      planClientPlacements({
        clients: [wired],
        devices: [],
        placedDevices: new Map(),
        managedDevices: [],
      }),
    ).toEqual({ placements: [], unplacedDeviceCount: 1 });
    expect(merakiOnTraffic).toContain(
      "how many Meraki devices with wired clients are not network devices here",
    );
  });

  it("leaves a guest's phone off the map, and a Wi-Fi client that is a device on it", () => {
    expect(pingOnly).toContain(
      "A Wi-Fi client is placed on its access point only when it is a device here",
    );

    const phone: NetworkControllerClient = { ...wired, isWireless: true };
    const placedDevices: Map<string, { id: string }> = new Map([
      ["Q2SW", { id: "ap" }],
    ]);

    expect(
      planClientPlacements({
        clients: [phone],
        devices: [],
        placedDevices,
        managedDevices: [],
      }).placements,
    ).toEqual([]);
    expect(
      planClientPlacements({
        clients: [phone],
        devices: [],
        placedDevices,
        managedDevices: [{ macAddress: phone.mac }],
      }).placements,
    ).toHaveLength(1);
  });

  it("outranks a walked table while it reports a client, as the page says", () => {
    expect(pingOnly).toContain("its port outranks a walked forwarding table");

    const now: Date = new Date("2026-11-01T12:00:00Z");

    expect(
      EndpointAttachmentUtil.decideUpsert(
        {
          attachedNetworkDeviceId: "switch-a",
          attachmentSource: "meraki",
          firstSeenAt: new Date("2026-10-01T00:00:00Z"),
          lastSeenAt: new Date("2026-11-01T10:00:00Z"),
        },
        {
          macAddress: wired.mac,
          deviceId: "switch-b",
          attachment: { interfaceIndex: 49 },
        },
        { now },
      ).action,
    ).toBe("none");
  });

  it("draws the cables of a device nothing walks, and says so on the map's list", () => {
    expect(deviceMonitor).toContain("draws the cables Meraki knows");
    expect(deviceMonitor).toContain("an MX that only answers ping");
  });
});
