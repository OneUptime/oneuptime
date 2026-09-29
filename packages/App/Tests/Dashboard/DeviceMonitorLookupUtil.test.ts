import { beforeEach, describe, expect, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * DeviceMonitorLookupUtil.monitorWatchesDevice is pure, but the module also
 * imports ModelAPI (for getMonitorsWatchingDevice), and ModelAPI transitively
 * loads Common/UI/Config, which reads `window` at import time and throws in
 * this node test environment. Mocking the ModelAPI module keeps the import
 * graph browser-free and doubles as the seam for testing the client-side
 * filtering that getMonitorsWatchingDevice layers on top of the API call.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getItem: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import DeviceMonitorLookupUtil from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getItemMock: jest.Mock = ModelAPI.getItem as unknown as jest.Mock;

const DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000aa",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000bb",
);

function stepWatching(networkDeviceId: string | undefined): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: networkDeviceId,
    monitorInterfaces: true,
    oids: [],
  };
  return step;
}

function stepWithoutDeviceMonitor(): MonitorStep {
  // A fresh step: data exists but networkDeviceMonitor is undefined.
  return new MonitorStep();
}

function malformedStep(): MonitorStep {
  // A step whose data never hydrated — the util must tolerate it.
  const step: MonitorStep = new MonitorStep();
  step.data = undefined;
  return step;
}

/**
 * A monitor as the BOUND-monitor read returns it: an ordinary Ping monitor
 * with no steps referencing any device. This is the shape the old lookup
 * could never find, which is what #3447 is about.
 */
function boundPingMonitor(id: string, name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  monitor.monitorType = MonitorType.Ping;
  return monitor;
}

/** The device read that getDeviceBinding performs. */
function deviceRow(data: {
  monitoringMethod?: string | undefined;
  monitor?: Monitor | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  /*
   * Assigned only when present: the project compiles with
   * exactOptionalPropertyTypes, so writing an explicit `undefined` into an
   * optional property is an error rather than a no-op.
   */
  if (data.monitoringMethod !== undefined) {
    device.monitoringMethod = data.monitoringMethod;
  }

  if (data.monitor !== undefined) {
    device.monitor = data.monitor;
  }

  return device;
}

function monitorWithSteps(steps: Array<MonitorStep>): Monitor {
  const monitor: Monitor = new Monitor();
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = { monitorStepsInstanceArray: steps };
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

describe("DeviceMonitorLookupUtil.monitorWatchesDevice", () => {
  test("matches a monitor whose step references the device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });

  test("rejects a monitor watching a different device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("matches when any one of several steps references the device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });

  test("rejects a monitor with no monitorSteps at all", () => {
    const monitor: Monitor = new Monitor();

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("rejects a monitor whose monitorSteps never hydrated data", () => {
    const monitor: Monitor = new Monitor();
    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = undefined;
    monitor.monitorSteps = monitorSteps;

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("rejects an empty steps array", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("tolerates a step with no data (does not throw, does not match)", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([malformedStep()]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("tolerates a step without a networkDeviceMonitor section", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([stepWithoutDeviceMonitor()]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("a networkDeviceMonitor with no device id does not match", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([stepWatching(undefined)]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("still finds the match after malformed sibling steps", () => {
    const monitor: Monitor = monitorWithSteps([
      malformedStep(),
      stepWithoutDeviceMonitor(),
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });
});

describe("DeviceMonitorLookupUtil.getMonitorsWatchingDevice", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getItemMock.mockReset();
    // Default: the device has nothing bound, which is the pre-#3447 world.
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("filters the fetched list down to monitors watching the device", async () => {
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    const other: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);
    const malformed: Monitor = monitorWithSteps([malformedStep()]);

    getListMock.mockResolvedValue({
      data: [watching, other, malformed],
      count: 3,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(watching);
  });

  test("queries only Network Device monitors", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 100 });

    await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(getListMock).toHaveBeenCalledTimes(1);
    const callArg: { query?: { monitorType?: MonitorType } } = getListMock.mock
      .calls[0]![0] as { query?: { monitorType?: MonitorType } };
    expect(callArg.query?.monitorType).toBe(MonitorType.NetworkDevice);
  });

  test("returns an empty array when nothing in the project watches the device", async () => {
    getListMock.mockResolvedValue({
      data: [monitorWithSteps([stepWatching(OTHER_DEVICE_ID.toString())])],
      count: 1,
      skip: 0,
      limit: 100,
    });

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([]);
  });
});

/*
 * The #3447 half of the lookup.
 *
 * A ping-only device imported from a discovery scan is monitor-backed: it has
 * no probe, is never walked, and its health lives entirely in the Monitor
 * bound to it through NetworkDevice.monitorId. That monitor is an ordinary
 * Ping or IP monitor, so it is NOT of type NetworkDevice and its steps say
 * nothing about the device — the project-wide Network Device query can never
 * return it. Before this, the device's own Overview said "No monitors are
 * alerting on this device yet" while the status pill two panels up was green
 * because of the very monitor the card had failed to find.
 */
describe("DeviceMonitorLookupUtil.getDeviceBinding", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getItemMock.mockReset();
  });

  test("returns the monitor bound to the device", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce01",
      "ping-10.246.174.13",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: bound,
      isMonitorBacked: true,
    });
  });

  test("reads monitor-backed through the parser, so NULL means SNMP", async () => {
    getItemMock.mockResolvedValue(deviceRow({ monitoringMethod: undefined }));

    const binding: { isMonitorBacked: boolean } =
      await DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID);

    /*
     * Every device that predates the monitoringMethod column holds NULL and
     * IS an SNMP device. Defaulting the other way would tell an entire legacy
     * fleet that nothing polls them.
     */
    expect(binding.isMonitorBacked).toBe(false);
  });

  test("a monitor-backed device with nothing bound reports no monitor", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: true,
    });
  });

  test("an unreadable device degrades to the pre-existing behaviour rather than throwing", async () => {
    getItemMock.mockRejectedValue(new Error("forbidden"));

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: false,
    });
  });

  test("a device that no longer exists degrades the same way", async () => {
    getItemMock.mockResolvedValue(null);

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: false,
    });
  });
});

