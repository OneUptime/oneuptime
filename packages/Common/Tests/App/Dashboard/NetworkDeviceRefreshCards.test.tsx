import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Refresh (OneUptime issue #5185: "Inventory should support refreshing
 * discovered information as devices and network details change"), drawn
 * for real on the two cards that show a network device's details:
 * Inventory's Asset Details card and the device's own Inventory card.
 *
 * Offered to whoever may edit network devices, for a device something
 * reads on its own. Pressing it asks the server once, says who reads the
 * device again, follows the device until they have, and says how it went -
 * read again, unreachable, late, or why it could not be asked. A refresh
 * asked for before the card opened shows as under way.
 *
 * The network is replaced: ModelAPI for the device, API.post for the ask.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../UI/Utils/API/API",
  ) as { default: Record<string, unknown> };

  return {
    __esModule: true,
    default: {
      ...actual.default,
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

import InventoryAssetDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard";
import DeviceInventoryCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import { getNetworkDeviceRefreshPath } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/NetworkDeviceRefreshApi";
import { REFRESH_FOLLOW_INTERVAL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/NetworkDeviceRefreshWords";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import URL from "../../../Types/API/URL";
import { APP_API_URL } from "../../../UI/Config";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

const ITEM_ID: string = "40000000-0000-4000-8000-000000000003";
const DEVICE_ID: string = "50000000-0000-4000-8000-000000000003";
const PROBE_ID: string = "30000000-0000-4000-8000-000000000003";
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

function ago(milliseconds: number): string {
  return new Date(Date.now() - milliseconds).toISOString();
}

// A switch its probe walks every five minutes.
function polledSwitch(fields: Record<string, unknown> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  Object.assign(device, {
    name: "core-sw-01",
    hostname: "10.20.0.1",
    sysName: "core-sw-01",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    probeId: new ObjectID(PROBE_ID),
    isPollingEnabled: true,
    monitoringMethod: "Probe",
    lastSnmpSeenAt: new Date(Date.now() - 4 * MINUTE),
    lastPolledAt: new Date(Date.now() - 4 * MINUTE),
    isReachable: true,
    ...fields,
  });
  return device;
}

function mirroredItem(): InventoryItem {
  const model: InventoryItem = new InventoryItem();
  model._id = ITEM_ID;
  Object.assign(model, {
    entityType: EntityType.NetworkDevice,
    source: EntitySource.Inventory,
    resourceType: "NetworkDevice",
    resourceId: DEVICE_ID,
    displayName: "core-sw-01",
    descriptiveAttributes: { "host.ip": "10.20.0.1" },
  });
  return model;
}

function hostItem(): InventoryItem {
  const model: InventoryItem = new InventoryItem();
  model._id = ITEM_ID;
  Object.assign(model, {
    entityType: EntityType.Host,
    source: EntitySource.Discovered,
    displayName: "web-01",
    identifyingAttributes: { "host.name": "web-01" },
    descriptiveAttributes: { "os.type": "linux" },
  });
  return model;
}

// What the server answers an ask with, the probe named.
function probeAnswer(requestedAt: string): JSONObject {
  return {
    requestedAt: requestedAt,
    isProbeReading: true,
    probeName: "Branch probe",
    isControllerReading: false,
    wasAlreadyRequested: false,
  };
}

function servePost(data: JSONObject): void {
  apiPostMock.mockResolvedValue({ data: data } as never);
}

// The device, then the device as each later read finds it.
function serveDevices(...devices: Array<NetworkDevice>): void {
  let served: number = 0;

  getItemMock.mockImplementation((async () => {
    const device: NetworkDevice =
      devices[Math.min(served, devices.length - 1)]!;
    served++;
    return device;
  }) as never);
}

function refreshButton(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

// What the Meraki dashboard says about the switch, read by Acme Retail.
function merakiReading(readAt: string): JSONObject {
  return {
    provider: "meraki",
    readBy: {
      type: "networkController",
      id: CONNECTION_ID,
      name: "Acme Retail",
    },
    readAt: readAt,
    values: {
      model: "MS225-48LP",
      serialNumber: "Q2HP-SWCH-0001",
      firmwareVersion: "switch-16-7",
      networkName: "Branch 12",
    },
  };
}

// The device reads, of every read the cards made.
function deviceReads(): number {
  return getItemMock.mock.calls.length;
}

// The project's role lists, of every list the cards read.
function roleLists(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType?: { name?: string } }).modelType?.name ===
      "NetworkDeviceRole"
    );
  }).length;
}

