import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService, {
  InterfaceWalkUpsertResult,
} from "../../../../Server/Services/NetworkInterfaceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import LldpNeighbor from "../../../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../../../Types/Monitor/SnmpMonitor/CdpNeighbor";
import SnmpOid from "../../../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

/*
 * NetworkInventoryUtil.updateFromWalk is the single writer that keeps the
 * NetworkDevice / NetworkInterface inventory in sync with each SNMP
 * interface walk. Under device-owned polling it is called straight from the
 * device polling pipeline with the device's own identity — no Monitor in
 * between. These tests mock the services it writes through and pin the
 * enrichment contract: which walked fields land on the device row (and at
 * what column-limit truncation), how uptime becomes lastRebootedAt, how the
 * vendor is chosen, the LLDP/CDP snapshot semantics (store-even-when-empty,
 * capped), what flows into the interface upsert on both the update and
 * create paths, and when endpoint discovery runs.
 */

const PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000011";
const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");

const CISCO_SYS_OBJECT_ID: string = "1.3.6.1.4.1.9.1.1208";

type DeviceUpdatePayload = Record<string, unknown>;

let deviceFindSpy: jest.SpyInstance;
let deviceUpdateSpy: jest.SpyInstance;
let interfaceFindSpy: jest.SpyInstance;
let interfaceUpsertSpy: jest.SpyInstance;
let endpointUpsertSpy: jest.SpyInstance;

function mockServices(
  existingInterfaces: Array<NetworkInterface> = [],
  deviceOverrides: Partial<NetworkDevice> = {},
): void {
  /*
   * The project-membership guard resolves the device (scoped to the given
   * project) before any write; return a matching device so the write path
   * runs. The cross-project-refusal case overrides this to null.
   * deviceOverrides seeds the columns the vendor-template auto-apply reads
   * (autoApplyVendorHealthTemplate, snmpOids) — absent by default, exactly
   * like a device that never opted in.
   */
  const ownedDevice: NetworkDevice = new NetworkDevice();
  ownedDevice.id = new ObjectID(DEVICE_ID);
  Object.assign(ownedDevice, deviceOverrides);
  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(ownedDevice);
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1);
  /*
   * The inventory read now happens INSIDE the batched service call, so this
   * stub only exists to keep a stray direct read from reaching a database.
   */
  interfaceFindSpy = jest
    .spyOn(NetworkInterfaceService, "findBy")
    .mockResolvedValue(existingInterfaces);
  /*
   * Interfaces are written by one batched service call now (one SELECT plus
   * one INSERT/UPDATE per 500 rows) instead of a create()/updateOneById() per
   * port. The column-by-column contract is pinned in
   * Tests/Utils/Monitor/InterfaceInventoryUtil.test.ts and the SQL in
   * Tests/Server/Services/NetworkInterfaceServiceUpsert.test.ts; this stub
   * reproduces the one part of the contract this util depends on — which
   * walked indexes come back reported as muted — so the response-pruning
   * tests below still exercise the whole seam.
   */
  interfaceUpsertSpy = jest
    .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
    .mockImplementation(
      async (input: {
        projectId: ObjectID;
        deviceId: ObjectID;
        walkedInterfaces: Array<SnmpInterface>;
        now: Date;
      }): Promise<InterfaceWalkUpsertResult> => {
        const mutedIndexes: Set<number> = new Set(
          existingInterfaces
            .filter((row: NetworkInterface) => {
              return row.isMonitored === false;
            })
            .map((row: NetworkInterface) => {
              return row.interfaceIndex!;
            }),
        );

        return {
          unmonitoredInterfaceIndexes: input.walkedInterfaces
            .map((walked: SnmpInterface) => {
              return walked.interfaceIndex;
            })
            .filter((interfaceIndex: number) => {
              return mutedIndexes.has(interfaceIndex);
            }),
        };
      },
    );
  endpointUpsertSpy = jest
    .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
    .mockResolvedValue(undefined as never);
}