describe("DeviceMonitorLookupUtil - the bound monitor joins the list", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 100 });
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("a bound Ping monitor is returned even though no Network Device monitor watches the device", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce02",
      "ping-core-ap",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    // This is the regression: it used to be [].
    expect(result).toEqual([bound]);
  });

  test("the bound monitor leads, watchers follow", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce03",
      "ping-core-ap",
    );
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    watching._id = "9f1b6b0e-0000-4000-8000-00000000ce04";

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    getListMock.mockResolvedValue({
      data: [watching],
      count: 1,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toHaveLength(2);
    // The monitor deciding the device's status comes first.
    expect(result[0]).toBe(bound);
    expect(result[1]).toBe(watching);
  });

  test("a monitor that is both bound AND watching is listed once", async () => {
    const sharedId: string = "9f1b6b0e-0000-4000-8000-00000000ce05";

    const bound: Monitor = boundPingMonitor(sharedId, "dual-role");
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    watching._id = sharedId;

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    getListMock.mockResolvedValue({
      data: [watching],
      count: 1,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    /*
     * The two arrive from different requests, so they are different objects
     * with the same id. Deduping by identity would render the row twice.
     */
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bound);
  });

  test("an SNMP device with nothing bound behaves exactly as before", async () => {
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    const other: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);

    getListMock.mockResolvedValue({
      data: [watching, other],
      count: 2,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toEqual([watching]);
  });

  test("getDeviceMonitorContext hands the caller both answers from one device read", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce06",
      "ping-ip-phone",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({
      monitors: [bound],
      isMonitorBacked: true,
    });

    /*
     * One device read, not two: the card needs the monitor AND the method,
     * and a second round trip for a boolean already on the row is waste.
     */
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});
