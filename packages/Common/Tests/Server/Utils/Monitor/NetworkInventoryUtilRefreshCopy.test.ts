import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import * as InventoryEntityRegistry from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import NetworkDeviceMonitoringMethod from "../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Refresh: the first poll that lands after someone asked for a network
 * device to be read again copies the device's Inventory item at once
 * (InventoryEntityRegistry.mirrorInventoryRow), so its list columns, CSV
 * row and what a CMDB sync reads say what this poll read - not at the
 * mirror's next fifteen-minute pass. Only that poll; never for a device
 * nobody asked about; never at the cost of the poll.
 */

const PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000011";
const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const NOW: Date = new Date("2026-10-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

let deviceFindSpy: jest.SpyInstance;
let deviceUpdateSpy: jest.SpyInstance;
let mirrorSpy: jest.SpyInstance;

function mockServices(deviceOverrides: Partial<NetworkDevice> = {}): void {
  const ownedDevice: NetworkDevice = new NetworkDevice();
  ownedDevice.id = new ObjectID(DEVICE_ID);
  Object.assign(ownedDevice, deviceOverrides);

  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(ownedDevice);
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1);
  jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
    .mockResolvedValue({ unmonitoredInterfaceIndexes: [] });
  jest
    .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
    .mockResolvedValue(undefined as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  mirrorSpy = jest
    .spyOn(InventoryEntityRegistry, "mirrorInventoryRow")
    .mockResolvedValue("updated");
}

async function poll(): Promise<void> {
  await NetworkInventoryUtil.updateFromWalk({
    projectId: new ObjectID(PROJECT_ID),
    deviceId: new ObjectID(DEVICE_ID),
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 12,
      failureCause: "",
      oidResponses: [],
      systemInfo: { sysName: "core-sw-01" },
    },
    isOnline: true,
    pollMode: "snmp",
  });
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the first poll after a refresh copies the device's Inventory item", () => {
  test("asked for after the poll before it: copied, once, after the device row is written", async () => {
    mockServices({
      refreshRequestedAt: new Date(NOW.getTime() - MINUTE),
      lastPolledAt: new Date(NOW.getTime() - 5 * MINUTE),
    });

    await poll();

    expect(mirrorSpy).toHaveBeenCalledTimes(1);
    expect(mirrorSpy.mock.calls[0][0]).toEqual({
      resourceType: "NetworkDevice",
      resourceId: new ObjectID(DEVICE_ID),
    });
    // What this poll read is on the device before the copy reads it.
    expect(deviceUpdateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      mirrorSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("a device never polled before, asked to refresh: copied", async () => {
    mockServices({ refreshRequestedAt: new Date(NOW.getTime() - MINUTE) });

    await poll();

    expect(mirrorSpy).toHaveBeenCalledTimes(1);
  });

  test("the polls after it are not: the poll before them answered the ask", async () => {
    mockServices({
      refreshRequestedAt: new Date(NOW.getTime() - 6 * MINUTE),
      lastPolledAt: new Date(NOW.getTime() - 5 * MINUTE),
    });

    await poll();

    expect(mirrorSpy).not.toHaveBeenCalled();
  });

  test("a device nobody asked about is never copied by a poll", async () => {
    mockServices({ lastPolledAt: new Date(NOW.getTime() - 5 * MINUTE) });

    await poll();

    expect(mirrorSpy).not.toHaveBeenCalled();
  });

  test("a monitor-backed device's stray poll is not a refresh's answer", async () => {
    mockServices({
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      refreshRequestedAt: new Date(NOW.getTime() - MINUTE),
    });

    await poll();

    expect(mirrorSpy).not.toHaveBeenCalled();
  });

  test("a copy that fails never fails the poll", async () => {
    mockServices({ refreshRequestedAt: new Date(NOW.getTime() - MINUTE) });
    mirrorSpy.mockRejectedValue(new Error("Postgres is not answering"));

    await expect(poll()).resolves.toBeUndefined();
    expect(deviceUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test("the device is read with the two times the check needs", async () => {
    mockServices();

    await poll();

    const select: JSONObject = deviceFindSpy.mock.calls[0][0].select;
    expect(select["refreshRequestedAt"]).toBe(true);
    expect(select["lastPolledAt"]).toBe(true);
  });
});