function statusOf(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  apiPostMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectMember]);
});

afterEach((): void => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Inventory's Asset Details card: Refresh", () => {
  const BUTTON: string = "inventory-asset-details-refresh";
  const STATUS: string = "inventory-asset-details-refresh-status";

  test("offered for a device its probe polls, to whoever may edit network devices", async () => {
    serveDevices(polledSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toHaveTextContent("Refresh");
    });
    // Nothing is said before anyone presses it.
    expect(screen.queryByTestId(STATUS)).toBeNull();
  });

  test("not offered to a reader who may only read network devices", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadNetworkDevice]);
    serveDevices(polledSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });
    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-manufacturer-value"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId(BUTTON)).toBeNull();
  });

  test.each([
    ["monitor-backed", { monitoringMethod: "Monitor" }],
    ["polled by no probe", { probeId: undefined }],
    ["with polling turned off", { isPollingEnabled: false }],
  ])(
    "not offered for a device %s, which nothing reads on its own",
    async (_: string, fields: Record<string, unknown>) => {
      serveDevices(polledSwitch(fields));

      render(<InventoryAssetDetailsCard item={mirroredItem()} />);

      await waitFor((): void => {
        expect(
          screen.getByTestId("inventory-asset-manufacturer-value"),
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId(BUTTON)).toBeNull();
    },
  );

  test("a monitor-backed device a Meraki connection describes is refreshed through Meraki", async () => {
    serveDevices(
      polledSwitch({
        monitoringMethod: "Monitor",
        discoveredDetails: {
          controller: {
            provider: "meraki",
            readBy: {
              type: "networkController",
              id: CONNECTION_ID,
              name: "Acme Retail",
            },
            readAt: ago(20 * MINUTE),
            values: { model: "MS225-48LP" },
          },
        },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });
  });

  test("not offered on a host's card", async () => {
    render(<InventoryAssetDetailsCard item={hostItem()} />);

    expect(screen.getByTestId("inventory-asset-details")).toBeInTheDocument();
    expect(screen.queryByTestId(BUTTON)).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("pressed: the server is asked once, and the card says its probe reads it again within a minute", async () => {
    const askedAt: string = new Date().toISOString();
    servePost(probeAnswer(askedAt));
    serveDevices(polledSwitch(), polledSwitch({ refreshRequestedAt: askedAt }));

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toHaveTextContent("Refresh");
    });

    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent(
        "Its probe reads it again within a minute.",
      );
    });
    expect(statusOf(STATUS)).toHaveAttribute("data-tone", "progress");
    expect(statusOf(STATUS)).toHaveAttribute("role", "status");
    /*
     * Greyed and turning, under the same word: "Refreshing…" is wider in
     * most languages, and pushed the button under the title on a phone.
     */
    expect(refreshButton(BUTTON)).toHaveTextContent(/^Refresh$/);
    expect(refreshButton(BUTTON)).toBeDisabled();
    expect(refreshButton(BUTTON).querySelector(".animate-spin")).not.toBeNull();
    /*
     * One spinner: the button's. The line under it waits with a still
     * clock rather than a second turning arrow.
     */
    expect(statusOf(STATUS).querySelector(".animate-spin")).toBeNull();
    expect(
      statusOf(STATUS).querySelector('[class*="motion-safe:animate-spin"]'),
    ).toBeNull();
    expect(statusOf(STATUS).querySelector("svg")).not.toBeNull();

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const call: { url: { toString: () => string }; data: JSONObject } =
      apiPostMock.mock.calls[0]![0] as never;
    expect(call.url.toString()).toBe(
      URL.fromString(APP_API_URL.toString())
        .addRoute(getNetworkDeviceRefreshPath(DEVICE_ID))
        .toString(),
    );
    expect(call.data).toEqual({});
  });

  test("followed every few seconds until its probe's poll lands: read again, and the page told once", async () => {
    jest.useFakeTimers();
    const askedAt: string = new Date().toISOString();
    const onRefreshed: MockFunction = getJestMockFunction();
    servePost(probeAnswer(askedAt));
    serveDevices(
      polledSwitch(),
      polledSwitch({ refreshRequestedAt: askedAt }),
      polledSwitch({
        refreshRequestedAt: askedAt,
        lastPolledAt: new Date(Date.parse(askedAt) + 20 * SECOND),
        firmwareVersion: "17.9.4",
      }),
    );

    render(
      <InventoryAssetDetailsCard
        item={mirroredItem()}
        onRefreshed={onRefreshed}
      />,
    );

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });

    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveAttribute("data-tone", "progress");
    });
    expect(onRefreshed).not.toHaveBeenCalled();

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(REFRESH_FOLLOW_INTERVAL_MS);
    });

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent("Read again just now.");
    });
    expect(statusOf(STATUS)).toHaveAttribute("data-tone", "done");
    expect(
      screen.getByTestId("inventory-asset-firmwareVersion-value"),
    ).toHaveTextContent("17.9.4");
    expect(refreshButton(BUTTON)).toHaveTextContent("Refresh");
    expect(refreshButton(BUTTON)).not.toBeDisabled();
    expect(onRefreshed).toHaveBeenCalledTimes(1);

    // Nothing more is read once it is done.
    const reads: number = getItemMock.mock.calls.length;
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(3 * REFRESH_FOLLOW_INTERVAL_MS);
    });
    expect(getItemMock.mock.calls.length).toBe(reads);
    expect(onRefreshed).toHaveBeenCalledTimes(1);
  });

  test("a read that fails while it follows the device keeps Refresh and the line, and the next read finishes it", async () => {
    jest.useFakeTimers();
    const askedAt: string = new Date().toISOString();
    servePost(probeAnswer(askedAt));

    let served: number = 0;
    getItemMock.mockImplementation((async () => {
      served++;

      if (served === 1) {
        return polledSwitch();
      }

      if (served === 2) {
        throw new Error("The network dropped the read.");
      }

      return polledSwitch({
        refreshRequestedAt: askedAt,
        lastPolledAt: new Date(Date.parse(askedAt) + 20 * SECOND),
      });
    }) as never);

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });

    fireEvent.click(refreshButton(BUTTON));

    // The read right after the ask failed: the card stays as it was.
    await waitFor((): void => {
      expect(served).toBe(2);
    });
    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveAttribute("data-tone", "progress");
    });
    expect(refreshButton(BUTTON)).toBeDisabled();
    expect(
      screen.getByTestId("inventory-asset-manufacturer-value"),
    ).toHaveTextContent("Cisco");

    // It keeps following, and the next read lands the refresh.
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(REFRESH_FOLLOW_INTERVAL_MS);
    });

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent("Read again just now.");
    });
    expect(refreshButton(BUTTON)).toHaveTextContent("Refresh");
  });

  test("following the device reads the device alone: the project's roles are read once", async () => {
    jest.useFakeTimers();
    const askedAt: string = new Date().toISOString();
    servePost(probeAnswer(askedAt));
    serveDevices(
      polledSwitch(),
      polledSwitch({ refreshRequestedAt: askedAt }),
      polledSwitch({ refreshRequestedAt: askedAt }),
      polledSwitch({ refreshRequestedAt: askedAt }),
      polledSwitch({
        refreshRequestedAt: askedAt,
        lastPolledAt: new Date(Date.parse(askedAt) + 40 * SECOND),
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });
    expect(roleLists()).toBe(1);

    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveAttribute("data-tone", "progress");
    });

    for (let tick: number = 0; tick < 3; tick++) {
      await act(async (): Promise<void> => {
        jest.advanceTimersByTime(REFRESH_FOLLOW_INTERVAL_MS);
      });
    }

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent("Read again just now.");
    });
    // The device four more times; its roles never again.
    expect(deviceReads()).toBeGreaterThanOrEqual(4);
    expect(roleLists()).toBe(1);
  });

  test("its probe could not reach it: said in amber, the details as last read", async () => {
    const askedAt: string = new Date().toISOString();
    servePost(probeAnswer(askedAt));
    serveDevices(
      polledSwitch(),
      polledSwitch({
        refreshRequestedAt: askedAt,
        lastPolledAt: new Date(Date.parse(askedAt) + 15 * SECOND),
        isReachable: false,
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });
    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent(
        "Its probe could not reach it just now. Its details are as it last read them.",
      );
    });
    expect(statusOf(STATUS)).toHaveAttribute("data-tone", "warning");
    expect(statusOf(STATUS)).toHaveClass("text-amber-700");
  });

  test("its probe has not read it in the time a read takes: names the probe to check", async () => {
    const askedAt: string = ago(4 * MINUTE);
    const polledBefore: Date = new Date(Date.now() - 10 * MINUTE);
    servePost(probeAnswer(askedAt));
    serveDevices(
      polledSwitch({ lastPolledAt: polledBefore }),
      polledSwitch({ refreshRequestedAt: askedAt, lastPolledAt: polledBefore }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });
    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent(
        "Its probe (Branch probe) has not read it yet. Check that the probe is online.",
      );
    });
    expect(refreshButton(BUTTON)).not.toBeDisabled();
  });

  test("refused: the server's reason, in red, and the button ready again", async () => {
    apiPostMock.mockRejectedValue(
      new Error(
        "Polling is turned off for this device. Turn it on in the device's Settings to read it again.",
      ) as never,
    );
    serveDevices(polledSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toBeInTheDocument();
    });
    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent(
        "Polling is turned off for this device.",
      );
    });
    expect(statusOf(STATUS)).toHaveAttribute("role", "alert");
    expect(statusOf(STATUS)).toHaveAttribute("data-tone", "error");
    expect(refreshButton(BUTTON)).not.toBeDisabled();
  });

  test("a device the Meraki dashboard describes: its unknown details name the dashboard too", async () => {
    serveDevices(
      polledSwitch({
        vendor: undefined,
        deviceModel: undefined,
        discoveredDetails: { controller: merakiReading(ago(20 * MINUTE)) },
      }),
    );

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-details-unknown"),
      ).toHaveTextContent(
        "neither this device's SNMP poll, the Meraki dashboard nor a discovery scan has found",
      );
    });
  });

  test("a device the Meraki dashboard does not describe: its unknown details name the poll and the scans", async () => {
    serveDevices(polledSwitch());

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("inventory-asset-details-unknown"),
      ).toHaveTextContent(
        "neither this device's SNMP poll nor a discovery scan has found",
      );
    });
    expect(
      screen.getByTestId("inventory-asset-details-unknown"),
    ).not.toHaveTextContent("Meraki");
  });

  test("a refresh asked for before the card opened shows as under way", async () => {
    serveDevices(polledSwitch({ refreshRequestedAt: ago(20 * SECOND) }));

    render(<InventoryAssetDetailsCard item={mirroredItem()} />);

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent(
        "Its probe reads it again within a minute.",
      );
    });
    expect(refreshButton(BUTTON)).toHaveTextContent(/^Refresh$/);
    expect(refreshButton(BUTTON)).toBeDisabled();
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe("the device's Inventory card: Refresh, and what Meraki says", () => {
  const BUTTON: string = "device-inventory-refresh";
  const STATUS: string = "device-inventory-refresh-status";

  test("offered, followed and said in the card's first row", async () => {
    const askedAt: string = new Date().toISOString();
    servePost(probeAnswer(askedAt));
    serveDevices(
      polledSwitch(),
      polledSwitch({
        refreshRequestedAt: askedAt,
        lastPolledAt: new Date(Date.parse(askedAt) + 10 * SECOND),
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(refreshButton(BUTTON)).toHaveTextContent("Refresh");
    });
    expect(screen.queryByTestId(STATUS)).toBeNull();

    fireEvent.click(refreshButton(BUTTON));

    await waitFor((): void => {
      expect(statusOf(STATUS)).toHaveTextContent("Read again just now.");
    });
    // The device was read again with what Refresh follows.
    const lastRead: { select: JSONObject } = getItemMock.mock.calls[
      getItemMock.mock.calls.length - 1
    ]![0] as never;
    for (const column of [
      "probeId",
      "isPollingEnabled",
      "monitoringMethod",
      "refreshRequestedAt",
      "lastPolledAt",
      "isReachable",
    ]) {
      expect({ column, selected: lastRead.select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("not offered to a reader who may only read network devices", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadNetworkDevice]);
    serveDevices(polledSwitch());

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId(BUTTON)).toBeNull();
  });

  test("a device Meraki describes: when it was read, and its Meraki network, in a row of its own", async () => {
    serveDevices(
      polledSwitch({
        vendor: undefined,
        deviceModel: undefined,
        lastSnmpSeenAt: undefined,
        discoveredDetails: {
          controller: {
            provider: "meraki",
            readBy: {
              type: "networkController",
              id: CONNECTION_ID,
              name: "Acme Retail",
            },
            readAt: ago(20 * MINUTE),
            values: {
              model: "MS225-48LP",
              serialNumber: "Q2HP-SWCH-0001",
              firmwareVersion: "switch-16-7",
              networkName: "Branch 12",
            },
          },
        },
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(
        screen.getByTestId("device-inventory-controller-source"),
      ).toHaveTextContent(
        "Read from the Meraki dashboard (Acme Retail), 20 minutes ago.",
      );
    });
    expect(
      screen.getByTestId("device-inventory-controller-network"),
    ).toHaveTextContent("In the Branch 12 network.");
    expect(screen.getByTestId("device-inventory-model")).toHaveTextContent(
      "MS225-48LP",
    );
    expect(screen.getByTestId("device-inventory-serial")).toHaveTextContent(
      "Q2HP-SWCH-0001",
    );
    // Said once, in its row, not under each value it gave.
    expect(screen.queryByTestId("device-inventory-model-source")).toBeNull();
    expect(screen.queryByTestId("device-inventory-serial-source")).toBeNull();
  });

  test("a device Meraki does not describe has no Meraki row", async () => {
    serveDevices(polledSwitch());

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByTestId("device-inventory-model")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("device-inventory-controller-source"),
    ).toBeNull();
    // Its details come from its own poll and discovery, and the card says so.
    expect(
      screen.getByText(
        "Hardware, software and location details from this device's SNMP poll and from discovery.",
      ),
    ).toBeInTheDocument();
  });

  test("a device Meraki describes: the card says its details come from the Meraki dashboard too", async () => {
    serveDevices(
      polledSwitch({
        vendor: undefined,
        deviceModel: undefined,
        discoveredDetails: { controller: merakiReading(ago(20 * MINUTE)) },
      }),
    );

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(
        screen.getByText(
          "Hardware, software and location details from this device's SNMP poll, from discovery and from the Meraki dashboard.",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(
        "Hardware, software and location details from this device's SNMP poll and from discovery.",
      ),
    ).toBeNull();
  });
});
