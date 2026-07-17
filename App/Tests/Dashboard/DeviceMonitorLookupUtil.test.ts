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
    },
  };
});

/* eslint-disable import/first -- imports must come after jest.mock above */
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import DeviceMonitorLookupUtil from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil";
/* eslint-enable import/first */

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

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