function deviceUpdatePayload(): DeviceUpdatePayload {
  expect(deviceUpdateSpy).toHaveBeenCalledTimes(1);
  return deviceUpdateSpy.mock.calls[0][0].data as DeviceUpdatePayload;
}

function buildSnmpResponse(
  snmpFields?: Partial<SnmpMonitorResponse>,
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    oidResponses: [],
    ...snmpFields,
  };
}

function walkedInterface(overrides?: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

function existingInterface(interfaceIndex: number): NetworkInterface {
  const row: NetworkInterface = new NetworkInterface();
  row._id = "9a1b2c3d-0000-4000-8000-0000000000bb";
  row.interfaceIndex = interfaceIndex;
  row.isMonitored = true;
  return row;
}

async function runWalk(
  snmpFields?: Partial<SnmpMonitorResponse>,
  options?: { isOnline?: boolean | undefined },
): Promise<SnmpMonitorResponse> {
  const snmpResponse: SnmpMonitorResponse = buildSnmpResponse(snmpFields);

  await NetworkInventoryUtil.updateFromWalk({
    projectId: new ObjectID(PROJECT_ID),
    deviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    isOnline: options && "isOnline" in options ? options.isOnline : true,
  });

  return snmpResponse;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkInventoryUtil.updateFromWalk — system group enrichment", () => {
  test("system fields are persisted with their column-limit truncation", async () => {
    mockServices();

    const longDescr: string = "d".repeat(600);
    const longField: string = "x".repeat(150);

    await runWalk({
      systemInfo: {
        sysDescr: longDescr,
        sysName: longField,
        sysObjectId: longField,
        sysLocation: longField,
        sysContact: longField,
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["sysDescr"]).toBe(longDescr.substring(0, 500));
    expect((update["sysDescr"] as string).length).toBe(500);
    for (const field of [
      "sysName",
      "sysObjectId",
      "sysLocation",
      "sysContact",
    ]) {
      expect(update[field]).toBe(longField.substring(0, 100));
      expect((update[field] as string).length).toBe(100);
    }
  });

  test("short system fields are persisted verbatim", async () => {
    mockServices();

    await runWalk({
      systemInfo: {
        sysDescr: "Cisco IOS Software, C2960X",
        sysName: "core-sw-01",
        sysObjectId: CISCO_SYS_OBJECT_ID,
        sysLocation: "rack 12",
        sysContact: "netops@example.com",
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["sysDescr"]).toBe("Cisco IOS Software, C2960X");
    expect(update["sysName"]).toBe("core-sw-01");
    expect(update["sysObjectId"]).toBe(CISCO_SYS_OBJECT_ID);
    expect(update["sysLocation"]).toBe("rack 12");
    expect(update["sysContact"]).toBe("netops@example.com");
  });

  test("fields the walk did not return are left off the update entirely", async () => {
    mockServices();

    await runWalk({
      systemInfo: {
        sysName: "core-sw-01",
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["sysName"]).toBe("core-sw-01");
    expect(update).not.toHaveProperty("sysDescr");
    expect(update).not.toHaveProperty("sysObjectId");
    expect(update).not.toHaveProperty("sysLocation");
    expect(update).not.toHaveProperty("sysContact");
  });

  test("lastSeenAt is stamped with the walk time on a reachable poll", async () => {
    mockServices();

    await runWalk();

    expect(deviceUpdatePayload()["lastSeenAt"]).toEqual(NOW);
  });
});

describe("NetworkInventoryUtil.updateFromWalk — project-membership guard", () => {
  test("refuses to write when the device is not in the given project", async () => {
    mockServices();
    // The scoped lookup finds no device → the id belongs to another project.
    deviceFindSpy.mockResolvedValue(null);

    await runWalk({
      systemInfo: { sysName: "victim-device" },
      interfaces: [walkedInterface()],
    });

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
    expect(interfaceUpsertSpy).not.toHaveBeenCalled();
  });

  test("the ownership lookup is scoped to both the device id and the project id", async () => {
    mockServices();

    await runWalk();

    const query: Record<string, unknown> = deviceFindSpy.mock.calls[0][0].query;

    expect(query["_id"]?.toString()).toBe(DEVICE_ID);
    expect(query["projectId"]?.toString()).toBe(PROJECT_ID);
  });
});

/*
 * The three columns this util writes on every walk are what the whole
 * up/down story rests on, so they get their own block:
 *
 *   lastPolledAt - when we ASKED    (always)
 *   isReachable  - what we got back (always)
 *   lastSeenAt   - when it ANSWERED (successful walks only)
 *
 * The bug this pins (issue #3220) was that only lastSeenAt existed, so a
 * device that answered its last poll 21 minutes ago was indistinguishable
 * from one that had failed its last poll — and the UI, having to guess,
 * called both of them Down.
 */
describe("NetworkInventoryUtil.updateFromWalk — reachability recording", () => {
  test("a reachable poll stamps all three columns", async () => {
    mockServices();

    await runWalk();

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["lastPolledAt"]).toEqual(NOW);
    expect(update["isReachable"]).toBe(true);
    expect(update["lastSeenAt"]).toEqual(NOW);
  });

  test("an unreachable poll with no walk data still records the attempt", async () => {
    mockServices();

    await runWalk(
      {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: "Device did not respond",
      },
      { isOnline: false },
    );

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    /*
     * This write used to be skipped entirely ("nothing worth writing"),
     * which is exactly what left the reader unable to tell a failing device
     * from one nothing had got round to polling.
     */
    expect(update["lastPolledAt"]).toEqual(NOW);
    expect(update["isReachable"]).toBe(false);
    // The device did not answer, so its last contact must not move.
    expect(update).not.toHaveProperty("lastSeenAt");
  });

  test("an unreachable poll with walk data still enriches but never stamps lastSeenAt", async () => {
    mockServices();

    await runWalk(
      {
        isOnline: false,
        systemInfo: { sysName: "core-sw-01" },
      },
      { isOnline: false },
    );

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["sysName"]).toBe("core-sw-01");
    expect(update["isReachable"]).toBe(false);
    expect(update["lastPolledAt"]).toEqual(NOW);
    expect(update).not.toHaveProperty("lastSeenAt");
  });

  test("a walk that reports no reachability at all is treated as answered", async () => {
    mockServices();

    await runWalk(undefined, { isOnline: undefined });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["isReachable"]).toBe(true);
    expect(update["lastPolledAt"]).toEqual(NOW);
    expect(update["lastSeenAt"]).toEqual(NOW);
  });

  test("lastPolledAt and lastSeenAt are the SAME instant on a good walk", async () => {
    mockServices();

    await runWalk();

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    /*
     * The reader treats "polled later than seen" as evidence of a failed
     * attempt, so a successful walk must not leave even a millisecond of
     * skew between the two.
     */
    expect((update["lastPolledAt"] as Date).getTime()).toBe(
      (update["lastSeenAt"] as Date).getTime(),
    );
  });

  test("a failed poll after a successful one leaves lastSeenAt behind lastPolledAt", async () => {
    mockServices();

    await runWalk();
    const good: DeviceUpdatePayload = deviceUpdatePayload();

    deviceUpdateSpy.mockClear();
    await runWalk({ isOnline: false }, { isOnline: false });
    const bad: DeviceUpdatePayload = deviceUpdatePayload();

    expect(bad["isReachable"]).toBe(false);
    expect(bad).not.toHaveProperty("lastSeenAt");
    // The previous success stays the device's last contact.
    expect(good["lastSeenAt"]).toEqual(NOW);
  });
});

describe("NetworkInventoryUtil.updateFromWalk — lastRebootedAt", () => {
  test("uptime is converted to the absolute reboot instant", async () => {
    mockServices();

    const uptimeSeconds: number = 3600;
    await runWalk({
      systemInfo: { sysUpTimeSeconds: uptimeSeconds },
    });

    expect(deviceUpdatePayload()["lastRebootedAt"]).toEqual(
      new Date(NOW.getTime() - uptimeSeconds * 1000),
    );
  });

  test("an uptime of zero (device just rebooted) still records the reboot", async () => {
    mockServices();

    await runWalk({
      systemInfo: { sysUpTimeSeconds: 0 },
    });

    expect(deviceUpdatePayload()["lastRebootedAt"]).toEqual(NOW);
  });

  test("no uptime in the walk leaves lastRebootedAt untouched", async () => {
    mockServices();

    await runWalk({
      systemInfo: { sysName: "core-sw-01" },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("lastRebootedAt");
  });
});

describe("NetworkInventoryUtil.updateFromWalk — vendor resolution", () => {
  test("ENTITY-MIB manufacturer wins over the sysObjectID fingerprint", async () => {
    mockServices();

    await runWalk({
      systemInfo: { sysObjectId: CISCO_SYS_OBJECT_ID },
      entityInfo: { manufacturer: "Custom Networks Inc" },
    });

    expect(deviceUpdatePayload()["vendor"]).toBe("Custom Networks Inc");
  });

  test("a device without ENTITY-MIB is fingerprinted from sysObjectID", async () => {
    mockServices();

    await runWalk({
      systemInfo: { sysObjectId: CISCO_SYS_OBJECT_ID },
    });

    expect(deviceUpdatePayload()["vendor"]).toBe("Cisco");
  });

  test("no manufacturer and an unknown sysObjectID leaves the vendor absent", async () => {
    mockServices();

    await runWalk({
      systemInfo: { sysObjectId: "1.3.6.1.2.1.1" },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("vendor");
  });

  test("an over-long manufacturer is truncated to the column limit", async () => {
    mockServices();

    const longVendor: string = "v".repeat(150);
    await runWalk({
      entityInfo: { manufacturer: longVendor },
    });

    expect(deviceUpdatePayload()["vendor"]).toBe(longVendor.substring(0, 100));
  });
});

describe("NetworkInventoryUtil.updateFromWalk — ENTITY-MIB hardware identity", () => {
  test("model, serial, firmware and software are persisted", async () => {
    mockServices();

    await runWalk({
      entityInfo: {
        model: "WS-C2960X-48TS-L",
        serialNumber: "FOC1234X0YZ",
        firmwareVersion: "15.2(7)E",
        softwareVersion: "15.2(7)E3",
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["deviceModel"]).toBe("WS-C2960X-48TS-L");
    expect(update["serialNumber"]).toBe("FOC1234X0YZ");
    expect(update["firmwareVersion"]).toBe("15.2(7)E");
    expect(update["softwareVersion"]).toBe("15.2(7)E3");
  });

  test("over-long entity fields are truncated to 100 characters", async () => {
    mockServices();

    const long: string = "e".repeat(150);
    await runWalk({
      entityInfo: {
        model: long,
        serialNumber: long,
        firmwareVersion: long,
        softwareVersion: long,
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    for (const field of [
      "deviceModel",
      "serialNumber",
      "firmwareVersion",
      "softwareVersion",
    ]) {
      expect(update[field]).toBe(long.substring(0, 100));
    }
  });

  test("absent entity fields never appear on the update", async () => {
    mockServices();

    await runWalk({
      entityInfo: { model: "WS-C2960X-48TS-L" },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["deviceModel"]).toBe("WS-C2960X-48TS-L");
    expect(update).not.toHaveProperty("serialNumber");
    expect(update).not.toHaveProperty("firmwareVersion");
    expect(update).not.toHaveProperty("softwareVersion");
  });
});

describe("NetworkInventoryUtil.updateFromWalk — LLDP/CDP neighbor snapshots", () => {
  function lldpNeighbor(index: number): LldpNeighbor {
    return {
      localInterfaceIndex: index,
      remoteSysName: `neighbor-${index}`,
      remotePortId: `port-${index}`,
    };
  }

  function cdpNeighbor(index: number): CdpNeighbor {
    return {
      localInterfaceIndex: index,
      remoteDeviceId: `cdp-neighbor-${index}`,
      remotePortId: `port-${index}`,
    };
  }

  test("both neighbor snapshots are capped at 256 entries", async () => {
    mockServices();

    const manyLldp: Array<LldpNeighbor> = Array.from(
      { length: 300 },
      (_: unknown, index: number) => {
        return lldpNeighbor(index);
      },
    );
    const manyCdp: Array<CdpNeighbor> = Array.from(
      { length: 300 },
      (_: unknown, index: number) => {
        return cdpNeighbor(index);
      },
    );

    await runWalk({ lldpNeighbors: manyLldp, cdpNeighbors: manyCdp });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["lldpNeighbors"]).toHaveLength(256);
    expect(update["cdpNeighbors"]).toHaveLength(256);
    expect((update["lldpNeighbors"] as Array<LldpNeighbor>)[0]).toEqual(
      lldpNeighbor(0),
    );
    expect((update["cdpNeighbors"] as Array<CdpNeighbor>)[255]).toEqual(
      cdpNeighbor(255),
    );
  });

  /*
   * A walk that ran and found nothing must still store the empty snapshot —
   * clearing stale neighbors is what keeps the topology honest after a
   * cable move.
   */
  test("an empty walk result clears the stored snapshot rather than skipping it", async () => {
    mockServices();

    await runWalk({ lldpNeighbors: [], cdpNeighbors: [] });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["lldpNeighbors"]).toEqual([]);
    expect(update["cdpNeighbors"]).toEqual([]);
  });

  test("a walk that did not collect neighbors (older probe) leaves the snapshot alone", async () => {
    mockServices();

    await runWalk();

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update).not.toHaveProperty("lldpNeighbors");
    expect(update).not.toHaveProperty("cdpNeighbors");
  });

  test("LLDP and CDP are stored independently of each other", async () => {
    mockServices();

    await runWalk({ lldpNeighbors: [lldpNeighbor(1)] });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["lldpNeighbors"]).toEqual([lldpNeighbor(1)]);
    expect(update).not.toHaveProperty("cdpNeighbors");
  });
});

describe("NetworkInventoryUtil.updateFromWalk — cached interface counts", () => {
  test("counts follow the admin-up convention", async () => {
    mockServices();

    await runWalk({
      interfaces: [
        walkedInterface({
          interfaceIndex: 1,
          isAdministrativelyUp: true,
          isOperationallyUp: true,
        }),
        walkedInterface({
          interfaceIndex: 2,
          isAdministrativelyUp: true,
          isOperationallyUp: false,
        }),
        // Administratively disabled: intentionally down, never a failure.
        walkedInterface({
          interfaceIndex: 3,
          isAdministrativelyUp: false,
          isOperationallyUp: false,
        }),
      ],
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["interfacesTotal"]).toBe(3);
    expect(update["interfacesUp"]).toBe(1);
    expect(update["interfacesDown"]).toBe(1);
  });
});

describe("NetworkInventoryUtil.updateFromWalk — interface upsert", () => {
  /*
   * The util used to loop over the walk writing each interface with its own
   * create() / updateOneById(); because DatabaseService._updateBy SELECTs
   * before every UPDATE, a 50-port switch cost 101 statements. It now hands
   * the whole walk to one batched service call. What is left to pin HERE is
   * the hand-off and the response pruning that depends on its answer — the
   * column-by-column contract lives in
   * Tests/Utils/Monitor/InterfaceInventoryUtil.test.ts and the SQL in
   * Tests/Server/Services/NetworkInterfaceServiceUpsert.test.ts.
   */
  test("the whole walk is handed to the batched upsert in one call", async () => {
    mockServices([existingInterface(1)]);

    await runWalk({
      interfaces: [
        walkedInterface({
          interfaceIndex: 1,
          macAddress: "aa:bb:cc:dd:ee:ff",
          interfaceType: 6,
        }),
        walkedInterface({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
    });

    expect(interfaceUpsertSpy).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = interfaceUpsertSpy.mock.calls[0][0];
    expect(call["projectId"].toString()).toBe(PROJECT_ID);
    expect(call["deviceId"].toString()).toBe(DEVICE_ID);
    expect(call["walkedInterfaces"]).toHaveLength(2);
    expect(call["walkedInterfaces"][0].interfaceIndex).toBe(1);
    expect(call["walkedInterfaces"][0].macAddress).toBe("aa:bb:cc:dd:ee:ff");
    expect(call["walkedInterfaces"][1].interfaceIndex).toBe(2);
  });

  /*
   * One timestamp for the whole walk, shared with the device row's
   * lastSeenAt. Per-row clock reads would make "which ports answered on this
   * walk" unanswerable, because no two rows would share a value to group on.
   */
  test("the upsert is stamped with the same `now` as the device row", async () => {
    mockServices([existingInterface(1)]);

    await runWalk({ interfaces: [walkedInterface({ interfaceIndex: 1 })] });

    expect(interfaceUpsertSpy.mock.calls[0][0].now).toEqual(NOW);
    expect(deviceUpdatePayload()["lastSeenAt"]).toEqual(NOW);
  });

  /*
   * A user muting an interface (isMonitored=false) keeps it in inventory but
   * prunes it from the in-flight response so criteria and metrics ignore it.
   * If the pruning is lost, a muted port starts raising incidents again the
   * moment it goes down — which is exactly what the user muted it to stop.
   */
  test("an unmonitored interface is still written to inventory but pruned from the response", async () => {
    const muted: NetworkInterface = existingInterface(1);
    muted.isMonitored = false;
    mockServices([muted]);

    const snmpResponse: SnmpMonitorResponse = await runWalk({
      interfaces: [
        walkedInterface({ interfaceIndex: 1 }),
        walkedInterface({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
    });

    // Inventory keeps the full picture: both ports went into the upsert.
    expect(interfaceUpsertSpy).toHaveBeenCalledTimes(1);
    expect(interfaceUpsertSpy.mock.calls[0][0].walkedInterfaces).toHaveLength(
      2,
    );

    // The in-flight response only keeps the monitored interface.
    expect(snmpResponse.interfaces).toHaveLength(1);
    expect(snmpResponse.interfaces?.[0]?.interfaceIndex).toBe(2);
  });

  test("a walk with nothing muted leaves the response untouched", async () => {
    mockServices([existingInterface(1)]);

    const snmpResponse: SnmpMonitorResponse = await runWalk({
      interfaces: [
        walkedInterface({ interfaceIndex: 1 }),
        walkedInterface({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
    });

    expect(snmpResponse.interfaces).toHaveLength(2);
  });

  /*
   * Inventory bookkeeping must never fail the walk PIPELINE: an upsert that
   * throws is logged and swallowed by updateFromWalk's own catch, so nothing
   * escapes into the probe-ingest handler and the device row keeps the
   * enrichment that was already written.
   *
   * Be precise about what it does NOT survive, because the obvious reading is
   * wrong: the upsert call and the ARP/FDB endpoint block sit inside the SAME
   * try, so a throw jumps past endpoint discovery and past the response
   * pruning for that cycle. That is unchanged from the row-at-a-time loop, and
   * it is why NetworkInterfaceService retries a failed chunk row by row —
   * a single unwritable interface should never get as far as this catch.
   */
  test("a failing interface upsert does not abort the rest of the walk", async () => {
    mockServices();
    interfaceUpsertSpy.mockRejectedValue(new Error("deadlock detected"));

    const snmpResponse: SnmpMonitorResponse = await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 1 })],
    });

    // The device row was still enriched, and nothing threw out of the util.
    expect(deviceUpdateSpy).toHaveBeenCalledTimes(1);
    expect(snmpResponse.interfaces).toHaveLength(1);
  });
});

describe("NetworkInventoryUtil.updateFromWalk — walks without interfaces", () => {
  test("a zero-interface walk still enriches the device but skips the interface upsert", async () => {
    mockServices();

    await runWalk({
      interfaces: [],
      systemInfo: { sysName: "core-sw-01" },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();

    expect(update["sysName"]).toBe("core-sw-01");
    expect(update).not.toHaveProperty("interfacesTotal");
    expect(update).not.toHaveProperty("interfacesUp");
    expect(update).not.toHaveProperty("interfacesDown");

    expect(interfaceFindSpy).not.toHaveBeenCalled();
    expect(interfaceUpsertSpy).not.toHaveBeenCalled();
  });

  test("a walk with no snmpResponse at all still records the poll", async () => {
    mockServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: new ObjectID(PROJECT_ID),
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: undefined,
      isOnline: true,
    });

    // Exactly the reachability columns and nothing else — no walk, no data.
    expect(deviceUpdatePayload()).toEqual({
      lastPolledAt: NOW,
      isReachable: true,
      lastSeenAt: NOW,
    });
    expect(interfaceFindSpy).not.toHaveBeenCalled();
    expect(interfaceUpsertSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkInventoryUtil.updateFromWalk — endpoint discovery", () => {
  test("a walk without ARP/FDB arrays (collection off) never touches endpoints", async () => {
    mockServices();

    await runWalk({
      interfaces: [walkedInterface()],
    });

    expect(endpointUpsertSpy).not.toHaveBeenCalled();
  });

  test("ARP/FDB arrays that yield no endpoints skip the upsert", async () => {
    mockServices();

    // Arrays present (collection ran) but nothing qualified as an endpoint.
    await runWalk({
      arpEntries: [],
      fdbEntries: [],
    });

    expect(endpointUpsertSpy).not.toHaveBeenCalled();
  });

  test("a learned FDB entry is upserted as an attachment for the device's project", async () => {
    mockServices();

    await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 5, name: "Gi0/5" })],
      fdbEntries: [
        {
          macAddress: "AA-BB-CC-00-11-22",
          bridgePort: 5,
          interfaceIndex: 5,
          status: "learned",
        },
      ],
    });

    expect(endpointUpsertSpy).toHaveBeenCalledTimes(1);

    const upsert: Record<string, unknown> = endpointUpsertSpy.mock.calls[0][0];

    expect((upsert["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect((upsert["deviceId"] as ObjectID).toString()).toBe(DEVICE_ID);
    expect(upsert["now"]).toEqual(NOW);
    expect(upsert["attachments"]).toEqual([
      {
        macAddress: "aa:bb:cc:00:11:22",
        attachedInterfaceIndex: 5,
        attachedPortName: "Gi0/5",
        vlanId: undefined,
      },
    ]);
    expect(upsert["ipBindings"]).toEqual([]);
  });

  test("an ARP entry is upserted as an IP binding", async () => {
    mockServices();

    await runWalk({
      arpEntries: [
        {
          ipAddress: "10.0.0.5",
          macAddress: "aa:bb:cc:00:11:22",
          interfaceIndex: 3,
          entryType: "dynamic",
        },
      ],
    });

    expect(endpointUpsertSpy).toHaveBeenCalledTimes(1);

    const upsert: Record<string, unknown> = endpointUpsertSpy.mock.calls[0][0];

    expect(upsert["attachments"]).toEqual([]);
    expect(upsert["ipBindings"]).toEqual([
      {
        macAddress: "aa:bb:cc:00:11:22",
        ipAddress: "10.0.0.5",
        routerInterfaceIndex: 3,
      },
    ]);
  });
});

describe("NetworkInventoryUtil.updateFromWalk — vendor health template auto-apply", () => {
  /*
   * The automatic counterpart of the dashboard's vendor-template banner:
   * a device that opted in (auto-imported devices do) gets its EMPTY Health
   * OID list seeded from the vendor template its sysObjectID fingerprints,
   * on the first poll that learns the vendor. An existing list — however it
   * got there — is the operator's and is never touched.
   */
  test("an opted-in device with no health OIDs is seeded from the fingerprinted vendor template", async () => {
    mockServices([], { autoApplyVendorHealthTemplate: true });

    await runWalk({
      systemInfo: {
        sysObjectId: CISCO_SYS_OBJECT_ID,
      },
    });

    const update: DeviceUpdatePayload = deviceUpdatePayload();
    const seeded: Array<SnmpOid> = update["snmpOids"] as Array<SnmpOid>;

    const ciscoTemplate: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.matchBySysObjectId(CISCO_SYS_OBJECT_ID);

    expect(ciscoTemplate).toBeDefined();
    expect(seeded).toEqual(ciscoTemplate!.oids);
    expect(seeded.length).toBeGreaterThan(0);
  });

  test("a device that never opted in is not seeded", async () => {
    mockServices();

    await runWalk({
      systemInfo: {
        sysObjectId: CISCO_SYS_OBJECT_ID,
      },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("snmpOids");
  });

  test("an existing health OID list is never touched, even with the toggle on", async () => {
    const handPickedOids: Array<SnmpOid> = [
      { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1", name: "CPU 5min" },
    ];

    mockServices([], {
      autoApplyVendorHealthTemplate: true,
      snmpOids: handPickedOids,
    });

    await runWalk({
      systemInfo: {
        sysObjectId: CISCO_SYS_OBJECT_ID,
      },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("snmpOids");
  });

  test("a walk that learned no sysObjectID seeds nothing", async () => {
    mockServices([], { autoApplyVendorHealthTemplate: true });

    await runWalk({
      systemInfo: {
        sysName: "core-sw-01",
      },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("snmpOids");
  });

  test("an enterprise with no vendor template seeds nothing", async () => {
    mockServices([], { autoApplyVendorHealthTemplate: true });

    // Enterprise 99999 has no entry in ENTERPRISE_TEMPLATE_IDS.
    await runWalk({
      systemInfo: {
        sysObjectId: "1.3.6.1.4.1.99999.1.1",
      },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("snmpOids");
  });

  /*
   * A device linked to an OID Collection Template is exempt outright, even
   * though it satisfies every other condition: opted in, empty local list,
   * vendor fingerprinted.
   *
   * Its effective OID list already comes from the template, resolved fresh on
   * every poll, and its own snmpOids column is by design the small set of
   * device-specific ADDITIONS — usually empty, which is exactly the condition
   * this auto-apply keys off. Without the guard, the first poll after linking
   * writes a vendor copy on top of the template and the device silently
   * collects the union of two sources, only one of which the operator can see
   * or edit. Auto-imported devices are all opted in, so this would have been
   * the common case rather than an edge one.
   */
  test("a device linked to an OID Collection Template is never seeded", async () => {
    mockServices([], {
      autoApplyVendorHealthTemplate: true,
      oidTemplateId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    });

    await runWalk({
      systemInfo: {
        sysObjectId: CISCO_SYS_OBJECT_ID,
      },
    });

    expect(deviceUpdatePayload()).not.toHaveProperty("snmpOids");
  });

  test("selects oidTemplateId, or the guard above can never see the link", async () => {
    mockServices([], { autoApplyVendorHealthTemplate: true });

    await runWalk({
      systemInfo: {
        sysObjectId: CISCO_SYS_OBJECT_ID,
      },
    });

    const findArgs: { select?: Record<string, boolean> } = deviceFindSpy.mock
      .calls[0]![0] as unknown as { select?: Record<string, boolean> };

    expect(findArgs.select?.["oidTemplateId"]).toBe(true);
  });
});
