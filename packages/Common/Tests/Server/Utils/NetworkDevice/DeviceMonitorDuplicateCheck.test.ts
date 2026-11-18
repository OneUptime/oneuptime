jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

import DeviceMonitorDuplicateCheck, {
  DEVICE_MONITOR_BUSY_REASON,
  DEVICE_MONITOR_FACTS_SELECT,
  DEVICE_MONITOR_LOCK_ACQUIRE_TIMEOUT_MS,
  DEVICE_MONITOR_LOCK_NAMESPACE,
  DEVICE_MONITOR_LOCK_TIMEOUT_MS,
  deviceMonitorLockKey,
} from "../../../../Server/Utils/NetworkDevice/DeviceMonitorDuplicateCheck";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import Port from "../../../../Types/Port";
import { DeviceMonitorFacts } from "../../../../Utils/Monitor/DeviceMonitorDuplicates";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * THE DUPLICATE CHECK ON THE SERVER (OneUptime issues #9509 and #9510).
 *
 * What it reads to answer "does this device already have a monitor the
 * template's would duplicate?" - the monitors made for the device, then the
 * one bound to it - and the lock it holds between the paths that make
 * device monitors, so an import and an auto import rule cannot each give
 * the same device a Ping monitor in the same second.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const KIOSK_PING_TEMPLATE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);
const OTHER_PING_TEMPLATE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000002",
);
const ALERT_PACK_TEMPLATE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000003",
);
const PROBE_ID: ObjectID = new ObjectID("dd000000-0000-4000-8000-000000000001");
const SCAN_PROBE_ID: ObjectID = new ObjectID(
  "dd000000-0000-4000-8000-000000000002",
);
const STATUS_ID: ObjectID = new ObjectID(
  "ee000000-0000-4000-8000-000000000001",
);

const findByMock: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const findOneByMock: jest.Mock =
  MonitorService.findOneBy as unknown as jest.Mock;
const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;

function steps(monitorType: MonitorType, port?: number): MonitorSteps {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "WB1567KSK02",
    monitorType: monitorType,
    onlineMonitorStatusId: STATUS_ID,
    offlineMonitorStatusId: STATUS_ID,
    defaultIncidentSeverityId: STATUS_ID,
    defaultAlertSeverityId: STATUS_ID,
  });
  step.setMonitorDestination(IP.fromString("10.40.12.7"));
  step.setPort(port ? new Port(port) : undefined);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

function monitor(data: {
  name: string;
  monitorType: MonitorType;
  templateId?: ObjectID | undefined;
  port?: number | undefined;
}): Monitor {
  const item: Monitor = new Monitor();
  item.id = ObjectID.generate();
  item.name = data.name;
  item.monitorType = data.monitorType;
  item.monitorSteps = steps(data.monitorType, data.port);

  if (data.templateId) {
    item.monitorTemplateId = data.templateId;
  }

  return item;
}

function template(data: {
  id: ObjectID;
  monitorType: MonitorType;
  port?: number | undefined;
}): MonitorTemplate {
  const item: MonitorTemplate = new MonitorTemplate();
  item.id = data.id;
  item.projectId = PROJECT_ID;
  item.monitorType = data.monitorType;
  item.monitorSteps = steps(data.monitorType, data.port);
  return item;
}

function device(monitorId?: ObjectID): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = DEVICE_ID;
  item.projectId = PROJECT_ID;

  if (monitorId) {
    item.monitorId = monitorId;
  }

  return item;
}

beforeEach(() => {
  jest.clearAllMocks();
  findByMock.mockResolvedValue([]);
  findOneByMock.mockResolvedValue(null);
  lockMock.mockResolvedValue({ id: "device-lock" });
  releaseMock.mockResolvedValue(undefined);
});

