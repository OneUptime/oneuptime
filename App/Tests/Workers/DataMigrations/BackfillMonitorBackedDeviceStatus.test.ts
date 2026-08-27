import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import BackfillMonitorBackedDeviceStatus from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorBackedDeviceStatus";

/*
 * The upgrade half of OneUptime/oneuptime#3392.
 *
 * The service fix stamps a monitor-backed device with its monitor's
 * current status at bind time, which repairs every binding made from now
 * on. It does nothing for the bindings already saved — those devices are
 * waiting on a status CHANGE that, on a monitor that is healthy and stays
 * healthy, never comes. Their operators would only ever see the device
 * leave "Pending" at the moment it broke.
 *
 * So this walks them once, on upgrade. What is pinned here is the shape of
 * that walk: which rows it touches, which it deliberately does not, and
 * that one bad device cannot take the rest of the fleet — or the
 * migrations queued behind it — down with it.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), refreshStampedMonitorStatus: jest.fn() },
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

const deviceService: {
  findBy: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
};

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

function makeDevice(data: {
  deviceId: ObjectID;
  monitoringMethod?: string | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(data.deviceId);
  if (data.monitoringMethod !== undefined) {
    device.monitoringMethod = data.monitoringMethod;
  }
  return device;
}

function refreshedDeviceIds(): Array<string> {
  return deviceService.refreshStampedMonitorStatus.mock.calls.map(
    (callArgs: Array<unknown>) => {
      return ((callArgs[0] as JSONObject)["deviceId"] as ObjectID).toString();
    },
  );
}

describe("BackfillMonitorBackedDeviceStatus", () => {
  const migration: BackfillMonitorBackedDeviceStatus =
    new BackfillMonitorBackedDeviceStatus();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    deviceService.refreshStampedMonitorStatus.mockResolvedValue(
      undefined as never,
    );
  });

  /*
   * A device with nothing bound has no status to adopt — discovery import
   * creates ping-only hosts that way on purpose — so "Pending" is its true
   * answer and the query never fetches it.
   */
  test("asks only for devices that actually point at a monitor", async () => {
    await migration.migrate();

    expect(deviceService.findBy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;

    expect((findArgs["query"] as JSONObject)["monitorId"]).toBeDefined();
    expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
    expect(findArgs["limit"]).toBe(LIMIT_MAX);
    expect(findArgs["skip"]).toBe(0);
  });

  /*
   * monitoringMethod decides whether a row is walked at all, so a select
   * that dropped it would send every SNMP device through the monitor path.
   */
  test("selects the column it filters on", async () => {
    await migration.migrate();

    const select: JSONObject = deviceService.findBy.mock.calls[0]![0][
      "select"
    ] as JSONObject;

    expect(select["_id"]).toBe(true);
    expect(select["monitoringMethod"]).toBe(true);
  });

  // The devices in the issue: bound, monitor-backed, and stuck on Pending.
  test("re-stamps every monitor-backed device", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    deviceService.findBy.mockResolvedValue([
      makeDevice({
        deviceId: first,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
      makeDevice({
        deviceId: second,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ] as never);

    await migration.migrate();

    expect(refreshedDeviceIds()).toEqual([first.toString(), second.toString()]);
  });

  /*
   * It never clears: a backfill exists to fill in a stamp that is missing,
   * not to take a decision about one that is there.
   */
  test("never asks to clear a stamp", async () => {
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        deviceId: ObjectID.generate(),
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ] as never);

    await migration.migrate();

    expect(
      deviceService.refreshStampedMonitorStatus.mock.calls[0]![0][
        "clearWhenNotMonitorBacked"
      ],
    ).toBe(false);
  });

  /*
   * An SNMP device can carry a monitorId and a stamped status both — the
   * status comes from the Network Device monitor watching its walk. Sending
   * it through here would re-derive that stamp from the wrong binding and
   * wipe it.
   */
  test("skips SNMP devices that happen to carry a monitor", async () => {
    const snmp: ObjectID = ObjectID.generate();
    const monitorBacked: ObjectID = ObjectID.generate();

    deviceService.findBy.mockResolvedValue([
      makeDevice({
        deviceId: snmp,
        monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
      }),
      makeDevice({
        deviceId: monitorBacked,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ] as never);

    await migration.migrate();

    expect(refreshedDeviceIds()).toEqual([monitorBacked.toString()]);
  });

  /*
   * The column is free text and nullable. Everything that is not the
   * literal "monitor" is an SNMP device — including a row written before
   * the column existed, and including a typo.
   */
  test.each([
    ["a NULL method, from before the column existed", undefined],
    ["an empty string", ""],
    ["a typo", "Monitorr"],
  ])(
    "leaves a device with %s alone",
    async (_label: string, method: string | undefined) => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: method as string | undefined,
        }),
      ] as never);

      await migration.migrate();

      expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
    },
  );

  test.each(["Monitor", "monitor", "  MONITOR  "])(
    "walks a device whose method reads as %p",
    async (method: string) => {
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          deviceId: ObjectID.generate(),
          monitoringMethod: method,
        }),
      ] as never);

      await migration.migrate();

      expect(deviceService.refreshStampedMonitorStatus).toHaveBeenCalledTimes(
        1,
      );
    },
  );

  /*
   * Migrations run in sequence at boot, so an unhandled throw here does not
   * just lose one device's status — it halts every migration queued after
   * it.
   */
  test("keeps going when one device fails, and says which", async () => {
    const broken: ObjectID = ObjectID.generate();
    const healthy: ObjectID = ObjectID.generate();

    deviceService.findBy.mockResolvedValue([
      makeDevice({
        deviceId: broken,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
      makeDevice({
        deviceId: healthy,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ] as never);

    deviceService.refreshStampedMonitorStatus.mockImplementation(
      (...callArgs: Array<unknown>) => {
        const deviceId: string = (
          (callArgs[0] as JSONObject)["deviceId"] as ObjectID
        ).toString();

        if (deviceId === broken.toString()) {
          return Promise.reject(new Error("monitor lookup exploded"));
        }

        return Promise.resolve();
      },
    );

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(refreshedDeviceIds()).toEqual([
      broken.toString(),
      healthy.toString(),
    ]);
    expect(mockedLogger.error).toHaveBeenCalled();
    expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
      broken.toString(),
    );
  });

  test("does nothing at all on an installation with no bound devices", async () => {
    await migration.migrate();

    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
  });

  // Nothing to undo: the stamp is derived state, re-derived on every save.
  test("rolls back to a no-op", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});
