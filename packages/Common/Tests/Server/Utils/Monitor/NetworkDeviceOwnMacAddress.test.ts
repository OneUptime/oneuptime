import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  NetworkDeviceDiscoveredValue,
  readNetworkDeviceDiscoveredDetails,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The MAC of a device's own port, recorded from its walk (issue #5384). A
 * Meraki MX reads ifPhysAddress on every poll and read "MAC Address: Unknown"
 * all the same, because nothing kept it for the device: a device's MAC came
 * from a person, or from a walked router in front of it, and an MX is the
 * router. This is the hottest write path in the product, so a stable device
 * must not write at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1c9d4a7b-0000-4000-8000-000000000011",
);
const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const PROBE_ID: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000001");
const NOW: Date = new Date("2026-10-23T10:00:00.000Z");

const WAN_MAC: string = "aa:bb:cc:06:25:ed";

const MX_INTERFACES: Array<SnmpInterface> = [
  {
    interfaceIndex: 1,
    name: "wan1",
    macAddress: WAN_MAC,
    interfaceType: 6,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
  },
  {
    interfaceIndex: 2,
    name: "wan2",
    macAddress: "aa:bb:cc:06:25:ec",
    interfaceType: 6,
    isOperationallyUp: false,
    isAdministrativelyUp: true,
  },
];

function device(discoveredDetails?: JSONObject): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = new ObjectID(DEVICE_ID);
  row.hostname = "10.241.124.1";
  if (discoveredDetails) {
    row.discoveredDetails = discoveredDetails;
  }
  return row;
}

function recorded(
  value: string,
  readAt: string = "2026-10-01T00:00:00.000Z",
): JSONObject {
  return {
    ownMacAddress: {
      value: value,
      method: "snmp",
      readBy: { type: "probe", id: PROBE_ID.toString() },
      readAt: readAt,
    },
  };
}

let mergeSpy: SpyInstance<typeof NetworkDeviceService.mergeDiscoveredDetails>;
let updateSpy: SpyInstance<typeof NetworkDeviceService.updateOneById>;
let pollVerdictSpy: SpyInstance<typeof NetworkDeviceService.writePollVerdict>;

function mockMerge(): void {
  mergeSpy = jest
    .spyOn(NetworkDeviceService, "mergeDiscoveredDetails")
    .mockResolvedValue(1);
}

function mockPollServices(owned: NetworkDevice): void {
  mockMerge();
  jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue(owned);
  updateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1 as never);
  pollVerdictSpy = jest
    .spyOn(NetworkDeviceService, "writePollVerdict")
    .mockResolvedValue(true);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
    .mockResolvedValue({ unmonitoredInterfaceIndexes: [] });
  jest
    .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
    .mockResolvedValue(undefined as never);
}

function walk(
  overrides: Partial<SnmpMonitorResponse> = {},
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    oidResponses: [],
    interfaces: MX_INTERFACES,
    ...overrides,
  };
}