describe("the monitors of a device", () => {
  it("are the ones made for it, read as OneUptime, oldest first, with what tells a duplicate", async () => {
    const madeForDevice: Monitor = monitor({
      name: "WB1567KSK02",
      monitorType: MonitorType.Ping,
      templateId: KIOSK_PING_TEMPLATE_ID,
    });
    findByMock.mockResolvedValue([madeForDevice]);

    const monitors: Array<DeviceMonitorFacts> =
      await DeviceMonitorDuplicateCheck.readDeviceMonitors({
        projectId: PROJECT_ID,
        device: device(),
      });

    expect(monitors).toHaveLength(1);
    expect(monitors[0]).toMatchObject({
      id: madeForDevice.id!.toString(),
      name: "WB1567KSK02",
      monitorType: MonitorType.Ping,
      monitorTemplateId: KIOSK_PING_TEMPLATE_ID.toString(),
    });

    const query: Record<string, unknown> = findByMock.mock.calls[0]![0];
    expect(query).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        autoProvisionedNetworkDeviceId: DEVICE_ID,
      },
      select: DEVICE_MONITOR_FACTS_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
    // No monitor is bound to the device, so none is read for it.
    expect(findOneByMock).not.toHaveBeenCalled();
  });

  it("include the monitor bound to the device, after the ones made for it", async () => {
    const madeForDevice: Monitor = monitor({
      name: "WB1567KSK02 - Health",
      monitorType: MonitorType.NetworkDevice,
      templateId: ALERT_PACK_TEMPLATE_ID,
    });
    const bound: Monitor = monitor({
      name: "WB1567KSK02 Ping",
      monitorType: MonitorType.Ping,
    });
    findByMock.mockResolvedValue([madeForDevice]);
    findOneByMock.mockResolvedValue(bound);

    const monitors: Array<DeviceMonitorFacts> =
      await DeviceMonitorDuplicateCheck.readDeviceMonitors({
        projectId: PROJECT_ID,
        device: device(bound.id!),
      });

    expect(
      monitors.map((item: DeviceMonitorFacts): string => {
        return item.name;
      }),
    ).toEqual(["WB1567KSK02 - Health", "WB1567KSK02 Ping"]);
    expect(findOneByMock.mock.calls[0]![0]).toMatchObject({
      query: { _id: bound.id!.toString(), projectId: PROJECT_ID },
      select: DEVICE_MONITOR_FACTS_SELECT,
      props: { isRoot: true },
    });
  });

  it("list a monitor made for the device and bound to it once", async () => {
    const both: Monitor = monitor({
      name: "WB1567KSK02",
      monitorType: MonitorType.Ping,
      templateId: KIOSK_PING_TEMPLATE_ID,
    });
    findByMock.mockResolvedValue([both]);

    const monitors: Array<DeviceMonitorFacts> =
      await DeviceMonitorDuplicateCheck.readDeviceMonitors({
        projectId: PROJECT_ID,
        device: device(
          new ObjectID(both.id!.toString().toUpperCase().toLowerCase()),
        ),
      });

    expect(monitors).toHaveLength(1);
    expect(findOneByMock).not.toHaveBeenCalled();
  });

  it("leave out a bound monitor that is gone", async () => {
    findOneByMock.mockResolvedValue(null);

    expect(
      await DeviceMonitorDuplicateCheck.readDeviceMonitors({
        projectId: PROJECT_ID,
        device: device(ObjectID.generate()),
      }),
    ).toEqual([]);
  });

  it("are none for a device not saved yet", async () => {
    const unsaved: NetworkDevice = new NetworkDevice();

    expect(
      await DeviceMonitorDuplicateCheck.readDeviceMonitors({
        projectId: PROJECT_ID,
        device: unsaved,
      }),
    ).toEqual([]);
    expect(findByMock).not.toHaveBeenCalled();
  });
});

describe("the monitor a template's would duplicate", () => {
  // The screenshot on issue #9509, from the server's side.
  it("is the device's Ping monitor from another Ping template", async () => {
    const existing: Monitor = monitor({
      name: "WB1567KSK02",
      monitorType: MonitorType.Ping,
      templateId: OTHER_PING_TEMPLATE_ID,
    });
    findByMock.mockResolvedValue([existing]);

    const duplicate: DeviceMonitorFacts | null =
      await DeviceMonitorDuplicateCheck.findDuplicate({
        projectId: PROJECT_ID,
        device: device(),
        template: template({
          id: KIOSK_PING_TEMPLATE_ID,
          monitorType: MonitorType.Ping,
        }),
      });

    expect(duplicate?.id).toBe(existing.id!.toString());
  });

  it("is the Ping monitor bound to a monitor-backed device", async () => {
    const bound: Monitor = monitor({
      name: "WB1567KSK02 Ping",
      monitorType: MonitorType.Ping,
    });
    findOneByMock.mockResolvedValue(bound);

    const duplicate: DeviceMonitorFacts | null =
      await DeviceMonitorDuplicateCheck.findDuplicate({
        projectId: PROJECT_ID,
        device: device(bound.id!),
        template: template({
          id: KIOSK_PING_TEMPLATE_ID,
          monitorType: MonitorType.Ping,
        }),
      });

    expect(duplicate?.id).toBe(bound.id!.toString());
  });

  it("is none for a Network Device template beside the device's Ping monitor", async () => {
    findByMock.mockResolvedValue([
      monitor({
        name: "WB1567KSK02",
        monitorType: MonitorType.Ping,
        templateId: KIOSK_PING_TEMPLATE_ID,
      }),
    ]);

    expect(
      await DeviceMonitorDuplicateCheck.findDuplicate({
        projectId: PROJECT_ID,
        device: device(),
        template: template({
          id: ALERT_PACK_TEMPLATE_ID,
          monitorType: MonitorType.NetworkDevice,
        }),
      }),
    ).toBeNull();
  });

  it("is none for a Port template on another port than the device's Port monitor", async () => {
    findByMock.mockResolvedValue([
      monitor({
        name: "WB1567KSK02 HTTPS",
        monitorType: MonitorType.Port,
        templateId: OTHER_PING_TEMPLATE_ID,
        port: 443,
      }),
    ]);

    expect(
      await DeviceMonitorDuplicateCheck.findDuplicate({
        projectId: PROJECT_ID,
        device: device(),
        template: template({
          id: KIOSK_PING_TEMPLATE_ID,
          monitorType: MonitorType.Port,
          port: 22,
        }),
      }),
    ).toBeNull();
  });
});

