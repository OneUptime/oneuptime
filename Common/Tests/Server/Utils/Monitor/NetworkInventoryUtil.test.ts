import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
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
let interfaceUpdateSpy: jest.SpyInstance;
let interfaceCreateSpy: jest.SpyInstance;
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
  interfaceFindSpy = jest
    .spyOn(NetworkInterfaceService, "findBy")
    .mockResolvedValue(existingInterfaces);
  interfaceUpdateSpy = jest
    .spyOn(NetworkInterfaceService, "updateOneById")
    .mockResolvedValue(1);
  interfaceCreateSpy = jest
    .spyOn(NetworkInterfaceService, "create")
    .mockResolvedValue(new NetworkInterface());
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
    expect(interfaceCreateSpy).not.toHaveBeenCalled();
    expect(interfaceUpdateSpy).not.toHaveBeenCalled();
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
  test("the update path passes macAddress and interfaceType through", async () => {
    mockServices([existingInterface(1)]);

    await runWalk({
      interfaces: [
        walkedInterface({
          interfaceIndex: 1,
          macAddress: "aa:bb:cc:dd:ee:ff",
          interfaceType: 6,
        }),
      ],
    });

    expect(interfaceUpdateSpy).toHaveBeenCalledTimes(1);
    expect(interfaceCreateSpy).not.toHaveBeenCalled();

    const updateData: Record<string, unknown> =
      interfaceUpdateSpy.mock.calls[0][0].data;

    expect(updateData["macAddress"]).toBe("aa:bb:cc:dd:ee:ff");
    expect(updateData["interfaceType"]).toBe(6);
    expect(updateData["name"]).toBe("GigabitEthernet0/1");
    expect(updateData["lastSeenAt"]).toEqual(NOW);
  });

  test("the update path clears macAddress and interfaceType when the walk stops reporting them", async () => {
    mockServices([existingInterface(1)]);

    await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 1 })],
    });

    const updateData: Record<string, unknown> =
      interfaceUpdateSpy.mock.calls[0][0].data;

    expect(updateData["macAddress"]).toBeNull();
    expect(updateData["interfaceType"]).toBeNull();
  });

  test("the create path passes macAddress and interfaceType through", async () => {
    mockServices([]);

    await runWalk({
      interfaces: [
        walkedInterface({
          interfaceIndex: 7,
          macAddress: "aa:bb:cc:dd:ee:ff",
          interfaceType: 6,
        }),
      ],
    });

    expect(interfaceCreateSpy).toHaveBeenCalledTimes(1);
    expect(interfaceUpdateSpy).not.toHaveBeenCalled();

    const created: NetworkInterface = interfaceCreateSpy.mock.calls[0][0].data;

    expect(created.macAddress).toBe("aa:bb:cc:dd:ee:ff");
    expect(created.interfaceType).toBe(6);
    expect(created.interfaceIndex).toBe(7);
    expect(created.name).toBe("GigabitEthernet0/1");
    expect(created.isMonitored).toBe(true);
    expect(created.networkDeviceId?.toString()).toBe(DEVICE_ID);
    expect(created.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("the create path leaves macAddress and interfaceType unset when the walk has none", async () => {
    mockServices([]);

    await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 7 })],
    });

    const created: NetworkInterface = interfaceCreateSpy.mock.calls[0][0].data;

    expect(created.macAddress).toBeUndefined();
    expect(created.interfaceType).toBeUndefined();
  });

  test("over-long mac addresses are truncated on both paths", async () => {
    const longMac: string = "a".repeat(150);

    mockServices([existingInterface(1)]);
    await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 1, macAddress: longMac })],
    });

    expect(interfaceUpdateSpy.mock.calls[0][0].data["macAddress"]).toBe(
      longMac.substring(0, 100),
    );

    jest.restoreAllMocks();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    mockServices([]);
    await runWalk({
      interfaces: [walkedInterface({ interfaceIndex: 1, macAddress: longMac })],
    });

    const created: NetworkInterface = interfaceCreateSpy.mock.calls[0][0].data;
    expect(created.macAddress).toBe(longMac.substring(0, 100));
  });

  /*
   * A user muting an interface (isMonitored=false) keeps it in inventory but
   * prunes it from the in-flight response so criteria and metrics ignore it.
   */
  test("an unmonitored interface is still updated in inventory but pruned from the response", async () => {
    const muted: NetworkInterface = existingInterface(1);
    muted.isMonitored = false;
    mockServices([muted]);

    const snmpResponse: SnmpMonitorResponse = await runWalk({
      interfaces: [
        walkedInterface({ interfaceIndex: 1 }),
        walkedInterface({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
    });

    // Inventory keeps the full picture: one update (index 1), one create (index 2).
    expect(interfaceUpdateSpy).toHaveBeenCalledTimes(1);
    expect(interfaceCreateSpy).toHaveBeenCalledTimes(1);

    // The in-flight response only keeps the monitored interface.
    expect(snmpResponse.interfaces).toHaveLength(1);
    expect(snmpResponse.interfaces?.[0]?.interfaceIndex).toBe(2);
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
    expect(interfaceUpdateSpy).not.toHaveBeenCalled();
    expect(interfaceCreateSpy).not.toHaveBeenCalled();
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
});