function poll(
  snmpResponse: SnmpMonitorResponse | undefined,
  probeId: ObjectID | undefined = PROBE_ID,
): Promise<void> {
  return NetworkInventoryUtil.updateFromWalk({
    projectId: PROJECT_ID,
    deviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    isOnline: true,
    pollMode: snmpResponse ? "snmp" : "ping",
    probeId: probeId,
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
  return input.patches[0]!.set!["ownMacAddress"] as JSONObject;
}

function record(row: NetworkDevice, probeId?: ObjectID): Promise<boolean> {
  return NetworkInventoryUtil.recordOwnMacAddress({
    projectId: PROJECT_ID,
    device: row,
    probeId: probeId,
    interfaces: MX_INTERFACES,
    now: NOW,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkInventoryUtil.recordOwnMacAddress", () => {
  test("the first read of it is written, credited to the probe", async () => {
    mockMerge();

    expect(await record(device(), PROBE_ID)).toBe(true);
    expect(mergedEntry()).toEqual({
      value: WAN_MAC,
      method: "snmp",
      readBy: { type: "probe", id: PROBE_ID.toString() },
      readAt: NOW.toISOString(),
    });
  });

  test("what it writes reads back as the device's", async () => {
    mockMerge();

    await record(device(), PROBE_ID);

    const entry: NetworkDeviceDiscoveredValue | undefined =
      readNetworkDeviceDiscoveredDetails({ ownMacAddress: mergedEntry() })
        .values.ownMacAddress;

    expect(entry?.value).toBe(WAN_MAC);
  });

  test("an unchanged port writes nothing, however long ago it was read", async () => {
    mockMerge();

    expect(await record(device(recorded(WAN_MAC)), PROBE_ID)).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a swapped box writes the new port at once", async () => {
    mockMerge();

    expect(await record(device(recorded("00:18:0a:00:00:01")), PROBE_ID)).toBe(
      true,
    );
    expect(mergedEntry()["value"]).toBe(WAN_MAC);
  });

  /*
   * A poll processed after a newer one - a retried job, or one that waited
   * longer in the queue (issue #7389) - read the port before the reading on
   * record was taken. It does not put its MAC back over that reading.
   */
  test("a reading taken after this poll's stands: an older poll does not put its MAC back", async () => {
    mockMerge();

    expect(
      await record(
        device(recorded("00:18:0a:00:00:01", "2026-10-23T10:05:00.000Z")),
        PROBE_ID,
      ),
    ).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a reading taken at this very poll's time is replaced only if it differs, as any older one is", async () => {
    mockMerge();

    expect(
      await record(
        device(recorded("00:18:0a:00:00:01", NOW.toISOString())),
        PROBE_ID,
      ),
    ).toBe(true);
    expect(mergedEntry()["value"]).toBe(WAN_MAC);
  });

  test("another writer's keys are left to them: it sets only its own", async () => {
    mockMerge();

    await record(
      device({
        macAddress: {
          value: "00:18:0a:00:00:09",
          method: "arpTable",
          readBy: { type: "networkDevice", id: DEVICE_ID, name: "core-rtr-01" },
          readAt: "2026-10-01T00:00:00.000Z",
        },
      }),
      PROBE_ID,
    );

    const input: { patches: Array<{ set?: JSONObject; unset?: unknown }> } =
      mergeSpy.mock.calls[0]![0] as never;

    expect(Object.keys(input.patches[0]!.set!)).toEqual(["ownMacAddress"]);
    expect(input.patches[0]!.unset).toBeUndefined();
  });

  test("no probe to credit, no device id, or nothing usable records nothing", async () => {
    mockMerge();

    expect(await record(device())).toBe(false);

    const nameless: NetworkDevice = new NetworkDevice();
    expect(await record(nameless, PROBE_ID)).toBe(false);

    expect(
      await NetworkInventoryUtil.recordOwnMacAddress({
        projectId: PROJECT_ID,
        device: device(),
        probeId: PROBE_ID,
        interfaces: [
          {
            interfaceIndex: 1,
            name: "lo",
            interfaceType: 24,
            isOperationallyUp: true,
            isAdministrativelyUp: true,
          },
        ],
        now: NOW,
      }),
    ).toBe(false);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  /*
   * OneUptime issue #7194. The merge never waits for the device: held by
   * another writer (its claim, a router's ARP readings), it is left as it
   * is, and the next poll - reading the same port against the same old
   * record - writes it then. Waiting here held up the poll, and a wait past
   * lock_timeout failed it.
   */
  test("never waits for a device another writer holds, and says it wrote nothing", async () => {
    mockMerge();
    // The merge skipped the device: written to none.
    mergeSpy.mockResolvedValueOnce(0);

    expect(await record(device(), PROBE_ID)).toBe(false);

    const input: { skipLockedDevices?: boolean } = mergeSpy.mock
      .calls[0]![0] as never;

    expect(input.skipLockedDevices).toBe(true);
  });

  test("written, it says so", async () => {
    mockMerge();

    expect(await record(device(), PROBE_ID)).toBe(true);
    expect(
      (mergeSpy.mock.calls[0]![0] as { skipLockedDevices?: boolean })
        .skipLockedDevices,
    ).toBe(true);
  });
});

describe("the poll pipeline records it", () => {
  test("a successful walk of the MX in the issue", async () => {
    mockPollServices(device());

    await poll(walk());

    expect(mergedEntry()["value"]).toBe(WAN_MAC);
  });

  test("the device's MAC column is left alone: it holds what someone typed, or an ARP table's", async () => {
    mockPollServices(device());

    await poll(walk());

    // The poll's own writes to the device: its verdict, and any enrichment.
    expect(pollVerdictSpy).toHaveBeenCalledTimes(1);
    expect(pollVerdictSpy.mock.calls[0]![0].verdict).not.toHaveProperty(
      "macAddress",
    );

    for (const call of updateSpy.mock.calls) {
      const update: { data: Record<string, unknown> } = call[0] as never;

      expect(update.data).not.toHaveProperty("macAddress");
      expect(update.data).not.toHaveProperty("isMacAddressLearned");
    }
  });

  test("a walk whose response was pruned to monitored ports still reads the port it read first", async () => {
    mockPollServices(device());
    jest
      .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
      .mockResolvedValue({ unmonitoredInterfaceIndexes: [1] });

    await poll(walk());

    expect(mergedEntry()["value"]).toBe(WAN_MAC);
  });

  test("a monitor-backed device records it too: it is inventory, not health", async () => {
    const backed: NetworkDevice = device();
    backed.monitoringMethod = "Monitor" as never;
    mockPollServices(backed);

    await poll(walk());

    expect(mergedEntry()["value"]).toBe(WAN_MAC);
  });

  test("a stable device writes nothing on the hottest path in the product", async () => {
    mockPollServices(device(recorded(WAN_MAC)));

    for (let round: number = 0; round < 5; round++) {
      await poll(walk());
    }

    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a walk that failed carries no interfaces to read", async () => {
    mockPollServices(device());

    await poll(walk({ isOnline: false, interfaces: MX_INTERFACES }));

    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a ping-only poll has none either", async () => {
    mockPollServices(device());

    await poll(undefined);

    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a walk with no interface table keeps the port recorded before", async () => {
    mockPollServices(device(recorded(WAN_MAC)));

    await poll(walk({ interfaces: undefined }));

    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a failure to record never fails the poll", async () => {
    mockPollServices(device());
    mergeSpy.mockRejectedValueOnce(new Error("connection reset"));

    await expect(poll(walk())).resolves.toBeUndefined();
  });

  test("a poll with no probe to credit records nothing and still polls", async () => {
    mockPollServices(device());

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: walk(),
      isOnline: true,
      pollMode: "snmp",
    });

    expect(pollVerdictSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy).not.toHaveBeenCalled();
  });

  test("a poll is credited with its receipt time, not the time a worker got to it", async () => {
    mockPollServices(device());

    // Received ten minutes before NOW, and processed weeks after it.
    const receivedAt: Date = new Date(NOW.getTime() - 10 * 60 * 1000);

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: walk(),
      isOnline: true,
      pollMode: "snmp",
      probeId: PROBE_ID,
      receivedAt: receivedAt,
    });

    expect(mergedEntry()["readAt"]).toBe(receivedAt.toISOString());
  });
});