describe("the device's lock", () => {
  it("is not taken for a Network Device template: the unique (device, template) index holds those", async () => {
    const result: string = await DeviceMonitorDuplicateCheck.underDeviceLock(
      { deviceId: DEVICE_ID, monitorType: MonitorType.NetworkDevice },
      async (): Promise<string> => {
        return "created";
      },
    );

    expect(result).toBe("created");
    expect(lockMock).not.toHaveBeenCalled();
    expect(DeviceMonitorDuplicateCheck.needsDeviceLock("Network Device")).toBe(
      false,
    );
  });

  it("is held around the work for every Ping, IP, Port and NTP template, and given back", async () => {
    for (const monitorType of [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]) {
      jest.clearAllMocks();
      lockMock.mockResolvedValue({ id: "device-lock" });
      const order: Array<string> = [];
      lockMock.mockImplementation(async () => {
        order.push("lock");
        return { id: "device-lock" };
      });
      releaseMock.mockImplementation(async () => {
        order.push("release");
      });

      await DeviceMonitorDuplicateCheck.underDeviceLock(
        { deviceId: DEVICE_ID, monitorType: monitorType },
        async (): Promise<void> => {
          order.push("work");
        },
      );

      expect(order).toEqual(["lock", "work", "release"]);
      expect(lockMock.mock.calls[0]![0]).toEqual({
        key: deviceMonitorLockKey(DEVICE_ID),
        namespace: DEVICE_MONITOR_LOCK_NAMESPACE,
        lockTimeout: DEVICE_MONITOR_LOCK_TIMEOUT_MS,
        acquireTimeout: DEVICE_MONITOR_LOCK_ACQUIRE_TIMEOUT_MS,
      });
      expect(releaseMock).toHaveBeenCalledWith({ id: "device-lock" });
    }
  });

  it("is one lock per device, named by the device", () => {
    expect(deviceMonitorLockKey(DEVICE_ID)).toBe(
      `NetworkDeviceMonitor:Device:${DEVICE_ID.toString()}`,
    );
  });

  it("is given back when the work fails, and the failure is the caller's", async () => {
    await expect(
      DeviceMonitorDuplicateCheck.underDeviceLock(
        { deviceId: DEVICE_ID, monitorType: MonitorType.Ping },
        async (): Promise<void> => {
          throw new Error("The plan has no room for another monitor.");
        },
      ),
    ).rejects.toThrow("The plan has no room for another monitor.");

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("refuses the work with a sentence that says to try again when another path holds the device", async () => {
    lockMock.mockRejectedValue(new Error("acquire timeout"));
    const work: jest.Mock = jest.fn();

    await expect(
      DeviceMonitorDuplicateCheck.underDeviceLock(
        { deviceId: DEVICE_ID, monitorType: MonitorType.Ping },
        work as unknown as () => Promise<void>,
      ),
    ).rejects.toThrow(new BadDataException(DEVICE_MONITOR_BUSY_REASON));

    expect(work).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
    expect(DEVICE_MONITOR_BUSY_REASON).toMatch(/^[A-Z].*\.$/);
  });

  it("keeps the work's answer when the lock cannot be given back", async () => {
    releaseMock.mockRejectedValue(new Error("Redis went away"));

    expect(
      await DeviceMonitorDuplicateCheck.underDeviceLock(
        { deviceId: DEVICE_ID, monitorType: MonitorType.Ping },
        async (): Promise<string> => {
          return "created";
        },
      ),
    ).toBe("created");
  });
});

describe("the probe a device's address monitor runs on", () => {
  it("is the device's, else the scan's, else the project's defaults", () => {
    const polled: NetworkDevice = new NetworkDevice();
    polled.probeId = PROBE_ID;
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.probeId = SCAN_PROBE_ID;

    expect(
      DeviceMonitorDuplicateCheck.getAddressMonitorProbes({
        device: polled,
        scan: scan,
      }),
    ).toEqual({ probes: [PROBE_ID.toString()] });
    expect(
      DeviceMonitorDuplicateCheck.getAddressMonitorProbes({
        device: new NetworkDevice(),
        scan: scan,
      }),
    ).toEqual({ probes: [SCAN_PROBE_ID.toString()] });
    expect(
      DeviceMonitorDuplicateCheck.getAddressMonitorProbes({
        device: new NetworkDevice(),
        scan: null,
      }),
    ).toEqual({});
  });
});
