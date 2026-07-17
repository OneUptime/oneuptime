import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import LldpNeighbor from "../../../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../../../Types/Monitor/SnmpMonitor/CdpNeighbor";

/*
 * NetworkInventoryUtil.updateFromWalk is the single writer that keeps the
 * NetworkDevice / NetworkInterface inventory in sync with each SNMP
 * interface walk. These tests mock the two services it writes through and
 * pin the enrichment contract: which walked fields land on the device row
 * (and at what column-limit truncation), how uptime becomes lastRebootedAt,
 * how the vendor is chosen, the LLDP/CDP snapshot semantics (store-even-
 * when-empty, capped), and what flows into the interface upsert on both the
 * update and create paths.
 */

const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");

const CISCO_SYS_OBJECT_ID: string = "1.3.6.1.4.1.9.1.1208";

type DeviceUpdatePayload = Record<string, unknown>;

let deviceFindSpy: jest.SpyInstance;
let deviceUpdateSpy: jest.SpyInstance;
let interfaceFindSpy: jest.SpyInstance;
let interfaceUpdateSpy: jest.SpyInstance;
let interfaceCreateSpy: jest.SpyInstance;

function mockServices(existingInterfaces: Array<NetworkInterface> = []): void {
  /*
   * The project-membership guard resolves the device (scoped to the
   * monitor's project) before any write; return a matching device so the
   * write path runs. The cross-project-refusal case overrides this to null.
   */
  const ownedDevice: NetworkDevice = new NetworkDevice();
  ownedDevice.id = new ObjectID(DEVICE_ID);
  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(ownedDevice);
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(undefined);
  interfaceFindSpy = jest
    .spyOn(NetworkInterfaceService, "findBy")
    .mockResolvedValue(existingInterfaces);
  interfaceUpdateSpy = jest
    .spyOn(NetworkInterfaceService, "updateOneById")
    .mockResolvedValue(undefined);
  interfaceCreateSpy = jest
    .spyOn(NetworkInterfaceService, "create")
    .mockResolvedValue(new NetworkInterface());
}

function deviceUpdatePayload(): DeviceUpdatePayload {
  expect(deviceUpdateSpy).toHaveBeenCalledTimes(1);
  return deviceUpdateSpy.mock.calls[0][0].data as DeviceUpdatePayload;
}

function buildMonitor(options?: { networkDeviceId?: string | undefined }): {
  monitor: Monitor;
  stepId: ObjectID;
} {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    networkDeviceMonitor: {
      networkDeviceId:
        options && "networkDeviceId" in options
          ? options.networkDeviceId
          : DEVICE_ID,
      monitorInterfaces: true,
    },
  } as MonitorStep["data"];

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.projectId = ObjectID.generate();
  monitor.monitorSteps = monitorSteps;

  return { monitor: monitor, stepId: step.id };
}

function buildResponse(
  stepId: ObjectID,
  snmpFields?: Partial<SnmpMonitorResponse>,
): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    oidResponses: [],
    ...snmpFields,
  };

  return {
    projectId: ObjectID.generate(),
    monitorStepId: stepId,
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: NOW,
    snmpResponse: snmpResponse,
  } as ProbeMonitorResponse;
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
): Promise<ProbeMonitorResponse> {
  const { monitor, stepId } = buildMonitor();
  const response: ProbeMonitorResponse = buildResponse(stepId, snmpFields);

  await NetworkInventoryUtil.updateFromWalk({
    monitor: monitor,
    dataToProcess: response,
  });

  return response;
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
  test("refuses to write when the step's device is not in the monitor's project", async () => {
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
});

describe("NetworkInventoryUtil.updateFromWalk — reachability gating", () => {
  test("an unreachable poll with no walk data writes nothing (no phantom lastSeenAt)", async () => {
    mockServices();

    const { monitor, stepId } = buildMonitor();
    const response: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorStepId: stepId,
      monitorId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "Device did not respond",
      monitoredAt: NOW,
      isOnline: false,
      snmpResponse: {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: "Device did not respond",
        oidResponses: [],
      },
    } as ProbeMonitorResponse;

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: response,
    });

    // lastSeenAt drives the up/down pill; a failed poll must not bump it.
    expect(deviceUpdateSpy).not.toHaveBeenCalled();
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
    const { monitor, stepId } = buildMonitor();

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: buildResponse(stepId, {
        interfaces: [
          walkedInterface({
            interfaceIndex: 7,
            macAddress: "aa:bb:cc:dd:ee:ff",
            interfaceType: 6,
          }),
        ],
      }),
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
    expect(created.projectId?.toString()).toBe(monitor.projectId?.toString());
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

    const response: ProbeMonitorResponse = await runWalk({
      interfaces: [
        walkedInterface({ interfaceIndex: 1 }),
        walkedInterface({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
    });

    // Inventory keeps the full picture: one update (index 1), one create (index 2).
    expect(interfaceUpdateSpy).toHaveBeenCalledTimes(1);
    expect(interfaceCreateSpy).toHaveBeenCalledTimes(1);

    // The in-flight response only keeps the monitored interface.
    expect(response.snmpResponse?.interfaces).toHaveLength(1);
    expect(response.snmpResponse?.interfaces?.[0]?.interfaceIndex).toBe(2);
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

  test("a walk with no snmpResponse at all still stamps lastSeenAt", async () => {
    mockServices();
    const { monitor, stepId } = buildMonitor();

    const response: ProbeMonitorResponse = buildResponse(stepId);
    delete (response as { snmpResponse?: unknown }).snmpResponse;

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: response,
    });

    expect(deviceUpdatePayload()).toEqual({ lastSeenAt: NOW });
    expect(interfaceFindSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkInventoryUtil.updateFromWalk — guards", () => {
  test("a response for a step that does not reference a device performs no writes", async () => {
    mockServices();
    const { monitor } = buildMonitor({ networkDeviceId: undefined });

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: buildResponse(ObjectID.generate()),
    });

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
    expect(interfaceFindSpy).not.toHaveBeenCalled();
  });

  test("a response whose step id matches no step performs no writes", async () => {
    mockServices();
    const { monitor } = buildMonitor();

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: buildResponse(ObjectID.generate()),
    });

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
  });

  test("a monitor without a projectId performs no writes", async () => {
    mockServices();
    const { monitor, stepId } = buildMonitor();
    // exactOptionalPropertyTypes forbids assigning undefined directly.
    (monitor as { projectId?: ObjectID | undefined }).projectId = undefined;

    await NetworkInventoryUtil.updateFromWalk({
      monitor: monitor,
      dataToProcess: buildResponse(stepId),
    });

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
  });
});
