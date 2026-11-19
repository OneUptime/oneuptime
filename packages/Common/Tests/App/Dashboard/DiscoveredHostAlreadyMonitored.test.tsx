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
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import DiscoveredHostTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveredHostTable";
import { DEFAULT_DISCOVERY_REVIEW_QUERY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportReview";
import DeviceMonitorsLink from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsLink";
import {
  DeviceMonitorsByKey,
  getMonitorsOfRow,
  loadDeviceMonitors,
  summarizeDeviceMonitors,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsOfDevices";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "ALREADY MONITORED", WHERE A DISCOVERED HOST IS OFFERED (OneUptime issue
 * #9509).
 *
 * A scan's Review Results said "Already added" for a host that was a device,
 * and nothing about whether anything watched it - so a person who wanted it
 * watched went looking for another way to give it a monitor, and the device
 * ended up with two identical ones. A host that is a device and has a
 * monitor now says "Already monitored" and links to it (or, with several,
 * to the device's Monitors page); one with none still says "Already added".
 * The monitors are the ones the server's duplicate check counts: made for
 * the device, or bound to it.
 */

const SCAN_ID: ObjectID = new ObjectID("5a2b3c4d-6e7f-4a8b-9c0d-1e2f3a4b5c6d");
const KIOSK_DEVICE_ID: string = "6b3c4d5e-7f80-4b9c-8d1e-2f3a4b5c6d7e";
const PRINTER_DEVICE_ID: string = "6b3c4d5e-7f80-4b9c-8d1e-2f3a4b5c6d7f";
const BRANCH_KIOSK_DEVICE_ID: string = "6b3c4d5e-7f80-4b9c-8d1e-2f3a4b5c6d80";
const KIOSK_PING_ID: string = "7c4d5e6f-8091-4cad-9e2f-3a4b5c6d7e8f";
const KIOSK_HEALTH_ID: string = "7c4d5e6f-8091-4cad-9e2f-3a4b5c6d7e90";
const BOUND_PING_ID: string = "7c4d5e6f-8091-4cad-9e2f-3a4b5c6d7e91";

/*
 * The kiosk is monitored; the printer is a device nothing watches; the till
 * is new. Each already-added host names the device the server says it is
 * (issue #9677).
 */
const KIOSK: DiscoveredNetworkDevice = {
  ipAddress: "10.40.12.7",
  sysName: "WB1567KSK02",
  snmpReachable: false,
  isAlreadyRegistered: true,
  registeredDeviceId: KIOSK_DEVICE_ID,
};
const PRINTER: DiscoveredNetworkDevice = {
  ipAddress: "10.40.12.8",
  sysName: "WB1567PRN01",
  snmpReachable: false,
  isAlreadyRegistered: true,
  registeredDeviceId: PRINTER_DEVICE_ID,
};
const TILL: DiscoveredNetworkDevice = {
  ipAddress: "10.40.12.9",
  sysName: "WB1567TIL01",
  snmpReachable: false,
};

function device(id: string, hostname: string, bound?: Monitor): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = new ObjectID(id);
  item.hostname = hostname;

  if (bound) {
    item.monitorId = bound.id!;
    item.monitor = bound;
  }

  return item;
}

function monitor(data: {
  id: string;
  name: string;
  monitorType?: MonitorType;
  madeForDeviceId?: string;
}): Monitor {
  const item: Monitor = new Monitor();
  item.id = new ObjectID(data.id);
  item.name = data.name;
  item.monitorType = data.monitorType || MonitorType.Ping;

  if (data.madeForDeviceId) {
    item.autoProvisionedNetworkDeviceId = new ObjectID(data.madeForDeviceId);
  }

  return item;
}

let inventory: Array<NetworkDevice>;
let monitors: Array<Monitor>;
let getListSpy: jest.SpyInstance;

function scan(): NetworkDeviceDiscoveryScan {
  const item: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  item.id = SCAN_ID;
  item.name = "Store 1567";
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

  // The reads of the page's already-added hosts.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function rowOf(address: string): HTMLElement {
  return screen.getByTestId(`discovered-host-row-${address}`);
}

beforeEach(() => {
  inventory = [
    device(KIOSK_DEVICE_ID, KIOSK.ipAddress),
    device(PRINTER_DEVICE_ID, PRINTER.ipAddress),
  ];
  monitors = [
    monitor({
      id: KIOSK_PING_ID,
      name: "WB1567KSK02",
      madeForDeviceId: KIOSK_DEVICE_ID,
    }),
  ];

  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (request: { modelType: unknown }) => {
      const data: Array<unknown> =
        request.modelType === NetworkDevice
          ? inventory
          : request.modelType === Monitor
            ? monitors
            : [];

      return { data: data, count: data.length, skip: 0, limit: data.length };
    }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a discovered host that is already a device, in Review Results", () => {
  test("says Already monitored and links to its monitor when it has one", async () => {
    await renderHosts([KIOSK, PRINTER, TILL]);

    const kiosk: HTMLElement = rowOf(KIOSK.ipAddress);
    expect(
      within(kiosk).getByTestId(`discovered-host-monitored-${KIOSK.ipAddress}`),
    ).toHaveTextContent("Already monitored");
    expect(within(kiosk).queryByText("Already added")).not.toBeInTheDocument();

    const link: HTMLElement = within(kiosk).getByTestId(
      `discovered-host-monitor-link-${KIOSK.ipAddress}`,
    );
    expect(link).toHaveTextContent("WB1567KSK02");
    expect(link.getAttribute("href")).toContain(KIOSK_PING_ID);
  });

  test("still says Already added when nothing watches it, and a new host says neither", async () => {
    await renderHosts([KIOSK, PRINTER, TILL]);

    const printer: HTMLElement = rowOf(PRINTER.ipAddress);
    expect(within(printer).getByText("Already added")).toBeInTheDocument();
    expect(
      within(printer).queryByText("Already monitored"),
    ).not.toBeInTheDocument();

    const till: HTMLElement = rowOf(TILL.ipAddress);
    expect(within(till).queryByText("Already added")).not.toBeInTheDocument();
    expect(
      within(till).queryByText("Already monitored"),
    ).not.toBeInTheDocument();
  });

  test("keeps every already-added host out of the selection, monitored or not", async () => {
    await renderHosts([KIOSK, PRINTER, TILL]);

    expect(
      screen.getByTestId(`discovered-device-checkbox-${KIOSK.ipAddress}`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`discovered-device-checkbox-${PRINTER.ipAddress}`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`discovered-device-checkbox-${TILL.ipAddress}`),
    ).not.toBeDisabled();
  });

  test("links to the device's Monitors page, counted, when it has several", async () => {
    monitors.push(
      monitor({
        id: KIOSK_HEALTH_ID,
        name: "WB1567KSK02 - Health",
        monitorType: MonitorType.NetworkDevice,
        madeForDeviceId: KIOSK_DEVICE_ID,
      }),
    );

    await renderHosts([KIOSK]);

    const link: HTMLElement = screen.getByTestId(
      `discovered-host-monitor-link-${KIOSK.ipAddress}`,
    );
    expect(link).toHaveTextContent("2 monitors");
    expect(link.getAttribute("href")).toContain(`${KIOSK_DEVICE_ID}/monitors`);
  });

  test("counts the monitor bound to a monitor-backed device as its monitor", async () => {
    const bound: Monitor = monitor({ id: BOUND_PING_ID, name: "Printer ping" });
    inventory = [device(PRINTER_DEVICE_ID, PRINTER.ipAddress, bound)];
    monitors = [];

    await renderHosts([PRINTER]);

    expect(
      screen.getByTestId(`discovered-host-monitor-link-${PRINTER.ipAddress}`),
    ).toHaveTextContent("Printer ping");
  });

  test("reads only the devices the page's already-added hosts are, by id, then their monitors", async () => {
    await renderHosts([KIOSK, PRINTER, TILL]);

    const reads: Array<{ modelType: unknown; query: Record<string, unknown> }> =
      getListSpy.mock.calls.map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
        };
      });

    const deviceRead: { query: Record<string, unknown> } = reads.find(
      (read: { modelType: unknown }): boolean => {
        return read.modelType === NetworkDevice;
      },
    )!;
    const ids: Includes = deviceRead.query["_id"] as Includes;
    expect([...ids.values].map(String).sort()).toEqual(
      [KIOSK_DEVICE_ID, PRINTER_DEVICE_ID].sort(),
    );
    expect(deviceRead.query["hostname"]).toBeUndefined();

    const monitorRead: { query: Record<string, unknown> } = reads.find(
      (read: { modelType: unknown }): boolean => {
        return read.modelType === Monitor;
      },
    )!;
    const deviceIds: Includes = monitorRead.query[
      "autoProvisionedNetworkDeviceId"
    ] as Includes;
    expect([...deviceIds.values].map(String).sort()).toEqual(
      [KIOSK_DEVICE_ID, PRINTER_DEVICE_ID].sort(),
    );
  });

  test("asks nothing when no host shown is a device", async () => {
    await renderHosts([TILL]);

    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("says Already added for every device when the monitors cannot be read", async () => {
    getListSpy.mockRejectedValue(new Error("You may not read monitors."));

    await renderHosts([KIOSK, PRINTER]);

    expect(
      within(rowOf(KIOSK.ipAddress)).getByText("Already added"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Already monitored")).not.toBeInTheDocument();
  });
});

describe("the monitors of a device, for a list", () => {
  test("are its bound monitor first, then the monitors made for it by name, each once", () => {
    const bound: Monitor = monitor({ id: BOUND_PING_ID, name: "Z bound" });
    const summary: DeviceMonitorsByKey = summarizeDeviceMonitors({
      devices: [device(KIOSK_DEVICE_ID, KIOSK.ipAddress, bound)],
      monitorsMadeForDevices: [
        monitor({
          id: KIOSK_HEALTH_ID,
          name: "B health",
          madeForDeviceId: KIOSK_DEVICE_ID,
        }),
        monitor({
          id: KIOSK_PING_ID,
          name: "A ping",
          madeForDeviceId: KIOSK_DEVICE_ID,
        }),
        // Made for the device and bound to it: listed once, as the bound one.
        monitor({
          id: BOUND_PING_ID,
          name: "Z bound",
          madeForDeviceId: KIOSK_DEVICE_ID,
        }),
        // Another device's.
        monitor({
          id: "7c4d5e6f-8091-4cad-9e2f-3a4b5c6d7e99",
          name: "Elsewhere",
          madeForDeviceId: PRINTER_DEVICE_ID,
        }),
      ],
    });

    expect(
      getMonitorsOfRow({
        monitors: summary,
        deviceId: KIOSK_DEVICE_ID,
      })!.monitors.map((link: { name: string }): string => {
        return link.name;
      }),
    ).toEqual(["Z bound", "A ping", "B health"]);
  });

  test("keep two sites' devices at one address apart: each has its own monitors (issue #9677)", () => {
    const summary: DeviceMonitorsByKey = summarizeDeviceMonitors({
      devices: [
        device(KIOSK_DEVICE_ID, KIOSK.ipAddress),
        // Another site's 10.40.12.7.
        device(BRANCH_KIOSK_DEVICE_ID, KIOSK.ipAddress),
      ],
      monitorsMadeForDevices: [
        monitor({
          id: KIOSK_PING_ID,
          name: "Store kiosk",
          madeForDeviceId: KIOSK_DEVICE_ID,
        }),
      ],
    });

    expect(
      getMonitorsOfRow({ monitors: summary, deviceId: KIOSK_DEVICE_ID })
        ?.monitors,
    ).toHaveLength(1);
    expect(
      getMonitorsOfRow({ monitors: summary, deviceId: BRANCH_KIOSK_DEVICE_ID }),
    ).toBeUndefined();
  });

  test("are no summary at all for a device with none, so its row says Already added", () => {
    const summary: DeviceMonitorsByKey = summarizeDeviceMonitors({
      devices: [device(PRINTER_DEVICE_ID, PRINTER.ipAddress)],
      monitorsMadeForDevices: [],
    });

    expect(
      getMonitorsOfRow({ monitors: summary, deviceId: PRINTER_DEVICE_ID }),
    ).toBeUndefined();
    expect(getMonitorsOfRow({ monitors: summary })).toBeUndefined();
  });

  test("are read by device id for the Discovered Devices list, and nothing is read for none", async () => {
    await loadDeviceMonitors({ deviceIds: [] });
    expect(getListSpy).not.toHaveBeenCalled();

    const loaded: DeviceMonitorsByKey = await loadDeviceMonitors({
      deviceIds: [KIOSK_DEVICE_ID, KIOSK_DEVICE_ID],
    });

    const deviceRead: { query: Record<string, unknown> } = getListSpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(
      [...(deviceRead.query["_id"] as Includes).values].map(String),
    ).toEqual([KIOSK_DEVICE_ID]);
    expect(
      getMonitorsOfRow({ monitors: loaded, deviceId: KIOSK_DEVICE_ID })
        ?.monitors[0]?.id,
    ).toBe(KIOSK_PING_ID);
  });

  test("skip the monitor read when no device is found", async () => {
    inventory = [];

    await loadDeviceMonitors({ deviceIds: [BRANCH_KIOSK_DEVICE_ID] });

    expect(getListSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the link to a device's monitors", () => {
  test("names an unnamed monitor in the reader's words", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <DeviceMonitorsLink
            summary={{
              deviceId: KIOSK_DEVICE_ID,
              monitors: [
                { id: KIOSK_PING_ID, name: "", monitorType: MonitorType.Ping },
              ],
            }}
            dataTestId="link"
          />
        </MemoryRouter>,
      );
    });

    expect(screen.getByTestId("link")).toHaveTextContent("Unnamed monitor");
  });

  test("draws nothing for a device with no monitor", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <DeviceMonitorsLink
            summary={{ deviceId: KIOSK_DEVICE_ID, monitors: [] }}
            dataTestId="link"
          />
        </MemoryRouter>,
      );
    });

    expect(screen.queryByTestId("link")).not.toBeInTheDocument();
  });
});

