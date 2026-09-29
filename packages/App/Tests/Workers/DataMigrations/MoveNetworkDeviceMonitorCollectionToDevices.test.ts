import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import MoveNetworkDeviceMonitorCollectionToDevices from "../../../FeatureSet/Workers/DataMigrations/MoveNetworkDeviceMonitorCollectionToDevices";

/*
 * The migration touches three singleton services; loading the real ones
 * would drag the whole database layer into this unit suite, so each is
 * replaced with just the methods the migration calls.
 */
jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: { deleteBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const monitorService: { findBy: jest.Mock } = MonitorService as unknown as {
  findBy: jest.Mock;
};
const monitorProbeService: { deleteBy: jest.Mock } =
  MonitorProbeService as unknown as { deleteBy: jest.Mock };
const deviceService: { findOneBy: jest.Mock; updateOneById: jest.Mock } =
  NetworkDeviceService as unknown as {
    findOneBy: jest.Mock;
    updateOneById: jest.Mock;
  };
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

interface StepCollectionOptions {
  networkDeviceId?: string | undefined;
  monitorInterfaces?: boolean | undefined;
  collectEndpoints?: boolean | undefined;
  oids?: Array<SnmpOid> | undefined;
}

/*
 * The migration only reads monitor.projectId and the
 * monitorSteps.data.monitorStepsInstanceArray[i].data.networkDeviceMonitor
 * path, so the steps are built as plain data — the same shape the JSON
 * column deserializes into.
 */
function makeMonitor(data: {
  monitorId: ObjectID;
  projectId?: ObjectID | undefined;
  steps: Array<StepCollectionOptions>;
}): Monitor {
  const monitor: Monitor = new Monitor(data.monitorId);
  monitor.monitorType = MonitorType.NetworkDevice;

  if (data.projectId) {
    monitor.projectId = data.projectId;
  }

  monitor.monitorSteps = {
    data: {
      monitorStepsInstanceArray: data.steps.map(
        (step: StepCollectionOptions) => {
          return { data: { networkDeviceMonitor: step } };
        },
      ),
    },
  } as unknown as MonitorSteps;

  return monitor;
}

function makeDevice(data: {
  deviceId: ObjectID;
  projectId: ObjectID;
  snmpOids?: Array<SnmpOid> | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(data.deviceId);
  device.projectId = data.projectId;

  if (data.snmpOids !== undefined) {
    device.snmpOids = data.snmpOids;
  }

  return device;
}

// Routes findOneBy to the right device by the queried _id.
function stubDeviceLookup(devices: Array<NetworkDevice>): void {
  deviceService.findOneBy.mockImplementation((...callArgs: Array<unknown>) => {
    const args: JSONObject = callArgs[0] as JSONObject;
    const queriedId: string = (
      (args["query"] as JSONObject)["_id"] as ObjectID
    ).toString();

    return Promise.resolve(
      devices.find((device: NetworkDevice) => {
        return device.id?.toString() === queriedId;
      }) || null,
    );
  });
}

function updateDataFor(deviceId: ObjectID): JSONObject {
  const call: Array<unknown> | undefined =
    deviceService.updateOneById.mock.calls.find((callArgs: Array<unknown>) => {
      return (
        ((callArgs[0] as JSONObject)["id"] as ObjectID).toString() ===
        deviceId.toString()
      );
    });

  expect(call).toBeDefined();
  return (call![0] as JSONObject)["data"] as JSONObject;
}

describe("MoveNetworkDeviceMonitorCollectionToDevices", () => {
  const projectId: ObjectID = ObjectID.generate();
  const migration: MoveNetworkDeviceMonitorCollectionToDevices =
    new MoveNetworkDeviceMonitorCollectionToDevices();

  beforeEach(() => {
    jest.clearAllMocks();
    monitorService.findBy.mockResolvedValue([] as never);
    deviceService.findOneBy.mockResolvedValue(null as never);
    deviceService.updateOneById.mockResolvedValue(undefined as never);
    monitorProbeService.deleteBy.mockResolvedValue(undefined as never);
  });

  test("queries only Network Device monitors, as root", async () => {
    await migration.migrate();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = monitorService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect((findArgs["query"] as JSONObject)["monitorType"]).toBe(
      MonitorType.NetworkDevice,
    );
    expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
    expect(deviceService.updateOneById).not.toHaveBeenCalled();
    expect(monitorProbeService.deleteBy).not.toHaveBeenCalled();
  });

  test("copies step collection options onto the referenced device", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [
          {
            networkDeviceId: deviceId.toString(),
            monitorInterfaces: true,
            collectEndpoints: true,
            oids: [{ oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime" }],
          },
        ],
      }),
    ] as never);
    stubDeviceLookup([makeDevice({ deviceId, projectId })]);

    await migration.migrate();

    expect(deviceService.updateOneById).toHaveBeenCalledTimes(1);
    const data: JSONObject = updateDataFor(deviceId);
    expect(data["walkInterfaces"]).toBe(true);
    expect(data["collectEndpoints"]).toBe(true);
    expect(data["snmpOids"]).toEqual([
      { oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime", description: undefined },
    ]);
  });

  test("walkInterfaces is a union: one step walking interfaces keeps the device walking, even next to an opted-out step", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [
          { networkDeviceId: deviceId.toString(), monitorInterfaces: false },
          // No explicit flag: legacy steps default to walking (=== "not false").
          { networkDeviceId: deviceId.toString() },
        ],
      }),
    ] as never);
    stubDeviceLookup([makeDevice({ deviceId, projectId })]);

    await migration.migrate();

    expect(updateDataFor(deviceId)["walkInterfaces"]).toBe(true);
  });

  test("only steps that ALL opted out of interface walking turn the device's walking off", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [
          { networkDeviceId: deviceId.toString(), monitorInterfaces: false },
          { networkDeviceId: deviceId.toString(), monitorInterfaces: false },
        ],
      }),
    ] as never);
    stubDeviceLookup([makeDevice({ deviceId, projectId })]);

    await migration.migrate();

    expect(updateDataFor(deviceId)["walkInterfaces"]).toBe(false);
  });

  test("collectEndpoints stays off unless a step explicitly opted in", async () => {
    const optedOut: ObjectID = ObjectID.generate();
    const legacyUnset: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [
          { networkDeviceId: optedOut.toString(), collectEndpoints: false },
          // Steps saved before the flag existed carry no collectEndpoints.
          { networkDeviceId: legacyUnset.toString() },
        ],
      }),
    ] as never);
    stubDeviceLookup([
      makeDevice({ deviceId: optedOut, projectId }),
      makeDevice({ deviceId: legacyUnset, projectId }),
    ]);

    await migration.migrate();

    expect(updateDataFor(optedOut)["collectEndpoints"]).toBe(false);
    expect(updateDataFor(legacyUnset)["collectEndpoints"]).toBe(false);
  });

  test("merges step OIDs after the device's own, deduplicated by OID string", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [
          {
            networkDeviceId: deviceId.toString(),
            oids: [
              // Duplicate of an OID the device already carries.
              { oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTimeFromStep" },
              { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1", name: "cpu5min" },
            ],
          },
          {
            networkDeviceId: deviceId.toString(),
            // Duplicate across steps too.
            oids: [{ oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1" }],
          },
        ],
      }),
    ] as never);
    stubDeviceLookup([
      makeDevice({
        deviceId,
        projectId,
        snmpOids: [{ oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime" }],
      }),
    ]);

    await migration.migrate();

    // Device OIDs come first and win the dedupe; step OIDs append after.
    expect(updateDataFor(deviceId)["snmpOids"]).toEqual([
      { oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime", description: undefined },
      {
        oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1",
        name: "cpu5min",
        description: undefined,
      },
    ]);
  });

  /*
   * A step's device reference is user-writable JSON, so a monitor in
   * project A must never rewrite the collection settings of a device that
   * lives in project B.
   */
  test("skips a device whose project matches no referencing monitor's project", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [{ networkDeviceId: deviceId.toString() }],
      }),
    ] as never);
    stubDeviceLookup([makeDevice({ deviceId, projectId: otherProjectId })]);

    await migration.migrate();

    expect(deviceService.updateOneById).not.toHaveBeenCalled();
  });

  test("deletes the MonitorProbe rows of every Network Device monitor so probes stop double-polling", async () => {
    const monitorIdA: ObjectID = ObjectID.generate();
    const monitorIdB: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({ monitorId: monitorIdA, projectId: projectId, steps: [] }),
      makeMonitor({ monitorId: monitorIdB, projectId: projectId, steps: [] }),
    ] as never);

    await migration.migrate();

    expect(monitorProbeService.deleteBy).toHaveBeenCalledTimes(2);

    const deletedMonitorIds: Array<string> =
      monitorProbeService.deleteBy.mock.calls.map(
        (callArgs: Array<unknown>) => {
          return (
            ((callArgs[0] as JSONObject)["query"] as JSONObject)[
              "monitorId"
            ] as ObjectID
          ).toString();
        },
      );
    expect(deletedMonitorIds.sort()).toEqual(
      [monitorIdA.toString(), monitorIdB.toString()].sort(),
    );

    const deleteArgs: JSONObject = monitorProbeService.deleteBy.mock
      .calls[0]![0] as JSONObject;
    expect(deleteArgs["limit"]).toBe(LIMIT_MAX);
    expect((deleteArgs["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("one failing device is logged and skipped — the rest still migrate and probes are still detached", async () => {
    const failingDeviceId: ObjectID = ObjectID.generate();
    const healthyDeviceId: ObjectID = ObjectID.generate();
    const monitorId: ObjectID = ObjectID.generate();

    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: monitorId,
        projectId: projectId,
        steps: [
          { networkDeviceId: failingDeviceId.toString() },
          { networkDeviceId: healthyDeviceId.toString() },
        ],
      }),
    ] as never);

    const healthyDevice: NetworkDevice = makeDevice({
      deviceId: healthyDeviceId,
      projectId: projectId,
    });
    deviceService.findOneBy.mockImplementation(
      (...callArgs: Array<unknown>) => {
        const queriedId: string = (
          ((callArgs[0] as JSONObject)["query"] as JSONObject)[
            "_id"
          ] as ObjectID
        ).toString();

        if (queriedId === failingDeviceId.toString()) {
          return Promise.reject(new Error("db down"));
        }
        return Promise.resolve(healthyDevice);
      },
    );

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(deviceService.updateOneById).toHaveBeenCalledTimes(1);
    expect(
      (deviceService.updateOneById.mock.calls[0]![0] as JSONObject)[
        "id"
      ]!.toString(),
    ).toBe(healthyDeviceId.toString());
    expect(mockedLogger.error).toHaveBeenCalled();

    // The MonitorProbe cleanup still runs after the partial failure.
    expect(monitorProbeService.deleteBy).toHaveBeenCalledTimes(1);
  });

  test("a failing MonitorProbe delete is logged and does not stop the other monitors' cleanup", async () => {
    const monitorIdA: ObjectID = ObjectID.generate();
    const monitorIdB: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({ monitorId: monitorIdA, projectId: projectId, steps: [] }),
      makeMonitor({ monitorId: monitorIdB, projectId: projectId, steps: [] }),
    ] as never);
    monitorProbeService.deleteBy
      .mockRejectedValueOnce(new Error("delete failed") as never)
      .mockResolvedValue(undefined as never);

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(monitorProbeService.deleteBy).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalled();
  });

  test("a device referenced by monitors in two projects migrates when its own project is among them", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    const foreignProjectId: ObjectID = ObjectID.generate();
    monitorService.findBy.mockResolvedValue([
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: foreignProjectId,
        steps: [
          { networkDeviceId: deviceId.toString(), collectEndpoints: true },
        ],
      }),
      makeMonitor({
        monitorId: ObjectID.generate(),
        projectId: projectId,
        steps: [{ networkDeviceId: deviceId.toString() }],
      }),
    ] as never);
    stubDeviceLookup([makeDevice({ deviceId, projectId })]);

    await migration.migrate();

    // The union is still computed across all referencing steps.
    const data: JSONObject = updateDataFor(deviceId);
    expect(data["walkInterfaces"]).toBe(true);
    expect(data["collectEndpoints"]).toBe(true);
  });
});
