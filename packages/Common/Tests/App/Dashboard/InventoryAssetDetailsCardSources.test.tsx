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
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Where each asset detail came from, and when, on the two cards that show a
 * network device's details (OneUptime issue #5185): Inventory's Asset Details
 * card and the device's own Inventory card.
 *
 * The Asset Details card reads the device the item mirrors, current to the
 * moment and with the sources the item does not carry; it falls back to the
 * item's own facts when it cannot, so it never shows less than before. Most
 * of a machine's details come from one reading - a host's collector, a
 * device's own SNMP poll, or the discovery scan that read a device its poll
 * has not - and that is said once, first below them (UI review). Every detail
 * from anywhere else says so under its value; a saved value discovery
 * contradicts shows what discovery read, in amber.
 *
 * Driven through the real cards against a fake ModelAPI.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

import InventoryAssetDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard";
import { NETWORK_DEVICE_ASSET_FACT_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/NetworkDeviceAssetSelect";
import DeviceInventoryCard, {
  NOTHING_READ_YET,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../Models/DatabaseModels/NetworkDeviceRole";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

const ITEM_ID: string = "40000000-0000-4000-8000-000000000002";
const DEVICE_ID: string = "50000000-0000-4000-8000-000000000002";
const SCAN_ID: string = "60000000-0000-4000-8000-000000000002";
const ROUTER_ID: string = "70000000-0000-4000-8000-000000000002";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const C2960X_SYS_DESCR: string =
  "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)";

// A time this long ago, as the API hands it back.
function ago(milliseconds: number): string {
  return new Date(Date.now() - milliseconds).toISOString();
}

// What the scan "Store subnets" read, a little over two hours ago.
function scanReading(value: string, method: string = "snmp"): JSONObject {
  return {
    value: value,
    method: method,
    readBy: { type: "discoveryScan", id: SCAN_ID, name: "Store subnets" },
    readAt: ago(2 * HOUR + 10 * MINUTE),
  };
}

function arpReading(value: string): JSONObject {
  return {
    value: value,
    method: "arpTable",
    readBy: { type: "networkDevice", id: ROUTER_ID, name: "core-rtr-01" },
    readAt: ago(3 * HOUR + 10 * MINUTE),
  };
}

const FOUND_BY: JSONObject = {
  readBy: { type: "discoveryScan", id: SCAN_ID, name: "Store subnets" },
  readAt: ago(2 * HOUR + 10 * MINUTE),
};

/*
 * A switch at a store that only answers ping: imported by the scan, which
 * read its system group; OneUptime has never walked it.
 */
function pingOnlySwitch(fields: Record<string, unknown> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  Object.assign(device, {
    name: "10.20.12.7",
    hostname: "10.20.12.7",
    discoveredDetails: {
      sysName: scanReading("edge-sw-07"),
      sysDescr: scanReading(C2960X_SYS_DESCR),
      sysObjectId: scanReading("1.3.6.1.4.1.9.1.1208"),
      sysLocation: scanReading("Store 12, back office rack"),
      foundBy: FOUND_BY,
    },
    ...fields,
  });
  return device;
}

// A switch its probe walked three minutes ago.
function walkedSwitch(fields: Record<string, unknown> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  Object.assign(device, {
    name: "core-sw-01",
    hostname: "10.20.0.1",
    sysName: "core-sw-01",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    serialNumber: "FOC1840X0AB",
    firmwareVersion: "16.12.4",
    softwareVersion: "16.12.04",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysDescr:
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    sysLocation: "Hall 2, Rack 14",
    lastSnmpSeenAt: new Date(Date.now() - 3 * MINUTE),
    ...fields,
  });
  return device;
}

// The device's Inventory item, as the mirror last wrote it.
function mirroredItem(attributes: JSONObject = {}): InventoryItem {
  const model: InventoryItem = new InventoryItem();
  model._id = ITEM_ID;
  Object.assign(model, {
    entityType: EntityType.NetworkDevice,
    source: EntitySource.Inventory,
    resourceType: "NetworkDevice",
    resourceId: DEVICE_ID,
    displayName: "10.20.12.7",
    descriptiveAttributes: {
      "net.device.hostname": "10.20.12.7",
      "host.ip": "10.20.12.7",
      ...attributes,
    },
  });
  return model;
}

function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

function serveDevice(device: NetworkDevice): void {
  getItemMock.mockResolvedValue(device as never);
}

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  getCommonHeadersMock.mockReturnValue({} as never);

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Inventory's Asset Details card says where each detail came from (issue #5185)", () => {
  /*
   * The scan read six of the switch's details in one go: said once, below
   * them, rather than six times over (UI review). What came from anywhere
   * else still says so under its value.
   */
  test("a ping-only switch: the scan that read it said once, every other source under its value", async () => {
    serveDevice(pingOnlySwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-hostname-value"),
      ).toHaveTextContent("edge-sw-07");
    });

    expect(textOf("inventory-asset-details-source")).toBe(
      "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
    );
    for (const field of [
      "hostname",
      "manufacturer",
      "operatingSystem",
      "osVersion",
      "location",
      "systemDescription",
    ]) {
      expect(
        screen.getByTestId(`inventory-asset-${field}-value`),
      ).toBeInTheDocument();
      expect({
        field,
        line: screen.queryByTestId(`inventory-asset-${field}-value-source`),
      }).toEqual({ field, line: null });
    }
    expect(textOf("inventory-asset-manufacturer-value")).toContain("Cisco");
    expect(textOf("inventory-asset-operatingSystem-value")).toContain(
      "Cisco IOS",
    );
    expect(textOf("inventory-asset-location-value")).toContain(
      "Store 12, back office rack",
    );
    // Polled at an address: that address, said as such.
    expect(textOf("inventory-asset-ipAddress-value-source")).toBe(
      "The address its probe polls",
    );
    // Classified from what the scan read, and from its name.
    expect(textOf("inventory-asset-deviceType-value")).toContain("Switch");
    expect(textOf("inventory-asset-deviceType-value-source")).toBe(
      "Worked out from its name and what it reports",
    );

    // The scan that read it found it: not said a second time.
    expect(
      screen.queryByTestId("inventory-asset-details-found-by"),
    ).not.toBeInTheDocument();
    // What neither the poll nor a scan found is still named as unknown.
    expect(textOf("inventory-asset-details-unknown")).toContain(
      "neither this device's SNMP poll nor a discovery scan has found them",
    );
  });

  test("below the details, in the order a reader asks: where from, what is unknown, when last found, another machine", async () => {
    serveDevice(
      pingOnlySwitch({
        discoveredDetails: {
          sysName: scanReading("edge-sw-07"),
          sysDescr: scanReading(C2960X_SYS_DESCR),
          // Found there again ten minutes ago, without answering SNMP.
          foundBy: {
            readBy: {
              type: "discoveryScan",
              id: SCAN_ID,
              name: "Store subnets",
            },
            readAt: ago(10 * MINUTE),
          },
          otherMachine: {
            readBy: {
              type: "discoveryScan",
              id: SCAN_ID,
              name: "Store subnets",
            },
            readAt: ago(5 * MINUTE),
            netbiosName: "LAPTOP-12",
          },
        },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-details-found-by"),
      ).toBeInTheDocument();
    });

    expect(textOf("inventory-asset-details-source")).toBe(
      "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
    );
    expect(textOf("inventory-asset-details-found-by")).toBe(
      "Last found at its address by discovery scan Store subnets, 10 minutes ago.",
    );

    const order: Array<string> = Array.from(
      screen
        .getByTestId("inventory-asset-details")
        .querySelectorAll("[data-testid^='inventory-asset-details-']"),
    ).map((element: Element): string => {
      return element.getAttribute("data-testid") || "";
    });
    expect(order).toEqual([
      "inventory-asset-details-source",
      "inventory-asset-details-unknown",
      "inventory-asset-details-found-by",
      "inventory-asset-details-other-machine",
    ]);
    // The exact time of each, on hover.
    expect(
      screen
        .getByTestId("inventory-asset-details-source")
        .getAttribute("title"),
    ).toMatch(/\d/);
    expect(
      screen
        .getByTestId("inventory-asset-details-found-by")
        .getAttribute("title"),
    ).toMatch(/\d/);
  });

  /*
   * Walked three days ago, scanned two hours ago: the scan's newer reading
   * gives most details and is said once; what only the old walk read says
   * so, with when.
   */
  test("a switch its poll last read days ago: the newer scan said once, the poll's values each say so", async () => {
    serveDevice(
      walkedSwitch({
        lastSnmpSeenAt: new Date(Date.now() - 3 * 24 * HOUR),
        discoveredDetails: {
          sysName: scanReading("core-sw-01"),
          sysDescr: scanReading(
            "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
          ),
          sysObjectId: scanReading("1.3.6.1.4.1.9.1.1745"),
          sysLocation: scanReading("Hall 2, Rack 14"),
          foundBy: FOUND_BY,
        },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(textOf("inventory-asset-details-source")).toBe(
        "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
      );
    });

    for (const field of ["model", "serialNumber", "firmwareVersion"]) {
      expect({
        field,
        line: textOf(`inventory-asset-${field}-value-source`),
      }).toEqual({ field, line: "Its SNMP poll · 3 days ago" });
    }
    expect(
      screen.queryByTestId("inventory-asset-hostname-value-source"),
    ).not.toBeInTheDocument();
  });

  test("a walked switch: its own poll is said once, below the details, not under each", async () => {
    serveDevice(walkedSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-details-source"),
      ).toHaveTextContent("Read over SNMP by its probe, 3 minutes ago.");
    });

    for (const field of [
      "hostname",
      "manufacturer",
      "model",
      "serialNumber",
      "firmwareVersion",
      "operatingSystem",
      "osVersion",
    ]) {
      expect(
        screen.getByTestId(`inventory-asset-${field}-value`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`inventory-asset-${field}-value-source`),
      ).not.toBeInTheDocument();
    }
    expect(textOf("inventory-asset-serialNumber-value")).toContain(
      "FOC1840X0AB",
    );
  });

  test("a saved MAC an ARP table contradicts: the saved one, and what the table says in amber", async () => {
    serveDevice(
      walkedSwitch({
        macAddress: "00:1b:54:c2:7a:01",
        isMacAddressLearned: false,
        discoveredDetails: { macAddress: arpReading("00:1b:54:c2:7a:02") },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-macAddress-value-different"),
      ).toBeInTheDocument();
    });

    expect(textOf("inventory-asset-macAddress-value")).toContain(
      "00-1B-54-C2-7A-01",
    );
    expect(textOf("inventory-asset-macAddress-value-source")).toBe(
      "Saved on this device",
    );
    const different: HTMLElement = screen.getByTestId(
      "inventory-asset-macAddress-value-different",
    );
    expect(different).toHaveTextContent(
      "ARP table of core-rtr-01 says 00-1B-54-C2-7A-02 · 3 hours ago",
    );
    expect(different).toHaveClass("text-amber-700");
  });

  test("a MAC learned from an ARP table says which router's, and when", async () => {
    serveDevice(
      walkedSwitch({
        macAddress: "00:1b:54:c2:7a:01",
        isMacAddressLearned: true,
        discoveredDetails: { macAddress: arpReading("00:1b:54:c2:7a:01") },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-macAddress-value-source"),
      ).toHaveTextContent("ARP table of core-rtr-01 · 3 hours ago");
    });
    expect(
      screen.queryByTestId("inventory-asset-macAddress-value-different"),
    ).not.toBeInTheDocument();
  });

  test("a scan that found another machine at the address is said, in amber", async () => {
    serveDevice(
      walkedSwitch({
        discoveredDetails: {
          otherMachine: {
            readBy: {
              type: "discoveryScan",
              id: SCAN_ID,
              name: "Store subnets",
            },
            readAt: ago(2 * HOUR + 10 * MINUTE),
            netbiosName: "LAPTOP-12",
          },
        },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-details-other-machine"),
      ).toHaveTextContent(
        "Discovery scan Store subnets found another machine at this address 2 hours ago (LAPTOP-12), so nothing it read there is used.",
      );
    });
    expect(
      screen.getByTestId("inventory-asset-details-other-machine"),
    ).toHaveClass("text-amber-700");
  });

  test("the device is read with every column its facts need, and the project's roles beside it", async () => {
    serveDevice(walkedSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    const call: { modelType: unknown; id: ObjectID; select: JSONObject } =
      getItemMock.mock.calls[0]![0] as never;
    expect(call.modelType).toBe(NetworkDevice);
    expect(call.id.toString()).toBe(DEVICE_ID);
    expect(call.select).toEqual(NETWORK_DEVICE_ASSET_FACT_SELECT);
    for (const column of [
      "discoveredDetails",
      "lastSnmpSeenAt",
      "isMacAddressLearned",
      "sysContact",
    ]) {
      expect({ column, selected: call.select[column] }).toEqual({
        column,
        selected: true,
      });
    }

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalled();
    });
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(NetworkDeviceRole);
  });

  test("the project's name for the classified role types the device, as the mirror does", async () => {
    serveDevice(pingOnlySwitch());
    const role: NetworkDeviceRole = new NetworkDeviceRole();
    role.key = "switch";
    role.name = "Store Access Switch";
    getListMock.mockResolvedValue({
      data: [role],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-deviceType-value"),
      ).toHaveTextContent("Store Access Switch");
    });
  });

  test("a refused role read still shows the device, by the built-in names", async () => {
    serveDevice(pingOnlySwitch());
    getListMock.mockRejectedValue(new Error("Forbidden") as never);

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-deviceType-value"),
      ).toHaveTextContent("Switch");
    });
  });

  test("a device that cannot be read: the item's own facts, as before, with no sources", async () => {
    getItemMock.mockRejectedValue(new Error("Forbidden") as never);

    render(
      <InventoryAssetDetailsCard
        item={mirroredItem({
          "host.name": "edge-sw-07",
          "device.manufacturer": "Cisco",
        })}
      />,
    );

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(textOf("inventory-asset-hostname-value")).toContain("edge-sw-07");
    expect(textOf("inventory-asset-manufacturer-value")).toContain("Cisco");
    expect(
      screen.queryByTestId("inventory-asset-hostname-value-source"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inventory-asset-details-found-by"),
    ).not.toBeInTheDocument();
  });

  test("while the device is read, the item's own facts stand in", () => {
    getItemMock.mockReturnValue(new Promise<never>(() => {}));

    render(
      <InventoryAssetDetailsCard
        item={mirroredItem({ "host.name": "edge-sw-07" })}
      />,
    );

    expect(textOf("inventory-asset-hostname-value")).toContain("edge-sw-07");
  });

  test("a device deleted since the mirror's last pass: the item's facts", async () => {
    getItemMock.mockResolvedValue(null as never);

    render(
      <InventoryAssetDetailsCard
        item={mirroredItem({ "host.name": "edge-sw-07" })}
      />,
    );

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });
    expect(textOf("inventory-asset-hostname-value")).toContain("edge-sw-07");
  });

  test("an item that mirrors no device reads none", () => {
    const notADevice: InventoryItem = mirroredItem({ "host.name": "edge" });
    notADevice.resourceId = "not-an-id" as never;

    render(<InventoryAssetDetailsCard item={notADevice} />);

    expect(getItemMock).not.toHaveBeenCalled();
    expect(textOf("inventory-asset-hostname-value")).toContain("edge");
  });

  test("a host: its collector said once, with when; a type worked out from its OS says so", () => {
    const host: InventoryItem = new InventoryItem();
    host._id = ITEM_ID;
    Object.assign(host, {
      entityType: EntityType.Host,
      source: EntitySource.Discovered,
      displayName: "wbqajdebsv001",
      identifyingAttributes: { "host.name": "wbqajdebsv001" },
      descriptiveAttributes: {
        "host.arch": "amd64",
        "host.ip": "10.210.72.109",
        "os.description": "Windows Server 2022 10.0",
        "os.type": "windows",
      },
      lastSeenAt: new Date(Date.now() - 3 * MINUTE),
    });

    render(<InventoryAssetDetailsCard item={host} />);

    expect(getItemMock).not.toHaveBeenCalled();
    expect(textOf("inventory-asset-details-source")).toBe(
      "Reported by its collector, 3 minutes ago.",
    );
    expect(
      screen.queryByTestId("inventory-asset-hostname-value-source"),
    ).not.toBeInTheDocument();
    expect(textOf("inventory-asset-deviceType-value-source")).toBe(
      "Worked out from its name and what it reports",
    );
  });
});

