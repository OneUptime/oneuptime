import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import NetworkInventoryUtil, {
  NetworkDeviceDnsResolution,
  RESOLVED_ADDRESS_REFRESH_INTERVAL_IN_MS,
} from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import ProbeService from "../../../../Server/Services/ProbeService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The address a device polled at a DNS name resolved to (issue #5185). A
 * device registered by its name has no IP address of its own anywhere else;
 * its probe resolves the name on every poll, and the ping reports the address
 * it pinged. That address is recorded as the device's discovered IP address,
 * credited to the probe - only for the name the device is STILL polled at,
 * only when it is an address, and an unchanged one at most once an hour, on
 * the hottest write path in the product.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1c9d4a7b-0000-4000-8000-000000000011",
);
const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const PROBE_ID: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000001");
const NOW: Date = new Date("2026-10-23T10:00:00.000Z");

function deviceAt(
  hostname: string,
  discoveredDetails?: JSONObject,
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  device.hostname = hostname;
  if (discoveredDetails) {
    device.discoveredDetails = discoveredDetails;
  }
  return device;
}

function recordedAddress(value: string, readAt: Date): JSONObject {
  return {
    ipAddress: {
      value: value,
      method: "dns",
      readBy: {
        type: "probe",
        id: PROBE_ID.toString(),
        name: "Frankfurt probe",
      },
      readAt: readAt.toISOString(),
    },
  };
}

let mergeSpy: SpyInstance<typeof NetworkDeviceService.mergeDiscoveredDetails>;
let probeSpy: SpyInstance<typeof ProbeService.findOneById>;

function mockServices(probeName: string | null = "Frankfurt probe"): void {
  mergeSpy = jest
    .spyOn(NetworkDeviceService, "mergeDiscoveredDetails")
    .mockResolvedValue(1);

  const probe: Probe = new Probe();
  if (probeName) {
    probe.name = probeName;
  }
  probeSpy = jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probe as never);
}

// `null` for a poll with no probe to credit (an explicit undefined would take the default).
async function record(
  device: NetworkDevice,
  dnsResolution: NetworkDeviceDnsResolution | undefined,
  probeId: ObjectID | null = PROBE_ID,
): Promise<boolean> {
  return NetworkInventoryUtil.recordResolvedAddress({
    projectId: PROJECT_ID,
    device: device,
    probeId: probeId || undefined,
    dnsResolution: dnsResolution,
    now: NOW,
  });
}

