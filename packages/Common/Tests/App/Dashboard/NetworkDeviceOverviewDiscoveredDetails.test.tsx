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
import React from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The device Overview's Device Details card, with what discovery read
 * (OneUptime issue #5185).
 *
 * A device OneUptime only pings has no DNS name, SNMP system name or
 * description of its own - but the discovery scan of its address read them,
 * and a router's ARP table learned its MAC. The card shows each, saying which
 * scan or router read it, and when; a value saved on the device is never
 * replaced, and when discovery read something different that is shown under
 * it, in amber. What the device's own poll read carries no line: that is what
 * the page shows by default.
 *
 * Driven through the real page and the real CardModelDetail against a fake
 * getItem; the page's other cards are stubbed, each a story of its own.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const SCAN_ID: string = "33333333-3333-4333-8333-333333333333";
const ROUTER_ID: string = "44444444-4444-4444-8444-444444444444";

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

/*
 * jest.mock calls are hoisted above the imports below; the factories return
 * plain null components, so nothing they close over is read early.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInterfacesPreview",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceVendorTemplateBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceAttachmentCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil",
  () => {
    return {
      __esModule: true,
      default: {
        getDeviceMonitorContext: () => {
          return Promise.resolve({ monitors: [], isMonitorBacked: false });
        },
      },
    };
  },
);

import NetworkDeviceView from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/network-devices"),
  currentProject: null,
  hasPaymentMethod: false,
};

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function ago(milliseconds: number): string {
  return new Date(Date.now() - milliseconds).toISOString();
}

function scanReading(value: string, method: string): JSONObject {
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

function device(fields: Partial<NetworkDevice>): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice();
  value.id = new ObjectID(DEVICE_ID);
  value.projectId = new ObjectID(PROJECT_ID);
  value.name = "Register 4";
  value.hostname = "10.16.42.54";
  Object.assign(value, fields);
  return value;
}

async function renderOverview(item: NetworkDevice): Promise<void> {
  getItemMock.mockResolvedValue(item as never);

  render(<NetworkDeviceView {...pageProps} />);

  await waitFor((): void => {
    expect(screen.getAllByText("10.16.42.54").length).toBeGreaterThan(0);
  });
}

function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
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

  const path: string = `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}`;

  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the device Overview shows what discovery read, and which (issue #5185)", () => {
  test("a ping-only device: the names a scan read, each saying so", async () => {
    await renderOverview(
      device({
        discoveredDetails: {
          dnsName: scanReading("kds-04.store-24.acme.example", "reverseDns"),
          sysName: scanReading("kds-04", "snmp"),
          sysDescr: scanReading("Linux kds-04 5.15.0-91-generic", "snmp"),
        },
      }),
    );

    expect(screen.getByText("DNS Name")).toBeInTheDocument();
    expect(textOf("network-device-details-dnsName")).toContain(
      "kds-04.store-24.acme.example",
    );
    expect(textOf("network-device-details-dnsName-source")).toBe(
      "Discovery scan Store subnets (reverse DNS) · 2 hours ago",
    );

    expect(screen.getByText("System Name (sysName)")).toBeInTheDocument();
    expect(textOf("network-device-details-sysName-source")).toBe(
      "Discovery scan Store subnets (SNMP) · 2 hours ago",
    );
    expect(textOf("network-device-details-sysDescr")).toContain(
      "Linux kds-04 5.15.0-91-generic",
    );
  });

  test("a MAC learned from a router's ARP table says which router's, and when", async () => {
    await renderOverview(
      device({
        macAddress: "00:1b:54:c2:7a:01",
        isMacAddressLearned: true,
        discoveredDetails: { macAddress: arpReading("00:1b:54:c2:7a:01") },
      }),
    );

    expect(textOf("network-device-details-macAddress")).toContain(
      "00:1b:54:c2:7a:01",
    );
    expect(textOf("network-device-details-macAddress-source")).toBe(
      "ARP table of core-rtr-01 · 3 hours ago",
    );
  });

  test("a MAC someone typed is kept; an ARP table that disagrees is shown under it, in amber", async () => {
    await renderOverview(
      device({
        macAddress: "00:1b:54:c2:7a:01",
        isMacAddressLearned: false,
        discoveredDetails: { macAddress: arpReading("00:1b:54:c2:7a:02") },
      }),
    );

    expect(textOf("network-device-details-macAddress")).toContain(
      "00:1b:54:c2:7a:01",
    );
    expect(textOf("network-device-details-macAddress-source")).toBe(
      "Saved on this device",
    );
    const different: HTMLElement = screen.getByTestId(
      "network-device-details-macAddress-different",
    );
    expect(different).toHaveTextContent(
      "ARP table of core-rtr-01 says 00:1b:54:c2:7a:02 · 3 hours ago",
    );
    expect(different).toHaveClass("text-amber-700");
  });

  /*
   * What is saved on the device is what its own page shows, like its Name
   * and Hostname, which say nothing about where they came from (UI review):
   * "Saved on this device" is said only above what discovery read
   * differently.
   */
  test("a MAC and a DNS name typed on the device, which nothing disputes, carry no line", async () => {
    await renderOverview(
      device({
        macAddress: "00:1b:54:c2:7a:01",
        isMacAddressLearned: false,
        dnsName: "register-4.store-24.acme.example",
      }),
    );

    expect(textOf("network-device-details-macAddress")).toContain(
      "00:1b:54:c2:7a:01",
    );
    expect(textOf("network-device-details-dnsName")).toContain(
      "register-4.store-24.acme.example",
    );
    expect(
      screen.queryByTestId("network-device-details-macAddress-source"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-details-dnsName-source"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Saved on this device")).not.toBeInTheDocument();
  });

  test("the device's own poll is what the page shows by default: no line under it", async () => {
    await renderOverview(
      device({
        sysName: "core-sw-01",
        sysDescr: "Cisco IOS Software, Version 16.12.4",
        lastSnmpSeenAt: new Date(Date.now() - 3 * MINUTE),
      }),
    );

    expect(textOf("network-device-details-sysName")).toContain("core-sw-01");
    expect(
      screen.queryByTestId("network-device-details-sysName-source"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-details-sysDescr-source"),
    ).not.toBeInTheDocument();
  });

  test("a device nothing has read anything about shows none of the rows", async () => {
    await renderOverview(device({}));

    expect(screen.getByText("Register 4")).toBeInTheDocument();
    expect(screen.queryByText("DNS Name")).not.toBeInTheDocument();
    expect(screen.queryByText("MAC Address")).not.toBeInTheDocument();
    expect(screen.queryByText("System Name (sysName)")).not.toBeInTheDocument();
  });

  test("a sysName a scan read that is the device's name is not said twice", async () => {
    await renderOverview(
      device({
        name: "kds-04",
        discoveredDetails: { sysName: scanReading("kds-04", "snmp") },
      }),
    );

    expect(screen.queryByText("System Name (sysName)")).not.toBeInTheDocument();
  });

  test("the card asks for what discovery read, when the poll last read, and how the MAC was learned", async () => {
    await renderOverview(device({}));

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["discoveredDetails"]).toBe(true);
    expect(select["lastSnmpSeenAt"]).toBe(true);
    expect(select["isMacAddressLearned"]).toBe(true);
  });
});