/*
 * TWO SITES' DEVICES AT ONE ADDRESS (OneUptime issue #9677).
 *
 * Every branch can have a 10.40.12.7. A scan's host is the device the scan's
 * probe sees there, and its row reads that device's monitors alone: the
 * other branch's monitor never makes it "Already monitored".
 */
describe("a host at an address another branch's device has", () => {
  const BRANCH_KIOSK: DiscoveredNetworkDevice = {
    ...KIOSK,
    registeredDeviceId: BRANCH_KIOSK_DEVICE_ID,
  };

  beforeEach(() => {
    inventory = [
      device(KIOSK_DEVICE_ID, KIOSK.ipAddress),
      device(BRANCH_KIOSK_DEVICE_ID, KIOSK.ipAddress),
    ];
  });

  test("says Already added when only the other branch's device has a monitor", async () => {
    await renderHosts([BRANCH_KIOSK]);

    const row: HTMLElement = rowOf(KIOSK.ipAddress);
    expect(within(row).getByText("Already added")).toBeInTheDocument();
    expect(
      within(row).queryByText("Already monitored"),
    ).not.toBeInTheDocument();
  });

  test("reads the monitors of its own device alone", async () => {
    await renderHosts([BRANCH_KIOSK]);

    const deviceRead: { query: Record<string, unknown> } = getListSpy.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
        };
      })
      .find((read: { modelType: unknown }): boolean => {
        return read.modelType === NetworkDevice;
      })!;

    expect(
      [...(deviceRead.query["_id"] as Includes).values].map(String),
    ).toEqual([BRANCH_KIOSK_DEVICE_ID]);
  });

  test("says Already added, and reads nothing, when the scan's probe cannot tell which device it is", async () => {
    await renderHosts([{ ...KIOSK, registeredDeviceId: undefined }]);

    expect(
      within(rowOf(KIOSK.ipAddress)).getByText("Already added"),
    ).toBeInTheDocument();
    expect(getListSpy).not.toHaveBeenCalled();
  });
});