function mergedEntry(): JSONObject {
  expect(mergeSpy).toHaveBeenCalledTimes(1);
  const input: {
    projectId: ObjectID;
    patches: Array<{ deviceId: unknown; set?: JSONObject }>;
  } = mergeSpy.mock.calls[0]![0] as never;
  expect(input.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(input.patches).toHaveLength(1);
  expect(String(input.patches[0]!.deviceId)).toBe(DEVICE_ID);
  return input.patches[0]!.set!["ipAddress"] as JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkInventoryUtil.recordResolvedAddress", () => {
  test("a device polled at a DNS name: the address it resolved to, credited to the probe", async () => {
    mockServices();

    const wrote: boolean = await record(deviceAt("core-fw-01.acme.example"), {
      hostname: "core-fw-01.acme.example",
      address: "10.0.0.1",
    });

    expect(wrote).toBe(true);
    expect(mergedEntry()).toEqual({
      value: "10.0.0.1",
      method: "dns",
      readBy: {
        type: "probe",
        id: PROBE_ID.toString(),
        name: "Frankfurt probe",
      },
      readAt: NOW.toISOString(),
    });
  });

  test("the name compares without case, the way DNS does", async () => {
    mockServices();

    expect(
      await record(deviceAt("Core-FW-01.acme.example"), {
        hostname: "core-fw-01.ACME.example",
        address: "2001:db8::1",
      }),
    ).toBe(true);
    expect(mergedEntry()["value"]).toBe("2001:db8::1");
  });

  test("a device polled at an address records nothing: that is its IP address already", async () => {
    mockServices();

    expect(
      await record(deviceAt("10.0.0.1"), {
        hostname: "10.0.0.1",
        address: "10.0.0.1",
      }),
    ).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a resolution of another name - a poll in flight across an address change - is not this device's", async () => {
    mockServices();

    expect(
      await record(deviceAt("new-fw.acme.example"), {
        hostname: "old-fw.acme.example",
        address: "10.0.0.9",
      }),
    ).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("an answer that is not an address is never recorded as one", async () => {
    mockServices();

    for (const address of [
      "core-fw-01.acme.example",
      "10.0.0",
      "",
      undefined,
    ]) {
      expect(
        await record(deviceAt("core-fw-01.acme.example"), {
          hostname: "core-fw-01.acme.example",
          address: address,
        }),
      ).toBe(false);
    }
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("no resolution, or no probe, records nothing", async () => {
    mockServices();

    expect(await record(deviceAt("core-fw-01.acme.example"), undefined)).toBe(
      false,
    );
    expect(
      await record(
        deviceAt("core-fw-01.acme.example"),
        { hostname: "core-fw-01.acme.example", address: "10.0.0.1" },
        null,
      ),
    ).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("the same address recorded within the hour is not written again - and the probe is not read", async () => {
    mockServices();

    const wrote: boolean = await record(
      deviceAt(
        "core-fw-01.acme.example",
        recordedAddress("10.0.0.1", new Date(NOW.getTime() - 10 * 60 * 1000)),
      ),
      { hostname: "core-fw-01.acme.example", address: "10.0.0.1" },
    );

    expect(wrote).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
    expect(probeSpy).not.toHaveBeenCalled();
  });

  test("the same address an hour later is written again, to keep its time true", async () => {
    mockServices();

    expect(
      await record(
        deviceAt(
          "core-fw-01.acme.example",
          recordedAddress(
            "10.0.0.1",
            new Date(NOW.getTime() - RESOLVED_ADDRESS_REFRESH_INTERVAL_IN_MS),
          ),
        ),
        { hostname: "core-fw-01.acme.example", address: "10.0.0.1" },
      ),
    ).toBe(true);
    expect(RESOLVED_ADDRESS_REFRESH_INTERVAL_IN_MS).toBe(60 * 60 * 1000);
  });

  test("a new address is written at once", async () => {
    mockServices();

    expect(
      await record(
        deviceAt(
          "core-fw-01.acme.example",
          recordedAddress("10.0.0.1", new Date(NOW.getTime() - 60 * 1000)),
        ),
        { hostname: "core-fw-01.acme.example", address: "10.0.0.2" },
      ),
    ).toBe(true);
    expect(mergedEntry()["value"]).toBe("10.0.0.2");
  });

  test("a probe whose name cannot be read is credited by its id alone", async () => {
    mockServices();
    probeSpy.mockRejectedValueOnce(new Error("connection reset"));

    expect(
      await record(deviceAt("core-fw-01.acme.example"), {
        hostname: "core-fw-01.acme.example",
        address: "10.0.0.1",
      }),
    ).toBe(true);
    expect(mergedEntry()["readBy"]).toEqual({
      type: "probe",
      id: PROBE_ID.toString(),
    });
  });
});

describe("the poll pipeline records it", () => {
  function mockPollServices(owned: NetworkDevice): void {
    jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue(owned);
    jest.spyOn(NetworkDeviceService, "updateOneById").mockResolvedValue(1);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
      .mockResolvedValue({ unmonitoredInterfaceIndexes: [] });
    jest
      .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
      .mockResolvedValue(undefined as never);
  }

  test("a ping-only poll of a DNS-named device records the address its ping resolved", async () => {
    mockServices();
    mockPollServices(deviceAt("core-fw-01.acme.example"));

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: undefined,
      isOnline: true,
      pollMode: "ping",
      probeId: PROBE_ID,
      dnsResolution: {
        hostname: "core-fw-01.acme.example",
        address: "10.0.0.1",
      },
    });

    expect(mergedEntry()["value"]).toBe("10.0.0.1");
  });

  test("the device read selects what the recording needs", async () => {
    mockServices();
    mockPollServices(deviceAt("core-fw-01.acme.example"));
    const findOneSpy: SpyInstance<typeof NetworkDeviceService.findOneBy> = jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(deviceAt("core-fw-01.acme.example"));

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: undefined,
      isOnline: true,
      pollMode: "ping",
    });

    const select: Record<string, unknown> = (
      findOneSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["hostname"]).toBe(true);
    expect(select["discoveredDetails"]).toBe(true);
    expect(select["name"]).toBe(true);
  });

  test("a failure to record never fails the poll", async () => {
    mockServices();
    mockPollServices(deviceAt("core-fw-01.acme.example"));
    mergeSpy.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      NetworkInventoryUtil.updateFromWalk({
        projectId: PROJECT_ID,
        deviceId: new ObjectID(DEVICE_ID),
        snmpResponse: undefined,
        isOnline: true,
        pollMode: "ping",
        probeId: PROBE_ID,
        dnsResolution: {
          hostname: "core-fw-01.acme.example",
          address: "10.0.0.1",
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("a poll with no resolution writes no reading", async () => {
    mockServices();
    mockPollServices(deviceAt("core-fw-01.acme.example"));

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: undefined,
      isOnline: false,
      pollMode: "ping",
      probeId: PROBE_ID,
    });

    expect(mergeSpy).not.toHaveBeenCalled();
  });
});