describe("the device's own Inventory card says where each value came from (issue #5185)", () => {
  /*
   * Every value the card shows came from the one scan: said once, in the
   * Discovery row, rather than under each of them (UI review).
   */
  test("a ping-only switch: the scan that read it said once, in the Discovery row", async () => {
    serveDevice(pingOnlySwitch());

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByTestId("device-inventory-vendor")).toHaveTextContent(
        "Cisco",
      );
    });

    expect(textOf("device-inventory-os")).toContain("Cisco IOS");
    expect(textOf("device-inventory-location")).toContain(
      "Store 12, back office rack",
    );
    expect(textOf("device-inventory-sysobjectid")).toContain(
      "1.3.6.1.4.1.9.1.1208",
    );
    for (const testId of [
      "device-inventory-vendor",
      "device-inventory-os",
      "device-inventory-software",
      "device-inventory-sysobjectid",
      "device-inventory-location",
    ]) {
      expect({
        testId,
        line: screen.queryByTestId(`${testId}-source`),
      }).toEqual({ testId, line: null });
    }

    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(textOf("device-inventory-source")).toBe(
      "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
    );
    // The scan that read it found it: not said a second time.
    expect(
      screen.queryByTestId("device-inventory-found-by"),
    ).not.toBeInTheDocument();
  });

  test("a switch found again since the scan read it: both, in the Discovery row", async () => {
    serveDevice(
      pingOnlySwitch({
        discoveredDetails: {
          sysDescr: scanReading(C2960X_SYS_DESCR),
          sysObjectId: scanReading("1.3.6.1.4.1.9.1.1208"),
          sysLocation: scanReading("Store 12, back office rack"),
          foundBy: {
            readBy: {
              type: "discoveryScan",
              id: SCAN_ID,
              name: "Store subnets",
            },
            readAt: ago(10 * MINUTE),
          },
        },
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(textOf("device-inventory-found-by")).toBe(
        "Last found at its address by discovery scan Store subnets, 10 minutes ago.",
      );
    });
    expect(textOf("device-inventory-source")).toBe(
      "Read over SNMP by discovery scan Store subnets, 2 hours ago.",
    );
  });

  test("another machine at the address is said in amber, with its icon", async () => {
    serveDevice(
      walkedSwitch({
        discoveredDetails: {
          otherMachine: {
            readBy: {
              type: "discoveryScan",
              id: SCAN_ID,
              name: "Store subnets",
            },
            readAt: ago(2 * HOUR + 10 * MINUTE),
            sysName: "LAPTOP-12",
          },
        },
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("device-inventory-other-machine"),
      ).toHaveTextContent(
        "Discovery scan Store subnets found another machine at this address 2 hours ago (LAPTOP-12), so nothing it read there is used.",
      );
    });
    const note: HTMLElement = screen.getByTestId(
      "device-inventory-other-machine",
    );
    expect(note).toHaveClass("text-amber-700");
    expect(note.querySelector("svg")).not.toBeNull();
    // A walked switch's own poll goes unsaid on its own page.
    expect(
      screen.queryByTestId("device-inventory-source"),
    ).not.toBeInTheDocument();
  });

  test("a walked switch: its own poll's values carry no line of their own", async () => {
    serveDevice(walkedSwitch());

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByTestId("device-inventory-model")).toHaveTextContent(
        "WS-C3850-48P",
      );
    });

    for (const testId of [
      "device-inventory-vendor",
      "device-inventory-model",
      "device-inventory-serial",
      "device-inventory-firmware",
      "device-inventory-os",
      "device-inventory-software",
      "device-inventory-location",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.queryByTestId(`${testId}-source`)).not.toBeInTheDocument();
    }
    // Nothing discovery found: no Discovery row.
    expect(screen.queryByText("Discovery")).not.toBeInTheDocument();
  });

  test("a value saved before the device was ever walked says so, and what a scan read instead", async () => {
    serveDevice(
      walkedSwitch({
        lastSnmpSeenAt: undefined,
        sysLocation: "Hall 2, Rack 14",
        discoveredDetails: { sysLocation: scanReading("Hall 3, Rack 2") },
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("device-inventory-location-different"),
      ).toHaveTextContent(
        "Discovery scan Store subnets (SNMP) says Hall 3, Rack 2 · 2 hours ago",
      );
    });
    expect(textOf("device-inventory-location")).toContain("Hall 2, Rack 14");
    expect(textOf("device-inventory-location-source")).toBe(
      "Saved on this device",
    );
  });

  /*
   * On the device's own page, what is saved on it is what the page shows -
   * its Name and Hostname do not say where they came from either (UI
   * review). Only a value discovery reads differently says it was saved.
   */
  test("a value saved on the device that nothing disputes carries no line", async () => {
    serveDevice(
      walkedSwitch({
        lastSnmpSeenAt: undefined,
        sysLocation: "Hall 2, Rack 14",
        discoveredDetails: {},
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(textOf("device-inventory-location")).toContain("Hall 2, Rack 14");
    });
    for (const testId of [
      "device-inventory-vendor",
      "device-inventory-model",
      "device-inventory-serial",
      "device-inventory-location",
    ]) {
      expect({
        testId,
        line: screen.queryByTestId(`${testId}-source`),
      }).toEqual({ testId, line: null });
    }
  });

  /*
   * A device added a moment ago, or one that never answered: one line on how
   * the card fills in, rather than an empty card under its title (UI
   * review).
   */
  test("a device nothing has read yet: how the card fills in, instead of an empty card", async () => {
    const device: NetworkDevice = new NetworkDevice();
    device.id = new ObjectID(DEVICE_ID);
    Object.assign(device, { name: "lab-switch", hostname: "10.99.0.5" });
    serveDevice(device);

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(textOf("device-inventory-nothing-read")).toBe(NOTHING_READ_YET);
    });
    expect(screen.getByText("Discovery")).toBeInTheDocument();
  });

  test("the line is gone once anything is known: a ping answered, a scan, a walk", async () => {
    const answered: NetworkDevice = new NetworkDevice();
    answered.id = new ObjectID(DEVICE_ID);
    Object.assign(answered, {
      name: "lab-switch",
      hostname: "10.99.0.5",
      lastSeenAt: new Date(Date.now() - 2 * MINUTE),
    });

    for (const device of [answered, pingOnlySwitch(), walkedSwitch()]) {
      serveDevice(device);

      render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

      await waitFor((): void => {
        expect(getItemMock).toHaveBeenCalled();
        expect(screen.getAllByTestId("detail-field").length).toBeGreaterThan(0);
      });
      expect(
        screen.queryByTestId("device-inventory-nothing-read"),
      ).not.toBeInTheDocument();

      cleanup();
      getItemMock.mockClear();
    }
  });

  test("the line is in every Dashboard language", () => {
    for (const code of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
    ]) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "..",
            "..",
            "App",
            "FeatureSet",
            "Dashboard",
            "src",
            "Locales",
            `${code}.json`,
          ),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const translated: unknown = locale[NOTHING_READ_YET];

      expect({ code, isText: typeof translated }).toEqual({
        code,
        isText: "string",
      });
      expect({ code, same: translated === NOTHING_READ_YET }).toEqual({
        code,
        same: false,
      });
    }
  });

  test("the card asks for what discovery read, and when the poll last read it", async () => {
    serveDevice(walkedSwitch());

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });

    const select: JSONObject = (
      getItemMock.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    for (const column of [
      "discoveredDetails",
      "lastSnmpSeenAt",
      "isMacAddressLearned",
      "sysContact",
      "vendor",
      "sysDescr",
    ]) {
      expect({ column, selected: select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });
});
