import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorService from "Common/Server/Services/MonitorService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import RestampDevicesOfMonitorsNotChecked from "../../../FeatureSet/Workers/DataMigrations/RestampDevicesOfMonitorsNotChecked";

/*
 * The upgrade half of issue #6965.
 *
 * A network device now takes no status from a monitor that is not checked
 * - its monitoring turned off, or archived - and MonitorService stamps a
 * monitor's devices again whenever it is turned off, on, archived or
 * unarchived. That holds for every switch from now on. A monitor turned off
 * before kept its last status - "Offline" - on its devices, and nothing
 * would ever move it, so their sites still rolled up from it and their
 * alerts stayed open.
 *
 * This walks those devices once. Pinned here: it is registered, which rows
 * it reads and how, which devices it stamps again and which it leaves
 * alone, that it pages, and that one bad device cannot stop the rest - or
 * the migrations queued behind it.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), refreshStampedMonitorStatus: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
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

const MIGRATION_NAME: string = "RestampDevicesOfMonitorsNotChecked";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations as Index.ts registers them, in order.
const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const deviceService: {
  findBy: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  refreshStampedMonitorStatus: jest.Mock;
};

const monitorService: { findBy: jest.Mock } = MonitorService as unknown as {
  findBy: jest.Mock;
};

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

const OFF_MONITOR: ObjectID = ObjectID.generate();
const ARCHIVED_MONITOR: ObjectID = ObjectID.generate();
const CHECKED_MONITOR: ObjectID = ObjectID.generate();
const OFFLINE_STATUS: ObjectID = ObjectID.generate();

interface DeviceShape {
  monitorId?: ObjectID | undefined;
  monitoringMethod?: string | undefined;
  currentMonitorStatusId?: ObjectID | undefined;
  isReachable?: boolean | undefined;
}

function makeDevice(shape: DeviceShape): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.monitoringMethod =
    shape.monitoringMethod === undefined
      ? NetworkDeviceMonitoringMethod.Monitor
      : shape.monitoringMethod;

  if (shape.monitorId) {
    device.monitorId = shape.monitorId;
  }

  if (shape.currentMonitorStatusId) {
    device.currentMonitorStatusId = shape.currentMonitorStatusId;
  }

  if (shape.isReachable !== undefined) {
    device.isReachable = shape.isReachable;
  }

  return device;
}

// A device that still says Offline from the monitor it is bound to.
function frozenDevice(monitorId: ObjectID): NetworkDevice {
  return makeDevice({
    monitorId: monitorId,
    currentMonitorStatusId: OFFLINE_STATUS,
    isReachable: false,
  });
}

function makeMonitor(data: {
  id: ObjectID;
  disableActiveMonitoring?: boolean | undefined;
  isArchived?: boolean | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.disableActiveMonitoring = Boolean(data.disableActiveMonitoring);
  monitor.isArchived = Boolean(data.isArchived);
  return monitor;
}

const MONITORS: Array<Monitor> = [
  makeMonitor({ id: OFF_MONITOR, disableActiveMonitoring: true }),
  makeMonitor({ id: ARCHIVED_MONITOR, isArchived: true }),
  makeMonitor({ id: CHECKED_MONITOR }),
];

// The ids inside a QueryHelper.any() operator.
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return (Object.values(parameters)[0] as Array<string>).map(
    (id: string): string => {
      return id.toString();
    },
  );
}

function restampedDeviceIds(): Array<string> {
  return deviceService.refreshStampedMonitorStatus.mock.calls.map(
    (call: Array<unknown>): string => {
      return ((call[0] as JSONObject)["deviceId"] as ObjectID).toString();
    },
  );
}

describe("RestampDevicesOfMonitorsNotChecked", () => {
  const migration: RestampDevicesOfMonitorsNotChecked =
    new RestampDevicesOfMonitorsNotChecked();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.findBy.mockResolvedValue([] as never);
    deviceService.refreshStampedMonitorStatus.mockResolvedValue(
      undefined as never,
    );
    monitorService.findBy.mockResolvedValue(MONITORS as never);
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    // After the backfill whose stamps it corrects.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("BackfillMonitorBackedDeviceReachability"),
    );
  });

  test("reads the devices that point at a monitor, as OneUptime, in id order, with what it decides from", async () => {
    await migration.migrate();

    expect(deviceService.findBy).toHaveBeenCalledTimes(1);
    const read: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;

    expect((read["query"] as JSONObject)["monitorId"]).toBeDefined();
    expect(read["select"]).toEqual({
      _id: true,
      monitorId: true,
      monitoringMethod: true,
      currentMonitorStatusId: true,
      isReachable: true,
    });
    expect(read["sort"]).toEqual({ _id: "ASC" });
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["skip"]).toBe(0);
    expect(read["limit"]).toBe(LIMIT_MAX);
  });

  test("stamps again the devices of a monitor whose monitoring is off, and of an archived one", async () => {
    const offDevice: NetworkDevice = frozenDevice(OFF_MONITOR);
    const archivedDevice: NetworkDevice = frozenDevice(ARCHIVED_MONITOR);
    deviceService.findBy.mockResolvedValue([
      offDevice,
      archivedDevice,
    ] as never);

    await migration.migrate();

    expect(restampedDeviceIds()).toEqual([
      offDevice.id!.toString(),
      archivedDevice.id!.toString(),
    ]);
    for (const call of deviceService.refreshStampedMonitorStatus.mock.calls) {
      expect((call[0] as JSONObject)["clearWhenNotMonitorBacked"]).toBe(false);
    }
  });

  test("reads the switches of a page's monitors once, as OneUptime", async () => {
    deviceService.findBy.mockResolvedValue([
      frozenDevice(OFF_MONITOR),
      frozenDevice(OFF_MONITOR),
      frozenDevice(CHECKED_MONITOR),
    ] as never);

    await migration.migrate();

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    const read: JSONObject = monitorService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect(
      idsInAnyOperator((read["query"] as JSONObject)["_id"]).sort(),
    ).toEqual([OFF_MONITOR.toString(), CHECKED_MONITOR.toString()].sort());
    expect(read["select"]).toEqual({
      _id: true,
      isArchived: true,
      disableActiveMonitoring: true,
    });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("leaves alone a device whose monitor is checked", async () => {
    deviceService.findBy.mockResolvedValue([
      frozenDevice(CHECKED_MONITOR),
    ] as never);

    await migration.migrate();

    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
  });

  test("leaves alone a device whose monitor was not found", async () => {
    deviceService.findBy.mockResolvedValue([
      frozenDevice(ObjectID.generate()),
    ] as never);

    await migration.migrate();

    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
  });

  /*
   * A probe-polled device's poll decides its health, and its stamp comes
   * from the Network Device monitors that watch its walk, not from the
   * monitor it names in monitorId.
   */
  test("leaves alone a probe-polled device, and one whose method was never set", async () => {
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        monitorId: OFF_MONITOR,
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        currentMonitorStatusId: OFFLINE_STATUS,
      }),
      makeDevice({
        monitorId: OFF_MONITOR,
        monitoringMethod: "",
        currentMonitorStatusId: OFFLINE_STATUS,
      }),
    ] as never);

    await migration.migrate();

    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
    // Nothing on the page could need it, so no monitor is read either.
    expect(monitorService.findBy).not.toHaveBeenCalled();
  });

  test("leaves alone a device that already has no status, and reads no monitor for it", async () => {
    deviceService.findBy.mockResolvedValue([
      makeDevice({ monitorId: OFF_MONITOR }),
    ] as never);

    await migration.migrate();

    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
    expect(monitorService.findBy).not.toHaveBeenCalled();
  });

  // A status row that was not found leaves isReachable stamped on its own.
  test("stamps again a device that holds only a reachability from it", async () => {
    const device: NetworkDevice = makeDevice({
      monitorId: OFF_MONITOR,
      isReachable: false,
    });
    deviceService.findBy.mockResolvedValue([device] as never);

    await migration.migrate();

    expect(restampedDeviceIds()).toEqual([device.id!.toString()]);
  });

  test("a monitor-backed method written in another case still counts", async () => {
    const device: NetworkDevice = makeDevice({
      monitorId: OFF_MONITOR,
      monitoringMethod: " monitor ",
      currentMonitorStatusId: OFFLINE_STATUS,
    });
    deviceService.findBy.mockResolvedValue([device] as never);

    await migration.migrate();

    expect(restampedDeviceIds()).toEqual([device.id!.toString()]);
  });

  test("pages through a fleet larger than one page", async () => {
    const firstPage: Array<NetworkDevice> = Array.from(
      { length: LIMIT_MAX },
      (): NetworkDevice => {
        return makeDevice({ monitorId: CHECKED_MONITOR });
      },
    );
    const tail: NetworkDevice = frozenDevice(OFF_MONITOR);
    deviceService.findBy
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce([tail] as never);

    await migration.migrate();

    expect(deviceService.findBy).toHaveBeenCalledTimes(2);
    expect((deviceService.findBy.mock.calls[1]![0] as JSONObject)["skip"]).toBe(
      LIMIT_MAX,
    );
    expect(restampedDeviceIds()).toEqual([tail.id!.toString()]);
  });

  test("one device that fails is logged, and the rest are still stamped", async () => {
    const failing: NetworkDevice = frozenDevice(OFF_MONITOR);
    const next: NetworkDevice = frozenDevice(ARCHIVED_MONITOR);
    deviceService.findBy.mockResolvedValue([failing, next] as never);
    deviceService.refreshStampedMonitorStatus
      .mockRejectedValueOnce(new Error("database is down") as never)
      .mockResolvedValueOnce(undefined as never);

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(restampedDeviceIds()).toEqual([
      failing.id!.toString(),
      next.id!.toString(),
    ]);
    expect(String(mockedLogger.error.mock.calls[0]![0])).toContain(
      failing.id!.toString(),
    );
    expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
      "stamped 1 network device(s)",
    );
  });

  test("rollback changes nothing", async () => {
    await migration.rollback();

    expect(deviceService.findBy).not.toHaveBeenCalled();
    expect(deviceService.refreshStampedMonitorStatus).not.toHaveBeenCalled();
  });
});
